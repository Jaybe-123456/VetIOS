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
        const chunkText = sanitizeIndexedChunkText(String(chunk.chunk_text ?? ''));
        if (!chunkText) continue;
        list.push({
            chunk_index: Number(chunk.chunk_index ?? list.length),
            chunk_text: chunkText,
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
    const shouldInferCase = shouldBuildClinicalCaseReasoning('', combinedText, signals);
    const differentials = shouldInferCase
        ? inferDocumentDifferentials(combinedText, selected.map(({ context, chunk }) => citationFor(context, chunk.chunk_index)))
        : [];
    const emergency = hasEmergencySignal(combinedText);
    const clinicalSigns = [...new Set(signals.findings)];

    return {
        session_id: input.sessionId ?? 'sessionless',
        query_id: input.queryId,
        narrative: buildNarrative(input.contexts, selected, signals, emergency, allChunks.length > selected.length),
        differentials,
        recommended_diagnostics: shouldInferCase ? buildDocumentDiagnosticGaps(combinedText) : [],
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
        clinical_signs: clinicalSigns,
        document_tables: buildDocumentTables(input.contexts, signals, differentials),
    };
}

export function buildUploadedDocumentQuestionResponse(input: {
    contexts: UploadedDocumentContext[];
    query: string;
    sessionId: string | null;
    queryId: string;
    startedAt: number;
}): AskVetiosContractResponse {
    const selected = selectRelevantUploadedChunks(input.contexts, input.query, 8);
    const combinedText = selected.map(({ chunk }) => chunk.chunk_text).join('\n\n');
    const signals = extractClinicalSignals(combinedText);
    const shouldInferCase = shouldBuildClinicalCaseReasoning(input.query, combinedText, signals);
    const differentials = shouldInferCase
        ? inferDocumentDifferentials(combinedText, selected.map(({ context, chunk }) => citationFor(context, chunk.chunk_index)))
        : [];
    const emergency = hasEmergencySignal(combinedText);

    return {
        session_id: input.sessionId ?? 'sessionless',
        query_id: input.queryId,
        narrative: buildQuestionNarrative(input.query, selected, signals, emergency),
        differentials,
        recommended_diagnostics: shouldInferCase ? buildDocumentDiagnosticGaps(combinedText) : [],
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
        model_version: 'ask-vetios-v2-uploaded-document-question',
        clinical_signs: [...new Set(signals.findings)],
        document_tables: buildDocumentTables(input.contexts, signals, differentials),
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

function buildQuestionNarrative(
    query: string,
    selected: Array<{ context: UploadedDocumentContext; chunk: UploadedDocumentContext['chunks'][number]; score: number }>,
    signals: ReturnType<typeof extractClinicalSignals>,
    emergency: boolean,
): string {
    const lines: string[] = [
        emergency
            ? 'EMERGENCY FLAG DETECTED: the uploaded document contains time-critical language in the retrieved evidence. Immediate clinician review is required.'
            : 'Uploaded document question answered from indexed source chunks.',
        '',
        `Question: ${query}`,
        '',
        'Answer synthesis:',
        ...buildExtractiveAnswerBullets(query, selected),
        '',
        'Best matching uploaded evidence:',
    ];

    for (const { context, chunk } of selected) {
        lines.push(
            '',
            `Chunk ${chunk.chunk_index + 1} - ${chunk.heading ?? context.title}`,
            trimChunkForAnswer(chunk.chunk_text),
            `Source: ${citationFor(context, chunk.chunk_index)}`,
        );
    }

    lines.push(
        '',
        'Extracted clinical signals from retrieved evidence:',
        `- Species/signalment mentions: ${signals.signalment.join('; ') || 'not explicitly detected in retrieved text'}`,
        `- Clinical signs/findings: ${signals.findings.join('; ') || 'not explicitly detected in retrieved text'}`,
        `- Diagnostic/lab/imaging mentions: ${signals.diagnostics.join('; ') || 'not explicitly detected in retrieved text'}`,
        `- Treatment/outcome mentions: ${signals.treatments.join('; ') || 'not explicitly detected in retrieved text'}`,
        '',
        'Reasoning boundary:',
        '- This answer is extractive and limited to the uploaded document chunks shown above.',
        '- If a requested fact is not visible in the cited chunks, treat it as not found in the indexed document, not as clinically absent.',
    );

    return lines.join('\n');
}

function selectRelevantUploadedChunks(
    contexts: UploadedDocumentContext[],
    query: string,
    limit: number,
): Array<{ context: UploadedDocumentContext; chunk: UploadedDocumentContext['chunks'][number]; score: number }> {
    const terms = tokenizeQuery(query);
    const candidates = contexts.flatMap((context) => (
        context.chunks.map((chunk) => {
            const haystack = `${chunk.heading ?? ''} ${chunk.chunk_text}`.toLowerCase();
            const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
            return { context, chunk, score };
        })
    ));

    const ranked = candidates
        .sort((left, right) => right.score - left.score || left.chunk.chunk_index - right.chunk.chunk_index)
        .slice(0, limit);

    return ranked.some((entry) => entry.score > 0)
        ? ranked
        : candidates.slice(0, limit);
}

function tokenizeQuery(query: string): string[] {
    const stopWords = new Set([
        'about', 'after', 'again', 'also', 'and', 'any', 'are', 'ask', 'can', 'could',
        'did', 'does', 'for', 'from', 'give', 'has', 'have', 'how', 'into', 'the',
        'this', 'that', 'was', 'what', 'when', 'where', 'which', 'with', 'you',
    ]);
    return [...new Set(query.toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3 && !stopWords.has(term)))]
        .slice(0, 24);
}

function trimChunkForAnswer(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized;
}

function buildExtractiveAnswerBullets(
    query: string,
    selected: Array<{ context: UploadedDocumentContext; chunk: UploadedDocumentContext['chunks'][number]; score: number }>,
): string[] {
    const terms = tokenizeQuery(query);
    const scored = selected.flatMap(({ context, chunk }) => (
        splitSentences(chunk.chunk_text).map((sentence) => {
            const lower = sentence.toLowerCase();
            const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
            return {
                sentence,
                citation: citationFor(context, chunk.chunk_index),
                score,
                chunkIndex: chunk.chunk_index,
            };
        })
    ));

    const ranked = scored
        .filter((entry) => entry.sentence.length >= 32)
        .sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex)
        .slice(0, 6);

    if (ranked.length === 0) {
        return ['- No readable topic-specific sentence was available in the retrieved chunks.'];
    }

    return ranked.map((entry) => `- ${entry.sentence} Source: ${entry.citation}`);
}

function splitSentences(text: string): string[] {
    return text
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+|(?:\n+)/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
}

function shouldBuildClinicalCaseReasoning(
    query: string,
    text: string,
    signals: ReturnType<typeof extractClinicalSignals>,
): boolean {
    const queryAsksForCaseReasoning = /\b(differential|diagnos|diagnostic|diagnostics|clinical case|patient|presenting|symptom|sign|lab|imaging|treatment|prognosis|emergency|rule[- ]?out)\b/i.test(query);
    const hasCaseLanguage = /\b(patient|case|signalment|presenting|history|physical exam|vitals?|lab results?|diagnostic results?)\b/i.test(text);
    const hasClinicalEvidence = signals.findings.length > 0 || signals.diagnostics.length > 1;

    return hasClinicalEvidence && (queryAsksForCaseReasoning || hasCaseLanguage);
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
            'collapse', 'abdominal pain', 'dehydration', 'jaundice', 'icterus', 'tachypnea',
            'weight loss', 'pale mucous membranes', 'pale gums', 'polyuria', 'polydipsia',
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

function sanitizeIndexedChunkText(text: string): string {
    const normalized = text.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
    if (!normalized || isPdfStructuralNoise(normalized)) return '';
    return normalized;
}

function isPdfStructuralNoise(text: string): boolean {
    if (/^%?PDF-|^\/Linearized\b/i.test(text)) return true;

    const words = text.match(/\b[A-Za-z][A-Za-z'-]{2,}\b/g) ?? [];
    if (words.length < 8) return text.length > 0;

    const syntaxMatches = text.match(/\b(?:obj|endobj|xref|startxref|stream|endstream|FlateDecode|Linearized|XRef|Catalog)\b|\/(?:Type|Filter|Length|Root|Size|Prev|Info|Pages|Resources|ObjStm)\b/g) ?? [];
    return syntaxMatches.length / Math.max(words.length, 1) > 0.08;
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

function buildDocumentTables(
    contexts: UploadedDocumentContext[],
    signals: ReturnType<typeof extractClinicalSignals>,
    differentials: AskVetiosContractResponse['differentials'],
): AskVetiosContractResponse['document_tables'] {
    return [
        {
            title: 'Source Inventory',
            columns: ['Document', 'Chunks', 'Source'],
            rows: contexts.map((context) => [
                context.title,
                String(context.chunks.length),
                context.source_name,
            ]),
        },
        {
            title: 'Extracted Clinical Signals',
            columns: ['Category', 'Detected Values'],
            rows: [
                ['Species / signalment', signals.signalment.join(', ') || 'Not detected'],
                ['Clinical signs / findings', signals.findings.join(', ') || 'Not detected'],
                ['Diagnostics / labs / imaging', signals.diagnostics.join(', ') || 'Not detected'],
                ['Treatments / outcomes', signals.treatments.join(', ') || 'Not detected'],
            ],
        },
        {
            title: 'Differential Reasoning',
            columns: ['Rank', 'Differential', 'Confidence', 'Evidence'],
            rows: differentials.map((entry) => [
                String(entry.rank),
                entry.diagnosis,
                `${Math.round(entry.confidence * 100)}%`,
                entry.supporting_evidence.join('; '),
            ]),
        },
    ].filter((table) => table.rows.length > 0);
}
