/**
 * VetIOS Clinical Drug Reasoner
 *
 * The pharmacology brain. Takes a full clinical context and proposed drug,
 * returns a structured safety assessment with alternatives.
 *
 * Integrates:
 *   - Drug interaction engine (existing)
 *   - Disease contraindications
 *   - Breed pharmacogenomics
 *   - Renal dose adjustments
 *   - Hepatic dose adjustments
 *   - Therapeutic alternatives
 *   - Black box warnings
 *   - Toxicity thresholds
 */

import { getDrugInteractionEngine, loadExtendedDrugDatabase } from './drugInteractionEngine';
import { DISEASE_CONTRAINDICATIONS } from './data/diseaseContraindications';
import { BREED_DRUG_RISKS } from './data/breedDrugRisks';
import { RENAL_DOSE_ADJUSTMENTS, type RenalAdjustment as RenalAdjData } from './data/renalDoseAdjustments';
import { HEPATIC_DOSE_ADJUSTMENTS } from './data/hepaticDoseAdjustments';
import { THERAPEUTIC_ALTERNATIVES } from './data/therapeuticAlternatives';
import { BLACK_BOX_WARNINGS } from './data/blackBoxWarnings';

// ── Types ──────────────────────────────────────────────────────────────────

export type RenalStage = 1 | 2 | 3 | 4;
export type HepaticSeverity = 'mild' | 'moderate' | 'severe';
export type SafetyLevel = 'safe' | 'caution' | 'avoid' | 'contraindicated';

export interface ClinicalDrugReasonerInput {
  species: string;
  breed?: string;
  age_years?: number;
  weight_kg?: number;
  conditions: string[];
  currentMedications: string[];
  proposedDrug: string;
  renalStage?: RenalStage;
  hepaticSeverity?: HepaticSeverity;
}

export interface DoseAdjustment {
  reduction: number;
  interval?: string;
  notes: string;
}

export interface SafetyFlag {
  type: 'contraindication' | 'interaction' | 'breed_risk' | 'black_box' | 'dose_adjustment';
  severity: SafetyLevel;
  message: string;
  source: string;
}

export interface ClinicalDrugReasonerResult {
  proposed_drug: string;
  species: string;
  breed: string | null;
  overall_safety: SafetyLevel;
  safe: boolean;
  flags: SafetyFlag[];
  dose_adjustments: {
    renal?: DoseAdjustment;
    hepatic?: DoseAdjustment;
  };
  alternatives: { drug: string; reason: string }[];
  black_box_warnings: string[];
  clinical_summary: string;
  confidence: 'high' | 'moderate' | 'low';
}

// ── Initialisation ─────────────────────────────────────────────────────────

let _initialised = false;

async function ensureEngineLoaded(): Promise<void> {
  if (_initialised) return;
  const engine = getDrugInteractionEngine();
  await loadExtendedDrugDatabase(engine);
  _initialised = true;
}

// ── Normalisation helpers ──────────────────────────────────────────────────

function normalise(s: string): string {
  return s.toLowerCase().trim().replace(/[\s-]+/g, '_');
}

function safetyOrder(s: SafetyLevel): number {
  return { safe: 0, caution: 1, avoid: 2, contraindicated: 3 }[s] ?? 0;
}

function highestSafety(levels: SafetyLevel[]): SafetyLevel {
  return levels.reduce((a, b) => safetyOrder(a) >= safetyOrder(b) ? a : b, 'safe');
}

// ── Core reasoner ──────────────────────────────────────────────────────────

