import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_INFERENCE_EVENTS, CLINICAL_OUTCOME_EVENTS } from '@/lib/db/schemaContracts';

export interface CireValidationInferenceRow {
    id: string;
    model_version?: string | null;
    prompt_template_hash?: string | null;
    prompt_template_version?: string | null;
    schema_version?: string | null;
    phi_hat?: number | string | null;
    confidence_score?: number | string | null;
    uncertainty_metrics?: Record<string, unknown> | null;
    output_payload?: Record<string, unknown> | null;
    prediction_correct?: boolean | string | null;
    created_at?: string | null;
}

export interface CireValidationOutcomeRow {
    id?: string | null;
    inference_event_id?: string | null;
    outcome_payload?: Record<string, unknown> | null;
    created_at?: string | null;
}

export interface CireValidationReport {
    status: 'insufficient_outcomes' | 'validated' | 'weak_signal' | 'inverse_signal';
    validated: boolean;
    sample_size: number;
    min_sample_size: number;
    correlation_threshold: number;
    spearman_r: number | null;
    correctness_rate: number | null;
    mean_phi_correct: number | null;
    mean_phi_incorrect: number | null;
    brier_score: number | null;
    interpretation: string;
    bins: Array<{
        bucket: string;
        count: number;
        accuracy: number | null;
        mean_phi_hat: number | null;
    }>;
    lineage_coverage: {
        prompt_template_hash: number;
        schema_version: number;
        top_level_phi_hat: number;
    };
}

interface ValidationPair {
    phiHat: number;
    correct: boolean;
    inference: CireValidationInferenceRow;
}

export async function loadCireValidationReport(
    client: SupabaseClient,
    input: {
        tenantId: string;
        limit?: number;
        minSampleSize?: number;
        correlationThreshold?: number;
    },
): Promise<CireValidationReport> {
    const limit = Math.max(1, Math.min(input.limit ?? 1000, 5000));
    const OC = CLINICAL_OUTCOME_EVENTS.COLUMNS;
    const IC = AI_INFERENCE_EVENTS.COLUMNS;
    const { data: outcomes, error: outcomeError } = await client
        .from(CLINICAL_OUTCOME_EVENTS.TABLE)
        .select(`${OC.id},${OC.inference_event_id},${OC.outcome_payload},${OC.created_at}`)
        .eq(OC.tenant_id, input.tenantId)
        .order(OC.created_at, { ascending: false })
        .limit(limit);

    if (outcomeError) {
        throw new Error(`Failed to load CIRE validation outcomes: ${outcomeError.message}`);
    }

    const outcomeRows = (outcomes ?? []) as CireValidationOutcomeRow[];
    const inferenceIds = Array.from(new Set(
        outcomeRows
            .map((row) => readText(row.inference_event_id))
            .filter((value): value is string => value != null),
    ));

    if (inferenceIds.length === 0) {
        return buildCireValidationReportFromRows([], outcomeRows, input);
    }

    const inferenceRows = await loadValidationInferenceRows(client, input.tenantId, inferenceIds);
    return buildCireValidationReportFromRows(inferenceRows, outcomeRows, input);
}

