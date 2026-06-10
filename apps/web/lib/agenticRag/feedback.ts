import type { SupabaseClient } from '@supabase/supabase-js';
import { contentHash } from './chunking';

export type RagCitationFeedbackKind =
    | 'answer_useful'
    | 'answer_not_useful'
    | 'citation_useful'
    | 'citation_not_useful'
    | 'needs_review';

export interface RagCitationFeedbackCitation {
    index: number;
    title?: string | null;
    source_name?: string | null;
    url?: string | null;
}

export interface RecordRagCitationFeedbackInput {
    tenantId: string;
    actorKind: string;
    queryId: string;
    feedbackKind: RagCitationFeedbackKind;
    citationIndexes?: number[];
    citations?: RagCitationFeedbackCitation[];
    grounded?: boolean | null;
    clinicalUseCase?: string | null;
    notes?: string | null;
    metadata?: Record<string, unknown>;
}

export interface RecordRagCitationFeedbackResult {
    feedback_id: string | null;
    stored: boolean;
    warning: string | null;
}

export async function recordRagCitationFeedback(
    client: SupabaseClient,
    input: RecordRagCitationFeedbackInput,
): Promise<RecordRagCitationFeedbackResult> {
    const citations = (input.citations ?? []).slice(0, 20);
    const citationIndexes = normalizeCitationIndexes(input.citationIndexes, citations);
    const notesHash = input.notes?.trim() ? contentHash(input.notes.trim()) : null;
    const row = {
        tenant_id: input.tenantId,
        query_id: input.queryId,
        actor_kind: input.actorKind,
        feedback_kind: input.feedbackKind,
        citation_indexes: citationIndexes,
        citation_source_names: compactStrings(citations.map((citation) => truncate(citation.source_name, 160))),
        citation_titles: compactStrings(citations.map((citation) => truncate(citation.title, 220))),
        citation_urls: compactStrings(citations.map((citation) => truncate(citation.url, 500))),
        grounded: input.grounded,
        clinical_use_case: truncate(input.clinicalUseCase, 120),
        notes_hash: notesHash,
        metadata: {
            ...(input.metadata ?? {}),
            raw_notes_stored: false,
            raw_citation_quotes_stored: false,
        },
    };

    const { data, error } = await client
        .from('rag_citation_feedback_events')
        .insert(row)
        .select('id')
        .single();

    if (error) {
        if (isMissingFeedbackTable(error)) {
            return {
                feedback_id: null,
                stored: false,
                warning: 'rag_citation_feedback_events table is not available; apply supabase/migrations/20260610000000_agentic_rag_citation_feedback.sql to persist citation usefulness signals.',
            };
        }
        throw new Error(`Failed to store RAG citation feedback: ${error.message}`);
    }

    const feedbackId = typeof (data as Record<string, unknown> | null)?.id === 'string'
        ? String((data as Record<string, unknown>).id)
        : null;
    return { feedback_id: feedbackId, stored: true, warning: null };
}

function normalizeCitationIndexes(indexes: number[] | undefined, citations: RagCitationFeedbackCitation[]): number[] {
    const values = indexes && indexes.length > 0
        ? indexes
        : citations.map((citation) => citation.index);
    return Array.from(new Set(values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0 && value <= 50)))
        .slice(0, 20);
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength);
}

function compactStrings(values: Array<string | null>): string[] {
    return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function isMissingFeedbackTable(error: { code?: string; message?: string }): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return error.code === '42P01'
        || error.code === 'PGRST116'
        || message.includes('rag_citation_feedback_events')
        || message.includes('schema cache');
}
