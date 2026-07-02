import { createHash } from 'crypto';

type MonitoringSupabaseClient = {
    from: (table: string) => unknown;
};

type QueryResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;

export type InferenceMonitoringStatus = 'insufficient_evidence' | 'healthy' | 'degraded' | 'rollback_recommended';
export type InferenceFinalState = 'trusted' | 'review' | 'hold' | 'suppress';
export type InferenceRiskClass = 'routine' | 'elevated' | 'high' | 'critical';

export interface InferenceMonitoringSignal {
    tenantId: string;
    inferenceEventId?: string | null;
    requestId?: string | null;
    modelVersion?: string | null;
    species?: string | null;
    topLabel?: string | null;
    topConfidence?: number | null;
    finalState: InferenceFinalState;
    riskClass?: InferenceRiskClass | null;
    calibrationStatus?: string | null;
    actionabilityDecision?: string | null;
    trainingEligible?: boolean | null;
    latencyMs?: number | null;
    outcomeConfirmed?: boolean | null;
    predictionCorrect?: boolean | null;
    blockers?: string[];
    warnings?: string[];
    synthetic?: boolean;
    createdAt?: string | null;
}

export interface InferencePostmarketMonitoringInput {
    tenantId: string;
    requestId?: string | null;
    modelVersion?: string | null;
    species?: string | null;
    topLabel?: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
    minimumSignals?: number;
    latencyP95ThresholdMs?: number;
    signals: InferenceMonitoringSignal[];
}

export interface InferencePostmarketMonitoringEvent {
    tenant_id: string;
    request_id: string | null;
    model_version: string | null;
    species: string | null;
    top_label: string | null;
    monitoring_window_start: string | null;
    monitoring_window_end: string | null;
    inference_count: number;
    outcome_confirmed_count: number;
    trusted_count: number;
    review_count: number;
    hold_count: number;
    suppress_count: number;
    critical_count: number;
    training_eligible_count: number;
    high_confidence_uncalibrated_count: number;
    security_boundary_failed_count: number;
    synthetic_rows_excluded: number;
    mean_confidence: number | null;
    mean_latency_ms: number | null;
    latency_p95_ms: number | null;
    outcome_confirmation_rate: number;
    review_rate: number;
    hold_rate: number;
    suppress_rate: number;
    critical_hold_rate: number;
    security_block_rate: number;
    label_distribution_shift: number | null;
    reliability_regression_score: number;
    monitoring_status: InferenceMonitoringStatus;
    rollback_recommended: boolean;
    blockers: string[];
    warnings: string[];
    packet_digest: string;
    monitoring_packet: Record<string, unknown>;
}

export async function recordInferencePostmarketMonitoringEvent(
    client: MonitoringSupabaseClient,
    input: InferencePostmarketMonitoringInput,
): Promise<{ data: InferencePostmarketMonitoringEvent | null; error: string | null }> {
    const event = buildInferencePostmarketMonitoringEvent(input);
    const table = client.from('inference_postmarket_monitoring_events') as {
        insert: (payload: Record<string, unknown>) => {
            select: (columns: string) => {
                single: () => QueryResult<Record<string, unknown>>;
            };
        };
    };

    const { data, error } = await table
        .insert({ ...event })
        .select('tenant_id, request_id, model_version, species, top_label, monitoring_window_start, monitoring_window_end, inference_count, outcome_confirmed_count, trusted_count, review_count, hold_count, suppress_count, critical_count, training_eligible_count, high_confidence_uncalibrated_count, security_boundary_failed_count, synthetic_rows_excluded, mean_confidence, mean_latency_ms, latency_p95_ms, outcome_confirmation_rate, review_rate, hold_rate, suppress_rate, critical_hold_rate, security_block_rate, label_distribution_shift, reliability_regression_score, monitoring_status, rollback_recommended, blockers, warnings, packet_digest, monitoring_packet')
        .single();

    if (error) return { data: null, error: error.message ?? 'inference_postmarket_monitoring_insert_failed' };
    return { data: data ? normalizeMonitoringRow(data) : null, error: data ? null : 'inference_postmarket_monitoring_insert_returned_no_row' };
}

