import { createHash } from 'crypto';
import {
    OFFICIAL_ONTOLOGY_PROVIDERS,
    buildOfficialOntologyIngestionPlan,
    type OfficialOntologyProvider,
    type OfficialOntologyProviderPlan,
} from './globalOneHealthOfficialIngestion';

type OfficialFetch = (input: string, init?: RequestInit) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json: () => Promise<unknown>;
    text?: () => Promise<string>;
    headers?: {
        get: (name: string) => string | null;
    };
}>;

type PopulationSupabaseClient = {
    from: (table: string) => {
        insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => Promise<{ data?: unknown; error: { message?: string } | null }>;
    };
};

export interface GlobalBiomedicalOntologyPopulationInput {
    tenantId?: string | null;
    requestId: string;
    providerKeys?: string[];
    maxNodesPerProvider?: number;
    maxRelationshipsPerProvider?: number;
    observedAt?: string | null;
    env?: Record<string, string | undefined>;
    fetchImpl?: OfficialFetch;
}

export interface GlobalBiomedicalOntologyPopulationRows {
    releaseRows: Record<string, unknown>[];
    nodeRows: Record<string, unknown>[];
    relationshipRows: Record<string, unknown>[];
    snapshotRow: Record<string, unknown>;
    providerPlan: OfficialOntologyProviderPlan[];
    skippedProviders: Array<{ provider_key: string; reason: string }>;
    errors: Array<{ provider_key: string; error: string }>;
}

export interface GlobalBiomedicalOntologyPopulationResult {
    releaseRows: number;
    nodeRows: number;
    relationshipRows: number;
    snapshotInserted: boolean;
    error: string | null;
}

const DEFAULT_NODE_LIMIT = 50_000;
const DEFAULT_RELATIONSHIP_LIMIT = 100_000;

export async function buildGlobalBiomedicalOntologyPopulationRows(
    input: GlobalBiomedicalOntologyPopulationInput,
): Promise<GlobalBiomedicalOntologyPopulationRows> {
    const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as OfficialFetch);
    const providerKeys = new Set(input.providerKeys ?? OFFICIAL_ONTOLOGY_PROVIDERS.map((provider) => provider.provider_key));
    const providerPlan = buildOfficialOntologyIngestionPlan(input.env)
        .filter((plan) => providerKeys.has(plan.provider_key));
    const planByKey = new Map(providerPlan.map((plan) => [plan.provider_key, plan]));
    const releaseRows: Record<string, unknown>[] = [];
    const nodeRows: Record<string, unknown>[] = [];
    const relationshipRows: Record<string, unknown>[] = [];
    const skippedProviders: GlobalBiomedicalOntologyPopulationRows['skippedProviders'] = [];
    const errors: GlobalBiomedicalOntologyPopulationRows['errors'] = [];

    for (const provider of OFFICIAL_ONTOLOGY_PROVIDERS.filter((entry) => providerKeys.has(entry.provider_key))) {
        const plan = planByKey.get(provider.provider_key);
        const allowBlockedDatasetEvidence = provider.provider_key === 'woah_wahis_official_export'
            || provider.provider_key === 'cdc_open_data_surveillance';
        if ((!plan || plan.status !== 'ready') && !allowBlockedDatasetEvidence) {
            skippedProviders.push({
                provider_key: provider.provider_key,
                reason: plan?.status ?? 'not_planned',
            });
            continue;
        }

        if (provider.access !== 'public_obo_json') {
            const parsed = await fetchProviderSpecificPopulationRows({
                provider,
                fetchImpl,
                tenantId: input.tenantId ?? null,
                requestId: input.requestId,
                observedAt: input.observedAt ?? null,
                maxNodes: input.maxNodesPerProvider ?? DEFAULT_NODE_LIMIT,
                maxRelationships: input.maxRelationshipsPerProvider ?? DEFAULT_RELATIONSHIP_LIMIT,
                env: input.env,
            });
            if (parsed.skippedReason) {
                skippedProviders.push({
                    provider_key: provider.provider_key,
                    reason: parsed.skippedReason,
                });
            }
            releaseRows.push(...parsed.releaseRows);
            nodeRows.push(...parsed.nodeRows);
            relationshipRows.push(...parsed.relationshipRows);
            continue;
        }

        try {
            const response = await fetchImpl(provider.url, { cache: 'no-store' });
            if (!response.ok) {
                errors.push({
                    provider_key: provider.provider_key,
                    error: `fetch_failed_${response.status}`,
                });
                continue;
            }

            const payload = await response.json();
            const parsed = parseOboJsonPopulation({
                provider,
                payload,
                tenantId: input.tenantId ?? null,
                requestId: input.requestId,
                observedAt: input.observedAt ?? null,
                maxNodes: input.maxNodesPerProvider ?? DEFAULT_NODE_LIMIT,
                maxRelationships: input.maxRelationshipsPerProvider ?? DEFAULT_RELATIONSHIP_LIMIT,
            });
            releaseRows.push(parsed.releaseRow);
            nodeRows.push(...parsed.nodeRows);
            relationshipRows.push(...parsed.relationshipRows);
        } catch (error) {
            errors.push({
                provider_key: provider.provider_key,
                error: error instanceof Error ? error.message : 'unknown_error',
            });
        }
    }

    const snapshotRow = buildPopulationSnapshotRow({
        tenantId: input.tenantId ?? null,
        requestId: input.requestId,
        providerPlan,
        releaseRows,
        nodeRows,
        relationshipRows,
        skippedProviders,
        errors,
        observedAt: input.observedAt ?? null,
    });

    return {
        releaseRows,
        nodeRows,
        relationshipRows,
        snapshotRow,
        providerPlan,
        skippedProviders,
        errors,
    };
}

export async function recordGlobalBiomedicalOntologyPopulationEvents(
    client: PopulationSupabaseClient,
    rows: GlobalBiomedicalOntologyPopulationRows,
): Promise<GlobalBiomedicalOntologyPopulationResult> {
    for (const [table, payload] of [
        ['official_ontology_release_events', rows.releaseRows],
        ['global_biomedical_ontology_node_events', rows.nodeRows],
        ['global_biomedical_ontology_relationship_events', rows.relationshipRows],
    ] as Array<[string, Record<string, unknown>[]]>) {
        for (const chunk of chunkRows(payload, 500)) {
            const { error } = await client.from(table).insert(chunk);
            if (error) {
                return {
                    releaseRows: rows.releaseRows.length,
                    nodeRows: rows.nodeRows.length,
                    relationshipRows: rows.relationshipRows.length,
                    snapshotInserted: false,
                    error: error.message ?? `${table}_insert_failed`,
                };
            }
        }
    }

    const { error } = await client.from('global_biomedical_ontology_population_snapshot_events').insert(rows.snapshotRow);
    if (error) {
        return {
            releaseRows: rows.releaseRows.length,
            nodeRows: rows.nodeRows.length,
            relationshipRows: rows.relationshipRows.length,
            snapshotInserted: false,
            error: error.message ?? 'population_snapshot_insert_failed',
        };
    }

    return {
        releaseRows: rows.releaseRows.length,
        nodeRows: rows.nodeRows.length,
        relationshipRows: rows.relationshipRows.length,
        snapshotInserted: true,
        error: null,
    };
}

