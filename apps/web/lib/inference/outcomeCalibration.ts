import { createHash } from 'crypto';

type CalibrationSupabaseClient = {
    from: (table: string) => unknown;
};

type QueryResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;
type InsertResult<T> = { select: (columns: string) => { single: () => QueryResult<T> } };

export type OutcomeCalibrationStatus = 'needs_outcome' | 'calibrated' | 'underconfident' | 'overconfident' | 'indeterminate';

export interface OutcomeCalibrationCase {
    tenantId: string;
    outcomeEventId?: string | null;
    inferenceEventId?: string | null;
    requestId?: string | null;
    caseId?: string | null;
    species?: string | null;
    label: string;
    labelType?: string | null;
    predictedLabel?: string | null;
    predictedProbability?: number | null;
    actualProbability?: number | null;
    actualConfidence?: number | null;
    calibrationDelta?: number | null;
    topDifferentials?: Array<{ label: string; probability: number }>;
    modelVersion?: string | null;
    evidenceType?: string | null;
    severity?: string | null;
    careEnvironment?: string | null;
    region?: string | null;
    riskClass?: string | null;
    abstained?: boolean;
    synthetic?: boolean;
    sourceKind?: string | null;
    observedAt?: string | null;
}

export interface OutcomeCalibrationRunInput {
    tenantId: string;
    requestId?: string | null;
    runKind?: 'outcome_write' | 'scheduled' | 'manual_recompute' | 'backfill';
    modelVersion?: string | null;
    sourceWindowStart?: string | null;
    sourceWindowEnd?: string | null;
    minimumRequiredOutcomes?: number;
    rows: OutcomeCalibrationCase[];
}

export interface OutcomeCalibrationBucket {
    bucket_key: string;
    tenant_id: string;
    label: string;
    normalized_label: string;
    species: string | null;
    model_version: string | null;
    evidence_type: string;
    severity: string;
    care_environment: string;
    region: string;
    confidence_bucket: string;
    outcome_label_count: number;
    top1_accuracy: number | null;
    top3_recall: number | null;
    brier_score: number | null;
    expected_calibration_error: number | null;
    false_negative_critical_rate: number | null;
    overconfidence_rate: number | null;
    abstain_rate: number | null;
    mean_confidence: number | null;
    mean_delta: number | null;
    calibration_status: OutcomeCalibrationStatus;
    minimum_required_outcomes: number;
    synthetic_rows_excluded: number;
    source_event_count: number;
    source_hash: string;
    blockers: string[];
    warnings: string[];
    evidence: Record<string, unknown>;
}

export interface OutcomeCalibrationRunSummary {
    run_status: 'completed' | 'insufficient_evidence' | 'failed';
    source_event_count: number;
    eligible_rows: number;
    synthetic_rows_excluded: number;
    bucket_count: number;
    source_digest: string;
    blockers: string[];
    warnings: string[];
    buckets: OutcomeCalibrationBucket[];
}

export async function recordOutcomeCalibrationRun(
    client: CalibrationSupabaseClient,
    input: OutcomeCalibrationRunInput,
): Promise<{ data: OutcomeCalibrationRunSummary | null; error: string | null }> {
    const summary = buildOutcomeCalibrationBuckets(input);
    const runTable = client.from('outcome_calibration_runs') as {
        insert: (payload: Record<string, unknown>) => InsertResult<Record<string, unknown>>;
    };

    const { data: runRow, error: runError } = await runTable
        .insert({
            tenant_id: input.tenantId,
            request_id: input.requestId ?? null,
            run_kind: input.runKind ?? 'manual_recompute',
            model_version: input.modelVersion ?? null,
            source_window_start: input.sourceWindowStart ?? null,
            source_window_end: input.sourceWindowEnd ?? null,
            source_event_count: summary.source_event_count,
            eligible_rows: summary.eligible_rows,
            synthetic_rows_excluded: summary.synthetic_rows_excluded,
            bucket_count: summary.bucket_count,
            minimum_required_outcomes: input.minimumRequiredOutcomes ?? 5,
            run_status: summary.run_status,
            blockers: summary.blockers,
            warnings: summary.warnings,
            source_digest: summary.source_digest,
            run_packet: {
                version: 'vetios_outcome_calibration_loop_v1',
                privacy_boundary: 'aggregate calibration metrics only; no raw notes, owner identifiers, raw lab reports, images, or raw clinical payloads',
                synthetic_rows_excluded: summary.synthetic_rows_excluded,
                bucket_keys: summary.buckets.map((bucket) => bucket.bucket_key),
            },
        })
        .select('id')
        .single();

    if (runError || !runRow?.id) {
        return { data: null, error: runError?.message ?? 'outcome_calibration_run_insert_failed' };
    }

    if (summary.buckets.length > 0) {
        const bucketTable = client.from('outcome_calibration_buckets') as {
            insert: (payload: Array<Record<string, unknown>>) => Promise<{ error: { message?: string } | null }>;
        };
        const { error: bucketError } = await bucketTable.insert(summary.buckets.map((bucket) => ({
            calibration_run_id: runRow.id,
            tenant_id: bucket.tenant_id,
            bucket_key: bucket.bucket_key,
            label: bucket.label,
            normalized_label: bucket.normalized_label,
            species: bucket.species,
            model_version: bucket.model_version,
            evidence_type: bucket.evidence_type,
            severity: bucket.severity,
            care_environment: bucket.care_environment,
            region: bucket.region,
            confidence_bucket: bucket.confidence_bucket,
            outcome_label_count: bucket.outcome_label_count,
            top1_accuracy: bucket.top1_accuracy,
            top3_recall: bucket.top3_recall,
            brier_score: bucket.brier_score,
            expected_calibration_error: bucket.expected_calibration_error,
            false_negative_critical_rate: bucket.false_negative_critical_rate,
            overconfidence_rate: bucket.overconfidence_rate,
            abstain_rate: bucket.abstain_rate,
            mean_confidence: bucket.mean_confidence,
            mean_delta: bucket.mean_delta,
            calibration_status: bucket.calibration_status,
            minimum_required_outcomes: bucket.minimum_required_outcomes,
            synthetic_rows_excluded: bucket.synthetic_rows_excluded,
            source_event_count: bucket.source_event_count,
            source_hash: bucket.source_hash,
            blockers: bucket.blockers,
            warnings: bucket.warnings,
            evidence: bucket.evidence,
        })));

        if (bucketError) {
            return { data: null, error: bucketError.message ?? 'outcome_calibration_bucket_insert_failed' };
        }
    }

    return { data: summary, error: null };
}

