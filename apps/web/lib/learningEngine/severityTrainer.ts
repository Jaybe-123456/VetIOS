import { createHash } from 'crypto';
import {
    type SeverityModelArtifact,
    type SeverityPrediction,
    type SeverityTrainingMetrics,
    type SeverityTrainingRow,
    type SubgroupMetric,
} from '@/lib/learningEngine/types';

const EMERGENCY_THRESHOLDS = [
    { level: 'CRITICAL', min: 0.85 },
    { level: 'HIGH', min: 0.6 },
    { level: 'MODERATE', min: 0.3 },
    { level: 'LOW', min: 0 },
] as const;

const HIGH_RISK_SYMPTOMS = new Map<string, number>([
    ['collapse', 0.22],
    ['dyspnea', 0.2],
    ['abdominal_distension', 0.18],
    ['retching_unproductive', 0.18],
    ['pale_mucous_membranes', 0.16],
    ['tachycardia', 0.14],
    ['myoclonus', 0.12],
]);

export function trainSeverityModel(
    rows: SeverityTrainingRow[],
    input: {
        modelName?: string;
        datasetVersion: string;
        featureSchemaVersion: string;
        labelPolicyVersion: string;
        evalRatio?: number;
    },
): { artifact: SeverityModelArtifact; metrics: SeverityTrainingMetrics } {
    if (rows.length === 0) {
        throw new Error('Severity trainer requires at least one labeled training row.');
    }

    const split = splitRows(rows, input.evalRatio ?? 0.2);
    const artifact = fitSeverityArtifact(split.train, {
        modelName: input.modelName ?? 'vetios_severity_risk_regression',
        datasetVersion: input.datasetVersion,
        featureSchemaVersion: input.featureSchemaVersion,
        labelPolicyVersion: input.labelPolicyVersion,
    });
    const evaluationRows = split.eval.length > 0 ? split.eval : split.train;

    return {
        artifact,
        metrics: computeSeverityMetrics(
            evaluationRows.map((row) => ({
                actualSeverity: row.severity_score,
                actualEmergency: row.emergency_level,
                species: row.species_canonical,
                cluster: row.feature_vector.dense_features.case_cluster as string | null,
                predicted: predictSeverity(artifact, row.feature_vector),
            })),
            split.evaluationMode,
        ),
    };
}

export function fitSeverityArtifact(
    rows: SeverityTrainingRow[],
    input: {
        modelName: string;
        datasetVersion: string;
        featureSchemaVersion: string;
        labelPolicyVersion: string;
    },
): SeverityModelArtifact {
    const averageSeverity = rows.reduce((sum, row) => sum + (row.severity_score * row.label_weight), 0)
        / rows.reduce((sum, row) => sum + row.label_weight, 0);
    const symptomRiskWeights: Record<string, number> = {};
    const symptomCounts: Record<string, number> = {};
    const conditionClassWeights: Record<string, number> = {};
    const classCounts: Record<string, number> = {};
    const clusterWeights: Record<string, number> = {};
    const clusterCounts: Record<string, number> = {};
    const emergencyDistributionByClass: Record<string, Record<string, number>> = {};

    for (const row of rows) {
        const conditionClass = (row.feature_vector.dense_features.primary_condition_class as string | null) ?? 'Unknown';
        conditionClassWeights[conditionClass] = (conditionClassWeights[conditionClass] ?? 0) + (row.severity_score * row.label_weight);
        classCounts[conditionClass] = (classCounts[conditionClass] ?? 0) + row.label_weight;
        emergencyDistributionByClass[conditionClass] ??= {};
        emergencyDistributionByClass[conditionClass][row.emergency_level] =
            (emergencyDistributionByClass[conditionClass][row.emergency_level] ?? 0) + row.label_weight;

        const cluster = (row.feature_vector.dense_features.case_cluster as string | null) ?? 'Unknown';
        clusterWeights[cluster] = (clusterWeights[cluster] ?? 0) + (row.severity_score * row.label_weight);
        clusterCounts[cluster] = (clusterCounts[cluster] ?? 0) + row.label_weight;

        for (const symptomKey of Object.keys(row.feature_vector.symptom_flags)) {
            symptomRiskWeights[symptomKey] = (symptomRiskWeights[symptomKey] ?? 0) + (row.severity_score * row.label_weight);
            symptomCounts[symptomKey] = (symptomCounts[symptomKey] ?? 0) + row.label_weight;
        }
    }

    return {
        artifact_type: 'severity_risk_regression_v1',
        task_type: 'severity',
        model_name: input.modelName,
        model_version: `${input.modelName}_${hashRows(rows)}`,
        dataset_version: input.datasetVersion,
        feature_schema_version: input.featureSchemaVersion,
        label_policy_version: input.labelPolicyVersion,
        trained_at: new Date().toISOString(),
        average_severity: round(averageSeverity),
        symptom_risk_weights: Object.fromEntries(
            Object.entries(symptomRiskWeights).map(([key, total]) => [key, round(total / (symptomCounts[key] ?? 1))]),
        ),
        condition_class_weights: Object.fromEntries(
            Object.entries(conditionClassWeights).map(([key, total]) => [key, round(total / (classCounts[key] ?? 1))]),
        ),
        cluster_weights: Object.fromEntries(
            Object.entries(clusterWeights).map(([key, total]) => [key, round(total / (clusterCounts[key] ?? 1))]),
        ),
        emergency_distribution_by_class: emergencyDistributionByClass,
        training_summary: {
            row_count: rows.length,
            emergency_levels: rows.reduce<Record<string, number>>((acc, row) => {
                acc[row.emergency_level] = (acc[row.emergency_level] ?? 0) + 1;
                return acc;
            }, {}),
        },
    };
}

