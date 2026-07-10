import {
    OFFICIAL_ONTOLOGY_PROVIDERS,
    buildOfficialOntologyIngestionPlan,
    fetchOfficialOntologyMatches,
} from './globalOneHealthOfficialIngestion';
import {
    buildGlobalBiomedicalOntologyPopulationRows,
    recordGlobalBiomedicalOntologyPopulationEvents,
} from './globalBiomedicalOntologyPopulation';
import {
    buildGlobalOntologyCompletionSnapshot,
    recordGlobalOntologyCompletionSnapshot,
} from './globalOntologyCompletionSnapshot';
import { recordOfficialOntologyIngestionRunEvent } from './officialOntologyIngestionEvents';

type OperationsSupabaseClient = {
    from: (table: string) => unknown;
};

type QueryResult = Promise<{
    data: Array<Record<string, unknown>> | null;
    error: { message?: string } | null;
}>;

type ReleaseEventRow = {
    provider_key: string;
    source_key: string | null;
    code_system: string | null;
    source_url: string | null;
    release_status: string | null;
    source_document_hash: string | null;
    node_count: number | null;
    relationship_count: number | null;
    imported_node_count: number | null;
    imported_relationship_count: number | null;
    release_packet: Record<string, unknown>;
    blockers: string[];
    warnings: string[];
    observed_at: string | null;
    created_at: string | null;
};

type IngestionAuditRow = {
    ingestion_status: string | null;
    provider_keys: string[];
    ready_provider_count: number | null;
    skipped_provider_count: number | null;
    error_count: number | null;
    verified_mapping_count: number | null;
    inserted_mapping_count: number | null;
    dry_run: boolean | null;
    blockers: string[];
    warnings: string[];
    ingestion_packet: Record<string, unknown>;
    created_at: string | null;
};

type CompletionSnapshotRow = {
    completion_status: string | null;
    imported_provider_count: number | null;
    missing_provider_count: number | null;
    latest_coverage_score: number | null;
    open_world_candidate_generation_status: string | null;
    scoring_state: string | null;
    imported_provider_keys: string[];
    missing_provider_keys: string[];
    blockers: string[];
    warnings: string[];
    created_at: string | null;
};

type PopulationSnapshotRow = {
    population_status: string | null;
    imported_provider_count: number | null;
    blocked_provider_count: number | null;
    total_node_count: number | null;
    total_relationship_count: number | null;
    source_manifest_hash: string | null;
    created_at: string | null;
};

type MappingStatusCounts = {
    source_attested: number;
    reviewer_verified: number;
    externally_verified: number;
};

export interface IngestionOperationsProviderRow {
    provider_key: string;
    name: string;
    source_key: string;
    code_system: string;
    role: string;
    access: string;
    configuration_status: 'configured' | 'missing_url' | 'missing_credentials' | 'license_gated';
    configured: boolean;
    source_url: string;
    configured_source_url: string | null;
    release_url_env: string | null;
    required_env: string[];
    missing_env: string[];
    last_run_status: string;
    latest_release_at: string | null;
    source_hash: string | null;
    imported_rows: number;
    skipped_rows: number;
    raw_rows: number;
    parser_version: string;
    last_error_or_blocker: string | null;
    latest_audit_status: string | null;
    latest_audit_at: string | null;
    latest_ontology_coverage: {
        completion_status: string | null;
        imported_provider_count: number;
        missing_provider_count: number;
        coverage_score: number;
        provider_imported: boolean;
    };
    inference_expansion: {
        allowed: boolean;
        mode: 'active' | 'shadow' | 'blocked' | 'not_applicable';
        reason: string;
        source_attested_mappings: number;
        reviewer_verified_mappings: number;
        externally_verified_mappings: number;
    };
}

export interface IngestionOperationsSnapshot {
    tenant_id: string;
    generated_at: string;
    providers: IngestionOperationsProviderRow[];
    summary: {
        provider_count: number;
        configured_count: number;
        imported_provider_count: number;
        missing_provider_count: number;
        allowed_inference_expansion_count: number;
        latest_completion_status: string | null;
        latest_population_status: string | null;
        total_imported_rows: number;
        total_skipped_rows: number;
    };
    latest_completion: CompletionSnapshotRow | null;
    latest_population: PopulationSnapshotRow | null;
    query_errors: string[];
}

