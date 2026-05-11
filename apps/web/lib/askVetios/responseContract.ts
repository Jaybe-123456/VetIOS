import type { RagAnswerResult, RagCitation } from '@/lib/agenticRag/types';
import type { AskVetiosHeuristicResponse } from './heuristicResponse';

export interface AskVetiosContractResponse {
    session_id: string;
    query_id: string;
    narrative: string;
    differentials: Array<{
        rank: number;
        diagnosis: string;
        confidence: number;
        supporting_evidence: string[];
        contradicting_evidence: string[];
        source_attribution: string[];
    }>;
    recommended_diagnostics: string[];
    recommended_treatments: string[];
    flags: {
        low_confidence_hypotheses: string[];
        unsourced_priors: string[];
        requires_specialist_review: boolean;
        emergency_flag: boolean;
    };
    rag_chunks_used: number;
    video_segments_referenced: number;
    response_latency_ms: number;
    model_version: string;
}

export function buildAskVetiosContractResponse(input: {
    sessionId: string | null;
    queryId: string;
    query: string;
    heuristic: AskVetiosHeuristicResponse;
    rag: RagAnswerResult | null;
    startedAt: number;
    modelVersion?: string;
}): AskVetiosContractResponse {
    const citations = input.rag?.citations ?? [];
    const citationLabels = citations.map(formatCitationLabel);
    const differentials = buildDifferentials(input.heuristic, citationLabels);
    const emergency = detectEmergencyFlag(input.query, input.heuristic);
    const lowConfidence = differentials
        .filter((entry) => entry.confidence < 0.3)
        .map((entry) => entry.diagnosis);
    const unsourcedPriors = differentials
        .filter((entry) => entry.source_attribution.includes('model_prior'))
        .map((entry) => entry.diagnosis);

    return {
        session_id: input.sessionId ?? 'sessionless',
        query_id: input.rag?.query_id ?? input.queryId,
        narrative: buildNarrative(input.heuristic, input.rag, citations, emergency),
        differentials,
        recommended_diagnostics: input.heuristic.metadata?.recommended_tests ?? [],
        recommended_treatments: [],
        flags: {
            low_confidence_hypotheses: lowConfidence,
            unsourced_priors: unsourcedPriors,
            requires_specialist_review: emergency || unsourcedPriors.length > 0,
            emergency_flag: emergency,
        },
        rag_chunks_used: citations.length,
        video_segments_referenced: 0,
        response_latency_ms: Math.max(1, Date.now() - input.startedAt),
        model_version: input.modelVersion ?? 'ask-vetios-v2-contract',
    };
}

export function detectEmergencyFlag(query: string, heuristic?: AskVetiosHeuristicResponse): boolean {
    const text = [
        query,
        heuristic?.content ?? '',
        ...(heuristic?.metadata?.red_flags ?? []),
    ].join(' ').toLowerCase();

    return /\b(respiratory distress|difficulty breathing|labored breathing|open[- ]mouth breathing|cyanosis|blue gums|arrest|collapse|collapsed|haemorrhage|hemorrhage|haemoperitoneum|hemoabdomen|toxin|poison|status epilepticus|seizure lasting|anaphylaxis|acute allergic)\b/.test(text);
}

function buildNarrative(
    heuristic: AskVetiosHeuristicResponse,
    rag: RagAnswerResult | null,
    citations: RagCitation[],
    emergency: boolean,
): string {
    const parts: string[] = [];
    if (emergency) {
        parts.push('EMERGENCY FLAG DETECTED: This presentation may be time-critical. Initiate immediate veterinary triage and contact an emergency veterinary service now.');
    }
    parts.push(heuristic.content);

    if (rag?.answer && citations.length > 0) {
        parts.push(`Grounded evidence summary:\n${rag.answer}`);
        parts.push(`Sources: ${citations.map(formatInlineCitation).join(' ')}`);
    } else {
        parts.push('Grounding note: no directly matching uploaded or indexed RAG citation was available; clinical hypotheses are labelled as model_prior where applicable.');
    }

    return parts.filter(Boolean).join('\n\n');
}

function buildDifferentials(
    heuristic: AskVetiosHeuristicResponse,
    citationLabels: string[],
): AskVetiosContractResponse['differentials'] {
    const ranked = heuristic.metadata?.diagnosis_ranked ?? [];
    return ranked.slice(0, 7).map((entry, index) => ({
        rank: index + 1,
        diagnosis: entry.name,
        confidence: clampConfidence(entry.confidence),
        supporting_evidence: [entry.reasoning],
        contradicting_evidence: [],
        source_attribution: citationLabels.length > 0 ? citationLabels : ['model_prior'],
    }));
}

function formatInlineCitation(citation: RagCitation): string {
    return `[[Source: ${citation.source_name}, ${citation.title}${citation.year ? `, ${citation.year}` : ''}]]`;
}

function formatCitationLabel(citation: RagCitation): string {
    return `${citation.source_name}::${citation.title}#${citation.index}`;
}

function clampConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(Math.min(1, Math.max(0, value)).toFixed(3));
}
