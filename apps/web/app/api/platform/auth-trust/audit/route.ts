import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
} from '@/lib/auth/authorization';
import { buildHighRiskRouteAuditSnapshot } from '@/lib/auth/highRiskRouteAudit';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 }),
            requestId,
            startTime,
        );
    }

    const client = getSupabaseServer();
    const context = session
        ? buildRouteAuthorizationContext({
            ...resolveRequestActor(session),
            authMode: 'session',
            user: (await session.supabase.auth.getUser()).data.user ?? null,
        })
        : buildRouteAuthorizationContext({
            tenantId: process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
            userId: process.env.VETIOS_DEV_USER_ID ?? null,
            authMode: 'dev_bypass',
            user: null,
        });

    if (context.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: 'api/platform/auth-trust/audit:GET',
            requirement: 'admin',
        });
    }

    const snapshot = buildHighRiskRouteAuditSnapshot();
    return withHeaders(
        NextResponse.json({
            audit: snapshot,
            production_ready: snapshot.missingSurfaces.length === 0,
            request_id: requestId,
        }),
        requestId,
        startTime,
    );
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
