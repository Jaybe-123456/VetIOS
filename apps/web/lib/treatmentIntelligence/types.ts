export type TreatmentType = 'medical' | 'surgical' | 'supportive care';
export type TreatmentPathway = 'gold_standard' | 'resource_constrained' | 'supportive_only';
export type TreatmentRiskLevel = 'low' | 'moderate' | 'high' | 'critical';
export type TreatmentUrgencyLevel = 'routine' | 'urgent' | 'emergent';
export type TreatmentEvidenceLevel = 'low' | 'moderate' | 'high';
export type TreatmentResourceProfile = 'advanced' | 'low_resource';
export type TreatmentClinicianValidationStatus = 'pending' | 'confirmed' | 'overridden';
export type TreatmentOutcomeStatus =
    | 'planned'
    | 'ongoing'
    | 'improved'
    | 'resolved'
    | 'complication'
    | 'deteriorated'
    | 'deceased'
    | 'unknown';

export interface TreatmentInterventionDetails {
    drug_classes: string[];
    procedure_types: string[];
    supportive_measures: string[];
    monitoring: string[];
    reference_range_notes: string[];
}

export interface TreatmentExpectedOutcomeRange {
    survival_probability_band: string;
    recovery_expectation: string;
}

export interface TreatmentUncertaintyEnvelope {
    recommendation_confidence: number;
    evidence_gaps: string[];
    alternative_diagnoses: string[];
    weak_evidence: boolean;
}

export interface TreatmentEnvironmentConstraints {
    preferred_setting: TreatmentResourceProfile | 'any';
    notes: string[];
}

export interface TreatmentPerformanceSummary {
    disease: string;
    pathway: TreatmentPathway;
    sample_size: number;
    success_rate: number | null;
    complication_rate: number | null;
    median_recovery_time_days: number | null;
    clinician_override_rate: number | null;
}

export interface TreatmentCandidateRecord {
    id: string;
    disease: string;
    species_applicability: string[];
    treatment_pathway: TreatmentPathway;
    treatment_type: TreatmentType;
    intervention_details: TreatmentInterventionDetails;
    indication_criteria: string[];
    contraindications: string[];
    detected_contraindications: string[];
    risk_level: TreatmentRiskLevel;
    urgency_level: TreatmentUrgencyLevel;
    evidence_level: TreatmentEvidenceLevel;
    environment_constraints: TreatmentEnvironmentConstraints;
    expected_outcome_range: TreatmentExpectedOutcomeRange;
    supporting_signals: string[];
    why_relevant: string;
    risks: string[];
    regulatory_notes: string[];
    uncertainty: TreatmentUncertaintyEnvelope;
    clinician_validation_required: boolean;
    autonomous_prescribing_blocked: boolean;
}

export interface TreatmentRecommendationContext {
    resource_profile: TreatmentResourceProfile;
    regulatory_region: string | null;
    care_environment: string | null;
    comorbidities: string[];
    lab_flags: string[];
}

export interface TreatmentRecommendationBundle {
    inference_event_id: string;
    disease: string;
    species: string | null;
    diagnosis_confidence: number | null;
    emergency_level: string | null;
    severity_score: number | null;
    evidence_basis: {
        matched_signals: string[];
        alternative_diagnoses: string[];
        contradiction_flags: string[];
    };
    context: TreatmentRecommendationContext;
    contraindication_flags: string[];
    options: TreatmentCandidateRecord[];
    observed_performance: TreatmentPerformanceSummary[];
    clinician_notice: string;
    uncertainty_summary: string;
}

export interface TreatmentOutcomeWriteInput {
    inference_event_id: string;
    treatment_candidate_id?: string | null;
    treatment_event_id?: string | null;
    selection: {
        disease: string;
        treatment_pathway: TreatmentPathway;
        clinician_confirmed: boolean;
        clinician_override: boolean;
        actual_intervention: Record<string, unknown>;
        context: Record<string, unknown>;
    };
    outcome?: {
        outcome_status: TreatmentOutcomeStatus;
        recovery_time_days?: number | null;
        complications?: string[];
        notes?: string | null;
        short_term_response?: string | null;
        observed_at?: string | null;
        outcome_json?: Record<string, unknown>;
    };
}