export function buildCireValidationReportFromRows(
    inferences: CireValidationInferenceRow[],
    outcomes: CireValidationOutcomeRow[],
    input: {
        minSampleSize?: number;
        correlationThreshold?: number;
    } = {},
): CireValidationReport {
    const minSampleSize = Math.max(1, input.minSampleSize ?? 30);
    const correlationThreshold = input.correlationThreshold ?? 0.5;
    const inferenceById = new Map(inferences.map((row) => [row.id, row]));
    const pairs: ValidationPair[] = [];

    for (const outcome of outcomes) {
        const inferenceId = readText(outcome.inference_event_id);
        if (!inferenceId) continue;

        const inference = inferenceById.get(inferenceId);
        if (!inference) continue;

        const correct = readBoolean(asRecord(outcome.outcome_payload).prediction_correct)
            ?? readBoolean(inference.prediction_correct);
        const phiHat = extractPhiHat(inference);
        if (correct == null || phiHat == null) continue;

        pairs.push({ phiHat, correct, inference });
    }

    const phiValues = pairs.map((pair) => pair.phiHat);
    const correctnessValues = pairs.map((pair) => pair.correct ? 1 : 0);
    const spearman = pairs.length >= 2 ? spearmanCorrelation(phiValues, correctnessValues) : null;
    const correctPairs = pairs.filter((pair) => pair.correct);
    const incorrectPairs = pairs.filter((pair) => !pair.correct);
    const brierScore = pairs.length === 0
        ? null
        : mean(pairs.map((pair) => Math.pow(pair.phiHat - (pair.correct ? 1 : 0), 2)));
    const status = resolveValidationStatus(pairs.length, minSampleSize, spearman, correlationThreshold);

    return {
        status,
        validated: status === 'validated',
        sample_size: pairs.length,
        min_sample_size: minSampleSize,
        correlation_threshold: correlationThreshold,
        spearman_r: spearman == null ? null : roundMetric(spearman),
        correctness_rate: pairs.length === 0 ? null : roundMetric(correctPairs.length / pairs.length),
        mean_phi_correct: correctPairs.length === 0 ? null : roundMetric(mean(correctPairs.map((pair) => pair.phiHat))),
        mean_phi_incorrect: incorrectPairs.length === 0 ? null : roundMetric(mean(incorrectPairs.map((pair) => pair.phiHat))),
        brier_score: brierScore == null ? null : roundMetric(brierScore),
        interpretation: buildInterpretation(status, pairs.length, minSampleSize, spearman, correlationThreshold),
        bins: buildReliabilityBins(pairs),
        lineage_coverage: {
            prompt_template_hash: countCoverage(pairs, (pair) => readText(pair.inference.prompt_template_hash) != null),
            schema_version: countCoverage(pairs, (pair) => readText(pair.inference.schema_version) != null),
            top_level_phi_hat: countCoverage(pairs, (pair) => readNumber(pair.inference.phi_hat) != null),
        },
    };
}

async function loadValidationInferenceRows(
    client: SupabaseClient,
    tenantId: string,
    inferenceIds: string[],
): Promise<CireValidationInferenceRow[]> {
    const IC = AI_INFERENCE_EVENTS.COLUMNS;
    const lineageSelect = [
        IC.id,
        IC.model_version,
        IC.prompt_template_hash,
        IC.prompt_template_version,
        IC.schema_version,
        IC.phi_hat,
        IC.confidence_score,
        IC.uncertainty_metrics,
        IC.output_payload,
        IC.prediction_correct,
        IC.created_at,
    ].join(',');
    const legacySelect = [
        IC.id,
        IC.model_version,
        IC.confidence_score,
        IC.uncertainty_metrics,
        IC.output_payload,
        IC.prediction_correct,
        IC.created_at,
    ].join(',');

    const result = await client
        .from(AI_INFERENCE_EVENTS.TABLE)
        .select(lineageSelect)
        .eq(IC.tenant_id, tenantId)
        .in(IC.id, inferenceIds);

    if (!result.error) {
        return (result.data ?? []) as CireValidationInferenceRow[];
    }

    if (!isMissingColumnError(result.error.message)) {
        throw new Error(`Failed to load CIRE validation inferences: ${result.error.message}`);
    }

    const fallback = await client
        .from(AI_INFERENCE_EVENTS.TABLE)
        .select(legacySelect)
        .eq(IC.tenant_id, tenantId)
        .in(IC.id, inferenceIds);

    if (fallback.error) {
        throw new Error(`Failed to load CIRE validation inferences: ${fallback.error.message}`);
    }

    return (fallback.data ?? []) as CireValidationInferenceRow[];
}

function extractPhiHat(row: CireValidationInferenceRow): number | null {
    return clampProbability(readNumber(row.phi_hat)
        ?? readNumber(asRecord(row.uncertainty_metrics).phi_hat)
        ?? readNumber(asRecord(asRecord(row.uncertainty_metrics).cire).phi_hat)
        ?? readNumber(asRecord(row.output_payload).phi_hat)
        ?? readNumber(asRecord(asRecord(row.output_payload).governance_lineage).phi_hat)
        ?? readNumber(asRecord(asRecord(row.output_payload).cire).phi_hat)
        ?? readNumber(row.confidence_score));
}

