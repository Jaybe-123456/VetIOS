import { z } from 'zod';

export type DiagnosticResult = 'positive' | 'negative' | 'equivocal' | 'not_done';
export type LowHighDiagnosticResult = DiagnosticResult | 'low' | 'normal' | 'high';
export type Progression = 'acute' | 'subacute' | 'chronic' | 'peracute';
export type PreventionStatus = 'consistent' | 'inconsistent' | 'none' | 'unknown';
export type VaccinationStatus = 'current' | 'unknown' | 'overdue';
export type DewormingStatus = 'recent' | 'none' | 'unknown';
export type EosinophiliaSeverity = 'mild' | 'moderate' | 'severe' | 'absent';
export type PresentAbsent = 'present' | 'absent';
export type AnemiaType = 'regenerative' | 'non_regenerative' | 'absent';
export type ThrombocytopeniaSeverity = 'mild' | 'severe' | 'absent';
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
    anaplasma_antibody?: DiagnosticResult;
    ehrlichia_antibody?: DiagnosticResult;
    borrelia_antibody?: DiagnosticResult;
    leishmania_antibody?: DiagnosticResult;
    toxoplasma_antibody?: DiagnosticResult;
    neospora_antibody?: DiagnosticResult;
    parvovirus_antigen?: DiagnosticResult;
    coronavirus_antigen?: DiagnosticResult;
    brucella_titer?: DiagnosticResult;
    t4_total?: LowHighDiagnosticResult;
    free_t4?: LowHighDiagnosticResult;
    fungal_titers?: Record<string, DiagnosticResult>;
    [key: string]: unknown;
}

export interface CbcPanel {
    eosinophilia?: EosinophiliaSeverity;
    basophilia?: PresentAbsent;
    neutrophilia?: PresentAbsent;
    lymphopenia?: PresentAbsent;
    anemia_type?: AnemiaType;
    thrombocytopenia?: ThrombocytopeniaSeverity;
    microfilaremia?: PresentAbsent;
    hemoparasites_seen?: string[];
}

export interface BiochemistryPanel {
    alt_ast?: AltAstStatus;
    albumin?: AlbuminStatus;
    bun_creatinine?: BunCreatinineStatus;
    globulins?: GlobulinStatus;
    glucose?: GlucoseStatus;
    total_protein?: TotalProteinStatus;
    bilirubin?: BilirubinStatus;
    calcium?: CalciumStatus;
}

export interface UrinalysisPanel {
    proteinuria?: PresentAbsent;
    glucose_in_urine?: PresentAbsent;
    casts?: PresentAbsent;
    specific_gravity?: number;
    sediment?: string[];
}

export interface ThoracicRadiographPanel {
    pulmonary_pattern?: PulmonaryPattern;
    pulmonary_artery_enlargement?: PresentAbsent;
    cardiomegaly?: CardiomegalyPattern;
    pleural_effusion?: PresentAbsent;
    mass_lesion?: PresentAbsent;
    tracheal_deviation?: PresentAbsent;
    tracheal_collapse_seen?: PresentAbsent;
}

export interface AbdominalUltrasoundPanel {
    hepatomegaly?: PresentAbsent;
    splenomegaly?: PresentAbsent;
    ascites?: PresentAbsent;
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
            anaplasma_antibody: DiagnosticResultSchema.optional(),
            ehrlichia_antibody: DiagnosticResultSchema.optional(),
            borrelia_antibody: DiagnosticResultSchema.optional(),
            leishmania_antibody: DiagnosticResultSchema.optional(),
            toxoplasma_antibody: DiagnosticResultSchema.optional(),
            neospora_antibody: DiagnosticResultSchema.optional(),
            parvovirus_antigen: DiagnosticResultSchema.optional(),
            coronavirus_antigen: DiagnosticResultSchema.optional(),
            brucella_titer: DiagnosticResultSchema.optional(),
            t4_total: LowHighDiagnosticResultSchema.optional(),
            free_t4: LowHighDiagnosticResultSchema.optional(),
            fungal_titers: z.record(z.string(), DiagnosticResultSchema).optional(),
        }).catchall(z.unknown()).optional(),
        cbc: z.object({
            eosinophilia: z.enum(['mild', 'moderate', 'severe', 'absent']).optional(),
            basophilia: z.enum(['present', 'absent']).optional(),
            neutrophilia: z.enum(['present', 'absent']).optional(),
            lymphopenia: z.enum(['present', 'absent']).optional(),
            anemia_type: z.enum(['regenerative', 'non_regenerative', 'absent']).optional(),
            thrombocytopenia: z.enum(['mild', 'severe', 'absent']).optional(),
            microfilaremia: z.enum(['present', 'absent']).optional(),
            hemoparasites_seen: z.array(z.string()).optional(),
        }).optional(),
        biochemistry: z.object({
            alt_ast: z.enum(['normal', 'mildly_elevated', 'markedly_elevated']).optional(),
            albumin: z.enum(['normal', 'hypoalbuminemia']).optional(),
            bun_creatinine: z.enum(['normal', 'azotemia']).optional(),
            globulins: z.enum(['normal', 'hyperglobulinemia']).optional(),
            glucose: z.enum(['normal', 'hyperglycemia', 'hypoglycemia']).optional(),
            total_protein: z.enum(['normal', 'elevated', 'decreased']).optional(),
            bilirubin: z.enum(['normal', 'elevated']).optional(),
            calcium: z.enum(['normal', 'hypercalcemia', 'hypocalcemia']).optional(),
        }).optional(),
        urinalysis: z.object({
            proteinuria: z.enum(['present', 'absent']).optional(),
            glucose_in_urine: z.enum(['present', 'absent']).optional(),
            casts: z.enum(['present', 'absent']).optional(),
            specific_gravity: z.number().optional(),
            sediment: z.array(z.string()).optional(),
        }).optional(),
        thoracic_radiograph: z.object({
            pulmonary_pattern: z.enum(['bronchial', 'alveolar', 'interstitial', 'vascular', 'normal', 'mixed']).optional(),
            pulmonary_artery_enlargement: z.enum(['present', 'absent']).optional(),
            cardiomegaly: z.enum(['right_sided', 'left_sided', 'generalised', 'absent']).optional(),
            pleural_effusion: z.enum(['present', 'absent']).optional(),
            mass_lesion: z.enum(['present', 'absent']).optional(),
            tracheal_deviation: z.enum(['present', 'absent']).optional(),
            tracheal_collapse_seen: z.enum(['present', 'absent']).optional(),
        }).optional(),
        abdominal_ultrasound: z.object({
            hepatomegaly: z.enum(['present', 'absent']).optional(),
            splenomegaly: z.enum(['present', 'absent']).optional(),
            ascites: z.enum(['present', 'absent']).optional(),
            lymphadenopathy: z.enum(['present', 'absent']).optional(),
            mass_lesion: z.enum(['present', 'absent']).optional(),
            hyperechoic_liver: z.enum(['present', 'absent']).optional(),
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
