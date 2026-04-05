import { getConditionById, getConditionsForSpecies, normalizeSpecies } from './condition-registry';
import { applyBiochemistryPriors } from './biochemistry-priors';
import { applyBreedSpecificPriors } from './breed-priors';
import { applyGroundTruthConfirmation } from './ground-truth-confirmation';
import { applyHaematologicalPriors, type ScoreAdjustment } from './haematological-priors';
import { applyImagingPriors } from './imaging-priors';
import {
    buildPathognomonicDifferentials,
    evaluatePathognomicTests,
} from './pathognomic-gate';
import { applyEtiologicalPlausibilityGate } from './plausibility-gate';
import { applyRegionalExposurePriors } from './regional-priors';
import { applySyndromePatterns } from './syndrome-recogniser';
import { selectTreatmentProtocol, type TreatmentContext } from '../treatment/treatment-engine';
import type {
    AbstainDecision,
    ContradictionAnalysis,
    ClinicalUrgency,
    ConditionClass,
    ContradictingEvidenceEntry,
    DifferentialBasis,
    DifferentialEntry,
    DifferentialRelationship,
    EvidenceEntry,
    InferenceExplanation,
    InferenceRequest,
    InferenceResponse,
    SelectedTreatmentPlan,
    VeterinaryCondition,
} from './types';

interface CandidateState {
    condition: VeterinaryCondition;
    score: number;
    basis: DifferentialBasis;
    supporting: EvidenceEntry[];
    contradicting: ContradictingEvidenceEntry[];
    relationship?: DifferentialRelationship;
    recommendedConfirmatoryTests: Set<string>;
    recommendedNextSteps: Set<string>;
}

export interface ClinicalInferenceEngineResult extends InferenceResponse {
    diagnosis_feature_importance: Record<string, number>;
    differential_spread: {
        top_1_probability: number | null;
        top_2_probability: number | null;
        top_3_probability: number | null;
        spread: number | null;
    } | null;
    uncertainty_notes: string[];
}

function analyzeContradictions(
    request: InferenceRequest,
    differentials: DifferentialEntry[],
): ContradictionAnalysis {
    const reasons: string[] = [];
    let score = 0;

    const diabetesConfirmed =
        request.diagnostic_tests?.biochemistry?.glucose === 'hyperglycemia'
        && request.diagnostic_tests?.urinalysis?.glucose_in_urine === 'present';
    const hypothyroidConfirmed =
        request.diagnostic_tests?.serology?.t4_total === 'low'
        || request.diagnostic_tests?.serology?.free_t4 === 'low';

    if (diabetesConfirmed && hypothyroidConfirmed && request.presenting_signs.includes('weight_loss')) {
        score = Math.max(score, 0.75);
        reasons.push('Confirmed diabetes and hypothyroid evidence are pulling in opposite metabolic directions for the current weight-loss presentation.');
    }

    const top = differentials[0];
    if (
        top?.condition_id === 'dirofilariosis_canine'
        && request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen === 'negative'
    ) {
        score = Math.max(score, 0.85);
        reasons.push('Heartworm antigen is negative despite heartworm leading the differential.');
    }

    return {
        contradiction_score: Number(score.toFixed(3)),
        contradiction_reasons: reasons,
    };
}

