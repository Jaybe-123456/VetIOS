/**
 * Zod v4 schemas for all VetIOS API endpoints.
 *
 * Strict validation — rejects unknown fields, enforces types.
 * Used in route handlers to replace manual field checking.
 *
 * Zod v4 changes:
 *   - z.object().strict() → z.strictObject()
 *   - z.string().uuid() → z.uuid() (top-level)
 *   - error customization via `error` param
 */

import { z } from 'zod';
import { extractUuidFromText } from '@/lib/utils/uuid';

const UuidLikeSchema = z.preprocess(
    (value) => extractUuidFromText(value) ?? value,
    z.uuid(),
);

const OptionalUuidLikeSchema = z.preprocess((value) => {
    if (value == null) return undefined;
    if (typeof value === 'string' && value.trim().length === 0) return undefined;
    return extractUuidFromText(value) ?? value;
}, z.uuid().optional());

// ── /api/inference ───────────────────────────────────────────────────────────

export const InferenceRequestSchema = z.object({
    clinic_id: z.string().optional(),
    case_id: z.string().optional(),
    model: z.object({
        name: z.string().min(1),
        version: z.string().min(1),
    }),
    input: z.object({
        input_signature: z.object({
            species: z.string().nullable().optional(),
            breed: z.string().nullable().optional(),
            symptoms: z.preprocess(
                (val) => {
                    if (typeof val === 'string') return val.split(/[,;]/).map((s: string) => s.trim()).filter(Boolean);
                    if (Array.isArray(val)) return val;
                    return [];
                },
                z.array(z.string())
            ),
            metadata: z.record(z.string(), z.unknown()).optional().default({}),
        }).passthrough(),
    }),
});

export type InferenceRequest = z.infer<typeof InferenceRequestSchema>;

// ── /api/outcome ─────────────────────────────────────────────────────────────

export const OutcomeRequestSchema = z.object({
    inference_event_id: UuidLikeSchema,
    clinic_id: z.string().optional(),
    case_id: z.string().optional(),
    outcome: z.object({
        type: z.string().min(1),
        payload: z.object({
            label: z.string().min(1),
            confidence: z.number().min(0).max(1),
        }).passthrough(),
        timestamp: z.string().datetime(),
    }),
});

export type OutcomeRequest = z.infer<typeof OutcomeRequestSchema>;

// ── /api/simulate ────────────────────────────────────────────────────────────

export const SimulateRequestSchema = z.object({
    steps: z.number().int().min(1).max(50),
    mode: z.enum(['adaptive', 'fixed']),
    base_case: z.object({
        species: z.string().min(1),
        symptoms: z.array(z.string().min(1)).min(1),
        breed: z.string().min(1).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }).passthrough(),
    inference: z.object({
        model: z.string().min(1).optional(),
        model_version: z.string().optional(),
    }).optional(),
});

export type SimulateRequest = z.infer<typeof SimulateRequestSchema>;

// ── /api/evaluation ──────────────────────────────────────────────────────────

export const EvaluationRequestSchema = z.object({
    outcome_id: OptionalUuidLikeSchema,
    inference_event_id: OptionalUuidLikeSchema,
    model_name: z.string().min(1),
    model_version: z.string().min(1),
    predicted_confidence: z.number().min(0).max(1).optional(),
    trigger_type: z.enum(['inference', 'outcome', 'simulation']).optional(),
});

export type EvaluationRequest = z.infer<typeof EvaluationRequestSchema>;

// ── /api/ml/predict ──────────────────────────────────────────────────────────

export const MLPredictRequestSchema = z.object({
    decision_count: z.number().int().min(0),
    override_count: z.number().int().min(0),
    species: z.string().optional().default('canine'),
});

export type MLPredictRequest = z.infer<typeof MLPredictRequestSchema>;

export const PassiveSignalIngestRequestSchema = z.object({
    signal: z.object({
        source_id: z.uuid().optional(),
        source: z.object({
            source_type: z.string().min(1),
            vendor_name: z.string().min(1).optional(),
            vendor_account_ref: z.string().min(1).optional(),
        }).optional(),
        patient_id: z.uuid().optional(),
        encounter_id: z.uuid().optional(),
        case_id: z.uuid().optional(),
        episode_id: z.uuid().optional(),
        clinic_id: z.string().optional(),
        signal_type: z.string().min(1),
        signal_subtype: z.string().min(1).optional(),
        observed_at: z.string().min(1),
        payload: z.record(z.string(), z.unknown()).optional().default({}),
        normalized_facts: z.record(z.string(), z.unknown()).optional().default({}),
        confidence: z.number().min(0).max(1).optional(),
        dedupe_key: z.string().min(1).optional(),
        auto_reconcile: z.boolean().optional().default(true),
    }),
    episode: z.object({
        patient_id: z.uuid().optional(),
        encounter_id: z.uuid().optional(),
        primary_condition_class: z.string().min(1).optional(),
        status: z.enum(['open', 'monitoring', 'resolved', 'closed', 'archived']).optional(),
        outcome_state: z.string().min(1).optional(),
        resolved_at: z.string().min(1).optional(),
        summary_patch: z.record(z.string(), z.unknown()).optional().default({}),
    }).optional(),
});

