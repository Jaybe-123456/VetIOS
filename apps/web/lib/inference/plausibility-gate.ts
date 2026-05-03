import type { DifferentialEntry, InferenceRequest } from './types';

export interface ExcludedCondition {
    condition: string;
    reason: string;
}

export interface PlausibilityGateResult {
    differentials: DifferentialEntry[];
    excluded_conditions: ExcludedCondition[];
}

interface NegativeTestPenalty {
    test_path: string;
    negative_result: string;
    penalised_condition_ids: string[];
    max_allowed_probability: number;
    reason: string;
}

const NEGATIVE_TEST_PENALTIES: NegativeTestPenalty[] = [
    {
        test_path: 'serology.tick_borne_disease_panel',
        negative_result: 'negative',
        penalised_condition_ids: [
            'babesiosis_canine', 'ehrlichiosis_canine',
            'anaplasmosis_canine', 'rickettsia_canine',
        ],
        max_allowed_probability: 0.05,
        reason: 'Negative tick-borne disease panel makes primary tick-borne infection implausible as the leading diagnosis.',
    },
    {
        test_path: 'serology.heartworm_antigen',
        negative_result: 'negative',
        penalised_condition_ids: ['dirofilariosis_canine'],
        max_allowed_probability: 0.04,
        reason: 'Negative heartworm antigen test makes active dirofilariosis implausible.',
    },
    {
        test_path: 'serology.coombs_test',
        negative_result: 'negative',
        penalised_condition_ids: ['imha_canine'],
        max_allowed_probability: 0.12,
        reason: 'Negative Coombs test substantially reduces likelihood of immune-mediated haemolysis as primary.',
    },
    {
        test_path: 'serology.fcov_antibody_titre',
        negative_result: 'negative',
        penalised_condition_ids: ['feline_infectious_peritonitis'],
        max_allowed_probability: 0.06,
        reason: 'Negative FCoV antibody makes FIP unlikely as primary diagnosis.',
    },
    {
        test_path: 'serology.acth_stimulation',
        negative_result: 'normal_response',
        penalised_condition_ids: ['addisons_canine', 'hypoadrenocorticism_canine'],
        max_allowed_probability: 0.04,
        reason: 'Normal ACTH stimulation response effectively excludes hypoadrenocorticism.',
    },
    {
        test_path: 'serology.total_t4',
        negative_result: 'normal',
        penalised_condition_ids: ['hypothyroidism_canine', 'feline_hyperthyroidism'],
        max_allowed_probability: 0.06,
        reason: 'Normal total T4 substantially reduces likelihood of primary thyroid disease.',
    },
    {
        test_path: 'serology.pancreatic_lipase',
        negative_result: 'normal',
        penalised_condition_ids: ['acute_pancreatitis_canine', 'acute_pancreatitis_feline'],
        max_allowed_probability: 0.10,
        reason: 'Normal pancreatic lipase makes primary acute pancreatitis less likely.',
    },
    {
        test_path: 'imaging.abdominal_ultrasound',
        negative_result: 'no_uterine_pathology',
        penalised_condition_ids: ['pyometra_canine_feline'],
        max_allowed_probability: 0.05,
        reason: 'Normal uterine ultrasound effectively excludes pyometra.',
    },
    {
        test_path: 'serology.leishmania_serology',
        negative_result: 'negative',
        penalised_condition_ids: ['leishmaniosis_canine'],
        max_allowed_probability: 0.05,
        reason: 'Negative Leishmania serology makes active leishmaniosis unlikely in a symptomatic patient.',
    },
    {
        test_path: 'urinalysis.glucose_in_urine',
        negative_result: 'absent',
        penalised_condition_ids: ['diabetes_mellitus_canine', 'diabetes_mellitus_feline'],
        max_allowed_probability: 0.08,
        reason: 'Absent glucosuria substantially reduces likelihood of uncontrolled diabetes mellitus.',
    },
];

