import {
    FEATURE_TIER_MULTIPLIER,
    extractClinicalSignals,
    getFeatureLabel,
    type ClinicalSignals,
    type SignalKey,
} from '@/lib/ai/clinicalSignals';
import { evaluateEmergencyRules, type EmergencyRuleResult } from '@/lib/ai/emergencyRules';
import type { ContradictionResult } from '@/lib/ai/contradictionEngine';
import {
    buildSignalWeightProfile,
    profileToFeatureImportance,
    type SignalWeightProfile,
} from '@/lib/clinicalSignal/signalWeightEngine';
import {
    buildMechanismClassOutput,
    getSuppressedAcuteAbdominalFeatures,
    hasClassicGdvPattern,
    hasPerfusionCompromise,
    isGenericMechanismDiagnosis,
    shouldSuppressAcuteAbdominalFeature,
    type MechanismClassOutput,
} from '@/lib/ai/abdominalEmergency';
import {
    getOrganSystemDisplayLabel,
    getMasterDiseaseOntology,
    normalizeOntologyDiseaseName,
    scoreClosedWorldDiseases,
} from '@/lib/ai/diseaseOntology';
import { runClinicalInferenceEngine } from '@/lib/inference/engine';
import type { InferenceExplanation } from '@/lib/inference/types';

type ConditionClass =
    | 'Mechanical'
    | 'Infectious'
    | 'Toxic'
    | 'Neoplastic'
    | 'Autoimmune / Immune-Mediated'
    | 'Metabolic / Endocrine'
    | 'Traumatic'
    | 'Degenerative'
    | 'Idiopathic / Unknown';

export interface DifferentialDriver {
    feature: string;
    weight: number;
}

export interface DifferentialEntry {
    name: string;
    probability: number;
    key_drivers?: DifferentialDriver[];
    rank?: number;
    condition?: string;
    confidence?: 'high' | 'moderate' | 'low';
    determination_basis?: 'pathognomonic_test' | 'syndrome_pattern' | 'symptom_scoring' | 'exclusion_reasoning';
    supporting_evidence?: Array<{ finding: string; weight: 'definitive' | 'strong' | 'supportive' | 'minor' }>;
    contradicting_evidence?: Array<{ finding: string; weight: 'excludes' | 'weakens' }>;
    relationship_to_primary?: {
        type: 'secondary' | 'complication' | 'co-morbidity' | 'differential';
        primary_condition: string;
    };
    clinical_urgency?: 'immediate' | 'urgent' | 'routine';
    recommended_confirmatory_tests?: string[];
    recommended_next_steps?: string[];
}

export interface DifferentialSpread {
    top_1_probability: number | null;
    top_2_probability: number | null;
    top_3_probability: number | null;
    spread: number | null;
}

export interface SafetyLayerResult {
    diagnosis: Record<string, unknown>;
    inference_explanation?: InferenceExplanation;
    mechanism_class: MechanismClassOutput;
    diagnosis_feature_importance: Record<string, number>;
    suppressed_signals: string[];
    uncertainty_notes: string[];
    confidence_cap: number;
    was_capped: boolean;
    abstain_recommendation: boolean;
    abstain_reason?: string;
    rule_overrides: string[];
    differential_spread: DifferentialSpread | null;
    telemetry: Record<string, unknown>;
}

interface CandidateDefinition {
    name: string;
    aliases: string[];
    conditionClass: ConditionClass;
    features: Partial<Record<SignalKey, number>>;
    penalties?: Partial<Record<SignalKey, number>>;
}

interface CandidateScore {
    name: string;
    conditionClass: ConditionClass;
    rawScore: number;
    probability: number;
    organSystems: string[];
    dominantSystemAligned: boolean;
    dominantSystemSupport: number;
    genericSymptomDownweight: number;
    crossSystemMismatch: number;
    drivers: DifferentialDriver[];
}

interface CandidateScoringResult {
    scores: CandidateScore[];
    signalHierarchy: ReturnType<typeof scoreClosedWorldDiseases>['signalHierarchy'];
    activeCategories: ReturnType<typeof scoreClosedWorldDiseases>['activeCategories'];
}

const CONDITION_CLASSES: ConditionClass[] = [
    'Mechanical',
    'Infectious',
    'Toxic',
    'Neoplastic',
    'Autoimmune / Immune-Mediated',
    'Metabolic / Endocrine',
    'Traumatic',
    'Degenerative',
    'Idiopathic / Unknown',
];

