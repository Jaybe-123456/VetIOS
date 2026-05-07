import type { DifferentialEntry, InferenceRequest } from '../inference/types';
import type { EncounterPayloadV2 } from '@vetios/inference-schema';

export type PerturbationType =
    | 'symptom_noise'
    | 'contradiction_pressure'
    | 'ambiguity'
    | 'missingness'
    | 'distribution_shift';

export interface AdversarialSweepConfig {
    target_condition: string;
    perturbation_types: PerturbationType[];
    noise_levels: number[];
    contradiction_levels: number[];
    sweep_steps: number;
}

export interface EvidenceThreshold {
    finding: string;
    finding_type: string;
    probability_delta: number;
    resulting_probability: number;
    resulting_rank: number;
    is_sufficient_alone: boolean;
}

export interface AdversarialStep {
    step_number: number;
    noise_level: number;
    contradiction_level: number;
    differential_at_step: Array<{ condition_id: string; probability: number; rank: number }>;
    target_condition_rank: number;
    target_condition_probability: number;
    phi: number;
    divergence_from_baseline: number;
    rank_inversions: number;
    collapse_detected: boolean;
    collapse_type?: string;
}

export interface AdversarialStabilityReport {
    sweep_config: {
        target_condition: string;
        perturbation_types: PerturbationType[];
        noise_levels: number[];
        contradiction_levels: number[];
        sweep_steps: number;
    };
    baseline_request: InferenceRequest;
    baseline_differential: DifferentialEntry[];
    baseline_target_rank: number;
    baseline_target_probability: number;
    step_results: AdversarialStep[];
    global_phi: number;
    collapse_risk: number;
    cii_index: number;
    divergence: number;
    evidence_thresholds: {
        condition_id: string;
        currently_at_rank: number;
        findings_to_reach_rank_1: EvidenceThreshold[];
        minimum_probability_achievable: number;
        maximum_probability_achievable: number;
    };
    metastable_conditions: Array<{
        condition_id: string;
        current_rank: number;
        current_probability: number;
        flip_probability: number;
        flip_direction: 'up' | 'down';
        trigger_finding: string;
    }>;
    collapse_conditions: Array<{
        perturbation_vector: string;
        collapse_threshold: number;
        failure_mode: 'rank_inversion' | 'probability_explosion' | 'confidence_collapse' | 'abstain_lock';
        description: string;
    }>;
    adversarial_differential_at_max_noise: {
        warning: 'NOT_CLINICAL_OUTPUT — adversarial degradation result only';
        differential: DifferentialEntry[];
        degradation_vs_baseline: Array<{
            condition_id: string;
            baseline_probability: number;
            adversarial_probability: number;
            rank_change: number;
        }>;
    };
    clean_clinical_differential: DifferentialEntry[];
    integrity_verdict: 'stable' | 'metastable' | 'fragile' | 'collapsed';
}

export type MultisystemicScenarioClass =
    | 'monosystemic_baseline'
    | 'dual_system_conflict'
    | 'triple_system_comorbidity'
    | 'species_mismatch';

export interface MultisystemicAdversarialScenario {
    id: string;
    label: string;
    scenario_class: MultisystemicScenarioClass;
    payload: EncounterPayloadV2;
    expected_species_panel_violations: string[];
    expected_reasoning_focus: string[];
}
