import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { listClinicalCaseImportJobs } from '@/lib/dataset/importJobs';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProbeStatus = 'installed' | 'missing' | 'error';

interface SchemaProbe {
    table: string;
    status: ProbeStatus;
    message: string | null;
}

const REQUIRED_TABLES = [
    'tenant_learning_consents',
    'tenant_learning_consent_events',
    'clinical_case_import_jobs',
    'clinical_case_import_job_events',
    'learning_dataset_versions',
    'learning_cycles',
    'learning_calibration_reports',
    'learning_benchmark_reports',
    'model_registry_entries',
] as const;

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 40, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();

    const auth = await resolveClinicalApiActor(req, { client: supabase });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { data: null, error: auth.error?.message ?? 'Unauthorized', request_id: requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    try {
        const tenantId = auth.actor.tenantId;
        const [probes, importJobsResult, versionsResult, cyclesResult, modelsResult] = await Promise.all([
            Promise.all(REQUIRED_TABLES.map((table) => probeTable(supabase, table))),
            listRecentImportJobs(supabase, tenantId),
            listRecentDatasetVersions(supabase, tenantId),
            listRecentLearningCycles(supabase, tenantId),
            listRecentModelRegistryEntries(supabase, tenantId),
        ]);

        const warnings = [
            ...importJobsResult.warnings,
            ...versionsResult.warnings,
            ...cyclesResult.warnings,
            ...modelsResult.warnings,
            ...probes
                .filter((probe) => probe.status !== 'installed')
                .map((probe) => `${probe.table}: ${probe.message ?? probe.status}`),
        ];

        const installedCount = probes.filter((probe) => probe.status === 'installed').length;
        const response = NextResponse.json({
            data: {
                ready: installedCount === probes.length,
                schema_health: {
                    required: probes.length,
                    installed: installedCount,
                    missing: probes.filter((probe) => probe.status === 'missing').length,
                    errored: probes.filter((probe) => probe.status === 'error').length,
                    probes,
                },
                recent_import_jobs: importJobsResult.items,
                recent_dataset_versions: versionsResult.items,
                recent_learning_cycles: cyclesResult.items,
                recent_model_registry_entries: modelsResult.items,
                required_migrations: [
                    'supabase/migrations/20260609010000_tenant_learning_consents_repair.sql',
                    'supabase/migrations/20260611010000_learning_dataset_infrastructure.sql',
                    'supabase/migrations/20260611011000_dataset_consent_and_import_ledgers.sql',
                ],
                warnings,
            },
            error: null,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            {
                data: null,
                error: error instanceof Error ? error.message : 'Failed to inspect dataset infrastructure.',
                request_id: requestId,
            },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function probeTable(client: SupabaseClient, table: string): Promise<SchemaProbe> {
    const { error } = await client
        .from(table)
        .select('id')
        .limit(1);

    if (!error) {
        return { table, status: 'installed', message: null };
    }

    return {
        table,
        status: isMissingTable(error) ? 'missing' : 'error',
        message: error.message ?? 'Unknown schema probe error',
    };
}

async function listRecentImportJobs(client: SupabaseClient, tenantId: string) {
    try {
        return {
            items: await listClinicalCaseImportJobs(client, tenantId, 8),
            warnings: [] as string[],
        };
    } catch (error) {
        return {
            items: [],
            warnings: [error instanceof Error ? error.message : 'Failed to list import jobs.'],
        };
    }
}

async function listRecentDatasetVersions(client: SupabaseClient, tenantId: string) {
    const { data, error } = await client
        .from('learning_dataset_versions')
        .select('id,dataset_version,dataset_kind,row_count,summary,created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(8);

    if (error) {
        return {
            items: [],
            warnings: [`learning_dataset_versions: ${error.message}`],
        };
    }

    return {
        items: (data ?? []).map((row) => ({
            id: String(row.id),
            dataset_version: readString(row.dataset_version),
            dataset_kind: readString(row.dataset_kind),
            row_count: readNumber(row.row_count) ?? 0,
            summary: asRecord(row.summary),
            created_at: readString(row.created_at),
        })),
        warnings: [] as string[],
    };
}

async function listRecentLearningCycles(client: SupabaseClient, tenantId: string) {
    const { data, error } = await client
        .from('learning_cycles')
        .select('id,cycle_type,trigger_mode,status,summary,started_at,completed_at,created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(8);

    if (error) {
        return {
            items: [],
            warnings: [`learning_cycles: ${error.message}`],
        };
    }

    return {
        items: (data ?? []).map((row) => ({
            id: String(row.id),
            cycle_type: readString(row.cycle_type),
            trigger_mode: readString(row.trigger_mode),
            status: readString(row.status),
            summary: asRecord(row.summary),
            started_at: readString(row.started_at),
            completed_at: readString(row.completed_at),
            created_at: readString(row.created_at),
        })),
        warnings: [] as string[],
    };
}

async function listRecentModelRegistryEntries(client: SupabaseClient, tenantId: string) {
    const { data, error } = await client
        .from('model_registry_entries')
        .select('id,model_name,model_version,task_type,promotion_status,is_champion,benchmark_scorecard,created_at,updated_at')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false })
        .limit(8);

    if (error) {
        return {
            items: [],
            warnings: [`model_registry_entries: ${error.message}`],
        };
    }

    return {
        items: (data ?? []).map((row) => ({
            id: String(row.id),
            model_name: readString(row.model_name),
            model_version: readString(row.model_version),
            task_type: readString(row.task_type),
            promotion_status: readString(row.promotion_status),
            is_champion: row.is_champion === true,
            benchmark_scorecard: asRecord(row.benchmark_scorecard),
            created_at: readString(row.created_at),
            updated_at: readString(row.updated_at),
        })),
        warnings: [] as string[],
    };
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return error.code === '42P01'
        || error.code === 'PGRST116'
        || message.includes('schema cache')
        || message.includes('could not find the table')
        || message.includes('does not exist');
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