export function buildOutcomeCalibrationBuckets(input: OutcomeCalibrationRunInput): OutcomeCalibrationRunSummary {
    const minimumRequiredOutcomes = Math.max(1, Math.trunc(input.minimumRequiredOutcomes ?? 5));
    const syntheticRows = input.rows.filter(isSyntheticOutcomeRow);
    const eligibleRows = input.rows.filter((row) => !isSyntheticOutcomeRow(row));
    const groups = new Map<string, OutcomeCalibrationCase[]>();

    for (const row of eligibleRows) {
        const key = makeBucketKey(row, input.modelVersion);
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
    }

    const buckets = Array.from(groups.entries()).map(([key, rows]) => {
        const prototype = rows[0] as OutcomeCalibrationCase;
        return buildBucket(key, rows, minimumRequiredOutcomes, syntheticRows.length, input.modelVersion ?? prototype.modelVersion ?? null);
    });

    const blockers: string[] = [];
    if (eligibleRows.length < minimumRequiredOutcomes) blockers.push('insufficient_real_outcome_rows');
    if (syntheticRows.length > 0) blockers.push('synthetic_rows_excluded_from_calibration');

    const warnings = buckets.flatMap((bucket) => bucket.warnings);
    return {
        run_status: eligibleRows.length >= minimumRequiredOutcomes ? 'completed' : 'insufficient_evidence',
        source_event_count: input.rows.length,
        eligible_rows: eligibleRows.length,
        synthetic_rows_excluded: syntheticRows.length,
        bucket_count: buckets.length,
        source_digest: digestUnknown({
            rows: input.rows.map(sanitizeSourceRow),
            minimum_required_outcomes: minimumRequiredOutcomes,
        }),
        blockers: Array.from(new Set(blockers)),
        warnings: Array.from(new Set(warnings)),
        buckets,
    };
}