export interface IngestionProviderRunResult {
    tenant_id: string;
    provider_key: string;
    dry_run: boolean;
    population: {
        release_rows: number;
        node_rows: number;
        relationship_rows: number;
        snapshot_inserted: boolean;
        skipped_providers: Array<{ provider_key: string; reason: string }>;
        errors: Array<{ provider_key: string; error: string }>;
        error: string | null;
    };
    mapping_ingestion: {
        matched_conditions: number;
        matches: number;
        inserted_rows: number;
        skipped_providers: Array<{ provider_key: string; reason: string }>;
        errors: Array<{ provider_key: string; error: string }>;
        audit_event_id: string | null;
        audit_error: string | null;
        error: string | null;
    };
    completion: {
        snapshot_event_id: string | null;
        status: string;
        imported_provider_count: number;
        missing_provider_count: number;
        error: string | null;
        query_errors: string[];
    };
    writes_committed: boolean;
}

export async function buildIngestionOperationsSnapshot(input: {
    client: OperationsSupabaseClient;
    tenantId: string;
    env?: Record<string, string | undefined>;
}): Promise<IngestionOperationsSnapshot> {
    const env = input.env ?? process.env;
    const providerPlan = buildOfficialOntologyIngestionPlan(env);
    const [
        releaseRowsResult,
        auditRowsResult,
        completionRowsResult,
        populationRowsResult,
        mappingRowsResult,
    ] = await Promise.all([
        queryRows(input.client, 'official_ontology_release_events', input.tenantId, 'provider_key, source_key, code_system, source_url, release_status, source_document_hash, node_count, relationship_count, imported_node_count, imported_relationship_count, release_packet, blockers, warnings, observed_at, created_at', 500),
        queryRows(input.client, 'official_ontology_ingestion_run_events', input.tenantId, 'ingestion_status, provider_keys, ready_provider_count, skipped_provider_count, error_count, verified_mapping_count, inserted_mapping_count, dry_run, blockers, warnings, ingestion_packet, created_at', 200),
        queryRows(input.client, 'global_biomedical_ontology_completion_snapshot_events', input.tenantId, 'completion_status, imported_provider_count, missing_provider_count, latest_coverage_score, open_world_candidate_generation_status, scoring_state, imported_provider_keys, missing_provider_keys, blockers, warnings, created_at', 20),
        queryRows(input.client, 'global_biomedical_ontology_population_snapshot_events', input.tenantId, 'population_status, imported_provider_count, blocked_provider_count, total_node_count, total_relationship_count, source_manifest_hash, created_at', 20),
        queryRows(input.client, 'global_condition_source_mapping_events', input.tenantId, 'source_key, mapping_status, created_at', 5000),
    ]);

    const queryErrors = [
        releaseRowsResult.error,
        auditRowsResult.error,
        completionRowsResult.error,
        populationRowsResult.error,
        mappingRowsResult.error,
    ].filter((value): value is string => Boolean(value));

    const releases = releaseRowsResult.data.map(toReleaseEventRow);
    const audits = auditRowsResult.data.map(toIngestionAuditRow);
    const latestCompletion = completionRowsResult.data[0] ? toCompletionSnapshotRow(completionRowsResult.data[0]) : null;
    const latestPopulation = populationRowsResult.data[0] ? toPopulationSnapshotRow(populationRowsResult.data[0]) : null;
    const mappingCountsBySource = buildMappingCountsBySource(mappingRowsResult.data);
    const latestReleaseByProvider = new Map<string, ReleaseEventRow>();
    const latestAuditByProvider = new Map<string, IngestionAuditRow>();

    for (const release of releases) {
        if (!latestReleaseByProvider.has(release.provider_key)) {
            latestReleaseByProvider.set(release.provider_key, release);
        }
    }

    for (const audit of audits) {
        for (const providerKey of audit.provider_keys) {
            if (!latestAuditByProvider.has(providerKey)) {
                latestAuditByProvider.set(providerKey, audit);
            }
        }
    }

    const planByProvider = new Map(providerPlan.map((plan) => [plan.provider_key, plan]));
    const providers = OFFICIAL_ONTOLOGY_PROVIDERS.map((provider) => {
        const plan = planByProvider.get(provider.provider_key);
        const release = latestReleaseByProvider.get(provider.provider_key) ?? null;
        const audit = latestAuditByProvider.get(provider.provider_key) ?? null;
        const configuredSourceUrl = provider.release_url_env ? normalizeText(env[provider.release_url_env]) : null;
        const requiredEnv = provider.required_env ?? [];
        const missingEnv = requiredEnv.filter((key) => !normalizeText(env[key]));
        const configurationStatus = resolveConfigurationStatus({
            access: provider.access,
            planStatus: plan?.status ?? 'requires_source_release',
            missingEnv,
            hasConfiguredSourceUrl: Boolean(configuredSourceUrl),
            hasReleaseUrlEnv: Boolean(provider.release_url_env),
        });
        const parserVersion = readParserVersion(release?.release_packet, provider.access);
        const rawRows = numberOrZero(readPacketNumber(release?.release_packet, 'raw_rows')) || numberOrZero(release?.node_count) + numberOrZero(release?.relationship_count);
        const importedRows = numberOrZero(release?.imported_node_count) + numberOrZero(release?.imported_relationship_count);
        const skippedRows = readSkippedRows(release);
        const mappingCounts = mappingCountsBySource.get(provider.source_key) ?? emptyMappingCounts();
        const inferenceExpansion = resolveInferenceExpansion(provider.role, mappingCounts);
        const providerImported = Boolean(latestCompletion?.imported_provider_keys.includes(provider.provider_key))
            || ['imported', 'partial'].includes(release?.release_status ?? '');
        const lastBlocker = firstText(release?.blockers)
            ?? firstText(audit?.blockers)
            ?? firstProviderAuditBlocker(audit, provider.provider_key)
            ?? null;

        return {
            provider_key: provider.provider_key,
            name: provider.name,
            source_key: provider.source_key,
            code_system: provider.code_system,
            role: provider.role,
            access: provider.access,
            configuration_status: configurationStatus,
            configured: configurationStatus === 'configured',
            source_url: release?.source_url ?? configuredSourceUrl ?? provider.url,
            configured_source_url: configuredSourceUrl,
            release_url_env: provider.release_url_env ?? null,
            required_env: requiredEnv,
            missing_env: missingEnv,
            last_run_status: release?.release_status ?? audit?.ingestion_status ?? plan?.status ?? 'not_run',
            latest_release_at: release?.created_at ?? null,
            source_hash: release?.source_document_hash ?? null,
            imported_rows: importedRows,
            skipped_rows: skippedRows,
            raw_rows: rawRows,
            parser_version: parserVersion,
            last_error_or_blocker: lastBlocker,
            latest_audit_status: audit?.ingestion_status ?? null,
            latest_audit_at: audit?.created_at ?? null,
            latest_ontology_coverage: {
                completion_status: latestCompletion?.completion_status ?? null,
                imported_provider_count: numberOrZero(latestCompletion?.imported_provider_count),
                missing_provider_count: numberOrZero(latestCompletion?.missing_provider_count),
                coverage_score: numberOrZero(latestCompletion?.latest_coverage_score),
                provider_imported: providerImported,
            },
            inference_expansion: inferenceExpansion,
        } satisfies IngestionOperationsProviderRow;
    });

    return {
        tenant_id: input.tenantId,
        generated_at: new Date().toISOString(),
        providers,
        summary: {
            provider_count: providers.length,
            configured_count: providers.filter((provider) => provider.configured).length,
            imported_provider_count: latestCompletion?.imported_provider_count ?? providers.filter((provider) => provider.latest_ontology_coverage.provider_imported).length,
            missing_provider_count: latestCompletion?.missing_provider_count ?? providers.filter((provider) => !provider.latest_ontology_coverage.provider_imported).length,
            allowed_inference_expansion_count: providers.filter((provider) => provider.inference_expansion.allowed).length,
            latest_completion_status: latestCompletion?.completion_status ?? null,
            latest_population_status: latestPopulation?.population_status ?? null,
            total_imported_rows: providers.reduce((sum, provider) => sum + provider.imported_rows, 0),
            total_skipped_rows: providers.reduce((sum, provider) => sum + provider.skipped_rows, 0),
        },
        latest_completion: latestCompletion,
        latest_population: latestPopulation,
        query_errors: queryErrors,
    };
}

