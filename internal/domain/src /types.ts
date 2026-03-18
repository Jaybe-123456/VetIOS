/**
 * @vetios/domain — Core Type System (Refactor v2)
 *
 * Single source of truth for all domain types across the inference engine.
 * Every interface here is:
 *   - Zod-validated at API boundaries
 *   - Preserved in ai_inference_events.output_payload (jsonb)
 *   - Backward-compatible with existing inference_event_id references
 *   - Compatible with outcome injection and adversarial simulation
 */

import { z } from 'zod';

// ─── Condition Taxonomy (Fix 1) ───────────────────────────────────────────────

export const ConditionClassSchema = z.enum([
    'mechanical_emergency',
    'infectious',
    'inflammatory_autoimmune',
    'metabolic_toxic',
    'neoplastic',
    'cardiovascular_shock',
]);

export type ConditionClass = z.infer<typeof ConditionClassSchema>;

export const CONDITION_CLASS_LABELS: Record<ConditionClass, string> = {
    mechanical_emergency:    'Acute mechanical emergency',
    infectious:              'Infectious disease',
    inflammatory_autoimmune: 'Inflammatory / autoimmune',
    metabolic_toxic:         'Metabolic / toxic',
    neoplastic:              'Neoplastic',
    cardiovascular_shock:    'Cardiovascular / shock',
};

export const CONDITION_CLASS_DESCRIPTIONS: Record<ConditionClass, string> = {
    mechanical_emergency:    'Structural or obstructive emergency requiring immediate surgical or procedural intervention. Examples: GDV, torsion, intestinal obstruction, urethral obstruction, pneumothorax.',
    infectious:              'Primary causative agent is a pathogen. Examples: parvovirus, leptospirosis, septic peritonitis, kennel cough.',
    inflammatory_autoimmune: 'Immune-mediated pathology without confirmed infectious trigger. Examples: IMHA, IBD, immune-mediated polyarthritis, pemphigus.',
    metabolic_toxic:         'Systemic metabolic dysfunction or toxic exposure. Examples: DKA, hepatic encephalopathy, NSAID toxicity, ethylene glycol ingestion.',
    neoplastic:              'Neoplastic process — primary or metastatic, paraneoplastic syndromes included.',
    cardiovascular_shock:    'Circulatory failure — cardiogenic, haemorrhagic, distributive (septic/anaphylactic), or obstructive.',
};

/** Classes that mandate emergency triage regardless of ML risk score. */
export const EMERGENCY_TRIAGE_CLASSES: Set<ConditionClass> = new Set([
    'mechanical_emergency',
    'cardiovascular_shock',
]);

// ─── Emergency Level (Fix 3) ─────────────────────────────────────────────────

export const EmergencyLevelSchema = z.enum(['CRITICAL', 'HIGH', 'MODERATE', 'LOW']);
export type EmergencyLevel = z.infer<typeof EmergencyLevelSchema>;

export const EMERGENCY_LEVEL_DESCRIPTIONS: Record<EmergencyLevel, string> = {
    CRITICAL: 'Immediate intervention required — minutes matter. Do not delay diagnostics.',
    HIGH:     'Urgent — initiate workup and stabilisation within 30 minutes.',
    MODERATE: 'Same-day evaluation required. Monitor closely for deterioration.',
    LOW:      'Routine — schedule within 24-48 hours.',
};

// ─── Differential Diagnosis ───────────────────────────────────────────────────

export const DifferentialSchema = z.object({
    /** The diagnosis name, in clinician-readable form. */
    diagnosis: z.string().min(1),
    /** ICD-11 Veterinary code if available, otherwise null. */
    icd_code: z.string().nullable().optional(),
    /** Fix 1: condition class for this differential. */
    condition_class: ConditionClassSchema,
    /** Fix 1: Human-readable label. */
    condition_class_label: z.string(),
    /** Likelihood tier. */
    likelihood: z.enum(['high', 'medium', 'low']),
    /** Model probability 0–1. */
    probability: z.number().min(0).max(1),
    /**
     * Clinician-readable rationale explaining WHY this diagnosis was ranked here.
     * Must reference specific symptoms and patient factors.
     */
    rationale: z.string().min(1),
    /** Normalised symptom keys that support this diagnosis. */
    supporting_symptoms: z.array(z.string()),
    /** Recommended diagnostic tests in priority order. */
    recommended_tests: z.array(z.string()),
    /** Fix 3: urgency tier specific to this differential. */
    emergency_level: EmergencyLevelSchema,
    /** Whether this differential requires immediate surgical consultation. */
    requires_surgical_consult: z.boolean(),
});

export type Differential = z.infer<typeof DifferentialSchema>;

// ─── Diagnosis Model Output (Fix 5: what is it?) ─────────────────────────────

export const DiagnosisOutputSchema = z.object({
    /** Primary condition class — the top-level classification. Fix 1. */
    primary_condition_class: ConditionClassSchema,
    primary_condition_class_label: z.string(),
    primary_condition_class_probability: z.number().min(0).max(1),
    /** Clinician-readable explanation of the primary class assignment. */
    primary_condition_class_rationale: z.string(),
    /** Ranked differentials — top 5 max. */
    top_differentials: z.array(DifferentialSchema).max(5),
    /** Symptoms the model identified as most significant. */
    key_symptoms_identified: z.array(z.string()),
    /** Additional data that would improve diagnostic confidence. */
    additional_data_needed: z.array(z.string()),
    /** Model confidence in the diagnosis output. */
    diagnosis_confidence: z.number().min(0).max(1),
    /** Note for the clinician on confidence level and limitations. */
    confidence_note: z.string(),
    /** Model version that produced this output. */
    model_version: z.string(),
});