function buildBucket(
    bucketKey: string,
    rows: OutcomeCalibrationCase[],
    minimumRequiredOutcomes: number,
    syntheticRowsExcluded: number,
    modelVersion: string | null,
): OutcomeCalibrationBucket {
    const prototype = rows[0] as OutcomeCalibrationCase;
    const normalizedLabel = normalizeLabel(prototype.label);
    const confidences = rows.map(readPredictedProbability).filter((value): value is number => value != null);
    const correctness = rows.map((row) => isTop1Correct(row));
    const rowsWithCorrectness = correctness.filter((value): value is boolean => value != null);
    const actualProbabilities = rows.map(readActualProbability).filter((value): value is number => value != null);
    const deltas = rows.map(readCalibrationDelta).filter((value): value is number => value != null);
    const criticalRows = rows.filter(isCriticalOutcomeRow);
    const criticalMisses = criticalRows.filter((row) => isTop1Correct(row) === false);
    const overconfidentRows = rows.filter((row) => {
        const p = readPredictedProbability(row);
        return p != null && p >= 0.8 && isTop1Correct(row) === false;
    });
    const warnings: string[] = [];
    const blockers: string[] = [];

    if (rows.length < minimumRequiredOutcomes) blockers.push('minimum_real_outcomes_not_met');
    if (actualProbabilities.length < rows.length) warnings.push('actual_probability_missing_for_some_outcomes');
    if (rowsWithCorrectness.length < rows.length) warnings.push('top1_correctness_missing_for_some_outcomes');

    const top1Accuracy = rowsWithCorrectness.length > 0
        ? rowsWithCorrectness.filter(Boolean).length / rowsWithCorrectness.length
        : null;
    const top3Recall = rows.length > 0
        ? rows.filter((row) => includesActualInTopK(row, 3)).length / rows.length
        : null;
    const brierScore = actualProbabilities.length > 0
        ? mean(actualProbabilities.map((p) => (1 - p) ** 2))
        : null;
    const ece = computeExpectedCalibrationError(rows);
    const meanDelta = deltas.length > 0 ? mean(deltas) : null;
    const status = classifyBucketStatus(rows.length, minimumRequiredOutcomes, meanDelta, ece);

    return {
        bucket_key: bucketKey,
        tenant_id: prototype.tenantId,
        label: prototype.label,
        normalized_label: normalizedLabel,
        species: normalizeDimension(prototype.species),
        model_version: modelVersion,
        evidence_type: normalizeDimension(prototype.evidenceType) ?? 'mixed',
        severity: normalizeDimension(prototype.severity ?? prototype.riskClass) ?? 'mixed',
        care_environment: normalizeDimension(prototype.careEnvironment) ?? 'unknown',
        region: normalizeDimension(prototype.region) ?? 'unknown',
        confidence_bucket: deriveConfidenceBucket(mean(confidences)),
        outcome_label_count: rows.length,
        top1_accuracy: roundNullable(top1Accuracy),
        top3_recall: roundNullable(top3Recall),
        brier_score: roundNullable(brierScore),
        expected_calibration_error: roundNullable(ece),
        false_negative_critical_rate: criticalRows.length > 0
            ? roundMetric(criticalMisses.length / criticalRows.length)
            : null,
        overconfidence_rate: roundMetric(overconfidentRows.length / rows.length),
        abstain_rate: roundMetric(rows.filter((row) => row.abstained === true).length / rows.length),
        mean_confidence: roundNullable(confidences.length > 0 ? mean(confidences) : null),
        mean_delta: roundSignedNullable(meanDelta),
        calibration_status: status,
        minimum_required_outcomes: minimumRequiredOutcomes,
        synthetic_rows_excluded: syntheticRowsExcluded,
        source_event_count: rows.length,
        source_hash: digestUnknown(rows.map(sanitizeSourceRow)),
        blockers,
        warnings,
        evidence: {
            version: 'vetios_outcome_calibration_bucket_v1',
            source_event_refs: rows.map((row) => ({
                outcome_event_id: row.outcomeEventId ?? null,
                inference_event_id: row.inferenceEventId ?? null,
                request_id: row.requestId ?? null,
            })),
            metric_contract: {
                top1_accuracy: 'predicted label matches confirmed label',
                top3_recall: 'confirmed label appears in top three differential labels',
                expected_calibration_error: 'decile-binned confidence versus observed correctness',
                brier_score: 'binary actual-label probability score',
            },
            privacy_boundary: 'hashes, aggregate metrics, and event ids only; no raw clinical narratives or owner identifiers',
        },
    };
}

function makeBucketKey(row: OutcomeCalibrationCase, fallbackModelVersion?: string | null): string {
    return [
        row.tenantId,
        normalizeLabel(row.label),
        normalizeDimension(row.species) ?? 'all_species',
        normalizeDimension(row.modelVersion ?? fallbackModelVersion) ?? 'all_models',
        normalizeDimension(row.evidenceType) ?? 'mixed_evidence',
        normalizeDimension(row.severity ?? row.riskClass) ?? 'mixed_severity',
        normalizeDimension(row.careEnvironment) ?? 'unknown_care',
        normalizeDimension(row.region) ?? 'unknown_region',
    ].join('|');
}

function computeExpectedCalibrationError(rows: OutcomeCalibrationCase[]): number | null {
    const buckets = new Map<string, Array<{ confidence: number; correct: boolean }>>();
    for (const row of rows) {
        const confidence = readPredictedProbability(row);
        const correct = isTop1Correct(row);
        if (confidence == null || correct == null) continue;
        const key = deriveConfidenceBucket(confidence);
        const group = buckets.get(key) ?? [];
        group.push({ confidence, correct });
        buckets.set(key, group);
    }
    const total = Array.from(buckets.values()).reduce((sum, group) => sum + group.length, 0);
    if (total === 0) return null;

    let ece = 0;
    for (const group of buckets.values()) {
        const confidence = mean(group.map((entry) => entry.confidence));
        const accuracy = group.filter((entry) => entry.correct).length / group.length;
        ece += (group.length / total) * Math.abs(confidence - accuracy);
    }
    return ece;
}