async function fetchProviderSpecificPopulationRows(input: {
    provider: OfficialOntologyProvider;
    fetchImpl: OfficialFetch;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    maxNodes: number;
    maxRelationships: number;
    env?: Record<string, string | undefined>;
}): Promise<{
    releaseRows: Record<string, unknown>[];
    nodeRows: Record<string, unknown>[];
    relationshipRows: Record<string, unknown>[];
    skippedReason: string | null;
}> {
    if (input.provider.provider_key === 'who_icd_11_api') {
        return fetchIcd11PopulationRows(input);
    }

    if (input.provider.provider_key === 'pubmed_eutils' || input.provider.provider_key === 'pmc_eutils') {
        return fetchNcbiLiteraturePopulationRows(input);
    }

    if (input.provider.provider_key === 'woah_wahis_official_export') {
        return fetchWahisAutoIngestionRows(input);
    }

    if (input.provider.provider_key === 'cdc_open_data_surveillance') {
        return fetchCdcOpenDataRows(input);
    }

    const releaseUrl = input.provider.release_url_env
        ? input.env?.[input.provider.release_url_env] ?? process.env[input.provider.release_url_env]
        : null;
    if (!releaseUrl) {
        return {
            releaseRows: [],
            nodeRows: [],
            relationshipRows: [],
            skippedReason: input.provider.access === 'licensed_release'
                ? 'licensed_release_url_not_configured'
                : 'official_source_release_url_not_configured',
        };
    }

    try {
        const response = await input.fetchImpl(releaseUrl, { cache: 'no-store' });
        if (!response.ok) {
            return {
                releaseRows: [],
                nodeRows: [],
                relationshipRows: [],
                skippedReason: `fetch_failed_${response.status}`,
            };
        }

        const payload = await response.json();
        const parsed = parseGenericOfficialJsonPopulation({
            provider: input.provider,
            payload,
            sourceUrl: releaseUrl,
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
            maxNodes: input.maxNodes,
        });
        return {
            releaseRows: [parsed.releaseRow],
            nodeRows: parsed.nodeRows,
            relationshipRows: [],
            skippedReason: null,
        };
    } catch (error) {
        return {
            releaseRows: [],
            nodeRows: [],
            relationshipRows: [],
            skippedReason: error instanceof Error ? error.message : 'unknown_provider_import_error',
        };
    }
}

async function fetchWahisAutoIngestionRows(input: {
    provider: OfficialOntologyProvider;
    fetchImpl: OfficialFetch;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    maxNodes: number;
    maxRelationships: number;
    env?: Record<string, string | undefined>;
}) {
    const releaseUrl = normalizeOptionalText(input.env?.WAHIS_EXPORT_URL ?? process.env.WAHIS_EXPORT_URL);
    if (!releaseUrl) {
        const releasePacket = {
            provider_name: input.provider.name,
            provider_status: 'missing_export_url',
            expected_env: 'WAHIS_EXPORT_URL',
            expected_storage_path: 'ontology-provider-exports/wahis/latest.csv',
            source_portal: input.provider.url,
            setup_mode: 'one_time_admin_export_link',
            clinical_boundary: 'WAHIS ingestion is blocked until an official WOAH WAHIS CSV/JSON export URL is configured.',
        };
        return {
            releaseRows: [buildGenericReleaseRow({
                provider: input.provider,
                sourceUrl: input.provider.url,
                tenantId: input.tenantId,
                requestId: input.requestId,
                observedAt: input.observedAt,
                payloadHash: sha256(releasePacket),
                nodeCount: 0,
                importedNodeCount: 0,
                relationshipCount: 0,
                importedRelationshipCount: 0,
                releaseStatus: 'blocked',
                licenseStatus: 'blocked',
                releasePacket,
                blockers: ['missing_export_url:WAHIS_EXPORT_URL'],
            })],
            nodeRows: [],
            relationshipRows: [],
            skippedReason: 'missing_export_url',
        };
    }

    try {
        const response = await input.fetchImpl(releaseUrl, { cache: 'no-store' });
        if (!response.ok) {
            const releasePacket = {
                provider_name: input.provider.name,
                provider_status: 'fetch_failed',
                source_url: releaseUrl,
                http_status: response.status,
                http_status_text: response.statusText,
            };
            return {
                releaseRows: [buildGenericReleaseRow({
                    provider: input.provider,
                    sourceUrl: releaseUrl,
                    tenantId: input.tenantId,
                    requestId: input.requestId,
                    observedAt: input.observedAt,
                    payloadHash: sha256(releasePacket),
                    nodeCount: 0,
                    importedNodeCount: 0,
                    relationshipCount: 0,
                    importedRelationshipCount: 0,
                    releaseStatus: 'failed',
                    licenseStatus: 'public_reference',
                    releasePacket,
                    blockers: [`wahis_fetch_failed_${response.status}`],
                })],
                nodeRows: [],
                relationshipRows: [],
                skippedReason: `fetch_failed_${response.status}`,
            };
        }

        const contentType = response.headers?.get('content-type')?.toLowerCase() ?? '';
        const payloadText = response.text
            ? await response.text()
            : stableStringify(await response.json());
        const parsed = parseWahisExportPopulation({
            provider: input.provider,
            payloadText,
            contentType,
            sourceUrl: releaseUrl,
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
            maxNodes: input.maxNodes,
        });
        return {
            releaseRows: [parsed.releaseRow],
            nodeRows: parsed.nodeRows,
            relationshipRows: [],
            skippedReason: null,
        };
    } catch (error) {
        const releasePacket = {
            provider_name: input.provider.name,
            provider_status: 'parse_or_fetch_error',
            source_url: releaseUrl,
            error: error instanceof Error ? error.message : 'unknown_wahis_import_error',
        };
        return {
            releaseRows: [buildGenericReleaseRow({
                provider: input.provider,
                sourceUrl: releaseUrl,
                tenantId: input.tenantId,
                requestId: input.requestId,
                observedAt: input.observedAt,
                payloadHash: sha256(releasePacket),
                nodeCount: 0,
                importedNodeCount: 0,
                relationshipCount: 0,
                importedRelationshipCount: 0,
                releaseStatus: 'failed',
                licenseStatus: 'public_reference',
                releasePacket,
                blockers: ['wahis_parse_or_fetch_error'],
            })],
            nodeRows: [],
            relationshipRows: [],
            skippedReason: error instanceof Error ? error.message : 'unknown_wahis_import_error',
        };
    }
}

