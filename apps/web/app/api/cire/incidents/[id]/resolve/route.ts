import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { resolveCireIncident } from '@/lib/cire/engine';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
    req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const params = await context.params;
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const requestedTenantId = new URL(req.url).searchParams.get('tenant_id');
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['inference:write'],
            requestedTenantId: requestedTenantId ?? undefined,
        });
        const resolvedTenantId = tenantId ?? actor.tenantId;
        if (!resolvedTenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required.');
        }

        const parsed = await safeJson<{
            resolved_by?: string | null;
            resolution_notes?: string | null;
            override_action?: boolean;
        }>(req);
        if (!parsed.ok) {
            return NextResponse.json({
                data: null,
                meta: {
                    tenant_id: resolvedTenantId,
                    timestamp: new Date().toISOString(),
                    request_id: requestId,
                },
                error: {
                    code: 'invalid_body',
                    message: parsed.error,
                },
            }, { status: 400 });
        }

        const incident = await resolveCireIncident(supabase, {
            tenantId: resolvedTenantId,
            incidentId: params.id,
            resolvedBy: parsed.data.resolved_by ?? actor.userId,
            resolutionNotes: parsed.data.resolution_notes ?? null,
            overrideAction: parsed.data.override_action === true,
        });

        const response = NextResponse.json({
            data: incident,
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
                    code: error instanceof PlatformAuthError ? error.code : 'cire_incident_resolve_failed',
                    message: error instanceof Error ? error.message : 'Failed to resolve CIRE incident.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
