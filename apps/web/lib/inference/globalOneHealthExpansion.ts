import type {
    GlobalConditionCoverageReport,
    GlobalConditionExpansionReport,
    GlobalConditionGraphCandidate,
    GlobalConditionVerifiedMapping,
} from './types';

type ExpansionSupabaseClient = {
    from: (table: string) => unknown;
};

const VERIFIED_MAPPING_STATUSES = ['source_attested', 'reviewer_verified', 'externally_verified'];

export async function expandGlobalConditionCandidatesFromVerifiedMappings(input: {
    client: ExpansionSupabaseClient;
    tenantId: string;
    coverage: GlobalConditionCoverageReport | null | undefined;
}): Promise<GlobalConditionExpansionReport> {
    const candidateKeys = [...new Set(input.coverage?.condition_candidate_hints?.map((hint) => hint.condition_key) ?? [])];
    if (candidateKeys.length === 0) {
        return {
            status: 'no_candidate_hints',
            candidate_count: 0,
            verified_mapping_count: 0,
            graph_candidate_count: 0,
            graph_relationship_count: 0,
            candidate_keys: [],
            verified_mappings: [],
            graph_candidates: [],
            blockers: ['no_source_seeded_condition_candidates'],
            warnings: [],
            recommended_next_action: 'Materialize source-seeded One Health candidates before enabling verified expansion.',
        };
    }

    try {
        const { data, error } = await queryVerifiedMappings(input.client, input.tenantId, candidateKeys);

        if (error) {
            return {
                status: 'query_failed',
                candidate_count: candidateKeys.length,
                verified_mapping_count: 0,
                graph_candidate_count: 0,
                graph_relationship_count: 0,
                candidate_keys: candidateKeys,
                verified_mappings: [],
                graph_candidates: [],
                blockers: ['verified_mapping_query_failed'],
                warnings: [error.message ?? 'Unknown verified mapping query error.'],
                recommended_next_action: 'Check ontology mapping table availability, RLS, and service credentials before enabling active expansion.',
            };
        }

        const verifiedMappings = (data ?? [])
            .map(normalizeMappingRow)
            .filter((row): row is GlobalConditionVerifiedMapping => row !== null)
            .filter((row) => VERIFIED_MAPPING_STATUSES.includes(row.mapping_status));
        const graphExpansion = await loadGraphCandidates(input.client, input.tenantId, verifiedMappings);
        const hasGraphCandidates = graphExpansion.graphCandidates.length > 0;

        return {
            status: hasGraphCandidates
                ? 'graph_candidates_available'
                : verifiedMappings.length > 0
                    ? 'verified_candidates_available'
                    : 'no_verified_mappings',
            candidate_count: candidateKeys.length,
            verified_mapping_count: verifiedMappings.length,
            graph_candidate_count: graphExpansion.graphCandidates.length,
            graph_relationship_count: graphExpansion.relationshipCount,
            candidate_keys: candidateKeys,
            verified_mappings: verifiedMappings,
            graph_candidates: graphExpansion.graphCandidates,
            blockers: verifiedMappings.length > 0
                ? ['reviewer_verification_required_before_probability_scoring']
                : ['official_external_codes_not_materialized_for_candidates'],
            warnings: [
                'Verified ontology mappings expand candidate awareness only; they do not alter diagnostic probabilities until reviewer and outcome evidence exist.',
                ...graphExpansion.warnings,
            ],
            recommended_next_action: hasGraphCandidates
                ? 'Queue graph-backed candidates for mapping review; keep scoring blocked until reviewer verification and outcome evidence exist.'
                : verifiedMappings.length > 0
                ? 'Show verified global condition candidates for clinician review, then promote reviewer-verified mappings into active differential expansion.'
                : 'Run official ontology ingestion and reviewer verification for the current candidate keys.',
        };
    } catch (error) {
        return {
            status: 'query_failed',
            candidate_count: candidateKeys.length,
            verified_mapping_count: 0,
            graph_candidate_count: 0,
            graph_relationship_count: 0,
            candidate_keys: candidateKeys,
            verified_mappings: [],
            graph_candidates: [],
            blockers: ['verified_mapping_query_exception'],
            warnings: [error instanceof Error ? error.message : 'Unknown verified mapping query exception.'],
            recommended_next_action: 'Repair the verified mapping expansion query before enabling active global candidate expansion.',
        };
    }
}

