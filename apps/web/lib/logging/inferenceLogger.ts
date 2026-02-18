/**
 * Inference Logger
 *
 * Inserts into ai_inference_events.
 * Returns inserted row ID.
 *
 * This is where the moat becomes automatic.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface InferenceLogInput {
    tenant_id: string;
    clinic_id?: string | null;
    case_id?: string | null;
    model_name: string;
    model_version: string;
    input_signature: Record<string, unknown>;
    output_payload: Record<string, unknown>;
    confidence_score?: number | null;
    uncertainty_metrics?: Record<string, unknown> | null;
    latency_ms: number;
}

export async function logInference(
    client: SupabaseClient,
    input: InferenceLogInput,
): Promise<string> {
    const { data, error } = await client
        .from('ai_inference_events')
        .insert({
            tenant_id: input.tenant_id,
            clinic_id: input.clinic_id ?? null,
            case_id: input.case_id ?? null,
            model_name: input.model_name,
            model_version: input.model_version,
            input_signature: input.input_signature,
            output_payload: input.output_payload,
            confidence_score: input.confidence_score ?? null,
            uncertainty_metrics: input.uncertainty_metrics ?? null,
            latency_ms: input.latency_ms,
        })
        .select('id')
        .single();

    if (error || !data) {
        throw new Error(`Failed to log inference event: ${error?.message ?? 'Unknown error'}`);
    }

    return data.id as string;
}
