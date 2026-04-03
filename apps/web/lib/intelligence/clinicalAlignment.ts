import {
    getMasterDiseaseOntology,
    normalizeOntologyDiseaseName,
    scoreClosedWorldDiseases,
    type DiseaseConditionClass,
    type DiseaseDomain,
} from '@/lib/ai/diseaseOntology';

export type RequiredClinicalDomain =
    | 'nutritional'
    | 'infectious'
    | 'endocrine'
    | 'neurologic'
    | 'toxic'
    | 'metabolic'
    | 'parasitic';

export type ReasoningFailureType =
    | 'signal_loss'
    | 'category_misclassification'
    | 'generic_fallback'
    | 'missing_disease_category'
    | 'contradiction_mismatch'
    | 'hallucination_pattern'
    | 'treatment_outcome_divergence';

export type ReasoningCorrectionAction =
    | 'adjust_weights'
    | 'add_anchor'
    | 'refine_ontology'
    | 'recalibrate_confidence'
    | 'trigger_retraining'
    | 'connect_treatment_outcomes';

export interface ClinicalDomainCoverage {
    domain: RequiredClinicalDomain;
    evidence_strength: 'none' | 'weak' | 'moderate' | 'strong';
    trigger_terms: string[];
    ontology_candidates: string[];
    model_candidates: string[];
    covered: boolean;
    blind_spot: boolean;
}

export interface ClinicalReasoningAlignmentSnapshot {
    ontology_version: string;
    closed_world_enforced: boolean;
    required_domains: RequiredClinicalDomain[];
    active_ontology_categories: DiseaseDomain[];
    observed_terms: string[];
    domain_coverage: ClinicalDomainCoverage[];
    missing_domains: RequiredClinicalDomain[];
    anchor_signal_count: number;
    contextual_signal_count: number;
    generic_signal_count: number;
    anchor_signal_dominance: boolean;
    generic_fallback_bias: boolean;
    hallucination_risk: boolean;
    contradiction_mismatch_risk: boolean;
    top_differentials: string[];
    priority_corrections: string[];
}

export interface ReasoningCorrectionRule {
    rule_id: string;
    action: ReasoningCorrectionAction;
    rationale: string;
    target_domains: RequiredClinicalDomain[];
}

export interface ClinicalReasoningEnforcementPlan {
    failure_types: ReasoningFailureType[];
    correction_rules: ReasoningCorrectionRule[];
    telemetry_action: 'observe' | 'correct' | 'block_promotion';
    retraining_required: boolean;
    reinforcement_features: Record<string, number>;
}

export interface TreatmentOutcomeReasoningFeedback {
    alignment_status: 'supports_diagnosis' | 'requires_reassessment' | 'inconclusive';
    confidence_delta: number;
    recommended_actions: string[];
    reinforcement_features: Record<string, number>;
}

const REQUIRED_CLINICAL_DOMAINS: RequiredClinicalDomain[] = [
    'nutritional',
    'infectious',
    'endocrine',
    'neurologic',
    'toxic',
    'metabolic',
    'parasitic',
];

