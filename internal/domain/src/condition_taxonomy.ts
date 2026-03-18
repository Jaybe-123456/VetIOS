/**
 * @vetios/domain — Condition Taxonomy (Fix 1)
 *
 * Replaces the flawed "Primary Pathogen" classification with a clinically
 * correct multi-class taxonomy. GDV is a mechanical emergency — not a pathogen.
 *
 * Old (wrong):  Primary Pathogen | Secondary Opportunistic | Autoimmune
 * New (correct): ConditionClass with 6 top-level categories
 */

// ─── Condition Classes ────────────────────────────────────────────────────────

export type ConditionClass =
  | 'mechanical_emergency'   // GDV, torsion, obstruction, fracture — surgical first
  | 'infectious'             // Bacterial, viral, fungal, parasitic
  | 'inflammatory_autoimmune'// IBD, IMHA, polyarthritis, pemphigus
  | 'metabolic_toxic'        // DKA, hepatic lipidosis, toxin ingestion
  | 'neoplastic'             // Tumours, masses, paraneoplastic syndromes
  | 'cardiovascular_shock';  // Heart failure, haemorrhage, distributive shock

export interface ConditionClassification {
  /** Primary condition class — replaces "Primary Pathogen" */
  primary_class: ConditionClass;
  /** Human-readable label for display */
  primary_label: string;
  /** Probability 0–1 from model output */
  primary_probability: number;
  /** Optional second-most likely class */
  secondary_class?: ConditionClass;
  secondary_probability?: number;
  /** Optional third */
  tertiary_class?: ConditionClass;
  tertiary_probability?: number;
  /** Whether this class mandates immediate surgical/emergency triage */
  requires_emergency_triage: boolean;
}

// ─── Taxonomy metadata ────────────────────────────────────────────────────────

export const CONDITION_CLASS_LABELS: Record<ConditionClass, string> = {
  mechanical_emergency: 'Acute mechanical emergency',
  infectious: 'Infectious disease',
  inflammatory_autoimmune: 'Inflammatory / autoimmune',
  metabolic_toxic: 'Metabolic / toxic',
  neoplastic: 'Neoplastic',
  cardiovascular_shock: 'Cardiovascular / shock',
};

/** Classes that immediately mandate emergency-level triage override. */
export const EMERGENCY_TRIAGE_CLASSES: ConditionClass[] = [
  'mechanical_emergency',
  'cardiovascular_shock',
];

/**
 * Maps legacy "Primary Pathogen" probability vectors onto the new taxonomy.
 * Used during migration to preserve backward compatibility with existing model weights.
 *
 * @param legacyVector - old { primary_pathogen, secondary_opportunistic, autoimmune } probabilities
 * @returns new ConditionClassification
 */
export function mapLegacyVector(legacyVector: {
  primary_pathogen?: number;
  secondary_opportunistic?: number;
  autoimmune?: number;
  [key: string]: number | undefined;
}): ConditionClassification {
  // Attempt to preserve meaning as best we can from legacy labels.
  // In production this should be replaced by direct retraining.
  const infectious = legacyVector['primary_pathogen'] ?? 0;
  const inflammatory = legacyVector['autoimmune'] ?? 0;
  const secondary = legacyVector['secondary_opportunistic'] ?? 0;

  const candidates: Array<{ cls: ConditionClass; prob: number }> = [
    { cls: 'infectious', prob: infectious },
    { cls: 'inflammatory_autoimmune', prob: inflammatory },
    { cls: 'metabolic_toxic', prob: secondary },
  ].sort((a, b) => b.prob - a.prob);

  return buildClassification(candidates);
}

/**
 * Builds a ConditionClassification from a ranked candidate array.
 * Used directly when the new model outputs class probabilities.
 */
export function buildClassification(
  rankedCandidates: Array<{ cls: ConditionClass; prob: number }>,
): ConditionClassification {
  if (rankedCandidates.length === 0) {
    throw new Error('rankedCandidates must have at least one entry');
  }

  const [first, second, third] = rankedCandidates;

  return {
    primary_class: first.cls,
    primary_label: CONDITION_CLASS_LABELS[first.cls],
    primary_probability: first.prob,
    secondary_class: second?.cls,
    secondary_probability: second?.prob,
    tertiary_class: third?.cls,
    tertiary_probability: third?.prob,
    requires_emergency_triage: EMERGENCY_TRIAGE_CLASSES.includes(first.cls),
  };
}
