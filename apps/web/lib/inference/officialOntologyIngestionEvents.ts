import { createHash } from 'crypto';
import type { OfficialOntologyIngestionSummary } from './globalOneHealthOfficialIngestion';

type IngestionEventSupabaseClient = {
    from: (table: string) => {
        insert: (payload: Record<string, unknown>) => {
            select: (columns: string) => {
                single: () => Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
            };
        };
    };
};

export interface OfficialOntologyIngestionRunEventInput {
    tenantId: string;
    requestId: string;
    ingestion: OfficialOntologyIngestionSummary;
    insertedRows: number;
    dryRun: boolean;
    observedAt?: string | null;
}

export async function recordOfficialOntologyIngestionRunEvent(
    client: IngestionEventSupabaseClient,
    input: OfficialOntologyIngestionRunEventInput,
): Promise<{ id: string | null; error: string | null }> {
    const providerKeys = input.ingestion.provider_plan.map((provider) => provider.provider_key);
    const readyProviderCount = input.ingestion.provider_plan.filter((provider) => provider.status === 'ready').length;
    const verifiedMappingCount = input.ingestion.matches.length;
    const status = input.dryRun
        ? 'dry_run'
        : input.ingestion.errors.length > 0 && input.insertedRows === 0
            ? 'failed'
            : input.ingestion.errors.length > 0 || input.ingestion.skipped_providers.length > 0
                ? 'partial'
                : 'ingested';

    const packet = {
        provider_plan: input.ingestion.provider_plan,
        skipped_providers: input.ingestion.skipped_providers,
        errors: input.ingestion.errors,
        matches: input.ingestion.matches.map((match) => ({
            condition_key: match.condition_key,
            source_key: match.source_key,
            code_system: match.code_system,
            external_code: match.external_code,
            match_basis: match.match_basis,
            provider_key: match.provider_key,
        })),
    };

    const row = {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        ingestion_scope: 'global_one_health_official_ontology',
        ingestion_status: status,
        provider_keys: providerKeys,
        ready_provider_count: readyProviderCount,
        skipped_provider_count: input.ingestion.skipped_providers.length,
        error_count: input.ingestion.errors.length,
        matched_condition_count: new Set(input.ingestion.matches.map((match) => match.condition_key)).size,
        verified_mapping_count: verifiedMappingCount,
        inserted_mapping_count: input.insertedRows,
        dry_run: input.dryRun,
        ingestion_packet: packet,
        source_manifest_hash: sha256(packet),
        blockers: buildBlockers(input.ingestion),
        warnings: [
            'Official ontology ingestion creates source-code mappings only; it does not validate patient diagnosis or treatment.',
            'Credentialed/licensed sources must be configured before ICD, UMLS, SNOMED, or VeNom coverage can be called complete.',
        ],
        observed_at: input.observedAt ?? null,
    };

    const { data, error } = await client
        .from('official_ontology_ingestion_run_events')
        .insert(row)
        .select('id')
        .single();

    if (error) {
        console.warn(JSON.stringify({
            event: 'official_ontology_ingestion_run_insert_failed',
            request_id: input.requestId,
            error: error.message ?? 'unknown',
        }));
        return { id: null, error: error.message ?? 'official_ontology_ingestion_run_insert_failed' };
    }

    return { id: typeof data?.id === 'string' ? data.id : null, error: null };
}

function buildBlockers(ingestion: OfficialOntologyIngestionSummary) {
    const blockers = new Set<string>();
    for (const provider of ingestion.provider_plan) {
        if (provider.status === 'requires_credentials') blockers.add(`credentials_required:${provider.provider_key}`);
        if (provider.status === 'requires_source_release') blockers.add(`source_release_required:${provider.provider_key}`);
        if (provider.status === 'license_gated') blockers.add(`license_required:${provider.provider_key}`);
    }
    if (ingestion.errors.length > 0) blockers.add('official_provider_errors_present');
    return Array.from(blockers);
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
