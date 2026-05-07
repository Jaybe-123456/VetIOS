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
    | 'microbiology';

export const ALL_SYSTEM_TYPES: readonly SystemType[] = [
    'haematology',
    'endocrine',
    'urinalysis',
    'serology',
    'biochemistry',
    'imaging',
    'cytology',
    'microbiology',
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

export interface PanelDefinition {
    system: SystemType;
    panel: string;
    label: string;
    tests: PanelTestDefinition[];
}

export interface SpeciesPanelEntry {
    system: SystemType;
    panel: string;
}

const BASE_PANEL_ENTRIES: SpeciesPanelEntry[] = [
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
    { system: 'cytology', panel: 'fine_needle_aspirate' },
    { system: 'microbiology', panel: 'culture_sensitivity' },
];

const EQUINE_SPECIFIC_PANEL_ENTRIES: SpeciesPanelEntry[] = [
    { system: 'serology', panel: 'coggins_test' },
    { system: 'biochemistry', panel: 'SAA' },
];

const AVIAN_REPTILE_DEFAULT_PANEL_ENTRIES: SpeciesPanelEntry[] = [
    { system: 'cytology', panel: 'cytology_avian' },
    { system: 'haematology', panel: 'haematology_avian' },
];

export const SPECIES_PANEL_MAP: Record<Species, SpeciesPanelEntry[]> = {
    canine: [...BASE_PANEL_ENTRIES],
    feline: BASE_PANEL_ENTRIES.filter((entry) => entry.panel !== 'heartworm_antigen'),
    equine: [...BASE_PANEL_ENTRIES, ...EQUINE_SPECIFIC_PANEL_ENTRIES],
    avian: [...AVIAN_REPTILE_DEFAULT_PANEL_ENTRIES],
    reptile: [...AVIAN_REPTILE_DEFAULT_PANEL_ENTRIES],
    exotic: [...BASE_PANEL_ENTRIES],
    bovine: [...BASE_PANEL_ENTRIES],
    ovine: [...BASE_PANEL_ENTRIES],
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
        tests: [
            { key: 'saa_level', label: 'SAA Level', type: 'select', options: LEVEL_OPTIONS },
            { key: 'saa_value', label: 'SAA Value', type: 'numeric', unit: 'mg/L' },
        ],
    },
    cytology_avian: {
        system: 'cytology',
        panel: 'cytology_avian',
        label: 'Avian/Reptile Cytology',
        tests: [
            { key: 'heterophils', label: 'Heterophils', type: 'select', options: LEVEL_OPTIONS },
            { key: 'toxic_changes', label: 'Toxic Changes', type: 'select', options: PRESENT_ABSENT_OPTIONS },
        ],
    },
    haematology_avian: {
        system: 'haematology',
        panel: 'haematology_avian',
        label: 'Avian/Reptile Haematology',
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

export interface EncounterPayloadV2 {
    patient: PatientV2;
    encounter: EncounterDataV2;
    active_system_panels: SystemPanel[];
    imaging: Record<string, TestValue>;
    metadata: EncounterMetadataV2;
}
