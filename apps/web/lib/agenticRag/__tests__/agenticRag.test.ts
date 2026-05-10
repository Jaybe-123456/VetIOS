import { describe, expect, it } from 'vitest';
import { buildCatalogDocumentPlans } from '../catalogConnectors';
import { chunkRagDocument, normalizeRagContent } from '../chunking';
import { buildRagClosedLoopLearningSystem } from '../closedLoop';
import { answerRagQuery, buildRagQueryPlan } from '../service';
import { validatePublicSourceUrl } from '../sourcePolicy';
import { buildCuratedSourceCard, getCuratedRagCatalog } from '../sourceCatalog';
import {
    assessVetiosSelfProtectionRequest,
    createClientAttestation,
    verifyClientAttestation,
} from '../../protection/selfProtection';

describe('VetIOS Agentic RAG service primitives', () => {
    it('normalizes and chunks veterinary source text with stable metadata', () => {
        const content = `
            # Canine Gastroenteritis Guideline

            Vomiting and diarrhea require hydration assessment, packed cell volume, total solids, and electrolyte review.

            Parvovirus risk increases when hemorrhagic diarrhea, leukopenia, incomplete vaccination, and young age align.
        `;
        const chunks = chunkRagDocument(Array(18).fill(content).join('\n\n'), { maxTokens: 120, overlapTokens: 12 });

        expect(chunks.length).toBeGreaterThanOrEqual(2);
        expect(chunks[0].chunk_index).toBe(0);
        expect(chunks[0].chunk_hash).toHaveLength(64);
        expect(chunks.some((chunk) => chunk.heading?.includes('Canine Gastroenteritis'))).toBe(true);
    });

    it('strips scripts and html before indexing', () => {
        const normalized = normalizeRagContent('<h1>Renal</h1><script>alert(1)</script><p>Creatinine trend matters.</p>');

        expect(normalized).toContain('Renal');
        expect(normalized).toContain('Creatinine trend matters.');
        expect(normalized).not.toContain('alert');
        expect(normalizeRagContent('A&amp;P &lt;strong&gt;review&lt;/strong&gt;')).toContain('A&P review');
    });

    it('rejects private or non-https source URLs', () => {
        expect(validatePublicSourceUrl('http://example.com/source').ok).toBe(false);
        expect(validatePublicSourceUrl('https://localhost/source').ok).toBe(false);
        expect(validatePublicSourceUrl('https://192.168.1.10/source').ok).toBe(false);
        expect(validatePublicSourceUrl('https://[::1]/source').ok).toBe(false);
        expect(validatePublicSourceUrl('https://www.avma.org/resources-tools').ok).toBe(true);
    });

    it('plans retrieval strategy from veterinary query intent', () => {
        expect(buildRagQueryPlan({ question: 'What is the meloxicam dose contraindication in feline CKD?' }).strategy).toBe('drug_safety');
        expect(buildRagQueryPlan({ question: 'How should I interpret CBC leukopenia in canine parvovirus?' }).strategy).toBe('lab_reference');
        expect(buildRagQueryPlan({ question: 'Show the WSAVA guideline for vaccination.' }).strategy).toBe('clinical_guideline');

        const diagnosticPlan = buildRagQueryPlan({
            question: 'What diagnostics are supported for canine vomiting and diarrhea?',
            species: 'canine',
            domain: 'clinical_guideline, diagnostics',
        });
        expect(diagnosticPlan.species).toBe('canine');
        expect(diagnosticPlan.domain_filters).toEqual(['clinical_guideline', 'diagnostics']);
        expect(diagnosticPlan.speciesFilterRequired).toBe(true);
        expect(diagnosticPlan.retrievalOrder).toBe('semantic_first_then_hybrid');
    });

    it('ships a curated global veterinary and medical source catalog with explicit trust tiers', () => {
        const catalog = getCuratedRagCatalog();
        const keys = catalog.map((source) => source.external_key);
        const biovenic = catalog.find((source) => source.external_key === 'biovenic_canine_distemper_antibody');

        expect(catalog.length).toBeGreaterThanOrEqual(23);
        expect(keys).toContain('acvim_endorsed_statements');
        expect(keys).toContain('aafp_feline_guidelines');
        expect(keys).toContain('capc_parasite_guidelines');
        expect(keys).toContain('cornell_feline_health_center');
        expect(keys).toContain('cdc_one_health');
        expect(keys).toContain('dailymed_drug_labels');
        expect(keys).toContain('esccap_parasite_guidelines');
        expect(keys).toContain('iris_kidney_guidelines');
        expect(keys).toContain('woah_terrestrial_manual');
        expect(keys).toContain('pmc_open_access');
        expect(keys).toContain('veterinary_partner_vin');
        expect(keys).toContain('biovenic_animal_health_platform');
        expect(keys).toContain('biovenic_veterinary_therapeutic_antibody');
        expect(biovenic?.url).toBe('https://www.biovenic.com/canine-distemper-virus-therapeutic-antibody-development');
        expect(biovenic?.authority_tier).toBe('unverified');
        expect(catalog.filter((source) => source.attribution === 'BioVenic')).toHaveLength(3);
        expect(catalog.every((source) => validatePublicSourceUrl(source.url).ok)).toBe(true);
    });

    it('source cards link RAG evidence into causal memory, counterfactual review, and One Health surveillance', () => {
        const cdc = getCuratedRagCatalog().find((source) => source.external_key === 'cdc_one_health');
        expect(cdc).toBeTruthy();

        const card = buildCuratedSourceCard(cdc!);
        expect(card).toContain('causal clinical memory');
        expect(card).toContain('counterfactual diagnostic review');
        expect(card).toContain('One Health surveillance');
    });

    it('confirms indexed veterinary and medical evidence as a human-gated closed learning loop', () => {
        const loop = buildRagClosedLoopLearningSystem({
            sources: 23,
            documents: 41,
            chunks: 126,
            high_authority_sources: 20,
            stale_documents: 0,
            last_refreshed_at: '2026-05-10T09:20:26.000Z',
            ready: true,
            warnings: [],
        });

        expect(loop.closed_loop_ready).toBe(true);
        expect(loop.clinical_reasoning_infrastructure).toBe('ready');
        expect(loop.diagnostic_intelligence_pipelines).toBe('ready');
        expect(loop.learning_mode).toBe('evidence_grounded_human_gated');
        expect(loop.promotion_policy.autonomous_model_promotion).toBe(false);
        expect(loop.stages.map((stage) => stage.id)).toContain('human_gated_learning');
    });

    it('signs client attestations and flags cloned browser origins', () => {
        const previousSecret = process.env.VETIOS_CLIENT_ATTESTATION_SECRET;
        const previousOrigins = process.env.VETIOS_ALLOWED_ORIGINS;
        const previousStrictOrigin = process.env.VETIOS_STRICT_ORIGIN_GUARD;
        const secret = '0123456789abcdef0123456789abcdef';

        process.env.VETIOS_CLIENT_ATTESTATION_SECRET = secret;
        process.env.VETIOS_ALLOWED_ORIGINS = 'https://app.vetios.tech';
        process.env.VETIOS_STRICT_ORIGIN_GUARD = 'true';

        try {
            const token = createClientAttestation({
                origin: 'https://app.vetios.tech',
                path: '/api/rag/query',
                method: 'POST',
                issuedAtMs: 1_700_000_000_000,
                nonce: 'unit-test',
                secret,
            });
            expect(verifyClientAttestation(token, {
                origin: 'https://app.vetios.tech',
                path: '/api/rag/query',
                method: 'POST',
                nowMs: 1_700_000_010_000,
                secret,
            }).ok).toBe(true);
            expect(verifyClientAttestation(token, {
                origin: 'https://clone.example',
                path: '/api/rag/query',
                method: 'POST',
                nowMs: 1_700_000_010_000,
                secret,
            }).reason).toBe('attestation_origin_mismatch');

            const clonedRequest = new Request('https://api.vetios.tech/api/rag/query', {
                method: 'POST',
                headers: {
                    origin: 'https://clone.example',
                    host: 'api.vetios.tech',
                    'user-agent': 'Mozilla/5.0',
                },
            });
            const assessment = assessVetiosSelfProtectionRequest(clonedRequest, {
                enforceOrigin: true,
                nowMs: 1_700_000_010_000,
            });

            expect(assessment.allowed).toBe(false);
            expect(assessment.clone_suspected).toBe(true);
            expect(assessment.signals.map((signal) => signal.id)).toContain('origin_not_authorised');
        } finally {
            restoreEnv('VETIOS_CLIENT_ATTESTATION_SECRET', previousSecret);
            restoreEnv('VETIOS_ALLOWED_ORIGINS', previousOrigins);
            restoreEnv('VETIOS_STRICT_ORIGIN_GUARD', previousStrictOrigin);
        }
    });

    it('builds source-card and NCBI literature ingestion plans without full-text scraping', async () => {
        const pubmed = getCuratedRagCatalog().find((source) => source.external_key === 'pubmed_literature_index');
        expect(pubmed).toBeTruthy();

        const fetcher = async (url: string | URL) => {
            const value = String(url);
            if (value.includes('esearch.fcgi')) {
                return new Response(JSON.stringify({
                    esearchresult: {
                        idlist: ['12345', '67890'],
                    },
                }), { status: 200 });
            }

            return new Response(JSON.stringify({
                result: {
                    uids: ['12345', '67890'],
                    12345: {
                        title: 'Veterinary diagnostic accuracy study',
                        fulljournalname: 'Journal of Veterinary Evidence',
                        pubdate: '2026',
                        authors: [{ name: 'Doe J' }],
                    },
                    67890: {
                        title: 'One Health comparative medicine review',
                        source: 'Comparative Medicine',
                        pubdate: '2025',
                    },
                },
            }), { status: 200 });
        };

        const plan = await buildCatalogDocumentPlans({
            definition: pubmed!,
            now: new Date('2026-05-10T00:00:00.000Z'),
            fetcher: fetcher as typeof fetch,
        });

        expect(plan.connector_warnings).toEqual([]);
        expect(plan.documents.some((entry) => entry.document.document_type === 'source_card')).toBe(true);
        expect(plan.documents.some((entry) => entry.document.document_type === 'literature_index_snapshot')).toBe(true);
        expect(plan.documents.map((entry) => entry.document.content_text).join('\n')).toContain('Veterinary diagnostic accuracy study');
        expect(plan.documents.map((entry) => entry.document.content_text).join('\n')).toContain('https://pubmed.ncbi.nlm.nih.gov/12345/');
    });

    it('refuses disease-specific diagnostic answers when only generic guideline metadata is indexed', async () => {
        const client = createRagFakeClient({
            sources: [
                {
                    id: '11111111-1111-4111-8111-111111111111',
                    tenant_id: 'tenant_1',
                    name: 'WSAVA global veterinary guidelines',
                    source_type: 'guideline',
                    authority_tier: 'specialist_guideline',
                    species_scope: ['canine', 'feline'],
                    medicine_domain: ['clinical_guideline', 'diagnostics'],
                    url: 'https://wsava.org/global-guidelines/',
                    status: 'active',
                },
            ],
            chunks: [
                {
                    id: '22222222-2222-4222-8222-222222222222',
                    source_id: '11111111-1111-4111-8111-111111111111',
                    document_id: '33333333-3333-4333-8333-333333333333',
                    chunk_index: 0,
                    chunk_text: 'WSAVA global veterinary guidelines is registered in VetIOS as specialist guideline evidence. Canonical source URL: https://wsava.org/global-guidelines/ Species scope: canine, feline. Medicine domains: clinical_guideline, diagnostics.',
                    metadata: {},
                    created_at: '2026-05-10T00:00:00.000Z',
                },
            ],
            documents: [
                {
                    id: '33333333-3333-4333-8333-333333333333',
                    title: 'WSAVA global veterinary guidelines VetIOS source card',
                    document_type: 'source_card',
                    metadata: { source_card: true },
                    provenance: { source_url: 'https://wsava.org/global-guidelines/' },
                },
            ],
        });

        const result = await answerRagQuery({
            tenantId: 'tenant_1',
            actorKind: 'dev_bypass',
            client,
            question: 'What are the diagnostic criteria for Feline Panleukopenia Virus infection, supported by references?',
            species: 'feline',
            strategy: 'hybrid',
            limit: 6,
        });

        expect(result.citations).toEqual([]);
        expect(result.answer).toBe('No direct evidence available — consult licensed veterinary guidance.');
        expect(result.evaluation.grounded).toBe(false);
        expect(result.evaluation.warnings).toContain('No indexed evidence was retrieved.');
    });

    it('withholds unverified retrieval candidates from clinical grounding citations', async () => {
        const client = createRagFakeClient({
            sources: [
                {
                    id: '55555555-5555-4555-8555-555555555555',
                    tenant_id: 'tenant_1',
                    name: 'BioVenic animal health biotechnology platform',
                    source_type: 'web',
                    authority_tier: 'unverified',
                    species_scope: ['feline'],
                    medicine_domain: ['diagnostics'],
                    url: 'https://www.biovenic.com/',
                    status: 'active',
                },
            ],
            chunks: [
                {
                    id: '66666666-6666-4666-8666-666666666666',
                    source_id: '55555555-5555-4555-8555-555555555555',
                    document_id: '77777777-7777-4777-8777-777777777777',
                    chunk_index: 0,
                    chunk_text: 'Feline panleukopenia virus parvovirus antibody discovery page with commercial biotechnology services.',
                    metadata: {},
                    created_at: '2026-05-10T00:00:00.000Z',
                },
            ],
            documents: [
                {
                    id: '77777777-7777-4777-8777-777777777777',
                    title: 'BioVenic FPV commercial discovery page',
                    document_type: 'web_snapshot',
                    metadata: {},
                    provenance: { source_url: 'https://www.biovenic.com/' },
                },
            ],
        });

        const result = await answerRagQuery({
            tenantId: 'tenant_1',
            actorKind: 'dev_bypass',
            client,
            question: 'What are the diagnostic criteria for Feline Panleukopenia Virus infection, supported by references?',
            strategy: 'hybrid',
            limit: 6,
        });

        expect(result.answer).toBe('No direct evidence available — consult licensed veterinary guidance.');
        expect(result.citations).toEqual([]);
        expect(result.retrieval_stats.candidate_citations).toBe(1);
        expect(result.retrieval_stats.withheld_citations).toBe(1);
        expect(result.evaluation.warnings).toContain('Retrieved candidates were not accepted as grounding citations because they did not meet the clinical evidence threshold.');
    });
});

