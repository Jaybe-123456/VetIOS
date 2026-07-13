import { createHash } from 'crypto';
import { buildGlobalBiomedicalOntologyPopulationRows } from './globalBiomedicalOntologyPopulation';
import { fetchOfficialOntologyMatches, buildOfficialOntologyIngestionPlan } from './globalOneHealthOfficialIngestion';

type VerificationFetch = (input: string, init?: RequestInit) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json: () => Promise<unknown>;
    text?: () => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    headers?: {
        get: (name: string) => string | null;
    };
}>;

export const LICENSED_ONTOLOGY_PROVIDER_KEYS = [
    'umls_rest',
    'who_icd_11_api',
    'snomed_ct_release',
    'venom_release',
] as const;

export type LicensedOntologyProviderKey = typeof LICENSED_ONTOLOGY_PROVIDER_KEYS[number];

export type LicensedOntologyProviderVerificationStatus =
    | 'verified'
    | 'missing_credentials'
    | 'missing_release_url'
    | 'invalid_release_url'
    | 'fetch_failed'
    | 'parse_failed'
    | 'blocked';

export interface LicensedOntologyProviderVerificationRow {
    provider_key: LicensedOntologyProviderKey;
    provider_name: string;
    code_system: string;
    access_mode: 'credentialed_api' | 'licensed_release';
    status: LicensedOntologyProviderVerificationStatus;
    configured: boolean;
    required_env: string[];
    missing_env: string[];
    source_url: string;
    configured_source_url: string | null;
    parser_version: string | null;
    source_hash: string | null;
    imported_nodes: number;
    imported_relationships: number;
    imported_rows: number;
    skipped_rows: number;
    release_status: string | null;
    license_status: string | null;
    last_error_or_blocker: string | null;
    blockers: string[];
    warnings: string[];
    inference_expansion: {
        allowed: boolean;
        mode: 'blocked' | 'shadow';
        reason: string;
        required_before_active: string[];
    };
}

export interface LicensedOntologyProviderVerificationPacket {
    schema_version: 'licensed_ontology_provider_verification.v1';
    generated_at: string;
    provider_keys: LicensedOntologyProviderKey[];
    providers: LicensedOntologyProviderVerificationRow[];
    summary: {
        provider_count: number;
        verified_count: number;
        blocked_count: number;
        all_provider_operations_verified: boolean;
        active_candidate_expansion_allowed: boolean;
        missing_provider_keys: LicensedOntologyProviderKey[];
        blockers: string[];
        warnings: string[];
    };
    source_manifest_hash: string;
}

export async function verifyLicensedOntologyProviderOperations(input: {
    providerKeys?: string[];
    env?: Record<string, string | undefined>;
    fetchImpl?: VerificationFetch;
    requestId?: string;
    tenantId?: string | null;
    observedAt?: string;
    maxNodesPerProvider?: number;
    maxRelationshipsPerProvider?: number;
} = {}): Promise<LicensedOntologyProviderVerificationPacket> {
    const providerKeys = normalizeProviderKeys(input.providerKeys);
    const env = input.env ?? process.env;
    const generatedAt = input.observedAt ?? new Date().toISOString();
    const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as VerificationFetch);
    const providers: LicensedOntologyProviderVerificationRow[] = [];

    for (const providerKey of providerKeys) {
        if (providerKey === 'umls_rest') {
            providers.push(await verifyUmlsProvider({
                env,
                fetchImpl,
                generatedAt,
            }));
            continue;
        }

        providers.push(await verifyPopulationProvider({
            providerKey,
            env,
            fetchImpl,
            requestId: input.requestId ?? `licensed_ontology_provider_verification:${generatedAt}:${providerKey}`,
            tenantId: input.tenantId ?? null,
            observedAt: generatedAt,
            maxNodesPerProvider: input.maxNodesPerProvider ?? 25,
            maxRelationshipsPerProvider: input.maxRelationshipsPerProvider ?? 50,
        }));
    }

    const verifiedCount = providers.filter((provider) => provider.status === 'verified').length;
    const blockers = providers.flatMap((provider) => provider.blockers.map((blocker) => `${provider.provider_key}:${blocker}`));
    const missingProviderKeys = providers
        .filter((provider) => provider.status !== 'verified')
        .map((provider) => provider.provider_key);
    const packetWithoutHash = {
        schema_version: 'licensed_ontology_provider_verification.v1' as const,
        generated_at: generatedAt,
        provider_keys: providerKeys,
        providers,
        summary: {
            provider_count: providers.length,
            verified_count: verifiedCount,
            blocked_count: providers.length - verifiedCount,
            all_provider_operations_verified: verifiedCount === providers.length,
            active_candidate_expansion_allowed: false,
            missing_provider_keys: missingProviderKeys,
            blockers,
            warnings: [
                'Provider verification proves fetch/parser operation only; source mappings still need reviewer and external validation before active probability scoring.',
                'SNOMED CT and VeNom release URLs must obey their licenses and should not be committed to Git.',
            ],
        },
    };

    return {
        ...packetWithoutHash,
        source_manifest_hash: sha256(packetWithoutHash),
    };
}

