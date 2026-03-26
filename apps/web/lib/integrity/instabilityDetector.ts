import type {
    CapabilityPhi,
    ClinicalIntegrityHistoryEntry,
    ClinicalIntegrityInput,
    InstabilityMetrics,
    PerturbationScore,
} from '@/lib/integrity/types';

const DEFAULT_PRECLIFF_THRESHOLDS = {
    delta_phi: -0.15,
    curvature: -0.05,
    variance_proxy: 0.5,
    divergence: 0.2,
};

interface InstabilityComputationParams {
    input: ClinicalIntegrityInput;
    perturbation: PerturbationScore;
    globalPhi: number;
    recentHistory?: ClinicalIntegrityHistoryEntry[];
}

interface CapabilityInstabilityParams extends InstabilityComputationParams {
    capabilities: CapabilityPhi[];
    instability: InstabilityMetrics;
}

export function computeDeltaPhi(currentPhi: number, baselinePhi: number) {
    return roundSigned(currentPhi - baselinePhi);
}

export function computeCurvature(deltaPhi: number, previousDeltaPhi: number) {
    return roundSigned(deltaPhi - previousDeltaPhi);
}

export function estimateVarianceProxy(
    input: ClinicalIntegrityInput,
    perturbation: PerturbationScore,
) {
    const diagnosis = asRecord(input.outputPayload.diagnosis);
    const confidence = resolveConfidence(input, diagnosis);
    const contradictionScore = numberOrNull(input.contradictionAnalysis?.contradiction_score) ?? 0;
    const topDifferentials = readDifferentials(diagnosis.top_differentials);
    const topGap = computeTopGap(topDifferentials);
    const topSpread = computeTopSpread(topDifferentials);
    const topProbability = topDifferentials[0]?.probability ?? 0;
    const uncertaintyNotes = readStringArray(input.outputPayload.uncertainty_notes);

    let score = 0.06;
    if (topDifferentials.length === 0) {
        score += 0.28;
    } else if (topDifferentials.length < 3) {
        score += 0.12;
    }
    if (topDifferentials.length >= 2 && topGap < 0.08) {
        score += 0.22;
    } else if (topDifferentials.length >= 2 && topGap < 0.15) {
        score += 0.12;
    }
    if (topDifferentials.length >= 3 && topSpread < 0.18) {
        score += 0.14;
    }
    if (confidence != null && topProbability > 0 && Math.abs(confidence - topProbability) > 0.18) {
        score += 0.12;
    }
    score += contradictionScore * 0.28;
    score += perturbation.components.ambiguity * 0.22;
    score += perturbation.components.contradiction * 0.18;
    if (uncertaintyNotes.length >= 4) score += 0.08;

    return roundMetric(score);
}

export function computeDivergence(confidence: number | null, globalPhi: number) {
    if (confidence == null) return 0;
    return roundSigned(confidence - globalPhi);
}

export function computeCriticalInstabilityIndex(deltaPhi: number, varianceProxy: number) {
    return roundMetric(Math.abs(deltaPhi) * (1 + clamp01(varianceProxy)));
}

export function detectPreCliff(
    metrics: InstabilityMetrics,
    _globalPhi: number,
) {
    return metrics.delta_phi < DEFAULT_PRECLIFF_THRESHOLDS.delta_phi
        && metrics.curvature < DEFAULT_PRECLIFF_THRESHOLDS.curvature
        && metrics.variance_proxy > DEFAULT_PRECLIFF_THRESHOLDS.variance_proxy
        && metrics.divergence > DEFAULT_PRECLIFF_THRESHOLDS.divergence;
}

