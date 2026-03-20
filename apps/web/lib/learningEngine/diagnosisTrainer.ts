import { createHash } from 'crypto';
import {
    type CaseFeatureVector,
    type DiagnosisDifferential,
    type DiagnosisModelArtifact,
    type DiagnosisPrediction,
    type DiagnosisTrainingMetrics,
    type DiagnosisTrainingRow,
    type PerClassMetrics,
    type SubgroupMetric,
} from '@/lib/learningEngine/types';

interface SplitResult<T> {
    train: T[];
    eval: T[];
    evaluationMode: 'holdout' | 'resubstitution';
}

interface PredictionRecord {
    actual: string;
    predicted: string | null;
    topDifferentials: DiagnosisDifferential[];
    species: string | null;
    breed: string | null;
    cluster: string | null;
}

export function trainDiagnosisModel(
    rows: DiagnosisTrainingRow[],
    input: {
        modelName?: string;
        datasetVersion: string;
        featureSchemaVersion: string;
        labelPolicyVersion: string;
        evalRatio?: number;
    },
): { artifact: DiagnosisModelArtifact; metrics: DiagnosisTrainingMetrics } {
    if (rows.length === 0) {
        throw new Error('Diagnosis trainer requires at least one labeled training row.');
    }

    const split = splitRows(rows, input.evalRatio ?? 0.2);
    const artifact = fitDiagnosisArtifact(split.train, {
        modelName: input.modelName ?? 'vetios_diagnosis_frequency_bayes',
        datasetVersion: input.datasetVersion,
        featureSchemaVersion: input.featureSchemaVersion,
        labelPolicyVersion: input.labelPolicyVersion,
    });
    const evaluationRows = split.eval.length > 0 ? split.eval : split.train;
    const predictions = evaluationRows.map((row) => ({
        actual: row.confirmed_diagnosis,
        predicted: predictDiagnosis(artifact, row.feature_vector).top_diagnosis,
        topDifferentials: predictDiagnosis(artifact, row.feature_vector).top_differentials,
        species: row.species_canonical,
        breed: row.breed,
        cluster: row.case_cluster,
    }));

    return {
        artifact,
        metrics: computeDiagnosisMetrics(predictions, split.evaluationMode),
    };
}

export function fitDiagnosisArtifact(
    rows: DiagnosisTrainingRow[],
    input: {
        modelName: string;
        datasetVersion: string;
        featureSchemaVersion: string;
        labelPolicyVersion: string;
    },
): DiagnosisModelArtifact {
    const labelRows = new Map<string, DiagnosisTrainingRow[]>();
    for (const row of rows) {
        const bucket = labelRows.get(row.confirmed_diagnosis) ?? [];
        bucket.push(row);
        labelRows.set(row.confirmed_diagnosis, bucket);
    }

    const totalWeight = rows.reduce((sum, row) => sum + row.label_weight, 0);
    const priors: Record<string, number> = {};
    const symptomWeights: Record<string, Record<string, number>> = {};
    const speciesWeights: Record<string, Record<string, number>> = {};
    const breedWeights: Record<string, Record<string, number>> = {};
    const clusterWeights: Record<string, Record<string, number>> = {};
    const labelToConditionClass: Record<string, string | null> = {};
    const vocabulary = new Set<string>();

    for (const row of rows) {
        for (const key of Object.keys(row.feature_vector.symptom_flags)) {
            vocabulary.add(key);
        }
    }

    for (const [label, labelExamples] of labelRows.entries()) {
        const labelWeight = labelExamples.reduce((sum, row) => sum + row.label_weight, 0);
        priors[label] = Math.log((labelWeight + 1) / (totalWeight + labelRows.size));
        labelToConditionClass[label] = labelExamples[0]?.primary_condition_class ?? null;
        symptomWeights[label] = buildCategoricalWeights(
            labelExamples.map((row) => Object.keys(row.feature_vector.symptom_flags)),
            [...vocabulary],
        );
        speciesWeights[label] = buildWeightedTokenMap(labelExamples.map((row) => row.species_canonical), labelExamples.map((row) => row.label_weight));
        breedWeights[label] = buildWeightedTokenMap(labelExamples.map((row) => row.breed), labelExamples.map((row) => row.label_weight));
        clusterWeights[label] = buildWeightedTokenMap(labelExamples.map((row) => row.case_cluster), labelExamples.map((row) => row.label_weight));
    }

    return {
        artifact_type: 'diagnosis_frequency_bayes_v1',
        task_type: 'diagnosis',
        model_name: input.modelName,
        model_version: `${input.modelName}_${hashRows(rows)}`,
        dataset_version: input.datasetVersion,
        feature_schema_version: input.featureSchemaVersion,
        label_policy_version: input.labelPolicyVersion,
        trained_at: new Date().toISOString(),
        labels: [...labelRows.keys()],
        priors,
        symptom_weights: symptomWeights,
        species_weights: speciesWeights,
        breed_weights: breedWeights,
        cluster_weights: clusterWeights,
        label_to_condition_class: labelToConditionClass,
        training_summary: {
            row_count: rows.length,
            label_count: labelRows.size,
            vocabulary_size: vocabulary.size,
        },
    };
}