async function verifyUmlsProvider(input: {
    env: Record<string, string | undefined>;
    fetchImpl: VerificationFetch;
    generatedAt: string;
}): Promise<LicensedOntologyProviderVerificationRow> {
    const provider = resolveProvider('umls_rest');
    const apiKey = input.env.UMLS_API_KEY?.trim();
    const base = baseProviderRow(provider, {
        configuredSourceUrl: provider.url,
        configured: Boolean(apiKey),
        missingEnv: apiKey ? [] : ['UMLS_API_KEY'],
    });

    if (!apiKey) {
        return finalizeProviderRow(base, {
            status: 'missing_credentials',
            blockers: ['umls_api_key_missing'],
            warning: 'Configure UMLS_API_KEY after UMLS license approval.',
        });
    }

    try {
        const ingestion = await fetchOfficialOntologyMatches({
            fetchImpl: input.fetchImpl,
            providerKeys: ['umls_rest'],
            conditionKeys: ['rabies'],
            env: { UMLS_API_KEY: apiKey },
        });
        if (ingestion.errors.length > 0) {
            return finalizeProviderRow(base, {
                status: 'fetch_failed',
                blockers: ingestion.errors.map((error) => error.error),
            });
        }
        if (ingestion.matches.length === 0) {
            return finalizeProviderRow(base, {
                status: 'parse_failed',
                blockers: ingestion.skipped_providers.length > 0
                    ? ingestion.skipped_providers.map((entry) => entry.reason)
                    : ['umls_exact_search_returned_no_matches'],
            });
        }

        const sourceHash = sha256({
            provider_key: provider.provider_key,
            verified_at: input.generatedAt,
            matches: ingestion.matches.map((match) => ({
                condition_key: match.condition_key,
                external_code: match.external_code,
                matched_label: match.matched_label,
                source_document_hash: match.source_document_hash,
            })),
        });

        return finalizeProviderRow(base, {
            status: 'verified',
            parserVersion: 'umls_rest_exact_search_v1',
            sourceHash,
            importedRows: ingestion.matches.length,
            importedNodes: ingestion.matches.length,
            releaseStatus: 'api_verified',
            licenseStatus: 'credentialed',
            warning: 'UMLS mappings are source-attested until reviewer verification promotes them.',
        });
    } catch (error) {
        return finalizeProviderRow(base, {
            status: 'fetch_failed',
            blockers: [error instanceof Error ? error.message : 'unknown_umls_verification_error'],
        });
    }
}

