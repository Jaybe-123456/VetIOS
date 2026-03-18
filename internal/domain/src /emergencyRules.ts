/**
 * @vetios/domain — Emergency Rules Engine (Fix 2)
 *
 * Rule-based emergency override layer. Runs BEFORE the ML risk model output
 * is accepted. Deterministic, auditable, zero-LLM.
 *
 * Core hardcoded rule (as specified):
 *   IF acute_onset + abdominal_distension + non_productive_retching
 *   THEN emergency_level >= HIGH AND GDV must be top differential
 *
 * All rules are logged to telemetry. Override decisions are immutable once made.
 */

import type { EmergencyLevel, ConditionClass } from './types';

// ─── Rule Definition Types ────────────────────────────────────────────────────

export interface EmergencyRule {
    /** Unique stable identifier — persisted in telemetry logs. */
    rule_id: string;
    /** Human-readable name. */
    name: string;
    /** Clinician-readable rationale shown in UI when rule fires. */
    clinician_rationale: string;
    /** All of these symptom keys must be present (AND). */
    required_symptoms: string[];
    /** At least one of these must be present (OR). Empty = no context check. */
    supporting_context: string[];
    /** Minimum emergency level to enforce when rule fires. */
    min_emergency_level: EmergencyLevel;
    /**
     * If set, this diagnosis must be promoted to rank 1 in top_differentials.
     * Existing entry is re-ranked; a stub entry is inserted if not present.
     */
    promote_diagnosis: string | null;
    /** Condition class to assign if promotion creates a new differential. */
    promote_condition_class: ConditionClass | null;
    /** Confidence in this rule (used to weight override telemetry). */
    rule_confidence: number;
}

export interface EmergencyRuleResult {
    fired: boolean;
    rule_id: string | null;
    rule_name: string | null;
    min_emergency_level: EmergencyLevel | null;
    promoted_diagnosis: string | null;
    clinician_rationale: string | null;
    /** Symptoms from this case that matched the rule's required set. */
    matched_symptoms: string[];
    /** Context flags from this case that matched supporting_context. */
    matched_context: string[];
}

// ─── Hardcoded Rule Registry ──────────────────────────────────────────────────

const EMERGENCY_RULES: EmergencyRule[] = [
    // ── Rule 1: GDV Classic (HARDCODED PER SPEC) ─────────────────────────────
    {
        rule_id:              'gdv_classic_v1',
        name:                 'GDV — Classic triad',
        clinician_rationale:  'Acute onset + abdominal distension + non-productive retching is the near-pathognomonic triad for gastric dilatation-volvulus. GDV is rapidly fatal without surgical intervention. This rule overrides risk scoring to CRITICAL and promotes GDV to the top of the differential list. Do not delay radiographs and IV access.',
        required_symptoms:    ['abdominal_distension', 'non_productive_retching'],
        supporting_context:   ['acute_onset', 'acute', 'large_breed', 'deep_chested', 'bloat', 'restlessness', 'hypersalivation'],
        min_emergency_level:  'CRITICAL',
        promote_diagnosis:    'Gastric Dilatation-Volvulus (GDV)',
        promote_condition_class: 'mechanical_emergency',
        rule_confidence:      0.97,
    },
    // ── Rule 2: GDV without confirmed acute onset ─────────────────────────────
    {
        rule_id:              'gdv_partial_v1',
        name:                 'GDV — Partial triad (distension + retching)',
        clinician_rationale:  'Abdominal distension combined with non-productive retching, even without confirmed acute onset history, warrants HIGH emergency classification and strong suspicion for GDV. Obtain lateral abdominal radiograph immediately.',
        required_symptoms:    ['abdominal_distension', 'non_productive_retching'],
        supporting_context:   [],
        min_emergency_level:  'HIGH',
        promote_diagnosis:    'Gastric Dilatation-Volvulus (GDV)',
        promote_condition_class: 'mechanical_emergency',
        rule_confidence:      0.88,
    },
    // ── Rule 3: Haemorrhagic shock ───────────────────────────────────────────
    {
        rule_id:              'haemorrhagic_shock_v1',
        name:                 'Haemorrhagic / distributive shock',
        clinician_rationale:  'Pale mucous membranes + weak pulses + collapse indicates circulatory failure. Immediate IV access, fluid resuscitation, and shock workup required.',
        required_symptoms:    ['pale_mucous_membranes', 'weak_pulses', 'collapse'],
        supporting_context:   ['tachycardia', 'hypothermia', 'haemorrhage', 'trauma'],
        min_emergency_level:  'CRITICAL',
        promote_diagnosis:    'Hypovolaemic / Haemorrhagic Shock',
        promote_condition_class: 'cardiovascular_shock',
        rule_confidence:      0.95,
    },
    // ── Rule 4: Acute respiratory failure ────────────────────────────────────
    {
        rule_id:              'respiratory_failure_v1',
        name:                 'Acute respiratory failure',
        clinician_rationale:  'Open-mouth breathing with cyanosis indicates severe hypoxaemia. Immediate oxygen supplementation and respiratory triage required before any other diagnostics.',
        required_symptoms:    ['open_mouth_breathing', 'cyanosis'],
        supporting_context:   ['dyspnoea', 'orthopnoea', 'paradoxical_breathing'],
        min_emergency_level:  'CRITICAL',
        promote_diagnosis:    'Acute Respiratory Failure',
        promote_condition_class: 'mechanical_emergency',
        rule_confidence:      0.96,
    },
    // ── Rule 5: Complete urinary obstruction ─────────────────────────────────
    {
        rule_id:              'urinary_obstruction_v1',
        name:                 'Complete urinary obstruction',
        clinician_rationale:  'Straining to urinate with no urine output indicates complete urethral obstruction. This is a life-threatening emergency — untreated obstruction causes hyperkalaemia and cardiac arrest within hours.',
        required_symptoms:    ['straining_to_urinate', 'no_urine_output'],
        supporting_context:   ['crying_pain', 'distended_bladder', 'perineal_licking', 'feline'],
        min_emergency_level:  'CRITICAL',
        promote_diagnosis:    'Urethral Obstruction',
        promote_condition_class: 'mechanical_emergency',
        rule_confidence:      0.98,
    },
    // ── Rule 6: Active / cluster seizure ─────────────────────────────────────
    {
        rule_id:              'active_seizure_v1',
        name:                 'Active or cluster seizure',
        clinician_rationale:  'Active seizure or cluster seizure activity requires immediate benzodiazepine administration and neurological triage. Prolonged seizure causes irreversible neuronal injury.',
        required_symptoms:    ['seizure'],
        supporting_context:   ['cluster_seizure', 'status_epilepticus', 'loss_of_consciousness', 'post_ictal'],
        min_emergency_level:  'HIGH',
        promote_diagnosis:    'Seizure Disorder / Status Epilepticus',
        promote_condition_class: 'mechanical_emergency',
        rule_confidence:      0.92,
    },
    // ── Rule 7: Penetrating trauma ────────────────────────────────────────────
    {
        rule_id:              'penetrating_trauma_v1',
        name:                 'Penetrating thoracic / abdominal trauma',
        clinician_rationale:  'Penetrating wounds to the thorax or abdomen require immediate surgical assessment. Risk of pneumothorax, haemothorax, and evisceration.',
        required_symptoms:    ['penetrating_wound'],
        supporting_context:   ['thoracic_trauma', 'abdominal_trauma', 'evisceration', 'impalement'],
        min_emergency_level:  'CRITICAL',
        promote_diagnosis:    'Penetrating Trauma',
        promote_condition_class: 'mechanical_emergency',
        rule_confidence:      0.99,
    },
];

