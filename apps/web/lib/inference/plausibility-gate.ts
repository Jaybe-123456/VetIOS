import type { DifferentialEntry, InferenceRequest } from './types';

export interface ExcludedCondition {
    condition: string;
    reason: string;
}

export interface PlausibilityGateResult {
    differentials: DifferentialEntry[];
    excluded_conditions: ExcludedCondition[];
}

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
    const hasHeartworm = differentials.some((entry) => entry.condition_id === 'dirofilariosis_canine' && entry.probability >= 0.6)
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

    for (const entry of differentials) {
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

        let probability = entry.probability;
        const contradicting = [...entry.contradicting_evidence];

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