async function fetchCdcOpenDataRows(input: {
    provider: OfficialOntologyProvider;
    fetchImpl: OfficialFetch;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    maxNodes: number;
    maxRelationships: number;
    env?: Record<string, string | undefined>;
}) {
    const releaseUrl = normalizeOptionalText(input.env?.CDC_OPEN_DATA_URL ?? process.env.CDC_OPEN_DATA_URL);
    if (!releaseUrl) {
        const releasePacket = {
            provider_name: input.provider.name,
            provider_status: 'missing_open_data_url',
            expected_env: 'CDC_OPEN_DATA_URL',
            expected_url_shape: 'https://data.cdc.gov/resource/<dataset-id>.json',
            source_catalog: input.provider.url,
            clinical_boundary: 'CDC Open Data ingestion is blocked until a specific Socrata CSV/JSON dataset endpoint is configured.',
        };
        return {
            releaseRows: [buildGenericReleaseRow({
                provider: input.provider,
                sourceUrl: input.provider.url,
                tenantId: input.tenantId,
                requestId: input.requestId,
                observedAt: input.observedAt,
                payloadHash: sha256(releasePacket),
                nodeCount: 0,
                importedNodeCount: 0,
                relationshipCount: 0,
                importedRelationshipCount: 0,
                releaseStatus: 'blocked',
                licenseStatus: 'blocked',
                releasePacket,
                blockers: ['missing_open_data_url:CDC_OPEN_DATA_URL'],
            })],
            nodeRows: [],
            relationshipRows: [],
            skippedReason: 'missing_open_data_url',
        };
    }

    const urlStatus = classifyCdcOpenDataUrl(releaseUrl);
    if (urlStatus.status !== 'ready') {
        const releasePacket = {
            provider_name: input.provider.name,
            provider_status: urlStatus.status,
            source_url: releaseUrl,
            expected_url_shape: 'https://data.cdc.gov/resource/<dataset-id>.json or .csv',
            source_catalog: input.provider.url,
            clinical_boundary: 'CDC Open Data URL must point to a machine-readable Socrata dataset endpoint, not the catalog homepage.',
        };
        return {
            releaseRows: [buildGenericReleaseRow({
                provider: input.provider,
                sourceUrl: releaseUrl,
                tenantId: input.tenantId,
                requestId: input.requestId,
                observedAt: input.observedAt,
                payloadHash: sha256(releasePacket),
                nodeCount: 0,
                importedNodeCount: 0,
                relationshipCount: 0,
                importedRelationshipCount: 0,
                releaseStatus: 'blocked',
                licenseStatus: 'blocked',
                releasePacket,
                blockers: [`cdc_open_data_url_${urlStatus.status}`],
            })],
            nodeRows: [],
            relationshipRows: [],
            skippedReason: urlStatus.status,
        };
    }

    const fetchUrl = buildCdcFetchUrl(releaseUrl, input.maxNodes);
    const appToken = normalizeOptionalText(
        input.env?.CDC_OPEN_DATA_APP_TOKEN
        ?? input.env?.CDC_APP_TOKEN
        ?? process.env.CDC_OPEN_DATA_APP_TOKEN
        ?? process.env.CDC_APP_TOKEN,
    );
    const headers = appToken ? { 'X-App-Token': appToken } : undefined;

    try {
        const response = await input.fetchImpl(fetchUrl, {
            cache: 'no-store',
            ...(headers ? { headers } : {}),
        });
        if (!response.ok) {
            const releasePacket = {
                provider_name: input.provider.name,
                provider_status: 'fetch_failed',
                source_url: releaseUrl,
                fetch_url: fetchUrl,
                http_status: response.status,
                http_status_text: response.statusText,
            };
            return {
                releaseRows: [buildGenericReleaseRow({
                    provider: input.provider,
                    sourceUrl: releaseUrl,
                    tenantId: input.tenantId,
                    requestId: input.requestId,
                    observedAt: input.observedAt,
                    payloadHash: sha256(releasePacket),
                    nodeCount: 0,
                    importedNodeCount: 0,
                    relationshipCount: 0,
                    importedRelationshipCount: 0,
                    releaseStatus: 'failed',
                    licenseStatus: 'public_reference',
                    releasePacket,
                    blockers: [`cdc_open_data_fetch_failed_${response.status}`],
                })],
                nodeRows: [],
                relationshipRows: [],
                skippedReason: `fetch_failed_${response.status}`,
            };
        }

        const contentType = response.headers?.get('content-type')?.toLowerCase() ?? '';
        const payloadText = response.text
            ? await response.text()
            : stableStringify(await response.json());
        const parsed = parseCdcOpenDataPopulation({
            provider: input.provider,
            payloadText,
            contentType,
            sourceUrl: releaseUrl,
            fetchUrl,
            appTokenUsed: Boolean(appToken),
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
            maxNodes: input.maxNodes,
        });
        return {
            releaseRows: [parsed.releaseRow],
            nodeRows: parsed.nodeRows,
            relationshipRows: [],
            skippedReason: null,
        };
    } catch (error) {
        const releasePacket = {
            provider_name: input.provider.name,
            provider_status: 'parse_or_fetch_error',
            source_url: releaseUrl,
            fetch_url: fetchUrl,
            error: error instanceof Error ? error.message : 'unknown_cdc_open_data_import_error',
        };
        return {
            releaseRows: [buildGenericReleaseRow({
                provider: input.provider,
                sourceUrl: releaseUrl,
                tenantId: input.tenantId,
                requestId: input.requestId,
                observedAt: input.observedAt,
                payloadHash: sha256(releasePacket),
                nodeCount: 0,
                importedNodeCount: 0,
                relationshipCount: 0,
                importedRelationshipCount: 0,
                releaseStatus: 'failed',
                licenseStatus: 'public_reference',
                releasePacket,
                blockers: ['cdc_open_data_parse_or_fetch_error'],
            })],
            nodeRows: [],
            relationshipRows: [],
            skippedReason: error instanceof Error ? error.message : 'unknown_cdc_open_data_import_error',
        };
    }
}

