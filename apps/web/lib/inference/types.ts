import { z } from 'zod';

export type DiagnosticResult = 'positive' | 'negative' | 'equivocal' | 'not_done';
export type LowHighDiagnosticResult = DiagnosticResult | 'low' | 'normal' | 'high';
export type Progression = 'acute' | 'subacute' | 'chronic' | 'peracute';
export type PreventionStatus = 'consistent' | 'inconsistent' | 'none' | 'unknown';
export type VaccinationStatus = 'current' | 'unknown' | 'overdue';
export type DewormingStatus = 'recent' | 'none' | 'unknown';
export type EosinophiliaSeverity = 'mild' | 'moderate' | 'severe' | 'absent';
export type PresentAbsent = 'present' | 'absent';
export type AnemiaType = 'regenerative' | 'non_regenerative' | 'not_assessed' | 'absent';
export type ThrombocytopeniaSeverity = 'mild' | 'moderate' | 'severe' | 'absent';
export type AltAstStatus = 'normal' | 'mildly_elevated' | 'markedly_elevated';
export type AlbuminStatus = 'normal' | 'hypoalbuminemia';
export type BunCreatinineStatus = 'normal' | 'azotemia';
export type GlobulinStatus = 'normal' | 'hyperglobulinemia';
export type GlucoseStatus = 'normal' | 'hyperglycemia' | 'hypoglycemia';
export type TotalProteinStatus = 'normal' | 'elevated' | 'decreased';
export type BilirubinStatus = 'normal' | 'elevated';
export type CalciumStatus = 'normal' | 'hypercalcemia' | 'hypocalcemia';
export type PulmonaryPattern = 'bronchial' | 'alveolar' | 'interstitial' | 'vascular' | 'normal' | 'mixed';
export type CardiomegalyPattern = 'right_sided' | 'left_sided' | 'generalised' | 'absent';
export type SkinScrapeResult = 'demodex' | 'sarcoptes' | 'negative' | 'not_done';
export type KnottTestResult = 'positive_microfilariae' | 'negative' | 'not_done';
export type MucousMembraneColor = 'pink' | 'pale' | 'cyanotic' | 'icteric' | 'injected';
export type MurmurGrade = 'absent' | 'grade_1' | 'grade_2' | 'grade_3' | 'grade_4' | 'grade_5' | 'grade_6';
export type LungSoundPattern = 'normal' | 'crackles' | 'wheezes' | 'muffled' | 'absent';
export type LymphNodePattern = 'normal' | 'generalised_lymphadenopathy' | 'regional_lymphadenopathy';
export type AbdominalExamPattern = 'normal' | 'pain' | 'distension' | 'mass_palpable' | 'organomegaly';
export type NeurologicalExamStatus = 'normal' | 'abnormal';
export type DifferentialBasis =
    | 'pathognomonic_test'
    | 'syndrome_pattern'
    | 'symptom_scoring'
    | 'exclusion_reasoning';
export type EvidenceWeight = 'definitive' | 'strong' | 'supportive' | 'minor';
export type ContradictionWeight = 'excludes' | 'weakens';
export type RelationshipType = 'secondary' | 'complication' | 'co-morbidity' | 'differential';
export type ClinicalUrgency = 'immediate' | 'urgent' | 'routine';
export type DifferentialConfidence = 'high' | 'moderate' | 'low';
export type EvidenceQuality = 'high' | 'moderate' | 'low';
export type ConditionClass =
    | 'Mechanical'
    | 'Infectious'
    | 'Toxic'
    | 'Neoplastic'
    | 'Autoimmune / Immune-Mediated'
    | 'Metabolic / Endocrine'
    | 'Traumatic'
    | 'Degenerative'
    | 'Idiopathic / Unknown';
export type Species = 'canine' | 'feline' | 'bovine' | 'ovine' | 'caprine' | 'equine';
export type EtiologicalClass =
    | 'parasitic_helminth'
    | 'parasitic_protozoan'
    | 'parasitic_ectoparasite'
    | 'bacterial'
    | 'viral'
    | 'fungal'
    | 'immune_mediated'
    | 'metabolic_endocrine'
    | 'neoplastic'
    | 'cardiovascular_structural'
    | 'respiratory_structural'
    | 'gastrointestinal_structural'
    | 'neurological'
    | 'nutritional'
    | 'toxic'
    | 'traumatic'
    | 'congenital'
    | 'idiopathic';
