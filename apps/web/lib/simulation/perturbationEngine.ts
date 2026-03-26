import type { PerturbationVector } from '@/lib/simulation/simulationTypes';

export function generatePerturbationVector(m: number): PerturbationVector {
    const load = clamp01(m);

    return {
        noise: roundMetric((load * 0.62) + (load > 0.7 ? 0.08 : 0)),
        contradiction: roundMetric((load * 0.54) + (load * load * 0.26)),
        missingness: roundMetric(Math.max(0, load - 0.08) * 0.82),
        ambiguity: roundMetric((load * 0.48) + (load > 0.45 ? 0.12 : 0)),
        distribution_shift: roundMetric((load * 0.32) + (load > 0.65 ? 0.18 : 0)),
    };
}

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
}

function roundMetric(value: number) {
    return Math.round(clamp01(value) * 1000) / 1000;
}
