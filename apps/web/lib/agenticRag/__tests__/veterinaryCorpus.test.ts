import { describe, expect, it } from 'vitest';
import {
    buildVeterinaryCorpusAuditEventDraft,
    buildVeterinaryCorpusManifest,
    evaluateVeterinaryCitationQuality,
    summarizeVeterinaryCorpusManifest,
} from '../veterinaryCorpus';
import type {
    RagChunkRecord,
    RagCitation,
    RagDocumentRecord,
    RagSourceRecord,
} from '../types';

describe('veterinary retrieval corpus governance', () => {
    it('builds an operating source-versioned corpus manifest with toxicology and lab indexes', () => {
        const sources = [
            source('guideline-1', 'AAHA diagnostic guideline', 'guideline', 'specialist_guideline', ['clinical_guideline', 'diagnostics']),
            source('lab-1', 'University diagnostic lab reference intervals', 'lab_reference', 'institutional', ['lab_reference', 'diagnostics']),
            source('tox-1', 'Veterinary toxicology reference', 'clinical_protocol', 'institutional', ['toxicology', 'drug_safety']),
            source('amr-1', 'One Health AMR stewardship guidance', 'guideline', 'regulatory', ['antimicrobial_stewardship', 'drug_safety']),
        ];
        const documents = sources.map((item) => document(item, `${item.name} v2026.06`));
        const chunks = documents.flatMap((item) => [
            chunk(item, 0, `${item.title} canine feline diagnostic guideline lab reference interval toxicology antimicrobial stewardship source.`),
            chunk(item, 1, `${item.title} includes species-specific dosing boundaries, CBC chemistry, xylitol rodenticide, and susceptibility context.`),
            chunk(item, 2, `${item.title} requires licensed veterinary review, citation grounding, and current source version proof.`),
        ]);

        const manifest = buildVeterinaryCorpusManifest({
            sources,
            documents,
            chunks,
            now: '2026-06-22T12:00:00.000Z',
        });

        expect(manifest.moat_status).toBe('operating');
        expect(manifest.blockers).toEqual([]);
        expect(manifest.corpus_version_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(manifest.source_version_coverage).toBe(1);
        expect(manifest.authorized_source_coverage).toBe(1);
        expect(manifest.domain_index.find((entry) => entry.domain === 'toxicology')?.status).toBe('covered');
        expect(manifest.domain_index.find((entry) => entry.domain === 'lab_reference')?.status).toBe('covered');
        expect(manifest.red_team_suite.case_count).toBeGreaterThanOrEqual(6);

        const readiness = summarizeVeterinaryCorpusManifest(manifest);
        expect(readiness.schema_version).toBe('vetios-veterinary-corpus-readiness-v1');
        expect(readiness.moat_status).toBe('operating');
        expect(readiness.corpus_version_hash).toBe(manifest.corpus_version_hash);
        expect(readiness.red_team_case_count).toBe(manifest.red_team_suite.case_count);
        expect(readiness.domain_index.find((entry) => entry.domain === 'toxicology')?.status).toBe('covered');
    });

    it('builds a sanitized append-only corpus audit event draft from the manifest', () => {
        const sources = [
            source('guideline-1', 'AAHA diagnostic guideline', 'guideline', 'specialist_guideline', ['clinical_guideline', 'diagnostics']),
            source('lab-1', 'University diagnostic lab reference intervals', 'lab_reference', 'institutional', ['lab_reference', 'diagnostics']),
            source('tox-1', 'Veterinary toxicology reference', 'clinical_protocol', 'institutional', ['toxicology', 'drug_safety']),
            source('amr-1', 'One Health AMR stewardship guidance', 'guideline', 'regulatory', ['antimicrobial_stewardship', 'drug_safety']),
        ];
        const documents = sources.map((item) => document(item, `${item.name} v2026.06`));
        const chunks = documents.flatMap((item) => [
            chunk(item, 0, `${item.title} canine feline diagnostic guideline lab reference interval toxicology antimicrobial stewardship source.`),
            chunk(item, 1, `${item.title} includes species-specific dosing boundaries, CBC chemistry, xylitol rodenticide, and susceptibility context.`),
            chunk(item, 2, `${item.title} requires licensed veterinary review, citation grounding, and current source version proof.`),
        ]);
        const manifest = buildVeterinaryCorpusManifest({
            sources,
            documents,
            chunks,
            now: '2026-06-22T12:00:00.000Z',
        });
        const citationQuality = evaluateVeterinaryCitationQuality({
            question: 'How should canine xylitol toxicosis be triaged?',
            species: 'canine',
            citations: [
                citation({
                    source_name: 'Veterinary toxicology reference',
                    authority_tier: 'institutional',
                    source_type: 'clinical_protocol',
                    title: 'Canine xylitol toxicosis triage',
                    quote: 'Canine xylitol toxicosis triage requires urgent veterinary assessment, glucose monitoring, supportive care, and species-specific toxicology evidence before treatment decisions.',
                    similarity: 0.82,
                    provenance: {
                        source_version: '2026.06',
                        source_version_hash: 'b'.repeat(64),
                    },
                }),
            ],
        });

        const draft = buildVeterinaryCorpusAuditEventDraft({
            tenantId: 'tenant-1',
            refreshRunId: '11111111-1111-4111-8111-111111111111',
            auditType: 'catalog_refresh',
            manifest,
            citationQuality,
            evidence: { remote_mode: 'summaries_only' },
            now: '2026-06-22T12:05:00.000Z',
        });

        expect(draft.corpus_version_hash).toBe(manifest.corpus_version_hash);
        expect(draft.moat_status).toBe('operating');
        expect(draft.toxicology_index_status).toBe('covered');
        expect(draft.lab_reference_index_status).toBe('covered');
        expect(draft.citation_quality_status).toBe('accepted');
        expect(draft.source_version_proofs).toHaveLength(sources.length);
        expect(draft.evidence).toMatchObject({
            raw_source_text_included: false,
            proprietary_full_text_included: false,
            red_team_suite_hash: manifest.red_team_suite.suite_version_hash,
        });
        expect(JSON.stringify(draft)).not.toContain('requires urgent veterinary assessment');
    });

    it('keeps corpus manifest at foundation when source versioning or license evidence is missing', () => {
        const unversioned = source('forum-1', 'Unreviewed forum scrape', 'web', 'unverified', ['toxicology'], {
            license: null,
            ingestion_policy: {},
            refresh_policy: {
                connector: 'public_https',
                refresh_interval_days: 30,
            },
        });
        const docs = [document(unversioned, 'Forum text', { metadata: {}, provenance: {} })];
        const chunks = [chunk(docs[0], 0, 'Dog xylitol anecdote without licensed source version proof.')];

        const manifest = buildVeterinaryCorpusManifest({
            sources: [unversioned],
            documents: docs,
            chunks,
            now: '2026-06-22T12:00:00.000Z',
        });

        expect(manifest.moat_status).toBe('foundation');
        expect(manifest.blockers).toContain('source_license_authorization_incomplete');
        expect(manifest.blockers).toContain('source_versioning_incomplete');
        expect(manifest.source_versions[0]?.license_status).toBe('missing');
        expect(manifest.source_versions[0]?.source_version_source).toBe('content_hash');
    });

    it('accepts only high-authority species-matched citations with source-version proof', () => {
        const accepted = evaluateVeterinaryCitationQuality({
            question: 'How should canine xylitol toxicosis be triaged with glucose monitoring?',
            species: 'canine',
            citations: [
                citation({
                    source_name: 'Veterinary toxicology reference',
                    authority_tier: 'institutional',
                    source_type: 'clinical_protocol',
                    title: 'Canine xylitol toxicosis triage',
                    quote: 'Canine xylitol toxicosis triage requires urgent veterinary assessment, glucose monitoring, supportive care, and species-specific toxicology evidence before treatment decisions.',
                    similarity: 0.82,
                    provenance: {
                        source_version: '2026.06',
                        source_version_hash: 'b'.repeat(64),
                    },
                }),
            ],
        });

        const rejected = evaluateVeterinaryCitationQuality({
            question: 'How should canine xylitol toxicosis be triaged with glucose monitoring?',
            species: 'canine',
            citations: [
                citation({
                    source_name: 'Pet forum',
                    authority_tier: 'unverified',
                    source_type: 'web',
                    title: 'Xylitol thread',
                    quote: 'Someone online says it is probably fine.',
                    similarity: 0.31,
                    provenance: {},
                }),
            ],
        });

        expect(accepted.status).toBe('accepted');
        expect(accepted.quality_score).toBeGreaterThanOrEqual(0.75);
        expect(rejected.status).toBe('rejected');
        expect(rejected.blockers).toContain('citation_source_version_missing');
        expect(rejected.blockers).toContain('citation_authority_below_threshold');
    });
});

function source(
    id: string,
    name: string,
    sourceType: RagSourceRecord['source_type'],
    authorityTier: RagSourceRecord['authority_tier'],
    domains: string[],
    overrides: Partial<RagSourceRecord> = {},
): RagSourceRecord {
    return {
        id,
        tenant_id: 'tenant-1',
        external_key: id,
        name,
        source_type: sourceType,
        authority_tier: authorityTier,
        species_scope: ['canine', 'feline'],
        medicine_domain: domains,
        url: `https://example.org/${id}`,
        license: 'public licensed veterinary reference',
        attribution: name,
        ingestion_policy: {
            source_version: '2026.06',
            authorized_for_clinical_retrieval: true,
        },
        refresh_policy: {
            connector: 'public_https',
            refresh_interval_days: 30,
            source_version: '2026.06',
        },
        quality_score: 0.9,
        last_refreshed_at: '2026-06-22T00:00:00.000Z',
        next_refresh_at: '2026-07-22T00:00:00.000Z',
        status: 'active',
        created_at: '2026-06-22T00:00:00.000Z',
        updated_at: '2026-06-22T00:00:00.000Z',
        ...overrides,
    };
}

function document(
    sourceRecord: RagSourceRecord,
    title: string,
    overrides: Partial<RagDocumentRecord> = {},
): RagDocumentRecord {
    return {
        id: `doc-${sourceRecord.id}`,
        tenant_id: sourceRecord.tenant_id,
        source_id: sourceRecord.id,
        title,
        document_type: sourceRecord.source_type,
        language: 'en',
        content_sha256: hash(`${sourceRecord.id}:${title}`),
        content_length: 1200,
        metadata: {
            source_version: '2026.06',
            domains: sourceRecord.medicine_domain,
            species: sourceRecord.species_scope,
        },
        provenance: {
            source_version: '2026.06',
            source_url: sourceRecord.url,
        },
        auto_indexed: true,
        refresh_status: 'current',
        source_fetched_at: '2026-06-22T00:00:00.000Z',
        ingestion_status: 'indexed',
        error_message: null,
        indexed_at: '2026-06-22T00:00:00.000Z',
        created_at: '2026-06-22T00:00:00.000Z',
        updated_at: '2026-06-22T00:00:00.000Z',
        ...overrides,
    };
}

function chunk(documentRecord: RagDocumentRecord, index: number, text: string): RagChunkRecord {
    return {
        id: `chunk-${documentRecord.id}-${index}`,
        tenant_id: documentRecord.tenant_id,
        source_id: documentRecord.source_id,
        document_id: documentRecord.id,
        chunk_index: index,
        chunk_text: text,
        chunk_hash: hash(text),
        heading: documentRecord.title,
        token_estimate: 80,
        embedding_model: 'text-embedding-3-small',
        metadata: documentRecord.metadata,
        created_at: '2026-06-22T00:00:00.000Z',
    };
}

function citation(overrides: Partial<RagCitation>): RagCitation {
    return {
        index: 1,
        chunk_id: 'chunk-1',
        document_id: 'doc-1',
        source_id: 'source-1',
        title: 'Citation',
        source_name: 'Source',
        source_type: 'guideline',
        authority_tier: 'institutional',
        url: 'https://example.org/source',
        year: '2026',
        quote: 'Citation quote.',
        similarity: 0.7,
        provenance: {},
        ...overrides,
    };
}

function hash(value: string): string {
    return Array.from(new TextEncoder().encode(value))
        .reduce((acc, byte) => `${acc}${byte.toString(16).padStart(2, '0')}`, '')
        .padEnd(64, '0')
        .slice(0, 64);
}
