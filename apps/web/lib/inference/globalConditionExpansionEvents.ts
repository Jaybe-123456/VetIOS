import { createHash } from 'crypto';
import type { GlobalConditionExpansionReport } from './types';

type ExpansionEventSupabaseClient = {
    from: (table: string) => {
        insert: (payload: Record<string, unknown>) => {
            select: (columns: string) => {
                single: () => Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
            };
        };
    };
};

export interface GlobalConditionExpansionEventInput {
    tenantId: string;
    requestId: string;
    inferenceEventId: string;
    expansion: GlobalConditionExpansionReport;
    observedAt?: string | null;
}

export async function recordGlobalConditionExpansionEvent(
    client: ExpansionEventSupabaseClient,
    input: GlobalConditionExpansionEventInput,
): Promise<{ id: string | null; error: string | null }> {
    const verifiedConditionKeys = [...new Set(input.expansion.verified_mappings.map((mapping) => mapping.condition_key))];
    const verifiedCodeSystems = [...new Set(input.expansion.verified_mappings.map((mapping) => mapping.external_code_system))];
    const packet = {
        status: input.expansion.status,
        expansion_mode: input.expansion.expansion_mode,
        scoring_allowed: input.expansion.scoring_allowed,
        candidate_keys: input.expansion.candidate_keys,
        verified_mappings: input.expansion.verified_mappings.map((mapping) => ({
            condition_key: mapping.condition_key,
            source_key: mapping.source_key,
            external_code_system: mapping.external_code_system,
            external_code: mapping.external_code,
            mapping_status: mapping.mapping_status,
            mapping_confidence: mapping.mapping_confidence,
        })),
        graph_candidates: input.expansion.graph_candidates.map((candidate) => ({
            source_condition_key: candidate.source_condition_key,
            source_external_code: candidate.source_external_code,
            candidate_external_code_system: candidate.candidate_external_code_system,
            candidate_external_code: candidate.candidate_external_code,
            candidate_label: candidate.candidate_label,
            relationship_kind: candidate.relationship_kind,
            predicate: candidate.predicate,
            provider_key: candidate.provider_key,
        })),
        graph_candidate_count: input.expansion.graph_candidate_count,
        graph_relationship_count: input.expansion.graph_relationship_count,
        source_attested_mapping_count: input.expansion.source_attested_mapping_count,
        reviewer_verified_mapping_count: input.expansion.reviewer_verified_mapping_count,
        externally_verified_mapping_count: input.expansion.externally_verified_mapping_count,
        active_expansion_required_evidence: input.expansion.active_expansion_required_evidence,
        recommended_next_action: input.expansion.recommended_next_action,
        clinical_boundary: 'Verified ontology expansion is review-gated and does not alter probability scoring.',
    };

    const row = {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        inference_event_id: input.inferenceEventId,
        expansion_scope: 'inference_global_one_health',
        expansion_status: input.expansion.status,
        candidate_count: input.expansion.candidate_count,
        verified_mapping_count: input.expansion.verified_mapping_count,
        candidate_keys: input.expansion.candidate_keys,
        verified_condition_keys: verifiedConditionKeys,
        verified_code_systems: verifiedCodeSystems,
        probability_scoring_status: input.expansion.scoring_allowed ? 'outcome_validated' : 'blocked_pending_review',
        reviewer_gate_status: input.expansion.scoring_allowed
            ? 'approved'
            : input.expansion.verified_mapping_count > 0 ? 'required' : 'not_required',
        expansion_packet: packet,
        source_manifest_hash: sha256(packet),
        blockers: input.expansion.blockers,
        warnings: input.expansion.warnings,
        observed_at: input.observedAt ?? null,
    };

    const { data, error } = await client
        .from('global_condition_expansion_events')
        .insert(row)
        .select('id')
        .single();

    if (error) {
        console.warn(JSON.stringify({
            event: 'global_condition_expansion_event_insert_failed',
            inference_event_id: input.inferenceEventId,
            error: error.message ?? 'unknown',
        }));
        return { id: null, error: error.message ?? 'global_condition_expansion_event_insert_failed' };
    }

    return { id: typeof data?.id === 'string' ? data.id : null, error: null };
}

function sha256(value: unknown) {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
