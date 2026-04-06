import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { buildRateLimitErrorPayload, PlatformRateLimitError, requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError, resolveActorTenant } from '@/lib/platform/tenantContext';
import { deleteWebhookSubscription } from '@/lib/platform/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
    req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    try {
        const params = await context.params;
        const { actor } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['evaluation:write'],
        });
        const tenantId = resolveActorTenant(actor, new URL(req.url).searchParams.get('tenant_id'));

        if (!tenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required to delete a webhook.');
        }

        const deleted = await deleteWebhookSubscription(supabase, tenantId, params.id);
        const response = NextResponse.json({
            data: deleted,
            meta: {
                tenant_id: tenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-05',
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
                    version: '2026-04-05',
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
                    version: '2026-04-05',
                    request_id: requestId,
                },
                error: {
                    code: error instanceof PlatformAuthError ? error.code : 'webhook_delete_failed',
                    message: error instanceof Error ? error.message : 'Failed to delete webhook.',
                },
            }, { status: error instanceof PlatformAuthError ? error.status : 500 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
