/**
 * @vetios/domain — Contradiction Detector + Abstention Gate (Fix 4)
 *
 * Problem: The old system hardcoded abstain = NO regardless of signal quality.
 * For GDV + noisy inputs, 55% confidence + contradictory features should trigger
 * abstain or at minimum an escalation flag.
 *
 * This module computes a contradiction_score across the symptom feature set,
 * and gates the abstain decision accordingly.
 *
 * A contradiction is defined as: two or more mutually exclusive signals that
 * are both present above threshold, or a strong signal directly conflicting
 * with a known pattern's expected physiology.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContradictionPair {
  symptom_a: string;
  symptom_b: string;
  /** 0–1: how irreconcilable these two signals are when both present */
  conflict_weight: number;
  reason: string;
}

export interface ContradictionResult {
  /** Normalised 0–1 score. Higher = more contradiction. */
  contradiction_score: number;
  /** Whether the score exceeds the abstain threshold */
  should_abstain: boolean;
  /** Pairs that contributed to the score */
  active_conflicts: Array<{ pair: ContradictionPair; note: string }>;
  /** Recommended action */
  recommended_action: 'proceed' | 'flag_for_review' | 'abstain_and_escalate';
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Contradiction score above this → abstain = YES and route to escalation. */
const ABSTAIN_THRESHOLD = 0.55;

/** Contradiction score above this → flag for review but still output a suggestion. */
const FLAG_THRESHOLD = 0.30;

// ─── Known contradictory symptom pairs ───────────────────────────────────────

/**
 * Pairs of symptoms that are clinically contradictory if both are reported.
 * Add new pairs as clinical knowledge grows — each pair is a row in the dataset moat.
 */
export const CONTRADICTION_PAIRS: ContradictionPair[] = [
  {
    symptom_a: 'productive_vomiting',
    symptom_b: 'unproductive_retching',
    conflict_weight: 0.85,
    reason: 'Cannot simultaneously vomit productively and retch unproductively. Key GDV discriminator.',
  },
  {
    symptom_a: 'normal_appetite',
    symptom_b: 'severe_abdominal_pain',
    conflict_weight: 0.75,
    reason: 'Normal appetite is inconsistent with severe acute abdominal pain.',
  },
  {
    symptom_a: 'polyuria',
    symptom_b: 'anuric',
    conflict_weight: 1.0,
    reason: 'Polyuria and anuria are mutually exclusive urine output states.',
  },
  {
    symptom_a: 'bradycardia',
    symptom_b: 'tachycardia',
    conflict_weight: 1.0,
    reason: 'Heart rate cannot be simultaneously high and low.',
  },
  {
    symptom_a: 'normal_hydration',
    symptom_b: 'severe_dehydration',
    conflict_weight: 0.90,
    reason: 'Hydration status is categorical — normal and severe dehydration are exclusive.',
  },
  {
    symptom_a: 'alert_and_responsive',
    symptom_b: 'obtunded',
    conflict_weight: 0.80,
    reason: 'Mentation status conflict — alert vs. depressed consciousness.',
  },
  {
    symptom_a: 'diarrhoea',
    symptom_b: 'constipation',
    conflict_weight: 0.70,
    reason: 'Concurrent diarrhoea and constipation require disambiguation (e.g. partial obstruction).',
  },
];

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Computes contradiction score for a given symptom set.
 *
 * @param presentSymptoms - normalised symptom keys (snake_case, lowercase)
 * @param symptomWeights  - optional map of symptom → confidence (0–1). Defaults to 1.0 for all.
 * @returns ContradictionResult
 */
export function detectContradictions(
  presentSymptoms: string[],
  symptomWeights?: Record<string, number>,
): ContradictionResult {
  const symptomSet = new Set(presentSymptoms.map((s) => s.toLowerCase().replace(/\s+/g, '_')));
  const weights = symptomWeights ?? {};

  const activeConflicts: ContradictionResult['active_conflicts'] = [];
  let rawScore = 0;

  for (const pair of CONTRADICTION_PAIRS) {
    if (symptomSet.has(pair.symptom_a) && symptomSet.has(pair.symptom_b)) {
      // Scale by the lower confidence of the two symptoms (weaker signal = less certain conflict)
      const wA = weights[pair.symptom_a] ?? 1.0;
      const wB = weights[pair.symptom_b] ?? 1.0;
      const contribution = pair.conflict_weight * Math.min(wA, wB);
      rawScore += contribution;
      activeConflicts.push({
        pair,
        note: `Both "${pair.symptom_a}" and "${pair.symptom_b}" present. Weight contribution: ${contribution.toFixed(2)}`,
      });
    }
  }

  // Normalise: sigmoid-like clamping so multiple weak conflicts don't trivially exceed threshold.
  const contradiction_score = Math.min(rawScore / (rawScore + 1), 1);

  const should_abstain = contradiction_score >= ABSTAIN_THRESHOLD;
  const should_flag = contradiction_score >= FLAG_THRESHOLD;

  let recommended_action: ContradictionResult['recommended_action'];
  if (should_abstain) {
    recommended_action = 'abstain_and_escalate';
  } else if (should_flag) {
    recommended_action = 'flag_for_review';
  } else {
    recommended_action = 'proceed';
  }

  return {
    contradiction_score: Math.round(contradiction_score * 1000) / 1000,
    should_abstain,
    active_conflicts: activeConflicts,
    recommended_action,
  };
}
