import {
    applyPathognomicGate,
    buildPathognomonicExplanation,
    type PathognomonicResult,
} from './pathognomic-gate';
import { applySyndromeRecogniser } from './syndrome-recogniser';
import { applyHaematologicalPriors, type ScoreAdjustment } from './haematological-priors';
import { computeExposurePriors } from './exposure-priors';
import { applyEtiologicalPlausibilityGate } from './plausibility-gate';
import type {
    ConditionClass,
    ContradictingEvidenceEntry,
    DifferentialEntry,
    DifferentialRelationship,
    EvidenceEntry,
    InferenceExplanation,
    InferenceRequest,
    InferenceResponse,
    PhysicalExam,
    PreventiveHistory,
    Progression,
    StructuredHistory,
    VectorExposureHistory,
} from './types';

interface CandidateDefinition {
    condition: string;
    conditionClass: ConditionClass;
    clinicalUrgency: DifferentialEntry['clinical_urgency'];
    symptomWeights: Record<string, number>;
    confirmatoryTests: string[];
    nextSteps: string[];
}

interface CandidateState {
    score: number;
    supporting: EvidenceEntry[];
    contradicting: ContradictingEvidenceEntry[];
    sourceTotals: Record<'pathognomonic' | 'syndrome' | 'symptom' | 'exposure' | 'haematology' | 'exclusion', number>;
    relationship?: DifferentialRelationship;
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

const LIBRARY: CandidateDefinition[] = [
    {
        condition: 'Dirofilariosis',
        conditionClass: 'Infectious',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            chronic_cough: 0.16,
            cough: 0.12,
            exercise_intolerance: 0.18,
            lethargy: 0.08,
            weight_loss: 0.10,
            dyspnea: 0.14,
            syncope: 0.12,
        },
        confirmatoryTests: ['Dirofilaria immitis antigen test', 'Knott test', 'Thoracic radiographs', 'Echocardiography'],
        nextSteps: ['Restrict exercise', 'Stage disease severity', 'Stabilise before adulticide therapy'],
    },
    {
        condition: 'Pulmonary Hypertension',
        conditionClass: 'Idiopathic / Unknown',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            exercise_intolerance: 0.16,
            dyspnea: 0.14,
            syncope: 0.10,
            lethargy: 0.06,
        },
        confirmatoryTests: ['Echocardiography', 'Pulmonary arterial flow assessment'],
        nextSteps: ['Assess right-sided pressure overload', 'Stabilise cardiopulmonary status'],
    },
    {
        condition: 'Congestive Heart Failure',
        conditionClass: 'Degenerative',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            cough: 0.12,
            dyspnea: 0.16,
            exercise_intolerance: 0.15,
            lethargy: 0.08,
            weight_loss: 0.04,
        },
        confirmatoryTests: ['Thoracic radiographs', 'Echocardiography'],
        nextSteps: ['Characterise cardiogenic burden', 'Assess for volume overload'],
    },
    {
        condition: 'Tracheal Collapse',
        conditionClass: 'Degenerative',
        clinicalUrgency: 'routine',
        symptomWeights: {
            chronic_cough: 0.22,
            cough: 0.18,
            honking_cough: 0.24,
            dyspnea: 0.08,
            exercise_intolerance: 0.06,
        },
        confirmatoryTests: ['Inspiratory-expiratory thoracic radiographs', 'Fluoroscopy'],
        nextSteps: ['Confirm dynamic airway collapse'],
    },
    {
        condition: 'Primary Bronchitis',
        conditionClass: 'Idiopathic / Unknown',
        clinicalUrgency: 'routine',
        symptomWeights: {
            chronic_cough: 0.18,
            cough: 0.16,
            dyspnea: 0.06,
            exercise_intolerance: 0.06,
            lethargy: 0.04,
        },
        confirmatoryTests: ['Bronchoscopy', 'Bronchoalveolar lavage', 'Thoracic radiographs'],
        nextSteps: ['Rule out infectious and parasitic causes'],
    },
    {
        condition: 'Babesiosis',
        conditionClass: 'Infectious',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            lethargy: 0.12,
            weakness: 0.14,
            fever: 0.14,
            pale_mucous_membranes: 0.18,
            weight_loss: 0.06,
            dyspnea: 0.06,
        },
        confirmatoryTests: ['Babesia PCR', 'Buffy coat smear', 'Repeat CBC with platelet count'],
        nextSteps: ['Stabilise anaemia', 'Screen for co-infections'],
    },
    {
        condition: 'Ehrlichiosis',
        conditionClass: 'Infectious',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            lethargy: 0.12,
            fever: 0.12,
            weight_loss: 0.10,
            weakness: 0.08,
            pale_mucous_membranes: 0.06,
        },
        confirmatoryTests: ['Ehrlichia serology', 'Ehrlichia PCR', 'CBC and platelet count'],
        nextSteps: ['Screen for co-infections', 'Assess bleeding risk'],
    },
    {
        condition: 'Anaplasmosis',
        conditionClass: 'Infectious',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            lethargy: 0.10,
            fever: 0.10,
            weakness: 0.08,
            lameness: 0.06,
        },
        confirmatoryTests: ['Anaplasma serology', 'Anaplasma PCR', 'CBC and platelet count'],
        nextSteps: ['Screen for co-infections'],
    },
    {
        condition: 'Hepatozoonosis',
        conditionClass: 'Infectious',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            lethargy: 0.10,
            fever: 0.12,
            weight_loss: 0.08,
            weakness: 0.08,
            lameness: 0.10,
        },
        confirmatoryTests: ['PCR for Hepatozoon', 'Buffy coat evaluation'],
        nextSteps: ['Assess myositis and co-infections'],
    },
    {
        condition: 'Leishmaniosis',
        conditionClass: 'Infectious',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            weight_loss: 0.14,
            lethargy: 0.10,
            lymphadenopathy: 0.12,
            skin_lesions: 0.08,
            ocular_findings: 0.08,
        },
        confirmatoryTests: ['Leishmania serology', 'Leishmania PCR', 'Urinalysis for proteinuria'],
        nextSteps: ['Assess renal involvement'],
    },
    {
        condition: 'Parvoviral enteritis',
        conditionClass: 'Infectious',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            vomiting: 0.18,
            diarrhea: 0.18,
            lethargy: 0.10,
            anorexia: 0.08,
            fever: 0.06,
        },
        confirmatoryTests: ['Parvovirus antigen test', 'CBC with lymphocyte count'],
        nextSteps: ['Institute isolation', 'Aggressive fluid support if unstable'],
    },
    {
        condition: 'Acute Gastroenteritis',
        conditionClass: 'Infectious',
        clinicalUrgency: 'routine',
        symptomWeights: {
            vomiting: 0.20,
            diarrhea: 0.20,
            lethargy: 0.08,
            fever: 0.04,
            anorexia: 0.06,
        },
        confirmatoryTests: ['Fecal testing', 'CBC and chemistry panel'],
        nextSteps: ['Assess hydration', 'Rule out infectious enteropathogens'],
    },
    {
        condition: 'Dietary indiscretion',
        conditionClass: 'Idiopathic / Unknown',
        clinicalUrgency: 'routine',
        symptomWeights: {
            vomiting: 0.16,
            diarrhea: 0.12,
            lethargy: 0.04,
            abdominal_pain: 0.04,
        },
        confirmatoryTests: ['Baseline chemistry panel', 'Abdominal imaging if obstruction cannot be excluded'],
        nextSteps: ['Assess for foreign body risk'],
    },
    {
        condition: 'Intestinal parasitism',
        conditionClass: 'Infectious',
        clinicalUrgency: 'routine',
        symptomWeights: {
            diarrhea: 0.12,
            weight_loss: 0.10,
            vomiting: 0.06,
            lethargy: 0.04,
        },
        confirmatoryTests: ['Fecal flotation', 'Fecal antigen testing'],
        nextSteps: ['Confirm parasite burden'],
    },
    {
        condition: 'Eosinophilic bronchopneumopathy',
        conditionClass: 'Autoimmune / Immune-Mediated',
        clinicalUrgency: 'routine',
        symptomWeights: {
            chronic_cough: 0.18,
            cough: 0.16,
            dyspnea: 0.10,
            exercise_intolerance: 0.08,
        },
        confirmatoryTests: ['CBC with eosinophil count', 'Bronchoalveolar lavage'],
        nextSteps: ['Exclude parasitic disease before steroid therapy'],
    },
    {
        condition: 'Immune-mediated haemolytic anaemia',
        conditionClass: 'Autoimmune / Immune-Mediated',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            pale_mucous_membranes: 0.18,
            lethargy: 0.12,
            weakness: 0.12,
            dyspnea: 0.08,
            icterus: 0.10,
        },
        confirmatoryTests: ['Blood smear review', 'Coombs testing'],
        nextSteps: ['Assess haemolytic severity', 'Rule out infectious triggers'],
    },
    {
        condition: 'Immune-mediated thrombocytopenia',
        conditionClass: 'Autoimmune / Immune-Mediated',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            bleeding: 0.18,
            petechiae: 0.18,
            lethargy: 0.06,
        },
        confirmatoryTests: ['CBC with platelet count', 'Tick-borne testing'],
        nextSteps: ['Assess bleeding risk'],
    },
    {
        condition: 'Diabetes Mellitus',
        conditionClass: 'Metabolic / Endocrine',
        clinicalUrgency: 'routine',
        symptomWeights: {
            weight_loss: 0.12,
            lethargy: 0.06,
            polyuria: 0.18,
            polydipsia: 0.18,
            polyphagia: 0.12,
        },
        confirmatoryTests: ['Serum glucose', 'Urinalysis for glucosuria'],
        nextSteps: ['Confirm persistent hyperglycaemia'],
    },
    {
        condition: 'Hypothyroidism',
        conditionClass: 'Metabolic / Endocrine',
        clinicalUrgency: 'routine',
        symptomWeights: {
            lethargy: 0.10,
            weight_gain: 0.10,
            alopecia: 0.12,
            weakness: 0.04,
        },
        confirmatoryTests: ['Total T4', 'Free T4', 'TSH if available'],
        nextSteps: ['Confirm thyroid hormone deficiency'],
    },
    {
        condition: 'Hyperadrenocorticism',
        conditionClass: 'Metabolic / Endocrine',
        clinicalUrgency: 'routine',
        symptomWeights: {
            polyuria: 0.16,
            polydipsia: 0.16,
            panting: 0.12,
            alopecia: 0.12,
            lethargy: 0.04,
        },
        confirmatoryTests: ['ACTH stimulation test', 'Low-dose dexamethasone suppression test'],
        nextSteps: ['Confirm endocrine pattern before treatment'],
    },
    {
        condition: 'Hypoadrenocorticism',
        conditionClass: 'Metabolic / Endocrine',
        clinicalUrgency: 'urgent',
        symptomWeights: {
            lethargy: 0.10,
            vomiting: 0.10,
            diarrhea: 0.10,
            weakness: 0.08,
            collapse: 0.08,
        },
        confirmatoryTests: ['Electrolytes', 'Baseline cortisol', 'ACTH stimulation test'],
        nextSteps: ['Assess shock risk'],
    },
];