export async function runClinicalDrugReasoner(
  input: ClinicalDrugReasonerInput,
): Promise<ClinicalDrugReasonerResult> {
  await ensureEngineLoaded();

  const drug = normalise(input.proposedDrug);
  const species = normalise(input.species);
  const breed = input.breed ? normalise(input.breed) : null;
  const conditions = input.conditions.map(normalise);
  const currentMeds = input.currentMedications.map(normalise);

  const flags: SafetyFlag[] = [];
  const blackBoxWarnings: string[] = [];
  const safetyLevels: SafetyLevel[] = ['safe'];

  // 1. Disease contraindication checks
  for (const condition of conditions) {
    const rule = DISEASE_CONTRAINDICATIONS[condition];
    if (!rule) continue;

    if (rule.avoid.includes(drug)) {
      flags.push({
        type: 'contraindication',
        severity: 'contraindicated',
        message: `${input.proposedDrug} is contraindicated in ${condition}. ${rule.notes}`,
        source: 'disease_contraindications',
      });
      safetyLevels.push('contraindicated');
    } else if (rule.useWithCaution.includes(drug)) {
      flags.push({
        type: 'contraindication',
        severity: 'caution',
        message: `Use ${input.proposedDrug} with caution in ${condition}. ${rule.notes}`,
        source: 'disease_contraindications',
      });
      safetyLevels.push('caution');
    }
  }

  // 2. Breed pharmacogenomic checks
  if (breed) {
    const breedRisk = BREED_DRUG_RISKS[breed];
    if (breedRisk && breedRisk.species === species) {
      if (breedRisk.avoid.includes(drug)) {
        const riskDetail = breedRisk.elevatedRisk.find(r => normalise(r.drug) === drug);
        flags.push({
          type: 'breed_risk',
          severity: 'contraindicated',
          message: riskDetail
            ? `${input.breed}: ${riskDetail.risk}`
            : `${input.proposedDrug} should be avoided in ${input.breed}. ${breedRisk.notes}`,
          source: 'breed_pharmacogenomics',
        });
        safetyLevels.push('contraindicated');
      } else if (breedRisk.useWithCaution.includes(drug)) {
        flags.push({
          type: 'breed_risk',
          severity: 'caution',
          message: `Use ${input.proposedDrug} with caution in ${input.breed}. ${breedRisk.notes}`,
          source: 'breed_pharmacogenomics',
        });
        safetyLevels.push('caution');
      }
    }
  }

  // 3. Drug-drug interaction checks
  const engine = getDrugInteractionEngine();
  if (currentMeds.length > 0) {
    const allDrugs = [...currentMeds, drug];
    const checkResult = engine.check({ drugs: allDrugs, species, conditions });
    for (const interaction of checkResult.interactions) {
      if (interaction.drug1 === drug || interaction.drug2 === drug) {
        const severity: SafetyLevel =
          interaction.severity === 'contraindicated' ? 'contraindicated' :
          interaction.severity === 'major' ? 'avoid' :
          interaction.severity === 'moderate' ? 'caution' : 'safe';
        flags.push({
          type: 'interaction',
          severity,
          message: `Interaction with ${interaction.drug1 === drug ? interaction.drug2 : interaction.drug1}: ${interaction.clinicalEffect}`,
          source: 'drug_interaction_engine',
        });
        safetyLevels.push(severity);
      }
    }
  }

  // 4. Renal dose adjustment
  let renalAdjustment: DoseAdjustment | undefined;
  if (input.renalStage && input.renalStage > 1) {
    const renalRule = RENAL_DOSE_ADJUSTMENTS[drug];
    if (renalRule) {
      const stageKey = `stage${input.renalStage}` as keyof typeof renalRule;
      const adj = renalRule[stageKey] as { reduction: number; interval?: string; notes?: string };
      if (renalRule.avoid_stage && input.renalStage >= renalRule.avoid_stage) {
        flags.push({
          type: 'dose_adjustment',
          severity: 'avoid',
          message: `${input.proposedDrug} should be avoided in CKD stage ${input.renalStage}. ${adj.notes ?? ''}`,
          source: 'renal_dose_adjustments',
        });
        safetyLevels.push('avoid');
      } else if (adj.reduction > 0) {
        renalAdjustment = {
          reduction: adj.reduction,
          interval: adj.interval,
          notes: adj.notes ?? `Reduce dose by ${adj.reduction * 100}% in CKD stage ${input.renalStage}`,
        };
        flags.push({
          type: 'dose_adjustment',
          severity: 'caution',
          message: renalAdjustment.notes,
          source: 'renal_dose_adjustments',
        });
        safetyLevels.push('caution');
      }
    }
  }

  // 5. Hepatic dose adjustment
  let hepaticAdjustment: DoseAdjustment | undefined;
  if (input.hepaticSeverity) {
    const hepaticRule = HEPATIC_DOSE_ADJUSTMENTS[drug];
    if (hepaticRule) {
      const adj = hepaticRule[input.hepaticSeverity];
      if ((adj as { reduction: number; avoid?: boolean; notes: string }).avoid) {
        flags.push({
          type: 'dose_adjustment',
          severity: 'contraindicated',
          message: `${input.proposedDrug} contraindicated in ${input.hepaticSeverity} hepatic disease. ${adj.notes}`,
          source: 'hepatic_dose_adjustments',
        });
        safetyLevels.push('contraindicated');
      } else if (adj.reduction > 0) {
        hepaticAdjustment = {
          reduction: adj.reduction,
          notes: adj.notes,
        };
        flags.push({
          type: 'dose_adjustment',
          severity: 'caution',
          message: adj.notes,
          source: 'hepatic_dose_adjustments',
        });
        safetyLevels.push('caution');
      }
    }
  }

  // 6. Black box warnings
  for (const warning of BLACK_BOX_WARNINGS) {
    if (normalise(warning.drug) === drug || warning.drug.startsWith(drug)) {
      if (!warning.species || warning.species.includes(species)) {
        blackBoxWarnings.push(warning.warning);
        flags.push({
          type: 'black_box',
          severity: 'avoid',
          message: `BLACK BOX: ${warning.warning}`,
          source: 'black_box_warnings',
        });
        safetyLevels.push('avoid');
      }
    }
  }

  // 7. Therapeutic alternatives
  const altRule = THERAPEUTIC_ALTERNATIVES[drug];
  const alternatives = altRule
    ? altRule.alternatives
        .filter(a => !a.species || a.species.includes(species))
        .map(a => ({ drug: a.drug, reason: a.reason }))
    : [];

  // 8. Overall safety
  const overallSafety = highestSafety(safetyLevels);
  const safe = overallSafety === 'safe' || overallSafety === 'caution';

  // 9. Clinical summary
  const summary = buildSummary(input, overallSafety, flags, renalAdjustment, hepaticAdjustment, alternatives);

  // 10. Confidence
  const confidence = flags.length === 0 ? 'high' : flags.some(f => f.severity === 'contraindicated') ? 'high' : 'moderate';

  return {
    proposed_drug: input.proposedDrug,
    species: input.species,
    breed: input.breed ?? null,
    overall_safety: overallSafety,
    safe,
    flags,
    dose_adjustments: {
      renal: renalAdjustment,
      hepatic: hepaticAdjustment,
    },
    alternatives,
    black_box_warnings: blackBoxWarnings,
    clinical_summary: summary,
    confidence,
  };
}