// ─── Level ordering ───────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<EmergencyLevel, number> = {
    LOW:      0,
    MODERATE: 1,
    HIGH:     2,
    CRITICAL: 3,
};

export function maxLevel(a: EmergencyLevel, b: EmergencyLevel): EmergencyLevel {
    return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

// ─── Rule Evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluates all emergency rules against the normalised symptom + context set.
 *
 * Returns the FIRST (highest-priority) rule that fires.
 * Rules are ordered by severity: CRITICAL rules are evaluated before HIGH.
 *
 * @param presentSymptoms - normalised symptom keys (snake_case, lowercase)
 * @param contextFlags    - context tags (onset descriptors, breed flags, etc.)
 */
export function evaluateEmergencyRules(
    presentSymptoms: string[],
    contextFlags: string[],
): EmergencyRuleResult {
    const symptomSet = normaliseSet(presentSymptoms);
    const contextSet = normaliseSet(contextFlags);

    // Sort rules: CRITICAL first, then HIGH
    const sortedRules = [...EMERGENCY_RULES].sort(
        (a, b) => LEVEL_ORDER[b.min_emergency_level] - LEVEL_ORDER[a.min_emergency_level],
    );

    for (const rule of sortedRules) {
        const matchedSymptoms = rule.required_symptoms.filter((s) => symptomSet.has(s));
        const allRequiredPresent = matchedSymptoms.length === rule.required_symptoms.length;
        if (!allRequiredPresent) continue;

        // Context check: if any supporting_context defined, at least one must match
        const matchedContext = rule.supporting_context.filter((c) => contextSet.has(c));
        const contextSatisfied =
            rule.supporting_context.length === 0 || matchedContext.length > 0;

        if (contextSatisfied) {
            return {
                fired:              true,
                rule_id:            rule.rule_id,
                rule_name:          rule.name,
                min_emergency_level: rule.min_emergency_level,
                promoted_diagnosis: rule.promote_diagnosis,
                clinician_rationale: rule.clinician_rationale,
                matched_symptoms:   matchedSymptoms,
                matched_context:    matchedContext,
            };
        }
    }

    return {
        fired:              false,
        rule_id:            null,
        rule_name:          null,
        min_emergency_level: null,
        promoted_diagnosis: null,
        clinician_rationale: null,
        matched_symptoms:   [],
        matched_context:    [],
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseSet(items: string[]): Set<string> {
    return new Set(items.map((s) => s.toLowerCase().replace(/[\s-]+/g, '_')));
}

export function riskScoreToLevel(score: number): EmergencyLevel {
    if (score >= 0.80) return 'CRITICAL';
    if (score >= 0.55) return 'HIGH';
    if (score >= 0.30) return 'MODERATE';
    return 'LOW';
}

export const LEVEL_TO_EFFECTIVE_SCORE: Record<EmergencyLevel, number> = {
    CRITICAL: 0.95,
    HIGH:     0.75,
    MODERATE: 0.45,
    LOW:      0.15,
};

/** Returns all available rule IDs — used in tests and telemetry dashboards. */
export function listRules(): Array<Pick<EmergencyRule, 'rule_id' | 'name' | 'min_emergency_level'>> {
    return EMERGENCY_RULES.map(({ rule_id, name, min_emergency_level }) => ({
        rule_id, name, min_emergency_level,
    }));
}