const DOMAIN_TRIGGER_TERMS: Record<RequiredClinicalDomain, string[]> = {
    nutritional: [
        'weight_loss',
        'anorexia',
        'polyphagia',
        'raw_diet_exposure',
        'aflatoxin_exposure',
    ],
    infectious: [
        'fever',
        'lymphadenopathy',
        'pneumonia',
        'nasal_discharge',
        'ocular_discharge',
        'pyuria',
        'vaginal_discharge',
        'tick_exposure',
    ],
    endocrine: [
        'polyuria',
        'polydipsia',
        'polyphagia',
        'supportive_acth_stimulation_test',
        'dilute_urine',
        'marked_alp_elevation',
        'pot_bellied_appearance',
        'panting',
    ],
    neurologic: [
        'seizures',
        'myoclonus',
        'tremors',
        'ataxia',
        'head_tilt',
        'circling',
        'paresis',
        'paralysis',
        'nystagmus',
        'head_pressing',
        'spinal_cord_deficits',
    ],
    toxic: [
        'toxin_exposure_possible',
        'rodenticide_exposure',
        'organophosphate_exposure',
        'carbamate_exposure',
        'medication_exposure',
        'plant_toxin_exposure',
        'miosis',
        'hypersalivation',
        'coagulopathy',
    ],
    metabolic: [
        'hypoglycemia',
        'significant_hyperglycemia',
        'mild_hyperglycemia',
        'ketonuria',
        'azotemia',
        'collapse',
        'dehydration',
        'diabetic_metabolic_profile',
    ],
    parasitic: [
        'tick_exposure',
        'tick_infestation',
        'flea_infestation',
        'worms_in_stool',
        'pruritus',
        'skin_crusting',
        'anemia',
        'thrombocytopenia',
        'hemoglobinuria',
    ],
};

const DOMAIN_KEYWORD_HINTS: Record<RequiredClinicalDomain, string[]> = {
    nutritional: ['nutritional', 'malnutrition', 'deficiency', 'starvation', 'cachexia', 'secondary hyperparathyroidism'],
    infectious: ['infectious', 'viral', 'bacterial', 'sepsis', 'rabies', 'distemper', 'parvo', 'pyometra', 'pneumonia'],
    endocrine: ['endocrine', 'diabetes', 'cushing', 'addison', 'thyroid', 'adrenal'],
    neurologic: ['neurologic', 'neurological', 'meningoencephalitis', 'epilepsy', 'ivdd', 'vestibular', 'spinal'],
    toxic: ['toxic', 'toxicity', 'toxin', 'poison', 'rodenticide', 'organophosphate', 'carbamate'],
    metabolic: ['metabolic', 'ketoacidosis', 'hypoglycemia', 'azotemia', 'uremia', 'electrolyte'],
    parasitic: ['parasitic', 'parasite', 'babesia', 'ehrlichia', 'anaplasma', 'helminth', 'worm', 'mange'],
};

const CONDITION_CLASS_TO_DOMAINS: Record<DiseaseConditionClass, RequiredClinicalDomain[]> = {
    Mechanical: [],
    Infectious: ['infectious', 'parasitic'],
    Toxic: ['toxic'],
    Neoplastic: [],
    'Autoimmune / Immune-Mediated': [],
    'Metabolic / Endocrine': ['endocrine', 'metabolic'],
    Traumatic: [],
    Degenerative: ['neurologic'],
    'Idiopathic / Unknown': [],
};

const ONTOLOGY_CATEGORY_TO_DOMAINS: Record<DiseaseDomain, RequiredClinicalDomain[]> = {
    Neurological: ['neurologic'],
    Hemoparasitic: ['infectious', 'parasitic'],
    Parasitic: ['infectious', 'parasitic'],
    Toxicology: ['toxic'],
    Endocrine: ['endocrine', 'metabolic'],
    Gastrointestinal: [],
    Cardiopulmonary: [],
    Renal: ['metabolic'],
    Reproductive: ['infectious'],
};

const MASTER_ONTOLOGY = getMasterDiseaseOntology();
const ONTOLOGY_BY_NAME = new Map(MASTER_ONTOLOGY.map((entry) => [entry.name, entry]));

