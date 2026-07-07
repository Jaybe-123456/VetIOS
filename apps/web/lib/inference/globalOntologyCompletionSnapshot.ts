import { createHash } from 'crypto';
import { OFFICIAL_ONTOLOGY_PROVIDERS, buildOfficialOntologyIngestionPlan } from './globalOneHealthOfficialIngestion';

type CompletionSupabaseClient = {
    from: (table: string) => unknown;
};

type QueryRowsResult = Promise<{ data: Array<Record<string, unknown>> | null; error: { message?: string } | null }>;

export interface GlobalOntologyCompletionSnapshotInput {
    tenantId: string;
    requestId: string;
    observedAt?: string | null;
    env?: Record<string, string | undefined>;
}

export interface GlobalOntologyCompletionSnapshot {
    tenant_id: string;
    request_id: string;
    completion_scope: 'global_biomedical_ontology';
    completion_status: 'foundation' | 'partial' | 'blocked' | 'ready_for_review' | 'externally_validated' | 'fully_populated';
    required_provider_count: number;
    imported_provider_count: number;
    missing_provider_count: number;
    source_attested_mapping_count: number;
    reviewer_verified_mapping_count: number;
    externally_verified_mapping_count: number;
    review_event_count: number;
    external_validation_event_count: number;
    live_coverage_snapshot_count: number;
    latest_coverage_score: number;
    open_world_candidate_generation_status: 'missing' | 'shadow' | 'active' | 'blocked';
    scoring_state: 'blocked_pending_review' | 'reviewer_verified_shadow' | 'externally_verified_shadow' | 'outcome_validated_active';
    required_provider_keys: string[];
    imported_provider_keys: string[];
    missing_provider_keys: string[];
    completion_packet: Record<string, unknown>;
    source_manifest_hash: string;
    blockers: string[];
    warnings: string[];
    observed_at: string | null;
}

const REQUIRED_PROVIDER_KEYS = OFFICIAL_ONTOLOGY_PROVIDERS.map((provider) => provider.provider_key);