function hasPositiveInfectiousTest(request: InferenceRequest): boolean {
    const serology = request.diagnostic_tests?.serology;
    const pcr = request.diagnostic_tests?.pcr;
    const parasitology = request.diagnostic_tests?.parasitology;
    return Object.values(serology ?? {}).some((value) => value === 'positive')
        || Object.values(pcr ?? {}).some((value) => value === 'positive')
        || request.diagnostic_tests?.cbc?.microfilaremia === 'present'
        || parasitology?.knott_test === 'positive_microfilariae'
        || (parasitology?.buffy_coat_smear?.length ?? 0) > 0;
}

export function applyEtiologicalPlausibilityGate(
    differentials: DifferentialEntry[],
    request: InferenceRequest,
): PlausibilityGateResult {
    const excluded: ExcludedCondition[] = [];
    const negativePenaltyResult = applyNegativeTestPenalties(differentials, request);
    excluded.push(...negativePenaltyResult.excluded);
    const hasHeartworm = negativePenaltyResult.differentials.some((entry) => entry.condition_id === 'dirofilariosis_canine' && entry.probability >= 0.6)
        || request.diagnostic_tests?.serology?.dirofilaria_immitis_antigen === 'positive';
    const eosinophiliaPresent = request.diagnostic_tests?.cbc?.eosinophilia != null
        && request.diagnostic_tests?.cbc?.eosinophilia !== 'absent';
    const pulmonaryVascularPattern =
        request.diagnostic_tests?.thoracic_radiograph?.pulmonary_artery_enlargement === 'present'
        && (
            request.diagnostic_tests?.echocardiography?.right_heart_enlargement === 'present'
            || request.diagnostic_tests?.thoracic_radiograph?.cardiomegaly === 'right_sided'
        );
    const trachealCollapseSeen = request.diagnostic_tests?.thoracic_radiograph?.tracheal_collapse_seen === 'present';

    const filtered: DifferentialEntry[] = [];

    for (const entry of negativePenaltyResult.differentials) {
        if (entry.condition_id === 'diabetes_mellitus_canine') {
            const hyperglycemia = request.diagnostic_tests?.biochemistry?.glucose === 'hyperglycemia';
            const glucosuria = request.diagnostic_tests?.urinalysis?.glucose_in_urine === 'present';
            if (!hyperglycemia || !glucosuria) {
                excluded.push({
                    condition: entry.condition,
                    reason: 'Excluded: diabetes mellitus cannot be primary without persistent hyperglycaemia and glucosuria',
                });
                continue;
            }
        }

        if (hasHeartworm) {
            if (entry.condition_id === 'tracheal_collapse') {
                if (trachealCollapseSeen) {
                    filtered.push({
                        ...entry,
                        probability: Math.min(entry.probability, 0.04),
                        relationship_to_primary: {
                            type: 'co-morbidity',
                            primary_condition: 'Dirofilariosis (Heartworm disease)',
                        },
                    });
                    continue;
                }
                excluded.push({
                    condition: entry.condition,
                    reason: 'Excluded: pulmonary vascular pattern and confirmatory heartworm evidence are inconsistent with tracheal collapse as the primary diagnosis',
                });
                continue;
            }

            if (entry.condition_id === 'chronic_bronchitis_canine') {
                excluded.push({
                    condition: entry.condition,
                    reason: 'Excluded: pathognomonic parasitic evidence fully explains the chronic respiratory signs',
                });
                continue;
            }

            if (entry.condition_id === 'hypothyroidism_canine' || entry.condition_id === 'megaesophagus' || entry.condition_id === 'laryngeal_paralysis') {
                excluded.push({
                    condition: entry.condition,
                    reason: `Excluded: confirmed cardiopulmonary parasitic disease makes ${entry.condition} implausible as the primary diagnosis`,
                });
                continue;
            }

            if (entry.condition_id === 'right_sided_chf_secondary') {
                filtered.push({
                    ...entry,
                    condition: 'Right-sided CHF (secondary to dirofilariosis)',
                    relationship_to_primary: {
                        type: 'secondary',
                        primary_condition: 'Dirofilariosis (Heartworm disease)',
                    },
                });
                continue;
            }
        }

        if (entry.condition_id === 'right_sided_chf_secondary' && !hasHeartworm) {
            filtered.push({
                ...entry,
                condition: 'Right-sided CHF - primary cause not identified',
                recommended_next_steps: [
                    ...(entry.recommended_next_steps ?? []),
                    'Identify primary cause of right-sided failure',
                    'Evaluate for pulmonary hypertension, pulmonic stenosis, tricuspid dysplasia, or heartworm disease',
                ],
                contradicting_evidence: [
                    ...(entry.contradicting_evidence ?? []),
                    {
                        finding: 'Right-sided CHF is a sequela and requires a primary cause to complete the diagnosis',
                        weight: 'weakens',
                    },
                ],
            });
            continue;
        }

        let probability = entry.probability;
        const contradicting = [...(entry.contradicting_evidence ?? [])];

        if (
            eosinophiliaPresent
            && hasHeartworm
            && !['dirofilariosis_canine', 'pulmonary_hypertension', 'right_sided_chf_secondary', 'tracheal_collapse'].includes(entry.condition_id ?? '')
        ) {
            probability = Math.max(0, probability - 0.1);
            contradicting.push({
                finding: 'Eosinophilia weakens a non-parasitic primary diagnosis',
                weight: 'weakens',
            });
        }

        if (pulmonaryVascularPattern) {
            if (entry.condition_id === 'mitral_valve_disease_canine' || entry.condition_id === 'dilated_cardiomyopathy_canine') {
                probability = Math.max(0, probability - 0.3);
                contradicting.push({
                    finding: 'Pulmonary artery enlargement with right-heart changes weakens left-sided primary cardiac disease',
                    weight: 'weakens',
                });
            }
            if (entry.condition_id === 'tracheal_collapse') {
                probability = Math.max(0, probability - 0.4);
                contradicting.push({
                    finding: 'Pulmonary vascular pattern is inconsistent with tracheal collapse as the primary diagnosis',
                    weight: 'excludes',
                });
            }
            if (entry.condition_id === 'chronic_bronchitis_canine') {
                probability = Math.max(0, probability - 0.25);
                contradicting.push({
                    finding: 'Pulmonary vascular enlargement and right-heart changes weaken primary bronchitis',
                    weight: 'weakens',
                });
            }
        }

        if (hasPositiveInfectiousTest(request) && ['hypothyroidism_canine', 'hyperadrenocorticism_canine'].includes(entry.condition_id ?? '')) {
            excluded.push({
                condition: entry.condition,
                reason: 'Excluded: positive infectious or parasitic testing makes a sterile endocrine explanation implausible as the primary diagnosis',
            });
            continue;
        }

        filtered.push({
            ...entry,
            probability,
            contradicting_evidence: contradicting,
        });
    }

    return {
        differentials: filtered,
        excluded_conditions: excluded,
    };
}

function applyNegativeTestPenalties(
    differentials: DifferentialEntry[],
    request: InferenceRequest,
): { differentials: DifferentialEntry[]; excluded: ExcludedCondition[] } {
    const excluded: ExcludedCondition[] = [];
    let current = [...differentials];

    for (const penalty of NEGATIVE_TEST_PENALTIES) {
        const testValue = getTestValue(request, penalty.test_path);
        if (!testValue || String(testValue).toLowerCase() !== penalty.negative_result.toLowerCase()) continue;

        current = current.map((diff) => {
            if (!penalty.penalised_condition_ids.includes(diff.condition_id ?? '')) return diff;
            if (diff.probability <= penalty.max_allowed_probability) return diff;
            return {
                ...diff,
                probability: penalty.max_allowed_probability,
                contradicting_evidence: [
                    ...(diff.contradicting_evidence ?? []),
                    { finding: penalty.reason, weight: 'excludes' as const },
                ],
            };
        });
    }

    return { differentials: current, excluded };
}

function getTestValue(request: InferenceRequest, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = request.diagnostic_tests;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}
