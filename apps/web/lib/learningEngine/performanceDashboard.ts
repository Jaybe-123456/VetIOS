import { buildLearningDatasetBundle, type DatasetBuilderConfig } from '@/lib/learningEngine/datasetBuilder';
import {
    type LearningDashboardSnapshot,
    type LearningEngineStore,
} from '@/lib/learningEngine/types';

export async function getLearningDashboardSnapshot(
    store: LearningEngineStore,
    input: {
        tenantId: string;
        datasetFilters?: Partial<DatasetBuilderConfig>;
    },
): Promise<LearningDashboardSnapshot> {
    const dataset = await buildLearningDatasetBundle(store, {
        tenantId: input.tenantId,
        includeAdversarial: true,
        includeSynthetic: true,
        includeQuarantine: true,
        ...input.datasetFilters,
    });

    const [cycles, registryEntries, benchmarks, calibrationReports, rollbackHistory] = await Promise.all([
        store.listLearningCycles(input.tenantId, 10),
        store.listModelRegistryEntries(input.tenantId),
        store.listBenchmarkReports(input.tenantId, 20),
        store.listCalibrationReports(input.tenantId, 20),
        store.listRollbackEvents(input.tenantId, 20),
    ]);

    const liveCases = dataset.summary.total_cases - dataset.summary.quarantined_cases;

    return {
        tenant_id: input.tenantId,
        dataset_summary: dataset.summary,
        latest_cycles: cycles,
        champion_models: registryEntries.filter((entry) => entry.is_champion),
        challenger_models: registryEntries.filter((entry) => !entry.is_champion && entry.promotion_status === 'challenger'),
        recent_benchmarks: benchmarks,
        recent_calibration_reports: calibrationReports,
        rollback_history: rollbackHistory,
        coverage_metrics: {
            label_coverage_pct: percentage(dataset.summary.diagnosis_training_cases, liveCases),
            calibration_readiness_pct: percentage(dataset.summary.calibration_eval_cases, liveCases),
            adversarial_coverage_pct: percentage(dataset.summary.adversarial_cases, liveCases),
            severity_coverage_pct: percentage(dataset.summary.severity_training_cases, liveCases),
        },
    };
}

function percentage(value: number, total: number): number {
    if (total <= 0) return 0;
    return Number(((value / total) * 100).toFixed(1));
}
