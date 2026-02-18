/**
 * @vetios/domain — Outcome Module
 *
 * Tracks clinical outcomes linked to encounters and optionally to AI decisions.
 * This data closes the Learning Loop: Decision → Action → Outcome.
 */

import type { TypedSupabaseClient } from '@vetios/db';
import type { Outcome, Json } from '@vetios/db';
import { createLogger } from '@vetios/logger';

const logger = createLogger({ module: 'domain.outcome' });

export interface RecordOutcomeInput {
    tenant_id: string;
    encounter_id: string;
    decision_id?: string;
    outcome_type: string;
    result: Json;
    recorded_by: string;
}

/**
 * Records a clinical outcome.
 * If a decision_id is provided, the outcome is linked to that AI decision
 * for downstream learning / prompt evaluation.
 */
export async function recordOutcome(
    client: TypedSupabaseClient,
    input: RecordOutcomeInput,
): Promise<Outcome> {
    const { data, error } = await client
        .from('outcomes')
        .insert({
            tenant_id: input.tenant_id,
            encounter_id: input.encounter_id,
            decision_id: input.decision_id ?? null,
            outcome_type: input.outcome_type,
            result: input.result,
            recorded_by: input.recorded_by,
        })
        .select()
        .single();

    if (error || !data) {
        logger.error('Failed to record outcome', { error, encounter_id: input.encounter_id });
        throw new Error(`Failed to record outcome: ${error?.message ?? 'Unknown error'}`);
    }

    const result = data as Outcome;
    logger.info('Outcome recorded', {
        outcome_id: result.id,
        encounter_id: result.encounter_id,
        decision_id: result.decision_id,
        outcome_type: result.outcome_type,
    });

    return result;
}

/**
 * Lists all outcomes for a specific encounter.
 */
export async function listOutcomesByEncounter(
    client: TypedSupabaseClient,
    encounterId: string,
): Promise<Outcome[]> {
    const { data, error } = await client
        .from('outcomes')
        .select()
        .eq('encounter_id', encounterId)
        .order('recorded_at', { ascending: true });

    if (error) {
        throw new Error(`Failed to list outcomes: ${error.message}`);
    }

    return (data ?? []) as Outcome[];
}

/**
 * Lists all outcomes linked to a specific AI decision.
 * Used to evaluate whether an AI suggestion led to a positive or negative outcome.
 */
export async function listOutcomesByDecision(
    client: TypedSupabaseClient,
    decisionId: string,
): Promise<Outcome[]> {
    const { data, error } = await client
        .from('outcomes')
        .select()
        .eq('decision_id', decisionId)
        .order('recorded_at', { ascending: true });

    if (error) {
        throw new Error(`Failed to list outcomes by decision: ${error.message}`);
    }

    return (data ?? []) as Outcome[];
}