const CANDIDATES: CandidateDefinition[] = [
    {
        name: 'Gastric Dilatation-Volvulus (GDV)',
        aliases: ['gdv', 'gastric dilatation-volvulus', 'gastric dilatation volvulus'],
        conditionClass: 'Mechanical',
        features: {
            unproductive_retching: 0.48,
            abdominal_distension: 0.46,
            acute_onset: 0.14,
            collapse: 0.2,
            dyspnea: 0.12,
            tachycardia: 0.12,
            pale_mucous_membranes: 0.14,
            hypersalivation: 0.1,
            recent_meal: 0.06,
        },
        penalties: {
            diarrhea: 0.03,
            fever: 0.05,
            productive_vomiting: 0.06,
        },
    },
    {
        name: 'Simple Gastric Dilatation',
        aliases: ['gastric dilatation', 'simple bloat'],
        conditionClass: 'Mechanical',
        features: {
            abdominal_distension: 0.34,
            unproductive_retching: 0.1,
            hypersalivation: 0.08,
            tachycardia: 0.08,
            recent_meal: 0.12,
        },
        penalties: {
            collapse: 0.08,
            pale_mucous_membranes: 0.08,
        },
    },
    {
        name: 'Mesenteric Volvulus',
        aliases: ['mesenteric torsion'],
        conditionClass: 'Mechanical',
        features: {
            abdominal_distension: 0.18,
            abdominal_pain: 0.12,
            acute_onset: 0.12,
            collapse: 0.22,
            dyspnea: 0.1,
            tachycardia: 0.16,
            pale_mucous_membranes: 0.18,
            weakness: 0.1,
            fever: 0.03,
        },
    },
    {
        name: 'Foreign Body Obstruction',
        aliases: ['intestinal obstruction', 'bowel obstruction', 'foreign body'],
        conditionClass: 'Mechanical',
        features: {
            productive_vomiting: 0.24,
            unproductive_retching: 0.06,
            abdominal_distension: 0.1,
            abdominal_pain: 0.12,
            weakness: 0.08,
            hypersalivation: 0.08,
            anorexia: 0.08,
            recent_meal: 0.04,
        },
        penalties: {
            pale_mucous_membranes: 0.06,
            collapse: 0.08,
        },
    },
    {
        name: 'Peritonitis / Septic Abdomen',
        aliases: ['peritonitis', 'septic abdomen', 'septic peritonitis'],
        conditionClass: 'Infectious',
        features: {
            abdominal_pain: 0.24,
            collapse: 0.18,
            pale_mucous_membranes: 0.14,
            tachycardia: 0.14,
            weakness: 0.1,
            fever: 0.1,
            productive_vomiting: 0.08,
        },
    },
    {
        name: 'Acute Gastroenteritis',
        aliases: ['gastroenteritis'],
        conditionClass: 'Infectious',
        features: {
            diarrhea: 0.22,
            productive_vomiting: 0.18,
            fever: 0.14,
            lethargy: 0.08,
            anorexia: 0.08,
            weakness: 0.05,
        },
        penalties: {
            unproductive_retching: 0.14,
            abdominal_distension: 0.14,
            collapse: 0.1,
            pale_mucous_membranes: 0.08,
        },
    },
    {
        name: 'Pancreatitis',
        aliases: ['acute pancreatitis'],
        conditionClass: 'Idiopathic / Unknown',
        features: {
            productive_vomiting: 0.2,
            fever: 0.1,
            anorexia: 0.1,
            weakness: 0.08,
        },
        penalties: {
            unproductive_retching: 0.1,
            abdominal_distension: 0.1,
            collapse: 0.06,
        },
    },
    {
        name: 'Toxic Ingestion',
        aliases: ['poisoning', 'toxin exposure'],
        conditionClass: 'Toxic',
        features: {
            hypersalivation: 0.18,
            productive_vomiting: 0.12,
            collapse: 0.1,
            tachycardia: 0.1,
            weakness: 0.08,
            seizures: 0.12,
        },
    },
    {
        name: 'Sepsis / Septic Shock',
        aliases: ['sepsis', 'septic shock'],
        conditionClass: 'Infectious',
        features: {
            fever: 0.16,
            collapse: 0.14,
            tachycardia: 0.12,
            dyspnea: 0.1,
            pale_mucous_membranes: 0.1,
            weakness: 0.1,
        },
    },
    {
        name: 'Canine Distemper',
        aliases: ['distemper', 'canine distemper virus'],
        conditionClass: 'Infectious',
        features: {
            myoclonus: 0.36,
            seizures: 0.18,
            nasal_discharge: 0.16,
            pneumonia: 0.16,
            fever: 0.12,
        },
    },
    {
        name: 'Canine Infectious Tracheobronchitis',
        aliases: ['kennel cough', 'infectious tracheobronchitis', 'canine infectious tracheobronchitis'],
        conditionClass: 'Infectious',
        features: {
            honking_cough: 0.42,
            cough: 0.2,
            nasal_discharge: 0.12,
            ocular_discharge: 0.1,
            fever: 0.06,
            lethargy: 0.04,
        },
        penalties: {
            abdominal_distension: 0.08,
            unproductive_retching: 0.08,
            collapse: 0.05,
            productive_vomiting: 0.05,
        },
    },
    {
        name: 'Tracheal Collapse',
        aliases: ['tracheal collapse', 'collapsed trachea'],
        conditionClass: 'Degenerative',
        features: {
            honking_cough: 0.34,
            cough: 0.18,
            dyspnea: 0.12,
            weakness: 0.04,
        },
        penalties: {
            fever: 0.09,
            nasal_discharge: 0.06,
            ocular_discharge: 0.06,
            abdominal_distension: 0.06,
        },
    },
    {
        name: 'Bronchitis',
        aliases: ['canine bronchitis', 'chronic bronchitis', 'bronchitis'],
        conditionClass: 'Degenerative',
        features: {
            cough: 0.28,
            honking_cough: 0.14,
            dyspnea: 0.1,
            lethargy: 0.05,
            weakness: 0.04,
        },
        penalties: {
            abdominal_distension: 0.06,
            unproductive_retching: 0.06,
        },
    },
    {
        name: 'Upper Respiratory Infection',
        aliases: ['upper respiratory infection', 'respiratory infection'],
        conditionClass: 'Infectious',
        features: {
            cough: 0.18,
            honking_cough: 0.12,
            nasal_discharge: 0.22,
            ocular_discharge: 0.18,
            fever: 0.08,
            lethargy: 0.04,
        },
        penalties: {
            abdominal_distension: 0.08,
            unproductive_retching: 0.08,
            collapse: 0.04,
        },
    },
    {
        name: 'Bacterial Pneumonia',
        aliases: ['pneumonia'],
        conditionClass: 'Infectious',
        features: {
            pneumonia: 0.22,
            dyspnea: 0.18,
            fever: 0.14,
            nasal_discharge: 0.1,
            weakness: 0.06,
        },
    },
    {
        name: 'Canine Parvovirus',
        aliases: ['parvovirus', 'parvo'],
        conditionClass: 'Infectious',
        features: {
            productive_vomiting: 0.14,
            diarrhea: 0.2,
            fever: 0.14,
            weakness: 0.1,
            anorexia: 0.08,
        },
    },
    {
        name: 'Hyperadrenocorticism',
        aliases: ['cushing disease', "cushing's disease", 'cushings disease', 'hyperadrenocorticism', 'cushing syndrome'],
        conditionClass: 'Metabolic / Endocrine',
        features: {
            marked_alp_elevation: 0.28,
            pot_bellied_appearance: 0.18,
            panting: 0.14,
            alopecia: 0.16,
            hypercholesterolemia: 0.14,
            supportive_acth_stimulation_test: 0.34,
            dilute_urine: 0.12,
            polyuria: 0.08,
            polydipsia: 0.08,
            polyphagia: 0.06,
            lethargy: 0.03,
            abdominal_distension: 0.04,
        },
        penalties: {
            glucosuria: 0.04,
            ketonuria: 0.05,
            weight_loss: 0.03,
        },
    },
    {
        name: 'Diabetes Mellitus',
        aliases: ['diabetes mellitus', 'diabetes', 'canine diabetes'],
        conditionClass: 'Metabolic / Endocrine',
        features: {
            significant_hyperglycemia: 0.3,
            glucosuria: 0.28,
            ketonuria: 0.16,
            diabetic_metabolic_profile: 0.2,
            weight_loss: 0.12,
            polyuria: 0.08,
            polydipsia: 0.08,
            polyphagia: 0.06,
            lethargy: 0.03,
        },
        penalties: {
            marked_alp_elevation: 0.05,
            supportive_acth_stimulation_test: 0.08,
            glucosuria_absent: 0.14,
        },
    },
    {
        name: 'Unknown Mixed Presentation',
        aliases: ['unknown'],
        conditionClass: 'Idiopathic / Unknown',
        features: {
            weakness: 0.06,
            lethargy: 0.06,
            diarrhea: 0.05,
            productive_vomiting: 0.05,
        },
    },
];

const LEGACY_CANONICAL_NAME_OVERRIDES = new Map<string, string>([
    ['foreign body obstruction', 'Intestinal Obstruction'],
    ['peritonitis / septic abdomen', 'Septic Peritonitis'],
    ['peritonitis', 'Septic Peritonitis'],
    ['septic abdomen', 'Septic Peritonitis'],
    ['pancreatitis', 'Acute Pancreatitis'],
    ['canine distemper', 'Canine Distemper, Neurologic Form'],
    ['bacterial pneumonia', 'Pneumonia'],
]);

const ACTIVE_CANDIDATES: CandidateDefinition[] = getMasterDiseaseOntology().map((entry) => ({
    name: entry.name,
    aliases: entry.aliases,
    conditionClass: entry.condition_class,
    features: {},
    penalties: {},
}));

const CANDIDATE_LOOKUP = new Map<string, CandidateDefinition>(
    ACTIVE_CANDIDATES.map((candidate) => [candidate.name, candidate]),
);

