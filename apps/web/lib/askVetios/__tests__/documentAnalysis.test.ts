import { describe, expect, it } from 'vitest';
import {
    buildUploadedDocumentAnalysisResponse,
    buildUploadedDocumentQuestionResponse,
    shouldUseDirectDocumentAnalysis,
} from '../documentAnalysis';

describe('uploaded document analysis contract', () => {
    it('detects direct analysis intent only when uploads are present', () => {
        expect(shouldUseDirectDocumentAnalysis('Analyze the uploaded document in full detail', ['a'.repeat(64)])).toBe(true);
        expect(shouldUseDirectDocumentAnalysis('Analyze the uploaded document in full detail', [])).toBe(false);
        expect(shouldUseDirectDocumentAnalysis('What is pancreatitis?', ['a'.repeat(64)])).toBe(false);
    });

    it('builds a long source-attributed document reasoning response from indexed chunks', () => {
        const response = buildUploadedDocumentAnalysisResponse({
            sessionId: 'chat-1',
            queryId: 'query-1',
            startedAt: Date.now() - 12,
            contexts: [
                {
                    upload_id: 'a'.repeat(64),
                    document_id: 'doc-1',
                    title: 'canine-case.pdf',
                    source_name: 'Ask Vetios uploads',
                    chunks: [
                        {
                            chunk_index: 0,
                            heading: 'Case',
                            chunk_text: 'Canine patient with vomiting, diarrhea, abdominal pain, dehydration, elevated cPLI, CBC and chemistry performed.',
                        },
                        {
                            chunk_index: 1,
                            heading: 'Plan',
                            chunk_text: 'Abdominal ultrasound was recommended. Fluids and antiemetic therapy were discussed. Outcome improved.',
                        },
                    ],
                },
            ],
        });

        expect(response.session_id).toBe('chat-1');
        expect(response.model_version).toBe('ask-vetios-v2-uploaded-document-analysis');
        expect(response.rag_chunks_used).toBe(2);
        expect(response.narrative).toContain('Evidence walkthrough');
        expect(response.narrative).toContain('upload://canine-case.pdf#chunk-1');
        expect(response.differentials.map((entry) => entry.diagnosis)).toContain('Pancreatitis or pancreatic injury');
        expect(response.recommended_diagnostics).toContain('Urinalysis not clearly present in indexed text; add when renal, endocrine, urinary, or hydration questions remain.');
        expect(response.clinical_signs).toEqual(expect.arrayContaining(['vomiting', 'diarrhea', 'abdominal pain', 'dehydration']));
        expect(response.document_tables?.map((table) => table.title)).toEqual([
            'Source Inventory',
            'Extracted Clinical Signals',
            'Differential Reasoning',
        ]);
    });

    it('answers arbitrary uploaded-document questions from indexed chunks', () => {
        const response = buildUploadedDocumentQuestionResponse({
            sessionId: 'chat-2',
            queryId: 'query-2',
            query: 'What does the document say about bats and rabies?',
            startedAt: Date.now() - 8,
            contexts: [
                {
                    upload_id: 'b'.repeat(64),
                    document_id: 'doc-2',
                    title: 'rodents-bats.pptx',
                    source_name: 'Ask Vetios uploads',
                    chunks: [
                        {
                            chunk_index: 0,
                            heading: 'Rodents',
                            chunk_text: 'Rodent lecture content describing lymphocytic choriomeningitis.',
                        },
                        {
                            chunk_index: 1,
                            heading: 'Bats',
                            chunk_text: 'Bat rabies exposure is a zoonotic risk and requires public health reporting.',
                        },
                    ],
                },
            ],
        });

        expect(response.model_version).toBe('ask-vetios-v2-uploaded-document-question');
        expect(response.narrative).toContain('Bat rabies exposure');
        expect(response.narrative).toContain('upload://rodents-bats.pptx#chunk-2');
        expect(response.rag_chunks_used).toBe(2);
    });

    it('does not force clinical differentials onto educational uploaded-document questions', () => {
        const response = buildUploadedDocumentQuestionResponse({
            sessionId: 'chat-3',
            queryId: 'query-3',
            query: 'discuss Assisted Reproductive Technologies in Veterinary Medicine',
            startedAt: Date.now() - 8,
            contexts: [
                {
                    upload_id: 'c'.repeat(64),
                    document_id: 'doc-3',
                    title: 'reproductive-technologies.pdf',
                    source_name: 'Ask Vetios uploads',
                    chunks: [
                        {
                            chunk_index: 0,
                            heading: 'Assisted Reproductive Technologies',
                            chunk_text: 'Assisted Reproductive Technologies in veterinary medicine include artificial insemination, estrus synchronization, embryo transfer, in vitro fertilization, semen cryopreservation, and embryo cryopreservation.',
                        },
                        {
                            chunk_index: 1,
                            heading: 'Applications',
                            chunk_text: 'These techniques support genetic improvement, conservation breeding, infertility management, and planned reproduction in domestic and wildlife species.',
                        },
                    ],
                },
            ],
        });

        expect(response.model_version).toBe('ask-vetios-v2-uploaded-document-question');
        expect(response.narrative).toContain('Answer synthesis');
        expect(response.narrative).toContain('artificial insemination');
        expect(response.differentials).toEqual([]);
        expect(response.recommended_diagnostics).toEqual([]);
        expect(response.flags.requires_specialist_review).toBe(false);
        expect(response.document_tables?.map((table) => table.title)).not.toContain('Differential Reasoning');
    });
});
