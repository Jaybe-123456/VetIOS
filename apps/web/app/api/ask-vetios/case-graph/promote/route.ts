import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    ASK_VETIOS_CASE_GRAPH_PROMOTION_STATUSES,
    ASK_VETIOS_CLINICIAN_CONFIRMATION_STATUSES,
    ASK_VETIOS_OUTCOME_LINKAGE_STATUSES,
    ASK_VETIOS_VALUE_CAPTURE_STATUSES,
    aggregateAskVetiosCaseGraphPromotionEvents,
    buildAskVetiosCaseGraphPromotionAssessment,
    normalizePromotionReviewerRef,
    type AskVetiosCaseGraphPromotionEventRow,
} from '@/lib/askVetios/caseGraphPromotion';
import { apiGuard } from '@/lib/http/apiGuard';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JsonRecordSchema = z.record(z.string(), z.unknown()).default({});

const CaseGraphPromotionSchema = z.object({
    request_id: z.string().uuid(),
    ask_vetios_query_id: z.string().uuid().optional(),
    clinical_case_id: z.string().uuid().optional(),
    clinical_outcome_id: z.string().uuid().optional(),
    specialist_review_event_id: z.string().uuid().optional(),
    draft_key: z.string().max(128).optional(),
    case_graph_status: z.enum(['non_clinical', 'draft', 'ready_for_case_graph']).default('draft'),
    clinician_confirmation_status: z.enum(ASK_VETIOS_CLINICIAN_CONFIRMATION_STATUSES).default('not_reviewed'),
    readiness_score: z.number().min(0).max(100).default(0),
    field_coverage: JsonRecordSchema,
    promoted_fields: z.array(z.string().min(1).max(96)).max(100).default([]),
    missing_fields: z.array(z.string().min(1).max(96)).max(100).default([]),
    deidentified_case_graph_snapshot: JsonRecordSchema,
    review_evidence: JsonRecordSchema,
    reviewer_ref: z.string().max(160).optional(),
    observed_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const client = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client,
        requiredScopes: ['outcome:write'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = CaseGraphPromotionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const body = parsed.data;
    const assessment = buildAskVetiosCaseGraphPromotionAssessment({
        ask_vetios_query_id: body.ask_vetios_query_id ?? null,
        clinical_case_id: body.clinical_case_id ?? null,
        clinical_outcome_id: body.clinical_outcome_id ?? null,
        specialist_review_event_id: body.specialist_review_event_id ?? null,
        draft_key: body.draft_key ?? null,
        case_graph_status: body.case_graph_status,
        clinician_confirmation_status: body.clinician_confirmation_status,
        readiness_score: body.readiness_score,
        field_coverage: body.field_coverage,
        promoted_fields: body.promoted_fields,
        missing_fields: body.missing_fields,
        deidentified_case_graph_snapshot: body.deidentified_case_graph_snapshot,
        review_evidence: body.review_evidence,
    });

    const payload = {
        tenant_id: auth.actor.tenantId,
        request_id: body.request_id,
        ask_vetios_query_id: body.ask_vetios_query_id ?? null,
        clinical_case_id: body.clinical_case_id ?? null,
        clinical_outcome_id: body.clinical_outcome_id ?? null,
        specialist_review_event_id: body.specialist_review_event_id ?? null,
        draft_key: normalizeOptionalText(body.draft_key),
        case_graph_status: body.case_graph_status,
        promotion_status: assessment.promotion_status,
        clinician_confirmation_status: body.clinician_confirmation_status,
        outcome_linkage_status: assessment.outcome_linkage_status,
        value_capture_status: assessment.value_capture_status,
        readiness_score: assessment.readiness_score,
        field_coverage: body.field_coverage,
        promoted_fields: assessment.promoted_fields,
        missing_fields: assessment.missing_fields,
        provenance_hash: assessment.provenance_hash,
        deidentified_case_graph_snapshot: body.deidentified_case_graph_snapshot,
        review_evidence: body.review_evidence,
        reviewer_ref: normalizePromotionReviewerRef(body.reviewer_ref),
        next_required_action: assessment.next_required_action,
        observed_at: body.observed_at ?? new Date().toISOString(),
    };

    const { data, error } = await client
        .from('ask_vetios_case_graph_promotion_events')
        .insert(payload)
        .select('id, promotion_status, outcome_linkage_status, value_capture_status, next_required_action')
        .single();

    if (error) {
        if (error.code === '23505') {
            const cached = await loadCachedPromotionEvent(client, auth.actor.tenantId, body.request_id);
            if (cached) return NextResponse.json({ ...cached, cached: true, de_identified: true, error: null });
        }
        return NextResponse.json(
            { error: 'case_graph_promotion_event_store_failed', detail: error.message },
            { status: 503 },
        );
    }

    return NextResponse.json({
        promotion_event_id: String(data.id),
        promotion_status: normalizeEnumValue(data.promotion_status, ASK_VETIOS_CASE_GRAPH_PROMOTION_STATUSES, assessment.promotion_status),
        outcome_linkage_status: normalizeEnumValue(data.outcome_linkage_status, ASK_VETIOS_OUTCOME_LINKAGE_STATUSES, assessment.outcome_linkage_status),
        value_capture_status: normalizeEnumValue(data.value_capture_status, ASK_VETIOS_VALUE_CAPTURE_STATUSES, assessment.value_capture_status),
        next_required_action: normalizeOptionalText(data.next_required_action),
        cached: false,
        de_identified: true,
        error: null,
    });
}

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const client = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client,
        requiredScopes: ['evaluation:read'],
    });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sinceDays = clampDays(Number(searchParams.get('days') ?? 90));
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    const promotionStatus = normalizeEnumQuery(searchParams.get('promotion_status'), ASK_VETIOS_CASE_GRAPH_PROMOTION_STATUSES);

    let query = client
        .from('ask_vetios_case_graph_promotion_events')
        .select('promotion_status, clinician_confirmation_status, outcome_linkage_status, value_capture_status, readiness_score, missing_fields, observed_at, created_at')
        .eq('tenant_id', auth.actor.tenantId)
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .limit(10_000);

    if (promotionStatus) query = query.eq('promotion_status', promotionStatus);

    const { data, error } = await query;
    if (error) {
        return NextResponse.json({ error: 'case_graph_promotion_data_unavailable' }, { status: 503 });
    }

    const rows = (Array.isArray(data) ? data : []) as AskVetiosCaseGraphPromotionEventRow[];
    return NextResponse.json({
        period: `last_${sinceDays}_days`,
        aggregate: aggregateAskVetiosCaseGraphPromotionEvents(rows),
        de_identified: true,
        error: null,
    });
}