export function buildClinicalReasoningAlignmentSnapshot(input: {
    inputSignature: Record<string, unknown>;
    outputPayload: Record<string, unknown>;
}): ClinicalReasoningAlignmentSnapshot {
    const closedWorld = scoreClosedWorldDiseases({
        inputSignature: input.inputSignature,
        species: readText(input.inputSignature.species),
    });
    const topDifferentials = extractTopDifferentials(input.outputPayload);
    const topDifferentialSet = new Set(topDifferentials);
    const diagnosis = asRecord(input.outputPayload.diagnosis);
    const contradictionScore = readNumber(input.outputPayload.contradiction_score)
        ?? readNumber(asRecord(input.outputPayload.contradiction_analysis).contradiction_score)
        ?? 0;
    const confidenceScore = readNumber(diagnosis.confidence_score);
    const confidenceCap = readNumber(input.outputPayload.confidence_cap);
    const abstained = readBoolean(input.outputPayload.abstain_recommendation) === true;

    const domainCoverage = REQUIRED_CLINICAL_DOMAINS.map((domain) => {
        const triggerTerms = DOMAIN_TRIGGER_TERMS[domain].filter((term) => closedWorld.observations.includes(term));
        const ontologyCandidates = closedWorld.ranked
            .filter((candidate) => resolveDiagnosisDomains(candidate.name, candidate.conditionClass).includes(domain))
            .map((candidate) => candidate.name)
            .slice(0, 3);
        const modelCandidates = topDifferentials
            .filter((name) => resolveDiagnosisDomains(name).includes(domain))
            .slice(0, 3);
        const covered = triggerTerms.length === 0
            ? ontologyCandidates.length > 0 || modelCandidates.length > 0 || domain !== 'nutritional'
            : ontologyCandidates.length > 0 || modelCandidates.length > 0;
        const blindSpotThreshold = domain === 'toxic' ? 1 : 2;
        const blindSpot = triggerTerms.length >= blindSpotThreshold && !covered;

        return {
            domain,
            evidence_strength: resolveEvidenceStrength(triggerTerms.length),
            trigger_terms: triggerTerms,
            ontology_candidates: ontologyCandidates,
            model_candidates: modelCandidates,
            covered,
            blind_spot: blindSpot,
        } satisfies ClinicalDomainCoverage;
    });

    const hallucinationRisk = topDifferentials.some((name) => normalizeOntologyDiseaseName(name) == null);
    const genericSignalCount = closedWorld.signalHierarchy.generic_signals.length;
    const anchorSignalCount = closedWorld.signalHierarchy.anchor_signals.length;
    const contextualSignalCount = closedWorld.signalHierarchy.contextual_signals.length;
    const genericFallbackBias =
        genericSignalCount > anchorSignalCount + contextualSignalCount
        || isGenericFallbackLabel(topDifferentials[0] ?? readText(diagnosis.primary_condition_class))
        || (!abstained && anchorSignalCount === 0 && genericSignalCount >= 2);
    const contradictionMismatchRisk =
        contradictionScore >= 0.55
        && (confidenceScore ?? 0) >= Math.max(0.62, (confidenceCap ?? 0.58) + 0.08)
        && !abstained;
    const closedWorldEnforced =
        topDifferentials.length === 0
            ? false
            : topDifferentials.every((name) => normalizeOntologyDiseaseName(name) != null);
    const missingDomains = domainCoverage
        .filter((coverage) => coverage.blind_spot)
        .map((coverage) => coverage.domain);

    const priorityCorrections: string[] = [];
    if (!closedWorldEnforced || hallucinationRisk) {
        priorityCorrections.push('Keep top differentials inside the ontology and block non-canonical diagnoses.');
    }
    if (genericFallbackBias) {
        priorityCorrections.push('Suppress generic fallback dominance so anchor and lab signals remain primary.');
    }
    if (missingDomains.length > 0) {
        priorityCorrections.push(`Expand or activate reasoning support for ${missingDomains.join(', ')} domains.`);
    }
    if (contradictionMismatchRisk) {
        priorityCorrections.push('Tighten contradiction-driven confidence caps and abstention rules.');
    }
    if (topDifferentialSet.size === 0) {
        priorityCorrections.push('Return at least three ontology-backed differentials on every inference.');
    }

    return {
        ontology_version: 'closed-world-v2',
        closed_world_enforced: closedWorldEnforced,
        required_domains: [...REQUIRED_CLINICAL_DOMAINS],
        active_ontology_categories: closedWorld.activeCategories,
        observed_terms: closedWorld.observations,
        domain_coverage: domainCoverage,
        missing_domains: missingDomains,
        anchor_signal_count: anchorSignalCount,
        contextual_signal_count: contextualSignalCount,
        generic_signal_count: genericSignalCount,
        anchor_signal_dominance: anchorSignalCount >= Math.max(1, genericSignalCount),
        generic_fallback_bias: genericFallbackBias,
        hallucination_risk: hallucinationRisk,
        contradiction_mismatch_risk: contradictionMismatchRisk,
        top_differentials: topDifferentials,
        priority_corrections: priorityCorrections,
    };
}

