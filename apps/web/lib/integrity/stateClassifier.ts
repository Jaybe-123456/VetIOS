import type {
    InstabilityMetrics,
    StateClassification,
} from '@/lib/integrity/types';

interface StateClassificationInput {
    globalPhi: number;
    perturbationScoreM: number;
    instability?: InstabilityMetrics;
    collapseRisk?: number;
    precliffDetected?: boolean;
}

export function classifyState(globalPhi: number, perturbationScoreM: number): StateClassification;
export function classifyState(input: StateClassificationInput): StateClassification;
export function classifyState(
    inputOrGlobalPhi: number | StateClassificationInput,
    perturbationScoreM?: number,
): StateClassification {
    if (typeof inputOrGlobalPhi === 'number') {
        return classifyState({
            globalPhi: inputOrGlobalPhi,
            perturbationScoreM: perturbationScoreM ?? 0,
        });
    }

    const {
        globalPhi,
        perturbationScoreM: resolvedPerturbationScoreM,
        instability,
        collapseRisk = computeCollapseRisk(globalPhi, inputOrGlobalPhi.perturbationScoreM),
        precliffDetected = false,
    } = inputOrGlobalPhi;

    if (globalPhi < 0.38 || resolvedPerturbationScoreM >= 0.82 || collapseRisk >= 0.72) {
        return 'collapsed';
    }

    if (
        precliffDetected
        || (instability != null && instability.critical_instability_index >= 0.32)
        || (instability != null && instability.variance_proxy > 0.58 && instability.divergence > 0.2)
        || globalPhi < 0.58
        || resolvedPerturbationScoreM >= 0.55
    ) {
        return 'metastable';
    }

    if (
        globalPhi < 0.78
        || resolvedPerturbationScoreM >= 0.3
        || (instability != null && (instability.variance_proxy > 0.38 || instability.divergence > 0.16))
    ) {
        return 'fragile';
    }

    return 'stable';
}

export function computeCollapseRisk(
    globalPhi: number,
    perturbationScoreM: number,
    instability?: InstabilityMetrics,
) {
    const baseRisk = (1 - clamp01(globalPhi)) * clamp01(perturbationScoreM);
    const instabilityUplift = instability == null
        ? 0
        : (Math.max(0, instability.divergence) * 0.08) + (instability.variance_proxy * 0.04);
    return roundMetric(baseRisk + instabilityUplift);
}

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
}

function roundMetric(value: number) {
    return Math.round(clamp01(value) * 1000) / 1000;
}