export function predictDiagnosis(
    artifact: DiagnosisModelArtifact,
    featureVector: CaseFeatureVector,
): DiagnosisPrediction {
    const scores = artifact.labels.map((label) => {
        const symptomScore = Object.keys(featureVector.symptom_flags).reduce((sum, symptomKey) => {
            return sum + (artifact.symptom_weights[label]?.[symptomKey] ?? -0.35);
        }, 0);
        const speciesScore = readLookupWeight(artifact.species_weights[label], featureVector.dense_features.species_canonical);
        const breedScore = readLookupWeight(artifact.breed_weights[label], featureVector.dense_features.breed);
        const clusterScore = readLookupWeight(artifact.cluster_weights[label], featureVector.dense_features.case_cluster);
        const contradictionPenalty = typeof featureVector.dense_features.contradiction_score === 'number'
            ? featureVector.dense_features.contradiction_score * 0.3
            : 0;

        return {
            label,
            score: (artifact.priors[label] ?? 0) + symptomScore + speciesScore + breedScore + clusterScore - contradictionPenalty,
        };
    }).sort((left, right) => right.score - left.score);

    if (scores.length === 0) {
        return {
            top_diagnosis: null,
            primary_condition_class: null,
            confidence: null,
            top_differentials: [],
            abstain: true,
            detected_contradiction: false,
        };
    }

    const topScore = scores[0].score;
    const probabilities = softmax(scores.map((entry) => entry.score));
    const topDifferentials = scores.slice(0, 3).map((entry, index) => ({
        name: entry.label,
        probability: Number(probabilities[index].toFixed(4)),
    }));
    const contradictionScore = typeof featureVector.dense_features.contradiction_score === 'number'
        ? featureVector.dense_features.contradiction_score
        : 0;
    const margin = scores.length > 1 ? topScore - scores[1].score : topScore;
    let confidence = topDifferentials[0]?.probability ?? null;

    if (confidence != null && contradictionScore >= 0.4) {
        confidence = Number(Math.min(confidence, contradictionScore > 0.7 ? 0.45 : 0.6).toFixed(4));
    }

    const abstain = contradictionScore > 0.7 && margin < 0.6;

    return {
        top_diagnosis: scores[0].label,
        primary_condition_class: artifact.label_to_condition_class[scores[0].label] ?? inferConditionClass(scores[0].label),
        confidence,
        top_differentials: topDifferentials,
        abstain,
        detected_contradiction: contradictionScore > 0.2,
    };
}