function shouldAbstain(
    differentials: DifferentialEntry[],
    _request: InferenceRequest,
    contradictionAnalysis: ContradictionAnalysis,
): AbstainDecision {
    const pathognomicCount = differentials.filter(
        (entry) => entry.determination_basis === 'pathognomonic_test',
    ).length;
    const hasMetabolicConflict =
        contradictionAnalysis.contradiction_score > 0.60
        && contradictionAnalysis.contradiction_reasons.some((reason) =>
            reason.toLowerCase().includes('diabetes') && reason.toLowerCase().includes('hypothyroid'),
        );
    if (hasMetabolicConflict) {
        return {
            abstain: true,
            reason: 'genuine_clinical_contradiction',
            details: contradictionAnalysis.contradiction_reasons,
        };
    }
    if (
        pathognomicCount > 1
        && contradictionAnalysis.contradiction_score > 0.60
        && contradictionAnalysis.contradiction_reasons.length > 0
    ) {
        return {
            abstain: true,
            reason: 'genuine_clinical_contradiction',
            details: contradictionAnalysis.contradiction_reasons,
        };
    }
    if (pathognomicCount > 0) {
        return { abstain: false, reason: 'pathognomonic_finding_present' };
    }

    if (
        contradictionAnalysis.contradiction_score > 0.60
        && contradictionAnalysis.contradiction_reasons.length > 0
    ) {
        return {
            abstain: true,
            reason: 'genuine_clinical_contradiction',
            details: contradictionAnalysis.contradiction_reasons,
        };
    }

    const maxProbability = Math.max(...differentials.map((entry) => entry.probability), 0);
    if (maxProbability < 0.05) {
        return {
            abstain: true,
            reason: 'insufficient_clinical_signal',
            details: ['No presenting signs or history provided'],
        };
    }

    const spread = differentials[0] && differentials[1]
        ? differentials[0].probability - differentials[1].probability
        : 1;
    if (spread < 0.05 || maxProbability < 0.55) {
        return {
            abstain: false,
            reason: null,
            competitive_differential: true,
            confirmatory_testing_urgent: true,
            message: 'Differential is competitive — confirmatory testing required to distinguish the top diagnoses',
        };
    }

    return { abstain: false, reason: null };
}

function normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function mergeObject<T>(primary: T | undefined, secondary: T | undefined): T | undefined {
    if (primary != null) return primary;
    return secondary;
}

function coerceInferenceRequest(raw: InferenceRequest | Record<string, unknown>): InferenceRequest {
    const candidate = raw as Record<string, unknown>;
    const metadata = candidate.metadata && typeof candidate.metadata === 'object'
        ? candidate.metadata as Record<string, unknown>
        : {};
    const presenting = Array.isArray(candidate.presenting_signs)
        ? candidate.presenting_signs
        : Array.isArray(candidate.symptoms)
            ? candidate.symptoms
            : Array.isArray(metadata.presenting_signs)
                ? metadata.presenting_signs
                : Array.isArray(metadata.symptoms)
                    ? metadata.symptoms
                    : [];

    return {
        species: typeof candidate.species === 'string' ? candidate.species : typeof metadata.species === 'string' ? metadata.species : 'canine',
        breed: typeof candidate.breed === 'string' ? candidate.breed : typeof metadata.breed === 'string' ? metadata.breed : undefined,
        age_years: typeof candidate.age_years === 'number'
            ? candidate.age_years
            : typeof metadata.age_years === 'number'
                ? metadata.age_years
                : typeof metadata.age_months === 'number'
                    ? Number((Number(metadata.age_months) / 12).toFixed(2))
                    : undefined,
        weight_kg: typeof candidate.weight_kg === 'number'
            ? candidate.weight_kg
            : typeof metadata.weight_kg === 'number'
                ? metadata.weight_kg
                : undefined,
        sex: typeof candidate.sex === 'string' ? candidate.sex : typeof metadata.sex === 'string' ? metadata.sex : undefined,
        region: typeof candidate.region === 'string' ? candidate.region : typeof metadata.region === 'string' ? metadata.region : undefined,
        presenting_signs: presenting
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => normalizeKey(entry)),
        history: mergeObject(candidate.history as InferenceRequest['history'] | undefined, metadata.history as InferenceRequest['history'] | undefined),
        preventive_history: mergeObject(candidate.preventive_history as InferenceRequest['preventive_history'] | undefined, metadata.preventive_history as InferenceRequest['preventive_history'] | undefined),
        diagnostic_tests: mergeObject(candidate.diagnostic_tests as InferenceRequest['diagnostic_tests'] | undefined, metadata.diagnostic_tests as InferenceRequest['diagnostic_tests'] | undefined),
        physical_exam: mergeObject(candidate.physical_exam as InferenceRequest['physical_exam'] | undefined, metadata.physical_exam as InferenceRequest['physical_exam'] | undefined),
    };
}

function buildInitialState(candidate: VeterinaryCondition, score: number): CandidateState {
    const recommendedConfirmatoryTests = new Set<string>();
    for (const rule of candidate.pathognomonic_tests) {
        recommendedConfirmatoryTests.add(rule.evidence_label ?? rule.test);
    }
    for (const rule of candidate.supporting_tests) {
        recommendedConfirmatoryTests.add(rule.evidence_label ?? rule.test);
    }

    return {
        condition: candidate,
        score,
        basis: 'symptom_scoring',
        supporting: [],
        contradicting: [],
        recommendedConfirmatoryTests,
        recommendedNextSteps: new Set<string>(),
    };
}

