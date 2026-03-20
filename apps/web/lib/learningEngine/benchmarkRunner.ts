import { buildCalibrationReport } from '@/lib/learningEngine/calibrationEngine';
import { predictDiagnosis, computeDiagnosisMetrics } from '@/lib/learningEngine/diagnosisTrainer';
import { predictSeverity, computeSeverityMetrics } from '@/lib/learningEngine/severityTrainer';
import {
    type BenchmarkFamilyReport,
    type BenchmarkSummary,
    type CalibrationEvalRow,
    type CalibrationReport,
    type DiagnosisModelArtifact,
    type DiagnosisTrainingMetrics,
    type DiagnosisTrainingRow,
    type LearningDatasetBundle,
    type SeverityModelArtifact,
    type SeverityTrainingMetrics,
    type SeverityTrainingRow,
} from '@/lib/learningEngine/types';

export function runBenchmarkSuite(
    dataset: LearningDatasetBundle,
    models: {
        diagnosis: DiagnosisModelArtifact | null;
        severity: SeverityModelArtifact | null;
        candidateModelVersion: string;
    },
): BenchmarkSummary {
    const cleanDiagnosisRows = dataset.diagnosis_training_set.filter((row) => !row.adversarial_case);
    const lowSignalRows = dataset.diagnosis_training_set.filter((row) =>
        row.primary_condition_class === 'Undifferentiated' ||
        row.case_cluster === 'Unknown / Mixed',
    );
    const cleanSeverityRows = dataset.severity_training_set.filter((row) => !row.adversarial_case);
    const calibrationRows = dataset.calibration_eval_set;

    const diagnosisMetrics = models.diagnosis
        ? evaluateDiagnosisModel(models.diagnosis, cleanDiagnosisRows)
        : null;
    const severityMetrics = models.severity
        ? evaluateSeverityModel(models.severity, cleanSeverityRows)
        : null;
    const calibrationReport = buildCalibrationReport(calibrationRows, 'diagnosis');

    const families: BenchmarkFamilyReport[] = [
        buildDiagnosisFamilyReport(diagnosisMetrics),
        buildSeverityFamilyReport(severityMetrics),
        buildLowSignalFamilyReport(models.diagnosis, lowSignalRows),
        buildCalibrationFamilyReport(calibrationReport, calibrationRows),
        buildSubgroupFamilyReport('species_slices', diagnosisMetrics?.subgroup_performance.species, severityMetrics?.subgroup_performance.species),
        buildSubgroupFamilyReport('cluster_slices', diagnosisMetrics?.subgroup_performance.cluster, severityMetrics?.subgroup_performance.cluster),
    ].filter(Boolean) as BenchmarkFamilyReport[];

    const scorecard = {
        diagnosis_accuracy: diagnosisMetrics?.accuracy ?? 0,
        diagnosis_macro_f1: diagnosisMetrics?.macro_f1 ?? 0,
        severity_critical_recall: severityMetrics?.critical_recall ?? 0,
        severity_high_recall: severityMetrics?.high_recall ?? 0,
        severity_false_negative_rate: severityMetrics?.emergency_false_negative_rate ?? 1,
        calibration_brier: calibrationReport.brier_score ?? 1,
        calibration_ece: calibrationReport.expected_calibration_error ?? 1,
        low_signal_pass_rate: families.find((family) => family.family === 'low_signal_ambiguous')?.metrics.pass_rate as number ?? 0,
    };

    return {
        candidate_model_version: models.candidateModelVersion,
        diagnosis_metrics: diagnosisMetrics,
        severity_metrics: severityMetrics,
        calibration_report: calibrationReport,
        families,
        scorecard,
        pass: families.every((family) => family.pass),
    };
}

function evaluateDiagnosisModel(
    artifact: DiagnosisModelArtifact,
    rows: DiagnosisTrainingRow[],
): DiagnosisTrainingMetrics | null {
    if (rows.length === 0) return null;

    return computeDiagnosisMetrics(
        rows.map((row) => {
            const prediction = predictDiagnosis(artifact, row.feature_vector);
            return {
                actual: row.confirmed_diagnosis,
                predicted: prediction.top_diagnosis,
                topDifferentials: prediction.top_differentials,
                species: row.species_canonical,
                breed: row.breed,
                cluster: row.case_cluster,
            };
        }),
        'resubstitution',
    );
}

function evaluateSeverityModel(
    artifact: SeverityModelArtifact,
    rows: SeverityTrainingRow[],
): SeverityTrainingMetrics | null {
    if (rows.length === 0) return null;

    return computeSeverityMetrics(
        rows.map((row) => ({
            actualSeverity: row.severity_score,
            actualEmergency: row.emergency_level,
            species: row.species_canonical,
            cluster: row.feature_vector.dense_features.case_cluster as string | null,
            predicted: predictSeverity(artifact, row.feature_vector),
        })),
        'resubstitution',
    );
}