const CANONICAL_NAME_ALIASES = new Map<string, string>(
    ACTIVE_CANDIDATES.flatMap((candidate) => [
        [candidate.name.toLowerCase(), candidate.name],
        ...candidate.aliases.map((alias) => [alias.toLowerCase(), candidate.name] as const),
    ]),
);

for (const [legacyName, canonicalName] of LEGACY_CANONICAL_NAME_OVERRIDES.entries()) {
    CANONICAL_NAME_ALIASES.set(legacyName, canonicalName);
}

export function applyDiagnosticSafetyLayer(params: {
    inputSignature: Record<string, unknown>;
    diagnosis: Record<string, unknown>;
    contradiction: ContradictionResult | null;
    emergencyEval: EmergencyRuleResult;
    modelVersion: string;
    existingDiagnosisFeatureImportance?: Record<string, unknown> | null;
    existingUncertaintyNotes?: unknown;
    inferenceId?: string;
    simulationId?: string;
}): SafetyLayerResult {
    const signals = extractClinicalSignals(params.inputSignature);
    const contradictionScore = params.contradiction?.contradiction_score ?? 0;
    const signalWeightProfile = buildSignalWeightProfile(params.inputSignature, { contradiction: params.contradiction });
    const heuristicScoring = scoreCandidates(signals, params.inputSignature);
    const heuristicScores = heuristicScoring.scores;
    const evidenceInference = runClinicalInferenceEngine(params.inputSignature);
    const existingDifferentials = normalizeExistingDifferentials(params.diagnosis.top_differentials);
    const mergedDifferentials = evidenceInference.differentials.length > 0
        ? normalizeExistingDifferentials(evidenceInference.diagnosis.top_differentials)
        : mergeDifferentials({
            contradictionScore,
            heuristicScores,
            signalHierarchy: heuristicScoring.signalHierarchy,
            existingDifferentials,
            emergencyEval: params.emergencyEval,
            signals,
        });
    const mechanismClass = buildMechanismClassOutput({
        signals,
        differentials: mergedDifferentials,
        emergencyEval: params.emergencyEval,
    });
    const differentialSpread = evidenceInference.differential_spread ?? computeDifferentialSpread(mergedDifferentials);
    const conditionClassProbabilities = evidenceInference.diagnosis.condition_class_probabilities ?? buildConditionClassProbabilities(mergedDifferentials);
    const primaryClassMass = Math.max(...Object.values(conditionClassProbabilities));
    const preservedEmergency = params.emergencyEval.emergency_rule_reasons.some((reason) => reason.toLowerCase().includes('persistence'));
    const syndromeStable = (preservedEmergency && primaryClassMass >= 0.72) || primaryClassMass >= 0.82;

    const providedConfidence = typeof evidenceInference.diagnosis.confidence_score === 'number'
        ? evidenceInference.diagnosis.confidence_score
        : typeof params.diagnosis.confidence_score === 'number'
            ? params.diagnosis.confidence_score
            : null;
    const leadingProbability = mergedDifferentials[0]?.probability ?? 0.3;
    const margin = differentialSpread?.spread ?? 0;
    const derivedConfidence = 0.36 + (leadingProbability * 0.45) + Math.min(0.12, margin * 0.5) + (syndromeStable ? 0.16 : 0);
    const baseConfidence = clamp(
        providedConfidence != null ? Math.max(providedConfidence, derivedConfidence) : derivedConfidence,
        0.18,
        0.88,
    );
    const preCapConfidence = clamp(baseConfidence - (contradictionScore * 0.22), 0.12, 0.88);
    const confidenceCap = params.contradiction?.confidence_cap ?? 1;
    const postCapConfidence = Math.min(preCapConfidence, confidenceCap);
    const wasCapped = postCapConfidence < preCapConfidence - 0.0001;

    const isUnstable =
        !syndromeStable && (
            mergedDifferentials.length < 3 ||
            leadingProbability < 0.5 ||
            (differentialSpread?.spread ?? 0) < 0.12
        );
    const abstainRecommendation =
        Boolean(params.contradiction?.abstain) ||
        (contradictionScore >= 0.4 && isUnstable) ||
        (!syndromeStable && isUnstable && (postCapConfidence <= 0.45 || leadingProbability <= 0.34));
    const abstainReason = !abstainRecommendation
        ? undefined
        : contradictionScore >= 0.4
            ? 'Contradictory clinical context exceeds safe diagnosis-confidence threshold while emergency severity remains high'
            : 'Differential remains too broad for a safe high-confidence diagnosis; clinician review is recommended';

    const diagnosisFeatureImportance = Object.keys(evidenceInference.diagnosis_feature_importance).length > 0
        ? evidenceInference.diagnosis_feature_importance
        : buildDiagnosisFeatureImportance(signals, mergedDifferentials, heuristicScores, signalWeightProfile);
    const suppressedSignals = getSuppressedAcuteAbdominalFeatures(signals);
    const uncertaintyNotes = mergeNoteSets(
        buildUncertaintyNotes({
            contradiction: params.contradiction,
            contradictionScore,
            emergencyEval: params.emergencyEval,
            isUnstable,
            postCapConfidence,
            existingNotes: params.existingUncertaintyNotes,
            signals,
            signalHierarchy: heuristicScoring.signalHierarchy,
        }),
        evidenceInference.uncertainty_notes,
    );
    const primaryConditionClass = evidenceInference.diagnosis.primary_condition_class ?? pickPrimaryConditionClass(mergedDifferentials, params.diagnosis.primary_condition_class, signals);
    const diagnosisAnalysis = typeof evidenceInference.diagnosis.analysis === 'string' && evidenceInference.diagnosis.analysis.trim().length > 0
        ? evidenceInference.diagnosis.analysis
        : buildAnalysisText(
            params.diagnosis.analysis,
            mergedDifferentials,
            contradictionScore,
            params.emergencyEval,
            heuristicScoring.signalHierarchy,
    );

    const diagnosis: Record<string, unknown> = {
        ...params.diagnosis,
        analysis: diagnosisAnalysis,
        primary_condition_class: primaryConditionClass,
        condition_class_probabilities: conditionClassProbabilities,
        top_differentials: mergedDifferentials,
        confidence_score: postCapConfidence,
    };

    return {
        diagnosis,
        inference_explanation: evidenceInference.inference_explanation,
        mechanism_class: mechanismClass,
        diagnosis_feature_importance: diagnosisFeatureImportance,
        suppressed_signals: suppressedSignals,
        uncertainty_notes: uncertaintyNotes,
        confidence_cap: confidenceCap,
        was_capped: wasCapped,
        abstain_recommendation: abstainRecommendation,
        abstain_reason: abstainReason,
        rule_overrides: [...params.emergencyEval.emergency_rule_reasons],
        differential_spread: differentialSpread,
        telemetry: {
            model_version: params.modelVersion,
            inference_id: params.inferenceId ?? null,
            simulation_id: params.simulationId ?? null,
            pre_cap_confidence: Number(preCapConfidence.toFixed(3)),
            post_cap_confidence: Number(postCapConfidence.toFixed(3)),
            contradiction_triggers: params.contradiction?.contradiction_reasons ?? [],
            persistence_rule_triggers: params.emergencyEval.emergency_rule_reasons.filter((reason) => reason.toLowerCase().includes('persistence')),
            differential_widened: contradictionScore >= 0.4,
            signal_weight_applied_overrides: signalWeightProfile.applied_overrides,
            suppressed_signals: suppressedSignals,
            mechanism_class: mechanismClass,
            signal_hierarchy: heuristicScoring.signalHierarchy,
            ontology_active_categories: heuristicScoring.activeCategories,
            inference_engine_primary_basis: evidenceInference.inference_explanation?.primary_determination ?? null,
            inference_engine_key_finding: evidenceInference.inference_explanation?.key_finding ?? null,
        },
    };
}

