import { getConditionById } from './condition-registry';
import type { DiagnosticTests, DifferentialEntry, GroundTruthStatus, InferenceRequest } from './types';

function getRequiredPositive(diagnosticTests: DiagnosticTests | undefined, path: string): boolean | null {
    if (!diagnosticTests) return null;
    const fragments = path.split('.');
    let current: unknown = diagnosticTests;
    for (const fragment of fragments) {
        if (current == null || typeof current !== 'object') return null;
        current = (current as Record<string, unknown>)[fragment];
    }
    if (current == null) return null;
    const value = String(current).toLowerCase();
    return value === 'positive' || value === 'present' || value === 'positive_microfilariae' || value === 'low' || value.includes('babesia');
}

function pushCriterion(target: string[], value: string) {
    if (!target.includes(value)) target.push(value);
}

function confirmStatusFromProbability(probability: number): GroundTruthStatus {
    if (probability >= 0.85) return 'confirmed';
    if (probability >= 0.65) return 'highly_supported';
    if (probability >= 0.35) return 'supported';
    if (probability >= 0.05) return 'unconfirmed';
    return 'excluded';
}

export function applyGroundTruthConfirmation(
    differentials: DifferentialEntry[],
    request: InferenceRequest,
): DifferentialEntry[] {
    const adjusted = differentials.map((entry) => {
        const condition = entry.condition_id ? getConditionById(entry.condition_id) : undefined;
        const supportingCriteria: string[] = [];
        const missingCriteria: string[] = [];
        const contradictingFindings: string[] = [];
        let probability = entry.probability;
        let determinationBasis = entry.determination_basis;

        if (condition) {
            for (const rule of condition.pathognomonic_tests) {
                const observed = getRequiredPositive(request.diagnostic_tests, rule.test);
                if (observed === true) {
                    probability = Math.max(probability, rule.probability_if_positive ?? probability);
                    determinationBasis = 'pathognomonic_test';
                    pushCriterion(supportingCriteria, rule.evidence_label ?? rule.test);
                } else if (observed === false && rule.required_for_confirmation) {
                    probability = Math.min(probability, Math.max(rule.probability_if_negative ?? 0.02, 0.01));
                    pushCriterion(contradictingFindings, `Negative ${rule.evidence_label ?? rule.test}`);
                } else {
                    pushCriterion(missingCriteria, rule.evidence_label ?? rule.test);
                }
            }
        }

        if (entry.condition_id === 'dirofilariosis_canine') {
            const antigen = request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen;
            if (antigen === 'positive') {
                probability = Math.max(probability, 0.88);
                determinationBasis = 'pathognomonic_test';
                pushCriterion(supportingCriteria, 'Positive Dirofilaria immitis antigen test');
            } else if (antigen === 'negative') {
                probability = 0.03;
                pushCriterion(contradictingFindings, 'Negative Dirofilaria immitis antigen test');
            } else {
                probability = Math.min(probability, 0.55);
                pushCriterion(missingCriteria, 'Dirofilaria immitis antigen test');
            }
        }

        if (entry.condition_id === 'diabetes_mellitus_canine') {
            const hyperglycemia = request.diagnostic_tests?.biochemistry?.glucose === 'hyperglycemia';
            const glucosuria = request.diagnostic_tests?.urinalysis?.glucose_in_urine === 'present';
            if (!hyperglycemia || !glucosuria) {
                probability = 0.01;
                pushCriterion(contradictingFindings, 'Diabetes requires hyperglycaemia plus glucosuria');
            }
        }

        if (entry.condition_id === 'hypothyroidism_canine') {
            if (request.presenting_signs.includes('weight_loss')) {
                probability *= 0.5;
                pushCriterion(contradictingFindings, 'Weight loss weakens hypothyroidism because classic disease causes weight gain');
            }
            if (request.diagnostic_tests?.serology?.t4_total !== 'low' && request.diagnostic_tests?.serology?.free_t4 !== 'low') {
                probability *= 0.7;
                pushCriterion(missingCriteria, 'Low T4 confirmation');
            }
        }

        if (entry.condition_id === 'tracheal_collapse') {
            const largeBreed = /labrador|retriever|shepherd|rottweiler|dane|dobermann|husky|malinois/i.test(request.breed ?? '');
            const seen = request.diagnostic_tests?.thoracic_radiograph?.tracheal_collapse_seen === 'present';
            if (largeBreed && !seen) {
                probability = Math.min(probability, 0.04);
                pushCriterion(contradictingFindings, 'Large-breed signalment without imaging confirmation makes tracheal collapse very unlikely');
            }
        }

        if (entry.condition_id === 'right_sided_chf_secondary' && !entry.relationship_to_primary) {
            entry = {
                ...entry,
                condition: 'Right-sided CHF — primary cause not identified',
                recommended_next_steps: [
                    ...(entry.recommended_next_steps ?? []),
                    'Identify primary cause of right-sided failure',
                    'Evaluate for dirofilariosis, pulmonary hypertension, pulmonic stenosis, and tricuspid disease',
                ],
            };
            pushCriterion(missingCriteria, 'Primary cause of right-sided heart failure');
        }

        if (entry.condition_id === 'ehrlichiosis_canine') {
            const hasTickExposure = request.preventive_history?.vector_exposure?.tick_endemic === true;
            const thrombocytopenia = request.diagnostic_tests?.cbc?.thrombocytopenia && request.diagnostic_tests.cbc.thrombocytopenia !== 'absent';
            const positiveSerology = request.diagnostic_tests?.serology?.ehrlichia_antibody === 'positive';
            const negativeSerology = request.diagnostic_tests?.serology?.ehrlichia_antibody === 'negative';
            if (!hasTickExposure && !thrombocytopenia && !positiveSerology) {
                probability = Math.max(0.01, probability - 0.35);
                pushCriterion(contradictingFindings, 'No tick exposure, thrombocytopenia, or positive Ehrlichia testing');
            }
            if (negativeSerology) {
                probability = 0.02;
                pushCriterion(contradictingFindings, 'Negative Ehrlichia antibody test');
            }
        }

        return {
            ...entry,
            probability,
            determination_basis: determinationBasis,
            ground_truth_explanation: {
                condition: entry.condition,
                pre_confirmation_probability: entry.probability,
                post_confirmation_probability: probability,
                criteria_source: entry.condition_id === 'dirofilariosis_canine' ? 'AHS 2024' : 'WSAVA/ESCCAP evidence model',
                supporting_criteria: supportingCriteria,
                missing_criteria: missingCriteria,
                contradicting_findings: contradictingFindings,
                confirmation_status: confirmStatusFromProbability(probability),
            },
        };
    });

    const total = adjusted.reduce((sum, entry) => sum + Math.max(0, entry.probability), 0) || 1;
    return adjusted
        .map((entry) => ({
            ...entry,
            probability: Math.max(0, entry.probability) / total,
        }))
        .sort((left, right) => right.probability - left.probability)
        .map((entry, index) => ({
            ...entry,
            rank: index + 1,
        }));
}
