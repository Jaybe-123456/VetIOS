export interface ReversalAgent {
  reverses: string[];
  dose_mg_per_kg?: string;
  route: string[];
  onset_minutes: number;
  duration_minutes: number;
  notes: string;
  species?: string[];
}

export const REVERSAL_AGENTS: Record<string, ReversalAgent> = {
  atipamezole: {
    reverses: ['medetomidine', 'dexmedetomidine', 'xylazine', 'romifidine'],
    dose_mg_per_kg: '5x the medetomidine dose (micrograms)',
    route: ['IM', 'IV_slow'],
    onset_minutes: 5,
    duration_minutes: 60,
    notes: 'Alpha-2 antagonist. Same volume as medetomidine given IM. Resedation can occur — monitor 1h.',
    species: ['canine', 'feline'],
  },
  naloxone: {
    reverses: ['morphine', 'methadone', 'fentanyl', 'buprenorphine', 'butorphanol', 'tramadol', 'hydromorphone'],
    dose_mg_per_kg: '0.01-0.04',
    route: ['IV', 'IM', 'intranasal'],
    onset_minutes: 2,
    duration_minutes: 30,
    notes: 'Short duration — repeat dosing needed for long-acting opioids. Reverses analgesia — manage pain after.',
    species: ['canine', 'feline'],
  },
  flumazenil: {
    reverses: ['diazepam', 'midazolam', 'zolazepam'],
    dose_mg_per_kg: '0.01',
    route: ['IV'],
    onset_minutes: 1,
    duration_minutes: 30,
    notes: 'Benzodiazepine antagonist. Short duration — resedation risk. Repeat dosing may be needed.',
    species: ['canine', 'feline'],
  },
  vitamin_k1: {
    reverses: ['warfarin', 'brodifacoum', 'bromadiolone', 'anticoagulant_rodenticides'],
    dose_mg_per_kg: '2.5-5 q12h',
    route: ['PO', 'SQ'],
    onset_minutes: 360,
    duration_minutes: 43200,
    notes: 'Oral preferred (less anaphylaxis risk than IV). Duration 4-6 weeks for second-generation rodenticides. Monitor PT/PTT.',
    species: ['canine', 'feline'],
  },
  fomepizole: {
    reverses: ['ethylene_glycol'],
    dose_mg_per_kg: '15 loading then 5 q12h',
    route: ['IV'],
    onset_minutes: 30,
    duration_minutes: 720,
    notes: 'Alcohol dehydrogenase inhibitor. Dogs only — less effective in cats. Treat within 3-8h for best outcome.',
    species: ['canine'],
  },
  n_acetylcysteine: {
    reverses: ['acetaminophen', 'paracetamol'],
    dose_mg_per_kg: '140 loading then 70 q6h x7',
    route: ['IV', 'PO'],
    onset_minutes: 60,
    duration_minutes: 2880,
    notes: 'Glutathione precursor. Dilute 5% solution for IV. Continue for 48h minimum. Essential in feline acetaminophen toxicity.',
    species: ['canine', 'feline'],
  },
  neostigmine: {
    reverses: ['non_depolarising_neuromuscular_blockers', 'atracurium', 'vecuronium'],
    dose_mg_per_kg: '0.04',
    route: ['IV'],
    onset_minutes: 5,
    duration_minutes: 60,
    notes: 'Give with glycopyrrolate (0.01mg/kg) to prevent bradycardia. Only reverses non-depolarising agents.',
    species: ['canine', 'feline'],
  },
  protamine_sulphate: {
    reverses: ['heparin'],
    dose_mg_per_kg: '1mg per 100 units heparin',
    route: ['IV_slow'],
    onset_minutes: 5,
    duration_minutes: 120,
    notes: 'Give slowly IV — rapid infusion causes hypotension. 1mg neutralises ~100 units heparin.',
    species: ['canine', 'feline'],
  },
  calcium_gluconate: {
    reverses: ['hyperkalaemia', 'hypocalcaemia', 'calcium_channel_blocker_toxicity'],
    dose_mg_per_kg: '50-100',
    route: ['IV_slow'],
    onset_minutes: 2,
    duration_minutes: 30,
    notes: 'Cardiac membrane stabiliser. Does not lower K+ — use with glucose/insulin. Monitor ECG during infusion.',
    species: ['canine', 'feline'],
  },
};