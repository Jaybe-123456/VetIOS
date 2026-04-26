export interface ToxicityThreshold {
  species: string;
  toxic_dose_mg_per_kg?: number;
  lethal_dose_mg_per_kg?: number;
  clinical_signs: string[];
  antidote?: string;
  emergency_treatment: string[];
  notes: string;
}

export const TOXICITY_THRESHOLDS: Record<string, ToxicityThreshold[]> = {
  acetaminophen: [
    {
      species: 'feline',
      toxic_dose_mg_per_kg: 10,
      lethal_dose_mg_per_kg: 50,
      clinical_signs: ['methaemoglobinaemia', 'facial_oedema', 'chocolate_brown_blood', 'dyspnoea', 'hepatic_necrosis'],
      antidote: 'n_acetylcysteine',
      emergency_treatment: ['n_acetylcysteine_IV', 'ascorbic_acid', 'oxygen', 'supportive_care'],
      notes: 'Cats lack glucuronidation — highly susceptible. Even 1 tablet can be fatal.',
    },
    {
      species: 'canine',
      toxic_dose_mg_per_kg: 100,
      lethal_dose_mg_per_kg: 500,
      clinical_signs: ['vomiting', 'hepatic_necrosis', 'methaemoglobinaemia'],
      antidote: 'n_acetylcysteine',
      emergency_treatment: ['n_acetylcysteine_IV', 'supportive_care', 'liver_support'],
      notes: 'Dogs more tolerant than cats but still hepatotoxic at high doses.',
    },
  ],
  ibuprofen: [
    {
      species: 'canine',
      toxic_dose_mg_per_kg: 8,
      lethal_dose_mg_per_kg: 600,
      clinical_signs: ['vomiting', 'gi_ulceration', 'renal_failure', 'neurologic_signs', 'seizures'],
      emergency_treatment: ['emesis_if_recent', 'activated_charcoal', 'iv_fluids', 'omeprazole', 'sucralfate', 'misoprostol'],
      notes: 'GI ulceration at 8mg/kg, renal failure at 25mg/kg, neurologic at 175mg/kg.',
    },
    {
      species: 'feline',
      toxic_dose_mg_per_kg: 4,
      clinical_signs: ['vomiting', 'renal_failure', 'gi_ulceration'],
      emergency_treatment: ['emesis_if_recent', 'activated_charcoal', 'iv_fluids', 'gastroprotection'],
      notes: 'Highly toxic to cats. Any dose should be treated as emergency.',
    },
  ],
  xylitol: [
    {
      species: 'canine',
      toxic_dose_mg_per_kg: 0.1,
      lethal_dose_mg_per_kg: 0.5,
      clinical_signs: ['hypoglycaemia', 'vomiting', 'weakness', 'seizures', 'hepatic_necrosis'],
      emergency_treatment: ['emesis_if_recent', 'iv_dextrose', 'liver_support', 'monitoring_48h'],
      notes: 'Found in sugar-free gum, peanut butter, toothpaste. Insulin release causes profound hypoglycaemia.',
    },
  ],
  permethrin: [
    {
      species: 'feline',
      toxic_dose_mg_per_kg: 0.5,
      clinical_signs: ['muscle_tremors', 'hypersalivation', 'seizures', 'hyperthermia', 'death'],
      emergency_treatment: ['bath_remove_product', 'methocarbamol_tremors', 'diazepam_seizures', 'iv_fluids', 'cooling'],
      notes: 'Cat-specific toxicity from canine flea products. Rapid onset. Emergency treatment required.',
    },
  ],
  metaldehyde: [
    {
      species: 'canine',
      toxic_dose_mg_per_kg: 100,
      clinical_signs: ['muscle_tremors', 'hyperthermia', 'tachycardia', 'acidosis', 'liver_failure'],
      emergency_treatment: ['emesis_if_recent', 'diazepam_tremors', 'cooling', 'iv_fluids', 'liver_support'],
      notes: 'Slug bait toxicity. No antidote. Supportive care. High mortality if severe.',
    },
  ],
  rat_poison_anticoagulant: [
    {
      species: 'canine',
      toxic_dose_mg_per_kg: 0.02,
      clinical_signs: ['bleeding', 'haematoma', 'haemothorax', 'epistaxis', 'anaemia'],
      antidote: 'vitamin_k1',
      emergency_treatment: ['vitamin_k1_oral_or_sq', 'fresh_frozen_plasma', 'whole_blood_transfusion', 'oxygen'],
      notes: 'Brodifacoum persists 4-6 weeks. Vitamin K1 for 4-6 weeks minimum. Check PT/PTT 48h after stopping.',
    },
  ],
  ethylene_glycol: [
    {
      species: 'canine',
      toxic_dose_mg_per_kg: 4.4,
      lethal_dose_mg_per_kg: 6.6,
      clinical_signs: ['ataxia', 'vomiting', 'polydipsia', 'acute_renal_failure', 'calcium_oxalate_crystals'],
      antidote: 'fomepizole_4mp',
      emergency_treatment: ['fomepizole_IV_dog', 'ethanol_IV_cat', 'iv_fluids', 'dialysis'],
      notes: 'Antifreeze. Treat within 3h for best outcome. Fomepizole for dogs, ethanol for cats.',
    },
    {
      species: 'feline',
      toxic_dose_mg_per_kg: 1.5,
      lethal_dose_mg_per_kg: 2.0,
      clinical_signs: ['ataxia', 'vomiting', 'acute_renal_failure'],
      antidote: 'ethanol',
      emergency_treatment: ['ethanol_IV', 'iv_fluids', 'dialysis'],
      notes: 'Cats highly sensitive. Fomepizole less effective in cats — use ethanol.',
    },
  ],
  chocolate: [
    {
      species: 'canine',
      toxic_dose_mg_per_kg: 20,
      clinical_signs: ['vomiting', 'diarrhoea', 'tachycardia', 'tremors', 'seizures', 'death'],
      emergency_treatment: ['emesis_if_recent', 'activated_charcoal', 'iv_fluids', 'diazepam_seizures', 'beta_blockers_tachycardia'],
      notes: 'Theobromine content varies: dark chocolate most toxic, milk chocolate moderate, white minimal.',
    },
  ],
};