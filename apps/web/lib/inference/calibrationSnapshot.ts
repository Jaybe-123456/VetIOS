import { createHash } from 'crypto';

type CalibrationSupabaseClient = {
    from: (table: string) => unknown;
};

type QueryResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;

export interface InferenceCalibrationSnapshotInput {
    tenantId: string;
    inferenceEventId: string;
    requestId?: string | null;
    caseId?: string | null;
    modelName?: string | null;
    modelVersion?: string | null;
    schemaVersion?: string | null;
    sourceModule?: string | null;
    ranker?: string | null;
    outputPayload: Record<string, unknown>;
    confidenceScore?: number | null;
    phiHat?: number | null;
}

export interface InferenceCalibrationSnapshot {
    id?: string;
    inference_event_id: string;
    top_label: string | null;
    top_confidence: number;
    phi_hat: number;
    contradiction_score: number;
    differential_count: number;
    differential_entropy: number;
    margin_top2: number;
    calibration_bucket: string;
    calibration_status: 'needs_outcome' | 'calibrated' | 'underconfident' | 'overconfident' | 'indeterminate';
    historical_sample_count: number;
    historical_mean_delta: number | null;
    expected_calibration_error: number | null;
    calibration_reliability_score: number;
    reliability_badge: 'HIGH' | 'REVIEW' | 'CAUTION' | 'SUPPRESSED';
    recommended_action: string;
    snapshot: Record<string, unknown>;
    created_at?: string;
}

export async function recordInferenceCalibrationSnapshot(
    client: CalibrationSupabaseClient,
    input: InferenceCalibrationSnapshotInput,
): Promise<{ data: InferenceCalibrationSnapshot | null; error: string | null }> {
    const computed = await buildInferenceCalibrationSnapshot(client, input);
    const row = {
        tenant_id: input.tenantId,
        inference_event_id: input.inferenceEventId,
        request_id: input.requestId ?? null,
        case_id: input.caseId ?? null,
        model_name: input.modelName ?? readString(asRecord(input.outputPayload.governance_lineage).model_name),
        model_version: input.modelVersion ?? readString(asRecord(input.outputPayload.governance_lineage).model_version),
        schema_version: input.schemaVersion ?? readString(asRecord(input.outputPayload.governance_lineage).schema_version),
        source_module: input.sourceModule ?? null,
        ranker: input.ranker ?? readString(input.outputPayload.ranker),
        ...computed,
    };

    const table = client.from('inference_calibration_snapshots') as {
        insert: (payload: Record<string, unknown>) => {
            select: (columns: string) => {
                single: () => QueryResult<Record<string, unknown>>;
            };
        };
    };

    const { data, error } = await table
        .insert(row)
        .select('id, inference_event_id, top_label, top_confidence, phi_hat, contradiction_score, differential_count, differential_entropy, margin_top2, calibration_bucket, calibration_status, historical_sample_count, historical_mean_delta, expected_calibration_error, calibration_reliability_score, reliability_badge, recommended_action, snapshot, created_at')
        .single();

    if (error) {
        console.warn(JSON.stringify({
            event: 'inference_calibration_snapshot_insert_failed',
            inference_event_id: input.inferenceEventId,
            error: error.message ?? 'unknown',
        }));
        return { data: null, error: error.message ?? 'snapshot_insert_failed' };
    }

    if (!data) return { data: null, error: 'snapshot_insert_returned_no_row' };
    return { data: normalizeSnapshotRow(data), error: null };
}

export async function loadLatestInferenceCalibrationSnapshot(
    client: CalibrationSupabaseClient,
    tenantId: string,
    inferenceEventId: string,
): Promise<{ data: InferenceCalibrationSnapshot | null; error: string | null }> {
    const table = client.from('inference_calibration_snapshots') as {
        select: (columns: string) => {
            eq: (column: string, value: string) => {
                eq: (column: string, value: string) => {
                    order: (column: string, options: { ascending: boolean }) => {
                        limit: (count: number) => {
                            maybeSingle: () => QueryResult<Record<string, unknown>>;
                        };
                    };
                };
            };
        };
    };

    const { data, error } = await table
        .select('id, inference_event_id, top_label, top_confidence, phi_hat, contradiction_score, differential_count, differential_entropy, margin_top2, calibration_bucket, calibration_status, historical_sample_count, historical_mean_delta, expected_calibration_error, calibration_reliability_score, reliability_badge, recommended_action, snapshot, created_at')
        .eq('tenant_id', tenantId)
        .eq('inference_event_id', inferenceEventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) return { data: null, error: error.message ?? 'snapshot_lookup_failed' };
    return { data: data ? normalizeSnapshotRow(data) : null, error: null };
}

