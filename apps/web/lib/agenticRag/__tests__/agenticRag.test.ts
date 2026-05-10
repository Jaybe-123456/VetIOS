import { describe, expect, it } from 'vitest';
import { chunkRagDocument, normalizeRagContent } from '../chunking';
import { buildRagQueryPlan } from '../service';
import { validatePublicSourceUrl } from '../sourcePolicy';

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
});