export type TreatmentCategory =
    | 'pharmacological_antiparasitic'
    | 'pharmacological_antibiotic'
    | 'pharmacological_antifungal'
    | 'pharmacological_antiviral'
    | 'pharmacological_immunosuppressive'
    | 'pharmacological_cardiac'
    | 'pharmacological_hormonal'
    | 'pharmacological_analgesic'
    | 'pharmacological_supportive'
    | 'pharmacological_antiemetic'
    | 'pharmacological_antidiarrheal'
    | 'pharmacological_bronchodilator'
    | 'pharmacological_diuretic'
    | 'surgical'
    | 'interventional_procedure'
    | 'dietary_nutritional'
    | 'vector_control'
    | 'vaccination'
    | 'nursing_supportive'
    | 'environmental_management'
    | 'physical_rehabilitation'
    | 'monitoring'
    | 'owner_education';
export type EvidenceLevel = 'ia' | 'ib' | 'iia' | 'iib' | 'iii' | 'iv';
export type RecommendationGrade = 'A' | 'B' | 'C' | 'D';
export type TreatmentPhase =
    | 'acute_stabilisation'
    | 'pre_treatment_preparation'
    | 'definitive_treatment'
    | 'adjunctive'
    | 'secondary_prevention'
    | 'long_term_management'
    | 'palliative'
    | 'prophylactic';
export type ProtocolPriority = 'essential' | 'recommended' | 'optional' | 'consider_if';
export type RouteOfAdministration = 'PO' | 'SC' | 'IM' | 'IV' | 'Topical' | 'Inhaled' | 'Procedure' | 'Environmental';
export type GroundTruthStatus =
    | 'confirmed'
    | 'highly_supported'
    | 'supported'
    | 'unconfirmed'
    | 'unlikely'
    | 'excluded';
export type InferenceAbstainReason =
    | 'pathognomonic_finding_present'
    | 'genuine_clinical_contradiction'
    | 'insufficient_clinical_signal'
    | null;

export interface PathognomicTestRule {
    test: string;
    result: string;
    probability_if_positive: number;
    probability_if_negative?: number;
    evidence_label?: string;
    required_for_confirmation?: boolean;
}

export interface SupportingTestRule {
    test: string;
    result?: string;
    boost: number;
    evidence_label: string;
}

export interface ExclusionRule {
    field: string;
    explanation: string;
    exclude?: boolean;
    penalty?: number;
    expected_value?: string | string[];
}

export interface ImagingPattern {
    finding: string;
    result: string;
    boost: number;
    evidence_label: string;
}

export interface HaematologicalPattern {
    finding: string;
    result: string;
    boost: number;
    evidence_label: string;
}

export interface SeverityClass {
    class: string;
    label: string;
    criteria?: string[];
}

export interface DoseRegimen {
    amount_per_kg?: number;
    amount_per_kg_high?: number;
    unit?: 'mg' | 'mcg' | 'IU';
    route: RouteOfAdministration;
    frequency: string;
    duration: string;
    notes?: string;
    severity_scope?: string[];
    fixed_text?: string;
}

export interface TreatmentDrugDetails {
    name: string;
    trade_names?: string[];
    drug_class: string;
    mechanism: string;
    species: Species[];
    dosing: DoseRegimen[];
    route: RouteOfAdministration[];
    contraindications: string[];
    precautions: string[];
    drug_interactions: string[];
    adverse_effects: string[];
    monitoring_required: string[];
    availability: {
        africa_east?: boolean;
        africa_south?: boolean;
        europe?: boolean;
        usa?: boolean;
        global?: boolean;
    };
    cost_tier: 'low' | 'moderate' | 'high' | 'very_high';
}

export interface SurgicalProtocolDetails {
    procedure_name: string;
    technique: string;
    specialist_required: boolean;
    anesthesia_considerations: string[];
    perioperative_management: string[];
    expected_outcomes: string;
    complications: string[];
    recovery_protocol: string;
}

