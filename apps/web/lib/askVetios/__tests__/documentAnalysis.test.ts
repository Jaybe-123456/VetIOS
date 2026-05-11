import { describe, expect, it } from 'vitest';
import { buildUploadedDocumentAnalysisResponse, shouldUseDirectDocumentAnalysis } from '../documentAnalysis';

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
});