export function predictSeverity(
    artifact: SeverityModelArtifact,
    featureVector: SeverityTrainingRow['feature_vector'],
): SeverityPrediction {
    const conditionClass = featureVector.dense_features.primary_condition_class as string | null;
    const cluster = featureVector.dense_features.case_cluster as string | null;
    const contradictionScore = typeof featureVector.dense_features.contradiction_score === 'number'
        ? featureVector.dense_features.contradiction_score
        : 0;

    const symptomKeys = Object.keys(featureVector.symptom_flags);
    const symptomSeverity = symptomKeys.length > 0
        ? symptomKeys.reduce((sum, symptomKey) => {
            return sum + (artifact.symptom_risk_weights[symptomKey] ?? HIGH_RISK_SYMPTOMS.get(symptomKey) ?? artifact.average_severity);
        }, 0) / symptomKeys.length
        : artifact.average_severity;

    let severityScore = symptomSeverity;
    if (conditionClass && artifact.condition_class_weights[conditionClass] != null) {
        severityScore = (severityScore * 0.55) + (artifact.condition_class_weights[conditionClass] * 0.45);
    }
    if (cluster && artifact.cluster_weights[cluster] != null) {
        severityScore = (severityScore * 0.7) + (artifact.cluster_weights[cluster] * 0.3);
    }

    for (const symptomKey of symptomKeys) {
        severityScore += HIGH_RISK_SYMPTOMS.get(symptomKey) ?? 0;
    }

    if (featureVector.dense_features.adversarial_case === true) {
        severityScore += 0.05;
    }
    severityScore += contradictionScore * 0.05;
    severityScore = clamp(severityScore);

    const emergencyLevel = severityToEmergency(severityScore);
    const triagePriority = emergencyLevel === 'CRITICAL'
        ? 'immediate'
        : emergencyLevel === 'HIGH'
            ? 'urgent'
            : emergencyLevel === 'MODERATE'
                ? 'standard'
                : 'low';
    const confidence = round(Math.max(0.3, 1 - Math.abs(severityScore - artifact.average_severity)));

    return {
        severity_score: round(severityScore),
        emergency_level: emergencyLevel,
        triage_priority: triagePriority,
        confidence,
    };
}

