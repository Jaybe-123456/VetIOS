import { getBreedMultiplier } from './breed-priors';
import { getConditionById } from './condition-registry';
import type {
    DiagnosticTests,
    DifferentialEntry,
    GroundTruthExplanation,
    GroundTruthStatus,
    InferenceRequest,
} from './types';

type TestResultState =
    | 'positive'
    | 'negative'
    | 'equivocal'
    | 'not_done'
    | 'not_in_request'
    | 'present'
    | 'absent'
    | 'positive_microfilariae'
    | 'low'
    | 'normal'
    | 'high'
    | string;

function getNestedValue(root: unknown, path: string): unknown {
    const fragments = path.split('.').filter(Boolean);
    let current = root;

    for (const fragment of fragments) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[fragment];
    }

    return current;
}

function getPathRoot(request: InferenceRequest, testPath: string): unknown {
    if (testPath.startsWith('diagnostic_tests.')) return request;
    if (
        testPath.startsWith('serology.')
        || testPath.startsWith('cbc.')
        || testPath.startsWith('biochemistry.')
        || testPath.startsWith('urinalysis.')
        || testPath.startsWith('thoracic_radiograph.')
        || testPath.startsWith('abdominal_ultrasound.')
        || testPath.startsWith('echocardiography.')
        || testPath.startsWith('cytology.')
        || testPath.startsWith('pcr.')
        || testPath.startsWith('parasitology.')
    ) {
        return request.diagnostic_tests;
    }
    return request;
}

function readObservedValue(
    testPath: string,
    request: InferenceRequest,
): unknown {
    return getNestedValue(getPathRoot(request, testPath), testPath.replace(/^diagnostic_tests\./, ''));
}

export function getTestResultFromRequest(
    testPath: string,
    request: InferenceRequest,
): TestResultState {
    const value = readObservedValue(testPath, request);

    if (value === undefined || value === null) {
        return 'not_in_request';
    }

    if (typeof value === 'string') {
        return value;
    }

    return String(value);
}

function matchesExpectedResult(observed: TestResultState, expected: string): boolean {
    const normalizedExpected = expected.toLowerCase();

    if (observed === 'not_in_request' || observed === 'not_done') {
        return false;
    }

    if (Array.isArray(observed)) {
        return false;
    }

    const normalizedObserved = String(observed).toLowerCase();

    if (normalizedExpected === 'positive') {
        return ['positive', 'present', 'positive_microfilariae'].includes(normalizedObserved);
    }
    if (normalizedExpected === 'negative') {
        return ['negative', 'absent'].includes(normalizedObserved);
    }
    if (normalizedExpected === 'present') {
        return ['present', 'positive', 'positive_microfilariae'].includes(normalizedObserved);
    }
    if (normalizedExpected === 'absent') {
        return ['absent', 'negative'].includes(normalizedObserved);
    }
    return normalizedObserved === normalizedExpected;
}

function isArrayPositiveMatch(observed: unknown, expected: string): boolean {
    if (!Array.isArray(observed)) return false;
    return observed.some((entry) =>
        String(entry).toLowerCase().includes(expected.toLowerCase().replace(/_/g, ' ')),
    );
}

function classifyObservedState(observed: TestResultState): 'positive' | 'negative' | 'equivocal' | 'not_done' | 'not_in_request' | 'other' {
    switch (observed) {
        case 'positive':
        case 'present':
        case 'positive_microfilariae':
            return 'positive';
        case 'negative':
        case 'absent':
            return 'negative';
        case 'equivocal':
            return 'equivocal';
        case 'not_done':
            return 'not_done';
        case 'not_in_request':
            return 'not_in_request';
        default:
            return 'other';
    }
}

function pushUnique(target: string[], value: string) {
    if (!target.includes(value)) {
        target.push(value);
    }
}

function clampProbability(value: number) {
    return Math.max(0.001, Math.min(0.999, value));
}

function hasHyperglycaemia(request: InferenceRequest) {
    return request.diagnostic_tests?.biochemistry?.glucose === 'hyperglycemia';
}

function hasGlucosuria(request: InferenceRequest) {
    return request.diagnostic_tests?.urinalysis?.glucose_in_urine === 'present';
}

function isLargeBreed(request: InferenceRequest) {
    const breed = String(request.breed ?? '').toLowerCase();
    return ['large_breed', 'labrador', 'retriever', 'shepherd', 'rottweiler', 'dane', 'dobermann', 'husky', 'malinois', 'boxer', 'weimaraner', 'vizsla', 'standard_poodle'].some((token) => breed.includes(token));
}

function hasTickExposure(request: InferenceRequest) {
    return request.preventive_history?.vector_exposure?.tick_endemic === true;
}

function hasThrombocytopenia(request: InferenceRequest) {
    return request.diagnostic_tests?.cbc?.thrombocytopenia != null
        && request.diagnostic_tests.cbc.thrombocytopenia !== 'absent';
}

