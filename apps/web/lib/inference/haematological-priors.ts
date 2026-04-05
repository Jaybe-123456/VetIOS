import type {
    DifferentialBasis,
    DifferentialRelationship,
    EvidenceWeight,
    InferenceRequest,
} from './types';

export interface ScoreAdjustment {
    condition_id: string;
    delta: number;
    finding: string;
    weight: EvidenceWeight;
    penalty?: boolean;
    determination_basis?: DifferentialBasis;
    relationship_to_primary?: DifferentialRelationship;
}

export function applyHaematologicalPriors(request: InferenceRequest): ScoreAdjustment[] {
    const cbc = request.diagnostic_tests?.cbc;
    if (!cbc) return [];

    const adjustments: ScoreAdjustment[] = [];

    if (cbc.eosinophilia && cbc.eosinophilia !== 'absent') {
        adjustments.push(
            { condition_id: 'dirofilariosis_canine', delta: 0.12, finding: 'Eosinophilia on CBC', weight: 'supportive' },
            { condition_id: 'toxocariasis', delta: 0.10, finding: 'Eosinophilia on CBC', weight: 'supportive' },
            { condition_id: 'chronic_bronchitis_canine', delta: 0.08, finding: 'Eosinophilic airway inflammation remains possible', weight: 'minor' },
            { condition_id: 'hypoadrenocorticism_canine', delta: 0.05, finding: 'Eosinophilia on CBC', weight: 'minor' },
            { condition_id: 'leishmaniosis_canine', delta: 0.04, finding: 'Eosinophilia on CBC', weight: 'minor' },
            { condition_id: 'mast_cell_tumor', delta: 0.03, finding: 'Eosinophilia can occur with mast cell disease', weight: 'minor' },
            { condition_id: 'diabetes_mellitus_canine', delta: -0.08, finding: 'Eosinophilia weakens a metabolic-only explanation', weight: 'minor', penalty: true },
            { condition_id: 'hypothyroidism_canine', delta: -0.05, finding: 'Eosinophilia weakens hypothyroidism as a primary diagnosis', weight: 'minor', penalty: true },
            { condition_id: 'mitral_valve_disease_canine', delta: -0.04, finding: 'Eosinophilia weakens primary left-sided cardiac disease', weight: 'minor', penalty: true },
            { condition_id: 'dilated_cardiomyopathy_canine', delta: -0.04, finding: 'Eosinophilia weakens primary cardiomyopathy', weight: 'minor', penalty: true },
        );
    }

    if (cbc.eosinophilia === 'moderate' || cbc.eosinophilia === 'severe') {
        adjustments.push(
            { condition_id: 'dirofilariosis_canine', delta: 0.08, finding: 'Moderate-to-severe eosinophilia', weight: 'strong' },
            { condition_id: 'angiostrongylosis_canine', delta: 0.10, finding: 'Moderate-to-severe eosinophilia', weight: 'strong' },
        );
    }

    if (cbc.thrombocytopenia && cbc.thrombocytopenia !== 'absent') {
        adjustments.push(
            { condition_id: 'ehrlichiosis_canine', delta: 0.15, finding: 'Thrombocytopenia on CBC', weight: 'strong' },
            { condition_id: 'anaplasmosis_canine', delta: 0.15, finding: 'Thrombocytopenia on CBC', weight: 'strong' },
            { condition_id: 'babesiosis_canine', delta: 0.12, finding: 'Thrombocytopenia on CBC', weight: 'strong' },
            { condition_id: 'immune_mediated_thrombocytopenia', delta: 0.10, finding: 'Thrombocytopenia on CBC', weight: 'supportive' },
            { condition_id: 'leishmaniosis_canine', delta: 0.08, finding: 'Thrombocytopenia on CBC', weight: 'supportive' },
            { condition_id: 'leptospirosis', delta: 0.06, finding: 'Thrombocytopenia on CBC', weight: 'minor' },
            { condition_id: 'tracheal_collapse', delta: -0.05, finding: 'Thrombocytopenia is not explained by airway collapse', weight: 'minor', penalty: true },
            { condition_id: 'chronic_bronchitis_canine', delta: -0.05, finding: 'Thrombocytopenia is not explained by primary bronchitis', weight: 'minor', penalty: true },
        );
    }

    if (cbc.anemia_type === 'regenerative') {
        adjustments.push(
            { condition_id: 'babesiosis_canine', delta: 0.15, finding: 'Regenerative anaemia', weight: 'strong' },
            { condition_id: 'immune_mediated_hemolytic_anemia', delta: 0.12, finding: 'Regenerative anaemia', weight: 'strong' },
            { condition_id: 'hookworm_infection', delta: 0.10, finding: 'Regenerative anaemia', weight: 'supportive' },
            { condition_id: 'mycoplasma_infections', delta: 0.08, finding: 'Regenerative anaemia', weight: 'supportive' },
            { condition_id: 'tracheal_collapse', delta: -0.05, finding: 'Regenerative anaemia weakens a pure airway diagnosis', weight: 'minor', penalty: true },
            { condition_id: 'chronic_bronchitis_canine', delta: -0.05, finding: 'Regenerative anaemia weakens a pure airway diagnosis', weight: 'minor', penalty: true },
        );
    }

    if (cbc.anemia_type === 'non_regenerative') {
        adjustments.push(
            { condition_id: 'ehrlichiosis_canine', delta: 0.10, finding: 'Non-regenerative anaemia', weight: 'supportive' },
            { condition_id: 'leishmaniosis_canine', delta: 0.07, finding: 'Non-regenerative anaemia', weight: 'supportive' },
            { condition_id: 'lymphoma', delta: 0.08, finding: 'Non-regenerative anaemia', weight: 'minor' },
            { condition_id: 'babesiosis_canine', delta: -0.08, finding: 'Non-regenerative anaemia weakens haemolytic protozoal disease', weight: 'minor', penalty: true },
            { condition_id: 'immune_mediated_hemolytic_anemia', delta: -0.08, finding: 'Non-regenerative anaemia weakens IMHA', weight: 'minor', penalty: true },
        );
    }

    if (cbc.microfilaremia === 'present') {
        adjustments.push(
            { condition_id: 'dirofilariosis_canine', delta: 0.35, finding: 'Microfilaremia seen on smear', weight: 'definitive' },
            { condition_id: 'acanthocheilonema_infection', delta: 0.08, finding: 'Microfilariae seen on smear', weight: 'supportive' },
        );
    }

    if (cbc.lymphopenia === 'present') {
        adjustments.push(
            { condition_id: 'parvoviral_enteritis', delta: 0.15, finding: 'Lymphopenia on CBC', weight: 'strong' },
            { condition_id: 'leptospirosis', delta: 0.10, finding: 'Lymphopenia on CBC', weight: 'minor' },
            { condition_id: 'hyperadrenocorticism_canine', delta: 0.08, finding: 'Lymphopenia on CBC', weight: 'minor' },
            { condition_id: 'canine_distemper', delta: 0.06, finding: 'Lymphopenia on CBC', weight: 'minor' },
        );
    }

    if (cbc.basophilia === 'present') {
        adjustments.push(
            { condition_id: 'dirofilariosis_canine', delta: 0.10, finding: 'Basophilia on CBC', weight: 'supportive' },
            { condition_id: 'allergic_hypersensitivity', delta: 0.08, finding: 'Basophilia on CBC', weight: 'supportive' },
        );
    }

    return adjustments;
}