export function buildInferencePostmarketMonitoringEvent(
    input: InferencePostmarketMonitoringInput,
): InferencePostmarketMonitoringEvent {
    const minimumSignals = Math.max(1, Math.trunc(input.minimumSignals ?? 20));
    const syntheticSignals = input.signals.filter((signal) => signal.synthetic === true);
    const signals = input.signals.filter((signal) => signal.synthetic !== true);
    const count = signals.length;
    const trusted = signals.filter((signal) => signal.finalState === 'trusted');
    const review = signals.filter((signal) => signal.finalState === 'review');
    const hold = signals.filter((signal) => signal.finalState === 'hold');
    const suppress = signals.filter((signal) => signal.finalState === 'suppress');
    const critical = signals.filter((signal) => readRiskClass(signal.riskClass) === 'critical');
    const criticalHold = critical.filter((signal) => signal.finalState === 'hold' || signal.finalState === 'suppress');
    const highConfidenceUncalibrated = signals.filter((signal) => (
        clamp01(signal.topConfidence ?? 0) >= 0.8
        && signal.calibrationStatus === 'needs_outcome'
    ));
    const securityBlocked = signals.filter((signal) => signal.blockers?.includes('security_boundary_failed'));
    const confidenceValues = signals.map((signal) => readNumber(signal.topConfidence)).filter((value): value is number => value != null);
    const latencyValues = signals.map((signal) => readNumber(signal.latencyMs)).filter((value): value is number => value != null);
    const labelShift = computeLabelDistributionShift(signals);
    const suppressRate = rate(suppress.length, count);
    const holdRate = rate(hold.length, count);
    const reviewRate = rate(review.length, count);
    const criticalHoldRate = rate(criticalHold.length, critical.length);
    const securityBlockRate = rate(securityBlocked.length, count);
    const outcomeConfirmationRate = rate(signals.filter((signal) => signal.outcomeConfirmed === true).length, count);
    const latencyP95Ms = percentile(latencyValues, 0.95);
    const latencyThreshold = input.latencyP95ThresholdMs ?? 12000;
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (count < minimumSignals) blockers.push('insufficient_live_inference_signals');
    if (suppressRate >= 0.05) blockers.push('suppression_rate_above_threshold');
    if (criticalHoldRate >= 0.1) blockers.push('critical_case_hold_rate_above_threshold');
    if (securityBlockRate > 0) blockers.push('security_boundary_failures_present');
    if (labelShift != null && labelShift >= 0.25) blockers.push('label_distribution_shift_above_threshold');
    if (latencyP95Ms != null && latencyP95Ms >= latencyThreshold) blockers.push('latency_p95_above_threshold');

    if (holdRate >= 0.15) warnings.push('hold_rate_elevated');
    if (reviewRate >= 0.35) warnings.push('review_rate_elevated');
    if (outcomeConfirmationRate < 0.2) warnings.push('outcome_confirmation_rate_low');
    if (highConfidenceUncalibrated.length > 0) warnings.push('high_confidence_uncalibrated_outputs_present');
    if (syntheticSignals.length > 0) warnings.push('synthetic_signals_excluded_from_postmarket_monitoring');

    const reliabilityRegressionScore = computeRegressionScore({
        suppressRate,
        holdRate,
        criticalHoldRate,
        securityBlockRate,
        labelShift,
        latencyP95Ms,
        latencyThreshold,
    });
    const monitoringStatus = classifyMonitoringStatus({
        count,
        minimumSignals,
        blockers,
        warnings,
        reliabilityRegressionScore,
    });
    const rollbackRecommended = monitoringStatus === 'rollback_recommended';
    const packet = {
        version: 'vetios_inference_postmarket_monitoring_v1',
        source_signal_count: input.signals.length,
        live_signal_count: count,
        synthetic_rows_excluded: syntheticSignals.length,
        label_distribution: buildLabelDistribution(signals),
        state_distribution: {
            trusted: trusted.length,
            review: review.length,
            hold: hold.length,
            suppress: suppress.length,
        },
        thresholds: {
            minimum_signals: minimumSignals,
            suppress_rate: 0.05,
            critical_hold_rate: 0.1,
            label_distribution_shift: 0.25,
            latency_p95_ms: latencyThreshold,
        },
        privacy_boundary: 'aggregate monitoring metrics and event references only; no raw clinical narratives, owner identifiers, retrieved source text, or raw model output',
        source_event_refs: signals.slice(0, 100).map((signal) => ({
            inference_event_id: signal.inferenceEventId ?? null,
            request_id: signal.requestId ?? null,
            final_state: signal.finalState,
        })),
    };

    return {
        tenant_id: input.tenantId,
        request_id: input.requestId ?? null,
        model_version: input.modelVersion ?? firstString(signals.map((signal) => signal.modelVersion)),
        species: input.species ?? firstString(signals.map((signal) => signal.species)),
        top_label: input.topLabel ?? firstString(signals.map((signal) => signal.topLabel)),
        monitoring_window_start: input.windowStart ?? firstString(signals.map((signal) => signal.createdAt)),
        monitoring_window_end: input.windowEnd ?? lastString(signals.map((signal) => signal.createdAt)),
        inference_count: count,
        outcome_confirmed_count: signals.filter((signal) => signal.outcomeConfirmed === true).length,
        trusted_count: trusted.length,
        review_count: review.length,
        hold_count: hold.length,
        suppress_count: suppress.length,
        critical_count: critical.length,
        training_eligible_count: signals.filter((signal) => signal.trainingEligible === true).length,
        high_confidence_uncalibrated_count: highConfidenceUncalibrated.length,
        security_boundary_failed_count: securityBlocked.length,
        synthetic_rows_excluded: syntheticSignals.length,
        mean_confidence: roundNullable(confidenceValues.length > 0 ? mean(confidenceValues) : null),
        mean_latency_ms: latencyValues.length > 0 ? Math.round(mean(latencyValues)) : null,
        latency_p95_ms: latencyP95Ms == null ? null : Math.round(latencyP95Ms),
        outcome_confirmation_rate: roundMetric(outcomeConfirmationRate),
        review_rate: roundMetric(reviewRate),
        hold_rate: roundMetric(holdRate),
        suppress_rate: roundMetric(suppressRate),
        critical_hold_rate: roundMetric(criticalHoldRate),
        security_block_rate: roundMetric(securityBlockRate),
        label_distribution_shift: roundNullable(labelShift),
        reliability_regression_score: roundMetric(reliabilityRegressionScore),
        monitoring_status: monitoringStatus,
        rollback_recommended: rollbackRecommended,
        blockers: Array.from(new Set(blockers)),
        warnings: Array.from(new Set(warnings)),
        packet_digest: digestUnknown(packet),
        monitoring_packet: packet,
    };
}