function applyAdjustments(states: Map<string, CandidateState>, adjustments: ScoreAdjustment[]) {
    for (const adjustment of adjustments) {
        const state = states.get(adjustment.condition_id);
        if (!state) continue;

        state.score = Math.max(0, state.score + adjustment.delta);
        if (adjustment.penalty) {
            state.contradicting.push({
                finding: adjustment.finding,
                weight: Math.abs(adjustment.delta) >= 0.3 ? 'excludes' : 'weakens',
            });
        } else {
            state.supporting.push({
                finding: adjustment.finding,
                weight: adjustment.weight,
            });
            if (adjustment.determination_basis) {
                state.basis = adjustment.determination_basis;
            }
            if (adjustment.relationship_to_primary) {
                state.relationship = adjustment.relationship_to_primary;
            }
        }
    }
}

function scoreSymptoms(states: Map<string, CandidateState>, request: InferenceRequest) {
    const signs = new Set(request.presenting_signs.map(normalizeKey));
    for (const state of states.values()) {
        const condition = state.condition;
        let delta = 0;

        const cardinalHits = condition.cardinal_signs.filter((sign) => signs.has(normalizeKey(sign)));
        const commonHits = condition.common_signs.filter((sign) => signs.has(normalizeKey(sign)));
        const rareHits = condition.rare_signs.filter((sign) => signs.has(normalizeKey(sign)));
        const exclusionHits = condition.signs_that_exclude.filter((sign) => signs.has(normalizeKey(sign)));

        delta += cardinalHits.length * 0.14;
        delta += commonHits.length * 0.08;
        delta += rareHits.length * 0.03;
        delta -= exclusionHits.length * 0.12;

        if (condition.cardinal_signs.length > 0 && cardinalHits.length === 0) {
            delta -= 0.04;
        }

        if (delta > 0) {
            state.supporting.push(...cardinalHits.map((finding) => ({ finding: `Presenting sign: ${finding.replace(/_/g, ' ')}`, weight: 'supportive' as const })));
            state.supporting.push(...commonHits.map((finding) => ({ finding: `Presenting sign: ${finding.replace(/_/g, ' ')}`, weight: 'minor' as const })));
        }
        if (delta < 0 && exclusionHits.length > 0) {
            state.contradicting.push(...exclusionHits.map((finding) => ({ finding: `Sign pattern weakens this diagnosis: ${finding.replace(/_/g, ' ')}`, weight: 'weakens' as const })));
        }

        state.score = Math.max(0, state.score + delta);
    }
}

function normalise(entries: DifferentialEntry[]): DifferentialEntry[] {
    const positiveTotal = entries.reduce((sum, entry) => sum + Math.max(0, entry.probability), 0) || 1;
    return entries
        .map((entry) => ({
            ...entry,
            probability: Math.max(0, entry.probability) / positiveTotal,
        }))
        .filter((entry) => entry.probability > 0)
        .sort((left, right) => right.probability - left.probability)
        .map((entry, index) => ({
            ...entry,
            rank: index + 1,
        }));
}

function confidenceFromProbability(probability: number): DifferentialEntry['confidence'] {
    if (probability >= 0.75) return 'high';
    if (probability >= 0.3) return 'moderate';
    return 'low';
}

function urgencyForCondition(conditionId: string): ClinicalUrgency {
    if (['dirofilariosis_canine', 'babesiosis_canine', 'leptospirosis', 'parvoviral_enteritis', 'gastric_dilatation_volvulus'].includes(conditionId)) {
        return 'urgent';
    }
    return 'routine';
}

function buildDifferentials(states: Map<string, CandidateState>): DifferentialEntry[] {
    const rawEntries: DifferentialEntry[] = [...states.values()].map((state) => ({
        rank: 0,
        condition: state.condition.canonical_name,
        condition_id: state.condition.id,
        icd_vet_code: state.condition.icd_vet_code,
        probability: state.score,
        confidence: confidenceFromProbability(state.score),
        determination_basis: state.basis,
        supporting_evidence: dedupeEvidence(state.supporting),
        contradicting_evidence: dedupeContradictions(state.contradicting),
        relationship_to_primary: state.relationship,
        clinical_urgency: urgencyForCondition(state.condition.id),
        recommended_confirmatory_tests: [...state.recommendedConfirmatoryTests],
        recommended_next_steps: [...state.recommendedNextSteps],
    }));

    return normalise(rawEntries);
}