function classifyBucketStatus(
    count: number,
    minimumRequiredOutcomes: number,
    meanDelta: number | null,
    ece: number | null,
): OutcomeCalibrationStatus {
    if (count < minimumRequiredOutcomes) return 'needs_outcome';
    if (ece != null && ece <= 0.08 && (meanDelta == null || Math.abs(meanDelta) <= 0.08)) return 'calibrated';
    if (meanDelta != null && meanDelta > 0.08) return 'underconfident';
    if (meanDelta != null && meanDelta < -0.08) return 'overconfident';
    if (ece != null && ece > 0.12) return 'overconfident';
    return 'indeterminate';
}

function isSyntheticOutcomeRow(row: OutcomeCalibrationCase): boolean {
    return row.synthetic === true
        || normalizeDimension(row.labelType) === 'synthetic'
        || normalizeDimension(row.sourceKind) === 'synthetic'
        || normalizeDimension(row.evidenceType) === 'synthetic';
}

function isCriticalOutcomeRow(row: OutcomeCalibrationCase): boolean {
    const risk = normalizeDimension(row.riskClass ?? row.severity);
    return risk === 'critical' || risk === 'high' || risk === 'emergency';
}

function isTop1Correct(row: OutcomeCalibrationCase): boolean | null {
    if (row.predictedLabel == null) return null;
    return normalizeLabel(row.predictedLabel) === normalizeLabel(row.label);
}

function includesActualInTopK(row: OutcomeCalibrationCase, k: number): boolean {
    const differentials = row.topDifferentials ?? [];
    if (differentials.length === 0) return isTop1Correct(row) === true;
    const actual = normalizeLabel(row.label);
    return differentials
        .slice()
        .sort((left, right) => right.probability - left.probability)
        .slice(0, k)
        .some((entry) => normalizeLabel(entry.label) === actual);
}

function readPredictedProbability(row: OutcomeCalibrationCase): number | null {
    if (row.predictedProbability != null) return clamp01(row.predictedProbability);
    const top = row.topDifferentials?.slice().sort((left, right) => right.probability - left.probability)[0];
    return top ? clamp01(top.probability) : null;
}

function readActualProbability(row: OutcomeCalibrationCase): number | null {
    if (row.actualProbability != null) return clamp01(row.actualProbability);
    const actual = normalizeLabel(row.label);
    const match = row.topDifferentials?.find((entry) => normalizeLabel(entry.label) === actual);
    return match ? clamp01(match.probability) : null;
}

function readCalibrationDelta(row: OutcomeCalibrationCase): number | null {
    if (row.calibrationDelta != null && Number.isFinite(row.calibrationDelta)) return row.calibrationDelta;
    if (row.actualConfidence == null) return null;
    const actualProbability = readActualProbability(row);
    return actualProbability == null ? null : clamp01(row.actualConfidence) - actualProbability;
}

function sanitizeSourceRow(row: OutcomeCalibrationCase): Record<string, unknown> {
    return {
        outcome_event_id: row.outcomeEventId ?? null,
        inference_event_id: row.inferenceEventId ?? null,
        request_id: row.requestId ?? null,
        case_id: row.caseId ?? null,
        tenant_id: row.tenantId,
        label: normalizeLabel(row.label),
        species: normalizeDimension(row.species),
        model_version: normalizeDimension(row.modelVersion),
        evidence_type: normalizeDimension(row.evidenceType),
        severity: normalizeDimension(row.severity ?? row.riskClass),
        predicted_label: row.predictedLabel ? normalizeLabel(row.predictedLabel) : null,
        predicted_probability: readPredictedProbability(row),
        actual_probability: readActualProbability(row),
        calibration_delta: readCalibrationDelta(row),
        top3_labels: row.topDifferentials
            ?.slice()
            .sort((left, right) => right.probability - left.probability)
            .slice(0, 3)
            .map((entry) => normalizeLabel(entry.label)) ?? [],
        synthetic: isSyntheticOutcomeRow(row),
    };
}

function deriveConfidenceBucket(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return 'unknown';
    const lower = Math.min(0.9, Math.max(0, Math.floor(clamp01(value) * 10) / 10));
    return `${lower.toFixed(1)}-${(lower + 0.1).toFixed(1)}`;
}

function normalizeLabel(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeDimension(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundNullable(value: number | null): number | null {
    return value == null ? null : roundMetric(value);
}

function roundSignedNullable(value: number | null): number | null {
    return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(4));
}

function roundMetric(value: number): number {
    return Number(clamp01(value).toFixed(4));
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function digestUnknown(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