export function computeInstabilityMetrics({
    input,
    perturbation,
    globalPhi,
    recentHistory = [],
}: InstabilityComputationParams): InstabilityMetrics {
    const baselinePhi = resolveBaselinePhi(globalPhi, perturbation, recentHistory);
    const previousDeltaPhi = resolvePreviousDeltaPhi(recentHistory);
    const deltaPhi = computeDeltaPhi(globalPhi, baselinePhi);
    const curvature = computeCurvature(deltaPhi, previousDeltaPhi);
    const varianceProxy = estimateVarianceProxy(input, perturbation);
    const divergence = computeDivergence(resolveConfidence(input, asRecord(input.outputPayload.diagnosis)), globalPhi);
    const criticalInstabilityIndex = computeCriticalInstabilityIndex(deltaPhi, varianceProxy);

    return {
        delta_phi: deltaPhi,
        curvature,
        variance_proxy: varianceProxy,
        divergence,
        critical_instability_index: criticalInstabilityIndex,
    };
}

export function decorateCapabilitiesWithInstability({
    input,
    perturbation,
    globalPhi,
    capabilities,
    instability,
    recentHistory = [],
}: CapabilityInstabilityParams): CapabilityPhi[] {
    const baselineGap = resolveBaselinePhi(globalPhi, perturbation, recentHistory) - globalPhi;
    const confidence = resolveConfidence(input, asRecord(input.outputPayload.diagnosis));
    const previousCapabilities = readPreviousCapabilities(recentHistory);
    const diagnosticRankingInstability = computeRankingInstability(input.outputPayload);

    return capabilities.map((capability) => {
        const previousCapability = previousCapabilities.get(capability.name);
        const baselinePhi = previousCapability?.phi ?? clamp01(capability.phi + baselineGap);
        const deltaPhi = computeDeltaPhi(capability.phi, baselinePhi);
        const curvature = computeCurvature(deltaPhi, previousCapability?.delta_phi ?? 0);
        const varianceProxy = estimateCapabilityVarianceProxy(
            capability.name,
            instability.variance_proxy,
            perturbation,
            diagnosticRankingInstability,
        );
        const divergence = computeDivergence(confidence, capability.phi);
        const nearCollapse = capability.phi < 0.46
            || deltaPhi < -0.15
            || curvature < -0.05
            || (varianceProxy > 0.55 && divergence > 0.2);

        return {
            ...capability,
            delta_phi: deltaPhi,
            curvature,
            variance_proxy: varianceProxy,
            divergence,
            near_collapse: nearCollapse,
            reason: nearCollapse
                ? `${capability.reason} Instability signals suggest this capability is approaching a failure boundary.`
                : capability.reason,
        };
    });
}

function resolveBaselinePhi(
    currentPhi: number,
    perturbation: PerturbationScore,
    recentHistory: ClinicalIntegrityHistoryEntry[],
) {
    const lowPerturbationHistory = recentHistory
        .filter((entry) => Number.isFinite(entry.global_phi) && entry.perturbation_score_m <= 0.25)
        .map((entry) => entry.global_phi);
    if (lowPerturbationHistory.length > 0) {
        return roundMetric(average(lowPerturbationHistory));
    }

    const rollingHistory = recentHistory
        .slice(0, 3)
        .map((entry) => entry.global_phi)
        .filter((value) => Number.isFinite(value));
    if (rollingHistory.length > 0) {
        return roundMetric(average(rollingHistory));
    }

    return roundMetric(Math.max(currentPhi, expectedLowPerturbationBaseline(perturbation)));
}

function expectedLowPerturbationBaseline(perturbation: PerturbationScore) {
    return clamp01(
        0.92
        - (perturbation.components.contradiction * 0.08)
        - (perturbation.components.missingness * 0.06)
        - (perturbation.components.distribution_shift * 0.1)
        - (perturbation.components.noise * 0.04)
        - (perturbation.components.ambiguity * 0.04),
    );
}

function resolvePreviousDeltaPhi(recentHistory: ClinicalIntegrityHistoryEntry[]) {
    const latest = recentHistory[0];
    if (!latest) return 0;

    const details = asRecord(latest.details);
    const instability = asRecord(details.instability);
    return numberOrNull(instability.delta_phi) ?? numberOrNull(details.delta_phi) ?? 0;
}