export interface TreatmentProtocol {
    condition_id: string;
    condition_name: string;
    severity_scope: string[];
    protocol_id: string;
    protocol_name: string;
    category: TreatmentCategory;
    evidence_level: EvidenceLevel;
    guideline_source: string[];
    recommendation_grade: RecommendationGrade;
    drug?: TreatmentDrugDetails;
    surgery?: SurgicalProtocolDetails;
    treatment_phase: TreatmentPhase;
    treatment_duration?: string;
    follow_up_protocol?: string[];
    priority: ProtocolPriority;
    condition_for_use?: string;
    expected_outcomes: string;
    treatment_failure_indicators: string[];
    alternative_if_fails: string[];
    details?: string;
}

export interface VeterinaryCondition {
    id: string;
    canonical_name: string;
    aliases: string[];
    icd_vet_code?: string;
    species_affected: Species[];
    etiological_class: EtiologicalClass;
    causative_agent?: string;
    vector?: string[];
    transmission_route?: string[];
    geographic_distribution: string[];
    regional_prevalence: Record<string, number>;
    pathognomonic_tests: PathognomicTestRule[];
    supporting_tests: SupportingTestRule[];
    exclusion_criteria: ExclusionRule[];
    cardinal_signs: string[];
    common_signs: string[];
    rare_signs: string[];
    signs_that_exclude: string[];
    imaging_patterns: ImagingPattern[];
    haematological_patterns: HaematologicalPattern[];
    severity_classification?: SeverityClass[];
    treatments: TreatmentProtocol[];
    references: string[];
}

export interface VectorExposureHistory {
    mosquito_endemic?: boolean;
    tick_endemic?: boolean;
    standing_water_access?: boolean;
    wildlife_contact?: boolean;
}

export interface StructuredHistory {
    duration_days?: number;
    progression?: Progression;
    owner_observations?: string[];
    travel_history?: string[];
    geographic_region?: string;
}

export interface PreventiveHistory {
    heartworm_prevention?: PreventionStatus;
    ectoparasite_prevention?: PreventionStatus;
    vaccination_status?: VaccinationStatus;
    deworming_history?: DewormingStatus;
    vector_exposure?: VectorExposureHistory;
}

export interface SerologyPanel {
    dirofilaria_immitis_antigen?: DiagnosticResult;
    heartworm_antigen?: 'not_performed' | 'negative' | 'positive';
    anaplasma_antibody?: DiagnosticResult;
    ehrlichia_antibody?: DiagnosticResult;
    borrelia_antibody?: DiagnosticResult;
    leishmania_antibody?: DiagnosticResult;
    leishmania_serology?: 'not_performed' | 'negative' | 'positive';
    toxoplasma_antibody?: DiagnosticResult;
    neospora_antibody?: DiagnosticResult;
    parvovirus_antigen?: DiagnosticResult;
    coronavirus_antigen?: DiagnosticResult;
    brucella_titer?: DiagnosticResult;
    t4_total?: LowHighDiagnosticResult;
    coombs_test?: 'not_performed' | 'negative' | 'positive';
    saline_agglutination?: 'not_performed' | 'negative' | 'positive';
    tick_borne_disease_panel?: 'not_performed' | 'negative' | 'positive';
    fcov_antibody_titre?: 'not_performed' | 'negative' | 'high_positive';
    mat_leptospira?: 'not_performed' | 'negative' | 'positive';
    distemper_antigen?: 'not_performed' | 'negative' | 'positive';
    total_t4?: 'not_assessed' | 'low' | 'normal' | 'elevated';
    total_t4_feline?: 'not_assessed' | 'low' | 'normal' | 'elevated';
    pancreatic_lipase?: 'not_assessed' | 'normal' | 'elevated' | 'markedly_elevated';
    acth_stimulation?: 'not_performed' | 'flat_response' | 'normal_response';
    sodium_potassium_ratio?: 'not_assessed' | 'low' | 'normal';
    antiplatelet_antibody?: 'not_performed' | 'negative' | 'positive';
    free_t4?: LowHighDiagnosticResult;
    fungal_titers?: Record<string, DiagnosticResult>;
    [key: string]: unknown;
}