export async function buildInferenceCalibrationSnapshot(
    client: CalibrationSupabaseClient,
    input: InferenceCalibrationSnapshotInput,
): Promise<Omit<InferenceCalibrationSnapshot, 'id' | 'inference_event_id' | 'created_at'>> {
    const differentials = extractDifferentialDistribution(input.outputPayload);
    const top = differentials[0] ?? null;
    const second = differentials[1] ?? null;
    const confidence = clamp01(input.confidenceScore ?? top?.probability ?? readNumber(input.outputPayload.confidence_score) ?? 0);
    const phiHat = clamp01(input.phiHat ?? readNumber(input.outputPayload.phi_hat) ?? readNumber(asRecord(input.outputPayload.cire).phi_hat) ?? 0);
    const contradictionScore = clamp01(readNumber(input.outputPayload.contradiction_score)
        ?? readNumber(asRecord(input.outputPayload.contradiction_analysis).contradiction_score)
        ?? 0);
    const marginTop2 = clamp01(top && second ? top.probability - second.probability : top?.probability ?? 0);
    const entropy = computeNormalizedEntropy(differentials.map((entry) => entry.probability));
    const historical = top?.label
        ? await loadLabelCalibration(client, input.tenantId, top.label)
        : { sampleCount: 0, meanDelta: null };
    const status = classifyCalibrationStatus(historical.sampleCount, historical.meanDelta);
    const expectedError = historical.meanDelta == null ? null : roundMetric(Math.abs(historical.meanDelta));
    const reliabilityScore = clamp01(
        (confidence * 0.3)
        + (phiHat * 0.3)
        + (marginTop2 * 0.2)
        + ((1 - contradictionScore) * 0.2),
    );
    const badge = classifyReliabilityBadge(reliabilityScore, contradictionScore, phiHat);

    return {
        top_label: top?.label ?? null,
        top_confidence: roundMetric(confidence),
        phi_hat: roundMetric(phiHat),
        contradiction_score: roundMetric(contradictionScore),
        differential_count: differentials.length,
        differential_entropy: roundMetric(entropy),
        margin_top2: roundMetric(marginTop2),
        calibration_bucket: deriveCalibrationBucket(confidence),
        calibration_status: status,
        historical_sample_count: historical.sampleCount,
        historical_mean_delta: historical.meanDelta == null ? null : roundSignedMetric(historical.meanDelta),
        expected_calibration_error: expectedError,
        calibration_reliability_score: roundMetric(reliabilityScore),
        reliability_badge: badge,
        recommended_action: recommendCalibrationAction(status, badge, historical.sampleCount),
        snapshot: {
            algorithm_version: 'vetios_inference_calibration_snapshot_v1',
            distribution_digest: digestUnknown(differentials),
            top_label: top?.label ?? null,
            differential_labels: differentials.slice(0, 8).map((entry) => entry.label),
            historical_calibration_source: historical.sampleCount > 0 ? 'label_calibration' : 'none',
            privacy_boundary: 'no raw symptoms, notes, owner identifiers, patient names, contacts, or microchip IDs stored',
        },
    };
}

async function loadLabelCalibration(
    client: CalibrationSupabaseClient,
    tenantId: string,
    label: string,
): Promise<{ sampleCount: number; meanDelta: number | null }> {
    try {
        const table = client.from('label_calibration') as {
            select: (columns: string) => {
                eq: (column: string, value: string) => {
                    eq: (column: string, value: string) => {
                        maybeSingle: () => QueryResult<Record<string, unknown>>;
                    };
                };
            };
        };
        const { data, error } = await table
            .select('sample_count, mean_delta, cumulative_delta')
            .eq('tenant_id', tenantId)
            .eq('label', label)
            .maybeSingle();
        if (error || !data) return { sampleCount: 0, meanDelta: null };
        const sampleCount = Math.max(0, Math.trunc(readNumber(data.sample_count) ?? 0));
        const meanDelta = readNumber(data.mean_delta)
            ?? (sampleCount > 0 ? (readNumber(data.cumulative_delta) ?? 0) / sampleCount : null);
        return { sampleCount, meanDelta };
    } catch {
        return { sampleCount: 0, meanDelta: null };
    }
}

export function extractDifferentialDistribution(outputPayload: Record<string, unknown>): Array<{ label: string; probability: number }> {
    const direct = Array.isArray(outputPayload.differentials) ? outputPayload.differentials : [];
    const diagnosisTop = Array.isArray(asRecord(outputPayload.diagnosis).top_differentials)
        ? asRecord(outputPayload.diagnosis).top_differentials as unknown[]
        : [];
    const source = direct.length > 0 ? direct : diagnosisTop;

    return source
        .map((entry) => {
            const record = asRecord(entry);
            const label = readString(record.label)
                ?? readString(record.name)
                ?? readString(record.condition);
            const probability = readNumber(record.p)
                ?? readNumber(record.probability)
                ?? readNumber(record.confidence);
            if (!label || probability == null) return null;
            return { label: normalizeLabel(label), probability: clamp01(probability) };
        })
        .filter((entry): entry is { label: string; probability: number } => entry != null)
        .sort((left, right) => right.probability - left.probability)
        .slice(0, 12);
}

