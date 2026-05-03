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
    weight: EvidenceWeight | 'weakens' | 'excludes';
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

    if (cbc.spherocytes === 'present' || cbc.spherocytosis === 'present') {
        adjustments.push(
            { condition_id: 'imha_canine', delta: 0.35, finding: 'Spherocytosis on blood smear - pathognomonic for immune-mediated RBC destruction in dogs', weight: 'definitive' },
            { condition_id: 'babesiosis_canine', delta: -0.15, finding: 'Spherocytosis is inconsistent with primary Babesia as sole mechanism', weight: 'weakens', penalty: true },
            { condition_id: 'microangiopathic_haemolytic_anaemia', delta: 0.08, finding: 'Spherocytes can occur in microangiopathic haemolysis', weight: 'supportive' },
        );
    }

    if (cbc.autoagglutination === 'positive') {
        adjustments.push(
            { condition_id: 'imha_canine', delta: 0.40, finding: 'Positive autoagglutination confirms antibody-mediated RBC clumping', weight: 'definitive' },
            { condition_id: 'evans_syndrome', delta: 0.12, finding: 'Autoagglutination raises Evans syndrome co-morbidity probability', weight: 'supportive' },
            { condition_id: 'babesiosis_canine', delta: -0.20, finding: 'Autoagglutination is a marker of immune-mediated rather than parasitic haemolysis', weight: 'weakens', penalty: true },
            { condition_id: 'ehrlichiosis_canine', delta: -0.10, finding: 'Autoagglutination is not characteristic of Ehrlichia-mediated anaemia', weight: 'weakens', penalty: true },
        );
    }

    if (cbc.anemia_type === 'regenerative' || cbc.reticulocytosis === 'elevated') {
        adjustments.push(
            { condition_id: 'imha_canine', delta: 0.18, finding: 'Regenerative anaemia indicates active bone marrow response to haemolysis', weight: 'strong' },
            { condition_id: 'babesiosis_canine', delta: 0.10, finding: 'Regenerative anaemia is consistent with haemolytic processes', weight: 'supportive' },
            { condition_id: 'haemangiosarcoma', delta: 0.08, finding: 'Regenerative anaemia can occur with haemorrhagic neoplasia', weight: 'minor' },
            { condition_id: 'iron_deficiency_anaemia', delta: -0.20, finding: 'Regenerative pattern excludes iron deficiency as primary cause', weight: 'excludes', penalty: true },
            { condition_id: 'anaemia_of_chronic_disease', delta: -0.15, finding: 'Regenerative pattern is inconsistent with chronic disease anaemia', weight: 'weakens', penalty: true },
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
            { condition_id: 'chronic_kidney_disease', delta: 0.18, finding: 'Non-regenerative anaemia raises EPO-deficient CKD as a driver', weight: 'strong' },
            { condition_id: 'anaemia_of_chronic_disease', delta: 0.14, finding: 'Non-regenerative pattern is consistent with chronic inflammatory anaemia', weight: 'supportive' },
            { condition_id: 'myelophthisic_anaemia', delta: 0.10, finding: 'Non-regenerative anaemia can indicate bone marrow infiltration', weight: 'supportive' },
            { condition_id: 'imha_canine', delta: -0.12, finding: 'Non-regenerative pattern is atypical for immune-mediated haemolysis', weight: 'weakens', penalty: true },
            { condition_id: 'babesiosis_canine', delta: -0.08, finding: 'Non-regenerative anaemia weakens acute haemolytic infection', weight: 'minor', penalty: true },
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

    if (cbc.leukocytosis === 'present' && cbc.neutrophilia === 'present') {
        adjustments.push(
            { condition_id: 'septic_peritonitis', delta: 0.12, finding: 'Leukocytosis with neutrophilia is consistent with bacterial sepsis', weight: 'supportive' },
            { condition_id: 'pyometra_canine_feline', delta: 0.14, finding: 'Leukocytosis with neutrophilia is characteristic of pyometra', weight: 'strong' },
            { condition_id: 'leptospirosis_canine', delta: 0.10, finding: 'Leukocytosis supports systemic infectious/inflammatory process', weight: 'supportive' },
            { condition_id: 'imha_canine', delta: 0.06, finding: 'Mild leukocytosis can occur as stress response in IMHA', weight: 'minor' },
        );
    }

    if (cbc.pancytopenia === 'present') {
        adjustments.push(
            { condition_id: 'ehrlichiosis_canine', delta: 0.22, finding: 'Pancytopenia is characteristic of chronic or severe Ehrlichia infection', weight: 'strong' },
            { condition_id: 'bone_marrow_suppression', delta: 0.18, finding: 'Pancytopenia raises primary bone marrow pathology', weight: 'strong' },
            { condition_id: 'aflatoxicosis', delta: 0.14, finding: 'Mycotoxin exposure can produce pancytopenia via marrow toxicity', weight: 'supportive' },
            { condition_id: 'feline_leukaemia_virus', delta: 0.12, finding: 'FeLV-associated myelosuppression produces pancytopenia', weight: 'supportive' },
        );
    }

    if (cbc.hyperproteinaemia === 'present' || cbc.hyperglobulinaemia === 'present') {
        adjustments.push(
            { condition_id: 'leishmaniosis_canine', delta: 0.20, finding: 'Hyperglobulinaemia with hypoalbuminaemia is characteristic of leishmaniosis', weight: 'strong' },
            { condition_id: 'feline_infectious_peritonitis', delta: 0.18, finding: 'Hyperproteinaemia with low albumin:globulin ratio supports FIP', weight: 'strong' },
            { condition_id: 'multiple_myeloma', delta: 0.10, finding: 'Monoclonal or marked hyperproteinaemia raises plasma cell neoplasia', weight: 'supportive' },
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
