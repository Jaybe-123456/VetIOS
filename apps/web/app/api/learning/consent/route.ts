import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { safeJson } from '@/lib/http/safeJson';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import {
    listTenantLearningConsents,
    upsertTenantLearningConsent,
    type LearningConsentScope,
} from '@/lib/learning/consent';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';

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
    const url = new URL(req.url);

    try {
        const requestedTenantId = url.searchParams.get('tenant_id');
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:read'],
            requestedTenantId: requestedTenantId ?? undefined,
        });
        const resolvedTenantId = tenantId ?? actor.tenantId;
        if (!resolvedTenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required.');
        }

        const scope = parseScope(url.searchParams.get('scope'));
        const consents = await listTenantLearningConsents(supabase, resolvedTenantId, scope);
        const response = NextResponse.json({
            data: { consents },
            meta: {
                tenant_id: resolvedTenantId,
                timestamp: new Date().toISOString(),
                request_id: requestId,
            },
            error: null,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        return errorResponse(error, requestId, startTime, 'learning_consent_list_failed');
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const parsedJson = await safeJson(req);
        if (!parsedJson.ok) {
            return NextResponse.json({ error: 'invalid_input', detail: parsedJson.error, request_id: requestId }, { status: 400 });
        }

        const parsed = ConsentBodySchema.safeParse(parsedJson.data);
        if (!parsed.success) {
            return NextResponse.json({ error: 'invalid_input', detail: formatZodErrors(parsed.error), request_id: requestId }, { status: 400 });
        }

        const requestedTenantId = new URL(req.url).searchParams.get('tenant_id');
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['outcome:write'],
            requestedTenantId: requestedTenantId ?? undefined,
        });
        const resolvedTenantId = tenantId ?? actor.tenantId;
        if (!resolvedTenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required.');
        }

        const consent = await upsertTenantLearningConsent(supabase, {
            tenantId: resolvedTenantId,
            actorUserId: actor.userId,
            consentScope: parsed.data.consent_scope,
            status: parsed.data.status,
            consentVersion: parsed.data.consent_version,
            policySnapshot: parsed.data.policy_snapshot,
        });
        const consents = await listTenantLearningConsents(supabase, resolvedTenantId);
        const response = NextResponse.json({
            data: { consent, consents },
            meta: {
                tenant_id: resolvedTenantId,
                timestamp: new Date().toISOString(),
                request_id: requestId,
            },
            error: null,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        return errorResponse(error, requestId, startTime, 'learning_consent_update_failed');
    }
}

function parseScope(value: string | null): LearningConsentScope | null {
    return value === 'deidentified_training' || value === 'network_learning' || value === 'population_signal'
        ? value
        : null;
}

function formatZodErrors(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}

function errorResponse(error: unknown, requestId: string, startTime: number, fallbackCode: string) {
    const response = error instanceof PlatformRateLimitError
        ? NextResponse.json({
            data: buildRateLimitErrorPayload(error),
            meta: {
                tenant_id: error.tenantId,
                timestamp: new Date().toISOString(),
                request_id: requestId,
            },
            error: {
                code: error.code,
                message: error.message,
            },
        }, { status: error.status })
        : NextResponse.json({
            data: null,
            meta: {
                tenant_id: null,
                timestamp: new Date().toISOString(),
                request_id: requestId,
            },
            error: {
                code: error instanceof PlatformAuthError ? error.code : fallbackCode,
                message: error instanceof Error ? error.message : 'Failed to update learning consent.',
            },
        }, { status: error instanceof PlatformAuthError ? error.status : 500 });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
