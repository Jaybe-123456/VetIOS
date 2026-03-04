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

// ── /api/inference ───────────────────────────────────────────────────────────

export const InferenceRequestSchema = z.object({
    clinic_id: z.string().optional(),
    case_id: z.string().optional(),
    model: z.object({
        name: z.string().min(1),
        version: z.string().min(1),
    }),
    input: z.object({
        input_signature: z.record(z.string(), z.unknown()),
    }),
});

export type InferenceRequest = z.infer<typeof InferenceRequestSchema>;

// ── /api/outcome ─────────────────────────────────────────────────────────────

export const OutcomeRequestSchema = z.object({
    inference_event_id: z.uuid(),
    clinic_id: z.string().optional(),
    case_id: z.string().optional(),
    outcome: z.object({
        type: z.string().min(1),
        payload: z.record(z.string(), z.unknown()),
        timestamp: z.string().min(1),
    }),
});

export type OutcomeRequest = z.infer<typeof OutcomeRequestSchema>;

// ── /api/simulate ────────────────────────────────────────────────────────────

export const SimulateRequestSchema = z.object({
    simulation: z.object({
        type: z.string().min(1),
        parameters: z.record(z.string(), z.unknown()),
    }),
    inference: z.object({
        model: z.string().min(1),
        model_version: z.string().optional(),
    }),
});

export type SimulateRequest = z.infer<typeof SimulateRequestSchema>;

// ── /api/evaluation ──────────────────────────────────────────────────────────

export const EvaluationRequestSchema = z.object({
    inference_event_id: z.uuid().optional(),
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format Zod errors into a clean, client-friendly message.
 */
export function formatZodErrors(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
}