async function fetchIcd11PopulationRows(input: {
    provider: OfficialOntologyProvider;
    fetchImpl: OfficialFetch;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    maxNodes: number;
    maxRelationships: number;
    env?: Record<string, string | undefined>;
}) {
    const clientId = input.env?.WHO_ICD_CLIENT_ID ?? process.env.WHO_ICD_CLIENT_ID;
    const clientSecret = input.env?.WHO_ICD_CLIENT_SECRET ?? process.env.WHO_ICD_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return {
            releaseRows: [],
            nodeRows: [],
            relationshipRows: [],
            skippedReason: 'missing_who_icd_credentials',
        };
    }

    try {
        const tokenResponse = await input.fetchImpl('https://icdaccessmanagement.who.int/connect/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                scope: 'icdapi_access',
                grant_type: 'client_credentials',
            }).toString(),
            cache: 'no-store',
        });
        if (!tokenResponse.ok) {
            return {
                releaseRows: [],
                nodeRows: [],
                relationshipRows: [],
                skippedReason: `icd_token_failed_${tokenResponse.status}`,
            };
        }
        const tokenPayload = asRecord(await tokenResponse.json());
        const accessToken = readString(tokenPayload.access_token);
        if (!accessToken) {
            return {
                releaseRows: [],
                nodeRows: [],
                relationshipRows: [],
                skippedReason: 'icd_token_missing_access_token',
            };
        }

        const searchUrl = new URL('https://id.who.int/icd/release/11/mms/search');
        searchUrl.searchParams.set('q', 'zoonotic animal veterinary disease');
        searchUrl.searchParams.set('flatResults', 'true');
        searchUrl.searchParams.set('useFlexisearch', 'true');
        const searchResponse = await input.fetchImpl(searchUrl.toString(), {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
                'Accept-Language': 'en',
                'API-Version': 'v2',
            },
            cache: 'no-store',
        });
        if (!searchResponse.ok) {
            return {
                releaseRows: [],
                nodeRows: [],
                relationshipRows: [],
                skippedReason: `icd_search_failed_${searchResponse.status}`,
            };
        }

        const payload = await searchResponse.json();
        const entities = readArray(asRecord(payload).destinationEntities)
            .map(asRecord)
            .slice(0, input.maxNodes);
        const nodeRows = entities
            .map((entity, index) => buildGenericNodeRow({
                provider: input.provider,
                tenantId: input.tenantId,
                requestId: input.requestId,
                observedAt: input.observedAt,
                externalCode: `ICD-11:${readString(entity.theCode) ?? readLastPathSegment(readString(entity.id)) ?? sha256({ index, entity }).slice(0, 16)}`,
                canonicalLabel: readIcdTitle(entity) ?? `ICD-11 search result ${index + 1}`,
                sourceIri: readString(entity.id),
                nodeKind: 'class',
                nodePacket: {
                    provider_key: input.provider.provider_key,
                    source_key: input.provider.source_key,
                    icd_entity_id: readString(entity.id),
                    icd_code: readString(entity.theCode),
                    clinical_boundary: 'ICD-11 search node only; reviewer verification is required before scoring use.',
                },
            }));
        const packet = {
            provider_name: input.provider.name,
            parser: 'who_icd_11_search_v1',
            query: 'zoonotic animal veterinary disease',
            source_url: searchUrl.toString(),
        };
        const releaseRow = buildGenericReleaseRow({
            provider: input.provider,
            sourceUrl: searchUrl.toString(),
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
            payloadHash: sha256({ packet, node_count: nodeRows.length }),
            nodeCount: entities.length,
            importedNodeCount: nodeRows.length,
            relationshipCount: 0,
            importedRelationshipCount: 0,
            releaseStatus: nodeRows.length > 0 ? 'imported' : 'partial',
            licenseStatus: 'public_reference',
            releasePacket: packet,
            blockers: nodeRows.length > 0 ? [] : ['icd_search_returned_no_nodes'],
        });

        return {
            releaseRows: [releaseRow],
            nodeRows,
            relationshipRows: [],
            skippedReason: null,
        };
    } catch (error) {
        return {
            releaseRows: [],
            nodeRows: [],
            relationshipRows: [],
            skippedReason: error instanceof Error ? error.message : 'unknown_icd_import_error',
        };
    }
}