export async function runIngestionProviderOperation(input: {
    client: OperationsSupabaseClient;
    tenantId: string;
    providerKey: string;
    dryRun: boolean;
    maxNodesPerProvider?: number;
    maxRelationshipsPerProvider?: number;
    env?: Record<string, string | undefined>;
}): Promise<IngestionProviderRunResult> {
    const provider = OFFICIAL_ONTOLOGY_PROVIDERS.find((entry) => entry.provider_key === input.providerKey);
    if (!provider) {
        throw new Error(`Unsupported provider_key: ${input.providerKey}`);
    }

    const observedAt = new Date().toISOString();
    const requestPrefix = `global_ontology_ops:${input.providerKey}:${Date.now()}`;
    const populationRequestId = `${requestPrefix}:population`;
    const ingestionRequestId = `${requestPrefix}:mapping`;
    const completionRequestId = `${requestPrefix}:completion`;
    const populationRows = await buildGlobalBiomedicalOntologyPopulationRows({
        tenantId: input.tenantId,
        requestId: populationRequestId,
        providerKeys: [input.providerKey],
        maxNodesPerProvider: input.maxNodesPerProvider,
        maxRelationshipsPerProvider: input.maxRelationshipsPerProvider,
        observedAt,
        env: input.env ?? process.env,
    });
    const populationWrite = input.dryRun
        ? {
            releaseRows: populationRows.releaseRows.length,
            nodeRows: populationRows.nodeRows.length,
            relationshipRows: populationRows.relationshipRows.length,
            snapshotInserted: false,
            error: null,
        }
        : await recordGlobalBiomedicalOntologyPopulationEvents(
            input.client as Parameters<typeof recordGlobalBiomedicalOntologyPopulationEvents>[0],
            populationRows,
        );

    const ingestion = await fetchOfficialOntologyMatches({
        providerKeys: [input.providerKey],
        env: input.env ?? process.env,
    });
    const mappingWrite = input.dryRun
        ? { inserted: 0, error: null }
        : await import('./globalOneHealthOfficialIngestion').then(({ recordVerifiedExternalCodeMappings }) => (
            recordVerifiedExternalCodeMappings({
                client: input.client as Parameters<typeof recordVerifiedExternalCodeMappings>[0]['client'],
                tenantId: input.tenantId,
                requestId: ingestionRequestId,
                matches: ingestion.matches,
                observedAt,
            })
        ));
    const ingestionAudit = await recordOfficialOntologyIngestionRunEvent(
        input.client as Parameters<typeof recordOfficialOntologyIngestionRunEvent>[0],
        {
            tenantId: input.tenantId,
            requestId: ingestionRequestId,
            ingestion,
            insertedRows: mappingWrite.inserted,
            dryRun: input.dryRun,
            observedAt,
        },
    );
    const completion = await buildGlobalOntologyCompletionSnapshot(
        input.client as Parameters<typeof buildGlobalOntologyCompletionSnapshot>[0],
        {
            tenantId: input.tenantId,
            requestId: completionRequestId,
            observedAt,
            env: input.env ?? process.env,
        },
    );
    const completionWrite = input.dryRun
        ? { id: null, error: null }
        : await recordGlobalOntologyCompletionSnapshot(
            input.client as Parameters<typeof recordGlobalOntologyCompletionSnapshot>[0],
            completion.snapshot,
        );

    return {
        tenant_id: input.tenantId,
        provider_key: input.providerKey,
        dry_run: input.dryRun,
        population: {
            release_rows: populationWrite.releaseRows,
            node_rows: populationWrite.nodeRows,
            relationship_rows: populationWrite.relationshipRows,
            snapshot_inserted: populationWrite.snapshotInserted,
            skipped_providers: populationRows.skippedProviders,
            errors: populationRows.errors,
            error: populationWrite.error,
        },
        mapping_ingestion: {
            matched_conditions: new Set(ingestion.matches.map((match) => match.condition_key)).size,
            matches: ingestion.matches.length,
            inserted_rows: mappingWrite.inserted,
            skipped_providers: ingestion.skipped_providers,
            errors: ingestion.errors,
            audit_event_id: ingestionAudit.id,
            audit_error: ingestionAudit.error,
            error: mappingWrite.error,
        },
        completion: {
            snapshot_event_id: completionWrite.id,
            status: completion.snapshot.completion_status,
            imported_provider_count: completion.snapshot.imported_provider_count,
            missing_provider_count: completion.snapshot.missing_provider_count,
            error: completionWrite.error,
            query_errors: completion.query_errors,
        },
        writes_committed: !input.dryRun,
    };
}