async function queryVerifiedMappings(client: ExpansionSupabaseClient, tenantId: string, candidateKeys: string[]) {
    const table = client.from('global_condition_source_mapping_events') as {
        select: (columns: string) => {
            eq: (column: string, value: string) => {
                in: (column: string, values: string[]) => {
                    not: (column: string, operator: string, value: null) => {
                        order: (column: string, options: { ascending: boolean }) => {
                            limit: (count: number) => Promise<{
                                data: Array<Record<string, unknown>> | null;
                                error: { message?: string } | null;
                            }>;
                        };
                    };
                };
            };
        };
    };

    return table
        .select('condition_key, source_key, source_authority, source_type, external_code_system, external_code, mapping_status, mapping_confidence, source_version, created_at')
        .eq('tenant_id', tenantId)
        .in('condition_key', candidateKeys)
        .not('external_code', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100);
}

async function loadGraphCandidates(
    client: ExpansionSupabaseClient,
    tenantId: string,
    mappings: GlobalConditionVerifiedMapping[],
): Promise<{
    graphCandidates: GlobalConditionGraphCandidate[];
    relationshipCount: number;
    warnings: string[];
}> {
    const externalCodes = [...new Set(mappings.map((mapping) => mapping.external_code).filter(Boolean))];
    if (externalCodes.length === 0) {
        return { graphCandidates: [], relationshipCount: 0, warnings: [] };
    }

    try {
        const relationshipRows = await queryGraphRelationships(client, tenantId, externalCodes);
        if (relationshipRows.error) {
            return {
                graphCandidates: [],
                relationshipCount: 0,
                warnings: [`ontology_graph_relationship_query_failed:${relationshipRows.error.message ?? 'unknown'}`],
            };
        }
        const relationships = relationshipRows.data ?? [];
        const neighborCodes = [...new Set(relationships.flatMap((row) => [
            readString(row.subject_code),
            readString(row.object_code),
        ]).filter((value): value is string => typeof value === 'string' && !externalCodes.includes(value)))];
        if (neighborCodes.length === 0) {
            return { graphCandidates: [], relationshipCount: relationships.length, warnings: [] };
        }

        const nodeRows = await queryGraphNodes(client, tenantId, neighborCodes);
        if (nodeRows.error) {
            return {
                graphCandidates: [],
                relationshipCount: relationships.length,
                warnings: [`ontology_graph_node_query_failed:${nodeRows.error.message ?? 'unknown'}`],
            };
        }

        const nodesByCode = new Map((nodeRows.data ?? []).map((row) => [readString(row.external_code), row]));
        const mappingsByCode = new Map(mappings.map((mapping) => [mapping.external_code, mapping]));
        const graphCandidates: GlobalConditionGraphCandidate[] = [];

        for (const relationship of relationships) {
            const subjectCode = readString(relationship.subject_code);
            const objectCode = readString(relationship.object_code);
            const sourceCode = subjectCode && externalCodes.includes(subjectCode) ? subjectCode : objectCode && externalCodes.includes(objectCode) ? objectCode : null;
            const candidateCode = sourceCode === subjectCode ? objectCode : subjectCode;
            if (!sourceCode || !candidateCode) continue;
            const sourceMapping = mappingsByCode.get(sourceCode);
            const candidateNode = nodesByCode.get(candidateCode);
            if (!sourceMapping || !candidateNode) continue;

            graphCandidates.push({
                source_condition_key: sourceMapping.condition_key,
                source_external_code_system: sourceMapping.external_code_system,
                source_external_code: sourceCode,
                candidate_external_code_system: readString(candidateNode.code_system) ?? readString(relationship.code_system) ?? sourceMapping.external_code_system,
                candidate_external_code: candidateCode,
                candidate_label: readString(candidateNode.canonical_label) ?? candidateCode,
                relationship_kind: readString(relationship.relationship_kind) ?? 'ontology_edge',
                predicate: readString(relationship.predicate) ?? 'related_to',
                source_key: readString(candidateNode.source_key) ?? sourceMapping.source_key,
                provider_key: readString(candidateNode.provider_key) ?? '',
            });
        }

        return {
            graphCandidates: dedupeGraphCandidates(graphCandidates).slice(0, 25),
            relationshipCount: relationships.length,
            warnings: graphCandidates.length > 0
                ? ['Graph-backed candidates are shadow candidates only until mapping review and outcome validation.']
                : [],
        };
    } catch (error) {
        return {
            graphCandidates: [],
            relationshipCount: 0,
            warnings: [error instanceof Error ? error.message : 'ontology_graph_query_exception'],
        };
    }
}