export function createHeuristicInferencePayload(params: {
    inputSignature: Record<string, unknown>;
    contradiction: ContradictionResult | null;
    modelVersion: string;
    fallbackReason: string;
}): Record<string, unknown> {
    const emergencyEval = evaluateEmergencyRules(params.inputSignature);
    const seedDiagnosis: Record<string, unknown> = {
        analysis: `Deterministic fallback reasoning activated: ${params.fallbackReason}`,
        primary_condition_class: 'Idiopathic / Unknown',
        condition_class_probabilities: {},
        top_differentials: [],
        confidence_score: 0.45,
    };

    const safetyLayer = applyDiagnosticSafetyLayer({
        inputSignature: params.inputSignature,
        diagnosis: seedDiagnosis,
        contradiction: params.contradiction,
        emergencyEval,
        modelVersion: params.modelVersion,
        existingUncertaintyNotes: [`Deterministic fallback reasoning activated: ${params.fallbackReason}`],
    });

    const signals = extractClinicalSignals(params.inputSignature);
    const signalWeightProfile = buildSignalWeightProfile(params.inputSignature, { contradiction: params.contradiction });
    const baseSeverity = inferFallbackSeverity(signals);

    return {
        diagnosis: safetyLayer.diagnosis,
        mechanism_class: safetyLayer.mechanism_class,
        risk_assessment: {
            severity_score: baseSeverity.score,
            emergency_level: baseSeverity.level,
        },
        diagnosis_feature_importance: safetyLayer.diagnosis_feature_importance,
        severity_feature_importance: buildSeverityFeatureImportance(signals, signalWeightProfile),
        suppressed_signals: safetyLayer.suppressed_signals,
        uncertainty_notes: safetyLayer.uncertainty_notes,
    };
}

export function buildSeverityFeatureImportance(
    signals: ClinicalSignals,
    signalWeightProfile?: SignalWeightProfile | null,
): Record<string, number> {
    const features: Record<string, number> = {};
    const keys: SignalKey[] = ['collapse', 'dyspnea', 'tachycardia', 'pale_mucous_membranes', 'seizures', 'abdominal_distension', 'abdominal_pain'];
    for (const key of keys) {
        const evidence = signals.evidence[key];
        if (evidence.present) {
            features[getFeatureLabel(key)] = Number((FEATURE_TIER_MULTIPLIER[evidence.tier] * evidence.strength).toFixed(2));
        }
    }

    if (signalWeightProfile) {
        Object.assign(
            features,
            {
                ...features,
                ...profileToFeatureImportance(signalWeightProfile, {
                    includeCategories: ['red_flag', 'primary_signal'],
                    topN: 6,
                }),
            },
        );
    }

    return features;
}

function scoreCandidates(
    signals: ClinicalSignals,
    inputSignature: Record<string, unknown>,
): CandidateScoringResult {
    const closedWorldScores = scoreClosedWorldDiseases({
        inputSignature,
        observationHints: buildOntologyObservationHints(signals),
        species: signals.species,
    });

    return {
        signalHierarchy: closedWorldScores.signalHierarchy,
        activeCategories: closedWorldScores.activeCategories,
        scores: closedWorldScores.ranked.map((candidate) => ({
            name: candidate.name,
            conditionClass: candidate.conditionClass,
            rawScore: Math.max(0.01, Number(candidate.rawScore.toFixed(3))),
            probability: 0,
            organSystems: candidate.organSystems,
            dominantSystemAligned: candidate.dominantSystemAligned,
            dominantSystemSupport: candidate.dominantSystemSupport,
            genericSymptomDownweight: candidate.penalties.generic_symptom_downweight,
            crossSystemMismatch: candidate.penalties.cross_system_mismatch,
            drivers: candidate.drivers
                .map((driver) => ({
                    feature: driver.feature,
                    weight: Number(driver.weight.toFixed(2)),
                }))
                .sort((left, right) => right.weight - left.weight)
                .slice(0, 5),
        })),
    };
}

function buildOntologyObservationHints(signals: ClinicalSignals): string[] {
    const hints = new Set<string>();
    const signalMap: Array<[SignalKey, string]> = [
        ['unproductive_retching', 'retching_unproductive'],
        ['productive_vomiting', 'vomiting'],
        ['diarrhea', 'diarrhea'],
        ['abdominal_distension', 'abdominal_distension'],
        ['abdominal_pain', 'abdominal_pain'],
        ['hypersalivation', 'hypersalivation'],
        ['collapse', 'collapse'],
        ['cyanosis', 'cyanosis'],
        ['weakness', 'weakness'],
        ['lethargy', 'lethargy'],
        ['anorexia', 'anorexia'],
        ['fever', 'fever'],
        ['pale_mucous_membranes', 'pale_mucous_membranes'],
        ['tachycardia', 'tachycardia'],
        ['dyspnea', 'dyspnea'],
        ['cough', 'cough'],
        ['honking_cough', 'honking_cough'],
        ['seizures', 'seizures'],
        ['myoclonus', 'myoclonus'],
        ['alopecia', 'alopecia'],
        ['weight_loss', 'weight_loss'],
        ['polyuria', 'polyuria'],
        ['polydipsia', 'polydipsia'],
        ['polyphagia', 'polyphagia'],
        ['panting', 'panting'],
        ['pot_bellied_appearance', 'pot_bellied_appearance'],
        ['marked_alp_elevation', 'marked_alp_elevation'],
        ['hypercholesterolemia', 'hypercholesterolemia'],
        ['supportive_acth_stimulation_test', 'supportive_acth_stimulation_test'],
        ['dilute_urine', 'dilute_urine'],
        ['significant_hyperglycemia', 'significant_hyperglycemia'],
        ['mild_hyperglycemia', 'mild_hyperglycemia'],
        ['glucosuria', 'glucosuria'],
        ['ketonuria', 'ketonuria'],
        ['diabetic_metabolic_profile', 'diabetic_metabolic_profile'],
        ['nasal_discharge', 'cough'],
        ['ocular_discharge', 'cough'],
        ['pneumonia', 'pneumonia'],
        ['recent_meal', 'recent_meal'],
        ['acute_onset', 'acute_onset'],
    ];

    for (const [signalKey, observation] of signalMap) {
        if (signals.evidence[signalKey].present) {
            hints.add(observation);
        }
    }

    if (signals.has_deep_chested_breed_risk) {
        hints.add('deep_chested_breed_risk');
    }
    if (signals.has_acute_onset) {
        hints.add('acute_onset');
    }
    if (signals.has_chronic_duration) {
        hints.add('chronic_duration');
    }
    if (signals.has_gradual_onset) {
        hints.add('gradual_onset');
    }
    if (signals.has_explicit_glucosuria_absence) {
        hints.add('glucosuria_absent');
    }

    return [...hints];
}