export function computeDiagnosisMetrics(
    predictions: PredictionRecord[],
    evaluationMode: 'holdout' | 'resubstitution',
): DiagnosisTrainingMetrics {
    const labels = new Set<string>();
    const confusionMatrix: Record<string, Record<string, number>> = {};

    for (const prediction of predictions) {
        labels.add(prediction.actual);
        if (prediction.predicted) labels.add(prediction.predicted);
    }

    for (const actual of labels) {
        confusionMatrix[actual] = {};
        for (const predicted of labels) {
            confusionMatrix[actual][predicted] = 0;
        }
    }

    let correct = 0;
    let top3Correct = 0;
    for (const prediction of predictions) {
        const predictedLabel = prediction.predicted ?? '__abstain__';
        if (!confusionMatrix[prediction.actual]) {
            confusionMatrix[prediction.actual] = {};
        }
        confusionMatrix[prediction.actual][predictedLabel] = (confusionMatrix[prediction.actual][predictedLabel] ?? 0) + 1;
        if (prediction.predicted === prediction.actual) correct += 1;
        if (prediction.topDifferentials.some((candidate) => candidate.name === prediction.actual)) {
            top3Correct += 1;
        }
    }

    const perClass: Record<string, PerClassMetrics> = {};
    for (const label of labels) {
        const tp = confusionMatrix[label]?.[label] ?? 0;
        const fp = [...labels].reduce((sum, actual) => sum + (actual === label ? 0 : (confusionMatrix[actual]?.[label] ?? 0)), 0);
        const fn = [...labels].reduce((sum, predicted) => sum + (predicted === label ? 0 : (confusionMatrix[label]?.[predicted] ?? 0)), 0);
        const support = [...labels].reduce((sum, predicted) => sum + (confusionMatrix[label]?.[predicted] ?? 0), 0);
        const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
        const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        perClass[label] = {
            support,
            precision: round(precision),
            recall: round(recall),
            f1: round(f1),
        };
    }

    const macroF1 = computeMacroF1(perClass, [...labels]);

    return {
        evaluation_mode: evaluationMode,
        accuracy: round(correct / Math.max(predictions.length, 1)),
        macro_f1: round(macroF1),
        top_3_accuracy: round(top3Correct / Math.max(predictions.length, 1)),
        per_class: perClass,
        confusion_matrix: confusionMatrix,
        subgroup_performance: {
            species: computeDiagnosisSubgroupMetrics(predictions, 'species'),
            breed: computeDiagnosisSubgroupMetrics(predictions, 'breed'),
            cluster: computeDiagnosisSubgroupMetrics(predictions, 'cluster'),
        },
        support: predictions.length,
    };
}

function buildCategoricalWeights(
    tokenSets: string[][],
    vocabulary: string[],
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const token of vocabulary) counts[token] = 1;

    for (const tokenSet of tokenSets) {
        const unique = new Set(tokenSet);
        for (const token of unique) {
            counts[token] = (counts[token] ?? 1) + 1;
        }
    }

    const denominator = tokenSets.length + vocabulary.length;
    return Object.fromEntries(
        Object.entries(counts).map(([token, count]) => [token, Math.log(count / denominator)]),
    );
}

function buildWeightedTokenMap(
    values: Array<string | null>,
    weights: number[],
): Record<string, number> {
    const counts: Record<string, number> = {};
    let total = 0;
    values.forEach((value, index) => {
        if (!value) return;
        counts[value] = (counts[value] ?? 1) + weights[index];
        total += weights[index];
    });

    if (total === 0) return {};

    return Object.fromEntries(
        Object.entries(counts).map(([key, count]) => [key, Math.log(count / (total + Object.keys(counts).length))]),
    );
}

function readLookupWeight(table: Record<string, number> | undefined, value: unknown): number {
    if (!table || typeof value !== 'string') return 0;
    return table[value] ?? 0;
}

function inferConditionClass(label: string): string | null {
    const normalized = label.toLowerCase();
    if (normalized.includes('gdv') || normalized.includes('volvulus') || normalized.includes('obstruction')) return 'Mechanical';
    if (normalized.includes('distemper') || normalized.includes('parvo') || normalized.includes('infect')) return 'Infectious';
    if (normalized.includes('toxic')) return 'Toxicology';
    if (normalized.includes('pancreatitis')) return 'Inflammatory';
    return 'Undifferentiated';
}