async function queryGraphRelationships(client: ExpansionSupabaseClient, tenantId: string, externalCodes: string[]) {
    const table = client.from('global_biomedical_ontology_relationship_events') as {
        select: (columns: string) => {
            eq: (column: string, value: string) => {
                or: (filters: string) => {
                    order: (column: string, options: { ascending: boolean }) => {
                        limit: (count: number) => Promise<{
                            data: Array<Record<string, unknown>> | null;
                            error: { message?: string } | null;
                        }>;
                    };
                };
            };
        };
    };
    const quotedCodes = externalCodes.map((code) => `"${code.replace(/"/g, '\\"')}"`).join(',');
    return table
        .select('provider_key, source_key, code_system, subject_code, predicate, object_code, relationship_kind, created_at')
        .eq('tenant_id', tenantId)
        .or(`subject_code.in.(${quotedCodes}),object_code.in.(${quotedCodes})`)
        .order('created_at', { ascending: false })
        .limit(100);
}

async function queryGraphNodes(client: ExpansionSupabaseClient, tenantId: string, externalCodes: string[]) {
    const table = client.from('global_biomedical_ontology_node_events') as {
        select: (columns: string) => {
            eq: (column: string, value: string) => {
                in: (column: string, values: string[]) => {
                    order: (column: string, options: { ascending: boolean }) => {
                        limit: (count: number) => Promise<{
                            data: Array<Record<string, unknown>> | null;
                            error: { message?: string } | null;
                        }>;
                    };
                };
            };
        };
    };
    return table
        .select('provider_key, source_key, code_system, external_code, canonical_label, node_kind, created_at')
        .eq('tenant_id', tenantId)
        .in('external_code', externalCodes)
        .order('created_at', { ascending: false })
        .limit(100);
}

function normalizeMappingRow(row: Record<string, unknown>): GlobalConditionVerifiedMapping | null {
    const conditionKey = readString(row.condition_key);
    const sourceKey = readString(row.source_key);
    const sourceAuthority = readString(row.source_authority);
    const sourceType = readString(row.source_type);
    const externalCodeSystem = readString(row.external_code_system);
    const externalCode = readString(row.external_code);
    const mappingStatus = readString(row.mapping_status);
    const mappingConfidence = readNumber(row.mapping_confidence);

    if (
        !conditionKey
        || !sourceKey
        || !sourceAuthority
        || !sourceType
        || !externalCodeSystem
        || !externalCode
        || !isVerifiedStatus(mappingStatus)
        || mappingConfidence === null
    ) {
        return null;
    }

    return {
        condition_key: conditionKey,
        source_key: sourceKey,
        source_authority: sourceAuthority,
        source_type: sourceType,
        external_code_system: externalCodeSystem,
        external_code: externalCode,
        mapping_status: mappingStatus,
        mapping_confidence: mappingConfidence,
        source_version: readString(row.source_version),
        created_at: readString(row.created_at),
    };
}

function dedupeGraphCandidates(candidates: GlobalConditionGraphCandidate[]): GlobalConditionGraphCandidate[] {
    const seen = new Set<string>();
    const deduped: GlobalConditionGraphCandidate[] = [];
    for (const candidate of candidates) {
        const key = [
            candidate.source_external_code_system,
            candidate.source_external_code,
            candidate.candidate_external_code_system,
            candidate.candidate_external_code,
            candidate.predicate,
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(candidate);
    }
    return deduped;
}

function isVerifiedStatus(value: string | null): value is GlobalConditionVerifiedMapping['mapping_status'] {
    return value === 'source_attested' || value === 'reviewer_verified' || value === 'externally_verified';
}

function readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