async function verifyPopulationProvider(input: {
    providerKey: Exclude<LicensedOntologyProviderKey, 'umls_rest'>;
    env: Record<string, string | undefined>;
    fetchImpl: VerificationFetch;
    requestId: string;
    tenantId: string | null;
    observedAt: string;
    maxNodesPerProvider: number;
    maxRelationshipsPerProvider: number;
}): Promise<LicensedOntologyProviderVerificationRow> {
    const provider = resolveProvider(input.providerKey);
    const requiredEnv = provider.required_env ?? [];
    const missingEnv = requiredEnv.filter((key) => !input.env[key]?.trim());
    const configuredSourceUrl = provider.release_url_env
        ? input.env[provider.release_url_env]?.trim() || null
        : provider.url;
    const base = baseProviderRow(provider, {
        configuredSourceUrl,
        configured: missingEnv.length === 0 && Boolean(configuredSourceUrl),
        missingEnv: provider.release_url_env && !configuredSourceUrl
            ? [provider.release_url_env]
            : missingEnv,
    });

    if (missingEnv.length > 0) {
        return finalizeProviderRow(base, {
            status: 'missing_credentials',
            blockers: missingEnv.map((key) => `missing_env:${key}`),
        });
    }
    if (provider.release_url_env && !configuredSourceUrl) {
        return finalizeProviderRow(base, {
            status: 'missing_release_url',
            blockers: [`missing_env:${provider.release_url_env}`],
        });
    }

    try {
        const rows = await buildGlobalBiomedicalOntologyPopulationRows({
            tenantId: input.tenantId,
            requestId: input.requestId,
            providerKeys: [input.providerKey],
            env: input.env,
            fetchImpl: input.fetchImpl,
            maxNodesPerProvider: input.maxNodesPerProvider,
            maxRelationshipsPerProvider: input.maxRelationshipsPerProvider,
            observedAt: input.observedAt,
        });
        const errors = rows.errors.filter((entry) => entry.provider_key === input.providerKey);
        if (errors.length > 0) {
            return finalizeProviderRow(base, {
                status: 'fetch_failed',
                blockers: errors.map((entry) => entry.error),
            });
        }

        const skipped = rows.skippedProviders.find((entry) => entry.provider_key === input.providerKey);
        const release = rows.releaseRows.find((row) => row.provider_key === input.providerKey);
        if (!release && skipped) {
            return finalizeProviderRow(base, {
                status: mapSkippedReasonToStatus(skipped.reason),
                blockers: [skipped.reason],
            });
        }
        if (!release) {
            return finalizeProviderRow(base, {
                status: 'parse_failed',
                blockers: ['provider_returned_no_release_packet'],
            });
        }

        const importedNodes = readNumber(release.imported_node_count);
        const importedRelationships = readNumber(release.imported_relationship_count);
        const releaseBlockers = readStringArray(release.blockers);
        const parserVersion = readString(asRecord(release.release_packet).parser);
        const importedRows = importedNodes + importedRelationships;
        const status: LicensedOntologyProviderVerificationStatus = importedRows > 0
            ? 'verified'
            : releaseBlockers.some((blocker) => blocker.includes('url'))
                ? 'invalid_release_url'
                : 'parse_failed';

        return finalizeProviderRow(base, {
            status,
            parserVersion,
            sourceHash: readString(release.source_document_hash),
            importedNodes,
            importedRelationships,
            importedRows,
            skippedRows: inferSkippedRows(release),
            releaseStatus: readString(release.release_status),
            licenseStatus: readString(release.license_status),
            blockers: status === 'verified' ? releaseBlockers : releaseBlockers.length > 0 ? releaseBlockers : ['provider_imported_zero_rows'],
            warning: status === 'verified'
                ? 'Provider fetch and parser verified; mapping review still controls scoring eligibility.'
                : undefined,
        });
    } catch (error) {
        return finalizeProviderRow(base, {
            status: 'fetch_failed',
            blockers: [error instanceof Error ? error.message : `unknown_${input.providerKey}_verification_error`],
        });
    }
}

function baseProviderRow(
    provider: ReturnType<typeof resolveProvider>,
    input: {
        configuredSourceUrl: string | null;
        configured: boolean;
        missingEnv: string[];
    },
): LicensedOntologyProviderVerificationRow {
    return {
        provider_key: provider.provider_key,
        provider_name: provider.name,
        code_system: provider.code_system,
        access_mode: provider.access === 'credentialed_api' ? 'credentialed_api' : 'licensed_release',
        status: 'blocked',
        configured: input.configured,
        required_env: provider.required_env ?? (provider.release_url_env ? [provider.release_url_env] : []),
        missing_env: input.missingEnv,
        source_url: provider.url,
        configured_source_url: input.configuredSourceUrl,
        parser_version: null,
        source_hash: null,
        imported_nodes: 0,
        imported_relationships: 0,
        imported_rows: 0,
        skipped_rows: 0,
        release_status: null,
        license_status: null,
        last_error_or_blocker: null,
        blockers: [],
        warnings: [],
        inference_expansion: {
            allowed: false,
            mode: 'blocked',
            reason: 'Provider operation has not been verified.',
            required_before_active: [
                'source_mapping_review',
                'external_mapping_validation',
                'outcome_confirmed_evidence',
            ],
        },
    };
}