const LOOKUP = new Map(LIBRARY.map((candidate) => [candidate.condition, candidate]));
const CLASSES: ConditionClass[] = [
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

export function runClinicalInferenceEngine(
    rawInput: Record<string, unknown> | InferenceRequest,
): ClinicalInferenceEngineResult {
    const request = coerceInferenceRequest(rawInput);

    const pathognomic = applyPathognomicGate(request);
    if (pathognomic) {
        return buildPathognomicResponse(request, pathognomic);
    }

    const states = new Map<string, CandidateState>(LIBRARY.map((candidate) => [candidate.condition, blankState()]));
    const featureImportance = new Map<string, number>();

    for (const [condition, prior] of computeExposurePriors(request).entries()) {
        addSupport(
            states,
            condition,
            prior,
            `Regional or exposure prior increased baseline plausibility for ${condition}`,
            prior >= 0.12 ? 'strong' : 'supportive',
            'exposure',
        );
    }

    applyAdjustments(states, applySyndromeRecogniser(request), 'syndrome');
    applyAdjustments(states, applyHaematologicalPriors(request), 'haematology');
    applySymptomScoring(states, request, featureImportance);

    let differentials: DifferentialEntry[] = buildDifferentials(states, request);
    const plausibility = applyEtiologicalPlausibilityGate(
        differentials,
        differentials.filter((entry) => entry.probability >= 0.60).map((entry) => entry.condition),
        request,
    );

    differentials = normalizeDifferentials(plausibility.differentials);

    const top = differentials[0] ?? {
        rank: 1,
        condition: 'Undifferentiated syndrome',
        name: 'Undifferentiated syndrome',
        probability: 1,
        confidence: 'low' as const,
        determination_basis: 'symptom_scoring' as const,
        supporting_evidence: [],
        contradicting_evidence: [],
        clinical_urgency: 'routine' as const,
    };

    const explanation: InferenceExplanation = {
        primary_determination: top.determination_basis,
        key_finding:
            top.supporting_evidence[0]?.finding
            ?? 'No single confirmatory test was available; ranking is symptom- and prior-driven',
        excluded_conditions: plausibility.excluded_conditions,
        evidence_quality: top.determination_basis === 'syndrome_pattern' ? 'moderate' : 'low',
        data_completeness_score: computeCompleteness(request),
        missing_data_that_would_help: uniq(
            differentials.slice(0, 3).flatMap((entry) => entry.recommended_confirmatory_tests ?? []),
        ),
    };

    return {
        differentials,
        inference_explanation: explanation,
        diagnosis: {
            analysis: `Evidence-weighted clinical reasoning ranked ${top.condition} first using exposure priors, structured syndrome recognition, haematological weighting, and symptom scoring.`,
            primary_condition_class: resolveClass(top.condition),
            condition_class_probabilities: classProbabilities(differentials),
            top_differentials: differentials,
            confidence_score: top.probability,
        },
        diagnosis_feature_importance: Object.fromEntries(
            [...featureImportance.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8),
        ),
        differential_spread: spread(differentials),
        uncertainty_notes:
            top.determination_basis === 'symptom_scoring'
                ? ['No pathognomonic test was present, so the differential remains intentionally broad until confirmatory testing narrows it.']
                : [],
    };
}

function buildPathognomicResponse(
    request: InferenceRequest,
    result: PathognomonicResult,
): ClinicalInferenceEngineResult {
    const primaryName = result.rule.condition === 'Dirofilariosis'
        ? 'Dirofilariosis (Heartworm disease)'
        : result.rule.condition;

    const comorbidities = result.rule.condition === 'Dirofilariosis'
        && request.diagnostic_tests?.thoracic_radiograph?.tracheal_collapse_seen === 'present'
        ? [{ condition: 'Tracheal Collapse', probability: 0.03, type: 'co-morbidity' as const }]
        : [];

    const primaryProbability = Math.min(0.95, result.primary_probability);
    const remainder = Math.max(0.05, 1 - primaryProbability);

    const secondaryPool = [
        ...result.rule.secondary_diagnoses.map((entry) => ({
            condition: entry.condition,
            probability: entry.probability,
            type: entry.relationship_type ?? 'secondary',
        })),
        ...comorbidities,
    ];
    const secondaryTotal = secondaryPool.reduce((sum, entry) => sum + entry.probability, 0) || 1;

    const primary: DifferentialEntry = {
        rank: 1,
        condition: primaryName,
        name: primaryName,
        probability: primaryProbability,
        confidence: 'high',
        determination_basis: 'pathognomonic_test',
        supporting_evidence: result.supporting_evidence,
        contradicting_evidence: result.anomaly_notes.map((note) => ({
            finding: note,
            weight: 'weakens',
        })),
        clinical_urgency: result.rule.urgency,
        recommended_confirmatory_tests: [],
        recommended_next_steps: result.rule.recommended_next_steps,
    };

    const secondaries: DifferentialEntry[] = secondaryPool.map((entry, index) => {
        const rawProbability = (entry.probability / secondaryTotal) * remainder;
        return {
            rank: index + 2,
            condition: entry.condition,
            name: entry.condition,
            probability: rawProbability,
            confidence: rawProbability >= 0.08 ? 'moderate' : 'low',
            determination_basis: 'syndrome_pattern',
            supporting_evidence: [{
                finding: `${entry.condition} is a plausible sequela or co-morbidity of ${result.rule.condition}`,
                weight: 'supportive',
            }],
            contradicting_evidence: [],
            relationship_to_primary: {
                type: entry.type,
                primary_condition: result.rule.condition,
            },
            clinical_urgency: entry.condition === 'Pulmonary Hypertension' ? 'urgent' : 'routine',
            recommended_confirmatory_tests:
                entry.condition === 'Pulmonary Hypertension'
                    ? ['Echocardiography with pulmonary pressure assessment']
                    : undefined,
        };
    });

    const differentials = normalizeDifferentials([primary, ...secondaries]);

    const excluded = result.rule.exclusions
        .filter((condition) => !(condition === 'Tracheal Collapse' && comorbidities.length > 0))
        .map((condition) => ({
            condition,
            reason:
                condition === 'Tracheal Collapse'
                    ? 'Excluded: pulmonary vascular pattern is inconsistent with tracheal collapse as the primary diagnosis'
                    : condition === 'Primary Bronchitis'
                        ? 'Excluded: pathognomonic parasitic evidence fully explains the chronic respiratory syndrome'
                        : condition === 'Diabetes Mellitus'
                            ? 'Excluded: no diabetic laboratory evidence or shared pathophysiology supports this as the primary diagnosis'
                            : `Excluded: ${condition} is etiologically implausible once ${result.rule.condition} is confirmed`,
        }));

    return {
        differentials,
        inference_explanation: buildPathognomonicExplanation(result, excluded, computeCompleteness(request)),
        diagnosis: {
            analysis: `${primaryName} was elevated through a pathognomonic gate before symptom scoring because definitive diagnostic evidence was present.`,
            primary_condition_class: resolveClass(result.rule.condition),
            condition_class_probabilities: classProbabilities(differentials),
            top_differentials: differentials,
            confidence_score: differentials[0]?.probability ?? primaryProbability,
        },
        diagnosis_feature_importance: Object.fromEntries(
            primary.supporting_evidence.map((entry) => [
                entry.finding,
                entry.weight === 'definitive'
                    ? 1
                    : entry.weight === 'strong'
                        ? 0.75
                        : entry.weight === 'supportive'
                            ? 0.5
                            : 0.25,
            ]),
        ),
        differential_spread: spread(differentials),
        uncertainty_notes: result.anomaly_notes,
    };
}

function blankState(): CandidateState {
    return {
        score: 0.01,
        supporting: [],
        contradicting: [],
        sourceTotals: {
            pathognomonic: 0,
            syndrome: 0,
            symptom: 0,
            exposure: 0,
            haematology: 0,
            exclusion: 0,
        },
    };
}

function applyAdjustments(
    states: Map<string, CandidateState>,
    adjustments: ScoreAdjustment[],
    source: 'syndrome' | 'haematology',
) {
    for (const adjustment of adjustments) {
        if (adjustment.penalty) {
            addPenalty(states, adjustment.condition, Math.abs(adjustment.delta), adjustment.finding);
            continue;
        }

        addSupport(
            states,
            adjustment.condition,
            adjustment.delta,
            adjustment.finding,
            adjustment.weight,
            source,
        );
    }
}

function addSupport(
    states: Map<string, CandidateState>,
    condition: string,
    delta: number,
    finding: string,
    weight: EvidenceEntry['weight'],
    source: keyof CandidateState['sourceTotals'],
) {
    const state = states.get(condition);
    if (!state) {
        return;
    }

    state.score += delta;
    state.sourceTotals[source] += delta;
    state.supporting.push({ finding, weight });
}

function addPenalty(
    states: Map<string, CandidateState>,
    condition: string,
    penalty: number,
    finding: string,
) {
    const state = states.get(condition);
    if (!state) {
        return;
    }

    state.score = Math.max(0, state.score - penalty);
    state.contradicting.push({ finding, weight: 'weakens' });
}

function applySymptomScoring(
    states: Map<string, CandidateState>,
    request: InferenceRequest,
    featureImportance: Map<string, number>,
) {
    const signs = normalizeSigns(request);

    if (request.physical_exam?.mucous_membrane_color === 'pale') {
        signs.add('pale_mucous_membranes');
    }
    if (
        request.physical_exam?.lymph_nodes === 'generalised_lymphadenopathy'
        || request.physical_exam?.lymph_nodes === 'regional_lymphadenopathy'
    ) {
        signs.add('lymphadenopathy');
    }
    if ((request.physical_exam?.skin_lesions?.length ?? 0) > 0) {
        signs.add('skin_lesions');
    }
    if ((request.physical_exam?.ocular_findings?.length ?? 0) > 0) {
        signs.add('ocular_findings');
    }
    if (request.diagnostic_tests?.thoracic_radiograph?.tracheal_collapse_seen === 'present') {
        signs.add('honking_cough');
    }

    for (const [condition, state] of states.entries()) {
        const definition = LOOKUP.get(condition);
        if (!definition) {
            continue;
        }

        for (const [sign, weight] of Object.entries(definition.symptomWeights)) {
            if (!signs.has(sign)) {
                continue;
            }

            state.score += weight;
            state.sourceTotals.symptom += weight;
            state.supporting.push({
                finding: `Presenting sign: ${sign.replace(/_/g, ' ')}`,
                weight: weight >= 0.16 ? 'strong' : weight >= 0.10 ? 'supportive' : 'minor',
            });

            const label = sign.replace(/_/g, ' ');
            featureImportance.set(label, Math.max(featureImportance.get(label) ?? 0, weight));
        }
    }

    if (request.diagnostic_tests?.thoracic_radiograph?.tracheal_collapse_seen === 'present') {
        addSupport(
            states,
            'Tracheal Collapse',
            0.35,
            'Tracheal collapse was visualised on radiograph',
            'definitive',
            'syndrome',
        );
    }

    if (request.diagnostic_tests?.echocardiography?.right_heart_enlargement === 'present') {
        addSupport(states, 'Congestive Heart Failure', 0.08, 'Right-heart enlargement on echocardiography', 'strong', 'syndrome');
        addSupport(states, 'Pulmonary Hypertension', 0.10, 'Right-heart enlargement on echocardiography', 'strong', 'syndrome');
        addSupport(states, 'Dirofilariosis', 0.08, 'Right-heart enlargement on echocardiography', 'strong', 'syndrome');
    }

    if (
        request.diagnostic_tests?.biochemistry?.glucose === 'hyperglycemia'
        && request.diagnostic_tests?.urinalysis?.glucose_in_urine !== 'present'
    ) {
        addPenalty(
            states,
            'Diabetes Mellitus',
            0.12,
            'Hyperglycaemia without glucosuria weakens diabetes mellitus as the primary diagnosis',
        );
    }
}

function buildDifferentials(
    states: Map<string, CandidateState>,
    request: InferenceRequest,
): DifferentialEntry[] {
    const ranked = [...states.entries()]
        .sort((left, right) => right[1].score - left[1].score)
        .slice(0, 6);
    const total = ranked.reduce((sum, [, state]) => sum + Math.max(state.score, 0), 0) || 1;

    return ranked.map(([condition, state], index) => {
        const definition = LOOKUP.get(condition);
        const probability = Math.max(0, state.score) / total;

        const entry: DifferentialEntry = {
            rank: index + 1,
            condition,
            name: condition,
            probability,
            confidence: probability >= 0.75 ? 'high' : probability >= 0.4 ? 'moderate' : 'low',
            determination_basis:
                state.sourceTotals.syndrome >= state.sourceTotals.symptom && state.sourceTotals.syndrome > 0
                    ? 'syndrome_pattern'
                    : 'symptom_scoring',
            supporting_evidence: uniqEvidence(state.supporting),
            contradicting_evidence: uniqContradictions(state.contradicting),
            relationship_to_primary: state.relationship,
            clinical_urgency: definition?.clinicalUrgency ?? 'routine',
            recommended_confirmatory_tests: resolveTests(definition, request, condition),
            recommended_next_steps: definition?.nextSteps,
        };

        return entry;
    });
}

function resolveTests(
    definition: CandidateDefinition | undefined,
    request: InferenceRequest,
    condition: string,
) {
    if (!definition) {
        return undefined;
    }

    if (
        condition === 'Dirofilariosis'
        && request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen === 'positive'
    ) {
        return [];
    }

    if (
        condition === 'Babesiosis'
        && (
            request.diagnostic_tests?.pcr?.babesia_pcr === 'positive'
            || (request.diagnostic_tests?.parasitology?.buffy_coat_smear?.length ?? 0) > 0
        )
    ) {
        return [];
    }

    return definition.confirmatoryTests;
}

function classProbabilities(differentials: DifferentialEntry[]) {
    const totals = new Map<ConditionClass, number>(CLASSES.map((conditionClass) => [conditionClass, 0]));

    for (const differential of differentials) {
        const conditionClass = resolveClass(differential.condition);
        totals.set(conditionClass, (totals.get(conditionClass) ?? 0) + differential.probability);
    }

    const total = [...totals.values()].reduce((sum, value) => sum + value, 0) || 1;

    return Object.fromEntries(
        CLASSES.map((conditionClass) => [
            conditionClass,
            Number(((totals.get(conditionClass) ?? 0) / total).toFixed(3)),
        ]),
    ) as Record<ConditionClass, number>;
}

function resolveClass(condition: string): ConditionClass {
    return LOOKUP.get(condition)?.conditionClass ?? 'Idiopathic / Unknown';
}

function spread(differentials: DifferentialEntry[]) {
    if (differentials.length < 2) {
        return null;
    }

    const top1 = differentials[0]?.probability ?? null;
    const top2 = differentials[1]?.probability ?? null;
    const top3 = differentials[2]?.probability ?? null;

    return {
        top_1_probability: top1 != null ? Number(top1.toFixed(3)) : null,
        top_2_probability: top2 != null ? Number(top2.toFixed(3)) : null,
        top_3_probability: top3 != null ? Number(top3.toFixed(3)) : null,
        spread: top1 != null && top2 != null ? Number((top1 - top2).toFixed(3)) : null,
    };
}

function normalizeDifferentials(differentials: DifferentialEntry[]): DifferentialEntry[] {
    const positiveTotal = differentials.reduce((sum, entry) => sum + Math.max(entry.probability, 0), 0) || 1;

    let running = 0;
    return differentials
        .map((entry, index, entries) => {
            const normalized = index === entries.length - 1
                ? Math.max(0, 1 - running)
                : Number((Math.max(entry.probability, 0) / positiveTotal).toFixed(3));

            running += normalized;

            return {
                ...entry,
                rank: index + 1,
                probability: normalized,
            };
        })
        .filter((entry) => entry.probability > 0);
}

function computeCompleteness(request: InferenceRequest) {
    const checks = [
        Boolean(request.species),
        Boolean(request.breed),
        request.presenting_signs.length > 0,
        request.history != null && Object.keys(request.history).length > 0,
        request.preventive_history != null && Object.keys(request.preventive_history).length > 0,
        request.diagnostic_tests?.serology != null,
        request.diagnostic_tests?.cbc != null,
        request.diagnostic_tests?.biochemistry != null,
        request.diagnostic_tests?.urinalysis != null,
        request.diagnostic_tests?.thoracic_radiograph != null,
        request.diagnostic_tests?.echocardiography != null,
        request.physical_exam != null && Object.keys(request.physical_exam).length > 0,
    ];

    return Number((checks.filter(Boolean).length / checks.length).toFixed(2));
}

function normalizeSigns(request: InferenceRequest) {
    const signs = new Set<string>();

    for (const sign of request.presenting_signs) {
        const normalized = sign
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');

        if (normalized) {
            signs.add(normalized);
        }
    }

    return signs;
}

function uniq(values: string[]) {
    return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function uniqEvidence(entries: EvidenceEntry[]) {
    const seen = new Set<string>();
    return entries
        .filter((entry) => {
            const key = `${entry.finding}|${entry.weight}`;
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        })
        .slice(0, 7);
}

function uniqContradictions(entries: ContradictingEvidenceEntry[]) {
    const seen = new Set<string>();
    return entries
        .filter((entry) => {
            const key = `${entry.finding}|${entry.weight}`;
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        })
        .slice(0, 4);
}

function coerceInferenceRequest(rawInput: Record<string, unknown> | InferenceRequest): InferenceRequest {
    const raw = rawInput as Record<string, unknown>;
    const metadata = asRecord(raw.metadata);
    const historyRecord = asRecord(raw.history) ?? asRecord(metadata?.history);
    const preventiveRecord = asRecord(raw.preventive_history) ?? asRecord(metadata?.preventive_history);
    const diagnosticTests = asRecord(raw.diagnostic_tests) ?? asRecord(metadata?.diagnostic_tests);
    const physicalExam = asRecord(raw.physical_exam) ?? asRecord(metadata?.physical_exam);

    const history: StructuredHistory | undefined = historyRecord == null
        ? undefined
        : {
            duration_days: readNumber(historyRecord.duration_days) ?? deriveDurationDays(metadata),
            progression: (readString(historyRecord.progression) as Progression | null) ?? undefined,
            owner_observations: readStringArray(historyRecord.owner_observations) ?? undefined,
            travel_history: readStringArray(historyRecord.travel_history) ?? undefined,
            geographic_region: readString(historyRecord.geographic_region) ?? undefined,
        };

    const preventiveHistory: PreventiveHistory | undefined = preventiveRecord == null
        ? undefined
        : {
            heartworm_prevention: (readString(preventiveRecord.heartworm_prevention) as PreventiveHistory['heartworm_prevention'] | null) ?? undefined,
            ectoparasite_prevention: (readString(preventiveRecord.ectoparasite_prevention) as PreventiveHistory['ectoparasite_prevention'] | null) ?? undefined,
            vaccination_status: (readString(preventiveRecord.vaccination_status) as PreventiveHistory['vaccination_status'] | null) ?? undefined,
            deworming_history: (readString(preventiveRecord.deworming_history) as PreventiveHistory['deworming_history'] | null) ?? undefined,
            vector_exposure: asRecord(preventiveRecord.vector_exposure) as VectorExposureHistory | undefined,
        };

    return {
        species: readString(raw.species) ?? 'canine',
        breed: readString(raw.breed) ?? undefined,
        age_years: readNumber(raw.age_years) ?? deriveAgeYears(metadata),
        weight_kg: readNumber(raw.weight_kg) ?? readNumber(metadata?.weight_kg) ?? undefined,
        sex: readString(raw.sex) ?? undefined,
        region:
            readString(raw.region)
            ?? readString(historyRecord?.geographic_region)
            ?? readString(metadata?.region)
            ?? undefined,
        presenting_signs: readStringArray(raw.presenting_signs) ?? readStringArray(raw.symptoms) ?? [],
        history,
        preventive_history: preventiveHistory,
        diagnostic_tests: diagnosticTests == null ? undefined : requestLike<InferenceRequest['diagnostic_tests']>(diagnosticTests),
        physical_exam: physicalExam == null ? undefined : requestLike<PhysicalExam>(physicalExam),
    };
}

function requestLike<T>(value: Record<string, unknown>) {
    return value as T;
}

function asRecord(value: unknown) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown) {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : undefined;
}

function deriveAgeYears(metadata: Record<string, unknown> | null) {
    const months = readNumber(metadata?.age_months);
    return months != null ? Number((months / 12).toFixed(1)) : undefined;
}

function deriveDurationDays(metadata: Record<string, unknown> | null) {
    const raw = readString(metadata?.duration);
    if (!raw) {
        return undefined;
    }

    const match = raw.match(/(\d+)\s*(day|week|month|year)/i);
    if (!match) {
        return undefined;
    }

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value)) {
        return undefined;
    }

    if (unit.startsWith('week')) {
        return value * 7;
    }
    if (unit.startsWith('month')) {
        return value * 30;
    }
    if (unit.startsWith('year')) {
        return value * 365;
    }

    return value;
}
