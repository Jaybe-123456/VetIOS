import type { SupabaseClient } from '@supabase/supabase-js';
import type { IngestRagDocumentInput, IngestRagDocumentResult, RagSourceInput } from './service';
import { ingestRagDocument } from './service';

export interface IndexSourceDocumentInput {
    title: string;
    text?: string;
    content_text?: string;
    url?: string | null;
    species?: string[];
    domain?: string[];
    authority?: string;
    source_type?: string;
    document_type?: string;
    language?: string;
    metadata?: Record<string, unknown>;
    fetch_url?: boolean;
}

export interface IndexSourceBundleInput {
    source_name: string;
    source_type?: string;
    authority?: string;
    species_scope?: string[];
    domain_scope?: string[];
    url?: string | null;
    license?: string | null;
    attribution?: string | null;
    documents: IndexSourceDocumentInput[];
}

export interface IndexSourceBundleJob {
    source: RagSourceInput;
    document: IngestRagDocumentInput['document'];
    chunking: IngestRagDocumentInput['chunking'];
}

export interface IndexSourceBundleResult {
    source_name: string;
    documents_attempted: number;
    documents_indexed: number;
    chunks_indexed: number;
    results: IngestRagDocumentResult[];
    errors: Array<{ title: string; message: string }>;
}

export interface IndexSourceDatasetInput {
    dataset_name?: string;
    sources: IndexSourceBundleInput[];
}

export interface IndexSourceDatasetPlan {
    dataset_name: string;
    sources_attempted: number;
    documents_attempted: number;
    jobs: Array<IndexSourceBundleJob & { source_name: string }>;
}

export interface IndexSourceDatasetResult {
    dataset_name: string;
    sources_attempted: number;
    sources_indexed: number;
    documents_attempted: number;
    documents_indexed: number;
    chunks_indexed: number;
    results: IndexSourceBundleResult[];
    errors: Array<{ source_name: string; title?: string; message: string }>;
}

export async function ingestIndexSourceBundle(input: {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    bundle: IndexSourceBundleInput;
}): Promise<IndexSourceBundleResult> {
    const jobs = buildIndexSourceBundleJobs(input.bundle);
    const results: IngestRagDocumentResult[] = [];
    const errors: Array<{ title: string; message: string }> = [];

    for (const job of jobs) {
        try {
            results.push(await ingestRagDocument({
                tenantId: input.tenantId,
                actorLabel: input.actorLabel,
                client: input.client,
                source: job.source,
                document: job.document,
                chunking: job.chunking,
            }));
        } catch (error) {
            errors.push({
                title: job.document.title,
                message: error instanceof Error ? error.message : 'Unknown index source document failure',
            });
        }
    }

    return {
        source_name: input.bundle.source_name,
        documents_attempted: jobs.length,
        documents_indexed: results.length,
        chunks_indexed: results.reduce((sum, result) => sum + result.chunks_indexed, 0),
        results,
        errors,
    };
}

export async function ingestIndexSourceDataset(input: {
    client: SupabaseClient;
    tenantId: string;
    actorLabel: string | null;
    dataset: IndexSourceDatasetInput;
}): Promise<IndexSourceDatasetResult> {
    const datasetName = normalizeDatasetName(input.dataset.dataset_name);
    const results: IndexSourceBundleResult[] = [];
    const errors: Array<{ source_name: string; title?: string; message: string }> = [];

    for (const bundle of input.dataset.sources) {
        const result = await ingestIndexSourceBundle({
            client: input.client,
            tenantId: input.tenantId,
            actorLabel: input.actorLabel,
            bundle,
        });
        results.push(result);
        for (const error of result.errors) {
            errors.push({
                source_name: bundle.source_name,
                title: error.title,
                message: error.message,
            });
        }
    }

    return {
        dataset_name: datasetName,
        sources_attempted: input.dataset.sources.length,
        sources_indexed: results.filter((result) => result.documents_indexed > 0).length,
        documents_attempted: results.reduce((sum, result) => sum + result.documents_attempted, 0),
        documents_indexed: results.reduce((sum, result) => sum + result.documents_indexed, 0),
        chunks_indexed: results.reduce((sum, result) => sum + result.chunks_indexed, 0),
        results,
        errors,
    };
}

export function buildIndexSourceBundleJobs(bundle: IndexSourceBundleInput): IndexSourceBundleJob[] {
    const sourceSpecies = unionStringLists([
        bundle.species_scope ?? [],
        ...bundle.documents.map((document) => document.species ?? []),
    ]);
    const sourceDomains = unionStringLists([
        bundle.domain_scope ?? [],
        ...bundle.documents.map((document) => document.domain ?? []),
    ]);

    return bundle.documents.map((document, index) => {
        const contentText = document.content_text ?? document.text;
        const documentSpecies = normalizeStringList(document.species ?? bundle.species_scope ?? []);
        const documentDomains = normalizeStringList(document.domain ?? bundle.domain_scope ?? []);
        const authority = document.authority ?? bundle.authority ?? 'unverified';
        const sourceType = document.source_type ?? bundle.source_type ?? 'guideline';

        return {
            source: {
                external_key: normalizeExternalKey(bundle.source_name),
                name: bundle.source_name,
                source_type: sourceType,
                authority_tier: bundle.authority ?? authority,
                species_scope: sourceSpecies,
                medicine_domain: sourceDomains,
                url: bundle.url ?? null,
                license: bundle.license ?? null,
                attribution: bundle.attribution ?? bundle.source_name,
                ingestion_policy: {
                    bulk_index_source: true,
                    bundle_document_count: bundle.documents.length,
                    source_document_ordinal: index,
                },
                refresh_policy: {
                    connector: 'manual_index_source',
                    refresh_interval_days: 30,
                    fetch_remote_text: false,
                },
            },
            document: {
                title: document.title,
                document_type: document.document_type ?? sourceType,
                language: document.language ?? 'en',
                content_text: contentText,
                content_url: document.url ?? undefined,
                fetch_url: Boolean(document.fetch_url && !contentText),
                metadata: {
                    ...(document.metadata ?? {}),
                    indexed_via: 'api/index_source',
                    source_name: bundle.source_name,
                    source_authority: authority,
                    source_type: sourceType,
                    document_species: documentSpecies,
                    document_domains: documentDomains,
                    document_url: document.url ?? null,
                },
                auto_indexed: false,
            },
            chunking: {
                maxTokens: 520,
                overlapTokens: 70,
                maxChunks: 200,
            },
        };
    });
}

export function buildIndexSourceDatasetPlan(dataset: IndexSourceDatasetInput): IndexSourceDatasetPlan {
    const jobs = dataset.sources.flatMap((source) => (
        buildIndexSourceBundleJobs(source).map((job) => ({
            ...job,
            source_name: source.source_name,
        }))
    ));

    return {
        dataset_name: normalizeDatasetName(dataset.dataset_name),
        sources_attempted: dataset.sources.length,
        documents_attempted: jobs.length,
        jobs,
    };
}

function unionStringLists(groups: string[][]): string[] {
    return normalizeStringList(groups.flat()).slice(0, 24);
}

function normalizeStringList(values: string[]): string[] {
    return [...new Set(values
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^[a-z0-9 _/-]{1,80}$/.test(value))
        .map((value) => value.replace(/\s+/g, '_')))];
}

function normalizeExternalKey(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'indexed_source';
}

function normalizeDatasetName(value: string | undefined): string {
    const normalized = value?.trim();
    return normalized && normalized.length <= 160 ? normalized : 'VetIOS veterinary evidence training corpus';
}