function hasPositiveEhrlichia(request: InferenceRequest) {
    return request.diagnostic_tests?.serology?.ehrlichia_antibody === 'positive'
        || request.diagnostic_tests?.pcr?.ehrlichia_pcr === 'positive';
}

function hasGiSigns(request: InferenceRequest) {
    const signs = new Set(request.presenting_signs.map((sign) => sign.toLowerCase()));
    return ['vomiting', 'diarrhea', 'hemorrhagic_gastroenteritis', 'melena', 'bloody_diarrhea'].some((sign) => signs.has(sign));
}

function applyBiologicalPlausibilityAdjustment(
    conditionId: string | undefined,
    probability: number,
    request: InferenceRequest,
    explanation: GroundTruthExplanation,
): number {
    if (!conditionId) return probability;

    let adjusted = probability;

    switch (conditionId) {
        case 'diabetes_mellitus_canine':
            if (!hasHyperglycaemia(request) || !hasGlucosuria(request)) {
                adjusted *= 0.05;
                explanation.confirmation_status =
                    request.diagnostic_tests?.biochemistry?.glucose == null
                    && request.diagnostic_tests?.urinalysis?.glucose_in_urine == null
                        ? 'unconfirmed'
                        : 'unlikely';
                pushUnique(explanation.missing_criteria, 'biochemistry.glucose');
                pushUnique(explanation.missing_criteria, 'urinalysis.glucose_in_urine');
                pushUnique(explanation.contradicting_findings, 'Diabetes mellitus requires hyperglycaemia plus glucosuria');
            }
            break;
        case 'hypothyroidism_canine':
            if (request.presenting_signs.includes('weight_loss')) {
                adjusted *= 0.30;
                explanation.confirmation_status = 'unlikely';
                pushUnique(explanation.contradicting_findings, 'weight_loss contradicts hypothyroidism as a primary diagnosis');
            }
            if (
                request.diagnostic_tests?.serology?.t4_total == null
                && request.diagnostic_tests?.serology?.free_t4 == null
            ) {
                adjusted *= 0.60;
                explanation.confirmation_status = 'unconfirmed';
                pushUnique(explanation.missing_criteria, 'serology.t4_total');
            }
            break;
        case 'tracheal_collapse':
            if (isLargeBreed(request)) {
                adjusted *= 0.05;
                explanation.confirmation_status = 'unlikely';
                pushUnique(explanation.contradicting_findings, `Breed ${request.breed ?? 'large_breed'} has very low predisposition to Tracheal Collapse`);
            }
            if (request.diagnostic_tests?.thoracic_radiograph?.pulmonary_artery_enlargement === 'present') {
                adjusted *= 0.15;
                explanation.confirmation_status = 'unlikely';
                pushUnique(explanation.contradicting_findings, 'Pulmonary artery enlargement favors pulmonary vascular disease over tracheal disease');
            }
            break;
        case 'ehrlichiosis_canine':
            if (!hasTickExposure(request) && !hasThrombocytopenia(request) && !hasPositiveEhrlichia(request)) {
                adjusted *= 0.07;
                explanation.confirmation_status = 'excluded';
                pushUnique(explanation.contradicting_findings, 'No tick exposure, thrombocytopenia, or positive Ehrlichia testing');
            }
            break;
        case 'parvoviral_enteritis':
            if (!hasGiSigns(request)) {
                adjusted *= 0.08;
                explanation.confirmation_status = 'unlikely';
                pushUnique(explanation.contradicting_findings, 'Parvoviral enteritis is implausible without vomiting, diarrhea, or haemorrhagic GI signs');
            }
            break;
        case 'dirofilariosis_canine': {
            const antigenState = getTestResultFromRequest('serology.dirofilaria_immitis_antigen', request);
            if (
                antigenState !== 'negative'
                && antigenState !== 'absent'
                &&
                request.preventive_history?.vector_exposure?.mosquito_endemic === true
                && request.preventive_history?.heartworm_prevention === 'none'
            ) {
                adjusted *= 1.25;
                pushUnique(explanation.supporting_criteria, 'Unprotected mosquito-endemic exposure increases heartworm plausibility');
            }
            if (antigenState === 'not_done' || antigenState === 'not_in_request') {
                explanation.confirmation_status = 'unconfirmed';
                explanation.message = 'Antigen test not performed — test urgently recommended';
                pushUnique(
                    explanation.missing_criteria,
                    antigenState === 'not_done'
                        ? 'serology.dirofilaria_immitis_antigen not yet performed — urgently recommended'
                        : 'serology.dirofilaria_immitis_antigen — data not provided',
                );
            }
            break;
        }
        default:
            break;
    }

    return adjusted;
}