function softmax(scores: number[]): number[] {
    const maxScore = Math.max(...scores);
    const exps = scores.map((score) => Math.exp(score - maxScore));
    const sum = exps.reduce((acc, value) => acc + value, 0);
    return exps.map((value) => value / sum);
}

function splitRows<T extends { case_id: string }>(rows: T[], evalRatio: number): SplitResult<T> {
    if (rows.length < 6) {
        return {
            train: rows,
            eval: rows,
            evaluationMode: 'resubstitution',
        };
    }

    const evalRows: T[] = [];
    const trainRows: T[] = [];

    for (const row of rows) {
        const bucket = deterministicBucket(row.case_id);
        if (bucket < evalRatio) {
            evalRows.push(row);
        } else {
            trainRows.push(row);
        }
    }

    if (trainRows.length === 0 || evalRows.length === 0) {
        return {
            train: rows,
            eval: rows,
            evaluationMode: 'resubstitution',
        };
    }

    return {
        train: trainRows,
        eval: evalRows,
        evaluationMode: 'holdout',
    };
}

function deterministicBucket(value: string): number {
    const hash = createHash('sha1').update(value).digest('hex').slice(0, 8);
    const integer = Number.parseInt(hash, 16);
    return (integer % 1000) / 1000;
}

function hashRows(rows: DiagnosisTrainingRow[]): string {
    const material = rows.map((row) => `${row.case_id}:${row.confirmed_diagnosis}:${row.label_type}`).sort().join('|');
    return createHash('sha1').update(material).digest('hex').slice(0, 10);
}

function round(value: number): number {
    return Number(value.toFixed(4));
}

function computeDiagnosisSubgroupMetrics(
    predictions: PredictionRecord[],
    key: 'species' | 'breed' | 'cluster',
): SubgroupMetric[] {
    const grouped = new Map<string, PredictionRecord[]>();
    for (const prediction of predictions) {
        const group = prediction[key] ?? 'Unknown';
        const bucket = grouped.get(group) ?? [];
        bucket.push(prediction);
        grouped.set(group, bucket);
    }

    return [...grouped.entries()]
        .map(([group, rows]) => ({
            group,
            support: rows.length,
            accuracy: round(rows.filter((row) => row.actual === row.predicted).length / Math.max(rows.length, 1)),
            macro_f1: round(computeMacroF1ForPredictions(rows)),
        }))
        .sort((left, right) => right.support - left.support)
        .slice(0, 10);
}

function computeMacroF1ForPredictions(predictions: PredictionRecord[]): number {
    const labels = new Set<string>();
    for (const prediction of predictions) {
        labels.add(prediction.actual);
        if (prediction.predicted) labels.add(prediction.predicted);
    }

    const perClass: Record<string, PerClassMetrics> = {};
    for (const label of labels) {
        let tp = 0;
        let fp = 0;
        let fn = 0;
        let support = 0;

        for (const prediction of predictions) {
            if (prediction.actual === label) {
                support += 1;
            }
            if (prediction.actual === label && prediction.predicted === label) {
                tp += 1;
            } else if (prediction.actual !== label && prediction.predicted === label) {
                fp += 1;
            } else if (prediction.actual === label && prediction.predicted !== label) {
                fn += 1;
            }
        }

        const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
        const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        perClass[label] = {
            support,
            precision: round(precision),
            recall: round(recall),
            f1: round(f1),
        };
    }

    return computeMacroF1(perClass, [...labels]);
}

function computeMacroF1(
    perClass: Record<string, PerClassMetrics>,
    labels: string[],
): number {
    return labels.reduce((sum, label) => sum + (perClass[label]?.f1 ?? 0), 0) / Math.max(labels.length, 1);
}
