import type { InteractionSeverity } from '../drugInteractionEngine';

export interface DiseaseContraindication {
  avoid: string[];
  useWithCaution: string[];
  preferred: string[];
  notes: string;
}

export const DISEASE_CONTRAINDICATIONS: Record<string, DiseaseContraindication> = {
  chronic_kidney_disease: {
    avoid: ['carprofen', 'meloxicam', 'ketoprofen', 'aspirin', 'gentamicin', 'amikacin', 'digoxin', 'metformin', 'tetracycline'],
    useWithCaution: ['gabapentin', 'atenolol', 'benazepril', 'enrofloxacin', 'metronidazole'],
    preferred: ['buprenorphine', 'maropitant', 'omeprazole', 'amlodipine', 'darbepoetin'],
    notes: 'Reduce doses of renally-excreted drugs. Avoid nephrotoxic agents. Monitor BUN/creatinine.',
  },
  hepatic_disease: {
    avoid: ['methadone', 'diazepam_oral', 'carprofen', 'acetaminophen', 'tetracycline', 'stanozolol'],
    useWithCaution: ['metronidazole', 'phenobarbital', 'chloramphenicol', 'ketoconazole', 'meloxicam'],
    preferred: ['lactulose', 'ursodiol', 'milk_thistle', 'maropitant', 'buprenorphine'],
    notes: 'Hepatically-metabolised drugs accumulate. Reduce doses 25-50%. Monitor liver enzymes.',
  },
  feline_hcm: {
    avoid: ['ketamine', 'pimobendan', 'high_fluid_rate', 'methylprednisolone', 'dexamethasone'],
    useWithCaution: ['propofol', 'dexmedetomidine', 'atropine', 'glycopyrrolate'],
    preferred: ['atenolol', 'diltiazem', 'clopidogrel', 'buprenorphine', 'butorphanol'],
    notes: 'Avoid tachycardia and increased cardiac workload. Clopidogrel for thromboprophylaxis.',
  },
  diabetes_mellitus: {
    avoid: ['prednisolone', 'dexamethasone', 'megestrol_acetate', 'progestins'],
    useWithCaution: ['phenobarbital', 'cyclosporine', 'l_asparaginase'],
    preferred: ['insulin', 'metformin_canine', 'acarbose'],
    notes: 'Corticosteroids cause insulin resistance. Monitor glucose closely if steroids required.',
  },
  gi_ulceration: {
    avoid: ['carprofen', 'meloxicam', 'aspirin', 'ketoprofen', 'dexamethasone', 'prednisolone'],
    useWithCaution: ['enrofloxacin', 'metronidazole'],
    preferred: ['omeprazole', 'sucralfate', 'maropitant', 'famotidine', 'misoprostol'],
    notes: 'NSAIDs and corticosteroids deplete gastroprotective prostaglandins.',
  },
  coagulopathy: {
    avoid: ['aspirin', 'carprofen', 'meloxicam', 'heparin_concurrent_nsaid', 'warfarin_concurrent_nsaid'],
    useWithCaution: ['enrofloxacin', 'cephalosporins', 'chloramphenicol'],
    preferred: ['buprenorphine', 'tramadol', 'gabapentin', 'vitamin_k1'],
    notes: 'NSAIDs impair platelet function. Monitor PT/PTT. Fresh frozen plasma if bleeding.',
  },
  hypertension: {
    avoid: ['pseudoephedrine', 'phenylpropanolamine_high_dose', 'ketamine_sole_agent'],
    useWithCaution: ['dexmedetomidine', 'ketamine', 'ephedrine'],
    preferred: ['amlodipine', 'benazepril', 'telmisartan', 'atenolol'],
    notes: 'Target BP <160 mmHg systolic. Amlodipine first-line feline. ACE inhibitors if proteinuria.',
  },
  epilepsy: {
    avoid: ['acepromazine', 'tramadol_high_dose', 'metronidazole_high_dose', 'ketamine_sole_agent'],
    useWithCaution: ['propofol', 'alfaxalone', 'opioids'],
    preferred: ['phenobarbital', 'levetiracetam', 'potassium_bromide', 'zonisamide', 'diazepam_rectal'],
    notes: 'Acepromazine lowers seizure threshold. Use levetiracetam for cluster seizures.',
  },
  respiratory_disease: {
    avoid: ['high_dose_opioids_unmonitored', 'acepromazine_severe_dyspnoea'],
    useWithCaution: ['butorphanol', 'morphine', 'dexmedetomidine'],
    preferred: ['terbutaline', 'theophylline', 'fluticasone', 'buprenorphine', 'maropitant'],
    notes: 'Opioids cause respiratory depression. Oxygen supplementation essential perioperatively.',
  },
  cardiac_disease_general: {
    avoid: ['high_fluid_rates', 'dexamethasone_chronic', 'nsaids_concurrent_ace'],
    useWithCaution: ['ketamine', 'tiletamine', 'dexmedetomidine'],
    preferred: ['fentanyl', 'midazolam', 'propofol_cci', 'pimobendan_dilated', 'furosemide'],
    notes: 'Avoid agents that increase preload/afterload. Monitor ECG. Titrate to effect.',
  },
  hyperadrenocorticism: {
    avoid: ['corticosteroids', 'progestins', 'megestrol_acetate'],
    useWithCaution: ['ketoconazole', 'phenobarbital'],
    preferred: ['trilostane', 'mitotane', 'cabergoline'],
    notes: 'Exogenous steroids worsen cortisol excess. Trilostane first-line treatment.',
  },
  hypoadrenocorticism: {
    avoid: ['loop_diuretics_without_replacement', 'ace_inhibitors_crisis'],
    useWithCaution: ['diuretics', 'antihypertensives'],
    preferred: ['dexamethasone_crisis', 'fludrocortisone', 'prednisolone_maintenance', 'iv_saline'],
    notes: 'Crisis management: IV saline + dexamethasone immediately. Do not delay treatment.',
  },
};