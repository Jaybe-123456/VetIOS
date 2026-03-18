/**
 * @vetios/domain — Emergency Weight Layer + Urgency Output (Fixes 2 & 3)
 *
 * Fix 2: Rule-based emergency override.
 *   Detects high-specificity symptom patterns (e.g. GDV) and forces the
 *   risk score to HIGH regardless of what the ML model outputs.
 *
 * Fix 3: Adds a discrete EmergencyLevel output.
 *   The model previously only produced risk_score (probability).
 *   Clinical staff need a clear triage tier: CRITICAL / HIGH / MODERATE / LOW.
 *
 * These are pure functions — no LLM or DB calls.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmergencyLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

export interface SymptomPattern {
  /** Unique name for this rule pattern */
  pattern_id: string;
  /** Description shown in audit logs */
  description: string;
  /**
   * Required symptoms — all must be present (logical AND).
   * Match against normalised symptom keys (snake_case, lowercase).
   */
  required_symptoms: string[];
  /**
   * Contextual flags that further support the pattern (logical OR — any one suffices).
   * Optional: if undefined, no context check is performed.
   */
  supporting_context?: string[];
  /** Level to force when this pattern fires */
  override_level: EmergencyLevel;
}

export interface UrgencyResult {
  /** Discrete triage tier (Fix 3) */
  emergency_level: EmergencyLevel;
  /** Original ML risk score (not overridden — preserved for audit) */
  raw_risk_score: number;
  /** Effective risk score after override, mapped from emergency_level */
  effective_risk_score: number;
  /** Whether an emergency rule override was applied (Fix 2) */
  override_applied: boolean;
  /** Which pattern triggered the override, if any */
  override_pattern_id?: string;
  override_description?: string;
}

// ─── Emergency override rules ─────────────────────────────────────────────────

/**
 * Rule set for symptom-based emergency overrides.
 *
 * Each rule checks normalised symptom keys from the feature heatmap.
 * Add new rules here — they are evaluated in order; first match wins.
 */
export const EMERGENCY_OVERRIDE_RULES: SymptomPattern[] = [
  {
    pattern_id: 'gdv_classic',
    description: 'Gastric dilatation-volvulus (GDV) — near-signature pattern',
    required_symptoms: ['unproductive_retching', 'abdominal_distension'],
    supporting_context: ['acute_onset', 'large_breed', 'bloat'],
    override_level: 'CRITICAL',
  },
  {
    pattern_id: 'respiratory_failure',
    description: 'Acute respiratory distress — immediate airway triage',
    required_symptoms: ['open_mouth_breathing', 'cyanosis'],
    override_level: 'CRITICAL',
  },
  {
    pattern_id: 'haemorrhagic_shock',
    description: 'Haemorrhagic or distributive shock pattern',
    required_symptoms: ['pale_mucous_membranes', 'weak_pulses', 'collapse'],
    override_level: 'CRITICAL',
  },
  {
    pattern_id: 'urinary_obstruction',
    description: 'Complete urinary obstruction (most commonly cats)',
    required_symptoms: ['straining_to_urinate', 'no_urine_output'],
    supporting_context: ['crying_in_pain', 'distended_bladder'],
    override_level: 'HIGH',
  },
  {
    pattern_id: 'seizure_active',
    description: 'Active or cluster seizure activity',
    required_symptoms: ['seizure', 'loss_of_consciousness'],
    override_level: 'HIGH',
  },
];

// ─── Urgency mapping ──────────────────────────────────────────────────────────

/** Maps EmergencyLevel → canonical effective_risk_score for display and alerting. */
export const LEVEL_TO_RISK_SCORE: Record<EmergencyLevel, number> = {
  CRITICAL: 0.95,
  HIGH: 0.75,
  MODERATE: 0.45,
  LOW: 0.15,
};

/** Maps continuous ML risk_score → EmergencyLevel tier (no override applied). */
export function riskScoreToLevel(riskScore: number): EmergencyLevel {
  if (riskScore >= 0.8) return 'CRITICAL';
  if (riskScore >= 0.55) return 'HIGH';
  if (riskScore >= 0.3) return 'MODERATE';
  return 'LOW';
}

// ─── Core evaluation function ─────────────────────────────────────────────────

/**
 * Evaluates emergency override rules against the normalised symptom set.
 *
 * @param presentSymptoms - Set of normalised symptom keys (snake_case) present in this case
 * @param contextFlags - Optional additional context (breed tags, onset descriptors, etc.)
 * @param rawRiskScore - The ML model's raw risk probability (0–1)
 * @returns UrgencyResult with emergency_level, effective_risk_score, and audit metadata
 */
export function evaluateUrgency(
  presentSymptoms: string[],
  contextFlags: string[],
  rawRiskScore: number,
): UrgencyResult {
  const symptomSet = new Set(presentSymptoms.map((s) => s.toLowerCase().replace(/\s+/g, '_')));
  const contextSet = new Set(contextFlags.map((c) => c.toLowerCase().replace(/\s+/g, '_')));

  for (const rule of EMERGENCY_OVERRIDE_RULES) {
    const allRequiredPresent = rule.required_symptoms.every((s) => symptomSet.has(s));
    if (!allRequiredPresent) continue;

    // If supporting_context is defined, at least one must match.
    const contextSatisfied =
      !rule.supporting_context ||
      rule.supporting_context.some((c) => contextSet.has(c));

    if (contextSatisfied) {
      return {
        emergency_level: rule.override_level,
        raw_risk_score: rawRiskScore,
        effective_risk_score: LEVEL_TO_RISK_SCORE[rule.override_level],
        override_applied: true,
        override_pattern_id: rule.pattern_id,
        override_description: rule.description,
      };
    }
  }

  // No rule fired — derive level from ML score directly.
  const level = riskScoreToLevel(rawRiskScore);
  return {
    emergency_level: level,
    raw_risk_score: rawRiskScore,
    effective_risk_score: rawRiskScore,
    override_applied: false,
  };
}