function mergeDifferentials(params: {
    contradictionScore: number;
    heuristicScores: CandidateScore[];
    signalHierarchy: CandidateScoringResult['signalHierarchy'];
    existingDifferentials: DifferentialEntry[];
    emergencyEval: EmergencyRuleResult;
    signals: ClinicalSignals;
}): DifferentialEntry[] {
    const temperature = 0.78 + (params.contradictionScore * 1.1);
    const heuristicProbabilities = softmax(params.heuristicScores.map((candidate) => candidate.rawScore), temperature);
    const heuristicByName = new Map<string, CandidateScore>();

    params.heuristicScores.forEach((candidate, index) => {
        heuristicByName.set(candidate.name, {
            ...candidate,
            probability: heuristicProbabilities[index] ?? 0,
        });
    });

    const combined = new Map<string, DifferentialEntry>();
    const heuristicWeight = params.contradictionScore >= 0.4 ? 0.68 : 0.58;
    const modelWeight = 1 - heuristicWeight;

    for (const heuristic of heuristicByName.values()) {
        combined.set(heuristic.name, {
            name: heuristic.name,
            probability: heuristic.probability * heuristicWeight,
            key_drivers: heuristic.drivers,
        });
    }

    for (const differential of params.existingDifferentials) {
        const canonicalName = toCanonicalName(differential.name);
        if (!canonicalName) {
            continue;
        }
        const existing = combined.get(canonicalName);
        const mergedProbability = (differential.probability * modelWeight) + (existing?.probability ?? 0);
        combined.set(canonicalName, {
            name: canonicalName,
            probability: mergedProbability,
            key_drivers: existing?.key_drivers ?? differential.key_drivers,
        });
    }

    if (params.contradictionScore >= 0.4) {
        widenDifferentials(combined, 0.08 + (params.contradictionScore * 0.08));
    }

    applyPersistenceProtection(combined, params);
    applyAnchorFeatureProtection(combined, params.signals);
    applyConditionClassStabilization(combined, params.signals);
    applyEndocrineDifferentialLogic(combined, params.signals);
    applyOrganSystemDominanceReranking(combined, params);
    enforceDominantClusterConsistency(combined, params.signals);
    applyClassicGdvDominance(combined, params.signals);
    normalizeProbabilities(combined);

    return [...combined.values()]
        .sort((left, right) => right.probability - left.probability)
        .slice(0, 6)
        .map((entry) => ({
            ...entry,
            probability: Number(entry.probability.toFixed(3)),
        }));
}

function setCanonicalFloor(
    combined: Map<string, DifferentialEntry>,
    rawName: string,
    floor: number,
): void {
    const canonicalName = toCanonicalName(rawName);
    if (!canonicalName) {
        return;
    }

    const existing = combined.get(canonicalName);
    combined.set(canonicalName, {
        name: canonicalName,
        probability: Math.max(existing?.probability ?? 0, floor),
        key_drivers: existing?.key_drivers,
    });
}

function getCanonicalNameSet(names: string[]): Set<string> {
    const canonicalNames = names
        .map((name) => toCanonicalName(name))
        .filter((name): name is string => Boolean(name));
    return new Set(canonicalNames);
}

function applyPersistenceProtection(
    combined: Map<string, DifferentialEntry>,
    params: {
        contradictionScore: number;
        emergencyEval: EmergencyRuleResult;
        signals: ClinicalSignals;
    },
): void {
    const persistenceTriggered = params.emergencyEval.emergency_rule_reasons.some((reason) => reason.toLowerCase().includes('persistence'));
    if (!persistenceTriggered) {
        return;
    }

    const floors = params.contradictionScore >= 0.7
        ? new Map<string, number>([
            ['Gastric Dilatation-Volvulus (GDV)', 0.24],
            ['Simple Gastric Dilatation', 0.12],
            ['Mesenteric Volvulus', 0.11],
            ['Intestinal Obstruction', 0.12],
        ])
        : new Map<string, number>([
            ['Gastric Dilatation-Volvulus (GDV)', hasClassicGdvPattern(params.signals) ? 0.52 : 0.38],
            ['Simple Gastric Dilatation', 0.14],
            ['Mesenteric Volvulus', 0.12],
            ['Intestinal Obstruction', 0.12],
        ]);

    for (const [name, floor] of floors.entries()) {
        setCanonicalFloor(combined, name, floor);
    }

    if (params.signals.has_small_breed_gdv_mismatch) {
        const gdv = combined.get('Gastric Dilatation-Volvulus (GDV)');
        if (gdv != null) {
            gdv.probability = Math.max(gdv.probability, params.contradictionScore >= 0.7 ? 0.24 : 0.28);
        }
    }
}

function applyAnchorFeatureProtection(
    combined: Map<string, DifferentialEntry>,
    signals: ClinicalSignals,
) {
    const floors = new Map<string, number>();

    if (signals.evidence.unproductive_retching.present) {
        floors.set('Gastric Dilatation-Volvulus (GDV)', 0.15);
    }

    if (signals.evidence.honking_cough.present) {
        floors.set('Canine Infectious Tracheobronchitis', Math.max(floors.get('Canine Infectious Tracheobronchitis') ?? 0, 0.18));
        floors.set('Tracheal Collapse', Math.max(floors.get('Tracheal Collapse') ?? 0, 0.15));
        floors.set('Bronchitis', Math.max(floors.get('Bronchitis') ?? 0, 0.12));
    }

    if (signals.evidence.ocular_discharge.present && signals.evidence.nasal_discharge.present) {
        floors.set('Canine Infectious Tracheobronchitis', Math.max(floors.get('Canine Infectious Tracheobronchitis') ?? 0, 0.15));
        floors.set('Pneumonia', Math.max(floors.get('Pneumonia') ?? 0, 0.12));
    }

    for (const [name, floor] of floors.entries()) {
        setCanonicalFloor(combined, name, floor);
    }
}

function applyConditionClassStabilization(
    combined: Map<string, DifferentialEntry>,
    signals: ClinicalSignals,
) {
    if (signals.upper_airway_pattern_strength < 2) {
        return;
    }

    const boostNames = getCanonicalNameSet([
        'Canine Infectious Tracheobronchitis',
        'Tracheal Collapse',
        'Bronchitis',
        'Pneumonia',
    ]);
    const dampenedClasses = new Set<ConditionClass>([
        'Neoplastic',
        'Toxic',
        'Metabolic / Endocrine',
    ]);

    for (const entry of combined.values()) {
        const definition = CANDIDATE_LOOKUP.get(entry.name);
        if (definition == null) continue;

        if (boostNames.has(entry.name)) {
            const boost = definition.conditionClass === 'Infectious'
                ? (signals.respiratory_infection_pattern_strength >= 2.4 ? 0.08 : 0.05)
                : 0.04;
            entry.probability += boost;
            continue;
        }

        if (dampenedClasses.has(definition.conditionClass)) {
            entry.probability *= 0.82;
        }
    }
}

