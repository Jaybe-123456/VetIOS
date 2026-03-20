import { NextResponse } from 'next/server';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getDueLearningSchedulerJobs, seedDefaultLearningSchedulerJobs } from '@/lib/learningEngine/learningScheduler';
import { createSupabaseLearningEngineStore } from '@/lib/learningEngine/supabaseStore';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const actor = resolveRequestActor(session);
    const store = createSupabaseLearningEngineStore(getSupabaseServer());
    const jobs = await seedDefaultLearningSchedulerJobs(store, actor.tenantId);
    const dueJobs = await getDueLearningSchedulerJobs(store, actor.tenantId);

    const response = NextResponse.json({
        jobs,
        due_jobs: dueJobs,
        authenticated_user_id: actor.userId,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const actor = resolveRequestActor(session);
    const body = await safeJson<{
        id?: string;
        job_name?: string;
        cron_expression?: string;
        job_type?: string;
        enabled?: boolean;
        job_config?: Record<string, unknown>;
        next_run_at?: string | null;
    }>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    if (!body.data.job_name || !body.data.cron_expression || !body.data.job_type) {
        return NextResponse.json({ error: 'job_name, cron_expression, and job_type are required', request_id: requestId }, { status: 400 });
    }

    const store = createSupabaseLearningEngineStore(getSupabaseServer());
    const job = await store.upsertSchedulerJob({
        id: body.data.id,
        tenant_id: actor.tenantId,
        job_name: body.data.job_name,
        cron_expression: body.data.cron_expression,
        job_type: body.data.job_type,
        enabled: body.data.enabled ?? true,
        job_config: body.data.job_config ?? {},
        last_run_at: null,
        next_run_at: body.data.next_run_at ?? null,
    });

    const response = NextResponse.json({
        job,
        authenticated_user_id: actor.userId,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
