import type { RagChunkingOptions } from './chunking';
import { buildCuratedSourceCard, type CuratedRagSourceDefinition } from './sourceCatalog';

type CatalogDocument = {
    title: string;
    document_type: string;
    language: string;
    content_text?: string;
    content_url?: string;
    fetch_url?: boolean;
    metadata: Record<string, unknown>;
    auto_indexed: boolean;
    source_fetched_at: string;
};

export interface CatalogDocumentPlan {
    document: CatalogDocument;
    chunking: RagChunkingOptions;
    optional: boolean;
}

export interface CatalogDocumentPlanResult {
    documents: CatalogDocumentPlan[];
    connector_warnings: string[];
}

type NcbiDatabase = 'pubmed' | 'pmc';

interface NcbiQueryDefinition {
    label: string;
    database: NcbiDatabase;
    query: string;
    max_records?: number;
}

interface NcbiSummaryRecord {
    uid: string;
    title: string;
    source: string | null;
    journal: string | null;
    pubdate: string | null;
    authors: string[];
    url: string;
}

const DEFAULT_EUTILS_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const DEFAULT_CONNECTOR_RECORD_LIMIT = 8;

export async function buildCatalogDocumentPlans(input: {
    definition: CuratedRagSourceDefinition;
    now: Date;
    fetcher?: typeof fetch;
}): Promise<CatalogDocumentPlanResult> {
    const documents: CatalogDocumentPlan[] = [
        buildSourceCardPlan(input.definition, input.now),
    ];
    const connectorWarnings: string[] = [];

    if (input.definition.refresh_policy.fetch_remote_text) {
        documents.push(buildRemoteSnapshotPlan(input.definition, input.now));
    }

    if (input.definition.refresh_policy.connector === 'ncbi_literature') {
        try {
            documents.push(...await buildNcbiLiteraturePlans({
                definition: input.definition,
                now: input.now,
                fetcher: input.fetcher ?? fetch,
            }));
        } catch (error) {
            connectorWarnings.push(error instanceof Error ? error.message : 'NCBI literature connector failed.');
        }
    }

    return {
        documents,
        connector_warnings: connectorWarnings,
    };
}

function buildSourceCardPlan(definition: CuratedRagSourceDefinition, now: Date): CatalogDocumentPlan {
    return {
        document: {
            title: `${definition.name} VetIOS source card`,
            document_type: 'source_card',
            language: 'en',
            content_text: buildCuratedSourceCard(definition),
            metadata: {
                ...baseCatalogMetadata(definition),
                source_card: true,
                remote_fetch: false,
                connector: definition.refresh_policy.connector,
            },
            auto_indexed: true,
            source_fetched_at: now.toISOString(),
        },
        chunking: { maxTokens: 360, overlapTokens: 40, maxChunks: 12 },
        optional: false,
    };
}

function buildRemoteSnapshotPlan(definition: CuratedRagSourceDefinition, now: Date): CatalogDocumentPlan {
    return {
        document: {
            title: `${definition.name} source snapshot`,
            document_type: 'web_snapshot',
            language: 'en',
            content_url: definition.url,
            fetch_url: true,
            metadata: {
                ...baseCatalogMetadata(definition),
                source_card: false,
                remote_fetch: true,
                connector: definition.refresh_policy.connector,
            },
            auto_indexed: true,
            source_fetched_at: now.toISOString(),
        },
        chunking: { maxTokens: 520, overlapTokens: 70, maxChunks: 120 },
        optional: true,
    };
}

async function buildNcbiLiteraturePlans(input: {
    definition: CuratedRagSourceDefinition;
    now: Date;
    fetcher: typeof fetch;
}): Promise<CatalogDocumentPlan[]> {
    const queries = input.definition.connector_queries ?? [];
    if (queries.length === 0) return [];

    const limit = getConnectorRecordLimit();
    let remaining = limit;
    const documents: CatalogDocumentPlan[] = [];

    for (const query of queries) {
        if (remaining <= 0) break;
        const maxRecords = Math.min(normalizeRecordLimit(query.max_records, 4), remaining);
        const records = await fetchNcbiSummaries({
            query,
            maxRecords,
            fetcher: input.fetcher,
        });
        remaining -= records.length;

        if (records.length === 0) continue;
        documents.push({
            document: {
                title: `${input.definition.name}: ${query.label}`,
                document_type: 'literature_index_snapshot',
                language: 'en',
                content_text: buildNcbiLiteratureCard(input.definition, query, records),
                metadata: {
                    ...baseCatalogMetadata(input.definition),
                    source_card: false,
                    remote_fetch: false,
                    connector: 'ncbi_literature',
                    ncbi_database: query.database,
                    ncbi_query: query.query,
                    records_indexed: records.length,
                },
                auto_indexed: true,
                source_fetched_at: input.now.toISOString(),
            },
            chunking: { maxTokens: 520, overlapTokens: 60, maxChunks: 24 },
            optional: true,
        });
    }

    return documents;
}

async function fetchNcbiSummaries(input: {
    query: NcbiQueryDefinition;
    maxRecords: number;
    fetcher: typeof fetch;
}): Promise<NcbiSummaryRecord[]> {
    const ids = await fetchNcbiIds(input);
    if (ids.length === 0) return [];

    const url = buildEutilsUrl('esummary.fcgi');
    url.searchParams.set('db', input.query.database);
    url.searchParams.set('id', ids.join(','));
    url.searchParams.set('retmode', 'json');
    applyNcbiIdentityParams(url);

    const body = await fetchJson(input.fetcher, url);
    const result = asRecord(body.result);
    const uids = asStringArray(result.uids);
    const orderedIds = uids.length > 0 ? uids : ids;

    return orderedIds
        .map((uid) => mapNcbiSummary(input.query.database, uid, asRecord(result[uid])))
        .filter((record): record is NcbiSummaryRecord => record !== null);
}