function classifyCalibrationStatus(
    sampleCount: number,
    meanDelta: number | null,
): InferenceCalibrationSnapshot['calibration_status'] {
    if (sampleCount < 5 || meanDelta == null) return 'needs_outcome';
    if (meanDelta > 0.08) return 'underconfident';
    if (meanDelta < -0.08) return 'overconfident';
    return 'calibrated';
}

function classifyReliabilityBadge(
    reliabilityScore: number,
    contradictionScore: number,
    phiHat: number,
): InferenceCalibrationSnapshot['reliability_badge'] {
    if (contradictionScore >= 0.75 || phiHat < 0.25) return 'SUPPRESSED';
    if (reliabilityScore >= 0.72 && contradictionScore < 0.35) return 'HIGH';
    if (reliabilityScore >= 0.5) return 'REVIEW';
    return 'CAUTION';
}

function recommendCalibrationAction(
    status: InferenceCalibrationSnapshot['calibration_status'],
    badge: InferenceCalibrationSnapshot['reliability_badge'],
    sampleCount: number,
): string {
    if (badge === 'SUPPRESSED') return 'Hold automated use; require clinician review and outcome confirmation.';
    if (status === 'needs_outcome') return `Collect at least ${Math.max(0, 5 - sampleCount)} more confirmed outcomes for this label before treating confidence as calibrated.`;
    if (status === 'underconfident') return 'Historical outcomes suggest this label may be under-confident; monitor before raising displayed certainty.';
    if (status === 'overconfident') return 'Historical outcomes suggest this label may be over-confident; require confirmatory testing before action.';
    return 'Calibration evidence is within operating tolerance; continue outcome monitoring.';
}

function deriveCalibrationBucket(confidence: number): string {
    const lower = Math.min(0.9, Math.max(0, Math.floor(confidence * 10) / 10));
    return `${lower.toFixed(1)}-${(lower + 0.1).toFixed(1)}`;
}

function computeNormalizedEntropy(probabilities: number[]): number {
    const positive = probabilities.filter((value) => value > 0);
    if (positive.length <= 1) return 0;
    const total = positive.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return 0;
    const entropy = positive.reduce((sum, value) => {
        const p = value / total;
        return sum - p * Math.log(p);
    }, 0);
    return clamp01(entropy / Math.log(positive.length));
}

function normalizeSnapshotRow(row: Record<string, unknown>): InferenceCalibrationSnapshot {
    return {
        id: readString(row.id) ?? undefined,
        inference_event_id: readString(row.inference_event_id) ?? '',
        top_label: readString(row.top_label),
        top_confidence: readNumber(row.top_confidence) ?? 0,
        phi_hat: readNumber(row.phi_hat) ?? 0,
        contradiction_score: readNumber(row.contradiction_score) ?? 0,
        differential_count: Math.trunc(readNumber(row.differential_count) ?? 0),
        differential_entropy: readNumber(row.differential_entropy) ?? 0,
        margin_top2: readNumber(row.margin_top2) ?? 0,
        calibration_bucket: readString(row.calibration_bucket) ?? '0.0-0.1',
        calibration_status: readCalibrationStatus(row.calibration_status),
        historical_sample_count: Math.trunc(readNumber(row.historical_sample_count) ?? 0),
        historical_mean_delta: readNumber(row.historical_mean_delta),
        expected_calibration_error: readNumber(row.expected_calibration_error),
        calibration_reliability_score: readNumber(row.calibration_reliability_score) ?? 0,
        reliability_badge: readReliabilityBadge(row.reliability_badge),
        recommended_action: readString(row.recommended_action) ?? 'Continue outcome monitoring.',
        snapshot: asRecord(row.snapshot),
        created_at: readString(row.created_at) ?? undefined,
    };
}

function readCalibrationStatus(value: unknown): InferenceCalibrationSnapshot['calibration_status'] {
    return value === 'needs_outcome'
        || value === 'calibrated'
        || value === 'underconfident'
        || value === 'overconfident'
        || value === 'indeterminate'
        ? value
        : 'indeterminate';
}

function readReliabilityBadge(value: unknown): InferenceCalibrationSnapshot['reliability_badge'] {
    return value === 'HIGH' || value === 'REVIEW' || value === 'CAUTION' || value === 'SUPPRESSED'
        ? value
        : 'REVIEW';
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

function normalizeLabel(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function roundMetric(value: number): number {
    return Number(clamp01(value).toFixed(4));
}

function roundSignedMetric(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(4));
}
