import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { resolvePublicCatalogTenant, type PublicCatalogSource } from '@/lib/platform/publicTenant';

export interface PublicNetworkLearningSnapshot {
    configured: boolean;
    source: PublicCatalogSource;
    tenant_id: string | null;
    generated_at: string;
    summary: {
        dataset_versions: number;
        total_dataset_rows: number;
        benchmark_reports: number;
        calibration_reports: number;
        audit_events: number;
        latest_dataset_version: string | null;
        latest_benchmark_pass_status: string | null;
        latest_calibration_ece: number | null;
    };
    recent_datasets: Array<{
        dataset_version: string;
        dataset_kind: string;
        row_count: number;
        created_at: string;
    }>;
    recent_benchmarks: Array<{
        benchmark_family: string;
        task_type: string;
        summary_score: number | null;
        pass_status: string;
        created_at: string;
    }>;
    recent_calibrations: Array<{
        task_type: string;
        ece_score: number | null;
        brier_score: number | null;
        created_at: string;
    }>;
    recent_audit_events: Array<{
        event_type: string;
        created_at: string;
    }>;
}

export async function getPublicNetworkLearningSnapshot(): Promise<PublicNetworkLearningSnapshot> {
    const target = await resolvePublicCatalogTenant();
    const generatedAt = new Date().toISOString();

    if (!target.tenantId) {
        return {
            configured: false,
            source: target.source,
            tenant_id: null,
            generated_at: generatedAt,
            summary: {
                dataset_versions: 0,
                total_dataset_rows: 0,
                benchmark_reports: 0,
                calibration_reports: 0,
                audit_events: 0,
                latest_dataset_version: null,
                latest_benchmark_pass_status: null,
                latest_calibration_ece: null,
            },
            recent_datasets: [],
            recent_benchmarks: [],
            recent_calibrations: [],
            recent_audit_events: [],
        };
    }

    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const [datasets, benchmarks, calibrations, audits] = await Promise.all([
        store.listLearningDatasetVersions(target.tenantId, 12),
        store.listLearningBenchmarkReports(target.tenantId, 12),
        store.listLearningCalibrationReports(target.tenantId, 12),
        store.listLearningAuditEvents(target.tenantId, 12),
    ]);

    return {
        configured: true,
        source: target.source,
        tenant_id: target.tenantId,
        generated_at: generatedAt,
        summary: {
            dataset_versions: datasets.length,
            total_dataset_rows: datasets.reduce((sum, row) => sum + row.row_count, 0),
            benchmark_reports: benchmarks.length,
            calibration_reports: calibrations.length,
            audit_events: audits.length,
            latest_dataset_version: datasets[0]?.dataset_version ?? null,
            latest_benchmark_pass_status: benchmarks[0]?.pass_status ?? null,
            latest_calibration_ece: calibrations[0]?.ece_score ?? null,
        },
        recent_datasets: datasets.map((row) => ({
            dataset_version: row.dataset_version,
            dataset_kind: row.dataset_kind,
            row_count: row.row_count,
            created_at: row.created_at,
        })),
        recent_benchmarks: benchmarks.map((row) => ({
            benchmark_family: row.benchmark_family,
            task_type: row.task_type,
            summary_score: row.summary_score,
            pass_status: row.pass_status,
            created_at: row.created_at,
        })),
        recent_calibrations: calibrations.map((row) => ({
            task_type: row.task_type,
            ece_score: row.ece_score,
            brier_score: row.brier_score,
            created_at: row.created_at,
        })),
        recent_audit_events: audits.map((row) => ({
            event_type: row.event_type,
            created_at: row.created_at,
        })),
    };
}
