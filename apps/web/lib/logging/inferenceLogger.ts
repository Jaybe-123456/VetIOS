/**
 * Inference Logger
 *
 * Inserts into ai_inference_events using schema contracts.
 * Returns inserted row ID.
 *
 * This is where the moat becomes automatic.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { AI_INFERENCE_EVENTS } from '@/lib/db/schemaContracts';
import {
    DIAGNOSTIC_PROMPT_TEMPLATE_VERSION,
    INFERENCE_SCHEMA_VERSION,
    computePromptTemplateHash,
} from '@/lib/inference/lineage';

export interface InferenceLogInput {
    id?: string;
    tenant_id: string;
    user_id?: string | null;
    clinic_id?: string | null;
    case_id?: string | null;
    source_module?: string | null;
    model_name: string;
    model_version: string;
    prompt_template_hash?: string | null;
    prompt_template_version?: string | null;
    schema_version?: string | null;
    phi_hat?: number | null;
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
    structured_input_text?: string | null;
    active_systems?: string[] | null;
    simulation_id?: string | null;
    is_synthetic?: boolean;
    simulation_agent_index?: number | null;
    simulation_request_index?: number | null;
    abortSignal?: AbortSignal;
}

export async function logInference(
    client: SupabaseClient,
    input: InferenceLogInput,
): Promise<string> {
    const C = AI_INFERENCE_EVENTS.COLUMNS;
    const eventId = input.id ?? randomUUID();

    let query = client
        .from(AI_INFERENCE_EVENTS.TABLE)
        .insert({
            [C.id]: eventId,
            [C.tenant_id]: input.tenant_id,
            [C.user_id]: input.user_id ?? null,
            [C.clinic_id]: input.clinic_id ?? null,
            [C.case_id]: input.case_id ?? null,
            [C.source_module]: input.source_module ?? null,
            [C.model_name]: input.model_name,
            [C.model_version]: input.model_version,
            [C.prompt_template_hash]: input.prompt_template_hash ?? computePromptTemplateHash(),
            [C.prompt_template_version]: input.prompt_template_version ?? DIAGNOSTIC_PROMPT_TEMPLATE_VERSION,
            [C.schema_version]: input.schema_version ?? resolveSchemaVersion(input.input_signature),
            [C.phi_hat]: clampPhiHat(input.phi_hat ?? extractPhiHat(input.output_payload, input.uncertainty_metrics, input.confidence_score)),
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
            ...(input.structured_input_text !== undefined ? { structured_input_text: input.structured_input_text } : {}),
            ...(input.active_systems !== undefined ? { active_systems: input.active_systems } : {}),
            [C.flagged]: input.flagged ?? false,
            [C.flag_reason]: input.flag_reason ?? null,
            [C.blocked_reason]: input.blocked_reason ?? null,
            [C.governance_policy_id]: input.governance_policy_id ?? null,
            [C.orphaned]: input.orphaned ?? false,
            [C.orphaned_at]: input.orphaned_at ?? null,
            ...(input.simulation_id !== undefined ? { [C.simulation_id]: input.simulation_id } : {}),
            ...(input.is_synthetic !== undefined ? { [C.is_synthetic]: input.is_synthetic } : {}),
            ...(input.simulation_agent_index !== undefined ? { [C.simulation_agent_index]: input.simulation_agent_index } : {}),
            ...(input.simulation_request_index !== undefined ? { [C.simulation_request_index]: input.simulation_request_index } : {}),
        });
    if (input.abortSignal) {
        query = query.abortSignal(input.abortSignal);
    }
    const { error } = await query;

    if (error) {
        throw new Error(`Failed to log inference event: ${error?.message ?? 'Unknown error'}`);
    }

    return eventId;
}

function resolveSchemaVersion(inputSignature: Record<string, unknown>): string {
    const metadata = asRecord(inputSignature.metadata);
    return readText(inputSignature.schema_version)
        ?? readText(metadata.schema_version)
        ?? (metadata.v2_payload === true ? 'v2' : INFERENCE_SCHEMA_VERSION);
}

function extractPhiHat(
    outputPayload: Record<string, unknown>,
    uncertaintyMetrics?: Record<string, unknown> | null,
    confidenceScore?: number | null,
): number {
    const uncertainty = asRecord(uncertaintyMetrics);
    const outputCire = asRecord(outputPayload.cire);
    return readNumber(uncertainty.phi_hat)
        ?? readNumber(asRecord(uncertainty.cire).phi_hat)
        ?? readNumber(outputCire.phi_hat)
        ?? confidenceScore
        ?? 0;
}

function clampPhiHat(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
