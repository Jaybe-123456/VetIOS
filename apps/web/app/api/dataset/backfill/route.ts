import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
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

    try {
        const result = await backfillTenantClinicalCaseLearningState(
            getSupabaseServer(),
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