async function queryRows(
    client: OperationsSupabaseClient,
    tableName: string,
    tenantId: string,
    columns: string,
    limit: number,
): Promise<{ data: Array<Record<string, unknown>>; error: string | null }> {
    try {
        const table = client.from(tableName) as {
            select: (columns: string) => {
                eq: (column: string, value: string) => {
                    order: (column: string, options: { ascending: boolean }) => {
                        limit: (limit: number) => QueryResult;
                    };
                };
            };
        };
        const { data, error } = await table
            .select(columns)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(limit);

        return {
            data: Array.isArray(data) ? data : [],
            error: error?.message ?? null,
        };
    } catch (error) {
        return {
            data: [],
            error: error instanceof Error ? error.message : `${tableName}_query_failed`,
        };
    }
}

function toReleaseEventRow(row: Record<string, unknown>): ReleaseEventRow {
    return {
        provider_key: text(row.provider_key) ?? 'unknown_provider',
        source_key: text(row.source_key),
        code_system: text(row.code_system),
        source_url: text(row.source_url),
        release_status: text(row.release_status),
        source_document_hash: text(row.source_document_hash),
        node_count: numberOrNull(row.node_count),
        relationship_count: numberOrNull(row.relationship_count),
        imported_node_count: numberOrNull(row.imported_node_count),
        imported_relationship_count: numberOrNull(row.imported_relationship_count),
        release_packet: record(row.release_packet),
        blockers: stringArray(row.blockers),
        warnings: stringArray(row.warnings),
        observed_at: text(row.observed_at),
        created_at: text(row.created_at),
    };
}