function resolveValidationStatus(
    sampleSize: number,
    minSampleSize: number,
    spearman: number | null,
    threshold: number,
): CireValidationReport['status'] {
    if (sampleSize < minSampleSize || spearman == null) return 'insufficient_outcomes';
    if (spearman >= threshold) return 'validated';
    if (spearman < -0.1) return 'inverse_signal';
    return 'weak_signal';
}

function buildInterpretation(
    status: CireValidationReport['status'],
    sampleSize: number,
    minSampleSize: number,
    spearman: number | null,
    threshold: number,
) {
    if (status === 'insufficient_outcomes') {
        return `CIRE validation needs ${Math.max(0, minSampleSize - sampleSize)} more outcome-linked inferences before the reliability claim is evidence-grade.`;
    }
    if (status === 'validated') {
        return `CIRE phi_hat is positively correlated with outcome correctness at or above the ${threshold} threshold.`;
    }
    if (status === 'inverse_signal') {
        return 'CIRE phi_hat is inversely associated with correctness and should not be marketed as a reliability signal yet.';
    }
    return `CIRE phi_hat has outcome coverage but the observed correlation ${spearman == null ? 'is unavailable' : `is ${roundMetric(spearman)}`} below the validation threshold.`;
}

function buildReliabilityBins(pairs: ValidationPair[]) {
    const bins = [
        { bucket: '0.00-0.20', min: 0, max: 0.2 },
        { bucket: '0.20-0.40', min: 0.2, max: 0.4 },
        { bucket: '0.40-0.60', min: 0.4, max: 0.6 },
        { bucket: '0.60-0.80', min: 0.6, max: 0.8 },
        { bucket: '0.80-1.00', min: 0.8, max: 1.0000001 },
    ];

    return bins.map((bin) => {
        const rows = pairs.filter((pair) => pair.phiHat >= bin.min && pair.phiHat < bin.max);
        return {
            bucket: bin.bucket,
            count: rows.length,
            accuracy: rows.length === 0 ? null : roundMetric(rows.filter((row) => row.correct).length / rows.length),
            mean_phi_hat: rows.length === 0 ? null : roundMetric(mean(rows.map((row) => row.phiHat))),
        };
    });
}

function spearmanCorrelation(left: number[], right: number[]): number | null {
    if (left.length !== right.length || left.length < 2) return null;
    return pearsonCorrelation(rank(left), rank(right));
}

function rank(values: number[]): number[] {
    const sorted = values
        .map((value, index) => ({ value, index }))
        .sort((left, right) => left.value - right.value);
    const ranks = new Array(values.length).fill(0);

    let index = 0;
    while (index < sorted.length) {
        let end = index;
        while (end + 1 < sorted.length && sorted[end + 1].value === sorted[index].value) {
            end += 1;
        }

        const averageRank = (index + end + 2) / 2;
        for (let cursor = index; cursor <= end; cursor += 1) {
            ranks[sorted[cursor].index] = averageRank;
        }
        index = end + 1;
    }

    return ranks;
}

function pearsonCorrelation(left: number[], right: number[]): number | null {
    const leftMean = mean(left);
    const rightMean = mean(right);
    let numerator = 0;
    let leftVariance = 0;
    let rightVariance = 0;

    for (let index = 0; index < left.length; index += 1) {
        const leftDelta = left[index] - leftMean;
        const rightDelta = right[index] - rightMean;
        numerator += leftDelta * rightDelta;
        leftVariance += leftDelta * leftDelta;
        rightVariance += rightDelta * rightDelta;
    }

    const denominator = Math.sqrt(leftVariance * rightVariance);
    return denominator === 0 ? null : numerator / denominator;
}

function countCoverage(pairs: ValidationPair[], predicate: (pair: ValidationPair) => boolean): number {
    return pairs.length === 0 ? 0 : roundMetric(pairs.filter(predicate).length / pairs.length);
}

function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function roundMetric(value: number): number {
    return Number(value.toFixed(4));
}

function clampProbability(value: number | null): number | null {
    if (value == null || !Number.isFinite(value)) return null;
    return Number(Math.min(1, Math.max(0, value)).toFixed(6));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 't', '1', 'yes'].includes(normalized)) return true;
        if (['false', 'f', '0', 'no'].includes(normalized)) return false;
    }
    return null;
}

function isMissingColumnError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('schema cache')
        || normalized.includes('could not find')
        || normalized.includes('column')
        || normalized.includes('42703');
}