function applyEndocrineDifferentialLogic(
    combined: Map<string, DifferentialEntry>,
    signals: ClinicalSignals,
) {
    const hyperadrenocorticism = combined.get('Hyperadrenocorticism');
    const diabetesMellitus = combined.get('Diabetes Mellitus');

    if (!hyperadrenocorticism && !diabetesMellitus) {
        return;
    }

    const hyperadrenocorticismAnchors =
        (signals.evidence.marked_alp_elevation.present ? 1 : 0)
        + (signals.evidence.supportive_acth_stimulation_test.present ? 1 : 0)
        + (signals.evidence.pot_bellied_appearance.present ? 1 : 0)
        + (signals.evidence.panting.present ? 1 : 0)
        + (signals.evidence.alopecia.present ? 1 : 0)
        + (signals.evidence.hypercholesterolemia.present ? 1 : 0)
        + (signals.has_chronic_duration ? 1 : 0)
        + (signals.has_gradual_onset ? 1 : 0);

    const diabetesAnchors =
        (signals.evidence.significant_hyperglycemia.present ? 1 : 0)
        + (signals.evidence.glucosuria.present ? 1 : 0)
        + (signals.evidence.ketonuria.present ? 1 : 0)
        + (signals.evidence.diabetic_metabolic_profile.present ? 1 : 0)
        + (signals.evidence.weight_loss.present ? 1 : 0);

    if (
        hyperadrenocorticism
        && (
            signals.evidence.supportive_acth_stimulation_test.present
            || (
                signals.evidence.marked_alp_elevation.present
                && signals.endocrine_body_pattern_strength >= 2
                && (signals.has_chronic_duration || signals.has_gradual_onset)
            )
            || (
                signals.evidence.marked_alp_elevation.present
                && signals.evidence.dilute_urine.present
                && signals.has_explicit_glucosuria_absence
            )
        )
    ) {
        hyperadrenocorticism.probability += 0.12;
        if (diabetesMellitus && (!signals.evidence.glucosuria.present || !signals.evidence.significant_hyperglycemia.present)) {
            diabetesMellitus.probability *= 0.7;
        }
    }

    if (
        diabetesMellitus
        && signals.evidence.significant_hyperglycemia.present
        && signals.evidence.glucosuria.present
    ) {
        diabetesMellitus.probability += signals.evidence.ketonuria.present ? 0.14 : 0.1;
        if (hyperadrenocorticism && hyperadrenocorticismAnchors < 3) {
            hyperadrenocorticism.probability *= 0.82;
        }
    }

    if (diabetesMellitus && signals.has_explicit_glucosuria_absence) {
        diabetesMellitus.probability *= 0.55;
    }

    if (
        diabetesMellitus
        && signals.evidence.mild_hyperglycemia.present
        && !signals.evidence.glucosuria.present
        && !signals.evidence.ketonuria.present
    ) {
        diabetesMellitus.probability *= 0.48;
        if (hyperadrenocorticism && hyperadrenocorticismAnchors >= 2) {
            hyperadrenocorticism.probability = Math.max(hyperadrenocorticism.probability, diabetesMellitus.probability + 0.08);
        }
    }

    if (
        hyperadrenocorticism
        && diabetesMellitus
        && signals.endocrine_shared_pattern_strength >= 1.2
        && hyperadrenocorticismAnchors >= 2
        && diabetesAnchors <= 1
    ) {
        hyperadrenocorticism.probability = Math.max(hyperadrenocorticism.probability, diabetesMellitus.probability + 0.06);
    }

    if (
        (hasClassicGdvPattern(signals) || (signals.evidence.abdominal_distension.present && signals.has_acute_onset))
        && !signals.evidence.significant_hyperglycemia.present
        && !signals.evidence.glucosuria.present
        && !signals.evidence.marked_alp_elevation.present
    ) {
        if (hyperadrenocorticism) {
            hyperadrenocorticism.probability *= 0.4;
        }
        if (diabetesMellitus) {
            diabetesMellitus.probability *= 0.32;
        }
    }
}

function applyOrganSystemDominanceReranking(
    combined: Map<string, DifferentialEntry>,
    params: {
        heuristicScores: CandidateScore[];
        signalHierarchy: CandidateScoringResult['signalHierarchy'];
    },
) {
    if (!params.signalHierarchy.dominant_system || !params.signalHierarchy.cross_system_penalties_active) {
        return;
    }

    const heuristicLookup = new Map(params.heuristicScores.map((score) => [score.name, score]));
    for (const entry of combined.values()) {
        const heuristic = heuristicLookup.get(entry.name);
        if (!heuristic) continue;

        if (heuristic.dominantSystemAligned) {
            const boost = heuristic.dominantSystemSupport >= 0.22
                ? 0.08
                : heuristic.dominantSystemSupport > 0
                    ? 0.04
                    : 0;
            entry.probability += boost;
            continue;
        }

        if (heuristic.crossSystemMismatch > 0) {
            const penaltyFactor = heuristic.dominantSystemSupport >= 0.14
                ? 0.88
                : heuristic.rawScore >= 0.3
                    ? 0.74
                    : 0.6;
            entry.probability *= penaltyFactor;
            continue;
        }

        if (heuristic.genericSymptomDownweight > 0) {
            entry.probability *= 0.92;
        }
    }
}

function applyClassicGdvDominance(
    combined: Map<string, DifferentialEntry>,
    signals: ClinicalSignals,
) {
    if (!hasClassicGdvPattern(signals)) {
        return;
    }

    const gdv = combined.get('Gastric Dilatation-Volvulus (GDV)');
    if (gdv) {
        gdv.probability *= hasPerfusionCompromise(signals) ? 2.1 : 1.7;
        gdv.probability = Math.max(gdv.probability, hasPerfusionCompromise(signals) ? 0.88 : 0.72);
    }

    for (const [name, factor] of [
        ['Simple Gastric Dilatation', hasPerfusionCompromise(signals) ? 0.52 : 0.78],
        ['Mesenteric Volvulus', 0.76],
        ['Intestinal Obstruction', 0.58],
        ['Acute Gastroenteritis', 0.4],
        ['Acute Pancreatitis', 0.46],
        ['Septic Peritonitis', hasPerfusionCompromise(signals) ? 0.82 : 0.9],
    ] as Array<[string, number]>) {
        const canonicalName = toCanonicalName(name);
        if (!canonicalName) continue;
        const entry = combined.get(canonicalName);
        if (!entry) continue;
        entry.probability *= factor;
    }
}

function enforceDominantClusterConsistency(
    combined: Map<string, DifferentialEntry>,
    signals: ClinicalSignals,
) {
    if (signals.upper_airway_pattern_strength < 2.2) {
        return;
    }

    const respiratoryLeaders = [...getCanonicalNameSet([
        'Canine Infectious Tracheobronchitis',
        'Tracheal Collapse',
        'Bronchitis',
        'Pneumonia',
    ])];
    const ranked = [...combined.values()].sort((left, right) => right.probability - left.probability);
    const top = ranked[0];
    if (top && respiratoryLeaders.includes(top.name)) {
        return;
    }

    for (const name of respiratoryLeaders) {
        const entry = combined.get(name);
        if (!entry) continue;
        entry.probability = Math.max(entry.probability, 0.14);
    }
}