function classifyMonitoringStatus(input: {
    count: number;
    minimumSignals: number;
    blockers: string[];
    warnings: string[];
    reliabilityRegressionScore: number;
}): InferenceMonitoringStatus {
    if (input.count < input.minimumSignals) return 'insufficient_evidence';
    if (input.reliabilityRegressionScore >= 0.65 || input.blockers.length >= 2) return 'rollback_recommended';
    if (input.blockers.length > 0 || input.warnings.length > 0 || input.reliabilityRegressionScore >= 0.35) return 'degraded';
    return 'healthy';
}

function computeRegressionScore(input: {
    suppressRate: number;
    holdRate: number;
    criticalHoldRate: number;
    securityBlockRate: number;
    labelShift: number | null;
    latencyP95Ms: number | null;
    latencyThreshold: number;
}): number {
    const latencyPressure = input.latencyP95Ms == null
        ? 0
        : Math.min(1, input.latencyP95Ms / Math.max(1, input.latencyThreshold));
    return clamp01(
        (input.suppressRate * 3)
        + (input.holdRate * 1.2)
        + (input.criticalHoldRate * 2)
        + (input.securityBlockRate * 2)
        + ((input.labelShift ?? 0) * 1.2)
        + (latencyPressure * 0.25),
    );
}

function computeLabelDistributionShift(signals: InferenceMonitoringSignal[]): number | null {
    const labeled = signals
        .filter((signal) => readString(signal.topLabel))
        .slice()
        .sort((left, right) => {
            const leftTime = Date.parse(left.createdAt ?? '');
            const rightTime = Date.parse(right.createdAt ?? '');
            return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
        });
    if (labeled.length < 6) return null;
    const midpoint = Math.floor(labeled.length / 2);
    return totalVariationDistance(
        buildLabelDistribution(labeled.slice(0, midpoint)),
        buildLabelDistribution(labeled.slice(midpoint)),
    );
}