async function fetchNcbiIds(input: {
    query: NcbiQueryDefinition;
    maxRecords: number;
    fetcher: typeof fetch;
}): Promise<string[]> {
    const url = buildEutilsUrl('esearch.fcgi');
    url.searchParams.set('db', input.query.database);
    url.searchParams.set('term', input.query.query);
    url.searchParams.set('retmode', 'json');
    url.searchParams.set('retmax', String(input.maxRecords));
    url.searchParams.set('sort', 'relevance');
    applyNcbiIdentityParams(url);

    const body = await fetchJson(input.fetcher, url);
    return asStringArray(asRecord(body.esearchresult).idlist).slice(0, input.maxRecords);
}

async function fetchJson(fetcher: typeof fetch, url: URL): Promise<Record<string, unknown>> {
    const response = await fetcher(url.toString(), {
        cache: 'no-store',
        signal: buildTimeoutSignal(10_000),
        headers: {
            Accept: 'application/json',
        },
    });
    if (!response.ok) {
        throw new Error(`NCBI connector request failed with ${response.status}.`);
    }
    return asRecord(await response.json());
}

function mapNcbiSummary(database: NcbiDatabase, uid: string, row: Record<string, unknown>): NcbiSummaryRecord | null {
    const title = normalizeText(row.title);
    if (!title) return null;

    return {
        uid,
        title,
        source: normalizeText(row.source),
        journal: normalizeText(row.fulljournalname),
        pubdate: normalizeText(row.pubdate) ?? normalizeText(row.epubdate),
        authors: asAuthorList(row.authors),
        url: buildNcbiRecordUrl(database, uid),
    };
}

function buildNcbiLiteratureCard(
    definition: CuratedRagSourceDefinition,
    query: NcbiQueryDefinition,
    records: NcbiSummaryRecord[],
): string {
    const recordText = records.map((record, index) => [
        `Record ${index + 1}: ${record.title}`,
        `Database: ${query.database.toUpperCase()}. UID: ${record.uid}.`,
        `Source: ${record.journal ?? record.source ?? 'not specified'}. Publication date: ${record.pubdate ?? 'not specified'}.`,
        record.authors.length > 0 ? `Authors: ${record.authors.slice(0, 8).join(', ')}.` : 'Authors: not specified.',
        `Canonical URL: ${record.url}`,
    ].join('\n')).join('\n\n');

    return [
        `${definition.name} NCBI literature connector snapshot.`,
        `Search label: ${query.label}`,
        `Search database: ${query.database}. Search query: ${query.query}`,
        `Retrieval use: ${definition.source_card.retrieval_use}`,
        `Safety boundary: ${definition.source_card.safety_boundary}`,
        'Literature snapshots are discovery and grounding artifacts; VetIOS ranks them below direct full-text guideline excerpts unless an indexed record has stronger source evidence.',
        recordText,
    ].join('\n\n');
}

function buildNcbiRecordUrl(database: NcbiDatabase, uid: string): string {
    if (database === 'pmc') {
        const normalized = uid.toUpperCase().startsWith('PMC') ? uid.toUpperCase() : `PMC${uid}`;
        return `https://pmc.ncbi.nlm.nih.gov/articles/${normalized}/`;
    }
    return `https://pubmed.ncbi.nlm.nih.gov/${uid}/`;
}

function baseCatalogMetadata(definition: CuratedRagSourceDefinition): Record<string, unknown> {
    return {
        curated_catalog: true,
        external_key: definition.external_key,
        source_authority: definition.authority_tier,
        integration_hooks: definition.source_card.integration_hooks,
    };
}

function buildEutilsUrl(endpoint: string): URL {
    const base = process.env.VETIOS_RAG_EUTILS_BASE_URL
        ?? process.env.VETIOS_PMC_EUTILS_BASE_URL
        ?? DEFAULT_EUTILS_BASE_URL;
    return new URL(`${base.replace(/\/+$/, '')}/${endpoint}`);
}

function applyNcbiIdentityParams(url: URL): void {
    const apiKey = process.env.VETIOS_NCBI_API_KEY?.trim();
    const tool = process.env.VETIOS_NCBI_TOOL?.trim() || 'vetios_agentic_rag';
    const email = process.env.VETIOS_NCBI_EMAIL?.trim();

    url.searchParams.set('tool', tool);
    if (email) url.searchParams.set('email', email);
    if (apiKey) url.searchParams.set('api_key', apiKey);
}

function getConnectorRecordLimit(): number {
    return normalizeRecordLimit(Number(process.env.VETIOS_RAG_CONNECTOR_MAX_RECORDS), DEFAULT_CONNECTOR_RECORD_LIMIT);
}

function normalizeRecordLimit(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 20) : fallback;
}

function buildTimeoutSignal(ms: number): AbortSignal | undefined {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(ms)
        : undefined;
}

function asAuthorList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((author) => normalizeText(asRecord(author).name))
        .filter((name): name is string => Boolean(name))
        .slice(0, 12);
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim().replace(/\s+/g, ' ') : null;
}