function buildDiagnosisFamilyReport(
    metrics: DiagnosisTrainingMetrics | null,
): BenchmarkFamilyReport {
    if (!metrics) {
        return {
            family: 'clean_labeled_diagnosis',
            task_type: 'diagnosis',
            support: 0,
            pass: false,
            metrics: { status: 'insufficient_data' },
            regressions: ['No clean labeled diagnosis rows were available.'],
        };
    }

    const regressions: string[] = [];
    if (metrics.accuracy < 0.55) {
        regressions.push('Diagnosis accuracy is below the minimum acceptable threshold.');
    }
    if (metrics.macro_f1 < 0.45) {
        regressions.push('Diagnosis macro F1 is below the minimum acceptable threshold.');
    }
    if (metrics.top_3_accuracy < 0.8) {
        regressions.push('Top-3 diagnosis accuracy is below the minimum acceptable threshold.');
    }

    return {
        family: 'clean_labeled_diagnosis',
        task_type: 'diagnosis',
        support: metrics.support,
        pass: regressions.length === 0,
        metrics: {
            accuracy: metrics.accuracy,
            macro_f1: metrics.macro_f1,
            top_3_accuracy: metrics.top_3_accuracy,
        },
        regressions,
    };
}

function buildSeverityFamilyReport(
    metrics: SeverityTrainingMetrics | null,
): BenchmarkFamilyReport {
    if (!metrics) {
        return {
            family: 'clean_severity_cases',
            task_type: 'severity',
            support: 0,
            pass: false,
            metrics: { status: 'insufficient_data' },
            regressions: ['No clean severity rows were available.'],
        };
    }

    const regressions: string[] = [];
    if (metrics.critical_recall < 0.9) {
        regressions.push('Critical-case recall is below the minimum safety threshold.');
    }
    if (metrics.high_recall < 0.8) {
        regressions.push('High-acuity recall is below the minimum safety threshold.');
    }
    if (metrics.emergency_false_negative_rate > 0.1) {
        regressions.push('Emergency false-negative rate is too high.');
    }

    return {
        family: 'clean_severity_cases',
        task_type: 'severity',
        support: metrics.support,
        pass: regressions.length === 0,
        metrics: {
            emergency_accuracy: metrics.emergency_accuracy,
            severity_mae: metrics.severity_mae,
            severity_rmse: metrics.severity_rmse,
            critical_recall: metrics.critical_recall,
            high_recall: metrics.high_recall,
            emergency_false_negative_rate: metrics.emergency_false_negative_rate,
        },
        regressions,
    };
}

function buildLowSignalFamilyReport(
    artifact: DiagnosisModelArtifact | null,
    rows: DiagnosisTrainingRow[],
): BenchmarkFamilyReport {
    if (!artifact || rows.length === 0) {
        return {
            family: 'low_signal_ambiguous',
            task_type: 'safety',
            support: rows.length,
            pass: rows.length === 0,
            metrics: { pass_rate: rows.length === 0 ? 1 : 0 },
            regressions: rows.length === 0 ? [] : ['Low-signal cases exist but no diagnosis model was available for evaluation.'],
        };
    }

    let safeBehaviorCount = 0;
    for (const row of rows) {
        const prediction = predictDiagnosis(artifact, row.feature_vector);
        const confidence = prediction.confidence ?? 0;
        if (
            prediction.abstain ||
            prediction.primary_condition_class === 'Undifferentiated' ||
            confidence <= 0.55
        ) {
            safeBehaviorCount += 1;
        }
    }

    const passRate = round(safeBehaviorCount / Math.max(rows.length, 1));
    const regressions = passRate < 0.75
        ? ['Low-signal ambiguous cases are not triggering conservative behavior often enough.']
        : [];

    return {
        family: 'low_signal_ambiguous',
        task_type: 'safety',
        support: rows.length,
        pass: regressions.length === 0,
        metrics: {
            pass_rate: passRate,
            safe_behavior_count: safeBehaviorCount,
        },
        regressions,
    };
}

function buildCalibrationFamilyReport(
    report: CalibrationReport,
    rows: CalibrationEvalRow[],
): BenchmarkFamilyReport {
    const regressions: string[] = [];
    if (report.recommendation.status === 'needs_recalibration') {
        regressions.push('Calibration report requires post-hoc recalibration before promotion.');
    }
    if (report.expected_calibration_error != null && report.expected_calibration_error > 0.12) {
        regressions.push('Expected calibration error is above the promotion threshold.');
    }

    return {
        family: 'calibration_evaluation',
        task_type: 'diagnosis',
        support: rows.length,
        pass: regressions.length === 0,
        metrics: {
            brier_score: report.brier_score,
            expected_calibration_error: report.expected_calibration_error,
            recommendation_status: report.recommendation.status,
            recommended_method: report.recommendation.recommended_method,
        },
        regressions,
    };
}

function buildSubgroupFamilyReport(
    family: string,
    diagnosisGroups?: DiagnosisTrainingMetrics['subgroup_performance']['species'] | null,
    severityGroups?: SeverityTrainingMetrics['subgroup_performance']['species'] | null,
): BenchmarkFamilyReport {
    const subgroupRows = [...(diagnosisGroups ?? []), ...(severityGroups ?? [])];
    const regressions = subgroupRows
        .filter((row) => row.support >= 3 && (row.accuracy < 0.35 || (row.critical_recall != null && row.critical_recall < 0.7)))
        .map((row) => `Subgroup ${row.group} regressed below the robustness threshold.`);

    return {
        family,
        task_type: 'safety',
        support: subgroupRows.reduce((sum, row) => sum + row.support, 0),
        pass: regressions.length === 0,
        metrics: {
            subgroup_count: subgroupRows.length,
            worst_accuracy: subgroupRows.length > 0
                ? Math.min(...subgroupRows.map((row) => row.accuracy))
                : null,
        },
        regressions,
    };
}

function round(value: number): number {
    return Number(value.toFixed(4));
}
