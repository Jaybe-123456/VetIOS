/**
 * VetIOS Encounter Payload V2.
 *
 * Shared multisystemic, species-gated panel types consumed by the API,
 * inference console UI, and simulation infrastructure.
 */

export type Species =
    | 'canine'
    | 'feline'
    | 'equine'
    | 'avian'
    | 'reptile'
    | 'exotic'
    | 'bovine'
    | 'ovine';

export const ALL_SPECIES: readonly Species[] = [
    'canine',
    'feline',
    'equine',
    'avian',
    'reptile',
    'exotic',
    'bovine',
    'ovine',
] as const;

export type SystemType =
    | 'haematology'
    | 'endocrine'
    | 'urinalysis'
    | 'serology'
    | 'biochemistry'
    | 'imaging'
    | 'cytology'
    | 'microbiology'
    | 'molecular'
    | 'parasitology';

export const ALL_SYSTEM_TYPES: readonly SystemType[] = [
    'haematology',
    'endocrine',
    'urinalysis',
    'serology',
    'biochemistry',
    'imaging',
    'cytology',
    'microbiology',
    'molecular',
    'parasitology',
] as const;

export type TestValue = 'positive' | 'negative' | 'equivocal' | 'not_done' | number | string;

export interface SystemPanel {
    system: SystemType;
    panel: string;
    tests: Record<string, TestValue>;
}

export interface PanelTestDefinition {
    key: string;
    label: string;
    type: 'select' | 'numeric' | 'text';
    options?: Array<{ value: string; label: string }>;
    unit?: string;
}

export type PanelSpeciesScope = 'companion' | 'equine' | 'ruminant' | 'avian_reptile' | 'exotic' | 'all';

export interface PanelDefinition {
    system: SystemType;
    panel: string;
    label: string;
    species_scope?: PanelSpeciesScope[];
    tests: PanelTestDefinition[];
}

export interface SpeciesPanelEntry {
    system: SystemType;
    panel: string;
}

const COMPANION_PANEL_ENTRIES: SpeciesPanelEntry[] = [
    { system: 'haematology', panel: 'CBC' },
    { system: 'haematology', panel: 'coagulation' },
    { system: 'endocrine', panel: 'adrenal' },
    { system: 'endocrine', panel: 'thyroid' },
    { system: 'urinalysis', panel: 'urinalysis' },
    { system: 'serology', panel: 'tick_borne' },
    { system: 'serology', panel: 'heartworm_antigen' },
    { system: 'serology', panel: 'leptospira' },
    { system: 'serology', panel: 'infectious' },
    { system: 'biochemistry', panel: 'renal' },
    { system: 'biochemistry', panel: 'hepatic' },
    { system: 'biochemistry', panel: 'electrolytes' },
    { system: 'biochemistry', panel: 'pancreatic' },
    { system: 'imaging', panel: 'thoracic_radiograph' },
    { system: 'imaging', panel: 'abdominal_ultrasound' },
    { system: 'imaging', panel: 'echocardiography' },
    { system: 'imaging', panel: 'neurologic_imaging' },
    { system: 'cytology', panel: 'fine_needle_aspirate' },
    { system: 'cytology', panel: 'effusion_analysis' },
    { system: 'microbiology', panel: 'culture_sensitivity' },
    { system: 'molecular', panel: 'pcr_panel' },
    { system: 'parasitology', panel: 'fecal_parasitology' },
    { system: 'parasitology', panel: 'skin_parasitology' },
];

const EQUINE_PANEL_ENTRIES: SpeciesPanelEntry[] = [
    { system: 'haematology', panel: 'CBC' },
    { system: 'haematology', panel: 'coagulation' },
    { system: 'biochemistry', panel: 'renal' },
    { system: 'biochemistry', panel: 'hepatic' },
    { system: 'biochemistry', panel: 'electrolytes' },
    { system: 'biochemistry', panel: 'SAA' },
    { system: 'imaging', panel: 'thoracic_radiograph' },
    { system: 'imaging', panel: 'abdominal_ultrasound' },
    { system: 'imaging', panel: 'echocardiography' },
    { system: 'imaging', panel: 'neurologic_imaging' },
    { system: 'cytology', panel: 'fine_needle_aspirate' },
    { system: 'cytology', panel: 'effusion_analysis' },
    { system: 'microbiology', panel: 'culture_sensitivity' },
    { system: 'molecular', panel: 'pcr_panel' },
    { system: 'parasitology', panel: 'fecal_parasitology' },
    { system: 'serology', panel: 'coggins_test' },
];