export function buildClinicalReasoningEnforcementPlan(input: {
    alignment: ClinicalReasoningAlignmentSnapshot;
    predictedDiagnosis: string | null;
    actualDiagnosis: string | null;
    predictedConditionClass?: string | null;
    actualConditionClass?: string | null;
    confidenceScore?: number | null;
    contradictionScore?: number | null;
    treatmentOutcomeStatus?: string | null;
}): ClinicalReasoningEnforcementPlan {
    const predictedDomains = resolveDiagnosisDomains(input.predictedDiagnosis, input.predictedConditionClass ?? null);
    const actualDomains = resolveDiagnosisDomains(input.actualDiagnosis, input.actualConditionClass ?? null);
    const failureTypes: ReasoningFailureType[] = [];
    const correctionRules: ReasoningCorrectionRule[] = [];
    const reinforcementFeatures: Record<string, number> = {};

    if (input.alignment.generic_fallback_bias) {
        failureTypes.push('generic_fallback');
        correctionRules.push({
            rule_id: 'suppress_generic_fallback_bias',
            action: 'adjust_weights',
            rationale: 'Generic systemic signals are outranking anchor signals and need explicit down-weighting.',
            target_domains: actualDomains.length > 0 ? actualDomains : [],
        });
        reinforcementFeatures.alignment_generic_fallback = 1;
    }

    if (input.alignment.hallucination_risk) {
        failureTypes.push('hallucination_pattern');
        correctionRules.push({
            rule_id: 'enforce_closed_world_differentials',
            action: 'refine_ontology',
            rationale: 'Predicted differentials escaped the canonical disease library and should be blocked before promotion.',
            target_domains: [],
        });
        reinforcementFeatures.alignment_hallucination_pattern = 1;
    }

    const domainIntersection = actualDomains.filter((domain) => predictedDomains.includes(domain));
    if (actualDomains.length > 0 && predictedDomains.length > 0 && domainIntersection.length === 0) {
        failureTypes.push('category_misclassification');
        correctionRules.push({
            rule_id: 'boost_actual_domain_anchors',
            action: 'add_anchor',
            rationale: 'Observed outcome confirms a different domain than the one the model prioritized.',
            target_domains: actualDomains,
        });
        reinforcementFeatures.alignment_category_misclassification = 1;
    }

    const missingTargetDomains = actualDomains.filter((domain) => input.alignment.missing_domains.includes(domain));
    if (missingTargetDomains.length > 0) {
        failureTypes.push('missing_disease_category');
        correctionRules.push({
            rule_id: 'expand_missing_domain_coverage',
            action: 'refine_ontology',
            rationale: 'Outcome-confirmed evidence points to a required domain with active trigger terms but no usable candidate support.',
            target_domains: missingTargetDomains,
        });
        reinforcementFeatures.alignment_missing_category = 1;
    }

    if (input.alignment.anchor_signal_count === 0 && actualDomains.length > 0) {
        failureTypes.push('signal_loss');
        correctionRules.push({
            rule_id: 'restore_anchor_signal_priority',
            action: 'add_anchor',
            rationale: 'High-value anchor evidence was not preserved into the ranked differential set.',
            target_domains: actualDomains,
        });
        reinforcementFeatures.alignment_signal_loss = 1;
    }

    if (
        input.alignment.contradiction_mismatch_risk
        || ((input.contradictionScore ?? 0) >= 0.55 && (input.confidenceScore ?? 0) >= 0.7)
    ) {
        failureTypes.push('contradiction_mismatch');
        correctionRules.push({
            rule_id: 'tighten_contradiction_caps',
            action: 'recalibrate_confidence',
            rationale: 'Confidence remained too high despite contradiction pressure.',
            target_domains: actualDomains.length > 0 ? actualDomains : predictedDomains,
        });
        reinforcementFeatures.alignment_contradiction_mismatch = 1;
    }

    if (isAdverseTreatmentOutcome(input.treatmentOutcomeStatus) && (input.confidenceScore ?? 0) >= 0.65) {
        failureTypes.push('treatment_outcome_divergence');
        correctionRules.push({
            rule_id: 'link_treatment_outcomes_back_to_diagnosis',
            action: 'connect_treatment_outcomes',
            rationale: 'High-confidence diagnosis led to an adverse treatment course and should feed diagnostic reweighting.',
            target_domains: actualDomains.length > 0 ? actualDomains : predictedDomains,
        });
        reinforcementFeatures.alignment_treatment_outcome_divergence = 1;
    }

    if (failureTypes.length > 0) {
        correctionRules.push({
            rule_id: 'route_failure_into_learning_cycle',
            action: 'trigger_retraining',
            rationale: 'Outcome-linked failure should enter the next calibration and adversarial review cycle.',
            target_domains: actualDomains.length > 0 ? actualDomains : predictedDomains,
        });
        reinforcementFeatures.alignment_retraining_flag = 1;
    }

    for (const domain of actualDomains) {
        reinforcementFeatures[`alignment_domain_${domain}`] = 1;
    }
    for (const domain of input.alignment.missing_domains) {
        reinforcementFeatures[`alignment_blind_spot_${domain}`] = 1;
    }

    const telemetryAction =
        failureTypes.includes('hallucination_pattern')
        || failureTypes.includes('missing_disease_category')
        || failureTypes.includes('treatment_outcome_divergence')
            ? 'block_promotion'
            : failureTypes.length > 0
                ? 'correct'
                : 'observe';

    return {
        failure_types: uniqueStrings(failureTypes),
        correction_rules: dedupeRules(correctionRules),
        telemetry_action: telemetryAction,
        retraining_required: failureTypes.length > 0,
        reinforcement_features: reinforcementFeatures,
    };
}