export function computeSeverityMetrics(
    rows: Array<{
        actualSeverity: number;
        actualEmergency: string;
        species: string | null;
        cluster: string | null;
        predicted: SeverityPrediction;
    }>,
    evaluationMode: 'holdout' | 'resubstitution',
): SeverityTrainingMetrics {
    let emergencyCorrect = 0;
    let absoluteError = 0;
    let squaredError = 0;
    let criticalActual = 0;
    let criticalRecovered = 0;
    let highActual = 0;
    let highRecovered = 0;
    let emergencyActual = 0;
    let emergencyFalseNegatives = 0;

    for (const row of rows) {
        if (row.predicted.emergency_level === row.actualEmergency) {
            emergencyCorrect += 1;
        }

        const predictedSeverity = row.predicted.severity_score ?? 0;
        absoluteError += Math.abs(predictedSeverity - row.actualSeverity);
        squaredError += Math.pow(predictedSeverity - row.actualSeverity, 2);

        if (row.actualEmergency === 'CRITICAL') {
            criticalActual += 1;
            if (row.predicted.emergency_level === 'CRITICAL') criticalRecovered += 1;
        }

        if (row.actualEmergency === 'HIGH') {
            highActual += 1;
            if (row.predicted.emergency_level === 'HIGH' || row.predicted.emergency_level === 'CRITICAL') {
                highRecovered += 1;
            }
        }

        if (row.actualEmergency === 'CRITICAL' || row.actualEmergency === 'HIGH') {
            emergencyActual += 1;
            if (row.predicted.emergency_level === 'MODERATE' || row.predicted.emergency_level === 'LOW') {
                emergencyFalseNegatives += 1;
            }
        }
    }

    return {
        evaluation_mode: evaluationMode,
        emergency_accuracy: round(emergencyCorrect / Math.max(rows.length, 1)),
        severity_mae: round(absoluteError / Math.max(rows.length, 1)),
        severity_rmse: round(Math.sqrt(squaredError / Math.max(rows.length, 1))),
        critical_recall: round(criticalRecovered / Math.max(criticalActual, 1)),
        high_recall: round(highRecovered / Math.max(highActual, 1)),
        emergency_false_negative_rate: round(emergencyFalseNegatives / Math.max(emergencyActual, 1)),
        subgroup_performance: {
            species: computeSeveritySubgroups(rows, 'species'),
            cluster: computeSeveritySubgroups(rows, 'cluster'),
        },
        support: rows.length,
    };
}

function severityToEmergency(severityScore: number): string {
    return EMERGENCY_THRESHOLDS.find((threshold) => severityScore >= threshold.min)?.level ?? 'LOW';
}

function splitRows<T extends { case_id: string }>(rows: T[], evalRatio: number): { train: T[]; eval: T[]; evaluationMode: 'holdout' | 'resubstitution' } {
    if (rows.length < 6) {
        return {
            train: rows,
            eval: rows,
            evaluationMode: 'resubstitution',
        };
    }

    const train: T[] = [];
    const evalRows: T[] = [];

    for (const row of rows) {
        const bucket = deterministicBucket(row.case_id);
        if (bucket < evalRatio) evalRows.push(row);
        else train.push(row);
    }

    if (train.length === 0 || evalRows.length === 0) {
        return {
            train: rows,
            eval: rows,
            evaluationMode: 'resubstitution',
        };
    }

    return {
        train,
        eval: evalRows,
        evaluationMode: 'holdout',
    };
}

function computeSeveritySubgroups(
    rows: Array<{
        actualSeverity: number;
        actualEmergency: string;
        species: string | null;
        cluster: string | null;
        predicted: SeverityPrediction;
    }>,
    key: 'species' | 'cluster',
): SubgroupMetric[] {
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
        const group = row[key] ?? 'Unknown';
        const bucket = grouped.get(group) ?? [];
        bucket.push(row);
        grouped.set(group, bucket);
    }

    return [...grouped.entries()].map(([group, bucket]) => {
        const emergencyCases = bucket.filter((row) => row.actualEmergency === 'CRITICAL' || row.actualEmergency === 'HIGH');
        const recovered = emergencyCases.filter((row) => row.predicted.emergency_level === 'CRITICAL' || row.predicted.emergency_level === 'HIGH').length;
        return {
            group,
            support: bucket.length,
            accuracy: round(bucket.filter((row) => row.predicted.emergency_level === row.actualEmergency).length / Math.max(bucket.length, 1)),
            critical_recall: round(recovered / Math.max(emergencyCases.length, 1)),
        };
    }).sort((left, right) => right.support - left.support).slice(0, 10);
}

function deterministicBucket(value: string): number {
    const hash = createHash('sha1').update(value).digest('hex').slice(0, 8);
    return (Number.parseInt(hash, 16) % 1000) / 1000;
}

function hashRows(rows: SeverityTrainingRow[]): string {
    const material = rows.map((row) => `${row.case_id}:${row.emergency_level}:${row.severity_score}`).sort().join('|');
    return createHash('sha1').update(material).digest('hex').slice(0, 10);
}

function clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
    return Number(value.toFixed(4));
}
