import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { isUuidV4 } from '@/lib/api/corePipeline';
import { safeJson } from '@/lib/http/safeJson';
import { loadLatestInferenceActionabilityGateEvent } from '@/lib/inference/actionabilityGate';
import {
    loadInferenceReviewQueueEvents,
    recordInferenceReviewQueueEvent,
    reviewReasonFromActionabilityGate,
    reviewSeverityFromActionabilityGate,
    type InferenceReviewStatus,
} from '@/lib/inference/reviewQueue';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

interface RouteContext {
    params: Promise<{ id: string }>;
}

interface ReviewBody {
    action?: unknown;
    reviewer_note?: unknown;
}

export async function GET(req: Request, context: RouteContext) {
    const { id } = await context.params;
    if (!isUuidV4(id)) {
        return NextResponse.json({ error: 'invalid_inference_event_id' }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const events = await loadInferenceReviewQueueEvents(supabase, auth.actor.tenantId, id, 20);
    if (events.error) {
        const missing = isMissingReviewQueueStorage(events.error);
        return NextResponse.json({
            data: [],
            meta: {
                inference_event_id: id,
                tenant_id: auth.actor.tenantId,
                storage_installed: !missing,
                review_found: false,
            },
            error: missing ? null : events.error,
            message: missing
                ? 'Inference review queue storage is not installed. Apply supabase/migrations/20260612030000_inference_review_queue_events.sql in Supabase, then reload the schema.'
                : events.error,
        }, { status: missing ? 200 : 500 });
    }

    return NextResponse.json({
        data: events.data,
        meta: {
            inference_event_id: id,
            tenant_id: auth.actor.tenantId,
            storage_installed: true,
            review_found: events.data.length > 0,
        },
        error: null,
    });
}

export async function POST(req: Request, context: RouteContext) {
    const { id } = await context.params;
    if (!isUuidV4(id)) {
        return NextResponse.json({ error: 'invalid_inference_event_id' }, { status: 400 });
    }

    const parsed = await safeJson<ReviewBody>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: 'invalid_json', detail: parsed.error }, { status: 400 });
    }

    const action = normalizeAction(parsed.data.action);
    if (!action) {
        return NextResponse.json({ error: 'invalid_review_action' }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['inference:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const gate = await loadLatestInferenceActionabilityGateEvent(supabase, auth.actor.tenantId, id);
    if (gate.error) {
        return NextResponse.json(
            { error: 'actionability_gate_lookup_failed', detail: gate.error },
            { status: 500 },
        );
    }
    if (!gate.data) {
        return NextResponse.json(
            { error: 'actionability_gate_missing', message: 'Run or refresh the actionability gate before queueing clinical review.' },
            { status: 409 },
        );
    }

    const status = reviewStatusForAction(action);
    const note = typeof parsed.data.reviewer_note === 'string' ? parsed.data.reviewer_note : null;
    const insert = await recordInferenceReviewQueueEvent(supabase, {
        tenantId: auth.actor.tenantId,
        inferenceEventId: id,
        requestId: null,
        caseId: null,
        actionabilityGate: gate.data,
        reviewStatus: status,
        severity: reviewSeverityFromActionabilityGate(gate.data),
        reviewReason: action === 'queue'
            ? reviewReasonFromActionabilityGate(gate.data)
            : `Clinical review ${status}.`,
        source: action === 'queue' ? 'operator_queue' : 'operator_review',
        reviewerNote: note,
        createdBy: auth.actor.userId ?? auth.actor.principalLabel ?? auth.actor.authMode,
        metadata: {
            actor_auth_mode: auth.actor.authMode,
            review_action: action,
        },
    });

    if (insert.error) {
        const missing = isMissingReviewQueueStorage(insert.error);
        return NextResponse.json({
            error: missing ? 'review_queue_storage_missing' : 'review_queue_insert_failed',
            detail: insert.error,
            message: missing
                ? 'Inference review queue storage is not installed. Apply supabase/migrations/20260612030000_inference_review_queue_events.sql in Supabase, then reload the schema.'
                : 'Failed to record the inference review queue event.',
        }, { status: missing ? 503 : 500 });
    }

    return NextResponse.json({
        data: insert.data,
        meta: {
            inference_event_id: id,
            tenant_id: auth.actor.tenantId,
            storage_installed: true,
        },
        error: null,
    });
}

function normalizeAction(value: unknown): 'queue' | 'acknowledge' | 'resolve' | 'dismiss' | null {
    return value === 'queue' || value === 'acknowledge' || value === 'resolve' || value === 'dismiss'
        ? value
        : null;
}

function reviewStatusForAction(action: 'queue' | 'acknowledge' | 'resolve' | 'dismiss'): InferenceReviewStatus {
    if (action === 'acknowledge') return 'acknowledged';
    if (action === 'resolve') return 'resolved';
    if (action === 'dismiss') return 'dismissed';
    return 'queued';
}

function isMissingReviewQueueStorage(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('inference_review_queue_events')
        && (lower.includes('does not exist') || lower.includes('schema cache') || lower.includes('could not find'));
}