export interface CbcPanel {
    eosinophilia?: EosinophiliaSeverity;
    basophilia?: PresentAbsent;
    neutrophilia?: PresentAbsent;
    leukocytosis?: PresentAbsent;
    lymphopenia?: PresentAbsent;
    anemia_type?: AnemiaType;
    reticulocytosis?: 'normal' | 'elevated' | 'not_assessed';
    thrombocytopenia?: ThrombocytopeniaSeverity;
    platelet_count?: 'severe_thrombocytopenia' | 'normal' | 'mild_thrombocytopenia' | 'moderate_thrombocytopenia';
    microfilaremia?: PresentAbsent;
    spherocytes?: PresentAbsent;
    spherocytosis?: PresentAbsent;
    autoagglutination?: 'negative' | 'positive';
    pancytopenia?: PresentAbsent;
    hyperproteinaemia?: PresentAbsent;
    hyperglobulinaemia?: PresentAbsent;
    packed_cell_volume_percent?: number;
    hemoparasites_seen?: string[];
}

export interface BiochemistryPanel {
    alt_ast?: AltAstStatus;
    albumin?: AlbuminStatus;
    bun_creatinine?: BunCreatinineStatus;
    globulins?: GlobulinStatus;
    glucose?: GlucoseStatus;
    sodium_potassium_ratio?: 'not_assessed' | 'low' | 'normal';
    total_protein?: TotalProteinStatus;
    bilirubin?: BilirubinStatus;
    calcium?: CalciumStatus;
}

export interface UrinalysisPanel {
    proteinuria?: PresentAbsent;
    glucose_in_urine?: PresentAbsent;
    hemoglobinuria?: PresentAbsent;
    bilirubinuria?: PresentAbsent | 'mild';
    obstructive_pattern?: PresentAbsent;
    casts?: PresentAbsent;
    specific_gravity?: number;
    sediment?: string[];
}

export interface ThoracicRadiographPanel {
    pulmonary_pattern?: PulmonaryPattern;
    pulmonary_artery_enlargement?: PresentAbsent;
    cardiomegaly?: CardiomegalyPattern;
    pleural_effusion?: PresentAbsent;
    gastric_volvulus?: PresentAbsent;
    mass_lesion?: PresentAbsent;
    tracheal_deviation?: PresentAbsent;
    tracheal_collapse_seen?: PresentAbsent;
}

export interface AbdominalUltrasoundPanel {
    hepatomegaly?: PresentAbsent;
    splenomegaly?: PresentAbsent;
    ascites?: PresentAbsent;
    uterine_distension?: PresentAbsent;
    lymphadenopathy?: PresentAbsent;
    mass_lesion?: PresentAbsent;
    hyperechoic_liver?: PresentAbsent;
}

export interface EchocardiographyPanel {
    worms_visualised?: PresentAbsent;
    pulmonary_hypertension?: PresentAbsent;
    right_heart_enlargement?: PresentAbsent;
    left_heart_enlargement?: PresentAbsent;
    pericardial_effusion?: PresentAbsent;
    reduced_contractility?: PresentAbsent;
    valve_regurgitation?: string[];
}

export interface CytologyPanel {
    lymph_node_fnab?: string;
    mass_fnab?: string;
    bone_marrow?: string;
    abdominal_fluid_bacteria?: PresentAbsent;
    effusion_rivalta?: 'negative' | 'positive';
}

export interface ImagingPanel {
    abdominal_ultrasound?: string;
    thoracic_radiograph?: string;
}

export interface ParasitologyPanel {
    fecal_flotation?: string[];
    fecal_direct_smear?: string[];
    modified_baermann?: DiagnosticResult;
    skin_scrape?: SkinScrapeResult;
    buffy_coat_smear?: string[];
    knott_test?: KnottTestResult;
}

export interface DiagnosticTests {
    serology?: SerologyPanel;
    cbc?: CbcPanel;
    biochemistry?: BiochemistryPanel;
    urinalysis?: UrinalysisPanel;
    thoracic_radiograph?: ThoracicRadiographPanel;
    abdominal_ultrasound?: AbdominalUltrasoundPanel;
    imaging?: ImagingPanel;
    echocardiography?: EchocardiographyPanel;
    cytology?: CytologyPanel;
    pcr?: Record<string, 'positive' | 'negative' | 'not_done'>;
    parasitology?: ParasitologyPanel;
}

