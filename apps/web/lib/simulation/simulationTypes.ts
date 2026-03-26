import type { IntegrityResult } from '@/lib/integrity/types';

export interface PerturbationVector {
    noise: number;
    contradiction: number;
    missingness: number;
    ambiguity: number;
    distribution_shift: number;
}

export type SimulationMode = 'linear' | 'adaptive';

export type SimulationStep = {
    m: number;
    perturbation_vector: PerturbationVector;
    input_variant: Record<string, unknown>;
    output: Record<string, unknown>;
    integrity: IntegrityResult;
};

export type SimulationResult = {
    base_case: Record<string, unknown>;
    steps: SimulationStep[];
    collapse_threshold?: number;
    precliff_regions: number[];
};

export interface IntegritySweepConfig {
    model: string;
    modelVersion: string;
    steps: number;
    mode: SimulationMode;
    timeoutMs: number;
    maxAdaptiveSteps?: number;
}
