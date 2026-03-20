import {
    type LearningEngineStore,
    type LearningSchedulerJobRecord,
} from '@/lib/learningEngine/types';

export async function seedDefaultLearningSchedulerJobs(
    store: LearningEngineStore,
    tenantId: string,
    now = new Date(),
): Promise<LearningSchedulerJobRecord[]> {
    const defaults = [
        {
            job_name: 'daily_dataset_refresh',
            cron_expression: '0 2 * * *',
            job_type: 'daily_dataset_refresh',
            enabled: true,
            job_config: { cycle_type: 'daily_dataset_refresh', trigger_mode: 'scheduled' },
        },
        {
            job_name: 'daily_calibration_update',
            cron_expression: '30 2 * * *',
            job_type: 'daily_calibration_update',
            enabled: true,
            job_config: { cycle_type: 'daily_calibration_update', trigger_mode: 'scheduled' },
        },
        {
            job_name: 'weekly_candidate_training',
            cron_expression: '0 3 * * 1',
            job_type: 'weekly_candidate_training',
            enabled: true,
            job_config: { cycle_type: 'weekly_candidate_training', trigger_mode: 'scheduled' },
        },
        {
            job_name: 'weekly_benchmark_run',
            cron_expression: '30 3 * * 1',
            job_type: 'weekly_benchmark_run',
            enabled: true,
            job_config: { cycle_type: 'weekly_benchmark_run', trigger_mode: 'scheduled' },
        },
    ];

    const existing = await store.listSchedulerJobs(tenantId);
    const byName = new Map(existing.map((job) => [job.job_name, job]));

    const jobs: LearningSchedulerJobRecord[] = [];
    for (const job of defaults) {
        const existingJob = byName.get(job.job_name);
        jobs.push(await store.upsertSchedulerJob({
            id: existingJob?.id,
            tenant_id: tenantId,
            job_name: job.job_name,
            cron_expression: job.cron_expression,
            job_type: job.job_type,
            enabled: existingJob?.enabled ?? job.enabled,
            job_config: existingJob?.job_config ?? job.job_config,
            last_run_at: existingJob?.last_run_at ?? null,
            next_run_at: existingJob?.next_run_at ?? computeNextRun(job.job_type, now),
        }));
    }

    return jobs;
}

export async function getDueLearningSchedulerJobs(
    store: LearningEngineStore,
    tenantId: string,
    now = new Date(),
): Promise<LearningSchedulerJobRecord[]> {
    const jobs = await store.listSchedulerJobs(tenantId);
    return jobs.filter((job) =>
        job.enabled &&
        job.next_run_at != null &&
        new Date(job.next_run_at).getTime() <= now.getTime(),
    );
}

export async function markLearningSchedulerJobRun(
    store: LearningEngineStore,
    job: LearningSchedulerJobRecord,
    executedAt = new Date(),
): Promise<LearningSchedulerJobRecord> {
    return store.upsertSchedulerJob({
        id: job.id,
        tenant_id: job.tenant_id,
        job_name: job.job_name,
        cron_expression: job.cron_expression,
        job_type: job.job_type,
        enabled: job.enabled,
        job_config: job.job_config,
        last_run_at: executedAt.toISOString(),
        next_run_at: computeNextRun(job.job_type, executedAt),
    });
}

function computeNextRun(jobType: string, now: Date): string {
    const next = new Date(now);
    switch (jobType) {
        case 'daily_dataset_refresh':
        case 'daily_calibration_update':
            next.setUTCDate(next.getUTCDate() + 1);
            break;
        default:
            next.setUTCDate(next.getUTCDate() + 7);
            break;
    }
    return next.toISOString();
}