export function buildTreatmentOutcomeReasoningFeedback(input: {
    disease: string;
    treatmentPathway: string;
    outcomeStatus: string | null;
}): TreatmentOutcomeReasoningFeedback {
    const normalizedStatus = normalizeKey(input.outcomeStatus);
    if (normalizedStatus === 'resolved' || normalizedStatus === 'improved') {
        return {
            alignment_status: 'supports_diagnosis',
            confidence_delta: 0.06,
            recommended_actions: [
                `Increase trust in ${input.disease} reasoning only after confirming follow-up stability.`,
                'Preserve the successful pathway as outcome-linked treatment evidence, not as autonomous prescribing authority.',
            ],
            reinforcement_features: {
                treatment_alignment_success: 1,
                treatment_pathway_gold_like: input.treatmentPathway === 'gold_standard' ? 1 : 0,
            },
        };
    }

    if (isAdverseTreatmentOutcome(normalizedStatus)) {
        return {
            alignment_status: 'requires_reassessment',
            confidence_delta: -0.18,
            recommended_actions: [
                'Re-open the differential before reinforcing the original diagnosis.',
                'Route the case into failure correction and treatment-outcome review.',
            ],
            reinforcement_features: {
                treatment_alignment_failure: 1,
                treatment_pathway_resource_constrained: input.treatmentPathway === 'resource_constrained' ? 1 : 0,
            },
        };
    }

    return {
        alignment_status: 'inconclusive',
        confidence_delta: 0,
        recommended_actions: [
            'Keep treatment evidence available for future recalibration, but do not reweight diagnosis yet.',
        ],
        reinforcement_features: {
            treatment_alignment_inconclusive: 1,
        },
    };
}

