/**
 * @vetios/domain — Override Module
 *
 * Captures human-in-the-loop decisions: acceptance, rejection, or modification
 * of AI suggestions. This data forms the "Gold Standard" dataset for learning.
 */

import type { TypedSupabaseClient } from '@vetios/db';
import type { Override, OverrideAction, Json } from '@vetios/db';
import { createLogger } from '@vetios/logger';

const logger = createLogger({ module: 'domain.override' });

export interface RecordOverrideInput {
    tenant_id: string;
    decision_id: string;
    user_id: string;
    action: OverrideAction;
    modification?: Json;
    reason?: string;
}

/**
 * Records a human override of an AI decision.
 * Append-only — overrides cannot be edited or deleted.
 */
export async function recordOverride(
    client: TypedSupabaseClient,
    input: RecordOverrideInput,
): Promise<Override> {
    const { data, error } = await client
        .from('overrides')
        .insert({
            tenant_id: input.tenant_id,
            decision_id: input.decision_id,
            user_id: input.user_id,
            action: input.action,
            modification: input.modification ?? null,
            reason: input.reason ?? null,
        })
        .select()
        .single();

    if (error || !data) {
        logger.error('Failed to record override', { error, decision_id: input.decision_id });
        throw new Error(`Failed to record override: ${error?.message ?? 'Unknown error'}`);
    }

    const result = data as Override;
    logger.info('Override recorded', {
        override_id: result.id,
        decision_id: result.decision_id,
        action: result.action,
        user_id: result.user_id,
    });

    return result;
}

/**
 * Lists all overrides for a specific AI decision.
 */
export async function listOverridesByDecision(
    client: TypedSupabaseClient,
    decisionId: string,
): Promise<Override[]> {
    const { data, error } = await client
        .from('overrides')
        .select()
        .eq('decision_id', decisionId)
        .order('created_at', { ascending: true });

    if (error) {
        throw new Error(`Failed to list overrides: ${error.message}`);
    }

    return (data ?? []) as Override[];
}

/**
 * Checks whether a specific decision has been overridden.
 */
export async function hasDecisionBeenOverridden(
    client: TypedSupabaseClient,
    decisionId: string,
): Promise<boolean> {
    const { count, error } = await client
        .from('overrides')
        .select('*', { count: 'exact', head: true })
        .eq('decision_id', decisionId);

    if (error) {
        throw new Error(`Failed to check override status: ${error.message}`);
    }

    return (count ?? 0) > 0;
}