function toIngestionAuditRow(row: Record<string, unknown>): IngestionAuditRow {
    return {
        ingestion_status: text(row.ingestion_status),
        provider_keys: stringArray(row.provider_keys),
        ready_provider_count: numberOrNull(row.ready_provider_count),
        skipped_provider_count: numberOrNull(row.skipped_provider_count),
        error_count: numberOrNull(row.error_count),
        verified_mapping_count: numberOrNull(row.verified_mapping_count),
        inserted_mapping_count: numberOrNull(row.inserted_mapping_count),
        dry_run: typeof row.dry_run === 'boolean' ? row.dry_run : null,
        blockers: stringArray(row.blockers),
        warnings: stringArray(row.warnings),
        ingestion_packet: record(row.ingestion_packet),
        created_at: text(row.created_at),
    };
}

function toCompletionSnapshotRow(row: Record<string, unknown>): CompletionSnapshotRow {
    return {
        completion_status: text(row.completion_status),
        imported_provider_count: numberOrNull(row.imported_provider_count),
        missing_provider_count: numberOrNull(row.missing_provider_count),
        latest_coverage_score: numberOrNull(row.latest_coverage_score),
        open_world_candidate_generation_status: text(row.open_world_candidate_generation_status),
        scoring_state: text(row.scoring_state),
        imported_provider_keys: stringArray(row.imported_provider_keys),
        missing_provider_keys: stringArray(row.missing_provider_keys),
        blockers: stringArray(row.blockers),
        warnings: stringArray(row.warnings),
        created_at: text(row.created_at),
    };
}

function toPopulationSnapshotRow(row: Record<string, unknown>): PopulationSnapshotRow {
    return {
        population_status: text(row.population_status),
        imported_provider_count: numberOrNull(row.imported_provider_count),
        blocked_provider_count: numberOrNull(row.blocked_provider_count),
        total_node_count: numberOrNull(row.total_node_count),
        total_relationship_count: numberOrNull(row.total_relationship_count),
        source_manifest_hash: text(row.source_manifest_hash),
        created_at: text(row.created_at),
    };
}

function buildMappingCountsBySource(rows: Record<string, unknown>[]) {
    const counts = new Map<string, MappingStatusCounts>();
    for (const row of rows) {
        const sourceKey = text(row.source_key);
        if (!sourceKey) continue;
        const status = text(row.mapping_status);
        const entry = counts.get(sourceKey) ?? emptyMappingCounts();
        if (status === 'source_attested') entry.source_attested += 1;
        if (status === 'reviewer_verified') entry.reviewer_verified += 1;
        if (status === 'externally_verified') entry.externally_verified += 1;
        counts.set(sourceKey, entry);
    }
    return counts;
}

