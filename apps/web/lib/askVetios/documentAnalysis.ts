import type { SupabaseClient } from '@supabase/supabase-js';
import type { AskVetiosContractResponse } from './responseContract';

export interface UploadedDocumentContext {
    upload_id: string;
    document_id: string;
    title: string;
    source_name: string;
    chunks: Array<{
        chunk_index: number;
        chunk_text: string;
        heading: string | null;
    }>;
}

const DIRECT_ANALYSIS_CHUNK_LIMIT = 24;

export async function loadUploadedDocumentContexts(input: {
    client: SupabaseClient;
    uploadIds: string[];
}): Promise<UploadedDocumentContext[]> {
    const uploadIds = input.uploadIds.filter((value) => /^[a-f0-9]{64}$/i.test(value)).slice(0, 20);
    if (uploadIds.length === 0) return [];

    const { data: uploadRows, error: uploadError } = await input.client
        .from('upload_hashes')
        .select('content_hash, rag_document_id')
        .in('content_hash', uploadIds);
    if (uploadError) return [];

    const documentIds = [...new Set((uploadRows ?? [])
        .map((row) => typeof row.rag_document_id === 'string' ? row.rag_document_id : null)
        .filter((value): value is string => Boolean(value)))];
    if (documentIds.length === 0) return [];

    const { data: documents, error: documentError } = await input.client
        .from('rag_documents')
        .select('id, title, source_id')
        .in('id', documentIds);
    if (documentError) return [];

    const sourceIds = [...new Set((documents ?? [])
        .map((row) => typeof row.source_id === 'string' ? row.source_id : null)
        .filter((value): value is string => Boolean(value)))];
    const { data: sources } = sourceIds.length > 0
        ? await input.client.from('rag_sources').select('id, name').in('id', sourceIds)
        : { data: [] };

    const { data: chunks, error: chunkError } = await input.client
        .from('rag_chunks')
        .select('document_id, chunk_index, chunk_text, heading')
        .in('document_id', documentIds)
        .order('chunk_index', { ascending: true });
    if (chunkError) return [];

    const sourceNameById = new Map((sources ?? []).map((row) => [String(row.id), String(row.name ?? 'Uploaded document')]));
    const uploadIdByDocumentId = new Map((uploadRows ?? []).map((row) => [String(row.rag_document_id), String(row.content_hash)]));
    const chunksByDocumentId = new Map<string, UploadedDocumentContext['chunks']>();
    for (const chunk of chunks ?? []) {
        const documentId = String(chunk.document_id);
        const list = chunksByDocumentId.get(documentId) ?? [];
        list.push({
            chunk_index: Number(chunk.chunk_index ?? list.length),
            chunk_text: String(chunk.chunk_text ?? ''),
            heading: typeof chunk.heading === 'string' ? chunk.heading : null,
        });
        chunksByDocumentId.set(documentId, list);
    }

    return (documents ?? []).map((document) => {
        const documentId = String(document.id);
        return {
            upload_id: uploadIdByDocumentId.get(documentId) ?? '',
            document_id: documentId,
            title: String(document.title ?? 'Uploaded clinical document'),
            source_name: sourceNameById.get(String(document.source_id)) ?? 'Ask Vetios upload',
            chunks: chunksByDocumentId.get(documentId) ?? [],
        };
    }).filter((context) => context.chunks.length > 0);
}

export function shouldUseDirectDocumentAnalysis(query: string, uploadIds: string[]): boolean {
    if (uploadIds.length === 0) return false;
    return /\b(analy[sz]e|review|summari[sz]e|extract|reason|full|document|uploaded|file|all information)\b/i.test(query);
}

