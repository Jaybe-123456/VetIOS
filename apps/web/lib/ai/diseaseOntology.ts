export type DiseaseDomain =
    | 'Neurological'
    | 'Hemoparasitic'
    | 'Parasitic'
    | 'Toxicology'
    | 'Endocrine'
    | 'Gastrointestinal'
    | 'Cardiopulmonary'
    | 'Renal'
    | 'Reproductive';

export type DiseaseProgression = 'acute' | 'chronic' | 'episodic' | 'hyperacute' | 'subacute';
export type DiseaseConditionClass =
    | 'Mechanical'
    | 'Infectious'
    | 'Toxic'
    | 'Neoplastic'
    | 'Autoimmune / Immune-Mediated'
    | 'Metabolic / Endocrine'
    | 'Traumatic'
    | 'Degenerative'
    | 'Idiopathic / Unknown';

export interface DiseaseFeatureWeight {
    term: string;
    weight: number;
}

export interface DiseaseOntologyEntry {
    id: string;
    name: string;
    aliases: string[];
    category: DiseaseDomain;
    subcategory: string;
    condition_class: DiseaseConditionClass;
    key_clinical_features: DiseaseFeatureWeight[];
    supporting_features: DiseaseFeatureWeight[];
    exclusion_features: DiseaseFeatureWeight[];
    lab_signatures: DiseaseFeatureWeight[];
    progression_pattern: DiseaseProgression[];
    species_relevance: string[];
    zoonotic: boolean;
    minimum_feature_match_threshold?: number;
    minimum_key_feature_matches?: number;
}

export interface OntologyObservationDefinition {
    term: string;
    aliases: string[];
    category: 'symptom' | 'exam' | 'lab' | 'exposure' | 'history' | 'reproductive';
}

export type SignalClassification =
    | 'anchor_signal'
    | 'contextual_signal'
    | 'generic_signal'
    | 'contradictory_signal';

export interface SignalHierarchyObservation {
    term: string;
    classification: SignalClassification;
    supportingDiseases: string[];
    supportingCategories: DiseaseDomain[];
}

export interface SignalAnchorLock {
    id: string;
    label: string;
    anchoredDiseases: string[];
    protectedCategories: DiseaseDomain[];
    matchedTerms: string[];
}

export interface ClosedWorldSignalHierarchy {
    classified_observations: SignalHierarchyObservation[];
    anchor_signals: string[];
    contextual_signals: string[];
    generic_signals: string[];
    contradictory_signals: string[];
    anchor_locks: SignalAnchorLock[];
    protected_categories: DiseaseDomain[];
    contradiction_score: number;
    generic_noise_score: number;
    missing_data_score: number;
    abstain_recommended: boolean;
}

export interface ClosedWorldCandidateScore {
    name: string;
    category: DiseaseDomain;
    subcategory: string;
    conditionClass: DiseaseConditionClass;
    rawScore: number;
    probability: number;
    matchedObservations: string[];
    keyMatchCount: number;
    supportingMatchCount: number;
    labMatchCount: number;
    anchorMatchCount: number;
    contextualMatchCount: number;
    genericMatchCount: number;
    contradictoryMatchCount: number;
    hierarchySupport: 'anchor_led' | 'context_led' | 'generic_led';
    penalties: {
        contradiction: number;
        generic_dominance: number;
        missing_support: number;
        ontology_mismatch: number;
    };
    anchorLocked: boolean;
    drivers: Array<{ feature: string; weight: number }>;
}

export interface ClosedWorldScoreResult {
    observations: string[];
    activeCategories: DiseaseDomain[];
    signalHierarchy: ClosedWorldSignalHierarchy;
    ranked: ClosedWorldCandidateScore[];
}

const f = (term: string, weight: number): DiseaseFeatureWeight => ({ term, weight });

export const DISEASE_CATEGORY_STRUCTURE: Record<DiseaseDomain, string[]> = {
    Neurological: ['Infectious', 'Immune-mediated', 'Structural', 'Toxic-metabolic', 'Idiopathic'],
    Hemoparasitic: ['Protozoal', 'Rickettsial', 'Vector-borne'],
    Parasitic: ['Endoparasites', 'Ectoparasites', 'Protozoal enteric'],
    Toxicology: ['Neurotoxic', 'Hemotoxic', 'Hepatotoxic', 'Drug-associated'],
    Endocrine: ['Glycemic', 'Adrenal', 'Thyroid'],
    Gastrointestinal: ['Mechanical', 'Inflammatory', 'Pancreatic', 'Septic'],
    Cardiopulmonary: ['Airway', 'Parenchymal', 'Cardiogenic'],
    Renal: ['Acute renal injury', 'Chronic renal disease', 'Lower urinary', 'Upper urinary'],
    Reproductive: ['Uterine', 'Parturition', 'Mammary'],
};

export const ONTOLOGY_OBSERVATION_DICTIONARY: OntologyObservationDefinition[] = [
    { term: 'retching_unproductive', aliases: ['non-productive retching', 'dry heaving'], category: 'symptom' },
    { term: 'vomiting', aliases: ['emesis', 'throwing up'], category: 'symptom' },
    { term: 'diarrhea', aliases: ['diarrhoea', 'loose stool'], category: 'symptom' },
    { term: 'hemorrhagic_diarrhea', aliases: ['bloody diarrhea', 'hematochezia'], category: 'symptom' },
    { term: 'melena', aliases: ['black stool', 'tarry stool'], category: 'symptom' },
    { term: 'hematemesis', aliases: ['vomiting blood', 'blood in vomit'], category: 'symptom' },
    { term: 'abdominal_distension', aliases: ['bloated belly', 'distended abdomen', 'bloat'], category: 'symptom' },
    { term: 'abdominal_pain', aliases: ['painful abdomen', 'belly pain', 'prayer position'], category: 'symptom' },
    { term: 'hypersalivation', aliases: ['drooling', 'ptyalism'], category: 'symptom' },
    { term: 'dysphagia', aliases: ['difficulty swallowing'], category: 'symptom' },
    { term: 'constipation', aliases: ['constipated'], category: 'symptom' },
    { term: 'tenesmus', aliases: ['straining to defecate'], category: 'symptom' },
    { term: 'cough', aliases: ['coughing'], category: 'symptom' },
    { term: 'honking_cough', aliases: ['goose honk cough'], category: 'symptom' },
    { term: 'dyspnea', aliases: ['difficulty breathing', 'trouble breathing'], category: 'symptom' },
    { term: 'respiratory_distress', aliases: ['labored breathing', 'struggling to breathe'], category: 'symptom' },
    { term: 'tachypnea', aliases: ['rapid breathing', 'breathing fast'], category: 'symptom' },
    { term: 'orthopnea', aliases: ['won t lie down to breathe'], category: 'symptom' },
    { term: 'open_mouth_breathing', aliases: ['mouth open breathing'], category: 'symptom' },
    { term: 'exercise_intolerance', aliases: ['tires quickly'], category: 'symptom' },
    { term: 'syncope', aliases: ['fainting'], category: 'symptom' },
    { term: 'seizures', aliases: ['convulsions', 'fits'], category: 'symptom' },
    { term: 'myoclonus', aliases: ['muscle twitching'], category: 'symptom' },
    { term: 'tremors', aliases: ['shaking'], category: 'symptom' },
    { term: 'ataxia', aliases: ['staggering', 'wobbly gait'], category: 'symptom' },
    { term: 'head_tilt', aliases: ['tilting head'], category: 'symptom' },
    { term: 'circling', aliases: ['walking in circles'], category: 'symptom' },
    { term: 'paresis', aliases: ['partial paralysis'], category: 'symptom' },
    { term: 'paralysis', aliases: ['paralyzed'], category: 'symptom' },
    { term: 'disorientation', aliases: ['confused'], category: 'symptom' },
    { term: 'mentation_change', aliases: ['altered mentation', 'obtunded'], category: 'symptom' },
    { term: 'nystagmus', aliases: ['rapid eye movements'], category: 'symptom' },
    { term: 'proprioceptive_deficits', aliases: ['knuckling'], category: 'symptom' },
    { term: 'aggression', aliases: ['aggressive behavior'], category: 'symptom' },
    { term: 'hyperesthesia', aliases: ['marked sensitivity'], category: 'symptom' },
    { term: 'neck_pain', aliases: ['cervical pain'], category: 'symptom' },
    { term: 'muscle_rigidity', aliases: ['rigid muscles'], category: 'symptom' },
    { term: 'jaw_rigidity', aliases: ['lockjaw'], category: 'symptom' },
    { term: 'head_pressing', aliases: ['pressing head against wall'], category: 'symptom' },
    { term: 'weakness', aliases: ['weak'], category: 'symptom' },
    { term: 'collapse', aliases: ['collapsed'], category: 'symptom' },
    { term: 'lethargy', aliases: ['listless', 'low energy'], category: 'symptom' },
    { term: 'anorexia', aliases: ['not eating', 'loss of appetite'], category: 'symptom' },
    { term: 'fever', aliases: ['pyrexia', 'febrile'], category: 'exam' },
    { term: 'dehydration', aliases: ['dehydrated'], category: 'exam' },
    { term: 'pale_mucous_membranes', aliases: ['pale gums', 'white gums'], category: 'exam' },
    { term: 'cyanosis', aliases: ['blue gums'], category: 'exam' },
    { term: 'tachycardia', aliases: ['rapid heart rate'], category: 'exam' },
    { term: 'bradycardia', aliases: ['slow heart rate'], category: 'exam' },
    { term: 'arrhythmia', aliases: ['irregular heartbeat'], category: 'exam' },
    { term: 'heart_murmur', aliases: ['murmur'], category: 'exam' },
    { term: 'pneumonia', aliases: ['lung infection'], category: 'exam' },
    { term: 'pulmonary_edema', aliases: ['fluid in lungs'], category: 'exam' },
    { term: 'pleural_effusion', aliases: ['fluid in chest'], category: 'exam' },
    { term: 'edema', aliases: ['pitting edema'], category: 'exam' },
    { term: 'lymphadenopathy', aliases: ['swollen lymph nodes'], category: 'exam' },
    { term: 'icterus', aliases: ['jaundice'], category: 'exam' },
    { term: 'ascites', aliases: ['fluid belly'], category: 'exam' },
    { term: 'petechiae', aliases: ['small red spots'], category: 'exam' },
    { term: 'ecchymosis', aliases: ['bruising'], category: 'exam' },
    { term: 'pruritus', aliases: ['itching', 'itchy'], category: 'symptom' },
    { term: 'alopecia', aliases: ['hair loss'], category: 'symptom' },
    { term: 'skin_crusting', aliases: ['crusted skin'], category: 'symptom' },
    { term: 'worms_in_stool', aliases: ['visible worms'], category: 'symptom' },
    { term: 'scooting', aliases: ['dragging bottom'], category: 'symptom' },
    { term: 'weight_loss', aliases: ['lost weight'], category: 'symptom' },
    { term: 'polyuria', aliases: ['urinating a lot'], category: 'symptom' },
    { term: 'polydipsia', aliases: ['drinking a lot', 'very thirsty'], category: 'symptom' },
    { term: 'polyphagia', aliases: ['always hungry'], category: 'symptom' },
    { term: 'panting', aliases: ['excessive panting'], category: 'symptom' },
    { term: 'pot_bellied_appearance', aliases: ['pot bellied', 'pendulous abdomen'], category: 'symptom' },
    { term: 'stranguria', aliases: ['straining to pee'], category: 'symptom' },
    { term: 'dysuria', aliases: ['painful urination'], category: 'symptom' },
    { term: 'pollakiuria', aliases: ['frequent urination'], category: 'symptom' },
    { term: 'hematuria', aliases: ['blood in urine'], category: 'symptom' },
    { term: 'oliguria', aliases: ['reduced urine output'], category: 'symptom' },
    { term: 'anuria', aliases: ['no urine'], category: 'symptom' },
    { term: 'pyuria', aliases: ['pus in urine'], category: 'lab' },
    { term: 'anemia', aliases: ['anemic', 'low hematocrit', 'low pcv'], category: 'lab' },
    { term: 'thrombocytopenia', aliases: ['low platelets'], category: 'lab' },
    { term: 'hemoglobinuria', aliases: ['red urine from hemoglobin'], category: 'lab' },
    { term: 'azotemia', aliases: ['creatinine elevated', 'bun elevated'], category: 'lab' },
    { term: 'marked_alp_elevation', aliases: ['marked elevated alp'], category: 'lab' },
    { term: 'hypercholesterolemia', aliases: ['high cholesterol'], category: 'lab' },
    { term: 'supportive_acth_stimulation_test', aliases: ['positive acth stimulation test'], category: 'lab' },
    { term: 'dilute_urine', aliases: ['low urine specific gravity'], category: 'lab' },
    { term: 'significant_hyperglycemia', aliases: ['marked hyperglycemia'], category: 'lab' },
    { term: 'mild_hyperglycemia', aliases: ['mild hyperglycemia'], category: 'lab' },
    { term: 'glucosuria', aliases: ['glucose in urine'], category: 'lab' },
    { term: 'glucosuria_absent', aliases: ['no glucosuria'], category: 'lab' },
    { term: 'ketonuria', aliases: ['urine ketones'], category: 'lab' },
    { term: 'diabetic_metabolic_profile', aliases: ['diabetic metabolic profile'], category: 'lab' },
    { term: 'coagulopathy', aliases: ['prolonged clotting times'], category: 'lab' },
    { term: 'bleeding', aliases: ['active bleeding', 'hemorrhage'], category: 'symptom' },
    { term: 'hypoglycemia', aliases: ['low blood sugar'], category: 'lab' },
    { term: 'miosis', aliases: ['pinpoint pupils'], category: 'exam' },
    { term: 'foreign_body_exposure', aliases: ['ate a sock', 'swallowed string'], category: 'exposure' },
    { term: 'garbage_ingestion', aliases: ['got into trash'], category: 'exposure' },
    { term: 'recent_meal', aliases: ['after a meal'], category: 'history' },
    { term: 'acute_onset', aliases: ['started suddenly', 'abrupt onset'], category: 'history' },
    { term: 'gradual_onset', aliases: ['came on gradually'], category: 'history' },
    { term: 'chronic_duration', aliases: ['long-standing', 'chronic'], category: 'history' },
    { term: 'intermittent_course', aliases: ['comes and goes'], category: 'history' },
    { term: 'progressive_worsening', aliases: ['getting worse'], category: 'history' },
    { term: 'deep_chested_breed_risk', aliases: ['deep-chested breed risk'], category: 'history' },
    { term: 'tick_exposure', aliases: ['recent tick bite', 'ticks found'], category: 'exposure' },
    { term: 'tick_infestation', aliases: ['heavy tick burden'], category: 'exposure' },
    { term: 'flea_infestation', aliases: ['fleas found', 'flea dirt'], category: 'exposure' },
    { term: 'toxin_exposure_possible', aliases: ['possible poisoning'], category: 'exposure' },
    { term: 'rodenticide_exposure', aliases: ['rat poison'], category: 'exposure' },
    { term: 'medication_exposure', aliases: ['pill ingestion'], category: 'exposure' },
    { term: 'nsaid_exposure', aliases: ['ibuprofen ingestion'], category: 'exposure' },
    { term: 'ivermectin_exposure', aliases: ['horse dewormer ingestion'], category: 'exposure' },
    { term: 'plant_toxin_exposure', aliases: ['ate toxic plant'], category: 'exposure' },
    { term: 'organophosphate_exposure', aliases: ['pesticide exposure'], category: 'exposure' },
    { term: 'carbamate_exposure', aliases: ['carbamate exposure'], category: 'exposure' },
    { term: 'heavy_metal_exposure', aliases: ['lead exposure'], category: 'exposure' },
    { term: 'aflatoxin_exposure', aliases: ['moldy feed'], category: 'exposure' },
    { term: 'intact_female', aliases: ['unspayed female'], category: 'reproductive' },
    { term: 'pregnant', aliases: ['pregnant'], category: 'reproductive' },
    { term: 'postpartum', aliases: ['recently gave birth'], category: 'reproductive' },
    { term: 'recent_estrus', aliases: ['recent heat cycle'], category: 'reproductive' },
    { term: 'vaginal_discharge', aliases: ['vulvar discharge'], category: 'reproductive' },
    { term: 'mammary_swelling', aliases: ['swollen mammary gland'], category: 'reproductive' },
    { term: 'mammary_pain', aliases: ['painful mammary gland'], category: 'reproductive' },
    { term: 'labor_not_progressing', aliases: ['straining without delivery'], category: 'reproductive' },
];