function buildDiagnosisFeatureImportance(
    signals: ClinicalSignals,
    finalDifferentials: DifferentialEntry[],
    heuristicScores: CandidateScore[],
    signalWeightProfile: SignalWeightProfile,
): Record<string, number> {
    const importance: Record<string, number> = {};
    const prioritizedNames = new Set(finalDifferentials.slice(0, 3).map((entry) => entry.name));
    const leadingCandidates = heuristicScores
        .filter((candidate) => prioritizedNames.has(candidate.name))
        .sort((left, right) => right.rawScore - left.rawScore)
        .slice(0, 3);

    for (const candidate of leadingCandidates) {
        for (const driver of candidate.drivers) {
            if (shouldSuppressAcuteAbdominalFeature(signals, driver.feature)) continue;
            importance[driver.feature] = Math.max(importance[driver.feature] ?? 0, driver.weight);
        }
    }

    for (const [signalKey, evidence] of Object.entries(signals.evidence) as Array<[SignalKey, ClinicalSignals['evidence'][SignalKey]]>) {
        if (!evidence.present) continue;
        const label = getFeatureLabel(signalKey);
        if (shouldSuppressAcuteAbdominalFeature(signals, label)) continue;
        importance[label] = Math.max(
            importance[label] ?? 0,
            Number((FEATURE_TIER_MULTIPLIER[evidence.tier] * evidence.strength).toFixed(2)),
        );
    }

    const weightedImportance = profileToFeatureImportance(signalWeightProfile, {
        includeCategories: ['red_flag', 'primary_signal'],
        topN: 6,
    });
    for (const [label, weight] of Object.entries(weightedImportance)) {
        if (shouldSuppressAcuteAbdominalFeature(signals, label)) continue;
        importance[label] = Math.max(importance[label] ?? 0, weight);
    }

    return importance;
}

function buildUncertaintyNotes(params: {
    contradiction: ContradictionResult | null;
    contradictionScore: number;
    emergencyEval: EmergencyRuleResult;
    isUnstable: boolean;
    postCapConfidence: number;
    existingNotes: unknown;
    signals: ClinicalSignals;
    signalHierarchy: CandidateScoringResult['signalHierarchy'];
}): string[] {
    const notes = new Set<string>();

    if (Array.isArray(params.existingNotes)) {
        for (const note of params.existingNotes) {
            if (typeof note === 'string' && note.trim().length > 0) {
                notes.add(note);
            }
        }
    }

    if (params.contradictionScore > 0) {
        notes.add('Contradictions were treated as uncertainty penalties rather than as authoritative replacements for core symptom truth.');
    }
    if (params.contradictionScore >= 0.4) {
        notes.add('Differential was intentionally widened because the structured context is internally inconsistent.');
    }
    if (params.emergencyEval.emergency_rule_reasons.some((reason) => reason.toLowerCase().includes('persistence'))) {
        notes.add('High-risk abdominal emergency signatures were preserved in the differential despite contradictory metadata.');
    }
    if (getSuppressedAcuteAbdominalFeatures(params.signals).length > 0) {
        notes.add('Chronic endocrine-style context signals were intentionally suppressed so the acute abdominal emergency cluster could dominate ranking and explainability.');
    }
    if (params.signals.has_small_breed_gdv_mismatch) {
        notes.add('Breed/body-size metadata lowers the classic GDV prior but does not invalidate the emergency syndrome when the signal cluster is strong.');
    }
    if (params.isUnstable) {
        notes.add('Top differentials remain relatively close, so diagnosis certainty should stay conservative.');
    }
    if (params.postCapConfidence <= 0.45) {
        notes.add('Confidence was kept low to reflect unresolved contradiction burden.');
    }
    if (params.signals.evidence.mild_hyperglycemia.present && params.signals.has_explicit_glucosuria_absence) {
        notes.add('Mild hyperglycemia without glucosuria was treated as negative evidence against diabetes-first ranking.');
    }
    if (
        params.signals.evidence.marked_alp_elevation.present
        && params.signals.endocrine_body_pattern_strength >= 2
        && (params.signals.has_chronic_duration || params.signals.has_gradual_onset)
    ) {
        notes.add('Marked ALP elevation with chronic endocrine body-pattern signs was preserved as a hyperadrenocorticism anchor.');
    }
    if (params.signalHierarchy.anchor_locks.length > 0) {
        notes.add('High-specificity signal anchors were protected from generic-noise dilution during differential ranking.');
    }
    if (params.signalHierarchy.dominant_system && params.signalHierarchy.organ_specific_signals.length > 0) {
        notes.add(
            `Dominant ${getOrganSystemDisplayLabel(params.signalHierarchy.dominant_system)} pathophysiology signals were elevated above shared surface symptoms during final ranking.`,
        );
    }
    if (params.signalHierarchy.generic_noise_score >= 0.4) {
        notes.add('Low-specificity generic features were down-weighted so they could widen the differential without hijacking the primary diagnostic direction.');
    }
    if (params.signalHierarchy.cross_system_penalties_active && params.signalHierarchy.generic_signals_downweighted.length > 0) {
        notes.add(
            `Generic symptoms (${params.signalHierarchy.generic_signals_downweighted.map((term) => term.replace(/_/g, ' ')).join(', ')}) were explicitly prevented from overriding the dominant organ-system pattern.`,
        );
    }
    if (params.signalHierarchy.abstain_recommended) {
        notes.add('Signal hierarchy flagged the case as too weakly anchored for an aggressive single-diagnosis commitment.');
    }

    return [...notes];
}

function computeDifferentialSpread(differentials: DifferentialEntry[]): DifferentialSpread | null {
    if (differentials.length < 2) return null;
    const top1 = differentials[0]?.probability ?? null;
    const top2 = differentials[1]?.probability ?? null;
    const top3 = differentials[2]?.probability ?? null;
    return {
        top_1_probability: top1,
        top_2_probability: top2,
        top_3_probability: top3,
        spread: top1 != null && top2 != null ? Number((top1 - top2).toFixed(3)) : null,
    };
}

function buildConditionClassProbabilities(differentials: DifferentialEntry[]): Record<ConditionClass, number> {
    const totals = new Map<ConditionClass, number>(CONDITION_CLASSES.map((conditionClass) => [conditionClass, 0]));

    for (const differential of differentials) {
        const definition = CANDIDATE_LOOKUP.get(differential.name);
        const conditionClass = definition?.conditionClass ?? 'Idiopathic / Unknown';
        totals.set(conditionClass, (totals.get(conditionClass) ?? 0) + differential.probability);
    }

    const totalProbability = [...totals.values()].reduce((sum, value) => sum + value, 0) || 1;
    const result = {} as Record<ConditionClass, number>;
    for (const conditionClass of CONDITION_CLASSES) {
        result[conditionClass] = Number(((totals.get(conditionClass) ?? 0) / totalProbability).toFixed(3));
    }
    return result;
}

function pickPrimaryConditionClass(
    differentials: DifferentialEntry[],
    fallback: unknown,
    signals: ClinicalSignals,
): ConditionClass {
    const classProbabilities = buildConditionClassProbabilities(differentials);
    const sorted = Object.entries(classProbabilities)
        .sort((left, right) => right[1] - left[1]) as Array<[ConditionClass, number]>;
    if (signals.upper_airway_pattern_strength >= 2) {
        const preferred = sorted.find(([conditionClass]) =>
            conditionClass === 'Infectious' || conditionClass === 'Degenerative',
        );
        const leading = sorted[0];
        if (
            preferred &&
            leading &&
            (leading[0] === 'Neoplastic'
                || leading[0] === 'Toxic'
                || leading[0] === 'Metabolic / Endocrine'
                || (leading[0] === 'Idiopathic / Unknown' && preferred[1] >= leading[1] * 0.7))
        ) {
            return preferred[0];
        }
    }
    return sorted[0]?.[0] ?? (typeof fallback === 'string' ? (fallback as ConditionClass) : 'Idiopathic / Unknown');
}

