/**
 * @vetios/domain — Decision Module
 *
 * Handles creation and retrieval of AI decision log records.
 * Every AI output in VetIOS flows through this module for traceability.
 */

import type { TypedSupabaseClient } from '@vetios/db';
import type { AIDecisionLog, Json } from '@vetios/db';
import { createLogger } from '@vetios/logger';

const logger = createLogger({ module: 'domain.decision' });

export interface CreateDecisionLogInput {
    tenant_id: string;
    encounter_id: string;
    trace_id: string;
    model_version: string;
    prompt_template_id: string;
    context_snapshot: Json;
    raw_output: string;
    parsed_output: Json;
    latency_ms: number;
}

/**
 * Creates an immutable AI decision log entry.
 * This is the core traceability record for the Decision Intelligence Layer.
 */
export async function createDecisionLog(
    client: TypedSupabaseClient,
    input: CreateDecisionLogInput,
): Promise<AIDecisionLog> {
    const { data, error } = await client
        .from('ai_decision_logs')
        .insert({
            tenant_id: input.tenant_id,
            encounter_id: input.encounter_id,
            trace_id: input.trace_id,
            model_version: input.model_version,
            prompt_template_id: input.prompt_template_id,
            context_snapshot: input.context_snapshot,
            raw_output: input.raw_output,
            parsed_output: input.parsed_output,
            latency_ms: input.latency_ms,
        })
        .select()
        .single();

    if (error || !data) {
        logger.error('Failed to create decision log', { error, trace_id: input.trace_id });
        throw new Error(`Failed to create decision log: ${error?.message ?? 'Unknown error'}`);
    }

    const result = data as AIDecisionLog;
    logger.info('Decision log created', {
        decision_id: result.id,
        trace_id: result.trace_id,
        encounter_id: result.encounter_id,
        model: result.model_version,
        latency_ms: result.latency_ms,
    });

    return result;
}

/**
 * Retrieves a decision log by its unique trace_id.
 * Used for "Why did it say that?" auditing.
 */
export async function getDecisionByTraceId(
    client: TypedSupabaseClient,
    traceId: string,
): Promise<AIDecisionLog | null> {
    const { data, error } = await client
        .from('ai_decision_logs')
        .select()
        .eq('trace_id', traceId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw new Error(`Failed to fetch decision by trace_id: ${error.message}`);
    }

    return data as AIDecisionLog;
}

/**
 * Lists all AI decision logs for a specific encounter, ordered chronologically.
 */
export async function listDecisionsByEncounter(
    client: TypedSupabaseClient,
    encounterId: string,
): Promise<AIDecisionLog[]> {
    const { data, error } = await client
        .from('ai_decision_logs')
        .select()
        .eq('encounter_id', encounterId)
        .order('created_at', { ascending: true });

    if (error) {
        throw new Error(`Failed to list decisions: ${error.message}`);
    }

    return (data ?? []) as AIDecisionLog[];
}