export async function buildGlobalOntologyCompletionSnapshot(
    client: CompletionSupabaseClient,
    input: GlobalOntologyCompletionSnapshotInput,
): Promise<{ snapshot: GlobalOntologyCompletionSnapshot; query_errors: string[] }> {
    const [
        releaseRows,
        mappingRows,
        reviewRows,
        externalValidationRows,
        coverageRows,
    ] = await Promise.all([
        queryRows(client, 'official_ontology_release_events', input.tenantId, 'provider_key, release_status, created_at', 2000),
        queryRows(client, 'global_condition_source_mapping_events', input.tenantId, 'source_key, mapping_status, created_at', 5000),
        queryRows(client, 'global_condition_source_mapping_review_events', input.tenantId, 'review_status, created_at', 5000),
        queryRows(client, 'global_ontology_external_validation_events', input.tenantId, 'validation_status, created_at', 5000),
        queryRows(client, 'condition_coverage_snapshot_events', input.tenantId, 'coverage_score, open_world_candidate_generation_status, created_at', 1000),
    ]);
    const queryErrors = [
        releaseRows.error,
        mappingRows.error,
        reviewRows.error,
        externalValidationRows.error,
        coverageRows.error,
    ].filter((error): error is string => typeof error === 'string');

    const plan = buildOfficialOntologyIngestionPlan(input.env);
    const releaseProviderKeys = new Set(
        releaseRows.data
            .filter((row) => ['imported', 'partial'].includes(readString(row.release_status) ?? ''))
            .map((row) => readString(row.provider_key))
            .filter((value): value is string => typeof value === 'string'),
    );
    const mappingSourceKeys = new Set(
        mappingRows.data
            .map((row) => readString(row.source_key))
            .filter((value): value is string => typeof value === 'string'),
    );
    const importedProviderKeys = REQUIRED_PROVIDER_KEYS.filter((providerKey) => {
        const sourceKey = OFFICIAL_ONTOLOGY_PROVIDERS.find((provider) => provider.provider_key === providerKey)?.source_key;
        return releaseProviderKeys.has(providerKey) || Boolean(sourceKey && mappingSourceKeys.has(sourceKey));
    });
    const missingProviderKeys = REQUIRED_PROVIDER_KEYS.filter((providerKey) => !importedProviderKeys.includes(providerKey));
    const sourceAttestedMappingCount = mappingRows.data.filter((row) => readString(row.mapping_status) === 'source_attested').length;
    const reviewerVerifiedMappingCount = mappingRows.data.filter((row) => readString(row.mapping_status) === 'reviewer_verified').length;
    const externallyVerifiedMappingCount = mappingRows.data.filter((row) => readString(row.mapping_status) === 'externally_verified').length;
    const reviewEventCount = reviewRows.data.length;
    const externalValidationEventCount = externalValidationRows.data.filter((row) =>
        readString(row.validation_status) === 'externally_verified',
    ).length;
    const latestCoverage = coverageRows.data[0] ?? null;
    const liveCoverageSnapshotCount = coverageRows.data.length;
    const latestCoverageScore = clamp01(readNumber(latestCoverage?.coverage_score) ?? 0);
    const openWorldStatus = normalizeOpenWorldStatus(readString(latestCoverage?.open_world_candidate_generation_status));
    const scoringState = classifyScoringState({
        reviewerVerifiedMappingCount,
        externallyVerifiedMappingCount,
        externalValidationEventCount,
    });
    const completionStatus = classifyCompletionStatus({
        importedProviderCount: importedProviderKeys.length,
        missingProviderCount: missingProviderKeys.length,
        sourceAttestedMappingCount,
        reviewerVerifiedMappingCount,
        externallyVerifiedMappingCount,
        reviewEventCount,
        externalValidationEventCount,
        liveCoverageSnapshotCount,
        queryErrors: queryErrors.length,
    });
    const blockers = buildBlockers({
        plan,
        missingProviderKeys,
        sourceAttestedMappingCount,
        reviewerVerifiedMappingCount,
        externallyVerifiedMappingCount,
        reviewEventCount,
        externalValidationEventCount,
        liveCoverageSnapshotCount,
        queryErrors,
    });
    const packet = {
        provider_plan: plan,
        release_provider_keys: Array.from(releaseProviderKeys).sort(),
        imported_provider_keys: importedProviderKeys,
        missing_provider_keys: missingProviderKeys,
        mapping_counts: {
            source_attested: sourceAttestedMappingCount,
            reviewer_verified: reviewerVerifiedMappingCount,
            externally_verified: externallyVerifiedMappingCount,
        },
        review_event_count: reviewEventCount,
        external_validation_event_count: externalValidationEventCount,
        live_coverage_snapshot_count: liveCoverageSnapshotCount,
        query_errors: queryErrors,
        clinical_boundary: 'Completion snapshot is evidence of ontology infrastructure state, not proof of patient-level diagnostic correctness.',
    };

    return {
        snapshot: {
            tenant_id: input.tenantId,
            request_id: input.requestId,
            completion_scope: 'global_biomedical_ontology',
            completion_status: completionStatus,
            required_provider_count: REQUIRED_PROVIDER_KEYS.length,
            imported_provider_count: importedProviderKeys.length,
            missing_provider_count: missingProviderKeys.length,
            source_attested_mapping_count: sourceAttestedMappingCount,
            reviewer_verified_mapping_count: reviewerVerifiedMappingCount,
            externally_verified_mapping_count: externallyVerifiedMappingCount,
            review_event_count: reviewEventCount,
            external_validation_event_count: externalValidationEventCount,
            live_coverage_snapshot_count: liveCoverageSnapshotCount,
            latest_coverage_score: latestCoverageScore,
            open_world_candidate_generation_status: openWorldStatus,
            scoring_state: scoringState,
            required_provider_keys: REQUIRED_PROVIDER_KEYS,
            imported_provider_keys: importedProviderKeys,
            missing_provider_keys: missingProviderKeys,
            completion_packet: packet,
            source_manifest_hash: sha256(packet),
            blockers,
            warnings: buildWarnings(completionStatus),
            observed_at: input.observedAt ?? null,
        },
        query_errors: queryErrors,
    };
}

export async function recordGlobalOntologyCompletionSnapshot(
    client: CompletionSupabaseClient,
    snapshot: GlobalOntologyCompletionSnapshot,
): Promise<{ id: string | null; error: string | null }> {
    const table = client.from('global_biomedical_ontology_completion_snapshot_events') as {
        insert: (payload: Record<string, unknown>) => {
            select: (columns: string) => {
                single: () => Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
            };
        };
    };
    const { data, error } = await table
        .insert(snapshot as unknown as Record<string, unknown>)
        .select('id')
        .single();

    if (error) return { id: null, error: error.message ?? 'ontology_completion_snapshot_insert_failed' };
    return { id: typeof data?.id === 'string' ? data.id : null, error: null };
}