function buildSummary(
  input: ClinicalDrugReasonerInput,
  safety: SafetyLevel,
  flags: SafetyFlag[],
  renal?: DoseAdjustment,
  hepatic?: DoseAdjustment,
  alternatives?: { drug: string; reason: string }[],
): string {
  const parts: string[] = [];
  parts.push(`${input.proposedDrug} in ${input.species}${input.breed ? ` (${input.breed})` : ''}: overall safety — ${safety.toUpperCase()}.`);

  const critical = flags.filter(f => f.severity === 'contraindicated');
  const warnings = flags.filter(f => f.severity === 'avoid' || f.severity === 'caution');

  if (critical.length > 0) {
    parts.push(`⛔ CONTRAINDICATED: ${critical.map(f => f.message).join(' | ')}`);
  }
  if (warnings.length > 0) {
    parts.push(`⚠ Warnings: ${warnings.map(f => f.message).join(' | ')}`);
  }
  if (renal) {
    parts.push(`Renal adjustment: ${renal.notes}`);
  }
  if (hepatic) {
    parts.push(`Hepatic adjustment: ${hepatic.notes}`);
  }
  if (alternatives && alternatives.length > 0 && safety !== 'safe') {
    parts.push(`Consider instead: ${alternatives.slice(0, 3).map(a => a.drug).join(', ')}.`);
  }
  if (safety === 'safe') {
    parts.push('No significant safety concerns identified for this patient profile.');
  }

  return parts.join(' ');
}