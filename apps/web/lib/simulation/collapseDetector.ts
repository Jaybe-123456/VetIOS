import type {
    SimulationResult,
    SimulationStep,
} from '@/lib/simulation/simulationTypes';

const COLLAPSE_PHI_THRESHOLD = 0.38;
const COLLAPSE_RISK_THRESHOLD = 0.72;

export function detectCollapseThreshold(steps: SimulationStep[]) {
    const orderedSteps = [...steps].sort((a, b) => a.m - b.m);
    const collapseStep = orderedSteps.find((step) =>
        step.integrity.state === 'collapsed'
        || step.integrity.global_phi < COLLAPSE_PHI_THRESHOLD
        || step.integrity.collapse_risk > COLLAPSE_RISK_THRESHOLD,
    );

    return collapseStep ? roundMetric(collapseStep.m) : null;
}

export function detectPrecliffRegions(steps: SimulationStep[]) {
    const orderedSteps = [...steps].sort((a, b) => a.m - b.m);
    const regions: number[] = [];

    for (let index = 0; index < orderedSteps.length; index += 1) {
        const current = orderedSteps[index];
        const previous = orderedSteps[index - 1];
        const divergenceJump = previous == null
            ? 0
            : current.integrity.instability.divergence - previous.integrity.instability.divergence;

        if (
            current.integrity.state === 'metastable'
            || current.integrity.precliff_detected
            || current.integrity.instability.critical_instability_index >= 0.32
            || divergenceJump > 0.12
        ) {
            regions.push(roundMetric(current.m));
        }
    }

    return Array.from(new Set(regions)).sort((a, b) => a - b);
}

export function buildSimulationSummary(result: SimulationResult) {
    return {
        collapse_threshold: result.collapse_threshold ?? null,
        precliff_regions: result.precliff_regions,
        step_count: result.steps.length,
        final_state: result.steps[result.steps.length - 1]?.integrity.state ?? 'stable',
        min_phi: result.steps.reduce((min, step) => Math.min(min, step.integrity.global_phi), 1),
        max_collapse_risk: result.steps.reduce((max, step) => Math.max(max, step.integrity.collapse_risk), 0),
    };
}

function roundMetric(value: number) {
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
