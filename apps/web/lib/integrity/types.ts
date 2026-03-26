export type StateClassification = 'stable' | 'fragile' | 'metastable' | 'collapsed';

export interface PerturbationScore {
    m: number;
    components: {
        noise: number;
        contradiction: number;
        missingness: number;
        ambiguity: number;
        distribution_shift: number;
    };
    reasoning: string[];
}

export interface InstabilityMetrics {
    delta_phi: number;
    curvature: number;
    variance_proxy: number;
    divergence: number;
    critical_instability_index: number;
}

export interface CapabilityPhi {
    name: string;
    phi: number;
    delta_phi?: number;
    curvature?: number;
    variance_proxy?: number;
    divergence?: number;
    near_collapse?: boolean;
    reason: string;
}

export interface IntegrityResult {
    perturbation: PerturbationScore;
    global_phi: number;
    capabilities: CapabilityPhi[];
    instability: InstabilityMetrics;
    state: StateClassification;
    collapse_risk: number;
    precliff_detected: boolean;
}

export interface SafetyPolicyDecision {
    action: 'allow' | 'allow_with_warning' | 'request_more_data' | 'abstain';
    message: string;
}

export interface ClinicalIntegrityInput {
    inputSignature: Record<string, unknown>;
    outputPayload: Record<string, unknown>;
    confidenceScore: number | null;
    uncertaintyMetrics: Record<string, unknown> | null;
    contradictionAnalysis: Record<string, unknown> | null;
}

export interface ClinicalIntegrityHistoryEntry {
    global_phi: number;
    perturbation_score_m: number;
    details: Record<string, unknown> | null;
    created_at: string | null;
}

export interface ClinicalIntegrityContext {
    recentHistory?: ClinicalIntegrityHistoryEntry[];
}

export interface ClinicalIntegrityEvaluation {
    integrity: IntegrityResult;
    safetyPolicy: SafetyPolicyDecision;
}
