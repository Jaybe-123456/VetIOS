export interface TherapeuticAlternative {
  contraindicatedIn: string[];
  alternatives: { drug: string; reason: string; species?: string[] }[];
  notes: string;
}

export const THERAPEUTIC_ALTERNATIVES: Record<string, TherapeuticAlternative> = {
  carprofen: {
    contraindicatedIn: ['renal_impairment', 'hepatic_disease', 'gi_ulceration', 'coagulopathy'],
    alternatives: [
      { drug: 'buprenorphine', reason: 'Safe opioid analgesic in renal/hepatic disease', species: ['canine', 'feline'] },
      { drug: 'gabapentin', reason: 'Neuropathic and multimodal analgesia, renally cleared but dose-adjustable', species: ['canine', 'feline'] },
      { drug: 'tramadol', reason: 'Moderate analgesia, avoid in seizure-prone patients', species: ['canine'] },
      { drug: 'amantadine', reason: 'NMDA antagonist for chronic pain adjunct', species: ['canine', 'feline'] },
    ],
    notes: 'Multimodal analgesia preferred. Combine gabapentin + buprenorphine for synergistic effect.',
  },
  meloxicam: {
    contraindicatedIn: ['renal_impairment', 'hepatic_disease', 'gi_ulceration', 'feline_ckd_advanced'],
    alternatives: [
      { drug: 'buprenorphine', reason: 'Preferred analgesic in feline CKD', species: ['feline'] },
      { drug: 'gabapentin', reason: 'Safe in CKD with dose reduction', species: ['feline', 'canine'] },
      { drug: 'robenacoxib', reason: 'Short half-life NSAID — lower accumulation risk', species: ['feline'] },
    ],
    notes: 'Low-dose meloxicam (0.01mg/kg q48h) may be acceptable in stable feline CKD after risk-benefit discussion.',
  },
  enrofloxacin: {
    contraindicatedIn: ['feline_high_dose', 'growing_animals', 'severe_renal_impairment'],
    alternatives: [
      { drug: 'marbofloxacin', reason: 'Lower retinal toxicity risk in felines', species: ['feline'] },
      { drug: 'doxycycline', reason: 'Safe in renal failure — hepatic elimination', species: ['canine', 'feline'] },
      { drug: 'amoxicillin_clavulanate', reason: 'Broad spectrum, reduce dose in CKD stage 3+', species: ['canine', 'feline'] },
    ],
    notes: 'Enrofloxacin max 5mg/kg/day in cats — retinal degeneration risk above this dose.',
  },
  acepromazine: {
    contraindicatedIn: ['epilepsy', 'brachycephalic', 'boxer', 'hypovolaemia', 'cardiac_disease'],
    alternatives: [
      { drug: 'midazolam', reason: 'Anxiolysis without vasodilation', species: ['canine', 'feline'] },
      { drug: 'butorphanol', reason: 'Sedation + analgesia combination', species: ['canine', 'feline'] },
      { drug: 'dexmedetomidine_low_dose', reason: 'Reliable sedation, reversible with atipamezole', species: ['canine', 'feline'] },
    ],
    notes: 'Acepromazine has no reversal agent — avoid in unstable patients.',
  },
  phenobarbital: {
    contraindicatedIn: ['hepatic_disease', 'severe_anaemia'],
    alternatives: [
      { drug: 'levetiracetam', reason: 'No hepatic metabolism — safe in liver disease', species: ['canine', 'feline'] },
      { drug: 'zonisamide', reason: 'Good alternative AED, monitor for sulphonamide sensitivity', species: ['canine'] },
      { drug: 'potassium_bromide', reason: 'Adjunct or monotherapy in dogs — not cats', species: ['canine'] },
    ],
    notes: 'Levetiracetam preferred when hepatic disease present. KBr causes pulmonary disease in cats.',
  },
  gentamicin: {
    contraindicatedIn: ['renal_impairment', 'dehydration', 'concurrent_nsaid'],
    alternatives: [
      { drug: 'doxycycline', reason: 'Safe in renal failure', species: ['canine', 'feline'] },
      { drug: 'marbofloxacin', reason: 'Gram-negative coverage without nephrotoxicity', species: ['canine', 'feline'] },
      { drug: 'amoxicillin_clavulanate', reason: 'Broad spectrum alternative', species: ['canine', 'feline'] },
    ],
    notes: 'Aminoglycosides require adequate hydration and renal function. Once-daily dosing reduces nephrotoxicity.',
  },
  ketamine: {
    contraindicatedIn: ['feline_hcm', 'hypertension_uncontrolled', 'head_trauma', 'increased_icp'],
    alternatives: [
      { drug: 'alfaxalone', reason: 'Cardiovascular stability — preferred in cardiac disease', species: ['canine', 'feline'] },
      { drug: 'propofol', reason: 'Smooth induction, titrate carefully', species: ['canine', 'feline'] },
      { drug: 'fentanyl_midazolam', reason: 'TIVA combination for compromised patients', species: ['canine', 'feline'] },
    ],
    notes: 'Ketamine increases heart rate and blood pressure — avoid in HCM and hypertension.',
  },
};