async function queryRows(
    client: CompletionSupabaseClient,
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
                        limit: (count: number) => QueryRowsResult;
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
            data: data ?? [],
            error: error?.message ?? null,
        };
    } catch (error) {
        return {
            data: [],
            error: error instanceof Error ? error.message : `${tableName}_query_failed`,
        };
    }
}

function classifyScoringState(input: {
    reviewerVerifiedMappingCount: number;
    externallyVerifiedMappingCount: number;
    externalValidationEventCount: number;
}): GlobalOntologyCompletionSnapshot['scoring_state'] {
    if (input.externallyVerifiedMappingCount > 0 && input.externalValidationEventCount > 0) return 'externally_verified_shadow';
    if (input.reviewerVerifiedMappingCount > 0) return 'reviewer_verified_shadow';
    return 'blocked_pending_review';
}

function classifyCompletionStatus(input: {
    importedProviderCount: number;
    missingProviderCount: number;
    sourceAttestedMappingCount: number;
    reviewerVerifiedMappingCount: number;
    externallyVerifiedMappingCount: number;
    reviewEventCount: number;
    externalValidationEventCount: number;
    liveCoverageSnapshotCount: number;
    queryErrors: number;
}): GlobalOntologyCompletionSnapshot['completion_status'] {
    if (input.queryErrors > 0) return 'blocked';
    if (input.importedProviderCount === 0) return 'foundation';
    if (input.missingProviderCount > 0) return 'partial';
    if (input.sourceAttestedMappingCount > 0 && input.reviewerVerifiedMappingCount === 0) return 'ready_for_review';
    if (input.externallyVerifiedMappingCount > 0 && input.externalValidationEventCount > 0 && input.liveCoverageSnapshotCount > 0) return 'fully_populated';
    if (input.reviewerVerifiedMappingCount > 0 && input.reviewEventCount > 0) return 'externally_validated';
    return 'partial';
}

function buildBlockers(input: {
    plan: ReturnType<typeof buildOfficialOntologyIngestionPlan>;
    missingProviderKeys: string[];
    sourceAttestedMappingCount: number;
    reviewerVerifiedMappingCount: number;
    externallyVerifiedMappingCount: number;
    reviewEventCount: number;
    externalValidationEventCount: number;
    liveCoverageSnapshotCount: number;
    queryErrors: string[];
}): string[] {
    const blockers = new Set<string>();
    for (const provider of input.plan) {
        if (provider.status === 'requires_credentials') blockers.add(`credentials_required:${provider.provider_key}`);
        if (provider.status === 'requires_source_release') blockers.add(`source_release_required:${provider.provider_key}`);
        if (provider.status === 'license_gated') blockers.add(`license_required:${provider.provider_key}`);
    }
    for (const providerKey of input.missingProviderKeys) blockers.add(`provider_not_imported:${providerKey}`);
    if (input.sourceAttestedMappingCount === 0) blockers.add('no_source_attested_mappings');
    if (input.reviewerVerifiedMappingCount === 0) blockers.add('no_reviewer_verified_mappings');
    if (input.externallyVerifiedMappingCount === 0) blockers.add('no_externally_verified_mappings');
    if (input.reviewEventCount === 0) blockers.add('no_mapping_review_events');
    if (input.externalValidationEventCount === 0) blockers.add('no_external_validation_events');
    if (input.liveCoverageSnapshotCount === 0) blockers.add('no_live_coverage_snapshots');
    for (const error of input.queryErrors) blockers.add(`query_error:${error}`);
    return Array.from(blockers);
}

function buildWarnings(status: GlobalOntologyCompletionSnapshot['completion_status']) {
    if (status === 'fully_populated') {
        return [
            'Fully populated means required providers and validation evidence are present; active diagnostic scoring still requires outcome validation.',
        ];
    }
    return [
        'Do not describe the global biomedical ontology as fully populated until this snapshot reaches fully_populated.',
        'Missing credentials, licensed releases, reviewer verification, external validation, or live coverage snapshots keep scoring blocked.',
    ];
}

function normalizeOpenWorldStatus(value: string | null): GlobalOntologyCompletionSnapshot['open_world_candidate_generation_status'] {
    if (value === 'shadow' || value === 'active' || value === 'blocked') return value;
    return 'missing';
}

function readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp01(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
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
