import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
} from '@/lib/auth/authorization';
import { resolveSessionTenant, getSupabaseServer } from '@/lib/supabaseServer';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { backfillTenantClinicalCaseLearningState } from '@/lib/clinicalCases/clinicalCaseBackfill';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 5, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 },
        );
    }

    const { tenantId, userId } = resolveRequestActor(session);
    const adminClient = getSupabaseServer();
    const user = session ? (await session.supabase.auth.getUser()).data.user ?? null : null;
    const authContext = buildRouteAuthorizationContext({
        tenantId,
        userId,
        authMode: session ? 'session' : 'dev_bypass',
        user,
    });
    if (!isRouteAuthorizationGranted(authContext, 'run_debug_tools')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: 'api/dataset/backfill:POST',
            requirement: 'run_debug_tools',
        });
    }

    try {
        const result = await backfillTenantClinicalCaseLearningState(
            adminClient,
            tenantId,
        );
        const response = NextResponse.json({
            ...result,
            authenticated_user_id: userId,
            request_id: requestId,
        });
        revalidatePath('/dataset');
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] POST /api/dataset/backfill Error:`, error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: message, request_id: requestId },
            { status: 500 },
        );
    }
}