function dedupeEvidence(entries: EvidenceEntry[]): EvidenceEntry[] {
    const seen = new Set<string>();
    const output: EvidenceEntry[] = [];
    for (const entry of entries) {
        const key = `${entry.finding}::${entry.weight}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(entry);
    }
    return output;
}

function dedupeContradictions(entries: ContradictingEvidenceEntry[]): ContradictingEvidenceEntry[] {
    const seen = new Set<string>();
    const output: ContradictingEvidenceEntry[] = [];
    for (const entry of entries) {
        const key = `${entry.finding}::${entry.weight}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(entry);
    }
    return output;
}

function classifyConditionClass(condition: VeterinaryCondition | undefined): ConditionClass {
    switch (condition?.etiological_class) {
        case 'parasitic_helminth':
        case 'parasitic_protozoan':
        case 'parasitic_ectoparasite':
        case 'bacterial':
        case 'viral':
        case 'fungal':
            return 'Infectious';
        case 'metabolic_endocrine':
            return 'Metabolic / Endocrine';
        case 'cardiovascular_structural':
        case 'respiratory_structural':
        case 'gastrointestinal_structural':
        case 'congenital':
            return 'Mechanical';
        case 'immune_mediated':
            return 'Autoimmune / Immune-Mediated';
        case 'neoplastic':
            return 'Neoplastic';
        case 'traumatic':
            return 'Traumatic';
        case 'toxic':
            return 'Toxic';
        default:
            return 'Idiopathic / Unknown';
    }
}

function buildConditionClassProbabilities(entries: DifferentialEntry[]): Record<ConditionClass, number> {
    const totals: Record<ConditionClass, number> = {
        Mechanical: 0,
        Infectious: 0,
        Toxic: 0,
        Neoplastic: 0,
        'Autoimmune / Immune-Mediated': 0,
        'Metabolic / Endocrine': 0,
        Traumatic: 0,
        Degenerative: 0,
        'Idiopathic / Unknown': 0,
    };
    for (const entry of entries) {
        const condition = entry.condition_id ? getConditionById(entry.condition_id) : undefined;
        totals[classifyConditionClass(condition)] += entry.probability;
    }
    return totals;
}

function computeDataCompleteness(request: InferenceRequest): number {
    const checks = [
        request.species,
        request.breed,
        request.presenting_signs.length > 0 ? 'signs' : null,
        request.preventive_history?.heartworm_prevention,
        request.preventive_history?.vector_exposure?.mosquito_endemic != null ? 'mosquito' : null,
        request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen,
        request.diagnostic_tests?.cbc?.eosinophilia,
        request.diagnostic_tests?.thoracic_radiograph?.pulmonary_artery_enlargement,
        request.diagnostic_tests?.echocardiography?.worms_visualised,
    ];
    const present = checks.filter((value) => value != null).length;
    return Number((present / checks.length).toFixed(2));
}

function buildInferenceExplanation(
    request: InferenceRequest,
    differentials: DifferentialEntry[],
    excludedConditions: InferenceExplanation['excluded_conditions'],
    primaryBasis: DifferentialBasis,
    keyFinding: string,
): InferenceExplanation {
    const top = differentials[0];
    const missingData = new Set<string>();
    const topCondition = top?.condition_id ? getConditionById(top.condition_id) : undefined;
    for (const rule of topCondition?.pathognomonic_tests ?? []) {
        const label = rule.evidence_label ?? rule.test;
        if ((top?.supporting_evidence ?? []).every((entry) => entry.finding !== label)) {
            missingData.add(label);
        }
    }

    return {
        primary_determination: primaryBasis,
        key_finding: keyFinding,
        excluded_conditions: excludedConditions,
        evidence_quality: top?.probability != null && top.probability >= 0.8 ? 'high' : top?.probability != null && top.probability >= 0.4 ? 'moderate' : 'low',
        data_completeness_score: computeDataCompleteness(request),
        missing_data_that_would_help: [...missingData],
    };
}

