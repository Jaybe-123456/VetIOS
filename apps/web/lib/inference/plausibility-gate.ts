import type { DifferentialEntry, InferenceRequest } from './types';

export interface ExcludedCondition {
    condition: string;
    reason: string;
}

export interface PlausibilityGateResult {
    differentials: DifferentialEntry[];
    excluded_conditions: ExcludedCondition[];
}

const DIROFILARIOSIS_EXCLUSIONS = [
    'Tracheal Collapse',
    'Primary Bronchitis',
    'Diabetes Mellitus',
    'Hypothyroidism',
    'Megaesophagus',
    'Laryngeal Paralysis',
];

function hasPositiveInfectiousTest(request: InferenceRequest) {
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
    confirmedOrHighProbability: string[],
    request: InferenceRequest,
): PlausibilityGateResult {
    const excluded: ExcludedCondition[] = [];
    let filtered = [...differentials];

    const eosinophiliaPresent = request.diagnostic_tests?.cbc?.eosinophilia != null
        && request.diagnostic_tests?.cbc?.eosinophilia !== 'absent';
    const pulmonaryVascularPattern =
        request.diagnostic_tests?.thoracic_radiograph?.pulmonary_artery_enlargement === 'present'
        && request.diagnostic_tests?.echocardiography?.right_heart_enlargement === 'present';

    if (confirmedOrHighProbability.includes('Dirofilariosis')) {
        filtered = filtered.flatMap((entry) => {
            if (entry.condition === 'Congestive Heart Failure') {
                return [{
                    ...entry,
                    supporting_evidence: [
                        ...entry.supporting_evidence,
                        { finding: 'Right-sided cardiac changes are interpreted as secondary to heartworm disease', weight: 'strong' },
                    ],
                    relationship_to_primary: {
                        type: 'secondary',
                        primary_condition: 'Dirofilariosis',
                    },
                }];
            }

            if (entry.condition === 'Tracheal Collapse' && request.diagnostic_tests?.thoracic_radiograph?.tracheal_collapse_seen === 'present') {
                return [{
                    ...entry,
                    relationship_to_primary: {
                        type: 'co-morbidity',
                        primary_condition: 'Dirofilariosis',
                    },
                    probability: Math.min(entry.probability, 0.04),
                }];
            }

            if (DIROFILARIOSIS_EXCLUSIONS.includes(entry.condition)) {
                excluded.push({
                    condition: entry.condition,
                    reason: entry.condition === 'Tracheal Collapse'
                        ? 'Excluded: pulmonary vascular pattern is inconsistent with tracheal collapse as the primary diagnosis'
                        : entry.condition === 'Primary Bronchitis'
                            ? 'Excluded: pathognomonic parasitic evidence fully explains the chronic respiratory syndrome'
                            : entry.condition === 'Diabetes Mellitus'
                                ? 'Excluded: no shared pathophysiology or diabetic laboratory evidence supports this as the primary diagnosis'
                                : `Excluded: confirmed parasitic cardiopulmonary disease makes ${entry.condition} implausible as the primary diagnosis`,
                });
                return [];
            }

            return [entry];
        });
    }

    if (hasPositiveInfectiousTest(request)) {
        const infectionIncompatible = new Set([
            'Hypothyroidism',
            'Hyperadrenocorticism',
            'Stress hyperglycaemia alone',
        ]);
        filtered = filtered.filter((entry) => {
            if (!infectionIncompatible.has(entry.condition)) return true;
            excluded.push({
                condition: entry.condition,
                reason: 'Excluded: positive infectious or parasitic testing makes a sterile non-infectious explanation implausible as the primary diagnosis',
            });
            return false;
        });
    }

    filtered = filtered.map((entry) => {
        let probability = entry.probability;
        const contradicting = [...entry.contradicting_evidence];

        if (
            eosinophiliaPresent
            && confirmedOrHighProbability.some((condition) => ['Dirofilariosis', 'Leishmaniosis', 'Intestinal parasitism'].includes(condition))
            && !['Dirofilariosis', 'Leishmaniosis', 'Intestinal parasitism', 'Eosinophilic bronchopneumopathy'].includes(entry.condition)
        ) {
            probability = Math.max(0, probability - 0.10);
            contradicting.push({
                finding: 'Eosinophilia weakens a non-parasitic primary diagnosis',
                weight: 'weakens',
            });
        }

        if (pulmonaryVascularPattern) {
            if (entry.condition === 'Left-sided degenerative valve disease') {
                probability = Math.max(0, probability - 0.30);
                contradicting.push({
                    finding: 'Pulmonary artery enlargement with right-heart changes weakens left-sided cardiac disease',
                    weight: 'weakens',
                });
            }
            if (entry.condition === 'Tracheal Collapse') {
                probability = Math.max(0, probability - 0.40);
                contradicting.push({
                    finding: 'Pulmonary vascular pattern is inconsistent with tracheal collapse as the primary diagnosis',
                    weight: 'excludes',
                });
            }
            if (entry.condition === 'Primary Bronchitis') {
                probability = Math.max(0, probability - 0.25);
                contradicting.push({
                    finding: 'Pulmonary artery enlargement and right-heart enlargement weaken primary bronchitis',
                    weight: 'weakens',
                });
            }
        }

        return {
            ...entry,
            probability,
            contradicting_evidence: contradicting,
        };
    });

    const positiveTotal = filtered.reduce((sum, entry) => sum + Math.max(0, entry.probability), 0) || 1;
    filtered = filtered
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

    return {
        differentials: filtered,
        excluded_conditions: excluded,
    };
}