export interface AuscultationFindings {
    heart_murmur?: MurmurGrade;
    murmur_location?: string;
    arrhythmia?: PresentAbsent;
    lung_sounds?: LungSoundPattern;
}

export interface PhysicalExam {
    temperature?: number;
    heart_rate?: number;
    respiratory_rate?: number;
    mucous_membrane_color?: MucousMembraneColor;
    capillary_refill_time_s?: number;
    body_condition_score?: number;
    auscultation?: AuscultationFindings;
    lymph_nodes?: LymphNodePattern;
    abdomen?: AbdominalExamPattern;
    skin_lesions?: string[];
    ocular_findings?: string[];
    neurological?: NeurologicalExamStatus;
}

export interface InferenceRequest {
    species: string;
    breed?: string;
    age_years?: number;
    weight_kg?: number;
    sex?: string;
    region?: string;
    symptom_vector?: string[];
    presenting_signs: string[];
    history?: StructuredHistory;
    preventive_history?: PreventiveHistory;
    diagnostic_tests?: DiagnosticTests;
    physical_exam?: PhysicalExam;
}

export interface EvidenceEntry {
    finding: string;
    weight: EvidenceWeight;
}

export interface ContradictingEvidenceEntry {
    finding: string;
    weight: ContradictionWeight;
}

export interface DifferentialRelationship {
    type: RelationshipType;
    primary_condition: string;
}

export interface DifferentialEntry {
    rank: number;
    condition: string;
    condition_id?: string;
    name?: string;
    icd_vet_code?: string;
    probability: number;
    confidence: DifferentialConfidence;
    determination_basis: DifferentialBasis;
    supporting_evidence: EvidenceEntry[];
    contradicting_evidence: ContradictingEvidenceEntry[];
    relationship_to_primary?: DifferentialRelationship;
    clinical_urgency: ClinicalUrgency;
    recommended_confirmatory_tests?: string[];
    recommended_next_steps?: string[];
    ground_truth_explanation?: GroundTruthExplanation;
}

export interface ExcludedConditionExplanation {
    condition: string;
    reason: string;
}

export interface InferenceExplanation {
    primary_determination: DifferentialBasis;
    key_finding: string;
    excluded_conditions: ExcludedConditionExplanation[];
    evidence_quality: EvidenceQuality;
    data_completeness_score: number;
    missing_data_that_would_help: string[];
}

export interface GroundTruthExplanation {
    condition: string;
    pre_confirmation_probability: number;
    post_confirmation_probability: number;
    criteria_source: string;
    supporting_criteria: string[];
    missing_criteria: string[];
    contradicting_findings: string[];
    confirmation_status: GroundTruthStatus;
    message?: string;
}

export interface ContradictionAnalysis {
    contradiction_score: number;
    contradiction_reasons: string[];
}

export interface AbstainDecision {
    abstain: boolean;
    reason: InferenceAbstainReason;
    details?: string[];
    competitive_differential?: boolean;
    confirmatory_testing_urgent?: boolean;
    message?: string;
}

export interface InferenceResponse {
    differentials: DifferentialEntry[];
    inference_explanation: InferenceExplanation;
    diagnosis: {
        analysis: string;
        primary_condition_class: ConditionClass;
        condition_class_probabilities: Record<ConditionClass, number>;
        top_differentials: DifferentialEntry[];
        confidence_score: number;
    };
    treatment_plans: Record<string, SelectedTreatmentPlan>;
    ground_truth_summary: {
        primary_diagnosis_status: 'confirmed' | 'highly_supported' | 'unconfirmed';
        key_confirmatory_finding?: string;
        missing_confirmatory_tests: string[];
        confidence_level: 'high' | 'moderate' | 'low';
        recommended_immediate_actions: string[];
    };
    contradiction_analysis?: ContradictionAnalysis;
    abstain_recommendation?: boolean;
    abstain_reason?: InferenceAbstainReason;
    competitive_differential?: boolean;
    urgent_confirmatory_testing?: boolean;
    feature_importance?: Record<string, number>;
    species_gate?: string;
    airway_level?: 'upper' | 'lower' | 'mixed';
    cluster_scores?: Record<string, number>;
}