function inferHeartwormSeverityClass(request: InferenceRequest): string | null {
    const signs = new Set(request.presenting_signs);
    const cyanotic = request.physical_exam?.mucous_membrane_color === 'cyanotic';
    const delayedPerfusion = (request.physical_exam?.capillary_refill_time_s ?? 0) > 3;
    if (signs.has('collapse') || signs.has('caval_syndrome') || cyanotic || delayedPerfusion) return 'IV';
    if (signs.has('syncope') || signs.has('ascites') || signs.has('hemoptysis')) return 'III';
    if (signs.has('exercise_intolerance') || signs.has('chronic_cough') || signs.has('dyspnea')) return 'II';
    return 'I';
}

function buildTreatmentPlans(entries: DifferentialEntry[], request: InferenceRequest): Record<string, SelectedTreatmentPlan> {
    const topThree = entries.slice(0, 3);
    const context: TreatmentContext = {
        geographic_region: request.region ?? request.history?.geographic_region ?? 'east_africa',
        resource_level: 'secondary',
        concurrent_conditions: topThree.slice(1).map((entry) => entry.condition),
        patient_signalment: {
            age_category: request.age_years != null && request.age_years < 1 ? 'puppy' : request.age_years != null && request.age_years >= 9 ? 'senior' : 'adult',
            reproductive_status: request.sex?.includes('intact') ? (request.sex as TreatmentContext['patient_signalment']['reproductive_status']) : 'neutered',
            weight_kg: request.weight_kg ?? 20,
        },
    };

    const plans: Record<string, SelectedTreatmentPlan> = {};
    for (const entry of topThree) {
        if (!entry.condition_id) continue;
        const condition = getConditionById(entry.condition_id);
        if (!condition) continue;
        const severityClass = entry.condition_id === 'dirofilariosis_canine' ? inferHeartwormSeverityClass(request) : null;
        plans[entry.condition_id] = selectTreatmentProtocol(condition, severityClass, request, context);
    }

    return plans;
}

function buildGroundTruthSummary(entries: DifferentialEntry[]): InferenceResponse['ground_truth_summary'] {
    const primary = entries[0];
    const status = primary?.ground_truth_explanation?.confirmation_status ?? 'unconfirmed';
    return {
        primary_diagnosis_status: status === 'confirmed' || status === 'highly_supported' ? status : 'unconfirmed',
        key_confirmatory_finding: primary?.supporting_evidence[0]?.finding,
        missing_confirmatory_tests: primary?.ground_truth_explanation?.missing_criteria ?? [],
        confidence_level: primary?.confidence ?? 'low',
        recommended_immediate_actions: primary?.recommended_next_steps ?? [],
    };
}

function buildDiagnosisSummary(entries: DifferentialEntry[]): InferenceResponse['diagnosis'] {
    const top = entries[0];
    return {
        analysis: top
            ? `${top.condition} is prioritised based on ${top.determination_basis.replace(/_/g, ' ')} with linked confirmatory evidence and clinical plausibility filtering.`
            : 'No defensible differential could be established from the provided data.',
        primary_condition_class: classifyConditionClass(top?.condition_id ? getConditionById(top.condition_id) : undefined),
        condition_class_probabilities: buildConditionClassProbabilities(entries),
        top_differentials: entries,
        confidence_score: top?.probability ?? 0,
    };
}

