import { createHash } from 'crypto';
import type { GlobalConditionCoverageReport } from './types';

type CoverageSupabaseClient = {
    from: (table: string) => unknown;
};

type QueryResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;

export interface ConditionCoverageSnapshotInput {
    tenantId: string;
    requestId: string;
    inferenceEventId: string;
    coverage: GlobalConditionCoverageReport | null | undefined;
}

export interface ConditionCoverageSnapshotEvent {
    id?: string;
    request_id: string;
    coverage_scope: string;
    ontology_version: string;
    coverage_status: string;
    open_world_candidate_generation_status: string;
    coverage_score: number;
    registered_condition_count: number;
    source_mapped_condition_count: number;
    one_health_edge_count: number;
    blockers: string[];
    warnings: string[];
    created_at?: string;
}

export async function recordConditionCoverageSnapshotEvent(
    client: CoverageSupabaseClient,
    input: ConditionCoverageSnapshotInput,
): Promise<{ data: ConditionCoverageSnapshotEvent | null; error: string | null }> {
    if (!input.coverage) return { data: null, error: 'missing_coverage_report' };

    const coverage = input.coverage;
    const sourceHints = coverage.candidate_expansion_hints ?? [];
    const conditionHints = coverage.condition_candidate_hints ?? [];
    const packet = {
        inference_event_id: input.inferenceEventId,
        registry_scope: coverage.registry_scope,
        input_species: coverage.input_species,
        canonical_species: coverage.canonical_species,
        human_correlation_requested: coverage.human_correlation_requested,
        one_health_review_required: coverage.one_health_review_required,
        condition_candidate_status: coverage.condition_candidate_status,
        condition_hints: conditionHints.map((hint) => ({
            condition_key: hint.condition_key,
            canonical_name: hint.canonical_name,
            condition_domain: hint.condition_domain,
            human_relevance: hint.human_relevance,
            zoonotic_role: hint.zoonotic_role,
            amr_relevance: hint.amr_relevance,
            source_keys: hint.source_keys,
            matched_terms: hint.matched_terms,
            reason: hint.reason,
        })),
        source_hints: sourceHints.map((hint) => ({
            source_key: hint.source_key,
            source_type: hint.source_type,
            authority_tier: hint.authority_tier,
            medicine_domain: hint.medicine_domain,
            reason: hint.reason,
        })),
    };

    const row = {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        coverage_scope: 'inference_global_one_health',
        ontology_version: 'global_one_health_v1',
        species_scope: [coverage.canonical_species],
        syndrome_scope: [] as string[],
        region_scope: [] as string[],
        registered_condition_count: coverage.registered_candidate_count,
        source_mapped_condition_count: coverage.source_backed_count,
        one_health_edge_count: 0,
        human_correlation_count: coverage.human_correlation_requested ? 1 : 0,
        amr_relevant_condition_count: sourceHints.filter((hint) =>
            hint.medicine_domain.some((domain) => domain.includes('antimicrobial_resistance') || domain === 'amr'),
        ).length + conditionHints.filter((hint) =>
            hint.amr_relevance === 'confirmed' || hint.amr_relevance === 'surveillance_priority',
        ).length,
        unsupported_species_count: coverage.status === 'unsupported' ? 1 : 0,
        coverage_score: coverage.score,
        coverage_status: mapCoverageStatus(coverage.status),
        open_world_candidate_generation_status: coverage.open_world_candidate_generation,
        blockers: coverage.blockers,
        warnings: coverage.warnings,
        coverage_packet: packet,
        source_manifest_hash: sha256({
            source_hints: sourceHints.map((hint) => ({
                source_key: hint.source_key,
                source_type: hint.source_type,
                authority_tier: hint.authority_tier,
            })),
            condition_hints: conditionHints.map((hint) => ({
                condition_key: hint.condition_key,
                source_keys: hint.source_keys,
                human_relevance: hint.human_relevance,
                amr_relevance: hint.amr_relevance,
            })),
        }),
    };

    const table = client.from('condition_coverage_snapshot_events') as {
        insert: (payload: Record<string, unknown>) => {
            select: (columns: string) => {
                single: () => QueryResult<Record<string, unknown>>;
            };
        };
    };

    const { data, error } = await table
        .insert(row)
        .select('id, request_id, coverage_scope, ontology_version, coverage_status, open_world_candidate_generation_status, coverage_score, registered_condition_count, source_mapped_condition_count, one_health_edge_count, blockers, warnings, created_at')
        .single();

    if (error) {
        console.warn(JSON.stringify({
            event: 'condition_coverage_snapshot_insert_failed',
            inference_event_id: input.inferenceEventId,
            error: error.message ?? 'unknown',
        }));
        return { data: null, error: error.message ?? 'coverage_snapshot_insert_failed' };
    }

    return { data: data ? normalizeRow(data) : null, error: data ? null : 'coverage_snapshot_insert_returned_no_row' };
}

function mapCoverageStatus(status: GlobalConditionCoverageReport['status']) {
    if (status === 'covered') return 'operational';
    if (status === 'unsupported' || status === 'gap') return 'blocked';
    return 'partial';
}

function normalizeRow(row: Record<string, unknown>): ConditionCoverageSnapshotEvent {
    return {
        id: readString(row.id) ?? undefined,
        request_id: readString(row.request_id) ?? '',
        coverage_scope: readString(row.coverage_scope) ?? '',
        ontology_version: readString(row.ontology_version) ?? '',
        coverage_status: readString(row.coverage_status) ?? 'foundation',
        open_world_candidate_generation_status: readString(row.open_world_candidate_generation_status) ?? 'missing',
        coverage_score: readNumber(row.coverage_score) ?? 0,
        registered_condition_count: readNumber(row.registered_condition_count) ?? 0,
        source_mapped_condition_count: readNumber(row.source_mapped_condition_count) ?? 0,
        one_health_edge_count: readNumber(row.one_health_edge_count) ?? 0,
        blockers: readStringArray(row.blockers),
        warnings: readStringArray(row.warnings),
        created_at: readString(row.created_at) ?? undefined,
    };
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

function readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
