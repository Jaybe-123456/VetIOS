/**
 * Outcome Logger
 *
 * Inserts into clinical_outcome_events.
 * Returns inserted row ID.
 *
 * Rule: Never update inference logs. Outcomes are separate events.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface OutcomeLogInput {
    tenant_id: string;
    clinic_id?: string | null;
    case_id?: string | null;
    inference_event_id: string;
    outcome_type: string;
    outcome_payload: Record<string, unknown>;
    outcome_timestamp: string;
}

export async function logOutcome(
    client: SupabaseClient,
    input: OutcomeLogInput,
): Promise<string> {
    const { data, error } = await client
        .from('clinical_outcome_events')
        .insert({
            tenant_id: input.tenant_id,
            clinic_id: input.clinic_id ?? null,
            case_id: input.case_id ?? null,
            inference_event_id: input.inference_event_id,
            outcome_type: input.outcome_type,
            outcome_payload: input.outcome_payload,
            outcome_timestamp: input.outcome_timestamp,
        })
        .select('id')
        .single();

    if (error || !data) {
        throw new Error(`Failed to log outcome event: ${error?.message ?? 'Unknown error'}`);
    }

    return data.id as string;
}