function buildAnalysisText(
    existingAnalysis: unknown,
    differentials: DifferentialEntry[],
    contradictionScore: number,
    emergencyEval: EmergencyRuleResult,
    signalHierarchy: CandidateScoringResult['signalHierarchy'],
): string {
    const topNames = differentials.slice(0, 3).map((differential) => differential.name).join(', ');
    const preservedEmergency = emergencyEval.emergency_rule_reasons.some((reason) => reason.toLowerCase().includes('persistence'));
    const dominanceClause = signalHierarchy.dominant_system
        ? ` Dominant ${getOrganSystemDisplayLabel(signalHierarchy.dominant_system)} pathophysiology was used to prioritize organ-aligned diseases over generic symptom mimics.`
        : '';
    const summary = `Deterministic safety layer preserved the leading syndrome pattern and re-ranked the differential as: ${topNames}.${dominanceClause}`;

    if (typeof existingAnalysis !== 'string' || existingAnalysis.trim().length === 0) {
        return preservedEmergency && contradictionScore > 0
            ? `${summary} Contradictory metadata lowered certainty but did not erase the high-risk emergency pattern.`
            : summary;
    }

    const suffix = preservedEmergency
        ? ' High-risk emergency persistence logic remained active during final ranking.'
        : '';
    return `${existingAnalysis.trim()} ${summary}${suffix}`.trim();
}

function inferFallbackSeverity(signals: ClinicalSignals): { score: number; level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' } {
    if (signals.gdv_cluster_count >= 3 || signals.shock_pattern_strength >= 2.5) {
        return { score: 0.95, level: 'CRITICAL' };
    }
    if (signals.evidence.abdominal_pain.present && signals.evidence.fever.present && hasPerfusionCompromise(signals)) {
        return { score: 0.9, level: 'CRITICAL' };
    }
    if (signals.evidence.seizures.present || signals.evidence.dyspnea.present || signals.distemper_pattern_strength >= 2) {
        return { score: 0.78, level: 'HIGH' };
    }
    if (signals.evidence.fever.present || signals.evidence.productive_vomiting.present || signals.evidence.diarrhea.present) {
        return { score: 0.52, level: 'MODERATE' };
    }
    return { score: 0.3, level: 'LOW' };
}

function normalizeExistingDifferentials(raw: unknown): DifferentialEntry[] {
    if (!Array.isArray(raw)) return [];

    const mapped: Array<DifferentialEntry | null> = raw
        .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const candidate = entry as Record<string, unknown>;
            const name = typeof candidate.name === 'string'
                ? candidate.name
                : typeof candidate.condition === 'string'
                    ? candidate.condition
                    : null;
            if (!name) return null;
            if (isGenericMechanismDiagnosis(name)) return null;
            const canonicalName = toCanonicalName(name);
            if (!canonicalName) return null;
            const probability = typeof candidate.probability === 'number' ? candidate.probability : 0.1;
            return {
                name: canonicalName,
                condition: typeof candidate.condition === 'string' ? candidate.condition : canonicalName,
                rank: typeof candidate.rank === 'number' ? candidate.rank : undefined,
                probability,
                confidence:
                    candidate.confidence === 'high' || candidate.confidence === 'moderate' || candidate.confidence === 'low'
                        ? candidate.confidence
                        : undefined,
                determination_basis:
                    candidate.determination_basis === 'pathognomonic_test'
                    || candidate.determination_basis === 'syndrome_pattern'
                    || candidate.determination_basis === 'symptom_scoring'
                    || candidate.determination_basis === 'exclusion_reasoning'
                        ? candidate.determination_basis
                        : undefined,
                supporting_evidence: Array.isArray(candidate.supporting_evidence)
                    ? candidate.supporting_evidence as Array<{ finding: string; weight: 'definitive' | 'strong' | 'supportive' | 'minor' }>
                    : undefined,
                contradicting_evidence: Array.isArray(candidate.contradicting_evidence)
                    ? candidate.contradicting_evidence as Array<{ finding: string; weight: 'excludes' | 'weakens' }>
                    : undefined,
                relationship_to_primary:
                    candidate.relationship_to_primary && typeof candidate.relationship_to_primary === 'object'
                        ? candidate.relationship_to_primary as DifferentialEntry['relationship_to_primary']
                        : undefined,
                clinical_urgency:
                    candidate.clinical_urgency === 'immediate' || candidate.clinical_urgency === 'urgent' || candidate.clinical_urgency === 'routine'
                        ? candidate.clinical_urgency
                        : undefined,
                recommended_confirmatory_tests: Array.isArray(candidate.recommended_confirmatory_tests)
                    ? candidate.recommended_confirmatory_tests.filter((entry): entry is string => typeof entry === 'string')
                    : undefined,
                recommended_next_steps: Array.isArray(candidate.recommended_next_steps)
                    ? candidate.recommended_next_steps.filter((entry): entry is string => typeof entry === 'string')
                    : undefined,
                key_drivers: Array.isArray(candidate.key_drivers)
                    ? (candidate.key_drivers as DifferentialDriver[])
                    : undefined,
            };
        });

    return mapped.filter((entry): entry is DifferentialEntry => entry !== null);
}

function toCanonicalName(name: string): string | null {
    const normalized = name.trim().toLowerCase();
    if (isGenericMechanismDiagnosis(normalized)) {
        return null;
    }
    const ontologyName = normalizeOntologyDiseaseName(name);
    if (ontologyName) {
        return ontologyName;
    }
    return CANONICAL_NAME_ALIASES.get(normalized) ?? null;
}

function softmax(values: number[], temperature: number): number[] {
    const max = Math.max(...values);
    const exps = values.map((value) => Math.exp((value - max) / temperature));
    const total = exps.reduce((sum, value) => sum + value, 0) || 1;
    return exps.map((value) => value / total);
}

function widenDifferentials(combined: Map<string, DifferentialEntry>, factor: number): void {
    const size = combined.size || 1;
    const uniformProbability = 1 / size;

    for (const entry of combined.values()) {
        entry.probability = (entry.probability * (1 - factor)) + (uniformProbability * factor);
    }
}

function normalizeProbabilities(combined: Map<string, DifferentialEntry>): void {
    const total = [...combined.values()].reduce((sum, entry) => sum + Math.max(0, entry.probability), 0) || 1;
    for (const entry of combined.values()) {
        entry.probability = Math.max(0, entry.probability) / total;
    }
}

function mergeNoteSets(...noteSets: unknown[]): string[] {
    const merged = new Set<string>();
    for (const value of noteSets) {
        if (!Array.isArray(value)) continue;
        for (const note of value) {
            if (typeof note === 'string' && note.trim().length > 0) {
                merged.add(note.trim());
            }
        }
    }
    return [...merged];
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
