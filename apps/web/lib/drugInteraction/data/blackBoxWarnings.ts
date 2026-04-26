export interface BlackBoxWarning {
  drug: string;
  warning: string;
  species?: string[];
  humanSafetyRisk?: boolean;
  requiresSpecialHandling: boolean;
  handlingNotes?: string;
}

export const BLACK_BOX_WARNINGS: BlackBoxWarning[] = [
  {
    drug: 'vincristine',
    warning: 'Fatal if administered intrathecally. For IV use only. Verify route before administration.',
    requiresSpecialHandling: true,
    handlingNotes: 'Must be labelled "For intravenous use only — fatal if given intrathecally"',
  },
  {
    drug: 'chloramphenicol',
    warning: 'Can cause aplastic anaemia in humans handling the drug. Gloves mandatory. Do not use in food animals.',
    humanSafetyRisk: true,
    requiresSpecialHandling: true,
    handlingNotes: 'Wear gloves and eye protection. Pregnant women must not handle.',
  },
  {
    drug: 'cisplatin',
    warning: 'Fatal in cats — do not use in feline patients under any circumstances.',
    species: ['feline'],
    requiresSpecialHandling: true,
    handlingNotes: 'Cytotoxic — PPE required. Fatal pulmonary oedema in cats.',
  },
  {
    drug: 'doxorubicin',
    warning: 'Cardiotoxic — cumulative dose-dependent cardiomyopathy. Vesicant — severe tissue necrosis if extravasation occurs.',
    requiresSpecialHandling: true,
    handlingNotes: 'Cytotoxic — full PPE. Use central line or confirmed IV catheter. Monitor cardiac function.',
  },
  {
    drug: 'cyclophosphamide',
    warning: 'Haemorrhagic cystitis risk. Ensure adequate hydration and frequent urination. Myelosuppressive.',
    requiresSpecialHandling: true,
    handlingNotes: 'Cytotoxic — PPE required. Furosemide co-administration reduces cystitis risk.',
  },
  {
    drug: 'ivermectin_high_dose',
    warning: 'CNS toxicity in MDR1-mutant breeds (Collies, Shelties, Australian Shepherds). Test before use.',
    species: ['canine'],
    requiresSpecialHandling: false,
    handlingNotes: 'Genetic testing for MDR1/ABCB1 mutation recommended before high-dose use.',
  },
  {
    drug: 'diazepam_oral_feline',
    warning: 'Oral diazepam associated with fatal hepatic necrosis in cats. Use IV formulation only if essential.',
    species: ['feline'],
    requiresSpecialHandling: false,
    handlingNotes: 'Use rectal or IV route only in cats. Monitor LFTs if repeat dosing required.',
  },
  {
    drug: 'enrofloxacin_feline',
    warning: 'Doses above 5mg/kg/day cause irreversible retinal degeneration and blindness in cats.',
    species: ['feline'],
    requiresSpecialHandling: false,
    handlingNotes: 'Maximum 5mg/kg/day in cats. Use marbofloxacin as safer alternative.',
  },
  {
    drug: 'metronidazole_high_dose',
    warning: 'Neurotoxicity at doses above 60mg/kg/day — ataxia, seizures, encephalopathy.',
    requiresSpecialHandling: false,
    handlingNotes: 'Standard doses (10-15mg/kg q12h) are safe. Never exceed 60mg/kg/day.',
  },
  {
    drug: 'propylene_glycol',
    warning: 'Causes Heinz body anaemia in cats. Found in some injectable formulations and foods.',
    species: ['feline'],
    requiresSpecialHandling: false,
    handlingNotes: 'Check excipients of injectable drugs. Avoid semi-moist cat foods containing propylene glycol.',
  },
];