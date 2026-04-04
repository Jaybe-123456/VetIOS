import type { InferenceRequest, EvidenceWeight } from './types';

export interface ScoreAdjustment {
    condition: string;
    delta: number;
    finding: string;
    weight: EvidenceWeight;
    penalty?: boolean;
}

export function applyHaematologicalPriors(request: InferenceRequest): ScoreAdjustment[] {
    const cbc = request.diagnostic_tests?.cbc;
    if (!cbc) return [];

    const adjustments: ScoreAdjustment[] = [];

    if (cbc.eosinophilia && cbc.eosinophilia !== 'absent') {
        adjustments.push(
            { condition: 'Dirofilariosis', delta: 0.12, finding: 'Eosinophilia on CBC', weight: 'supportive' },
            { condition: 'Intestinal parasitism', delta: 0.10, finding: 'Eosinophilia on CBC', weight: 'supportive' },
            { condition: 'Eosinophilic bronchopneumopathy', delta: 0.08, finding: 'Eosinophilia on CBC', weight: 'supportive' },
            { condition: 'Hypoadrenocorticism', delta: 0.05, finding: 'Eosinophilia on CBC', weight: 'minor' },
            { condition: 'Leishmaniosis', delta: 0.04, finding: 'Eosinophilia on CBC', weight: 'minor' },
            { condition: 'Mast cell neoplasia', delta: 0.03, finding: 'Eosinophilia on CBC', weight: 'minor' },
            { condition: 'Diabetes Mellitus', delta: -0.08, finding: 'Eosinophilia weakens a metabolic-only explanation', weight: 'minor', penalty: true },
            { condition: 'Hypothyroidism', delta: -0.05, finding: 'Eosinophilia weakens hypothyroidism as the primary diagnosis', weight: 'minor', penalty: true },
            { condition: 'Congestive Heart Failure', delta: -0.04, finding: 'Eosinophilia weakens primary cardiogenic disease', weight: 'minor', penalty: true },
        );
    }

    if (cbc.eosinophilia === 'moderate' || cbc.eosinophilia === 'severe') {
        adjustments.push(
            { condition: 'Dirofilariosis', delta: 0.08, finding: 'Moderate-to-severe eosinophilia', weight: 'strong' },
            { condition: 'Eosinophilic granulomatosis', delta: 0.10, finding: 'Moderate-to-severe eosinophilia', weight: 'strong' },
        );
    }

    if (cbc.thrombocytopenia && cbc.thrombocytopenia !== 'absent') {
        adjustments.push(
            { condition: 'Ehrlichiosis', delta: 0.15, finding: 'Thrombocytopenia on CBC', weight: 'strong' },
            { condition: 'Anaplasmosis', delta: 0.15, finding: 'Thrombocytopenia on CBC', weight: 'strong' },
            { condition: 'Babesiosis', delta: 0.12, finding: 'Thrombocytopenia on CBC', weight: 'strong' },
            { condition: 'Immune-mediated thrombocytopenia', delta: 0.10, finding: 'Thrombocytopenia on CBC', weight: 'supportive' },
            { condition: 'Leishmaniosis', delta: 0.08, finding: 'Thrombocytopenia on CBC', weight: 'supportive' },
            { condition: 'Sepsis', delta: 0.06, finding: 'Thrombocytopenia on CBC', weight: 'minor' },
            { condition: 'Tracheal Collapse', delta: -0.05, finding: 'Thrombocytopenia is not explained by tracheal collapse', weight: 'minor', penalty: true },
            { condition: 'Primary Bronchitis', delta: -0.05, finding: 'Thrombocytopenia is not explained by bronchitis', weight: 'minor', penalty: true },
            { condition: 'Hypothyroidism', delta: -0.05, finding: 'Thrombocytopenia weakens hypothyroidism as primary cause', weight: 'minor', penalty: true },
        );
    }

    if (cbc.anemia_type === 'regenerative') {
        adjustments.push(
            { condition: 'Babesiosis', delta: 0.15, finding: 'Regenerative anaemia', weight: 'strong' },
            { condition: 'Immune-mediated haemolytic anaemia', delta: 0.12, finding: 'Regenerative anaemia', weight: 'strong' },
            { condition: 'Blood loss', delta: 0.10, finding: 'Regenerative anaemia', weight: 'supportive' },
            { condition: 'Haemobartonellosis', delta: 0.08, finding: 'Regenerative anaemia', weight: 'supportive' },
            { condition: 'Tracheal Collapse', delta: -0.05, finding: 'Regenerative anaemia weakens a pure airway diagnosis', weight: 'minor', penalty: true },
            { condition: 'Primary Bronchitis', delta: -0.05, finding: 'Regenerative anaemia weakens a pure airway diagnosis', weight: 'minor', penalty: true },
            { condition: 'Hypothyroidism', delta: -0.05, finding: 'Regenerative anaemia weakens hypothyroidism as primary cause', weight: 'minor', penalty: true },
        );
    }

    if (cbc.anemia_type === 'non_regenerative') {
        adjustments.push(
            { condition: 'Ehrlichiosis', delta: 0.10, finding: 'Non-regenerative anaemia', weight: 'supportive' },
            { condition: 'Chronic inflammatory disease', delta: 0.10, finding: 'Non-regenerative anaemia', weight: 'supportive' },
            { condition: 'Bone marrow suppression', delta: 0.08, finding: 'Non-regenerative anaemia', weight: 'supportive' },
            { condition: 'Leishmaniosis', delta: 0.07, finding: 'Non-regenerative anaemia', weight: 'supportive' },
            { condition: 'Babesiosis', delta: -0.08, finding: 'Non-regenerative anaemia weakens haemolytic protozoal disease', weight: 'minor', penalty: true },
            { condition: 'Immune-mediated haemolytic anaemia', delta: -0.08, finding: 'Non-regenerative anaemia weakens IMHA as primary cause', weight: 'minor', penalty: true },
        );
    }

    if (cbc.microfilaremia === 'present') {
        adjustments.push(
            { condition: 'Dirofilariosis', delta: 0.35, finding: 'Microfilaremia seen on direct smear', weight: 'definitive' },
            { condition: 'Acanthocheilonema infection', delta: 0.08, finding: 'Microfilariae seen on direct smear', weight: 'supportive' },
        );
    }

    if (cbc.lymphopenia === 'present') {
        adjustments.push(
            { condition: 'Parvoviral enteritis', delta: 0.15, finding: 'Lymphopenia on CBC', weight: 'strong' },
            { condition: 'Severe sepsis', delta: 0.10, finding: 'Lymphopenia on CBC', weight: 'supportive' },
            { condition: 'Hyperadrenocorticism', delta: 0.08, finding: 'Lymphopenia on CBC', weight: 'minor' },
            { condition: 'Stress leukogram', delta: 0.06, finding: 'Lymphopenia on CBC', weight: 'minor' },
        );
    }

    if (cbc.basophilia === 'present') {
        adjustments.push(
            { condition: 'Dirofilariosis', delta: 0.10, finding: 'Basophilia on CBC', weight: 'supportive' },
            { condition: 'Hypersensitivity reaction', delta: 0.08, finding: 'Basophilia on CBC', weight: 'supportive' },
        );
    }

    return adjustments;
}