export interface SelectedTreatmentPlan {
    condition_name: string;
    severity_class: string | null;
    treatment_phases: Array<{
        phase: TreatmentPhase;
        phase_label: string;
        timing: string;
        protocols: Array<{
            protocol_id: string;
            protocol_name: string;
            category: TreatmentCategory;
            priority: ProtocolPriority;
            patient_specific_dose?: string;
            duration: string;
            route: string;
            frequency: string;
            evidence_summary: string;
            guideline_source: string[];
            cautions_for_this_patient: string[];
            drug_interactions_in_plan: string[];
            monitoring_required: string[];
            expected_response: string;
        }>;
        phase_notes: string;
    }>;
    monitoring_schedule: Array<{
        timepoint: string;
        tests_required: string[];
        clinical_parameters: string[];
        expected_findings: string;
        action_if_abnormal: string;
    }>;
    owner_instructions: string[];
    prognosis: string;
    contraindicated_treatments: Array<{
        treatment: string;
        reason: string;
    }>;
    regional_availability_notes: string;
    total_estimated_cost_range?: string;
}

const DiagnosticResultSchema = z.enum(['positive', 'negative', 'equivocal', 'not_done']);
const LowHighDiagnosticResultSchema = z.union([
    DiagnosticResultSchema,
    z.enum(['low', 'normal', 'high']),
]);

