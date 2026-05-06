/**
 * Inference Logger
 *
 * Inserts into ai_inference_events using schema contracts.
 * Returns inserted row ID.
 *
 * This is where the moat becomes automatic.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_INFERENCE_EVENTS } from '@/lib/db/schemaContracts';

export interface InferenceLogInput {
    id?: string;
    tenant_id: string;
    user_id?: string | null;
    clinic_id?: string | null;
    case_id?: string | null;
    source_module?: string | null;
    model_name: string;
    model_version: string;
    input_signature: Record<string, unknown>;
    output_payload: Record<string, unknown>;
    confidence_score?: number | null;
    uncertainty_metrics?: Record<string, unknown> | null;
    compute_profile?: Record<string, unknown> | null;
    inference_latency_ms: number;
    blocked?: boolean;
    flagged?: boolean;
    flag_reason?: string | null;
    blocked_reason?: string | null;
    governance_policy_id?: string | null;
    orphaned?: boolean;
    orphaned_at?: string | null;
    species?: string | null;
    top_diagnosis?: string | null;
    contradiction_score?: number | null;
    outcome_confirmed?: boolean;
    region?: string | null;
    parent_inference_event_id?: string | null;
}

export async function logInference(
    client: SupabaseClient,
    input: InferenceLogInput,
): Promise<string> {
    const C = AI_INFERENCE_EVENTS.COLUMNS;

    const { data, error } = await client
        .from(AI_INFERENCE_EVENTS.TABLE)
        .insert({
            [C.id]: input.id,
            [C.tenant_id]: input.tenant_id,
            [C.user_id]: input.user_id ?? null,
            [C.clinic_id]: input.clinic_id ?? null,
            [C.case_id]: input.case_id ?? null,
            [C.source_module]: input.source_module ?? null,
            [C.model_name]: input.model_name,
            [C.model_version]: input.model_version,
            [C.input_signature]: input.input_signature,
            [C.output_payload]: input.output_payload,
            [C.confidence_score]: input.confidence_score ?? null,
            [C.uncertainty_metrics]: input.uncertainty_metrics ?? null,
            [C.compute_profile]: input.compute_profile ?? null,
            [C.inference_latency_ms]: input.inference_latency_ms,
            [C.blocked]: input.blocked ?? false,
            ...(input.species !== undefined ? { species: input.species } : {}),
            ...(input.top_diagnosis !== undefined ? { top_diagnosis: input.top_diagnosis } : {}),
            ...(input.contradiction_score !== undefined ? { contradiction_score: input.contradiction_score } : {}),
            ...(input.outcome_confirmed !== undefined ? { outcome_confirmed: input.outcome_confirmed } : {}),
            ...(input.region !== undefined ? { region: input.region } : {}),
            ...(input.parent_inference_event_id !== undefined ? { parent_inference_event_id: input.parent_inference_event_id } : {}),
            [C.flagged]: input.flagged ?? false,
            [C.flag_reason]: input.flag_reason ?? null,
            [C.blocked_reason]: input.blocked_reason ?? null,
            [C.governance_policy_id]: input.governance_policy_id ?? null,
            [C.orphaned]: input.orphaned ?? false,
            [C.orphaned_at]: input.orphaned_at ?? null,
        })
        .select('id')
        .single();

    if (error || !data) {
        throw new Error(`Failed to log inference event: ${error?.message ?? 'Unknown error'}`);
    }

    return data.id as string;
}
