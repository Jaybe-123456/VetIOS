export interface BreedRisk {
  species: string;
  knownMutations: string[];
  avoid: string[];
  useWithCaution: string[];
  elevatedRisk: { drug: string; risk: string }[];
  notes: string;
}

export const BREED_DRUG_RISKS: Record<string, BreedRisk> = {
  collie: {
    species: 'canine',
    knownMutations: ['MDR1/ABCB1'],
    avoid: ['ivermectin', 'milbemycin', 'loperamide', 'vincristine', 'doxorubicin', 'acepromazine_high_dose', 'butorphanol_high_dose'],
    useWithCaution: ['selamectin', 'moxidectin', 'fentanyl', 'ondansetron'],
    elevatedRisk: [
      { drug: 'ivermectin', risk: 'CNS toxicity — MDR1 mutation allows ivermectin brain penetration' },
      { drug: 'loperamide', risk: 'CNS depression — p-glycoprotein deficiency' },
    ],
    notes: 'Test for MDR1 mutation before using P-glycoprotein substrate drugs. Dose reductions required.',
  },
  shetland_sheepdog: {
    species: 'canine',
    knownMutations: ['MDR1/ABCB1'],
    avoid: ['ivermectin', 'milbemycin', 'loperamide', 'vincristine'],
    useWithCaution: ['moxidectin', 'selamectin'],
    elevatedRisk: [
      { drug: 'ivermectin', risk: 'CNS toxicity — MDR1 mutation' },
    ],
    notes: 'Same MDR1 risk profile as Collie. Genetic testing recommended.',
  },
  australian_shepherd: {
    species: 'canine',
    knownMutations: ['MDR1/ABCB1'],
    avoid: ['ivermectin', 'loperamide', 'vincristine'],
    useWithCaution: ['moxidectin', 'fentanyl'],
    elevatedRisk: [
      { drug: 'ivermectin', risk: 'CNS toxicity — MDR1 mutation' },
    ],
    notes: 'MDR1 prevalence ~50% in breed. Always test before antiparasitic therapy.',
  },
  labrador_retriever: {
    species: 'canine',
    knownMutations: ['POMC_obesity'],
    avoid: [],
    useWithCaution: ['carprofen', 'phenobarbital'],
    elevatedRisk: [
      { drug: 'carprofen', risk: 'Idiosyncratic hepatotoxicity — higher incidence than other breeds' },
      { drug: 'phenobarbital', risk: 'Hepatotoxicity with long-term use' },
    ],
    notes: 'Monitor LFTs q6 months on carprofen or phenobarbital. Baseline LFTs before starting.',
  },
  boxer: {
    species: 'canine',
    knownMutations: [],
    avoid: ['acepromazine'],
    useWithCaution: ['dexmedetomidine', 'ketamine'],
    elevatedRisk: [
      { drug: 'acepromazine', risk: 'Severe hypotension and vasovagal syncope — brachycephalic airway risk' },
    ],
    notes: 'Brachycephalic breed. Avoid acepromazine. Pre-oxygenate before induction.',
  },
  bulldog: {
    species: 'canine',
    knownMutations: [],
    avoid: ['acepromazine', 'high_dose_sedatives_unmonitored'],
    useWithCaution: ['opioids', 'propofol'],
    elevatedRisk: [
      { drug: 'acepromazine', risk: 'Respiratory compromise in brachycephalic airway' },
    ],
    notes: 'Brachycephalic obstructive airway syndrome. Intubate early. Recover in sternal position.',
  },
  greyhound: {
    species: 'canine',
    knownMutations: ['low_body_fat', 'CYP2B11_deficiency'],
    avoid: ['thiopental'],
    useWithCaution: ['propofol', 'ketamine', 'barbiturates'],
    elevatedRisk: [
      { drug: 'propofol', risk: 'Prolonged recovery — reduced hepatic CYP2B11 metabolism' },
      { drug: 'thiopental', risk: 'Severely prolonged recovery — minimal body fat redistribution' },
    ],
    notes: 'Sighthound metabolism differs. Use lower doses. Titrate propofol slowly. Extended recovery monitoring.',
  },
  doberman_pinscher: {
    species: 'canine',
    knownMutations: ['DCM_PDK4', 'VWD'],
    avoid: ['nsaids_concurrent_anticoagulant'],
    useWithCaution: ['aspirin', 'carprofen', 'warfarin'],
    elevatedRisk: [
      { drug: 'aspirin', risk: 'von Willebrand disease — bleeding risk' },
      { drug: 'carprofen', risk: 'Antiplatelet effect compounded by vWD' },
    ],
    notes: 'Screen for vWD before surgery. Dilated cardiomyopathy risk — cardiac monitoring recommended.',
  },
  persian: {
    species: 'feline',
    knownMutations: ['PKD1'],
    avoid: ['nephrotoxic_aminoglycosides', 'high_dose_nsaids'],
    useWithCaution: ['enrofloxacin', 'gentamicin'],
    elevatedRisk: [
      { drug: 'gentamicin', risk: 'Polycystic kidney disease increases nephrotoxicity risk' },
    ],
    notes: 'PKD1 mutation in ~40% of Persians. Renal function monitoring essential. Avoid nephrotoxins.',
  },
  siamese: {
    species: 'feline',
    knownMutations: [],
    avoid: [],
    useWithCaution: ['propofol_prolonged', 'ketamine'],
    elevatedRisk: [
      { drug: 'propofol', risk: 'Higher incidence of Heinz body anaemia with repeat propofol dosing' },
    ],
    notes: 'Sensitive to oxidative stress. Avoid repeat propofol infusions. Use alfaxalone as alternative.',
  },
  maine_coon: {
    species: 'feline',
    knownMutations: ['HCM_MYBPC3'],
    avoid: ['ketamine_sole_agent', 'pimobendan', 'high_fluid_rates'],
    useWithCaution: ['dexmedetomidine', 'ketamine', 'atropine'],
    elevatedRisk: [
      { drug: 'ketamine', risk: 'Tachycardia worsens HCM — increased myocardial oxygen demand' },
    ],
    notes: 'HCM prevalence high. Echocardiogram before GA. Atenolol or diltiazem for rate control.',
  },
  birman: {
    species: 'feline',
    knownMutations: ['neutropenia_hereditary'],
    avoid: [],
    useWithCaution: ['myelosuppressive_chemotherapy', 'chloramphenicol'],
    elevatedRisk: [
      { drug: 'chloramphenicol', risk: 'Pre-existing neutropenia increases infection risk' },
    ],
    notes: 'Hereditary neutropenia. Check CBC before myelosuppressive therapy.',
  },
};