function featureImportance(entries: DifferentialEntry[]): Record<string, number> {
    const importance = new Map<string, number>();
    for (const entry of entries.slice(0, 5)) {
        for (const evidence of entry.supporting_evidence) {
            importance.set(evidence.finding, Number(((importance.get(evidence.finding) ?? 0) + entry.probability).toFixed(3)));
        }
    }
    return Object.fromEntries([...importance.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
}

function computeDifferentialSpread(entries: DifferentialEntry[]) {
    return {
        top_1_probability: entries[0]?.probability ?? null,
        top_2_probability: entries[1]?.probability ?? null,
        top_3_probability: entries[2]?.probability ?? null,
        spread: entries[0] && entries[1] ? Number((entries[0].probability - entries[1].probability).toFixed(4)) : null,
    };
}

export function runClinicalInferenceEngine(
    rawRequest: InferenceRequest | Record<string, unknown>,
): ClinicalInferenceEngineResult {
    const request = coerceInferenceRequest(rawRequest);
    const candidates = getConditionsForSpecies(normalizeSpecies(request.species));
    const regionalScores = applyRegionalExposurePriors(candidates, request);
    const breedAdjustedScores = applyBreedSpecificPriors(candidates, regionalScores, request);
    const states = new Map<string, CandidateState>(
        candidates.map((candidate) => [candidate.id, buildInitialState(candidate, breedAdjustedScores.get(candidate.id) ?? 0.01)]),
    );

    const pathognomicResult = evaluatePathognomicTests(candidates, request);
    if (pathognomicResult.pathognomicConditionFound && pathognomicResult.primaryCondition) {
        const rawDifferentials = buildPathognomonicDifferentials(pathognomicResult);
        const confirmed = applyGroundTruthConfirmation(rawDifferentials, request).slice(0, 8);
        const treatmentPlans = buildTreatmentPlans(confirmed, request);
        const explanation = buildInferenceExplanation(
            request,
            confirmed,
            pathognomicResult.excludedConditions,
            'pathognomonic_test',
            pathognomicResult.keyFinding,
        );
        const contradictionAnalysis = analyzeContradictions(request, confirmed);
        const abstainDecision = shouldAbstain(confirmed, request, contradictionAnalysis);
        return {
            differentials: confirmed,
            inference_explanation: explanation,
            diagnosis: buildDiagnosisSummary(confirmed),
            treatment_plans: treatmentPlans,
            ground_truth_summary: buildGroundTruthSummary(confirmed),
            contradiction_analysis: contradictionAnalysis,
            abstain_recommendation: abstainDecision.abstain,
            abstain_reason: abstainDecision.reason,
            competitive_differential: abstainDecision.competitive_differential,
            urgent_confirmatory_testing: abstainDecision.confirmatory_testing_urgent,
            diagnosis_feature_importance: featureImportance(confirmed),
            differential_spread: computeDifferentialSpread(confirmed),
            uncertainty_notes: pathognomicResult.anomalyNotes,
        };
    }

    applyAdjustments(states, applySyndromePatterns(request));
    applyAdjustments(states, applyHaematologicalPriors(request));
    applyAdjustments(states, applyBiochemistryPriors(request));
    applyAdjustments(states, applyImagingPriors(request));
    scoreSymptoms(states, request);

    let differentials = buildDifferentials(states);
    const plausibility = applyEtiologicalPlausibilityGate(differentials, request);
    differentials = normalise(plausibility.differentials).slice(0, 8);
    differentials = applyGroundTruthConfirmation(differentials, request).slice(0, 8);

    const treatmentPlans = buildTreatmentPlans(differentials, request);
    const top = differentials[0];
    const explanation = buildInferenceExplanation(
        request,
        differentials,
        plausibility.excluded_conditions,
        top?.determination_basis ?? 'symptom_scoring',
        top?.supporting_evidence[0]?.finding ?? 'No single confirmatory finding available',
    );

    const uncertaintyNotes: string[] = [];
    if ((top?.probability ?? 0) < 0.55) {
        uncertaintyNotes.push('No pathognomonic finding was present, so probabilities remain provisional until confirmatory testing is completed.');
    }
    if (request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen == null && differentials.some((entry) => entry.condition_id === 'dirofilariosis_canine')) {
        uncertaintyNotes.push('Heartworm disease remains plausible; confirm with Dirofilaria immitis antigen testing.');
    }
    const contradictionAnalysis = analyzeContradictions(request, differentials);
    const abstainDecision = shouldAbstain(differentials, request, contradictionAnalysis);
    if (abstainDecision.message) {
        uncertaintyNotes.push(abstainDecision.message);
    }

    return {
        differentials,
        inference_explanation: explanation,
        diagnosis: buildDiagnosisSummary(differentials),
        treatment_plans: treatmentPlans,
        ground_truth_summary: buildGroundTruthSummary(differentials),
        contradiction_analysis: contradictionAnalysis,
        abstain_recommendation: abstainDecision.abstain,
        abstain_reason: abstainDecision.reason,
        competitive_differential: abstainDecision.competitive_differential,
        urgent_confirmatory_testing: abstainDecision.confirmatory_testing_urgent,
        diagnosis_feature_importance: featureImportance(differentials),
        differential_spread: computeDifferentialSpread(differentials),
        uncertainty_notes: uncertaintyNotes,
    };
}