function readPreviousCapabilities(recentHistory: ClinicalIntegrityHistoryEntry[]) {
    const latest = recentHistory[0];
    const map = new Map<string, CapabilityPhi>();
    if (!latest) return map;

    const details = asRecord(latest.details);
    const capabilities = Array.isArray(details.capabilities) ? details.capabilities : [];
    for (const capability of capabilities) {
        if (typeof capability !== 'object' || capability === null || Array.isArray(capability)) continue;
        const record = capability as Record<string, unknown>;
        const name = readString(record.name);
        const phi = numberOrNull(record.phi);
        if (!name || phi == null) continue;
        map.set(name, {
            name,
            phi: clamp01(phi),
            delta_phi: numberOrNull(record.delta_phi) ?? undefined,
            curvature: numberOrNull(record.curvature) ?? undefined,
            variance_proxy: numberOrNull(record.variance_proxy) ?? undefined,
            divergence: numberOrNull(record.divergence) ?? undefined,
            near_collapse: typeof record.near_collapse === 'boolean' ? record.near_collapse : undefined,
            reason: readString(record.reason) ?? '',
        });
    }
    return map;
}

function estimateCapabilityVarianceProxy(
    capabilityName: string,
    globalVarianceProxy: number,
    perturbation: PerturbationScore,
    diagnosticRankingInstability: number,
) {
    let score = globalVarianceProxy * 0.68;

    if (capabilityName === 'diagnostic_stability') {
        score += diagnosticRankingInstability * 0.3;
        score += perturbation.components.noise * 0.08;
    } else if (capabilityName === 'triage_safety') {
        score += perturbation.components.missingness * 0.16;
        score += perturbation.components.ambiguity * 0.08;
    } else if (capabilityName === 'contradiction_handling') {
        score += perturbation.components.contradiction * 0.22;
    } else if (capabilityName === 'calibration_integrity') {
        score += perturbation.components.ambiguity * 0.12;
        score += perturbation.components.missingness * 0.08;
    }

    return roundMetric(score);
}

function computeRankingInstability(outputPayload: Record<string, unknown>) {
    const diagnosis = asRecord(outputPayload.diagnosis);
    const topDifferentials = readDifferentials(diagnosis.top_differentials);
    const topGap = computeTopGap(topDifferentials);
    const topSpread = computeTopSpread(topDifferentials);

    let score = 0;
    if (topDifferentials.length >= 2 && topGap < 0.08) score += 0.34;
    else if (topDifferentials.length >= 2 && topGap < 0.15) score += 0.18;
    if (topDifferentials.length >= 3 && topSpread < 0.18) score += 0.2;
    if (topDifferentials.length < 3) score += 0.12;

    return clamp01(score);
}

function computeTopGap(differentials: Array<{ probability: number }>) {
    if (differentials.length < 2) return 1;
    return Math.max(0, differentials[0].probability - differentials[1].probability);
}

function computeTopSpread(differentials: Array<{ probability: number }>) {
    if (differentials.length < 3) return 1;
    return Math.max(0, differentials[0].probability - differentials[2].probability);
}

function resolveConfidence(
    input: ClinicalIntegrityInput,
    diagnosis: Record<string, unknown>,
) {
    return numberOrNull(input.confidenceScore)
        ?? numberOrNull(diagnosis.confidence_score)
        ?? numberOrNull(input.outputPayload.confidence_score);
}

function readDifferentials(value: unknown) {
    if (!Array.isArray(value)) return [] as Array<{ probability: number }>;
    return value
        .map((entry) => {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
            const record = entry as Record<string, unknown>;
            const probability = clamp01(numberOrNull(record.probability) ?? 0);
            return { probability };
        })
        .filter((entry): entry is { probability: number } => entry !== null);
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry): entry is string => entry.length > 0);
}

function numberOrNull(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function average(values: number[]) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
}

function roundMetric(value: number) {
    return Math.round(clamp01(value) * 1000) / 1000;
}

function roundSigned(value: number) {
    return Math.round(Math.max(-1, Math.min(1, value)) * 1000) / 1000;
}