export type DiagnosisOutput = z.infer<typeof DiagnosisOutputSchema>;

// ─── Severity Model Output (Fix 5: how dangerous?) ───────────────────────────

export const SeverityOutputSchema = z.object({
    /** Fix 3: Discrete emergency triage tier. */
    emergency_level: EmergencyLevelSchema,
    /** Human-readable description of what this level means. */
    emergency_level_description: z.string(),
    /** Raw ML model risk score 0–1. Preserved for audit. */
    raw_risk_score: z.number().min(0).max(1),
    /** Effective risk score after any overrides. */
    effective_risk_score: z.number().min(0).max(1),
    /** Fix 2: Whether an emergency rule override was applied. */
    override_applied: z.boolean(),
    /** Which rule pattern fired if override was applied. */
    override_pattern_id: z.string().nullable(),
    /** Clinician-readable explanation of the override. */
    override_rationale: z.string().nullable(),
    /** Model confidence in the severity assessment. */
    severity_confidence: z.number().min(0).max(1),
    /** Model version. */
    model_version: z.string(),
});

export type SeverityOutput = z.infer<typeof SeverityOutputSchema>;

// ─── Contradiction Engine Output (Fix 4) ─────────────────────────────────────

export const ContradictionPairResultSchema = z.object({
    symptom_a: z.string(),
    symptom_b: z.string(),
    conflict_weight: z.number().min(0).max(1),
    /** Clinician-readable reason why these are contradictory. */
    reason: z.string(),
    /** Contribution to the overall contradiction score. */
    score_contribution: z.number().min(0).max(1),
});

export type ContradictionPairResult = z.infer<typeof ContradictionPairResultSchema>;

export const ContradictionOutputSchema = z.object({
    /** Normalised 0–1 score. Higher = more contradictory signals. */
    contradiction_score: z.number().min(0).max(1),
    /** Fix 4: Whether the score exceeds the abstain threshold. */
    should_abstain: z.boolean(),
    /** Recommended action for the orchestrator. */
    recommended_action: z.enum(['proceed', 'flag_for_review', 'abstain_and_escalate']),
    /** Active contradiction pairs with explanations. */
    active_conflicts: z.array(ContradictionPairResultSchema),
    /** Clinician-readable summary of contradiction findings. */
    contradiction_summary: z.string(),
});

export type ContradictionOutput = z.infer<typeof ContradictionOutputSchema>;

// ─── Full Inference Output ────────────────────────────────────────────────────
// This is what goes into ai_inference_events.output_payload
// Backward compatible: all new fields are additions, never renames.

export const VetIOSInferenceOutputSchema = z.object({
    // ── Identity (preserved) ──────────────────────────────────────────────────
    /** Schema version for migration detection. */
    schema_version: z.literal('2.0'),

    // ── Diagnosis model (Fix 5: what is it?) ──────────────────────────────────
    diagnosis: DiagnosisOutputSchema,

    // ── Severity model (Fix 5: how dangerous?) ────────────────────────────────
    severity: SeverityOutputSchema,

    // ── Contradiction engine (Fix 4) ─────────────────────────────────────────
    contradiction: ContradictionOutputSchema,

    // ── Top-level convenience fields (UI) ────────────────────────────────────
    /** Fix 3: Top-level emergency level — max of diagnosis + severity. */
    emergency_level: EmergencyLevelSchema,
    /** Fix 4: Top-level abstain flag. Callers MUST check before rendering. */
    abstain: z.boolean(),
    /** Top-level contradiction score. */
    contradiction_score: z.number().min(0).max(1),
    /** Top 3 differentials — convenience alias for diagnosis.top_differentials.slice(0,3). */
    top_differentials: z.array(DifferentialSchema).max(3),

    // ── Legacy fields (backward compatibility) ────────────────────────────────
    /** Original analysis text — preserved for outcome injection compatibility. */
    analysis: z.string().optional(),
    /** Original recommendations — preserved. */
    recommendations: z.array(z.string()).optional(),
    /** Original confidence score — preserved. */
    confidence_score: z.number().min(0).max(1).nullable().optional(),
    /** Original uncertainty notes — preserved. */
    uncertainty_notes: z.array(z.string()).optional(),

    // ── Telemetry ─────────────────────────────────────────────────────────────
    telemetry: z.object({
        override_fired: z.boolean(),
        override_pattern_id: z.string().nullable(),
        contradiction_score: z.number(),
        abstain_recommended: z.boolean(),
        confidence_penalty_applied: z.boolean(),
        confidence_penalty_amount: z.number(),
        diagnosis_model_version: z.string(),
        severity_model_version: z.string(),
        pipeline_latency_ms: z.number(),
    }),
});

export type VetIOSInferenceOutput = z.infer<typeof VetIOSInferenceOutputSchema>;

// ─── Input Signature (extended) ───────────────────────────────────────────────

export const VetIOSInputSignatureSchema = z.object({
    species: z.string().nullable().optional(),
    breed: z.string().nullable().optional(),
    age_description: z.string().nullable().optional(),
    weight_kg: z.number().positive().nullable().optional(),
    /** Normalised symptom keys. Snake_case, lowercase. */
    symptoms: z.array(z.string()).default([]),
    /** Temporal onset descriptor. */
    onset: z.enum(['acute', 'subacute', 'chronic', 'unknown']).optional(),
    /** Hours since symptom onset, if known. */
    onset_hours: z.number().positive().nullable().optional(),
    /** Symptom confidence weights 0–1. */
    symptom_weights: z.record(z.string(), z.number().min(0).max(1)).optional(),
    /** Context flags: breed predispositions, environment, etc. */
    context_flags: z.array(z.string()).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export type VetIOSInputSignature = z.infer<typeof VetIOSInputSignatureSchema>;