export const StructuredInferenceRequestSchema = z.strictObject({
    species: z.string().min(1),
    breed: z.string().optional(),
    age_years: z.number().min(0).optional(),
    weight_kg: z.number().min(0).optional(),
    sex: z.string().optional(),
    region: z.string().optional(),
    symptom_vector: z.array(z.string()).optional(),
    presenting_signs: z.array(z.string()).optional().default([]),
    history: z.object({
        duration_days: z.number().int().min(0).optional(),
        progression: z.enum(['acute', 'subacute', 'chronic', 'peracute']).optional(),
        owner_observations: z.array(z.string()).optional(),
        travel_history: z.array(z.string()).optional(),
        geographic_region: z.string().optional(),
    }).optional(),
    preventive_history: z.object({
        heartworm_prevention: z.enum(['consistent', 'inconsistent', 'none', 'unknown']).optional(),
        ectoparasite_prevention: z.enum(['consistent', 'inconsistent', 'none', 'unknown']).optional(),
        vaccination_status: z.enum(['current', 'unknown', 'overdue']).optional(),
        deworming_history: z.enum(['recent', 'none', 'unknown']).optional(),
        vector_exposure: z.object({
            mosquito_endemic: z.boolean().optional(),
            tick_endemic: z.boolean().optional(),
            standing_water_access: z.boolean().optional(),
            wildlife_contact: z.boolean().optional(),
        }).optional(),
    }).optional(),
    diagnostic_tests: z.object({
        serology: z.object({
            dirofilaria_immitis_antigen: DiagnosticResultSchema.optional(),
            heartworm_antigen: z.enum(['not_performed', 'negative', 'positive']).optional(),
            anaplasma_antibody: DiagnosticResultSchema.optional(),
            ehrlichia_antibody: DiagnosticResultSchema.optional(),
            borrelia_antibody: DiagnosticResultSchema.optional(),
            leishmania_antibody: DiagnosticResultSchema.optional(),
            leishmania_serology: z.enum(['not_performed', 'negative', 'positive']).optional(),
            toxoplasma_antibody: DiagnosticResultSchema.optional(),
            neospora_antibody: DiagnosticResultSchema.optional(),
            parvovirus_antigen: DiagnosticResultSchema.optional(),
            coronavirus_antigen: DiagnosticResultSchema.optional(),
            brucella_titer: DiagnosticResultSchema.optional(),
            t4_total: LowHighDiagnosticResultSchema.optional(),
            coombs_test: z.enum(['not_performed', 'negative', 'positive']).optional(),
            saline_agglutination: z.enum(['not_performed', 'negative', 'positive']).optional(),
            tick_borne_disease_panel: z.enum(['not_performed', 'negative', 'positive']).optional(),
            fcov_antibody_titre: z.enum(['not_performed', 'negative', 'high_positive']).optional(),
            mat_leptospira: z.enum(['not_performed', 'negative', 'positive']).optional(),
            distemper_antigen: z.enum(['not_performed', 'negative', 'positive']).optional(),
            total_t4: z.enum(['not_assessed', 'low', 'normal', 'elevated']).optional(),
            total_t4_feline: z.enum(['not_assessed', 'low', 'normal', 'elevated']).optional(),
            pancreatic_lipase: z.enum(['not_assessed', 'normal', 'elevated', 'markedly_elevated']).optional(),
            acth_stimulation: z.enum(['not_performed', 'flat_response', 'normal_response']).optional(),
            sodium_potassium_ratio: z.enum(['not_assessed', 'low', 'normal']).optional(),
            antiplatelet_antibody: z.enum(['not_performed', 'negative', 'positive']).optional(),
            free_t4: LowHighDiagnosticResultSchema.optional(),
            fungal_titers: z.record(z.string(), DiagnosticResultSchema).optional(),
        }).catchall(z.unknown()).optional(),
        cbc: z.object({
            eosinophilia: z.enum(['mild', 'moderate', 'severe', 'absent']).optional(),
            basophilia: z.enum(['present', 'absent']).optional(),
            neutrophilia: z.enum(['present', 'absent']).optional(),
            leukocytosis: z.enum(['present', 'absent']).optional(),
            lymphopenia: z.enum(['present', 'absent']).optional(),
            anemia_type: z.enum(['regenerative', 'non_regenerative', 'not_assessed', 'absent']).optional(),
            reticulocytosis: z.enum(['normal', 'elevated', 'not_assessed']).optional(),
            thrombocytopenia: z.enum(['mild', 'moderate', 'severe', 'absent']).optional(),
            platelet_count: z.enum(['severe_thrombocytopenia', 'normal', 'mild_thrombocytopenia', 'moderate_thrombocytopenia']).optional(),
            microfilaremia: z.enum(['present', 'absent']).optional(),
            spherocytes: z.enum(['present', 'absent']).optional(),
            spherocytosis: z.enum(['present', 'absent']).optional(),
            autoagglutination: z.enum(['negative', 'positive']).optional(),
            pancytopenia: z.enum(['present', 'absent']).optional(),
            hyperproteinaemia: z.enum(['present', 'absent']).optional(),
            hyperglobulinaemia: z.enum(['present', 'absent']).optional(),
            packed_cell_volume_percent: z.number().optional(),
            hemoparasites_seen: z.array(z.string()).optional(),
        }).optional(),
        biochemistry: z.object({
            alt_ast: z.enum(['normal', 'mildly_elevated', 'markedly_elevated']).optional(),
            albumin: z.enum(['normal', 'hypoalbuminemia']).optional(),
            bun_creatinine: z.enum(['normal', 'azotemia']).optional(),
            globulins: z.enum(['normal', 'hyperglobulinemia']).optional(),
            glucose: z.enum(['normal', 'hyperglycemia', 'hypoglycemia']).optional(),
            sodium_potassium_ratio: z.enum(['not_assessed', 'low', 'normal']).optional(),
            total_protein: z.enum(['normal', 'elevated', 'decreased']).optional(),
            bilirubin: z.enum(['normal', 'elevated']).optional(),
            calcium: z.enum(['normal', 'hypercalcemia', 'hypocalcemia']).optional(),
        }).optional(),
        urinalysis: z.object({
            proteinuria: z.enum(['present', 'absent']).optional(),
            glucose_in_urine: z.enum(['present', 'absent']).optional(),
            hemoglobinuria: z.enum(['present', 'absent']).optional(),
            bilirubinuria: z.enum(['present', 'absent', 'mild']).optional(),
            obstructive_pattern: z.enum(['present', 'absent']).optional(),
            casts: z.enum(['present', 'absent']).optional(),
            specific_gravity: z.number().optional(),
            sediment: z.array(z.string()).optional(),
        }).optional(),
        thoracic_radiograph: z.object({
            pulmonary_pattern: z.enum(['bronchial', 'alveolar', 'interstitial', 'vascular', 'normal', 'mixed']).optional(),
            pulmonary_artery_enlargement: z.enum(['present', 'absent']).optional(),
            cardiomegaly: z.enum(['right_sided', 'left_sided', 'generalised', 'absent']).optional(),
            pleural_effusion: z.enum(['present', 'absent']).optional(),
            gastric_volvulus: z.enum(['present', 'absent']).optional(),
            mass_lesion: z.enum(['present', 'absent']).optional(),
            tracheal_deviation: z.enum(['present', 'absent']).optional(),
            tracheal_collapse_seen: z.enum(['present', 'absent']).optional(),
        }).optional(),
        abdominal_ultrasound: z.object({
            hepatomegaly: z.enum(['present', 'absent']).optional(),
            splenomegaly: z.enum(['present', 'absent']).optional(),
            ascites: z.enum(['present', 'absent']).optional(),
            uterine_distension: z.enum(['present', 'absent']).optional(),
            lymphadenopathy: z.enum(['present', 'absent']).optional(),
            mass_lesion: z.enum(['present', 'absent']).optional(),
            hyperechoic_liver: z.enum(['present', 'absent']).optional(),
        }).optional(),
        imaging: z.object({
            abdominal_ultrasound: z.string().optional(),
            thoracic_radiograph: z.string().optional(),
        }).optional(),
        echocardiography: z.object({
            worms_visualised: z.enum(['present', 'absent']).optional(),
            pulmonary_hypertension: z.enum(['present', 'absent']).optional(),
            right_heart_enlargement: z.enum(['present', 'absent']).optional(),
            left_heart_enlargement: z.enum(['present', 'absent']).optional(),
            pericardial_effusion: z.enum(['present', 'absent']).optional(),
            reduced_contractility: z.enum(['present', 'absent']).optional(),
            valve_regurgitation: z.array(z.string()).optional(),
        }).optional(),
        cytology: z.object({
            lymph_node_fnab: z.string().optional(),
            mass_fnab: z.string().optional(),
            bone_marrow: z.string().optional(),
            abdominal_fluid_bacteria: z.enum(['present', 'absent']).optional(),
            effusion_rivalta: z.enum(['negative', 'positive']).optional(),
        }).optional(),
        pcr: z.record(z.string(), z.enum(['positive', 'negative', 'not_done'])).optional(),
        parasitology: z.object({
            fecal_flotation: z.array(z.string()).optional(),
            fecal_direct_smear: z.array(z.string()).optional(),
            modified_baermann: DiagnosticResultSchema.optional(),
            skin_scrape: z.enum(['demodex', 'sarcoptes', 'negative', 'not_done']).optional(),
            buffy_coat_smear: z.array(z.string()).optional(),
            knott_test: z.enum(['positive_microfilariae', 'negative', 'not_done']).optional(),
        }).optional(),
    }).optional(),
    physical_exam: z.object({
        temperature: z.number().optional(),
        heart_rate: z.number().optional(),
        respiratory_rate: z.number().optional(),
        mucous_membrane_color: z.enum(['pink', 'pale', 'cyanotic', 'icteric', 'injected']).optional(),
        capillary_refill_time_s: z.number().optional(),
        body_condition_score: z.number().min(1).max(9).optional(),
        auscultation: z.object({
            heart_murmur: z.enum(['absent', 'grade_1', 'grade_2', 'grade_3', 'grade_4', 'grade_5', 'grade_6']).optional(),
            murmur_location: z.string().optional(),
            arrhythmia: z.enum(['present', 'absent']).optional(),
            lung_sounds: z.enum(['normal', 'crackles', 'wheezes', 'muffled', 'absent']).optional(),
        }).optional(),
        lymph_nodes: z.enum(['normal', 'generalised_lymphadenopathy', 'regional_lymphadenopathy']).optional(),
        abdomen: z.enum(['normal', 'pain', 'distension', 'mass_palpable', 'organomegaly']).optional(),
        skin_lesions: z.array(z.string()).optional(),
        ocular_findings: z.array(z.string()).optional(),
        neurological: z.enum(['normal', 'abnormal']).optional(),
    }).optional(),
});

export const DEFAULT_V1_INFERENCE_MODEL = {
    name: 'gpt-4o-mini',
    version: '1.0.0',
} as const;