function buildLabelDistribution(signals: InferenceMonitoringSignal[]): Record<string, number> {
    const counts = new Map<string, number>();
    for (const signal of signals) {
        const label = readString(signal.topLabel);
        if (!label) continue;
        const key = normalizeLabel(label);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
    const distribution: Record<string, number> = {};
    if (total === 0) return distribution;
    for (const [label, value] of counts.entries()) {
        distribution[label] = roundMetric(value / total);
    }
    return distribution;
}

function totalVariationDistance(left: Record<string, number>, right: Record<string, number>): number {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    let distance = 0;
    for (const key of keys) {
        distance += Math.abs((left[key] ?? 0) - (right[key] ?? 0));
    }
    return clamp01(distance / 2);
}

function normalizeMonitoringRow(row: Record<string, unknown>): InferencePostmarketMonitoringEvent {
    return {
        tenant_id: readString(row.tenant_id) ?? '',
        request_id: readString(row.request_id),
        model_version: readString(row.model_version),
        species: readString(row.species),
        top_label: readString(row.top_label),
        monitoring_window_start: readString(row.monitoring_window_start),
        monitoring_window_end: readString(row.monitoring_window_end),
        inference_count: Math.trunc(readNumber(row.inference_count) ?? 0),
        outcome_confirmed_count: Math.trunc(readNumber(row.outcome_confirmed_count) ?? 0),
        trusted_count: Math.trunc(readNumber(row.trusted_count) ?? 0),
        review_count: Math.trunc(readNumber(row.review_count) ?? 0),
        hold_count: Math.trunc(readNumber(row.hold_count) ?? 0),
        suppress_count: Math.trunc(readNumber(row.suppress_count) ?? 0),
        critical_count: Math.trunc(readNumber(row.critical_count) ?? 0),
        training_eligible_count: Math.trunc(readNumber(row.training_eligible_count) ?? 0),
        high_confidence_uncalibrated_count: Math.trunc(readNumber(row.high_confidence_uncalibrated_count) ?? 0),
        security_boundary_failed_count: Math.trunc(readNumber(row.security_boundary_failed_count) ?? 0),
        synthetic_rows_excluded: Math.trunc(readNumber(row.synthetic_rows_excluded) ?? 0),
        mean_confidence: readNumber(row.mean_confidence),
        mean_latency_ms: readNumber(row.mean_latency_ms),
        latency_p95_ms: readNumber(row.latency_p95_ms),
        outcome_confirmation_rate: readNumber(row.outcome_confirmation_rate) ?? 0,
        review_rate: readNumber(row.review_rate) ?? 0,
        hold_rate: readNumber(row.hold_rate) ?? 0,
        suppress_rate: readNumber(row.suppress_rate) ?? 0,
        critical_hold_rate: readNumber(row.critical_hold_rate) ?? 0,
        security_block_rate: readNumber(row.security_block_rate) ?? 0,
        label_distribution_shift: readNumber(row.label_distribution_shift),
        reliability_regression_score: readNumber(row.reliability_regression_score) ?? 0,
        monitoring_status: readMonitoringStatus(row.monitoring_status),
        rollback_recommended: row.rollback_recommended === true,
        blockers: readStringArray(row.blockers),
        warnings: readStringArray(row.warnings),
        packet_digest: readString(row.packet_digest) ?? '',
        monitoring_packet: asRecord(row.monitoring_packet),
    };
}

function readMonitoringStatus(value: unknown): InferenceMonitoringStatus {
    return value === 'insufficient_evidence'
        || value === 'healthy'
        || value === 'degraded'
        || value === 'rollback_recommended'
        ? value
        : 'insufficient_evidence';
}

function readRiskClass(value: unknown): InferenceRiskClass {
    return value === 'routine' || value === 'elevated' || value === 'high' || value === 'critical'
        ? value
        : 'routine';
}

function rate(numerator: number, denominator: number): number {
    return denominator > 0 ? numerator / denominator : 0;
}

function percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = values.slice().sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
    return sorted[index] ?? null;
}

function firstString(values: Array<string | null | undefined>): string | null {
    for (const value of values) {
        const text = readString(value);
        if (text) return text;
    }
    return null;
}

function lastString(values: Array<string | null | undefined>): string | null {
    for (let index = values.length - 1; index >= 0; index -= 1) {
        const text = readString(values[index]);
        if (text) return text;
    }
    return null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(readString).filter((entry): entry is string => Boolean(entry))
        : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeLabel(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundNullable(value: number | null): number | null {
    return value == null || !Number.isFinite(value) ? null : roundMetric(value);
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