async function loadCachedPromotionEvent(
    client: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
) {
    const { data } = await client
        .from('ask_vetios_case_graph_promotion_events')
        .select('id, promotion_status, outcome_linkage_status, value_capture_status, next_required_action')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();

    if (!data?.id) return null;
    return {
        promotion_event_id: String(data.id),
        promotion_status: normalizeEnumValue(data.promotion_status, ASK_VETIOS_CASE_GRAPH_PROMOTION_STATUSES, 'review_required'),
        outcome_linkage_status: normalizeEnumValue(data.outcome_linkage_status, ASK_VETIOS_OUTCOME_LINKAGE_STATUSES, 'not_linked'),
        value_capture_status: normalizeEnumValue(data.value_capture_status, ASK_VETIOS_VALUE_CAPTURE_STATUSES, 'foundation'),
        next_required_action: normalizeOptionalText(data.next_required_action),
    };
}

function normalizeEnumQuery<const T extends readonly string[]>(value: string | null, allowed: T): T[number] | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    return (allowed as readonly string[]).includes(normalized) ? normalized as T[number] : null;
}

function normalizeEnumValue<const T extends readonly string[]>(
    value: unknown,
    allowed: T,
    fallback: T[number],
): T[number] {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? value as T[number]
        : fallback;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function clampDays(value: number): number {
    if (!Number.isFinite(value)) return 90;
    return Math.min(365, Math.max(1, Math.round(value)));
}