const AVIAN_REPTILE_DEFAULT_PANEL_ENTRIES: SpeciesPanelEntry[] = [
    { system: 'cytology', panel: 'cytology_avian' },
    { system: 'haematology', panel: 'haematology_avian' },
    { system: 'biochemistry', panel: 'electrolytes' },
    { system: 'microbiology', panel: 'culture_sensitivity' },
    { system: 'molecular', panel: 'pcr_panel' },
    { system: 'parasitology', panel: 'fecal_parasitology' },
];

const RUMINANT_PANEL_ENTRIES: SpeciesPanelEntry[] = [
    { system: 'haematology', panel: 'ruminant_haematology' },
    { system: 'biochemistry', panel: 'ruminant_metabolic' },
    { system: 'biochemistry', panel: 'electrolytes' },
    { system: 'urinalysis', panel: 'urinalysis' },
    { system: 'serology', panel: 'ruminant_herd_infectious' },
    { system: 'microbiology', panel: 'ruminant_mastitis_milk' },
    { system: 'microbiology', panel: 'culture_sensitivity' },
    { system: 'molecular', panel: 'ruminant_pcr' },
    { system: 'parasitology', panel: 'ruminant_parasitology' },
    { system: 'imaging', panel: 'ruminant_rumen_abdominal' },
    { system: 'haematology', panel: 'neonatal_calf_panel' },
];

const EXOTIC_PANEL_ENTRIES: SpeciesPanelEntry[] = [
    ...AVIAN_REPTILE_DEFAULT_PANEL_ENTRIES,
    { system: 'haematology', panel: 'CBC' },
    { system: 'biochemistry', panel: 'renal' },
    { system: 'biochemistry', panel: 'hepatic' },
    { system: 'cytology', panel: 'fine_needle_aspirate' },
    { system: 'microbiology', panel: 'culture_sensitivity' },
    { system: 'parasitology', panel: 'skin_parasitology' },
];

export const SPECIES_PANEL_MAP: Record<Species, SpeciesPanelEntry[]> = {
    canine: [...COMPANION_PANEL_ENTRIES],
    feline: COMPANION_PANEL_ENTRIES.filter((entry) => entry.panel !== 'heartworm_antigen'),
    equine: [...EQUINE_PANEL_ENTRIES],
    avian: [...AVIAN_REPTILE_DEFAULT_PANEL_ENTRIES],
    reptile: [...AVIAN_REPTILE_DEFAULT_PANEL_ENTRIES],
    exotic: [...EXOTIC_PANEL_ENTRIES],
    bovine: [...RUMINANT_PANEL_ENTRIES],
    ovine: [...RUMINANT_PANEL_ENTRIES],
};

const QUALITATIVE_OPTIONS = [
    { value: 'not_done', label: 'Not done' },
    { value: 'positive', label: 'Positive' },
    { value: 'negative', label: 'Negative' },
    { value: 'equivocal', label: 'Equivocal' },
];

const PRESENT_ABSENT_OPTIONS = [
    { value: 'not_done', label: 'Not done' },
    { value: 'present', label: 'Present' },
    { value: 'absent', label: 'Absent' },
];

const SEVERITY_OPTIONS = [
    { value: 'not_done', label: 'Not done' },
    { value: 'absent', label: 'Absent' },
    { value: 'mild', label: 'Mild' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'severe', label: 'Severe' },
];

const LEVEL_OPTIONS = [
    { value: 'not_done', label: 'Not done' },
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'elevated', label: 'Elevated' },
];

