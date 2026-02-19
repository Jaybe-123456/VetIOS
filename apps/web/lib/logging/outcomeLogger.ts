/**
 * Outcome Logger
 *
 * Inserts into clinical_outcome_events using schema contracts.
 * Returns inserted row ID.
 *
 * Rule: Never update inference logs. Outcomes are separate events.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { CLINICAL_OUTCOME_EVENTS } from '@/lib/db/schemaContracts';

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
    const C = CLINICAL_OUTCOME_EVENTS.COLUMNS;

    const { data, error } = await client
        .from(CLINICAL_OUTCOME_EVENTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenant_id,
            [C.clinic_id]: input.clinic_id ?? null,
            [C.case_id]: input.case_id ?? null,
            [C.inference_event_id]: input.inference_event_id,
            [C.outcome_type]: input.outcome_type,
            [C.outcome_payload]: input.outcome_payload,
            [C.outcome_timestamp]: input.outcome_timestamp,
        })
        .select('id')
        .single();

    if (error || !data) {
        throw new Error(`Failed to log outcome event: ${error?.message ?? 'Unknown error'}`);
    }

    return data.id as string;
}