export function buildUploadedDocumentAnalysisResponse(input: {
    contexts: UploadedDocumentContext[];
    sessionId: string | null;
    queryId: string;
    startedAt: number;
}): AskVetiosContractResponse {
    const allChunks = input.contexts.flatMap((context) => (
        context.chunks.map((chunk) => ({ context, chunk }))
    ));
    const selected = allChunks.slice(0, DIRECT_ANALYSIS_CHUNK_LIMIT);
    const combinedText = selected.map(({ chunk }) => chunk.chunk_text).join('\n\n');
    const signals = extractClinicalSignals(combinedText);
    const differentials = inferDocumentDifferentials(combinedText, selected.map(({ context, chunk }) => citationFor(context, chunk.chunk_index)));
    const emergency = hasEmergencySignal(combinedText);

    return {
        session_id: input.sessionId ?? 'sessionless',
        query_id: input.queryId,
        narrative: buildNarrative(input.contexts, selected, signals, emergency, allChunks.length > selected.length),
        differentials,
        recommended_diagnostics: buildDocumentDiagnosticGaps(combinedText),
        recommended_treatments: [],
        flags: {
            low_confidence_hypotheses: differentials.filter((entry) => entry.confidence < 0.3).map((entry) => entry.diagnosis),
            unsourced_priors: [],
            requires_specialist_review: emergency || differentials.some((entry) => entry.confidence < 0.5),
            emergency_flag: emergency,
        },
        rag_chunks_used: selected.length,
        video_segments_referenced: 0,
        response_latency_ms: Math.max(1, Date.now() - input.startedAt),
        model_version: 'ask-vetios-v2-uploaded-document-analysis',
    };
}

function buildNarrative(
    contexts: UploadedDocumentContext[],
    selected: Array<{ context: UploadedDocumentContext; chunk: UploadedDocumentContext['chunks'][number] }>,
    signals: ReturnType<typeof extractClinicalSignals>,
    emergency: boolean,
    truncated: boolean,
): string {
    const lines: string[] = [
        emergency
            ? 'EMERGENCY FLAG DETECTED: the uploaded document contains time-critical language. Immediate clinician review is required before relying on document analysis.'
            : 'Uploaded document analysis completed against indexed source chunks.',
        '',
        'Source inventory:',
        ...contexts.map((context) => `- ${context.title} (${context.chunks.length} indexed chunks, source: ${context.source_name})`),
        '',
        'Extracted clinical signal map:',
        `- Species/signalment mentions: ${signals.signalment.join('; ') || 'not explicitly detected in indexed text'}`,
        `- Clinical signs/findings: ${signals.findings.join('; ') || 'not explicitly detected in indexed text'}`,
        `- Diagnostic/lab/imaging mentions: ${signals.diagnostics.join('; ') || 'not explicitly detected in indexed text'}`,
        `- Treatment/outcome mentions: ${signals.treatments.join('; ') || 'not explicitly detected in indexed text'}`,
        '',
        'Evidence walkthrough:',
    ];

    for (const { context, chunk } of selected) {
        lines.push(
            '',
            `Chunk ${chunk.chunk_index + 1} - ${chunk.heading ?? context.title}`,
            `${chunk.chunk_text}`,
            `Source: ${citationFor(context, chunk.chunk_index)}`,
        );
    }

    lines.push(
        '',
        'Reasoning synthesis:',
        '- The analysis above is restricted to text extracted from the uploaded source. Any missing signalment, lab values, imaging findings, treatments, or outcomes should be treated as absent from the indexed document, not absent from the patient.',
        '- Differential reasoning should be based on the extracted findings and contradicted by any normal values or negative diagnostics present in the same document.',
        '- Drug doses, prognosis, and high-stakes treatment choices still require clinician verification against patient weight, current formulary, and the original record.',
    );

    if (truncated) {
        lines.push('- The document contains additional indexed chunks beyond this response. Ask a focused follow-up to inspect a specific section, diagnosis, lab value, or page.');
    }

    return lines.join('\n');
}