function emptyMappingCounts(): MappingStatusCounts {
    return {
        source_attested: 0,
        reviewer_verified: 0,
        externally_verified: 0,
    };
}

function resolveConfigurationStatus(input: {
    access: string;
    planStatus: string;
    missingEnv: string[];
    hasConfiguredSourceUrl: boolean;
    hasReleaseUrlEnv: boolean;
}): IngestionOperationsProviderRow['configuration_status'] {
    if (input.planStatus === 'ready') return 'configured';
    if (input.access === 'licensed_release') return input.hasConfiguredSourceUrl ? 'configured' : 'license_gated';
    if (input.hasReleaseUrlEnv && !input.hasConfiguredSourceUrl) return 'missing_url';
    if (input.missingEnv.length > 0) return 'missing_credentials';
    return 'missing_url';
}

function resolveInferenceExpansion(role: string, counts: MappingStatusCounts): IngestionOperationsProviderRow['inference_expansion'] {
    const expansionRole = role === 'condition_code' || role === 'terminology_bridge' || role === 'phenotype_bridge';
    if (!expansionRole) {
        return {
            allowed: false,
            mode: 'not_applicable',
            reason: 'provider_role_not_used_for_candidate_expansion',
            source_attested_mappings: counts.source_attested,
            reviewer_verified_mappings: counts.reviewer_verified,
            externally_verified_mappings: counts.externally_verified,
        };
    }
    if (counts.externally_verified > 0 || counts.reviewer_verified > 0) {
        return {
            allowed: true,
            mode: counts.externally_verified > 0 ? 'active' : 'shadow',
            reason: counts.externally_verified > 0 ? 'externally_verified_mappings_available' : 'reviewer_verified_mappings_available',
            source_attested_mappings: counts.source_attested,
            reviewer_verified_mappings: counts.reviewer_verified,
            externally_verified_mappings: counts.externally_verified,
        };
    }
    if (counts.source_attested > 0) {
        return {
            allowed: false,
            mode: 'shadow',
            reason: 'reviewer_verification_required',
            source_attested_mappings: counts.source_attested,
            reviewer_verified_mappings: counts.reviewer_verified,
            externally_verified_mappings: counts.externally_verified,
        };
    }
    return {
        allowed: false,
        mode: 'blocked',
        reason: 'no_verified_source_mappings',
        source_attested_mappings: counts.source_attested,
        reviewer_verified_mappings: counts.reviewer_verified,
        externally_verified_mappings: counts.externally_verified,
    };
}

function readParserVersion(packet: Record<string, unknown> | undefined, access: string) {
    const parser = packet ? text(packet.parser) : null;
    if (parser) return parser;
    if (access === 'public_obo_json') return 'obo_json_v1';
    return 'not_observed';
}

function readSkippedRows(release: ReleaseEventRow | null) {
    if (!release) return 0;
    const packet = release.release_packet;
    return numberOrZero(readPacketNumber(packet, 'skipped_rows'))
        + numberOrZero(readPacketNumber(packet, 'truncated_rows'))
        + numberOrZero(readPacketNumber(packet, 'truncated_nodes'))
        + numberOrZero(readPacketNumber(packet, 'truncated_relationships'));
}

function readPacketNumber(packet: Record<string, unknown> | undefined, key: string) {
    return packet ? numberOrNull(packet[key]) : null;
}

function firstProviderAuditBlocker(audit: IngestionAuditRow | null, providerKey: string) {
    if (!audit) return null;
    const packet = audit.ingestion_packet;
    const skipped = Array.isArray(packet.skipped_providers) ? packet.skipped_providers : [];
    for (const entry of skipped) {
        const recordEntry = record(entry);
        if (recordEntry.provider_key === providerKey) {
            return text(recordEntry.reason);
        }
    }
    const errors = Array.isArray(packet.errors) ? packet.errors : [];
    for (const entry of errors) {
        const recordEntry = record(entry);
        if (recordEntry.provider_key === providerKey) {
            return text(recordEntry.error);
        }
    }
    return null;
}

function normalizeText(value: string | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function firstText(values: string[] | undefined) {
    return values?.find((value) => value.trim().length > 0) ?? null;
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function numberOrZero(value: unknown): number {
    return numberOrNull(value) ?? 0;
}
