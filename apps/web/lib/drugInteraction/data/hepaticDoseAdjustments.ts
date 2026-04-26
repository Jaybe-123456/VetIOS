export interface HepaticAdjustment {
  mild: { reduction: number; avoid?: boolean; notes: string };
  moderate: { reduction: number; avoid?: boolean; notes: string };
  severe: { reduction: number; avoid?: boolean; notes: string };
}

export const HEPATIC_DOSE_ADJUSTMENTS: Record<string, HepaticAdjustment> = {
  metronidazole: {
    mild: { reduction: 0, notes: 'Normal dosing' },
    moderate: { reduction: 0.25, notes: 'Reduce by 25% — monitor for neurotoxicity' },
    severe: { reduction: 0.5, notes: 'Reduce by 50% or avoid — accumulation risk' },
  },
  methadone: {
    mild: { reduction: 0.25, notes: 'Reduce by 25%' },
    moderate: { reduction: 0.5, notes: 'Reduce by 50% — prolonged sedation risk' },
    severe: { reduction: 0, avoid: true, notes: 'Avoid — severe accumulation, encephalopathy risk' },
  },
  phenobarbital: {
    mild: { reduction: 0, notes: 'Monitor LFTs monthly' },
    moderate: { reduction: 0.25, notes: 'Reduce dose, monitor levels closely' },
    severe: { reduction: 0, avoid: true, notes: 'Avoid — hepatotoxic and relies on hepatic metabolism' },
  },
  diazepam_oral: {
    mild: { reduction: 0.25, notes: 'Reduce by 25%' },
    moderate: { reduction: 0.5, notes: 'Reduce by 50% — accumulation of active metabolites' },
    severe: { reduction: 0, avoid: true, notes: 'Avoid oral diazepam — hepatic necrosis in cats' },
  },
  ketamine: {
    mild: { reduction: 0, notes: 'Normal dosing with monitoring' },
    moderate: { reduction: 0.25, notes: 'Reduce induction dose 25%' },
    severe: { reduction: 0.5, notes: 'Reduce by 50% — prolonged recovery' },
  },
  carprofen: {
    mild: { reduction: 0, notes: 'Monitor LFTs' },
    moderate: { reduction: 0, avoid: true, notes: 'Avoid — hepatotoxicity risk elevated' },
    severe: { reduction: 0, avoid: true, notes: 'Contraindicated — severe hepatotoxicity risk' },
  },
  chloramphenicol: {
    mild: { reduction: 0.25, notes: 'Reduce by 25%' },
    moderate: { reduction: 0.5, notes: 'Reduce by 50%' },
    severe: { reduction: 0, avoid: true, notes: 'Avoid — severe myelosuppression risk' },
  },
  ketoconazole: {
    mild: { reduction: 0, notes: 'Monitor LFTs' },
    moderate: { reduction: 0.5, notes: 'Reduce by 50% — hepatotoxic' },
    severe: { reduction: 0, avoid: true, notes: 'Avoid — significant hepatotoxicity' },
  },
  cyclosporine: {
    mild: { reduction: 0, notes: 'Monitor levels and LFTs' },
    moderate: { reduction: 0.25, notes: 'Reduce by 25% — monitor trough levels' },
    severe: { reduction: 0.5, notes: 'Reduce by 50% — hepatic metabolism impaired' },
  },
  doxycycline: {
    mild: { reduction: 0, notes: 'Safe' },
    moderate: { reduction: 0.25, notes: 'Mild reduction, monitor LFTs' },
    severe: { reduction: 0.5, notes: 'Reduce by 50% — hepatic elimination' },
  },
  buprenorphine: {
    mild: { reduction: 0, notes: 'Normal dosing' },
    moderate: { reduction: 0.25, notes: 'Reduce by 25%' },
    severe: { reduction: 0.5, notes: 'Reduce by 50% — preferred opioid in liver disease' },
  },
  maropitant: {
    mild: { reduction: 0, notes: 'Normal dosing' },
    moderate: { reduction: 0.25, notes: 'Reduce by 25%' },
    severe: { reduction: 0.5, notes: 'Reduce by 50% — hepatic metabolism' },
  },
};