export const PANEL_TEST_DEFINITIONS: Record<string, PanelDefinition> = {
    CBC: {
        system: 'haematology',
        panel: 'CBC',
        label: 'Complete Blood Count',
        tests: [
            { key: 'spherocytes', label: 'Spherocytes', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'autoagglutination', label: 'Autoagglutination', type: 'select', options: QUALITATIVE_OPTIONS },
            {
                key: 'anemia_type',
                label: 'Anaemia Type',
                type: 'select',
                options: [
                    { value: 'not_done', label: 'Not done' },
                    { value: 'regenerative', label: 'Regenerative' },
                    { value: 'non_regenerative', label: 'Non-regenerative' },
                ],
            },
            {
                key: 'reticulocytosis',
                label: 'Reticulocytosis',
                type: 'select',
                options: [
                    { value: 'not_done', label: 'Not done' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'elevated', label: 'Elevated' },
                ],
            },
            { key: 'thrombocytopenia', label: 'Thrombocytopenia', type: 'select', options: SEVERITY_OPTIONS },
            { key: 'leukocytosis', label: 'Leukocytosis', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'neutrophilia', label: 'Neutrophilia', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'eosinophilia', label: 'Eosinophilia', type: 'select', options: SEVERITY_OPTIONS },
            { key: 'pancytopenia', label: 'Pancytopenia', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'packed_cell_volume_percent', label: 'PCV', type: 'numeric', unit: '%' },
        ],
    },
    coagulation: {
        system: 'haematology',
        panel: 'coagulation',
        label: 'Coagulation Panel',
        tests: [
            { key: 'pt', label: 'PT', type: 'select', options: LEVEL_OPTIONS },
            { key: 'aptt', label: 'aPTT', type: 'select', options: LEVEL_OPTIONS },
            { key: 'fibrinogen', label: 'Fibrinogen', type: 'select', options: LEVEL_OPTIONS },
            { key: 'd_dimer', label: 'D-Dimer', type: 'select', options: LEVEL_OPTIONS },
        ],
    },
    adrenal: {
        system: 'endocrine',
        panel: 'adrenal',
        label: 'Adrenal Panel',
        tests: [
            {
                key: 'acth_stimulation',
                label: 'ACTH Stimulation',
                type: 'select',
                options: [
                    { value: 'not_done', label: 'Not done' },
                    { value: 'blunted', label: 'Blunted / flat' },
                    { value: 'normal_response', label: 'Normal response' },
                    { value: 'exaggerated', label: 'Exaggerated' },
                ],
            },
            { key: 'sodium_potassium_ratio', label: 'Na:K Ratio', type: 'numeric', unit: 'ratio' },
            { key: 'cortisol_baseline', label: 'Baseline Cortisol', type: 'select', options: LEVEL_OPTIONS },
            { key: 'lddt', label: 'LDDT', type: 'select', options: QUALITATIVE_OPTIONS },
        ],
    },
    thyroid: {
        system: 'endocrine',
        panel: 'thyroid',
        label: 'Thyroid Panel',
        tests: [
            { key: 'total_t4', label: 'Total T4', type: 'select', options: LEVEL_OPTIONS },
            { key: 'free_t4', label: 'Free T4', type: 'select', options: LEVEL_OPTIONS },
            { key: 'tsh', label: 'TSH', type: 'select', options: LEVEL_OPTIONS },
        ],
    },
    urinalysis: {
        system: 'urinalysis',
        panel: 'urinalysis',
        label: 'Urinalysis',
        tests: [
            { key: 'glucose_in_urine', label: 'Glucose', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'hemoglobinuria', label: 'Haemoglobinuria', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'bilirubinuria', label: 'Bilirubinuria', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'proteinuria', label: 'Proteinuria', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'usg', label: 'USG', type: 'numeric' },
            { key: 'upc', label: 'UPC Ratio', type: 'numeric', unit: 'ratio' },
        ],
    },
    tick_borne: {
        system: 'serology',
        panel: 'tick_borne',
        label: 'Tick-Borne Disease Panel',
        tests: [
            { key: 'ehrlichia', label: 'Ehrlichia', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'anaplasma', label: 'Anaplasma', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'borrelia', label: 'Borrelia (Lyme)', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'babesia', label: 'Babesia', type: 'select', options: QUALITATIVE_OPTIONS },
        ],
    },
    heartworm_antigen: {
        system: 'serology',
        panel: 'heartworm_antigen',
        label: 'Heartworm Antigen',
        tests: [
            { key: 'heartworm_antigen', label: 'Heartworm Ag', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'microfilaremia', label: 'Microfilaremia', type: 'select', options: PRESENT_ABSENT_OPTIONS },
        ],
    },
    leptospira: {
        system: 'serology',
        panel: 'leptospira',
        label: 'Leptospira MAT',
        tests: [
            { key: 'mat_leptospira', label: 'MAT Result', type: 'select', options: QUALITATIVE_OPTIONS },
        ],
    },
    infectious: {
        system: 'serology',
        panel: 'infectious',
        label: 'Infectious Panel',
        tests: [
            {
                key: 'fcov_antibody_titre',
                label: 'FCoV Ab Titre',
                type: 'select',
                options: [
                    { value: 'not_done', label: 'Not done' },
                    { value: 'negative', label: 'Negative' },
                    { value: 'high_positive', label: 'High positive' },
                ],
            },
            { key: 'distemper_antigen', label: 'Distemper Ag', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'leishmania_serology', label: 'Leishmania', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'coombs_test', label: 'Coombs Test', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'saline_agglutination', label: 'Saline Agglutination', type: 'select', options: QUALITATIVE_OPTIONS },
        ],
    },
    renal: {
        system: 'biochemistry',
        panel: 'renal',
        label: 'Renal Panel',
        tests: [
            { key: 'bun', label: 'BUN', type: 'select', options: LEVEL_OPTIONS },
            { key: 'creatinine', label: 'Creatinine', type: 'select', options: LEVEL_OPTIONS },
            { key: 'sdma', label: 'SDMA', type: 'select', options: LEVEL_OPTIONS },
            { key: 'phosphorus', label: 'Phosphorus', type: 'select', options: LEVEL_OPTIONS },
            { key: 'albumin', label: 'Albumin', type: 'select', options: LEVEL_OPTIONS },
        ],
    },
    hepatic: {
        system: 'biochemistry',
        panel: 'hepatic',
        label: 'Hepatic Panel',
        tests: [
            { key: 'alt', label: 'ALT', type: 'select', options: LEVEL_OPTIONS },
            { key: 'alp', label: 'ALP', type: 'select', options: LEVEL_OPTIONS },
            { key: 'ggt', label: 'GGT', type: 'select', options: LEVEL_OPTIONS },
            { key: 'bilirubin', label: 'Bilirubin', type: 'select', options: LEVEL_OPTIONS },
            { key: 'albumin', label: 'Albumin', type: 'select', options: LEVEL_OPTIONS },
        ],
    },
    electrolytes: {
        system: 'biochemistry',
        panel: 'electrolytes',
        label: 'Electrolytes',
        tests: [
            { key: 'sodium', label: 'Sodium', type: 'numeric', unit: 'mmol/L' },
            { key: 'potassium', label: 'Potassium', type: 'numeric', unit: 'mmol/L' },
            { key: 'chloride', label: 'Chloride', type: 'numeric', unit: 'mmol/L' },
            { key: 'calcium', label: 'Calcium', type: 'select', options: LEVEL_OPTIONS },
        ],
    },
    pancreatic: {
        system: 'biochemistry',
        panel: 'pancreatic',
        label: 'Pancreatic Panel',
        tests: [
            {
                key: 'pancreatic_lipase',
                label: 'Pancreatic Lipase (cPLI/fPLI)',
                type: 'select',
                options: [
                    { value: 'not_done', label: 'Not done' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'elevated', label: 'Elevated' },
                    { value: 'markedly_elevated', label: 'Markedly elevated' },
                ],
            },
            { key: 'amylase', label: 'Amylase', type: 'select', options: LEVEL_OPTIONS },
            { key: 'glucose', label: 'Glucose', type: 'select', options: LEVEL_OPTIONS },
        ],
    },
    thoracic_radiograph: {
        system: 'imaging',
        panel: 'thoracic_radiograph',
        label: 'Thoracic Radiograph',
        tests: [
            { key: 'cardiomegaly', label: 'Cardiomegaly', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'pleural_effusion', label: 'Pleural Effusion', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'pulmonary_artery_enlargement', label: 'Pulmonary Artery Enlargement', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'pulmonary_infiltrates', label: 'Pulmonary Infiltrates', type: 'select', options: PRESENT_ABSENT_OPTIONS },
        ],
    },
    abdominal_ultrasound: {
        system: 'imaging',
        panel: 'abdominal_ultrasound',
        label: 'Abdominal Ultrasound',
        tests: [
            { key: 'hepatomegaly', label: 'Hepatomegaly', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'splenomegaly', label: 'Splenomegaly', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'free_fluid', label: 'Free Fluid', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'uterine_distension', label: 'Uterine Distension', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'renal_changes', label: 'Renal Changes', type: 'select', options: PRESENT_ABSENT_OPTIONS },
        ],
    },
    echocardiography: {
        system: 'imaging',
        panel: 'echocardiography',
        label: 'Echocardiography',
        tests: [
            { key: 'worms_visualised', label: 'Worms Visualised', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'pulmonary_hypertension', label: 'Pulmonary Hypertension', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'right_heart_enlargement', label: 'Right Heart Enlargement', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'left_heart_enlargement', label: 'Left Heart Enlargement', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'pericardial_effusion', label: 'Pericardial Effusion', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'reduced_contractility', label: 'Reduced Contractility', type: 'select', options: PRESENT_ABSENT_OPTIONS },
        ],
    },
    neurologic_imaging: {
        system: 'imaging',
        panel: 'neurologic_imaging',
        label: 'Neurologic Imaging',
        tests: [
            { key: 'ivdd_compression', label: 'IVDD Compression', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'intracranial_mass', label: 'Intracranial Mass', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'meningeal_enhancement', label: 'Meningeal Enhancement', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'spinal_fracture_luxation', label: 'Spinal Fracture/Luxation', type: 'select', options: PRESENT_ABSENT_OPTIONS },
        ],
    },
    fine_needle_aspirate: {
        system: 'cytology',
        panel: 'fine_needle_aspirate',
        label: 'Fine Needle Aspirate',
        tests: [
            {
                key: 'cellularity',
                label: 'Cellularity',
                type: 'select',
                options: [
                    { value: 'not_done', label: 'Not done' },
                    { value: 'low', label: 'Low' },
                    { value: 'moderate', label: 'Moderate' },
                    { value: 'high', label: 'High' },
                ],
            },
            {
                key: 'malignancy',
                label: 'Malignancy Suspicion',
                type: 'select',
                options: [
                    { value: 'not_done', label: 'Not done' },
                    { value: 'benign', label: 'Benign' },
                    { value: 'suspicious', label: 'Suspicious' },
                    { value: 'malignant', label: 'Malignant' },
                ],
            },
        ],
    },
    effusion_analysis: {
        system: 'cytology',
        panel: 'effusion_analysis',
        label: 'Effusion Analysis',
        tests: [
            { key: 'abdominal_fluid_bacteria', label: 'Intracellular Bacteria', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'effusion_rivalta', label: 'Rivalta Test', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'septic_exudate', label: 'Septic Exudate', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'chylous_effusion', label: 'Chylous Effusion', type: 'select', options: PRESENT_ABSENT_OPTIONS },
        ],
    },
    culture_sensitivity: {
        system: 'microbiology',
        panel: 'culture_sensitivity',
        label: 'Culture and Sensitivity',
        tests: [
            {
                key: 'growth',
                label: 'Growth',
                type: 'select',
                options: [
                    { value: 'not_done', label: 'Not done' },
                    { value: 'no_growth', label: 'No growth' },
                    { value: 'light', label: 'Light' },
                    { value: 'moderate', label: 'Moderate' },
                    { value: 'heavy', label: 'Heavy' },
                ],
            },
            { key: 'organism', label: 'Organism', type: 'text' },
            { key: 'sensitivity_pattern', label: 'Sensitivity Pattern', type: 'text' },
        ],
    },
    pcr_panel: {
        system: 'molecular',
        panel: 'pcr_panel',
        label: 'PCR / Molecular Panel',
        tests: [
            { key: 'parvovirus_pcr', label: 'Parvovirus PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'ehrlichia_pcr', label: 'Ehrlichia PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'anaplasma_pcr', label: 'Anaplasma PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'leishmania_pcr', label: 'Leishmania PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'leptospira_pcr', label: 'Leptospira PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'toxoplasma_pcr', label: 'Toxoplasma PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'neospora_pcr', label: 'Neospora PCR', type: 'select', options: QUALITATIVE_OPTIONS },
        ],
    },
    fecal_parasitology: {
        system: 'parasitology',
        panel: 'fecal_parasitology',
        label: 'Fecal Parasitology',
        tests: [
            { key: 'fecal_flotation', label: 'Fecal Flotation Findings', type: 'text' },
            { key: 'fecal_direct_smear', label: 'Direct Smear Findings', type: 'text' },
            { key: 'modified_baermann', label: 'Baermann', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'giardia_antigen', label: 'Giardia Antigen', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'coccidia_seen', label: 'Coccidia Seen', type: 'select', options: PRESENT_ABSENT_OPTIONS },
        ],
    },
    skin_parasitology: {
        system: 'parasitology',
        panel: 'skin_parasitology',
        label: 'Skin Parasitology',
        tests: [
            { key: 'skin_scrape', label: 'Skin Scrape', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'demodex_seen', label: 'Demodex Seen', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'sarcoptes_seen', label: 'Sarcoptes Seen', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'dermatophyte_culture', label: 'Dermatophyte Culture', type: 'select', options: QUALITATIVE_OPTIONS },
        ],
    },
    coggins_test: {
        system: 'serology',
        panel: 'coggins_test',
        label: 'Coggins Test (EIA)',
        tests: [
            { key: 'coggins_result', label: 'Coggins Result', type: 'select', options: QUALITATIVE_OPTIONS },
        ],
    },
    SAA: {
        system: 'biochemistry',
        panel: 'SAA',
        label: 'Serum Amyloid A',
        species_scope: ['equine'],
        tests: [
            { key: 'saa_level', label: 'SAA Level', type: 'select', options: LEVEL_OPTIONS },
            { key: 'saa_value', label: 'SAA Value', type: 'numeric', unit: 'mg/L' },
        ],
    },
    ruminant_haematology: {
        system: 'haematology',
        panel: 'ruminant_haematology',
        label: 'Ruminant Haematology',
        species_scope: ['ruminant'],
        tests: [
            { key: 'packed_cell_volume_percent', label: 'PCV', type: 'numeric', unit: '%' },
            { key: 'fibrinogen', label: 'Fibrinogen', type: 'select', options: LEVEL_OPTIONS },
            { key: 'total_plasma_protein', label: 'Total Plasma Protein', type: 'select', options: LEVEL_OPTIONS },
            { key: 'left_shift', label: 'Left Shift', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'toxic_neutrophils', label: 'Toxic Neutrophils', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'haemoparasites_seen', label: 'Hemoparasites Seen', type: 'text' },
        ],
    },
    ruminant_metabolic: {
        system: 'biochemistry',
        panel: 'ruminant_metabolic',
        label: 'Ruminant Metabolic / Mineral',
        species_scope: ['ruminant'],
        tests: [
            { key: 'bhba', label: 'BHBA', type: 'select', options: LEVEL_OPTIONS },
            { key: 'nefa', label: 'NEFA', type: 'select', options: LEVEL_OPTIONS },
            { key: 'calcium', label: 'Calcium', type: 'select', options: LEVEL_OPTIONS },
            { key: 'magnesium', label: 'Magnesium', type: 'select', options: LEVEL_OPTIONS },
            { key: 'phosphorus', label: 'Phosphorus', type: 'select', options: LEVEL_OPTIONS },
            { key: 'glucose', label: 'Glucose', type: 'select', options: LEVEL_OPTIONS },
            { key: 'ast', label: 'AST', type: 'select', options: LEVEL_OPTIONS },
            { key: 'ggt', label: 'GGT', type: 'select', options: LEVEL_OPTIONS },
        ],
    },
    ruminant_herd_infectious: {
        system: 'serology',
        panel: 'ruminant_herd_infectious',
        label: 'Ruminant Herd Infectious',
        species_scope: ['ruminant'],
        tests: [
            { key: 'bvd_antigen', label: 'BVD Antigen', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'johnes_elisa', label: 'Johne ELISA', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'brucella_screen', label: 'Brucella Screen', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'leptospira_mat', label: 'Leptospira MAT', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'fmd_screen', label: 'FMD Screen', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'lumpy_skin_disease_pcr', label: 'Lumpy Skin Disease PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'theileria_screen', label: 'Theileria Screen', type: 'select', options: QUALITATIVE_OPTIONS },
        ],
    },
    ruminant_mastitis_milk: {
        system: 'microbiology',
        panel: 'ruminant_mastitis_milk',
        label: 'Mastitis / Milk Quality',
        species_scope: ['ruminant'],
        tests: [
            { key: 'california_mastitis_test', label: 'CMT', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'somatic_cell_count', label: 'Somatic Cell Count', type: 'numeric', unit: 'cells/mL' },
            { key: 'milk_culture_growth', label: 'Milk Culture Growth', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'milk_gram_stain', label: 'Milk Gram Stain', type: 'text' },
            { key: 'bulk_tank_scc', label: 'Bulk Tank SCC', type: 'numeric', unit: 'cells/mL' },
            { key: 'organism', label: 'Organism', type: 'text' },
            { key: 'antimicrobial_susceptibility', label: 'Susceptibility Pattern', type: 'text' },
        ],
    },
    ruminant_pcr: {
        system: 'molecular',
        panel: 'ruminant_pcr',
        label: 'Ruminant PCR / Molecular',
        species_scope: ['ruminant'],
        tests: [
            { key: 'bvd_pcr', label: 'BVD PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'theileria_pcr', label: 'Theileria PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'anaplasma_marginale_pcr', label: 'Anaplasma marginale PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'mycoplasma_bovis_pcr', label: 'Mycoplasma bovis PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'salmonella_pcr', label: 'Salmonella PCR', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'coxiella_burnetii_pcr', label: 'Coxiella burnetii PCR', type: 'select', options: QUALITATIVE_OPTIONS },
        ],
    },
    ruminant_parasitology: {
        system: 'parasitology',
        panel: 'ruminant_parasitology',
        label: 'Ruminant Parasitology',
        species_scope: ['ruminant'],
        tests: [
            { key: 'fecal_egg_count', label: 'Fecal Egg Count', type: 'numeric', unit: 'EPG' },
            { key: 'coccidia_oocysts', label: 'Coccidia Oocysts', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'liver_fluke', label: 'Liver Fluke', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'lungworm_baermann', label: 'Lungworm Baermann', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'haemonchus_risk', label: 'Haemonchus Risk / FAMACHA', type: 'select', options: SEVERITY_OPTIONS },
        ],
    },
    ruminant_rumen_abdominal: {
        system: 'imaging',
        panel: 'ruminant_rumen_abdominal',
        label: 'Rumen / Abdominal Assessment',
        species_scope: ['ruminant'],
        tests: [
            { key: 'rumen_ph', label: 'Rumen pH', type: 'numeric' },
            { key: 'forestomach_motility', label: 'Forestomach Motility', type: 'select', options: LEVEL_OPTIONS },
            { key: 'left_displaced_abomasum_ping', label: 'LDA Ping', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'right_abdominal_ping', label: 'Right Abdominal Ping', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'abdominal_free_fluid', label: 'Abdominal Free Fluid', type: 'select', options: PRESENT_ABSENT_OPTIONS },
            { key: 'traumatic_reticuloperitonitis_signs', label: 'Hardware Disease Signs', type: 'select', options: PRESENT_ABSENT_OPTIONS },
        ],
    },
    neonatal_calf_panel: {
        system: 'haematology',
        panel: 'neonatal_calf_panel',
        label: 'Neonatal Calf / Small Ruminant',
        species_scope: ['ruminant'],
        tests: [
            { key: 'serum_total_protein', label: 'Serum Total Protein', type: 'numeric', unit: 'g/dL' },
            { key: 'igg_transfer_status', label: 'IgG / Transfer Status', type: 'select', options: LEVEL_OPTIONS },
            { key: 'blood_glucose', label: 'Blood Glucose', type: 'select', options: LEVEL_OPTIONS },
            { key: 'dehydration_severity', label: 'Dehydration Severity', type: 'select', options: SEVERITY_OPTIONS },
            { key: 'cryptosporidium', label: 'Cryptosporidium', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'rotavirus_coronavirus', label: 'Rota/Corona', type: 'select', options: QUALITATIVE_OPTIONS },
            { key: 'e_coli_k99', label: 'E. coli K99', type: 'select', options: QUALITATIVE_OPTIONS },
        ],
    },
    cytology_avian: {
        system: 'cytology',
        panel: 'cytology_avian',
        label: 'Avian/Reptile Cytology',
        species_scope: ['avian_reptile', 'exotic'],
        tests: [
            { key: 'heterophils', label: 'Heterophils', type: 'select', options: LEVEL_OPTIONS },
            { key: 'toxic_changes', label: 'Toxic Changes', type: 'select', options: PRESENT_ABSENT_OPTIONS },
        ],
    },
    haematology_avian: {
        system: 'haematology',
        panel: 'haematology_avian',
        label: 'Avian/Reptile Haematology',
        species_scope: ['avian_reptile', 'exotic'],
        tests: [
            { key: 'pcv', label: 'PCV', type: 'numeric', unit: '%' },
            { key: 'heterophil_lymphocyte_ratio', label: 'H:L Ratio', type: 'numeric', unit: 'ratio' },
            { key: 'thrombocytes', label: 'Thrombocytes', type: 'select', options: LEVEL_OPTIONS },
        ],
    },
};

export type Sex = 'male_intact' | 'male_neutered' | 'female_intact' | 'female_spayed' | 'unknown';

export type MMColour = 'pink' | 'pale' | 'white' | 'yellow' | 'brick_red' | 'cyanotic' | 'muddy';

export interface PatientV2 {
    species: Species;
    breed: string;
    weight_kg: number | null;
    age_years: number | null;
    sex: Sex;
}

export interface VitalsV2 {
    temp_c: number | null;
    heart_rate_bpm: number | null;
    respiratory_rate_bpm: number | null;
    mm_colour: MMColour | null;
    crt_seconds: number | null;
}

export interface HistoryV2 {
    duration_days: number | null;
    free_text: string;
    medications: string[];
}

export interface EncounterDataV2 {
    presenting_complaints: string[];
    vitals: VitalsV2;
    history: HistoryV2;
}

export interface EncounterMetadataV2 {
    encounter_id: string;
    timestamp: string;
    clinician_id: string | null;
    clinic_id: string | null;
}

export interface DiagnosticAttachmentV2 {
    file_name?: string;
    mime_type: string;
    size_bytes?: number;
    content_base64: string;
}

export interface EncounterPayloadV2 {
    patient: PatientV2;
    encounter: EncounterDataV2;
    active_system_panels: SystemPanel[];
    imaging: Record<string, TestValue>;
    diagnostic_images?: DiagnosticAttachmentV2[];
    lab_results?: DiagnosticAttachmentV2[];
    metadata: EncounterMetadataV2;
}