async function fetchNcbiLiteraturePopulationRows(input: {
    provider: OfficialOntologyProvider;
    fetchImpl: OfficialFetch;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    maxNodes: number;
    maxRelationships: number;
    env?: Record<string, string | undefined>;
}) {
    const url = new URL(input.provider.url);
    url.searchParams.set('db', input.provider.api_database ?? (input.provider.provider_key === 'pmc_eutils' ? 'pmc' : 'pubmed'));
    url.searchParams.set('term', input.provider.default_query ?? 'veterinary one health antimicrobial resistance');
    url.searchParams.set('retmode', 'json');
    url.searchParams.set('retmax', String(Math.min(input.maxNodes, 500)));
    const apiKey = input.env?.NCBI_API_KEY
        ?? input.env?.VETIOS_NCBI_API_KEY
        ?? process.env.NCBI_API_KEY
        ?? process.env.VETIOS_NCBI_API_KEY;
    if (apiKey) url.searchParams.set('api_key', apiKey);

    try {
        const response = await input.fetchImpl(url.toString(), { cache: 'no-store' });
        if (!response.ok) {
            return {
                releaseRows: [],
                nodeRows: [],
                relationshipRows: [],
                skippedReason: `fetch_failed_${response.status}`,
            };
        }

        const payload = await response.json();
        const ids = readStringArray(asRecord(asRecord(payload).esearchresult).idlist).slice(0, input.maxNodes);
        const documentHash = sha256({
            provider_key: input.provider.provider_key,
            source_url: url.toString(),
            ids,
        });
        const nodeRows = ids.map((id) => buildGenericNodeRow({
            provider: input.provider,
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
            externalCode: input.provider.code_system === 'PMCID' ? `PMCID:${id}` : `PMID:${id}`,
            canonicalLabel: `${input.provider.name} evidence ${id}`,
            sourceIri: input.provider.code_system === 'PMCID'
                ? `https://pmc.ncbi.nlm.nih.gov/articles/PMC${id}/`
                : `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
            nodeKind: 'literature_evidence',
            nodePacket: {
                provider_key: input.provider.provider_key,
                evidence_database: input.provider.api_database,
                query: input.provider.default_query,
                record_id: id,
                clinical_boundary: 'Literature evidence node only; not a verified source mapping or outcome-confirmed clinical fact.',
            },
        }));

        const releaseRow = buildGenericReleaseRow({
            provider: input.provider,
            sourceUrl: url.toString(),
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
            payloadHash: documentHash,
            nodeCount: ids.length,
            importedNodeCount: nodeRows.length,
            relationshipCount: 0,
            importedRelationshipCount: 0,
            releaseStatus: ids.length > 0 ? 'imported' : 'partial',
            licenseStatus: 'public_reference',
            releasePacket: {
                provider_name: input.provider.name,
                parser: 'ncbi_eutils_esearch_v1',
                query: input.provider.default_query,
                db: input.provider.api_database,
                source_url: url.toString(),
            },
            blockers: ids.length > 0 ? [] : ['no_literature_records_returned'],
        });

        return {
            releaseRows: [releaseRow],
            nodeRows,
            relationshipRows: [],
            skippedReason: null,
        };
    } catch (error) {
        return {
            releaseRows: [],
            nodeRows: [],
            relationshipRows: [],
            skippedReason: error instanceof Error ? error.message : 'unknown_ncbi_import_error',
        };
    }
}

function parseGenericOfficialJsonPopulation(input: {
    provider: OfficialOntologyProvider;
    payload: unknown;
    sourceUrl: string;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    maxNodes: number;
}) {
    const records = extractGenericRecords(input.payload).slice(0, input.maxNodes);
    const documentHash = sha256(input.payload);
    const nodeRows = records
        .map((record, index) => buildGenericNodeFromRecord({
            provider: input.provider,
            record,
            index,
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
        }))
        .filter(isRecordRow) as Record<string, unknown>[];

    const releaseRow = buildGenericReleaseRow({
        provider: input.provider,
        sourceUrl: input.sourceUrl,
        tenantId: input.tenantId,
        requestId: input.requestId,
        observedAt: input.observedAt,
        payloadHash: documentHash,
        nodeCount: records.length,
        importedNodeCount: nodeRows.length,
        relationshipCount: 0,
        importedRelationshipCount: 0,
        releaseStatus: records.length > nodeRows.length ? 'partial' : 'imported',
        licenseStatus: input.provider.access === 'licensed_release' ? 'licensed' : 'public_reference',
        releasePacket: {
            provider_name: input.provider.name,
            parser: 'generic_official_json_v1',
            source_url: input.sourceUrl,
            truncated_nodes: Math.max(0, records.length - nodeRows.length),
            clinical_boundary: 'Official export nodes require reviewer verification before active scoring.',
        },
        blockers: records.length > nodeRows.length ? ['records_without_stable_identifier_or_label'] : [],
    });

    return { releaseRow, nodeRows };
}

function parseWahisExportPopulation(input: {
    provider: OfficialOntologyProvider;
    payloadText: string;
    contentType: string;
    sourceUrl: string;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    maxNodes: number;
}) {
    const trimmed = input.payloadText.trim();
    const payloadHash = createHash('sha256').update(input.payloadText).digest('hex');
    const records = looksLikeJson(trimmed) || input.contentType.includes('json')
        ? extractGenericRecords(JSON.parse(trimmed || '{}'))
        : parseDelimitedText(trimmed);
    const limitedRecords = records.slice(0, input.maxNodes);
    const nodeRows = limitedRecords
        .map((record, index) => buildWahisNodeFromRecord({
            provider: input.provider,
            record,
            index,
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
        }))
        .filter(isRecordRow) as Record<string, unknown>[];
    const skippedRows = Math.max(0, records.length - nodeRows.length);
    const releasePacket = {
        provider_name: input.provider.name,
        provider_status: nodeRows.length > 0 ? 'imported' : 'no_importable_rows',
        parser: input.contentType.includes('json') || looksLikeJson(trimmed)
            ? 'wahis_json_export_v1'
            : 'wahis_csv_export_v1',
        source_url: input.sourceUrl,
        source_portal: input.provider.url,
        expected_storage_path: 'ontology-provider-exports/wahis/latest.csv',
        source_hash: payloadHash,
        raw_rows: records.length,
        imported_rows: nodeRows.length,
        skipped_rows: skippedRows,
        truncated_rows: Math.max(0, records.length - limitedRecords.length),
        ontology_coverage: {
            provider_key: input.provider.provider_key,
            code_system: input.provider.code_system,
            node_kind: 'surveillance_record',
            imported_surveillance_records: nodeRows.length,
        },
        clinical_boundary: 'WAHIS rows are population surveillance evidence only; they do not validate patient-level diagnosis or treatment decisions.',
    };

    const releaseRow = buildGenericReleaseRow({
        provider: input.provider,
        sourceUrl: input.sourceUrl,
        tenantId: input.tenantId,
        requestId: input.requestId,
        observedAt: input.observedAt,
        payloadHash,
        nodeCount: records.length,
        importedNodeCount: nodeRows.length,
        relationshipCount: 0,
        importedRelationshipCount: 0,
        releaseStatus: nodeRows.length === 0 ? 'partial' : skippedRows > 0 ? 'partial' : 'imported',
        licenseStatus: 'public_reference',
        releasePacket,
        blockers: nodeRows.length === 0 ? ['wahis_export_has_no_importable_rows'] : [],
    });

    return { releaseRow, nodeRows };
}

function buildWahisNodeFromRecord(input: {
    provider: OfficialOntologyProvider;
    record: Record<string, unknown>;
    index: number;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
}) {
    const disease = readFirstString(input.record, [
        'disease_name',
        'disease',
        'Disease',
        'Disease name',
        'Disease Name',
        'event_disease',
        'eventDisease',
        'name',
    ]);
    const country = readFirstString(input.record, [
        'country',
        'Country',
        'country_name',
        'Country name',
        'Country Name',
        'territory',
    ]);
    const species = readFirstString(input.record, [
        'species',
        'Species',
        'host',
        'Host',
        'animal_type',
        'animalType',
        'domestic_wild',
    ]);
    const eventId = readFirstString(input.record, [
        'event_id',
        'eventId',
        'Event ID',
        'event',
        'report_id',
        'reportId',
        'outbreak_id',
        'outbreakId',
        'id',
    ]);
    const date = readFirstString(input.record, [
        'event_start_date',
        'eventStartDate',
        'start_date',
        'Start date',
        'report_date',
        'submissionDate',
        'date',
    ]);
    if (!disease) return null;
    const label = [disease, country, species].filter(Boolean).join(' · ');

    const fallbackCode = sha256({
        provider_key: input.provider.provider_key,
        index: input.index,
        disease,
        country,
        species,
        eventId,
        date,
    }).slice(0, 16);
    const externalCode = `WAHIS:${sanitizeCode(eventId ?? fallbackCode)}`;
    const sourceIri = readFirstString(input.record, ['url', 'source_url', 'source', 'report_url']) ?? input.provider.url;

    return buildGenericNodeRow({
        provider: input.provider,
        tenantId: input.tenantId,
        requestId: input.requestId,
        observedAt: input.observedAt,
        externalCode,
        canonicalLabel: label || disease || `WAHIS surveillance record ${input.index + 1}`,
        sourceIri,
        nodeKind: 'surveillance_record',
        nodePacket: {
            provider_key: input.provider.provider_key,
            source_key: input.provider.source_key,
            disease_name: disease,
            country,
            species,
            event_id: eventId,
            event_date: date,
            report_type: readFirstString(input.record, ['report_type', 'reportType', 'Report type']),
            event_status: readFirstString(input.record, ['event_status', 'eventStatus', 'status', 'Status']),
            cases: readFirstString(input.record, ['cases', 'Cases']),
            deaths: readFirstString(input.record, ['deaths', 'Deaths']),
            raw_record_keys: Object.keys(input.record).sort(),
            record_digest: sha256(input.record),
            clinical_boundary: 'Imported WAHIS surveillance record; use for population context and ontology coverage, not individual diagnosis.',
        },
    });
}

function parseCdcOpenDataPopulation(input: {
    provider: OfficialOntologyProvider;
    payloadText: string;
    contentType: string;
    sourceUrl: string;
    fetchUrl: string;
    appTokenUsed: boolean;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    maxNodes: number;
}) {
    const trimmed = input.payloadText.trim();
    const payloadHash = createHash('sha256').update(input.payloadText).digest('hex');
    const records = looksLikeJson(trimmed) || input.contentType.includes('json')
        ? extractGenericRecords(JSON.parse(trimmed || '[]'))
        : parseDelimitedText(trimmed);
    const limitedRecords = records.slice(0, input.maxNodes);
    const nodeRows = limitedRecords
        .map((record, index) => buildCdcNodeFromRecord({
            provider: input.provider,
            record,
            index,
            sourceUrl: input.sourceUrl,
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
        }))
        .filter(isRecordRow) as Record<string, unknown>[];
    const skippedRows = Math.max(0, records.length - nodeRows.length);
    const parser = input.contentType.includes('json') || looksLikeJson(trimmed)
        ? 'cdc_socrata_json_v1'
        : 'cdc_socrata_csv_v1';
    const releasePacket = {
        provider_name: input.provider.name,
        provider_status: nodeRows.length > 0 ? 'imported' : 'no_importable_rows',
        parser,
        source_url: input.sourceUrl,
        fetch_url: input.fetchUrl,
        source_catalog: input.provider.url,
        app_token_used: input.appTokenUsed,
        source_hash: payloadHash,
        raw_rows: records.length,
        imported_rows: nodeRows.length,
        skipped_rows: skippedRows,
        truncated_rows: Math.max(0, records.length - limitedRecords.length),
        ontology_coverage: {
            provider_key: input.provider.provider_key,
            code_system: input.provider.code_system,
            node_kind: 'surveillance_record',
            imported_public_health_records: nodeRows.length,
        },
        clinical_boundary: 'CDC Open Data rows are public-health surveillance/context evidence only; they do not validate veterinary patient-level diagnoses.',
    };

    const releaseRow = buildGenericReleaseRow({
        provider: input.provider,
        sourceUrl: input.sourceUrl,
        tenantId: input.tenantId,
        requestId: input.requestId,
        observedAt: input.observedAt,
        payloadHash,
        nodeCount: records.length,
        importedNodeCount: nodeRows.length,
        relationshipCount: 0,
        importedRelationshipCount: 0,
        releaseStatus: nodeRows.length === 0 ? 'partial' : skippedRows > 0 ? 'partial' : 'imported',
        licenseStatus: 'public_reference',
        releasePacket,
        blockers: nodeRows.length === 0 ? ['cdc_open_data_has_no_importable_rows'] : [],
    });

    return { releaseRow, nodeRows };
}

function buildCdcNodeFromRecord(input: {
    provider: OfficialOntologyProvider;
    record: Record<string, unknown>;
    index: number;
    sourceUrl: string;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
}) {
    const condition = readFirstString(input.record, [
        'condition',
        'Condition',
        'disease',
        'Disease',
        'disease_name',
        'Disease Name',
        'illness',
        'Illness',
        'pathogen',
        'Pathogen',
        'indicator',
        'Indicator',
        'topic',
        'Topic',
        'measure',
        'Measure',
        'syndrome',
        'Syndrome',
    ]);
    if (!condition) return null;

    const jurisdiction = readFirstString(input.record, [
        'jurisdiction',
        'Jurisdiction',
        'state',
        'State',
        'state_name',
        'State Name',
        'county',
        'County',
        'country',
        'Country',
        'location',
        'Location',
        'reporting_area',
        'Reporting Area',
    ]);
    const population = readFirstString(input.record, [
        'species',
        'Species',
        'host',
        'Host',
        'population',
        'Population',
        'age_group',
        'Age Group',
        'demographic',
        'Demographic',
    ]);
    const period = readFirstString(input.record, [
        'date',
        'Date',
        'week_end',
        'week_ending',
        'Week Ending',
        'report_date',
        'Report Date',
        'year',
        'Year',
        'mmwr_year',
        'mmwr_week',
        'collection_date',
        'Collection Date',
    ]);
    const recordId = readFirstString(input.record, [
        'id',
        'record_id',
        'case_id',
        'event_id',
        'data_id',
        ':id',
    ]);
    const fallbackCode = sha256({
        provider_key: input.provider.provider_key,
        index: input.index,
        condition,
        jurisdiction,
        population,
        period,
        recordId,
    }).slice(0, 16);
    const externalCode = `CDC:${sanitizeCode(recordId ?? fallbackCode)}`;
    const label = [condition, jurisdiction, population, period].filter(Boolean).join(' - ');

    return buildGenericNodeRow({
        provider: input.provider,
        tenantId: input.tenantId,
        requestId: input.requestId,
        observedAt: input.observedAt,
        externalCode,
        canonicalLabel: label || condition,
        sourceIri: readFirstString(input.record, ['url', 'source_url', 'source', 'source_iri']) ?? input.sourceUrl,
        nodeKind: 'surveillance_record',
        nodePacket: {
            provider_key: input.provider.provider_key,
            source_key: input.provider.source_key,
            condition,
            jurisdiction,
            population,
            report_period: period,
            cases: readFirstString(input.record, ['cases', 'Cases', 'case_count', 'Case Count', 'count', 'Count']),
            deaths: readFirstString(input.record, ['deaths', 'Deaths', 'death_count', 'Death Count']),
            rate: readFirstString(input.record, ['rate', 'Rate', 'incidence_rate', 'Incidence Rate']),
            raw_record_keys: Object.keys(input.record).sort(),
            record_digest: sha256(input.record),
            clinical_boundary: 'Imported CDC Open Data public-health record; use as One Health context, not patient-level outcome truth.',
        },
    });
}

function buildGenericNodeFromRecord(input: {
    provider: OfficialOntologyProvider;
    record: Record<string, unknown>;
    index: number;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
}) {
    const externalCode = readFirstString(input.record, [
        'external_code',
        'code',
        'id',
        'conceptId',
        'concept_id',
        'disease_id',
        'event_id',
        'ui',
        'pmid',
        'pmcid',
    ]) ?? `${input.provider.code_system}:${sha256({ provider_key: input.provider.provider_key, index: input.index, record: input.record }).slice(0, 16)}`;
    const canonicalLabel = readFirstString(input.record, [
        'canonical_label',
        'label',
        'name',
        'title',
        'disease',
        'disease_name',
        'condition',
        'preferredTerm',
        'fsn',
    ]);
    if (!canonicalLabel) return null;

    return buildGenericNodeRow({
        provider: input.provider,
        tenantId: input.tenantId,
        requestId: input.requestId,
        observedAt: input.observedAt,
        externalCode: externalCode.includes(':') ? externalCode : `${input.provider.code_system}:${externalCode}`,
        canonicalLabel,
        sourceIri: readFirstString(input.record, ['url', 'uri', 'iri', 'source_iri']),
        nodeKind: mapProviderRoleToNodeKind(input.provider),
        nodePacket: {
            provider_key: input.provider.provider_key,
            source_key: input.provider.source_key,
            raw_record_keys: Object.keys(input.record).sort(),
            record_digest: sha256(input.record),
            clinical_boundary: 'Imported official-source record only; reviewer verification is required before scoring use.',
        },
    });
}

function buildGenericNodeRow(input: {
    provider: OfficialOntologyProvider;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    externalCode: string;
    canonicalLabel: string;
    sourceIri?: string | null;
    nodeKind: string;
    nodePacket: Record<string, unknown>;
}) {
    const nodePacket = {
        ...input.nodePacket,
        external_code: input.externalCode,
        canonical_label: input.canonicalLabel,
        source_iri: input.sourceIri ?? null,
    };
    return {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        provider_key: input.provider.provider_key,
        source_key: input.provider.source_key,
        code_system: input.provider.code_system,
        external_code: input.externalCode,
        source_iri: input.sourceIri ?? null,
        canonical_label: input.canonicalLabel,
        synonyms: [] as string[],
        xrefs: [] as string[],
        obsolete: false,
        node_kind: input.nodeKind,
        node_packet: nodePacket,
        node_hash: sha256(nodePacket),
        observed_at: input.observedAt,
    };
}

function buildGenericReleaseRow(input: {
    provider: OfficialOntologyProvider;
    sourceUrl: string;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    payloadHash: string;
    nodeCount: number;
    importedNodeCount: number;
    relationshipCount: number;
    importedRelationshipCount: number;
    releaseStatus: string;
    licenseStatus: string;
    releasePacket: Record<string, unknown>;
    blockers: string[];
}) {
    return {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        provider_key: input.provider.provider_key,
        source_key: input.provider.source_key,
        code_system: input.provider.code_system,
        source_url: input.sourceUrl,
        access_mode: input.provider.access,
        release_status: input.releaseStatus,
        release_version: null,
        source_document_hash: input.payloadHash,
        node_count: input.nodeCount,
        relationship_count: input.relationshipCount,
        imported_node_count: input.importedNodeCount,
        imported_relationship_count: input.importedRelationshipCount,
        license_status: input.licenseStatus,
        release_packet: input.releasePacket,
        blockers: input.blockers,
        warnings: ['Imported official-source nodes are terminology or surveillance evidence, not patient-level clinical truth.'],
        observed_at: input.observedAt,
    };
}

function mapProviderRoleToNodeKind(provider: OfficialOntologyProvider) {
    if (provider.role === 'phenotype_bridge') return 'phenotype';
    if (provider.role === 'literature_evidence') return 'literature_evidence';
    if (provider.role === 'surveillance_signal') return 'surveillance_record';
    return 'class';
}

function parseOboJsonPopulation(input: {
    provider: OfficialOntologyProvider;
    payload: unknown;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
    maxNodes: number;
    maxRelationships: number;
}) {
    const documentHash = sha256(input.payload);
    const graphs = readGraphs(input.payload);
    const graphNodes = graphs.flatMap((graph) => readArray(asRecord(graph).nodes));
    const graphEdges = graphs.flatMap((graph) => readArray(asRecord(graph).edges));
    const nodeRows = (graphNodes
        .slice(0, input.maxNodes)
        .map((node) => buildNodeRow({
            provider: input.provider,
            node: asRecord(node),
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
        }))
        .filter(isRecordRow)) as Record<string, unknown>[];
    const relationshipRows = (graphEdges
        .slice(0, input.maxRelationships)
        .map((edge) => buildRelationshipRow({
            provider: input.provider,
            edge: asRecord(edge),
            tenantId: input.tenantId,
            requestId: input.requestId,
            observedAt: input.observedAt,
        }))
        .filter(isRecordRow)) as Record<string, unknown>[];

    const releaseRow = {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        provider_key: input.provider.provider_key,
        source_key: input.provider.source_key,
        code_system: input.provider.code_system,
        source_url: input.provider.url,
        access_mode: input.provider.access,
        release_status: graphNodes.length > nodeRows.length || graphEdges.length > relationshipRows.length ? 'partial' : 'imported',
        release_version: readReleaseVersion(input.payload),
        source_document_hash: documentHash,
        node_count: graphNodes.length,
        relationship_count: graphEdges.length,
        imported_node_count: nodeRows.length,
        imported_relationship_count: relationshipRows.length,
        license_status: input.provider.access === 'public_obo_json' ? 'open_license' : 'unknown',
        release_packet: {
            provider_name: input.provider.name,
            source_url: input.provider.url,
            parser: 'obo_json_v1',
            truncated_nodes: Math.max(0, graphNodes.length - nodeRows.length),
            truncated_relationships: Math.max(0, graphEdges.length - relationshipRows.length),
        },
        blockers: graphNodes.length > nodeRows.length || graphEdges.length > relationshipRows.length
            ? ['import_truncated_by_runtime_limit']
            : [],
        warnings: ['Imported ontology release nodes are terminology evidence, not patient-level clinical truth.'],
        observed_at: input.observedAt,
    };

    return { releaseRow, nodeRows, relationshipRows };
}

function buildNodeRow(input: {
    provider: OfficialOntologyProvider;
    node: Record<string, unknown>;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
}) {
    const sourceIri = readString(input.node.id);
    const externalCode = parseOboCode(input.provider.code_system, sourceIri);
    const canonicalLabel = readString(input.node.lbl);
    if (!sourceIri || !externalCode || !canonicalLabel) return null;

    const meta = asRecord(input.node.meta);
    const nodePayload = {
        source_iri: sourceIri,
        canonical_label: canonicalLabel,
        synonyms: readSynonyms(meta),
        xrefs: readXrefs(meta),
        obsolete: readBoolean(meta.deprecated) ?? false,
    };

    return {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        provider_key: input.provider.provider_key,
        source_key: input.provider.source_key,
        code_system: input.provider.code_system,
        external_code: externalCode,
        source_iri: sourceIri,
        canonical_label: canonicalLabel,
        synonyms: nodePayload.synonyms,
        xrefs: nodePayload.xrefs,
        obsolete: nodePayload.obsolete,
        node_kind: input.provider.role === 'phenotype_bridge' ? 'phenotype' : 'class',
        node_packet: nodePayload,
        node_hash: sha256(nodePayload),
        observed_at: input.observedAt,
    };
}

function buildRelationshipRow(input: {
    provider: OfficialOntologyProvider;
    edge: Record<string, unknown>;
    tenantId: string | null;
    requestId: string;
    observedAt: string | null;
}) {
    const subject = parseOboCode(input.provider.code_system, readString(input.edge.sub));
    const object = parseOboCode(input.provider.code_system, readString(input.edge.obj));
    const predicate = readString(input.edge.pred) ?? 'related_to';
    if (!subject || !object) return null;

    const packet = {
        subject_code: subject,
        predicate,
        object_code: object,
        provider_key: input.provider.provider_key,
    };

    return {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        provider_key: input.provider.provider_key,
        source_key: input.provider.source_key,
        code_system: input.provider.code_system,
        subject_code: subject,
        predicate,
        object_code: object,
        relationship_kind: predicate.toLowerCase().includes('subclass') ? 'subclass' : 'ontology_edge',
        relationship_packet: packet,
        relationship_hash: sha256(packet),
        observed_at: input.observedAt,
    };
}

function buildPopulationSnapshotRow(input: {
    tenantId: string | null;
    requestId: string;
    providerPlan: OfficialOntologyProviderPlan[];
    releaseRows: Record<string, unknown>[];
    nodeRows: Record<string, unknown>[];
    relationshipRows: Record<string, unknown>[];
    skippedProviders: Array<{ provider_key: string; reason: string }>;
    errors: Array<{ provider_key: string; error: string }>;
    observedAt: string | null;
}) {
    const importedProviderCount = new Set(input.releaseRows
        .filter((row) => ['imported', 'partial'].includes(String(row.release_status)))
        .map((row) => String(row.provider_key))).size;
    const blockedProviderCount = input.providerPlan.length - importedProviderCount;
    const licensedProviderCount = input.providerPlan.filter((provider) => provider.access === 'licensed_release').length;
    const credentialedProviderCount = input.providerPlan.filter((provider) => provider.access === 'credentialed_api').length;
    const status = classifyPopulationStatus({
        providerCount: input.providerPlan.length,
        importedProviderCount,
        blockedProviderCount,
        errors: input.errors.length,
        licensedProviderCount,
        credentialedProviderCount,
        completeProviderCatalog: input.providerPlan.length === OFFICIAL_ONTOLOGY_PROVIDERS.length,
    });

    const packet = {
        provider_plan: input.providerPlan,
        imported_providers: input.releaseRows.map((row) => row.provider_key),
        skipped_providers: input.skippedProviders,
        errors: input.errors,
        clinical_boundary: 'Population snapshot proves imported ontology releases; it does not validate individual clinical decisions.',
    };

    return {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        population_scope: 'global_biomedical_ontology',
        population_status: status,
        provider_count: input.providerPlan.length,
        imported_provider_count: importedProviderCount,
        blocked_provider_count: blockedProviderCount,
        total_node_count: input.nodeRows.length,
        total_relationship_count: input.relationshipRows.length,
        condition_code_provider_count: input.providerPlan.filter((provider) => provider.role === 'condition_code').length,
        phenotype_provider_count: input.providerPlan.filter((provider) => provider.role === 'phenotype_bridge').length,
        terminology_provider_count: input.providerPlan.filter((provider) => provider.role === 'terminology_bridge').length,
        licensed_provider_count: licensedProviderCount,
        credentialed_provider_count: credentialedProviderCount,
        population_packet: packet,
        source_manifest_hash: sha256(packet),
        blockers: buildPopulationBlockers(input.providerPlan, input.skippedProviders, input.errors),
        warnings: [
            'Only imported official release rows can be represented as populated.',
            'Licensed and credentialed providers remain blocked until their releases/API credentials are configured and imported.',
        ],
        observed_at: input.observedAt,
    };
}

function classifyPopulationStatus(input: {
    providerCount: number;
    importedProviderCount: number;
    blockedProviderCount: number;
    errors: number;
    licensedProviderCount: number;
    credentialedProviderCount: number;
    completeProviderCatalog: boolean;
}) {
    if (input.importedProviderCount === 0) return 'foundation';
    if (input.errors > 0) return 'partial';
    if (input.blockedProviderCount === 0 && input.completeProviderCatalog) return 'fully_populated';
    if (input.importedProviderCount > 0 && input.licensedProviderCount + input.credentialedProviderCount > 0) return 'public_sources_populated';
    return input.importedProviderCount === input.providerCount ? 'public_sources_populated' : 'partial';
}

function buildPopulationBlockers(
    plan: OfficialOntologyProviderPlan[],
    skipped: Array<{ provider_key: string; reason: string }>,
    errors: Array<{ provider_key: string; error: string }>,
) {
    const blockers = new Set<string>();
    for (const provider of plan) {
        if (provider.status === 'requires_credentials') blockers.add(`credentials_required:${provider.provider_key}`);
        if (provider.status === 'requires_source_release') blockers.add(`source_release_required:${provider.provider_key}`);
        if (provider.status === 'license_gated') blockers.add(`license_required:${provider.provider_key}`);
    }
    for (const skippedProvider of skipped) blockers.add(`skipped:${skippedProvider.provider_key}:${skippedProvider.reason}`);
    for (const error of errors) blockers.add(`error:${error.provider_key}`);
    return Array.from(blockers);
}

function readGraphs(payload: unknown) {
    return readArray(asRecord(payload).graphs);
}

function readReleaseVersion(payload: unknown) {
    const meta = asRecord(payload);
    return readString(meta.version)
        ?? readString(meta['ontology-version'])
        ?? readString(asRecord(readArray(meta.graphs)[0]).id)
        ?? null;
}

function readSynonyms(meta: Record<string, unknown>) {
    return readArray(meta.synonyms)
        .map((entry) => readString(asRecord(entry).val))
        .filter((value): value is string => typeof value === 'string');
}

function readXrefs(meta: Record<string, unknown>) {
    return readArray(meta.xrefs)
        .map((entry) => readString(asRecord(entry).val))
        .filter((value): value is string => typeof value === 'string');
}

function parseOboCode(codeSystem: string, id: string | null) {
    if (!id) return null;
    const normalizedSystem = codeSystem.toUpperCase();
    const match = id.match(/\/([A-Z]+)_([0-9]+)$/);
    if (!match) return id.includes(':') ? id : null;
    const [, prefix, code] = match;
    if (prefix !== normalizedSystem) return null;
    return `${prefix}:${code}`;
}

function chunkRows<T>(rows: T[], chunkSize: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < rows.length; index += chunkSize) {
        chunks.push(rows.slice(index, index + chunkSize));
    }
    return chunks;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function isRecordRow(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
}

function readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = readString(record[key]);
        if (value && value.trim().length > 0) return value.trim();
    }
    return null;
}

function readIcdTitle(entity: Record<string, unknown>): string | null {
    const title = entity.title;
    if (typeof title === 'string') return stripMarkup(title);
    const titleRecord = asRecord(title);
    return stripMarkup(readString(titleRecord['@value']) ?? readString(titleRecord.value));
}

function readLastPathSegment(value: string | null): string | null {
    if (!value) return null;
    const parts = value.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? null;
}

function stripMarkup(value: string | null): string | null {
    if (!value) return null;
    const stripped = value.replace(/<[^>]+>/g, '').trim();
    return stripped.length > 0 ? stripped : null;
}

function extractGenericRecords(payload: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) return payload.map(asRecord).filter(isRecordRow);
    const record = asRecord(payload);
    for (const key of ['records', 'items', 'data', 'results', 'features']) {
        const rows = readArray(record[key]).map(asRecord).filter(isRecordRow);
        if (rows.length > 0) return rows;
    }
    return Object.keys(record).length > 0 ? [record] : [];
}

function parseDelimitedText(value: string): Array<Record<string, unknown>> {
    const lines = value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length < 2) return [];
    const delimiter = inferDelimiter(lines[0]);
    const headers = splitDelimitedLine(lines[0], delimiter)
        .map((header) => header.trim())
        .filter(Boolean);
    if (headers.length === 0) return [];
    return lines.slice(1)
        .map((line) => {
            const values = splitDelimitedLine(line, delimiter);
            return headers.reduce<Record<string, unknown>>((record, header, index) => {
                const value = values[index]?.trim();
                if (value) record[header] = value;
                return record;
            }, {});
        })
        .filter((record) => Object.keys(record).length > 0);
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];
        if (char === '"' && next === '"') {
            current += '"';
            index += 1;
            continue;
        }
        if (char === '"') {
            quoted = !quoted;
            continue;
        }
        if (char === delimiter && !quoted) {
            cells.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    cells.push(current);
    return cells;
}

function inferDelimiter(headerLine: string): string {
    const candidates = [',', ';', '\t'];
    return candidates
        .map((delimiter) => ({ delimiter, columns: splitDelimitedLine(headerLine, delimiter).length }))
        .sort((a, b) => b.columns - a.columns)[0]?.delimiter ?? ',';
}

function looksLikeJson(value: string): boolean {
    return value.startsWith('{') || value.startsWith('[');
}

function classifyCdcOpenDataUrl(value: string): { status: 'ready' | 'invalid_url' | 'portal_url_not_dataset_endpoint' | 'non_cdc_open_data_host' } {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return { status: 'invalid_url' };
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'data.cdc.gov') return { status: 'non_cdc_open_data_host' };
    const path = parsed.pathname.toLowerCase();
    if (path === '/' || path === '') return { status: 'portal_url_not_dataset_endpoint' };
    if (/^\/resource\/[a-z0-9]{4}-[a-z0-9]{4}\.(json|csv)$/.test(path)) return { status: 'ready' };
    if (/^\/api\/views\/[a-z0-9]{4}-[a-z0-9]{4}\/rows\.(json|csv)$/.test(path)) return { status: 'ready' };
    return { status: 'portal_url_not_dataset_endpoint' };
}

function buildCdcFetchUrl(value: string, maxNodes: number): string {
    const parsed = new URL(value);
    const path = parsed.pathname.toLowerCase();
    if (path.startsWith('/resource/') && path.endsWith('.json') && !parsed.searchParams.has('$limit')) {
        parsed.searchParams.set('$limit', String(Math.min(Math.max(maxNodes, 1), 50000)));
    }
    return parsed.toString();
}

function normalizeOptionalText(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function sanitizeCode(value: string): string {
    return value
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9:._-]/g, '')
        .slice(0, 96);
}

function readBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
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