function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[key];
        return;
    }
    process.env[key] = value;
}

function createRagFakeClient(data: {
    sources: Array<Record<string, unknown>>;
    chunks: Array<Record<string, unknown>>;
    documents: Array<Record<string, unknown>>;
}): any {
    return {
        rpc: async () => ({ data: [], error: null }),
        from: (table: string) => createFakeQuery(table, data),
    };
}

function createFakeQuery(table: string, fixture: {
    sources: Array<Record<string, unknown>>;
    chunks: Array<Record<string, unknown>>;
    documents: Array<Record<string, unknown>>;
}): any {
    let selectedHead = false;
    let inserted = false;
    const query: any = {
        select: (_columns?: string, options?: { head?: boolean }) => {
            selectedHead = options?.head === true;
            return query;
        },
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: () => Promise.resolve(resolveFakeResult(table, fixture, selectedHead, inserted)),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: { id: '44444444-4444-4444-8444-444444444444' }, error: null }),
        insert: () => {
            inserted = true;
            return query;
        },
        then: (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => (
            Promise.resolve(resolveFakeResult(table, fixture, selectedHead, inserted)).then(resolve, reject)
        ),
    };
    return query;
}

function resolveFakeResult(
    table: string,
    fixture: {
        sources: Array<Record<string, unknown>>;
        chunks: Array<Record<string, unknown>>;
        documents: Array<Record<string, unknown>>;
    },
    head: boolean,
    inserted: boolean,
): { data: unknown; error: null; count?: number } {
    if (head) return { data: null, error: null, count: 0 };
    if (inserted) return { data: { id: '44444444-4444-4444-8444-444444444444' }, error: null };
    if (table === 'rag_sources') return { data: fixture.sources, error: null };
    if (table === 'rag_chunks') return { data: fixture.chunks, error: null };
    if (table === 'rag_documents') return { data: fixture.documents, error: null };
    return { data: [], error: null };
}
