export interface RenalAdjustment {
  stage1: { reduction: number; interval?: string; notes?: string };
  stage2: { reduction: number; interval?: string; notes?: string };
  stage3: { reduction: number; interval?: string; notes?: string };
  stage4: { reduction: number; interval?: string; notes?: string };
  avoid_stage?: number;
}

export const RENAL_DOSE_ADJUSTMENTS: Record<string, RenalAdjustment> = {
  gabapentin: {
    stage1: { reduction: 0, notes: 'Normal dosing' },
    stage2: { reduction: 0.25, notes: 'Reduce by 25%' },
    stage3: { reduction: 0.5, notes: 'Reduce by 50%' },
    stage4: { reduction: 0.75, notes: 'Reduce by 75% or avoid', interval: 'q24h' },
    avoid_stage: 4,
  },
  amoxicillin_clavulanate: {
    stage1: { reduction: 0 },
    stage2: { reduction: 0 },
    stage3: { reduction: 0.25, interval: 'q24h', notes: 'Extend interval to q24h' },
    stage4: { reduction: 0.5, interval: 'q48h', notes: 'Avoid if possible' },
    avoid_stage: 4,
  },
  enrofloxacin: {
    stage1: { reduction: 0 },
    stage2: { reduction: 0.25, notes: 'Reduce dose 25%' },
    stage3: { reduction: 0.5, notes: 'Reduce dose 50%' },
    stage4: { reduction: 0, notes: 'Avoid', interval: 'avoid' },
    avoid_stage: 3,
  },
  atenolol: {
    stage1: { reduction: 0 },
    stage2: { reduction: 0.25 },
    stage3: { reduction: 0.5, interval: 'q24-48h' },
    stage4: { reduction: 0.75, interval: 'q48h', notes: 'Monitor for bradycardia' },
  },
  metronidazole: {
    stage1: { reduction: 0 },
    stage2: { reduction: 0 },
    stage3: { reduction: 0.25, notes: 'Reduce dose 25%' },
    stage4: { reduction: 0.5, notes: 'Reduce dose 50% — neurotoxicity risk' },
  },
  digoxin: {
    stage1: { reduction: 0 },
    stage2: { reduction: 0.25, notes: 'Reduce and monitor levels' },
    stage3: { reduction: 0.5, notes: 'Significantly reduced clearance' },
    stage4: { reduction: 0, notes: 'Avoid — accumulation causes arrhythmia' },
    avoid_stage: 3,
  },
  doxycycline: {
    stage1: { reduction: 0 },
    stage2: { reduction: 0 },
    stage3: { reduction: 0, notes: 'Safe — hepatic elimination' },
    stage4: { reduction: 0, notes: 'Preferred antibiotic in renal failure' },
  },
  buprenorphine: {
    stage1: { reduction: 0 },
    stage2: { reduction: 0 },
    stage3: { reduction: 0, notes: 'Safe — hepatic metabolism' },
    stage4: { reduction: 0, notes: 'Preferred analgesic in CKD' },
  },
  maropitant: {
    stage1: { reduction: 0 },
    stage2: { reduction: 0 },
    stage3: { reduction: 0, notes: 'Safe — hepatic elimination' },
    stage4: { reduction: 0, notes: 'Safe in CKD' },
  },
};