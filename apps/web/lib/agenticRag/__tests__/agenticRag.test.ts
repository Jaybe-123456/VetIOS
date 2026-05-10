import { describe, expect, it } from 'vitest';
import { buildCatalogDocumentPlans } from '../catalogConnectors';
import { chunkRagDocument, normalizeRagContent } from '../chunking';
import { buildRagQueryPlan } from '../service';
import { validatePublicSourceUrl } from '../sourcePolicy';
import { buildCuratedSourceCard, getCuratedRagCatalog } from '../sourceCatalog';

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
});