function finalizeProviderRow(
    base: LicensedOntologyProviderVerificationRow,
    update: {
        status: LicensedOntologyProviderVerificationStatus;
        parserVersion?: string | null;
        sourceHash?: string | null;
        importedNodes?: number;
        importedRelationships?: number;
        importedRows?: number;
        skippedRows?: number;
        releaseStatus?: string | null;
        licenseStatus?: string | null;
        blockers?: string[];
        warning?: string;
    },
): LicensedOntologyProviderVerificationRow {
    const blockers = update.blockers ?? [];
    const verified = update.status === 'verified';
    return {
        ...base,
        status: update.status,
        parser_version: update.parserVersion ?? base.parser_version,
        source_hash: update.sourceHash ?? base.source_hash,
        imported_nodes: update.importedNodes ?? base.imported_nodes,
        imported_relationships: update.importedRelationships ?? base.imported_relationships,
        imported_rows: update.importedRows ?? base.imported_rows,
        skipped_rows: update.skippedRows ?? base.skipped_rows,
        release_status: update.releaseStatus ?? base.release_status,
        license_status: update.licenseStatus ?? base.license_status,
        last_error_or_blocker: blockers[0] ?? null,
        blockers,
        warnings: [
            ...(update.warning ? [update.warning] : []),
            ...base.warnings,
        ],
        inference_expansion: {
            allowed: verified,
            mode: verified ? 'shadow' : 'blocked',
            reason: verified
                ? 'Provider may contribute shadow candidates after source mappings are materialized; active scoring still requires review, external validation, and outcome evidence.'
                : 'Provider is blocked from candidate expansion until verification succeeds.',
            required_before_active: base.inference_expansion.required_before_active,
        },
    };
}

function resolveProvider(providerKey: LicensedOntologyProviderKey) {
    const plan = buildOfficialOntologyIngestionPlan({}).find((provider) => provider.provider_key === providerKey);
    const provider = plan
        ? {
            provider_key: providerKey,
            source_key: plan.source_key,
            code_system: plan.code_system,
            name: providerDisplayName(providerKey),
            access: plan.access,
            role: plan.role,
            url: plan.url,
            required_env: plan.required_env,
            release_url_env: plan.release_url_env,
        }
        : null;
    if (!provider) throw new Error(`unknown licensed ontology provider: ${providerKey}`);
    return provider;
}

function providerDisplayName(providerKey: LicensedOntologyProviderKey) {
    switch (providerKey) {
        case 'umls_rest':
            return 'NLM UMLS REST API';
        case 'who_icd_11_api':
            return 'WHO ICD-11 API';
        case 'snomed_ct_release':
            return 'SNOMED CT release files';
        case 'venom_release':
            return 'VeNom veterinary nomenclature release';
    }
}

function normalizeProviderKeys(providerKeys?: string[]): LicensedOntologyProviderKey[] {
    const requested = providerKeys?.length ? providerKeys : [...LICENSED_ONTOLOGY_PROVIDER_KEYS];
    return [...new Set(requested)]
        .filter((key): key is LicensedOntologyProviderKey =>
            (LICENSED_ONTOLOGY_PROVIDER_KEYS as readonly string[]).includes(key),
        );
}

function mapSkippedReasonToStatus(reason: string): LicensedOntologyProviderVerificationStatus {
    if (reason.includes('missing') || reason.includes('credentials')) return 'missing_credentials';
    if (reason.includes('not_configured')) return 'missing_release_url';
    if (reason.includes('portal_url') || reason.includes('homepage')) return 'invalid_release_url';
    if (reason.includes('fetch_failed')) return 'fetch_failed';
    return 'blocked';
}

function inferSkippedRows(release: Record<string, unknown>) {
    const releasePacket = asRecord(release.release_packet);
    return readNumber(releasePacket.skipped_rows)
        || readNumber(releasePacket.truncated_rows)
        || 0;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
}

function sha256(value: unknown) {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}