function extractClinicalSignals(text: string) {
    const lower = text.toLowerCase();
    return {
        signalment: collectMatches(lower, [
            'canine', 'dog', 'feline', 'cat', 'equine', 'horse', 'bovine', 'cow',
            'puppy', 'kitten', 'geriatric', 'juvenile', 'male', 'female', 'spayed', 'neutered',
        ]),
        findings: collectMatches(lower, [
            'vomiting', 'diarrhea', 'diarrhoea', 'anorexia', 'lethargy', 'fever', 'cough',
            'dyspnea', 'respiratory distress', 'nasal discharge', 'sneezing', 'seizure',
            'collapse', 'abdominal pain', 'dehydration', 'jaundice', 'icterus',
        ]),
        diagnostics: collectMatches(lower, [
            'cbc', 'chemistry', 'wbc', 'neutrophil', 'platelet', 'creatinine', 'bun',
            'alt', 'alp', 'bilirubin', 'glucose', 'urinalysis', 'radiograph', 'ultrasound',
            'cytology', 'histopathology', 'pcr', 'culture', 'cpli', 'fpli',
        ]),
        treatments: collectMatches(lower, [
            'fluid', 'antibiotic', 'analgesia', 'antiemetic', 'surgery', 'oxygen',
            'transfusion', 'steroid', 'insulin', 'outcome', 'resolved', 'improved', 'referred',
        ]),
    };
}

function inferDocumentDifferentials(text: string, citations: string[]): AskVetiosContractResponse['differentials'] {
    const lower = text.toLowerCase();
    const candidates = [
        { diagnosis: 'Pancreatitis or pancreatic injury', terms: ['pancreatitis', 'cpli', 'fpli', 'pancreatic lipase', 'abdominal pain'] },
        { diagnosis: 'Gastroenteritis or enteric disease', terms: ['vomiting', 'diarrhea', 'gastroenteritis', 'enteritis'] },
        { diagnosis: 'Renal or urinary disease', terms: ['creatinine', 'bun', 'azotemia', 'azotaemia', 'urinalysis', 'kidney'] },
        { diagnosis: 'Respiratory infectious or inflammatory disease', terms: ['cough', 'dyspnea', 'respiratory', 'nasal discharge', 'sneezing'] },
        { diagnosis: 'Hepatobiliary disease or reactive hepatopathy', terms: ['alt', 'alp', 'bilirubin', 'jaundice', 'icterus', 'liver'] },
    ];

    return candidates
        .map((candidate) => {
            const matched = candidate.terms.filter((term) => lower.includes(term));
            return {
                candidate,
                matched,
                confidence: Number(Math.min(0.85, 0.18 + matched.length * 0.13).toFixed(2)),
            };
        })
        .filter((entry) => entry.matched.length > 0)
        .sort((left, right) => right.confidence - left.confidence)
        .slice(0, 7)
        .map((entry, index) => ({
            rank: index + 1,
            diagnosis: entry.candidate.diagnosis,
            confidence: entry.confidence,
            supporting_evidence: [`Document contains: ${entry.matched.join(', ')}`],
            contradicting_evidence: [],
            source_attribution: citations,
        }));
}

function buildDocumentDiagnosticGaps(text: string): string[] {
    const lower = text.toLowerCase();
    const gaps: string[] = [];
    if (!/\bcbc\b|white blood|wbc/.test(lower)) gaps.push('CBC not clearly present in indexed text; obtain or verify if systemic illness is possible.');
    if (!/chemistry|creatinine|bun|alt|alp|glucose/.test(lower)) gaps.push('Serum chemistry not clearly present in indexed text; obtain or verify for organ-system screening.');
    if (!/urinalysis|specific gravity|usg/.test(lower)) gaps.push('Urinalysis not clearly present in indexed text; add when renal, endocrine, urinary, or hydration questions remain.');
    if (!/radiograph|ultrasound|imaging/.test(lower)) gaps.push('Imaging not clearly present in indexed text; consider if localization, obstruction, mass, thoracic disease, or abdominal pain is relevant.');
    return gaps;
}

function hasEmergencySignal(text: string): boolean {
    return /\b(respiratory distress|dyspnea|cyanosis|arrest|collapse|haemorrhage|hemorrhage|toxin|poison|status epilepticus|anaphylaxis)\b/i.test(text);
}

function collectMatches(text: string, terms: string[]): string[] {
    return terms.filter((term) => text.includes(term)).slice(0, 18);
}

function citationFor(context: UploadedDocumentContext, chunkIndex: number): string {
    return `upload://${context.title}#chunk-${chunkIndex + 1}`;
}
