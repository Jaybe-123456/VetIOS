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
  | 'mechanical_emergency'
  | 'infectious'
  | 'inflammatory_autoimmune'
  | 'metabolic_toxic'
  | 'neoplastic'
  | 'cardiovascular_shock';

export interface ConditionClassification {
  primary_class: ConditionClass;
  primary_label: string;
  primary_probability: number;
  secondary_class?: ConditionClass;
  secondary_probability?: number;
  tertiary_class?: ConditionClass;
  tertiary_probability?: number;
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

export const EMERGENCY_TRIAGE_CLASSES: ConditionClass[] = [
  'mechanical_emergency',
  'cardiovascular_shock',
];

export function mapLegacyVector(legacyVector: {
  primary_pathogen?: number;
  secondary_opportunistic?: number;
  autoimmune?: number;
  [key: string]: number | undefined;
}): ConditionClassification {
  const infectious = legacyVector['primary_pathogen'] ?? 0;
  const inflammatory = legacyVector['autoimmune'] ?? 0;
  const secondary = legacyVector['secondary_opportunistic'] ?? 0;

  const candidates: Array<{ cls: ConditionClass; prob: number }> = [
    { cls: 'infectious' as ConditionClass, prob: infectious },
    { cls: 'inflammatory_autoimmune' as ConditionClass, prob: inflammatory },
    { cls: 'metabolic_toxic' as ConditionClass, prob: secondary },
  ].sort((a, b) => b.prob - a.prob);

  return buildClassification(candidates);
}

export function buildClassification(
  rankedCandidates: Array<{ cls: ConditionClass; prob: number }>,
): ConditionClassification {
  if (rankedCandidates.length === 0) {
    throw new Error('rankedCandidates must have at least one entry');
  }

  const first = rankedCandidates[0]!;
  const second = rankedCandidates[1];
  const third = rankedCandidates[2];

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