export function resolveDiagnosisDomains(
    diagnosis: string | null | undefined,
    conditionClass?: string | null,
): RequiredClinicalDomain[] {
    const domains = new Set<RequiredClinicalDomain>();
    const normalizedOntologyName = normalizeOntologyDiseaseName(diagnosis);
    const ontologyEntry = normalizedOntologyName ? ONTOLOGY_BY_NAME.get(normalizedOntologyName) : null;

    if (ontologyEntry) {
        for (const domain of ONTOLOGY_CATEGORY_TO_DOMAINS[ontologyEntry.category]) {
            domains.add(domain);
        }
        for (const domain of CONDITION_CLASS_TO_DOMAINS[ontologyEntry.condition_class]) {
            domains.add(domain);
        }
    }

    const normalizedDiagnosis = normalizeKey(diagnosis);
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORD_HINTS) as Array<[RequiredClinicalDomain, string[]]>) {
        if (keywords.some((keyword) => normalizedDiagnosis.includes(normalizeKey(keyword)))) {
            domains.add(domain);
        }
    }

    const normalizedConditionClass = normalizeKey(conditionClass);
    for (const [conditionKey, mappedDomains] of Object.entries(CONDITION_CLASS_TO_DOMAINS)) {
        if (normalizeKey(conditionKey) === normalizedConditionClass) {
            for (const domain of mappedDomains) {
                domains.add(domain);
            }
        }
    }

    return [...domains];
}

function extractTopDifferentials(outputPayload: Record<string, unknown>) {
    const diagnosis = asRecord(outputPayload.diagnosis);
    const topDifferentials = Array.isArray(diagnosis.top_differentials) ? diagnosis.top_differentials : [];
    const labels = topDifferentials
        .map((entry) => readText(asRecord(entry).name))
        .filter((value): value is string => value != null)
        .slice(0, 5);

    if (labels.length > 0) {
        return labels;
    }

    const primary = readText(diagnosis.primary_diagnosis) ?? readText(diagnosis.primary_condition_class);
    return primary ? [primary] : [];
}

function resolveEvidenceStrength(triggerCount: number): ClinicalDomainCoverage['evidence_strength'] {
    if (triggerCount >= 4) return 'strong';
    if (triggerCount >= 2) return 'moderate';
    if (triggerCount === 1) return 'weak';
    return 'none';
}

function isGenericFallbackLabel(value: string | null | undefined) {
    const normalized = normalizeKey(value);
    return normalized.includes('unknown')
        || normalized.includes('idiopathic')
        || normalized.includes('undifferentiated')
        || normalized.includes('syndrome')
        || normalized.includes('mechanical_emergency');
}

function isAdverseTreatmentOutcome(value: string | null | undefined) {
    const normalized = normalizeKey(value);
    return normalized === 'deteriorated'
        || normalized === 'complication'
        || normalized === 'deceased';
}

function dedupeRules(rules: ReasoningCorrectionRule[]) {
    const seen = new Set<string>();
    return rules.filter((rule) => {
        if (seen.has(rule.rule_id)) return false;
        seen.add(rule.rule_id);
        return true;
    });
}

function uniqueStrings<T extends string>(values: T[]) {
    return [...new Set(values)];
}

function normalizeKey(value: unknown) {
    return typeof value === 'string'
        ? value
            .trim()
            .toLowerCase()
            .replace(/['\u2019]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
        : '';
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    return null;
}
