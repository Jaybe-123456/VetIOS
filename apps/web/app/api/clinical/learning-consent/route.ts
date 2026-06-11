import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { formatZodErrors } from '@/lib/http/schemas';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    listTenantLearningConsents,
    upsertTenantLearningConsent,
    type LearningConsentScope,
} from '@/lib/learning/consent';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ConsentScopeSchema = z.enum(['deidentified_training', 'network_learning', 'population_signal']);
const ConsentBodySchema = z.object({
    consent_scope: ConsentScopeSchema,
    status: z.enum(['granted', 'revoked']),
    consent_version: z.string().min(1).optional(),
    policy_snapshot: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['outcome:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { data: null, error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    try {
        const scope = parseScope(new URL(req.url).searchParams.get('scope'));
        const consents = await listTenantLearningConsents(supabase, auth.actor.tenantId, scope);
        const response = NextResponse.json({
            data: {
                consents,
                tenant_id: auth.actor.tenantId,
            },
            error: null,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        return NextResponse.json(
            {
                data: null,
                error: 'learning_consent_list_failed',
                detail: error instanceof Error ? error.message : 'Failed to read learning consent status.',
                request_id: requestId,
            },
            { status: 500 },
        );
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['outcome:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { data: null, error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        return NextResponse.json({ data: null, error: parsedJson.error, request_id: requestId }, { status: 400 });
    }

    const parsed = ConsentBodySchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        return NextResponse.json(
            { data: null, error: 'invalid_input', detail: formatZodErrors(parsed.error), request_id: requestId },
            { status: 400 },
        );
    }

    try {
        const consent = await upsertTenantLearningConsent(supabase, {
            tenantId: auth.actor.tenantId,
            actorUserId: auth.actor.userId,
            actorMode: auth.actor.authMode,
            consentScope: parsed.data.consent_scope,
            status: parsed.data.status,
            consentVersion: parsed.data.consent_version,
            requestId,
            eventSource: 'clinical_dataset_network_learning_panel',
            policySnapshot: {
                source: 'clinical_dataset_network_learning_panel',
                actor_mode: auth.actor.authMode,
                recorded_at: new Date().toISOString(),
                ...parsed.data.policy_snapshot,
            },
        });
        const consents = await listTenantLearningConsents(supabase, auth.actor.tenantId);
        const response = NextResponse.json({
            data: {
                consent,
                consents,
                tenant_id: auth.actor.tenantId,
            },
            error: null,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        return NextResponse.json(
            {
                data: null,
                error: 'learning_consent_update_failed',
                detail: error instanceof Error ? error.message : 'Failed to update learning consent.',
                request_id: requestId,
            },
            { status: 500 },
        );
    }
}

function parseScope(value: string | null): LearningConsentScope | null {
    return value === 'deidentified_training' || value === 'network_learning' || value === 'population_signal'
        ? value
        : null;
}