export function applyGroundTruthConfirmation(
    differentials: DifferentialEntry[],
    request: InferenceRequest,
): DifferentialEntry[] {
    const adjusted = differentials.map((differential) => {
        const condition = differential.condition_id ? getConditionById(differential.condition_id) : undefined;
        if (!condition) return differential;

        let adjustedProbability = differential.probability;
        const explanation: GroundTruthExplanation = {
            condition: differential.condition,
            pre_confirmation_probability: differential.probability,
            post_confirmation_probability: differential.probability,
            criteria_source: differential.condition_id === 'dirofilariosis_canine' ? 'AHS 2024' : 'WSAVA / ESCCAP evidence model',
            supporting_criteria: [],
            missing_criteria: [],
            contradicting_findings: [],
            confirmation_status: 'supported',
        };

        for (const test of condition.pathognomonic_tests ?? []) {
            const observedRaw = readObservedValue(test.test, request);
            const testResult = getTestResultFromRequest(test.test, request);
            const normalizedState = classifyObservedState(testResult);
            const expectedValue = String(test.result);
            const positiveMatch = matchesExpectedResult(testResult, expectedValue) || isArrayPositiveMatch(observedRaw, expectedValue);

            if (positiveMatch) {
                adjustedProbability = Math.max(adjustedProbability, test.probability_if_positive);
                explanation.confirmation_status = 'confirmed';
                pushUnique(explanation.supporting_criteria, test.evidence_label ?? test.test);
                continue;
            }

            switch (normalizedState) {
                case 'negative':
                    adjustedProbability = Math.min(adjustedProbability, 0.03);
                    explanation.confirmation_status = 'excluded';
                    pushUnique(
                        explanation.contradicting_findings,
                        `Negative ${test.evidence_label ?? test.test} — pathognomonic test negative`,
                    );
                    break;
                case 'equivocal':
                    adjustedProbability *= 0.70;
                    if (explanation.confirmation_status !== 'excluded') {
                        explanation.confirmation_status = 'unconfirmed';
                    }
                    pushUnique(explanation.missing_criteria, `Repeat ${test.test} — equivocal result`);
                    break;
                case 'not_done':
                    if (explanation.confirmation_status !== 'excluded' && explanation.confirmation_status !== 'confirmed') {
                        explanation.confirmation_status = 'unconfirmed';
                    }
                    pushUnique(explanation.missing_criteria, `${test.test} not yet performed — urgently recommended`);
                    break;
                case 'not_in_request':
                    if (explanation.confirmation_status !== 'excluded' && explanation.confirmation_status !== 'confirmed') {
                        explanation.confirmation_status = 'unconfirmed';
                    }
                    pushUnique(explanation.missing_criteria, `${test.test} — data not provided`);
                    break;
                default:
                    if (test.result === 'low' && testResult === 'normal') {
                        adjustedProbability *= 0.40;
                        explanation.confirmation_status = 'unlikely';
                        pushUnique(explanation.contradicting_findings, `Normal ${test.test} weakens this diagnosis`);
                    }
                    break;
            }
        }

        adjustedProbability = applyBiologicalPlausibilityAdjustment(
            differential.condition_id,
            adjustedProbability,
            request,
            explanation,
        );

        if (request.breed) {
            const breedMultiplier = getBreedMultiplier(
                differential.condition_id ?? '',
                request.breed,
            );
            if (breedMultiplier < 0.1) {
                adjustedProbability *= breedMultiplier;
                pushUnique(
                    explanation.contradicting_findings,
                    `Breed ${request.breed} has very low predisposition to ${differential.condition}`,
                );
                if (explanation.confirmation_status === 'supported') {
                    explanation.confirmation_status = 'unlikely';
                }
            }
        }

        adjustedProbability = clampProbability(adjustedProbability);
        explanation.post_confirmation_probability = adjustedProbability;

        if (explanation.confirmation_status === 'supported') {
            if (adjustedProbability >= 0.85) explanation.confirmation_status = 'confirmed';
            else if (adjustedProbability >= 0.65) explanation.confirmation_status = 'highly_supported';
            else if (adjustedProbability >= 0.35) explanation.confirmation_status = 'supported';
            else if (adjustedProbability >= 0.05) explanation.confirmation_status = 'unconfirmed';
            else explanation.confirmation_status = 'excluded';
        }

        return {
            ...differential,
            determination_basis: explanation.confirmation_status === 'confirmed'
                ? 'pathognomonic_test'
                : differential.determination_basis,
            probability: adjustedProbability,
            ground_truth_explanation: explanation,
        };
    });

    const total = adjusted.reduce((sum, differential) => sum + differential.probability, 0) || 1;

    return adjusted
        .map((differential) => ({
            ...differential,
            probability: differential.probability / total,
        }))
        .sort((left, right) => right.probability - left.probability)
        .map((differential, index) => ({
            ...differential,
            rank: index + 1,
        }));
}