export type PassiveSignalIngestRequest = z.infer<typeof PassiveSignalIngestRequestSchema>;

export const PassiveConnectorIngestRequestSchema = z.object({
    connector: z.object({
        tenant_id: z.string().min(1).optional(),
        connector_type: z.enum([
            'lab_result',
            'prescription_refill',
            'recheck',
            'referral',
            'imaging_report',
        ]).optional(),
        workflow_event_type: z.string().min(1).optional(),
        clinic_id: z.string().optional(),
        patient_id: z.uuid().optional(),
        encounter_id: z.uuid().optional(),
        case_id: z.uuid().optional(),
        episode_id: z.uuid().optional(),
        vendor_name: z.string().min(1).optional(),
        vendor_account_ref: z.string().min(1).optional(),
        observed_at: z.string().min(1).optional(),
        payload: z.record(z.string(), z.unknown()).optional().default({}),
        auto_reconcile: z.boolean().optional().default(true),
    }),
}).refine(
    (value) =>
        value.connector.connector_type != null ||
        value.connector.workflow_event_type != null ||
        Object.keys(value.connector.payload).length > 0,
    {
        path: ['connector', 'connector_type'],
        message: 'connector_type, workflow_event_type, or a vendor payload is required.',
    },
);

export type PassiveConnectorIngestRequest = z.infer<typeof PassiveConnectorIngestRequestSchema>;

export const EpisodeReconcileRequestSchema = z.object({
    episode_id: z.uuid().optional(),
    patient_id: z.uuid().optional(),
    encounter_id: z.uuid().optional(),
    case_id: z.uuid().optional(),
    signal_event_id: z.uuid().optional(),
    clinic_id: z.string().optional(),
    primary_condition_class: z.string().min(1).optional(),
    observed_at: z.string().min(1).optional(),
    status: z.enum(['open', 'monitoring', 'resolved', 'closed', 'archived']).optional(),
    outcome_state: z.string().min(1).optional(),
    resolved_at: z.string().min(1).optional(),
    summary_patch: z.record(z.string(), z.unknown()).optional().default({}),
}).refine(
    (value) =>
        value.episode_id != null ||
        value.patient_id != null ||
        value.case_id != null ||
        value.signal_event_id != null,
    {
        message: 'At least one of episode_id, patient_id, case_id, or signal_event_id is required.',
    },
);

export type EpisodeReconcileRequest = z.infer<typeof EpisodeReconcileRequestSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format Zod errors into a clean, client-friendly message.
 */
export const TreatmentRecommendRequestSchema = z.object({
    inference_event_id: UuidLikeSchema,
    context: z.object({
        resource_profile: z.enum(['advanced', 'low_resource']).optional().default('advanced'),
        regulatory_region: z.string().min(1).optional(),
        care_environment: z.string().min(1).optional(),
        comorbidities: z.array(z.string()).optional().default([]),
        lab_flags: z.array(z.string()).optional().default([]),
    }).optional().default({
        resource_profile: 'advanced',
        comorbidities: [],
        lab_flags: [],
    }),
});

export type TreatmentRecommendRequest = z.infer<typeof TreatmentRecommendRequestSchema>;

export const TreatmentOutcomeRequestSchema = z.object({
    inference_event_id: UuidLikeSchema,
    treatment_candidate_id: z.uuid().optional(),
    treatment_event_id: z.uuid().optional(),
    selection: z.object({
        disease: z.string().min(1),
        treatment_pathway: z.enum(['gold_standard', 'resource_constrained', 'supportive_only']),
        clinician_confirmed: z.boolean(),
        clinician_override: z.boolean().optional().default(false),
        actual_intervention: z.record(z.string(), z.unknown()).optional().default({}),
        context: z.record(z.string(), z.unknown()).optional().default({}),
    }),
    outcome: z.object({
        outcome_status: z.enum(['planned', 'ongoing', 'improved', 'resolved', 'complication', 'deteriorated', 'deceased', 'unknown']),
        recovery_time_days: z.number().min(0).optional(),
        complications: z.array(z.string()).optional().default([]),
        notes: z.string().optional(),
        short_term_response: z.string().optional(),
        observed_at: z.string().optional(),
        outcome_json: z.record(z.string(), z.unknown()).optional().default({}),
    }).optional(),
});

export type TreatmentOutcomeRequest = z.infer<typeof TreatmentOutcomeRequestSchema>;

export function formatZodErrors(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}