export const MASTER_DISEASE_ONTOLOGY: DiseaseOntologyEntry[] = [
    {
        id: 'rabies',
        name: 'Rabies',
        aliases: [],
        category: 'Neurological',
        subcategory: 'Infectious',
        condition_class: 'Infectious',
        key_clinical_features: [f('aggression', 0.42), f('dysphagia', 0.34), f('hypersalivation', 0.28), f('mentation_change', 0.24)],
        supporting_features: [f('seizures', 0.18), f('ataxia', 0.14), f('paralysis', 0.16), f('acute_onset', 0.08)],
        exclusion_features: [f('chronic_duration', 0.12)],
        lab_signatures: [],
        progression_pattern: ['acute', 'hyperacute'],
        species_relevance: ['dog', 'cat', 'cow', 'horse'],
        zoonotic: true,
        minimum_feature_match_threshold: 2,
        minimum_key_feature_matches: 1,
    },
    {
        id: 'canine-distemper-neurologic',
        name: 'Canine Distemper, Neurologic Form',
        aliases: ['Canine Distemper', 'distemper'],
        category: 'Neurological',
        subcategory: 'Infectious',
        condition_class: 'Infectious',
        key_clinical_features: [f('myoclonus', 0.4), f('seizures', 0.2), f('mentation_change', 0.16)],
        supporting_features: [f('fever', 0.1), f('cough', 0.08), f('pneumonia', 0.16)],
        exclusion_features: [f('pregnant', 0.02)],
        lab_signatures: [],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog'],
        zoonotic: false,
        minimum_feature_match_threshold: 2,
    },
    {
        id: 'infectious-meningoencephalitis',
        name: 'Infectious Meningoencephalitis',
        aliases: [],
        category: 'Neurological',
        subcategory: 'Infectious',
        condition_class: 'Infectious',
        key_clinical_features: [f('neck_pain', 0.24), f('fever', 0.22), f('seizures', 0.18), f('mentation_change', 0.2)],
        supporting_features: [f('ataxia', 0.14), f('hyperesthesia', 0.14), f('proprioceptive_deficits', 0.12)],
        exclusion_features: [f('chronic_duration', 0.06)],
        lab_signatures: [f('lymphadenopathy', 0.08)],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'immune-mediated-meningoencephalitis',
        name: 'Immune-Mediated Meningoencephalitis',
        aliases: ['mue'],
        category: 'Neurological',
        subcategory: 'Immune-mediated',
        condition_class: 'Autoimmune / Immune-Mediated',
        key_clinical_features: [f('seizures', 0.2), f('ataxia', 0.18), f('neck_pain', 0.18), f('mentation_change', 0.18)],
        supporting_features: [f('circling', 0.12), f('proprioceptive_deficits', 0.14), f('fever', 0.06)],
        exclusion_features: [f('tick_exposure', 0.06)],
        lab_signatures: [],
        progression_pattern: ['acute', 'subacute', 'episodic'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'tetanus',
        name: 'Tetanus',
        aliases: [],
        category: 'Neurological',
        subcategory: 'Infectious',
        condition_class: 'Infectious',
        key_clinical_features: [f('muscle_rigidity', 0.34), f('jaw_rigidity', 0.32), f('hyperesthesia', 0.2)],
        supporting_features: [f('dysphagia', 0.14), f('fever', 0.06)],
        exclusion_features: [f('vomiting', 0.06)],
        lab_signatures: [],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'horse'],
        zoonotic: false,
        minimum_feature_match_threshold: 2,
    },
    {
        id: 'idiopathic-epilepsy',
        name: 'Idiopathic Epilepsy',
        aliases: ['epilepsy'],
        category: 'Neurological',
        subcategory: 'Idiopathic',
        condition_class: 'Idiopathic / Unknown',
        key_clinical_features: [f('seizures', 0.34), f('intermittent_course', 0.12)],
        supporting_features: [],
        exclusion_features: [f('fever', 0.12), f('neck_pain', 0.1), f('tick_exposure', 0.08)],
        lab_signatures: [],
        progression_pattern: ['episodic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'ivdd',
        name: 'Intervertebral Disc Disease (IVDD)',
        aliases: ['ivdd'],
        category: 'Neurological',
        subcategory: 'Structural',
        condition_class: 'Degenerative',
        key_clinical_features: [f('paresis', 0.26), f('paralysis', 0.28), f('proprioceptive_deficits', 0.22)],
        supporting_features: [f('neck_pain', 0.12), f('ataxia', 0.16), f('acute_onset', 0.08)],
        exclusion_features: [f('fever', 0.14), f('seizures', 0.1)],
        lab_signatures: [],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'intracranial-neoplasia',
        name: 'Intracranial Neoplasia (Brain Tumor)',
        aliases: ['brain tumor'],
        category: 'Neurological',
        subcategory: 'Structural',
        condition_class: 'Neoplastic',
        key_clinical_features: [f('seizures', 0.22), f('circling', 0.18), f('mentation_change', 0.18)],
        supporting_features: [f('proprioceptive_deficits', 0.14), f('head_pressing', 0.14), f('chronic_duration', 0.1)],
        exclusion_features: [f('fever', 0.1), f('acute_onset', 0.08)],
        lab_signatures: [],
        progression_pattern: ['chronic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'vestibular-disease',
        name: 'Vestibular Disease',
        aliases: [],
        category: 'Neurological',
        subcategory: 'Idiopathic',
        condition_class: 'Idiopathic / Unknown',
        key_clinical_features: [f('head_tilt', 0.28), f('nystagmus', 0.28), f('ataxia', 0.2)],
        supporting_features: [f('vomiting', 0.08), f('acute_onset', 0.08)],
        exclusion_features: [f('seizures', 0.12), f('fever', 0.08)],
        lab_signatures: [],
        progression_pattern: ['acute', 'episodic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'hepatic-encephalopathy',
        name: 'Hepatic Encephalopathy',
        aliases: [],
        category: 'Neurological',
        subcategory: 'Toxic-metabolic',
        condition_class: 'Metabolic / Endocrine',
        key_clinical_features: [f('mentation_change', 0.24), f('seizures', 0.18), f('head_pressing', 0.14)],
        supporting_features: [f('circling', 0.12), f('icterus', 0.14), f('ascites', 0.1)],
        exclusion_features: [f('neck_pain', 0.08)],
        lab_signatures: [f('icterus', 0.12)],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'babesiosis',
        name: 'Babesiosis',
        aliases: [],
        category: 'Hemoparasitic',
        subcategory: 'Protozoal',
        condition_class: 'Infectious',
        key_clinical_features: [f('fever', 0.22), f('icterus', 0.18), f('pale_mucous_membranes', 0.18)],
        supporting_features: [f('weakness', 0.12), f('tick_exposure', 0.14), f('collapse', 0.1)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [f('anemia', 0.24), f('thrombocytopenia', 0.16), f('hemoglobinuria', 0.14)],
        progression_pattern: ['acute', 'hyperacute'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'ehrlichiosis',
        name: 'Ehrlichiosis',
        aliases: [],
        category: 'Hemoparasitic',
        subcategory: 'Rickettsial',
        condition_class: 'Infectious',
        key_clinical_features: [f('fever', 0.18), f('lymphadenopathy', 0.16), f('petechiae', 0.18)],
        supporting_features: [f('tick_exposure', 0.14), f('weight_loss', 0.1), f('bleeding', 0.14)],
        exclusion_features: [f('retching_unproductive', 0.04)],
        lab_signatures: [f('thrombocytopenia', 0.24), f('anemia', 0.12)],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'anaplasmosis',
        name: 'Anaplasmosis',
        aliases: [],
        category: 'Hemoparasitic',
        subcategory: 'Rickettsial',
        condition_class: 'Infectious',
        key_clinical_features: [f('fever', 0.18), f('lethargy', 0.12), f('weakness', 0.1)],
        supporting_features: [f('tick_exposure', 0.14), f('petechiae', 0.12)],
        exclusion_features: [f('vomiting', 0.04)],
        lab_signatures: [f('thrombocytopenia', 0.24)],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: true,
    },
    {
        id: 'trypanosomiasis',
        name: 'Trypanosomiasis',
        aliases: [],
        category: 'Hemoparasitic',
        subcategory: 'Protozoal',
        condition_class: 'Infectious',
        key_clinical_features: [f('fever', 0.18), f('weight_loss', 0.16), f('lymphadenopathy', 0.14)],
        supporting_features: [f('weakness', 0.12), f('icterus', 0.1)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [f('anemia', 0.22)],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog', 'cow', 'horse'],
        zoonotic: false,
    },
    {
        id: 'theileriosis',
        name: 'Theileriosis',
        aliases: [],
        category: 'Hemoparasitic',
        subcategory: 'Protozoal',
        condition_class: 'Infectious',
        key_clinical_features: [f('fever', 0.2), f('lymphadenopathy', 0.16), f('dyspnea', 0.12)],
        supporting_features: [f('tick_exposure', 0.14), f('weakness', 0.12), f('icterus', 0.1)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [f('anemia', 0.22)],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['cow'],
        zoonotic: false,
    },
    {
        id: 'roundworm-infestation',
        name: 'Roundworm Infestation',
        aliases: ['toxocariasis'],
        category: 'Parasitic',
        subcategory: 'Endoparasites',
        condition_class: 'Infectious',
        key_clinical_features: [f('worms_in_stool', 0.28), f('pot_bellied_appearance', 0.18)],
        supporting_features: [f('diarrhea', 0.12), f('vomiting', 0.08), f('weight_loss', 0.08)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [],
        progression_pattern: ['chronic', 'subacute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: true,
    },
    {
        id: 'hookworm-infestation',
        name: 'Hookworm Infestation',
        aliases: [],
        category: 'Parasitic',
        subcategory: 'Endoparasites',
        condition_class: 'Infectious',
        key_clinical_features: [f('melena', 0.22), f('diarrhea', 0.18)],
        supporting_features: [f('weakness', 0.12), f('weight_loss', 0.1)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [f('anemia', 0.2)],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: true,
    },
    {
        id: 'tapeworm-infestation',
        name: 'Tapeworm Infestation',
        aliases: [],
        category: 'Parasitic',
        subcategory: 'Endoparasites',
        condition_class: 'Infectious',
        key_clinical_features: [f('worms_in_stool', 0.18), f('scooting', 0.16)],
        supporting_features: [f('weight_loss', 0.08), f('flea_infestation', 0.12)],
        exclusion_features: [f('fever', 0.06)],
        lab_signatures: [],
        progression_pattern: ['chronic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'coccidiosis',
        name: 'Coccidiosis',
        aliases: [],
        category: 'Parasitic',
        subcategory: 'Protozoal enteric',
        condition_class: 'Infectious',
        key_clinical_features: [f('diarrhea', 0.22), f('hemorrhagic_diarrhea', 0.18)],
        supporting_features: [f('dehydration', 0.12), f('weight_loss', 0.1)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cat', 'cow'],
        zoonotic: false,
    },
    {
        id: 'giardiasis',
        name: 'Giardiasis',
        aliases: ['giardia'],
        category: 'Parasitic',
        subcategory: 'Protozoal enteric',
        condition_class: 'Infectious',
        key_clinical_features: [f('diarrhea', 0.22), f('weight_loss', 0.12)],
        supporting_features: [f('vomiting', 0.08), f('chronic_duration', 0.08)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: true,
    },
    {
        id: 'demodectic-mange',
        name: 'Demodectic Mange',
        aliases: ['demodicosis'],
        category: 'Parasitic',
        subcategory: 'Ectoparasites',
        condition_class: 'Infectious',
        key_clinical_features: [f('alopecia', 0.24), f('skin_crusting', 0.16)],
        supporting_features: [f('pruritus', 0.08), f('chronic_duration', 0.08)],
        exclusion_features: [f('worms_in_stool', 0.04)],
        lab_signatures: [],
        progression_pattern: ['chronic'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'sarcoptic-mange',
        name: 'Sarcoptic Mange',
        aliases: ['scabies'],
        category: 'Parasitic',
        subcategory: 'Ectoparasites',
        condition_class: 'Infectious',
        key_clinical_features: [f('pruritus', 0.3), f('skin_crusting', 0.14)],
        supporting_features: [f('alopecia', 0.16), f('flea_infestation', 0.04)],
        exclusion_features: [f('worms_in_stool', 0.04)],
        lab_signatures: [],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog'],
        zoonotic: true,
    },
    {
        id: 'clinically-significant-flea-infestation',
        name: 'Clinically Significant Flea Infestation',
        aliases: ['flea infestation'],
        category: 'Parasitic',
        subcategory: 'Ectoparasites',
        condition_class: 'Infectious',
        key_clinical_features: [f('flea_infestation', 0.28), f('pruritus', 0.2)],
        supporting_features: [f('alopecia', 0.1)],
        exclusion_features: [f('fever', 0.06)],
        lab_signatures: [],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'clinically-significant-tick-infestation',
        name: 'Clinically Significant Tick Infestation',
        aliases: ['tick infestation'],
        category: 'Parasitic',
        subcategory: 'Ectoparasites',
        condition_class: 'Infectious',
        key_clinical_features: [f('tick_infestation', 0.28)],
        supporting_features: [f('pruritus', 0.08), f('anemia', 0.1), f('weakness', 0.08)],
        exclusion_features: [f('vomiting', 0.04)],
        lab_signatures: [],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog', 'cat', 'cow'],
        zoonotic: false,
    },
    {
        id: 'organophosphate-toxicity',
        name: 'Organophosphate Toxicity',
        aliases: ['organophosphate poisoning'],
        category: 'Toxicology',
        subcategory: 'Neurotoxic',
        condition_class: 'Toxic',
        key_clinical_features: [f('hypersalivation', 0.22), f('miosis', 0.18), f('tremors', 0.18), f('bradycardia', 0.16)],
        supporting_features: [f('vomiting', 0.08), f('diarrhea', 0.08), f('dyspnea', 0.12), f('organophosphate_exposure', 0.18)],
        exclusion_features: [f('chronic_duration', 0.1)],
        lab_signatures: [],
        progression_pattern: ['acute', 'hyperacute'],
        species_relevance: ['dog', 'cat', 'cow', 'horse'],
        zoonotic: false,
    },
    {
        id: 'carbamate-toxicity',
        name: 'Carbamate Toxicity',
        aliases: ['carbamate poisoning'],
        category: 'Toxicology',
        subcategory: 'Neurotoxic',
        condition_class: 'Toxic',
        key_clinical_features: [f('hypersalivation', 0.2), f('miosis', 0.16), f('tremors', 0.18)],
        supporting_features: [f('vomiting', 0.08), f('diarrhea', 0.08), f('bradycardia', 0.12), f('carbamate_exposure', 0.18)],
        exclusion_features: [f('chronic_duration', 0.1)],
        lab_signatures: [],
        progression_pattern: ['acute', 'hyperacute'],
        species_relevance: ['dog', 'cat', 'cow', 'horse'],
        zoonotic: false,
    },
    {
        id: 'anticoagulant-rodenticide-toxicity',
        name: 'Anticoagulant Rodenticide Toxicity',
        aliases: ['rodenticide toxicity'],
        category: 'Toxicology',
        subcategory: 'Hemotoxic',
        condition_class: 'Toxic',
        key_clinical_features: [f('bleeding', 0.22), f('dyspnea', 0.14), f('collapse', 0.14)],
        supporting_features: [f('rodenticide_exposure', 0.22), f('pale_mucous_membranes', 0.14), f('weakness', 0.12)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [f('coagulopathy', 0.26), f('anemia', 0.12)],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'heavy-metal-toxicity',
        name: 'Heavy Metal Toxicity',
        aliases: ['lead toxicity'],
        category: 'Toxicology',
        subcategory: 'Neurotoxic',
        condition_class: 'Toxic',
        key_clinical_features: [f('vomiting', 0.12), f('diarrhea', 0.1), f('seizures', 0.18), f('mentation_change', 0.14)],
        supporting_features: [f('heavy_metal_exposure', 0.18), f('anemia', 0.12), f('weight_loss', 0.08)],
        exclusion_features: [f('recent_estrus', 0.02)],
        lab_signatures: [f('anemia', 0.14)],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog', 'cat', 'bird', 'cow'],
        zoonotic: false,
    },
    {
        id: 'aflatoxicosis',
        name: 'Aflatoxicosis',
        aliases: ['mycotoxicosis'],
        category: 'Toxicology',
        subcategory: 'Hepatotoxic',
        condition_class: 'Toxic',
        key_clinical_features: [f('vomiting', 0.14), f('diarrhea', 0.12), f('icterus', 0.18)],
        supporting_features: [f('aflatoxin_exposure', 0.18), f('weakness', 0.12), f('bleeding', 0.1)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [f('coagulopathy', 0.14), f('icterus', 0.12)],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cow'],
        zoonotic: false,
    },
    {
        id: 'nsaid-toxicity',
        name: 'NSAID Toxicity',
        aliases: ['nsaid poisoning'],
        category: 'Toxicology',
        subcategory: 'Drug-associated',
        condition_class: 'Toxic',
        key_clinical_features: [f('vomiting', 0.16), f('melena', 0.16), f('anorexia', 0.1)],
        supporting_features: [f('nsaid_exposure', 0.2), f('dehydration', 0.08), f('weakness', 0.08)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [f('azotemia', 0.16)],
        progression_pattern: ['acute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'ivermectin-toxicity',
        name: 'Ivermectin Toxicity',
        aliases: ['ivermectin poisoning'],
        category: 'Toxicology',
        subcategory: 'Drug-associated',
        condition_class: 'Toxic',
        key_clinical_features: [f('ataxia', 0.2), f('mentation_change', 0.18), f('seizures', 0.14)],
        supporting_features: [f('ivermectin_exposure', 0.24), f('tremors', 0.14)],
        exclusion_features: [f('fever', 0.06)],
        lab_signatures: [],
        progression_pattern: ['acute'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'plant-toxicity',
        name: 'Plant Toxicity',
        aliases: ['plant poisoning'],
        category: 'Toxicology',
        subcategory: 'Hepatotoxic',
        condition_class: 'Toxic',
        key_clinical_features: [f('vomiting', 0.14), f('diarrhea', 0.12), f('hypersalivation', 0.12)],
        supporting_features: [f('plant_toxin_exposure', 0.2), f('weakness', 0.1), f('icterus', 0.08)],
        exclusion_features: [f('chronic_duration', 0.08)],
        lab_signatures: [],
        progression_pattern: ['acute'],
        species_relevance: ['dog', 'cat', 'cow', 'horse'],
        zoonotic: false,
    },
    {
        id: 'diabetes-mellitus',
        name: 'Diabetes Mellitus',
        aliases: [],
        category: 'Endocrine',
        subcategory: 'Glycemic',
        condition_class: 'Metabolic / Endocrine',
        key_clinical_features: [f('polyuria', 0.16), f('polydipsia', 0.16), f('polyphagia', 0.1)],
        supporting_features: [f('weight_loss', 0.12), f('vomiting', 0.06)],
        exclusion_features: [f('glucosuria_absent', 0.32)],
        lab_signatures: [f('significant_hyperglycemia', 0.24), f('glucosuria', 0.28), f('ketonuria', 0.14), f('diabetic_metabolic_profile', 0.14)],
        progression_pattern: ['chronic', 'acute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
        minimum_feature_match_threshold: 2,
    },
    {
        id: 'hyperadrenocorticism',
        name: 'Hyperadrenocorticism',
        aliases: ['cushing disease', "cushing's disease"],
        category: 'Endocrine',
        subcategory: 'Adrenal',
        condition_class: 'Metabolic / Endocrine',
        key_clinical_features: [f('panting', 0.12), f('pot_bellied_appearance', 0.18), f('alopecia', 0.14), f('polydipsia', 0.12)],
        supporting_features: [f('polyuria', 0.12), f('chronic_duration', 0.1), f('gradual_onset', 0.08)],
        exclusion_features: [f('glucosuria', 0.12)],
        lab_signatures: [f('marked_alp_elevation', 0.24), f('hypercholesterolemia', 0.14), f('supportive_acth_stimulation_test', 0.32), f('dilute_urine', 0.12)],
        progression_pattern: ['chronic'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'hypoadrenocorticism',
        name: 'Hypoadrenocorticism',
        aliases: ['addisons disease', "addison's disease"],
        category: 'Endocrine',
        subcategory: 'Adrenal',
        condition_class: 'Metabolic / Endocrine',
        key_clinical_features: [f('vomiting', 0.14), f('diarrhea', 0.12), f('collapse', 0.18), f('weakness', 0.16)],
        supporting_features: [f('dehydration', 0.12), f('bradycardia', 0.1), f('acute_onset', 0.08)],
        exclusion_features: [f('pot_bellied_appearance', 0.08)],
        lab_signatures: [f('azotemia', 0.12), f('hypoglycemia', 0.08)],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'hypothyroidism',
        name: 'Hypothyroidism',
        aliases: [],
        category: 'Endocrine',
        subcategory: 'Thyroid',
        condition_class: 'Metabolic / Endocrine',
        key_clinical_features: [f('lethargy', 0.14), f('alopecia', 0.16)],
        supporting_features: [f('hypercholesterolemia', 0.14), f('chronic_duration', 0.08)],
        exclusion_features: [f('significant_hyperglycemia', 0.08), f('fever', 0.08)],
        lab_signatures: [f('hypercholesterolemia', 0.12)],
        progression_pattern: ['chronic'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'gdv',
        name: 'Gastric Dilatation-Volvulus (GDV)',
        aliases: ['gdv', 'gastric dilatation-volvulus', 'gastric dilatation volvulus'],
        category: 'Gastrointestinal',
        subcategory: 'Mechanical',
        condition_class: 'Mechanical',
        key_clinical_features: [f('retching_unproductive', 0.32), f('abdominal_distension', 0.32), f('collapse', 0.16)],
        supporting_features: [f('hypersalivation', 0.12), f('tachycardia', 0.12), f('pale_mucous_membranes', 0.14), f('recent_meal', 0.06), f('deep_chested_breed_risk', 0.14)],
        exclusion_features: [f('diarrhea', 0.08), f('hemorrhagic_diarrhea', 0.08)],
        lab_signatures: [],
        progression_pattern: ['acute', 'hyperacute'],
        species_relevance: ['dog'],
        zoonotic: false,
        minimum_feature_match_threshold: 2,
        minimum_key_feature_matches: 1,
    },
    {
        id: 'simple-gastric-dilatation',
        name: 'Simple Gastric Dilatation',
        aliases: ['gastric dilatation', 'simple bloat'],
        category: 'Gastrointestinal',
        subcategory: 'Mechanical',
        condition_class: 'Mechanical',
        key_clinical_features: [f('abdominal_distension', 0.24)],
        supporting_features: [f('retching_unproductive', 0.08), f('recent_meal', 0.12), f('hypersalivation', 0.08)],
        exclusion_features: [f('collapse', 0.12), f('pale_mucous_membranes', 0.12)],
        lab_signatures: [],
        progression_pattern: ['acute'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'mesenteric-volvulus',
        name: 'Mesenteric Volvulus',
        aliases: ['mesenteric torsion'],
        category: 'Gastrointestinal',
        subcategory: 'Mechanical',
        condition_class: 'Mechanical',
        key_clinical_features: [f('abdominal_distension', 0.18), f('collapse', 0.2), f('pale_mucous_membranes', 0.16)],
        supporting_features: [f('abdominal_pain', 0.16), f('tachycardia', 0.14), f('acute_onset', 0.1)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [],
        progression_pattern: ['acute', 'hyperacute'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'intestinal-obstruction',
        name: 'Intestinal Obstruction',
        aliases: ['foreign body obstruction', 'bowel obstruction'],
        category: 'Gastrointestinal',
        subcategory: 'Mechanical',
        condition_class: 'Mechanical',
        key_clinical_features: [f('vomiting', 0.22), f('abdominal_pain', 0.18), f('foreign_body_exposure', 0.18)],
        supporting_features: [f('abdominal_distension', 0.1), f('anorexia', 0.1), f('hypersalivation', 0.08)],
        exclusion_features: [f('hemorrhagic_diarrhea', 0.08)],
        lab_signatures: [],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'acute-pancreatitis',
        name: 'Acute Pancreatitis',
        aliases: ['pancreatitis'],
        category: 'Gastrointestinal',
        subcategory: 'Pancreatic',
        condition_class: 'Idiopathic / Unknown',
        key_clinical_features: [f('vomiting', 0.2), f('abdominal_pain', 0.2)],
        supporting_features: [f('anorexia', 0.1), f('fever', 0.08), f('lethargy', 0.08)],
        exclusion_features: [f('retching_unproductive', 0.08)],
        lab_signatures: [],
        progression_pattern: ['acute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'acute-gastroenteritis',
        name: 'Acute Gastroenteritis',
        aliases: ['gastroenteritis'],
        category: 'Gastrointestinal',
        subcategory: 'Inflammatory',
        condition_class: 'Infectious',
        key_clinical_features: [f('vomiting', 0.18), f('diarrhea', 0.2)],
        supporting_features: [f('fever', 0.1), f('lethargy', 0.08), f('anorexia', 0.08)],
        exclusion_features: [f('retching_unproductive', 0.14), f('abdominal_distension', 0.14)],
        lab_signatures: [],
        progression_pattern: ['acute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'septic-peritonitis',
        name: 'Septic Peritonitis',
        aliases: ['peritonitis', 'septic abdomen', 'peritonitis / septic abdomen'],
        category: 'Gastrointestinal',
        subcategory: 'Septic',
        condition_class: 'Infectious',
        key_clinical_features: [f('abdominal_pain', 0.24), f('collapse', 0.18), f('fever', 0.12)],
        supporting_features: [f('pale_mucous_membranes', 0.14), f('tachycardia', 0.12), f('vomiting', 0.08)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [],
        progression_pattern: ['acute', 'hyperacute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'pneumonia',
        name: 'Pneumonia',
        aliases: ['bacterial pneumonia'],
        category: 'Cardiopulmonary',
        subcategory: 'Parenchymal',
        condition_class: 'Infectious',
        key_clinical_features: [f('dyspnea', 0.18), f('cough', 0.18), f('fever', 0.14)],
        supporting_features: [f('tachypnea', 0.12), f('pneumonia', 0.22)],
        exclusion_features: [f('retching_unproductive', 0.08)],
        lab_signatures: [],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cat', 'cow', 'horse'],
        zoonotic: false,
    },
    {
        id: 'canine-infectious-tracheobronchitis',
        name: 'Canine Infectious Tracheobronchitis',
        aliases: ['kennel cough', 'infectious tracheobronchitis'],
        category: 'Cardiopulmonary',
        subcategory: 'Airway',
        condition_class: 'Infectious',
        key_clinical_features: [f('honking_cough', 0.28), f('cough', 0.16)],
        supporting_features: [f('cough', 0.08)],
        exclusion_features: [f('pale_mucous_membranes', 0.08)],
        lab_signatures: [],
        progression_pattern: ['acute'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'tracheal-collapse',
        name: 'Tracheal Collapse',
        aliases: [],
        category: 'Cardiopulmonary',
        subcategory: 'Airway',
        condition_class: 'Mechanical',
        key_clinical_features: [f('honking_cough', 0.24), f('cough', 0.16)],
        supporting_features: [f('exercise_intolerance', 0.12), f('dyspnea', 0.12), f('intermittent_course', 0.08)],
        exclusion_features: [f('fever', 0.12)],
        lab_signatures: [],
        progression_pattern: ['chronic', 'episodic'],
        species_relevance: ['dog'],
        zoonotic: false,
    },
    {
        id: 'bronchitis',
        name: 'Bronchitis',
        aliases: [],
        category: 'Cardiopulmonary',
        subcategory: 'Airway',
        condition_class: 'Infectious',
        key_clinical_features: [f('cough', 0.2)],
        supporting_features: [f('dyspnea', 0.1), f('exercise_intolerance', 0.08)],
        exclusion_features: [f('honking_cough', 0.08), f('pneumonia', 0.12)],
        lab_signatures: [],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'congestive-heart-failure',
        name: 'Congestive Heart Failure',
        aliases: ['chf', 'heart failure'],
        category: 'Cardiopulmonary',
        subcategory: 'Cardiogenic',
        condition_class: 'Degenerative',
        key_clinical_features: [f('dyspnea', 0.2), f('exercise_intolerance', 0.16), f('orthopnea', 0.16)],
        supporting_features: [f('cough', 0.12), f('heart_murmur', 0.14), f('arrhythmia', 0.12), f('syncope', 0.08)],
        exclusion_features: [f('fever', 0.1)],
        lab_signatures: [f('pulmonary_edema', 0.18), f('edema', 0.14), f('pleural_effusion', 0.12)],
        progression_pattern: ['acute', 'chronic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'pulmonary-edema',
        name: 'Pulmonary Edema',
        aliases: [],
        category: 'Cardiopulmonary',
        subcategory: 'Cardiogenic',
        condition_class: 'Degenerative',
        key_clinical_features: [f('dyspnea', 0.18), f('open_mouth_breathing', 0.16), f('orthopnea', 0.14)],
        supporting_features: [f('tachypnea', 0.12), f('pulmonary_edema', 0.24)],
        exclusion_features: [f('honking_cough', 0.08)],
        lab_signatures: [f('pulmonary_edema', 0.18)],
        progression_pattern: ['acute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'chronic-kidney-disease',
        name: 'Chronic Kidney Disease',
        aliases: ['ckd'],
        category: 'Renal',
        subcategory: 'Chronic renal disease',
        condition_class: 'Degenerative',
        key_clinical_features: [f('polyuria', 0.14), f('polydipsia', 0.14), f('weight_loss', 0.12)],
        supporting_features: [f('vomiting', 0.08), f('anorexia', 0.08), f('chronic_duration', 0.12)],
        exclusion_features: [f('acute_onset', 0.1)],
        lab_signatures: [f('azotemia', 0.22)],
        progression_pattern: ['chronic'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'acute-kidney-injury',
        name: 'Acute Kidney Injury',
        aliases: ['aki'],
        category: 'Renal',
        subcategory: 'Acute renal injury',
        condition_class: 'Metabolic / Endocrine',
        key_clinical_features: [f('vomiting', 0.14), f('oliguria', 0.18), f('anuria', 0.2)],
        supporting_features: [f('dehydration', 0.12), f('weakness', 0.1), f('acute_onset', 0.1)],
        exclusion_features: [f('chronic_duration', 0.08)],
        lab_signatures: [f('azotemia', 0.24)],
        progression_pattern: ['acute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'urinary-tract-infection',
        name: 'Urinary Tract Infection',
        aliases: ['uti'],
        category: 'Renal',
        subcategory: 'Lower urinary',
        condition_class: 'Infectious',
        key_clinical_features: [f('pollakiuria', 0.18), f('dysuria', 0.18), f('hematuria', 0.14)],
        supporting_features: [f('stranguria', 0.12), f('fever', 0.06)],
        exclusion_features: [f('anuria', 0.12)],
        lab_signatures: [f('pyuria', 0.22)],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'pyelonephritis',
        name: 'Pyelonephritis',
        aliases: [],
        category: 'Renal',
        subcategory: 'Upper urinary',
        condition_class: 'Infectious',
        key_clinical_features: [f('fever', 0.16), f('vomiting', 0.12), f('weakness', 0.1)],
        supporting_features: [f('pollakiuria', 0.1), f('dysuria', 0.1), f('dehydration', 0.08)],
        exclusion_features: [f('pruritus', 0.04)],
        lab_signatures: [f('pyuria', 0.18), f('azotemia', 0.12)],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'pyometra',
        name: 'Pyometra',
        aliases: [],
        category: 'Reproductive',
        subcategory: 'Uterine',
        condition_class: 'Infectious',
        key_clinical_features: [f('intact_female', 0.18), f('vaginal_discharge', 0.22), f('recent_estrus', 0.16)],
        supporting_features: [f('fever', 0.12), f('vomiting', 0.08), f('polydipsia', 0.08), f('lethargy', 0.1)],
        exclusion_features: [f('pregnant', 0.08)],
        lab_signatures: [],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cat'],
        zoonotic: false,
    },
    {
        id: 'dystocia',
        name: 'Dystocia',
        aliases: [],
        category: 'Reproductive',
        subcategory: 'Parturition',
        condition_class: 'Mechanical',
        key_clinical_features: [f('pregnant', 0.18), f('labor_not_progressing', 0.28)],
        supporting_features: [f('weakness', 0.08), f('collapse', 0.1)],
        exclusion_features: [f('recent_estrus', 0.1)],
        lab_signatures: [],
        progression_pattern: ['acute'],
        species_relevance: ['dog', 'cat', 'cow', 'horse'],
        zoonotic: false,
    },
    {
        id: 'mastitis',
        name: 'Mastitis',
        aliases: [],
        category: 'Reproductive',
        subcategory: 'Mammary',
        condition_class: 'Infectious',
        key_clinical_features: [f('postpartum', 0.18), f('mammary_swelling', 0.2), f('mammary_pain', 0.2)],
        supporting_features: [f('fever', 0.12), f('lethargy', 0.08)],
        exclusion_features: [f('pregnant', 0.06)],
        lab_signatures: [],
        progression_pattern: ['acute', 'subacute'],
        species_relevance: ['dog', 'cat', 'cow'],
        zoonotic: false,
    },
];

interface ObservationTermMetadata {
    term: string;
    diseaseCount: number;
    categoryCount: number;
    keyCount: number;
    supportingCount: number;
    labCount: number;
    exclusionCount: number;
    diseaseNames: string[];
    categories: DiseaseDomain[];
}

interface AnchorLockRule {
    id: string;
    label: string;
    requires_all?: string[];
    required_groups?: string[][];
    anchored_diseases: string[];
    protected_categories: DiseaseDomain[];
}

const ANCHOR_SIGNAL_OVERRIDES = new Set<string>([
    'retching_unproductive',
    'abdominal_distension',
    'aggression',
    'dysphagia',
    'myoclonus',
    'jaw_rigidity',
    'muscle_rigidity',
    'miosis',
    'rodenticide_exposure',
    'organophosphate_exposure',
    'carbamate_exposure',
    'nsaid_exposure',
    'ivermectin_exposure',
    'heavy_metal_exposure',
    'aflatoxin_exposure',
    'plant_toxin_exposure',
    'glucosuria',
    'ketonuria',
    'significant_hyperglycemia',
    'diabetic_metabolic_profile',
    'supportive_acth_stimulation_test',
    'marked_alp_elevation',
    'coagulopathy',
    'vaginal_discharge',
    'labor_not_progressing',
    'mammary_swelling',
    'mammary_pain',
    'worms_in_stool',
    'hemoglobinuria',
    'pyuria',
]);

const GENERIC_SIGNAL_OVERRIDES = new Set<string>([
    'lethargy',
    'anorexia',
    'weakness',
    'seizures',
    'vomiting',
    'diarrhea',
    'fever',
    'weight_loss',
    'cough',
    'tachypnea',
    'dehydration',
    'collapse',
    'acute_onset',
    'chronic_duration',
    'intermittent_course',
    'progressive_worsening',
    'gradual_onset',
]);

const CONTRADICTORY_SIGNAL_OVERRIDES = new Set<string>([
    'glucosuria_absent',
]);

const ANCHOR_LOCK_RULES: AnchorLockRule[] = [
    {
        id: 'gdv-anchor',
        label: 'Classic mechanical gastric emergency anchor',
        requires_all: ['retching_unproductive', 'abdominal_distension'],
        required_groups: [
            ['acute_onset', 'collapse', 'tachycardia', 'pale_mucous_membranes', 'dyspnea'],
            ['deep_chested_breed_risk', 'recent_meal', 'hypersalivation'],
        ],
        anchored_diseases: [
            'Gastric Dilatation-Volvulus (GDV)',
            'Simple Gastric Dilatation',
            'Mesenteric Volvulus',
            'Intestinal Obstruction',
        ],
        protected_categories: ['Gastrointestinal'],
    },
    {
        id: 'rabies-anchor',
        label: 'Rabies behavior-swallowing anchor',
        requires_all: ['aggression', 'dysphagia'],
        required_groups: [['hypersalivation', 'paralysis', 'mentation_change']],
        anchored_diseases: ['Rabies'],
        protected_categories: ['Neurological'],
    },
    {
        id: 'infectious-neuro-anchor',
        label: 'Infectious neurologic anchor',
        requires_all: ['fever'],
        required_groups: [
            ['seizures', 'mentation_change', 'neck_pain', 'ataxia', 'myoclonus'],
            ['pneumonia', 'nasal_discharge', 'ocular_discharge', 'tick_exposure', 'lymphadenopathy'],
        ],
        anchored_diseases: [
            'Infectious Meningoencephalitis',
            'Canine Distemper, Neurologic Form',
            'Rabies',
        ],
        protected_categories: ['Neurological'],
    },
    {
        id: 'organophosphate-anchor',
        label: 'Cholinergic toxidrome anchor',
        required_groups: [
            ['organophosphate_exposure', 'carbamate_exposure'],
            ['miosis', 'hypersalivation', 'tremors'],
        ],
        anchored_diseases: [
            'Organophosphate Toxicity',
            'Carbamate Toxicity',
        ],
        protected_categories: ['Toxicology'],
    },
    {
        id: 'rodenticide-anchor',
        label: 'Hemotoxic rodenticide anchor',
        requires_all: ['rodenticide_exposure'],
        required_groups: [['bleeding', 'coagulopathy', 'anemia', 'dyspnea']],
        anchored_diseases: ['Anticoagulant Rodenticide Toxicity'],
        protected_categories: ['Toxicology'],
    },
    {
        id: 'diabetes-anchor',
        label: 'Persistent diabetic anchor',
        requires_all: ['significant_hyperglycemia', 'glucosuria'],
        required_groups: [['ketonuria', 'diabetic_metabolic_profile', 'weight_loss', 'polyuria', 'polydipsia']],
        anchored_diseases: ['Diabetes Mellitus'],
        protected_categories: ['Endocrine'],
    },
    {
        id: 'pyometra-anchor',
        label: 'Pyometra reproductive anchor',
        requires_all: ['intact_female'],
        required_groups: [
            ['recent_estrus', 'vaginal_discharge'],
            ['fever', 'vomiting', 'polydipsia', 'lethargy'],
        ],
        anchored_diseases: ['Pyometra'],
        protected_categories: ['Reproductive'],
    },
    {
        id: 'hemoparasitic-anchor',
        label: 'Tick-borne hemoparasitic anchor',
        required_groups: [
            ['tick_exposure', 'tick_infestation'],
            ['anemia', 'thrombocytopenia', 'hemoglobinuria', 'petechiae', 'ecchymosis'],
            ['fever', 'weakness', 'icterus'],
        ],
        anchored_diseases: [
            'Babesiosis',
            'Ehrlichiosis',
            'Anaplasmosis',
            'Theileriosis',
        ],
        protected_categories: ['Hemoparasitic'],
    },
];

const OBSERVATION_ALIAS_LOOKUP = buildObservationAliasLookup();
const DISEASE_ALIAS_LOOKUP = buildDiseaseAliasLookup();
const OBSERVATION_TERM_METADATA = buildObservationTermMetadata();

const CATEGORY_TRIGGER_TERMS: Record<DiseaseDomain, string[]> = {
    Neurological: ['seizures', 'myoclonus', 'tremors', 'ataxia', 'head_tilt', 'circling', 'paresis', 'paralysis', 'disorientation', 'mentation_change', 'nystagmus', 'proprioceptive_deficits', 'aggression', 'neck_pain', 'muscle_rigidity', 'jaw_rigidity', 'head_pressing'],
    Hemoparasitic: ['tick_exposure', 'tick_infestation', 'fever', 'anemia', 'thrombocytopenia', 'icterus', 'petechiae', 'ecchymosis', 'hemoglobinuria', 'lymphadenopathy'],
    Parasitic: ['worms_in_stool', 'scooting', 'pruritus', 'alopecia', 'skin_crusting', 'flea_infestation', 'tick_infestation', 'diarrhea', 'weight_loss'],
    Toxicology: ['toxin_exposure_possible', 'rodenticide_exposure', 'medication_exposure', 'nsaid_exposure', 'ivermectin_exposure', 'plant_toxin_exposure', 'organophosphate_exposure', 'carbamate_exposure', 'heavy_metal_exposure', 'aflatoxin_exposure', 'hypersalivation', 'miosis', 'bleeding', 'coagulopathy', 'tremors'],
    Endocrine: ['polyuria', 'polydipsia', 'polyphagia', 'glucosuria', 'significant_hyperglycemia', 'ketonuria', 'diabetic_metabolic_profile', 'panting', 'alopecia', 'pot_bellied_appearance', 'marked_alp_elevation', 'supportive_acth_stimulation_test', 'dilute_urine'],
    Gastrointestinal: ['vomiting', 'diarrhea', 'hemorrhagic_diarrhea', 'melena', 'hematemesis', 'abdominal_distension', 'abdominal_pain', 'retching_unproductive', 'foreign_body_exposure', 'garbage_ingestion'],
    Cardiopulmonary: ['cough', 'honking_cough', 'dyspnea', 'respiratory_distress', 'tachypnea', 'orthopnea', 'open_mouth_breathing', 'exercise_intolerance', 'syncope', 'heart_murmur', 'arrhythmia', 'pneumonia', 'pulmonary_edema'],
    Renal: ['stranguria', 'dysuria', 'pollakiuria', 'hematuria', 'oliguria', 'anuria', 'pyuria', 'azotemia'],
    Reproductive: ['intact_female', 'pregnant', 'postpartum', 'recent_estrus', 'vaginal_discharge', 'mammary_swelling', 'mammary_pain', 'labor_not_progressing'],
};

function buildObservationTermMetadata() {
    const metadata = new Map<string, {
        keyCount: number;
        supportingCount: number;
        labCount: number;
        exclusionCount: number;
        diseaseNames: Set<string>;
        categories: Set<DiseaseDomain>;
    }>();

    const add = (term: string, disease: DiseaseOntologyEntry, field: 'keyCount' | 'supportingCount' | 'labCount' | 'exclusionCount') => {
        const current = metadata.get(term) ?? {
            keyCount: 0,
            supportingCount: 0,
            labCount: 0,
            exclusionCount: 0,
            diseaseNames: new Set<string>(),
            categories: new Set<DiseaseDomain>(),
        };
        current[field] += 1;
        current.diseaseNames.add(disease.name);
        current.categories.add(disease.category);
        metadata.set(term, current);
    };

    for (const disease of MASTER_DISEASE_ONTOLOGY) {
        for (const feature of disease.key_clinical_features) add(feature.term, disease, 'keyCount');
        for (const feature of disease.supporting_features) add(feature.term, disease, 'supportingCount');
        for (const feature of disease.lab_signatures) add(feature.term, disease, 'labCount');
        for (const feature of disease.exclusion_features) add(feature.term, disease, 'exclusionCount');
    }

    return new Map<string, ObservationTermMetadata>(
        [...metadata.entries()].map(([term, current]) => [
            term,
            {
                term,
                diseaseCount: current.diseaseNames.size,
                categoryCount: current.categories.size,
                keyCount: current.keyCount,
                supportingCount: current.supportingCount,
                labCount: current.labCount,
                exclusionCount: current.exclusionCount,
                diseaseNames: [...current.diseaseNames],
                categories: [...current.categories],
            },
        ]),
    );
}

function classifyObservationTerm(term: string): SignalClassification {
    if (CONTRADICTORY_SIGNAL_OVERRIDES.has(term)) {
        return 'contradictory_signal';
    }
    if (ANCHOR_SIGNAL_OVERRIDES.has(term)) {
        return 'anchor_signal';
    }
    if (GENERIC_SIGNAL_OVERRIDES.has(term)) {
        return 'generic_signal';
    }

    const metadata = OBSERVATION_TERM_METADATA.get(term);
    if (!metadata) {
        return 'contextual_signal';
    }

    if (
        (metadata.keyCount >= 1 || metadata.labCount >= 1)
        && metadata.diseaseCount <= 3
        && metadata.categoryCount <= 2
    ) {
        return 'anchor_signal';
    }

    if (
        metadata.diseaseCount >= 6
        || metadata.categoryCount >= 3
        || (metadata.supportingCount >= 4 && metadata.keyCount === 0)
    ) {
        return 'generic_signal';
    }

    return 'contextual_signal';
}

function buildSignalHierarchy(
    observations: Set<string>,
    activeCategories: DiseaseDomain[],
): ClosedWorldSignalHierarchy {
    const classifiedObservations: SignalHierarchyObservation[] = [...observations]
        .sort()
        .map((term) => {
            const metadata = OBSERVATION_TERM_METADATA.get(term);
            return {
                term,
                classification: classifyObservationTerm(term),
                supportingDiseases: metadata?.diseaseNames ?? [],
                supportingCategories: metadata?.categories ?? [],
            };
        });

    const anchorSignals = classifiedObservations
        .filter((observation) => observation.classification === 'anchor_signal')
        .map((observation) => observation.term);
    const contextualSignals = classifiedObservations
        .filter((observation) => observation.classification === 'contextual_signal')
        .map((observation) => observation.term);
    const genericSignals = classifiedObservations
        .filter((observation) => observation.classification === 'generic_signal')
        .map((observation) => observation.term);
    const contradictorySignals = classifiedObservations
        .filter((observation) => observation.classification === 'contradictory_signal')
        .map((observation) => observation.term);

    const contradictionScore = computeSignalContradictionScore(observations, contradictorySignals);
    const anchorLocks = ANCHOR_LOCK_RULES
        .map((rule) => evaluateAnchorLockRule(rule, observations))
        .filter((lock): lock is SignalAnchorLock => lock !== null);

    const protectedCategories = new Set<DiseaseDomain>([
        ...activeCategories,
        ...anchorLocks.flatMap((lock) => lock.protectedCategories),
    ]);

    for (const observation of classifiedObservations) {
        if (observation.classification !== 'anchor_signal') continue;
        if (observation.supportingCategories.length === 1) {
            protectedCategories.add(observation.supportingCategories[0]);
        }
    }

    const genericNoiseScore = Number(
        (
            (genericSignals.length * 0.18)
            + (Math.max(0, genericSignals.length - anchorSignals.length) * 0.05)
        ).toFixed(3),
    );
    const missingDataScore = Number(
        Math.max(
            0,
            Math.min(
                1,
                0.48
                - (anchorSignals.length * 0.16)
                - (contextualSignals.length * 0.08)
                + (genericSignals.length * 0.04)
                + (contradictionScore * 0.25),
            ),
        ).toFixed(3),
    );

    return {
        classified_observations: classifiedObservations,
        anchor_signals: anchorSignals,
        contextual_signals: contextualSignals,
        generic_signals: genericSignals,
        contradictory_signals: contradictorySignals,
        anchor_locks: anchorLocks,
        protected_categories: [...protectedCategories],
        contradiction_score: contradictionScore,
        generic_noise_score: genericNoiseScore,
        missing_data_score: missingDataScore,
        abstain_recommended: contradictionScore >= 0.55 && anchorLocks.length === 0 && anchorSignals.length < 2,
    };
}

function evaluateAnchorLockRule(rule: AnchorLockRule, observations: Set<string>): SignalAnchorLock | null {
    if (rule.requires_all && !rule.requires_all.every((term) => observations.has(term))) {
        return null;
    }
    if (rule.required_groups && !rule.required_groups.every((group) => group.some((term) => observations.has(term)))) {
        return null;
    }

    const matchedTerms = [
        ...(rule.requires_all ?? []).filter((term) => observations.has(term)),
        ...(rule.required_groups ?? []).flatMap((group) => group.filter((term) => observations.has(term))),
    ];

    if (matchedTerms.length === 0) {
        return null;
    }

    return {
        id: rule.id,
        label: rule.label,
        anchoredDiseases: rule.anchored_diseases,
        protectedCategories: rule.protected_categories,
        matchedTerms: [...new Set(matchedTerms)],
    };
}

function computeSignalContradictionScore(observations: Set<string>, contradictorySignals: string[]) {
    let score = contradictorySignals.length * 0.18;

    if (observations.has('acute_onset') && observations.has('chronic_duration')) {
        score += 0.2;
    }
    if (observations.has('acute_onset') && observations.has('gradual_onset')) {
        score += 0.14;
    }
    if (observations.has('glucosuria') && observations.has('glucosuria_absent')) {
        score += 0.32;
    }
    if (observations.has('pregnant') && observations.has('recent_estrus')) {
        score += 0.12;
    }
    if (observations.has('weight_loss') && observations.has('pot_bellied_appearance') && observations.has('acute_onset')) {
        score += 0.06;
    }

    return Number(Math.min(1, score).toFixed(3));
}

function getObservationClassificationWeight(classification: SignalClassification) {
    if (classification === 'anchor_signal') return 2.45;
    if (classification === 'contextual_signal') return 1.05;
    if (classification === 'generic_signal') return 0.34;
    return 0.18;
}

function getExclusionPenaltyWeight(classification: SignalClassification) {
    if (classification === 'anchor_signal') return 1.55;
    if (classification === 'contextual_signal') return 1.2;
    if (classification === 'generic_signal') return 0.85;
    return 1.35;
}

function getHierarchySupportMode(anchorMatchCount: number, contextualMatchCount: number) {
    if (anchorMatchCount > 0) return 'anchor_led';
    if (contextualMatchCount > 0) return 'context_led';
    return 'generic_led';
}

export function getMasterDiseaseOntology() {
    return MASTER_DISEASE_ONTOLOGY;
}

export function getOntologyCategoryStructure() {
    return DISEASE_CATEGORY_STRUCTURE;
}

export function getOntologyObservationDictionary() {
    return ONTOLOGY_OBSERVATION_DICTIONARY;
}

export function getClosedWorldDiseaseNames() {
    return MASTER_DISEASE_ONTOLOGY.map((entry) => entry.name);
}

export function getClosedWorldDiseasePromptBlock() {
    return Object.entries(DISEASE_CATEGORY_STRUCTURE)
        .map(([category, subcategories]) => {
            const names = MASTER_DISEASE_ONTOLOGY
                .filter((entry) => entry.category === category)
                .map((entry) => entry.name)
                .join(', ');
            return `${category} [${subcategories.join(' / ')}]: ${names}`;
        })
        .join('\n');
}

export function normalizeOntologyDiseaseName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = normalizePhrase(value);
    if (!normalized) return null;
    return DISEASE_ALIAS_LOOKUP.get(normalized) ?? null;
}

export function extractOntologyObservations(input: unknown): string[] {
    const observations = new Set<string>();
    collectOntologyObservations(input, observations);
    return [...observations];
}

export function scoreClosedWorldDiseases(params: {
    inputSignature: Record<string, unknown>;
    observationHints?: string[];
    species?: string | null;
}): ClosedWorldScoreResult {
    const observationSet = new Set<string>(extractOntologyObservations(params.inputSignature));
    for (const hint of params.observationHints ?? []) {
        const normalized = normalizeOntologyObservation(hint);
        if (normalized) {
            observationSet.add(normalized);
        }
    }

    const observations = [...observationSet];
    const activeCategories = inferActiveCategories(observationSet);
    const signalHierarchy = buildSignalHierarchy(observationSet, activeCategories);
    const species = normalizeSpecies(params.species);
    const scored = MASTER_DISEASE_ONTOLOGY
        .map((disease) => scoreDisease(disease, observationSet, activeCategories, species, signalHierarchy))
        .filter((score) => score.rawScore > 0);

    const candidatePool = scored
        .filter((score) => {
            const support = score.keyMatchCount + score.supportingMatchCount + score.labMatchCount;
            const lowInformationMode =
                signalHierarchy.anchor_signals.length === 0
                && signalHierarchy.contextual_signals.length <= 1
                && signalHierarchy.generic_signals.length > 0;
            if (support === 0) {
                return false;
            }

            if (signalHierarchy.protected_categories.length > 0) {
                if (signalHierarchy.protected_categories.includes(score.category)) {
                    return score.rawScore >= 0.08 || score.anchorMatchCount >= 1;
                }

                if (score.anchorMatchCount >= 2) {
                    return score.rawScore >= 0.12;
                }

                return score.contextualMatchCount >= 2 && score.rawScore >= 0.15;
            }

            if (lowInformationMode) {
                return score.rawScore >= 0.03 || score.genericMatchCount >= 1;
            }

            if (activeCategories.length === 0) {
                return score.rawScore >= 0.1 || score.anchorMatchCount >= 1;
            }

            if (activeCategories.includes(score.category)) {
                return score.rawScore >= 0.08;
            }

            return (score.anchorMatchCount >= 1 && score.rawScore >= 0.12) || (support >= 2 && score.rawScore >= 0.18);
        })
        .sort((left, right) => right.rawScore - left.rawScore);

    const temperatureBase = activeCategories.length >= 2 ? 0.9 : 0.78;
    const temperature =
        temperatureBase
        + (signalHierarchy.contradiction_score * 0.95)
        + (signalHierarchy.missing_data_score * 0.45)
        + (signalHierarchy.generic_noise_score * 0.28)
        - (signalHierarchy.anchor_locks.length > 0 ? 0.12 : 0);
    const probabilities = softmax(candidatePool.map((score) => score.rawScore), Math.max(0.62, temperature));

    return {
        observations,
        activeCategories,
        signalHierarchy,
        ranked: candidatePool
            .map((score, index) => ({
                ...score,
                probability: probabilities[index] ?? 0,
            }))
            .slice(0, 8),
    };
}

function scoreDisease(
    disease: DiseaseOntologyEntry,
    observations: Set<string>,
    activeCategories: DiseaseDomain[],
    species: string | null,
    signalHierarchy: ClosedWorldSignalHierarchy,
): ClosedWorldCandidateScore {
    if (species && !disease.species_relevance.includes(species)) {
        return emptyScore(disease);
    }

    const drivers: Array<{ feature: string; weight: number }> = [];
    const matchedObservations = new Set<string>();
    let rawScore = 0.01;
    let keyMatchCount = 0;
    let supportingMatchCount = 0;
    let labMatchCount = 0;
    let anchorMatchCount = 0;
    let contextualMatchCount = 0;
    let genericMatchCount = 0;
    let contradictoryMatchCount = 0;
    let contradictionPenalty = 0;
    let genericDominancePenalty = 0;
    let missingSupportPenalty = 0;
    let ontologyMismatchPenalty = 0;

    keyMatchCount += addFeatureWeights(observations, disease.key_clinical_features, drivers, matchedObservations, (featureWeight, classification, weightedValue) => {
        rawScore += weightedValue;
        if (classification === 'anchor_signal') anchorMatchCount += 1;
        else if (classification === 'contextual_signal') contextualMatchCount += 1;
        else if (classification === 'generic_signal') genericMatchCount += 1;
        else contradictoryMatchCount += 1;
    });
    supportingMatchCount += addFeatureWeights(observations, disease.supporting_features, drivers, matchedObservations, (featureWeight, classification, weightedValue) => {
        rawScore += weightedValue;
        if (classification === 'anchor_signal') anchorMatchCount += 1;
        else if (classification === 'contextual_signal') contextualMatchCount += 1;
        else if (classification === 'generic_signal') genericMatchCount += 1;
        else contradictoryMatchCount += 1;
    });
    labMatchCount += addFeatureWeights(observations, disease.lab_signatures, drivers, matchedObservations, (featureWeight, classification, weightedValue) => {
        rawScore += weightedValue;
        if (classification === 'anchor_signal') anchorMatchCount += 1;
        else if (classification === 'contextual_signal') contextualMatchCount += 1;
        else if (classification === 'generic_signal') genericMatchCount += 1;
        else contradictoryMatchCount += 1;
    });

    for (const exclusion of disease.exclusion_features) {
        if (observations.has(exclusion.term)) {
            const classification = classifyObservationTerm(exclusion.term);
            const penalty = exclusion.weight * getExclusionPenaltyWeight(classification);
            rawScore -= penalty;
            contradictionPenalty += penalty;
            if (classification === 'contradictory_signal') {
                contradictoryMatchCount += 1;
            }
        }
    }

    const matchingAnchorLocks = signalHierarchy.anchor_locks.filter((lock) => lock.anchoredDiseases.includes(disease.name));
    if (matchingAnchorLocks.length > 0) {
        rawScore += 0.16 + (anchorMatchCount * 0.04);
    } else if (anchorMatchCount >= Math.max(1, disease.minimum_key_feature_matches ?? 1) && keyMatchCount >= 1) {
        rawScore += 0.1 + Math.max(0, anchorMatchCount - 1) * 0.03;
    }

    const protectedCategories = signalHierarchy.protected_categories;
    if (protectedCategories.length > 0 && !protectedCategories.includes(disease.category)) {
        const support = keyMatchCount + supportingMatchCount + labMatchCount;
        const reduction = anchorMatchCount >= 2 ? 0.62 : contextualMatchCount >= 2 ? 0.48 : 0.24;
        rawScore *= reduction;
        ontologyMismatchPenalty += 1 - reduction;
    } else if (activeCategories.length > 0 && !activeCategories.includes(disease.category)) {
        const support = keyMatchCount + supportingMatchCount + labMatchCount;
        rawScore *= support >= 2 ? 0.65 : 0.24;
        ontologyMismatchPenalty += support >= 2 ? 0.35 : 0.76;
    } else if (activeCategories.includes(disease.category)) {
        rawScore += 0.05;
    }

    rawScore += disease.progression_pattern.filter((pattern) => observations.has(patternToObservation(pattern))).length * 0.03;

    if (genericMatchCount > 0 && anchorMatchCount === 0 && contextualMatchCount === 0) {
        const anchoredCase = signalHierarchy.anchor_signals.length > 0 || signalHierarchy.contextual_signals.length > 0;
        genericDominancePenalty += anchoredCase ? 0.24 : 0.02;
        if (anchoredCase && disease.condition_class === 'Idiopathic / Unknown') {
            genericDominancePenalty += 0.12;
        }
        if (disease.name === 'Idiopathic Epilepsy' && (observations.has('fever') || observations.has('neck_pain') || observations.has('myoclonus') || observations.has('tick_exposure'))) {
            genericDominancePenalty += 0.24;
        }
    } else if (genericMatchCount > anchorMatchCount + contextualMatchCount && signalHierarchy.anchor_signals.length > 0) {
        genericDominancePenalty += 0.1;
    }

    if (contradictoryMatchCount > 0 || signalHierarchy.contradiction_score > 0) {
        contradictionPenalty += signalHierarchy.contradiction_score * (0.12 + (contradictoryMatchCount * 0.04));
    }

    if (observations.has('acute_onset') && observations.has('chronic_duration')) {
        contradictionPenalty += disease.progression_pattern.includes('episodic') ? 0.04 : 0.08;
    }

    if (signalHierarchy.anchor_locks.length > 0 && matchingAnchorLocks.length === 0 && anchorMatchCount === 0 && contextualMatchCount === 0) {
        missingSupportPenalty += 0.12;
    } else if (anchorMatchCount === 0 && contextualMatchCount <= 1 && signalHierarchy.anchor_signals.length > 0) {
        missingSupportPenalty += 0.06;
    }

    if (typeof disease.minimum_key_feature_matches === 'number' && keyMatchCount < disease.minimum_key_feature_matches) {
        rawScore *= anchorMatchCount > 0 || contextualMatchCount > 0 ? 0.56 : 0.34;
        missingSupportPenalty += 0.12;
    }
    if (typeof disease.minimum_feature_match_threshold === 'number' && (keyMatchCount + supportingMatchCount + labMatchCount) < disease.minimum_feature_match_threshold) {
        rawScore *= anchorMatchCount > 0 ? 0.72 : 0.28;
        missingSupportPenalty += 0.14;
    }

    rawScore += diseaseSpecificOverride(disease.id, observations);
    rawScore -= genericDominancePenalty;
    rawScore -= contradictionPenalty;
    rawScore -= missingSupportPenalty;
    rawScore = Math.max(0, Number(rawScore.toFixed(4)));

    return {
        name: disease.name,
        category: disease.category,
        subcategory: disease.subcategory,
        conditionClass: disease.condition_class,
        rawScore,
        probability: 0,
        matchedObservations: [...matchedObservations],
        keyMatchCount,
        supportingMatchCount,
        labMatchCount,
        anchorMatchCount,
        contextualMatchCount,
        genericMatchCount,
        contradictoryMatchCount,
        hierarchySupport: getHierarchySupportMode(anchorMatchCount, contextualMatchCount),
        penalties: {
            contradiction: Number(contradictionPenalty.toFixed(3)),
            generic_dominance: Number(genericDominancePenalty.toFixed(3)),
            missing_support: Number(missingSupportPenalty.toFixed(3)),
            ontology_mismatch: Number(ontologyMismatchPenalty.toFixed(3)),
        },
        anchorLocked: matchingAnchorLocks.length > 0,
        drivers: drivers.sort((left, right) => right.weight - left.weight).slice(0, 5),
    };
}

function emptyScore(disease: DiseaseOntologyEntry): ClosedWorldCandidateScore {
    return {
        name: disease.name,
        category: disease.category,
        subcategory: disease.subcategory,
        conditionClass: disease.condition_class,
        rawScore: 0,
        probability: 0,
        matchedObservations: [],
        keyMatchCount: 0,
        supportingMatchCount: 0,
        labMatchCount: 0,
        anchorMatchCount: 0,
        contextualMatchCount: 0,
        genericMatchCount: 0,
        contradictoryMatchCount: 0,
        hierarchySupport: 'generic_led',
        penalties: {
            contradiction: 0,
            generic_dominance: 0,
            missing_support: 0,
            ontology_mismatch: 0,
        },
        anchorLocked: false,
        drivers: [],
    };
}

function addFeatureWeights(
    observations: Set<string>,
    features: DiseaseFeatureWeight[],
    drivers: Array<{ feature: string; weight: number }>,
    matchedObservations: Set<string>,
    onMatch: (featureWeight: DiseaseFeatureWeight, classification: SignalClassification, weightedValue: number) => void,
) {
    let count = 0;
    for (const featureWeight of features) {
        if (!observations.has(featureWeight.term)) continue;
        count += 1;
        matchedObservations.add(featureWeight.term);
        const classification = classifyObservationTerm(featureWeight.term);
        const weightedValue = featureWeight.weight * getObservationClassificationWeight(classification);
        onMatch(featureWeight, classification, weightedValue);
        drivers.push({
            feature: featureWeight.term.replace(/_/g, ' '),
            weight: Number(weightedValue.toFixed(2)),
        });
    }
    return count;
}

function diseaseSpecificOverride(id: string, observations: Set<string>) {
    if (id === 'gdv') {
        const classicCluster = observations.has('retching_unproductive') && observations.has('abdominal_distension') && observations.has('acute_onset');
        if (classicCluster && observations.has('deep_chested_breed_risk')) return 0.48;
        if (classicCluster) return 0.32;
    }

    if (id === 'rabies' && observations.has('aggression') && observations.has('dysphagia') && observations.has('hypersalivation')) {
        return 0.42;
    }

    if ((id === 'organophosphate-toxicity' || id === 'carbamate-toxicity') && observations.has('miosis') && observations.has('hypersalivation') && observations.has('tremors')) {
        return 0.28;
    }

    if (id === 'anticoagulant-rodenticide-toxicity' && observations.has('rodenticide_exposure') && (observations.has('bleeding') || observations.has('coagulopathy'))) {
        return 0.34;
    }

    if (id === 'diabetes-mellitus') {
        if (observations.has('glucosuria_absent')) return -0.28;
        if (observations.has('significant_hyperglycemia') && observations.has('glucosuria')) {
            return observations.has('ketonuria') ? 0.3 : 0.22;
        }
    }

    if (id === 'hyperadrenocorticism') {
        const endocrineBodyPattern = [
            observations.has('panting'),
            observations.has('alopecia'),
            observations.has('pot_bellied_appearance'),
            observations.has('hypercholesterolemia'),
        ].filter(Boolean).length;
        if (observations.has('marked_alp_elevation') && endocrineBodyPattern >= 2) return 0.2;
        if (observations.has('supportive_acth_stimulation_test')) return 0.34;
    }

    if (id === 'hypoadrenocorticism' && observations.has('collapse') && observations.has('vomiting') && observations.has('diarrhea')) {
        return 0.18;
    }

    if (id === 'pyometra' && observations.has('intact_female') && observations.has('recent_estrus') && observations.has('vaginal_discharge')) {
        return 0.3;
    }

    if (id === 'dystocia' && observations.has('pregnant') && observations.has('labor_not_progressing')) {
        return 0.34;
    }

    if (id === 'mastitis' && observations.has('postpartum') && observations.has('mammary_swelling') && observations.has('mammary_pain')) {
        return 0.26;
    }

    if (id === 'acute-kidney-injury' && observations.has('azotemia') && observations.has('acute_onset')) {
        return 0.16;
    }

    if (id === 'chronic-kidney-disease' && observations.has('azotemia') && observations.has('chronic_duration')) {
        return 0.16;
    }

    return 0;
}

function inferActiveCategories(observations: Set<string>): DiseaseDomain[] {
    const active: DiseaseDomain[] = [];
    for (const [category, triggers] of Object.entries(CATEGORY_TRIGGER_TERMS) as Array<[DiseaseDomain, string[]]>) {
        const hitCount = triggers.reduce((sum, trigger) => sum + (observations.has(trigger) ? 1 : 0), 0);
        if (hitCount >= 2 || (hitCount >= 1 && category === 'Toxicology')) {
            active.push(category);
        }
    }
    return active;
}

function patternToObservation(pattern: DiseaseProgression) {
    if (pattern === 'acute' || pattern === 'hyperacute') return 'acute_onset';
    if (pattern === 'chronic') return 'chronic_duration';
    if (pattern === 'episodic') return 'intermittent_course';
    return 'progressive_worsening';
}

function collectOntologyObservations(input: unknown, observations: Set<string>) {
    if (typeof input === 'string') {
        for (const term of extractObservationTermsFromText(input)) {
            observations.add(term);
        }
        return;
    }

    if (Array.isArray(input)) {
        for (const entry of input) {
            collectOntologyObservations(entry, observations);
        }
        return;
    }

    if (typeof input !== 'object' || input === null) {
        return;
    }

    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        const normalizedKey = normalizeOntologyObservation(key);
        if (typeof value === 'boolean') {
            if (value && normalizedKey) {
                observations.add(normalizedKey);
            }
            continue;
        }

        if (typeof value === 'number') {
            applyNumericHeuristic(key, value, observations);
            continue;
        }

        if (normalizedKey && typeof value === 'string' && value.trim().length > 0) {
            observations.add(normalizedKey);
        }

        collectOntologyObservations(value, observations);
    }
}

function applyNumericHeuristic(key: string, value: number, observations: Set<string>) {
    const normalizedKey = normalizePhrase(key);
    if ((normalizedKey.includes('glucose') || normalizedKey.includes('blood sugar')) && value >= 250) {
        observations.add('significant_hyperglycemia');
    } else if ((normalizedKey.includes('glucose') || normalizedKey.includes('blood sugar')) && value >= 140) {
        observations.add('mild_hyperglycemia');
    }

    if ((normalizedKey.includes('creatinine') || normalizedKey.includes('bun') || normalizedKey.includes('urea')) && value > 2.2) {
        observations.add('azotemia');
    }

    if (normalizedKey.includes('platelet') && value > 0 && value < 150000) {
        observations.add('thrombocytopenia');
    }

    if ((normalizedKey.includes('hematocrit') || normalizedKey.includes('pcv')) && value > 0 && value < 28) {
        observations.add('anemia');
    }
}

function extractObservationTermsFromText(value: string): string[] {
    const normalized = normalizePhrase(value);
    if (!normalized) return [];

    const matches = new Set<string>();
    for (const [alias, canonical] of OBSERVATION_ALIAS_LOOKUP.entries()) {
        if (containsPhrase(normalized, alias)) {
            matches.add(canonical);
        }
    }
    return [...matches];
}

function normalizeOntologyObservation(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = normalizePhrase(value);
    if (!normalized) return null;
    return OBSERVATION_ALIAS_LOOKUP.get(normalized) ?? null;
}

function buildObservationAliasLookup() {
    const lookup = new Map<string, string>();
    for (const entry of ONTOLOGY_OBSERVATION_DICTIONARY) {
        lookup.set(normalizePhrase(entry.term), entry.term);
        for (const alias of entry.aliases) {
            lookup.set(normalizePhrase(alias), entry.term);
        }
    }
    return lookup;
}

function buildDiseaseAliasLookup() {
    const lookup = new Map<string, string>();
    for (const entry of MASTER_DISEASE_ONTOLOGY) {
        lookup.set(normalizePhrase(entry.name), entry.name);
        for (const alias of entry.aliases) {
            lookup.set(normalizePhrase(alias), entry.name);
        }
    }
    return lookup;
}

function normalizePhrase(value: string) {
    return value
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/[^a-z0-9\s']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeSpecies(value: string | null | undefined) {
    const normalized = normalizePhrase(value ?? '');
    if (!normalized) return null;
    const aliases: Record<string, string> = {
        canine: 'dog',
        puppy: 'dog',
        dog: 'dog',
        feline: 'cat',
        kitten: 'cat',
        cat: 'cat',
        equine: 'horse',
        horse: 'horse',
        bovine: 'cow',
        cow: 'cow',
        avian: 'bird',
        bird: 'bird',
    };
    return aliases[normalized] ?? normalized;
}

function containsPhrase(haystack: string, needle: string) {
    return haystack === needle || haystack.includes(` ${needle} `) || haystack.startsWith(`${needle} `) || haystack.endsWith(` ${needle}`);
}

function softmax(values: number[], temperature: number) {
    if (values.length === 0) return [];
    const max = Math.max(...values);
    const exps = values.map((value) => Math.exp((value - max) / temperature));
    const total = exps.reduce((sum, value) => sum + value, 0) || 1;
    return exps.map((value) => Number((value / total).toFixed(6)));
}
