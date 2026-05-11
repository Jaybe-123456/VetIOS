import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { answerRagQuery, type AnswerRagQueryInput } from '@/lib/agenticRag/service';
import {
    buildUploadedDocumentAnalysisResponse,
    buildUploadedDocumentQuestionResponse,
    loadUploadedDocumentContexts,
    shouldUseDirectDocumentAnalysis,
} from '@/lib/askVetios/documentAnalysis';
import { buildHeuristicResponse } from '@/lib/askVetios/heuristicResponse';
import { buildAskVetiosContractResponse } from '@/lib/askVetios/responseContract';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 30;

const QuerySchema = z.object({
    session_id: z.string().trim().min(1).max(120).optional().nullable(),
    query: z.string().trim().min(1).max(2000),
    upload_ids: z.array(z.string().trim().regex(/^[a-f0-9]{64}$/i)).max(20).default([]),
    source_ids: z.array(z.string().uuid()).max(20).default([]),
    species: z.string().trim().max(80).optional().nullable(),
    domain: z.string().trim().max(160).optional().nullable(),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000, maxBodySize: 64 * 1024 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        return withHeaders(NextResponse.json({ error: parsedJson.error, request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const parsed = QuerySchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        return withHeaders(NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const queryId = randomUUID();
    if (parsed.data.upload_ids.length > 0) {
        const contexts = await loadUploadedDocumentContexts({
            client: getSupabaseServer(),
            uploadIds: parsed.data.upload_ids,
        });
        if (contexts.length > 0) {
            const response = shouldUseDirectDocumentAnalysis(parsed.data.query, parsed.data.upload_ids)
                ? buildUploadedDocumentAnalysisResponse({
                    contexts,
                    sessionId: parsed.data.session_id ?? null,
                    queryId,
                    startedAt: startTime,
                })
                : buildUploadedDocumentQuestionResponse({
                    contexts,
                    query: parsed.data.query,
                    sessionId: parsed.data.session_id ?? null,
                    queryId,
                    startedAt: startTime,
                });
            return withHeaders(NextResponse.json({ ...response, request_id: requestId }), requestId, startTime);
        }

        return withHeaders(NextResponse.json({
            error: 'uploaded_document_not_indexed',
            reason: 'The uploaded file was validated, but no indexed document chunks are available for this upload ID yet. Re-upload the document or wait for indexing to finish before asking document-specific questions.',
            request_id: requestId,
        }, { status: 409 }), requestId, startTime);
    }

    const heuristic = buildHeuristicResponse(parsed.data.query);
    const sourceIds = await resolveQuerySourceIds(parsed.data.source_ids, parsed.data.upload_ids);
    const rag = await resolveQueryRag({
        question: parsed.data.query,
        sourceIds,
        species: parsed.data.species,
        domain: parsed.data.domain,
    });

    const response = buildAskVetiosContractResponse({
        sessionId: parsed.data.session_id ?? null,
        queryId,
        query: parsed.data.query,
        heuristic,
        rag,
        startedAt: startTime,
    });

    return withHeaders(NextResponse.json({ ...response, request_id: requestId }), requestId, startTime);
}

async function resolveQueryRag(input: {
    question: string;
    sourceIds: string[];
    species?: string | null;
    domain?: string | null;
}): Promise<Awaited<ReturnType<typeof answerRagQuery>> | null> {
    try {
        return await Promise.race([
            answerRagQuery({
                tenantId: process.env.VETIOS_PUBLIC_RAG_TENANT_ID || 'public',
                actorKind: 'ask_vetios_query',
                client: getSupabaseServer(),
                question: input.question,
                sourceIds: input.sourceIds,
                species: input.species,
                domain: input.domain,
                limit: 8,
            } satisfies AnswerRagQueryInput),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AGENTIC_RAG_TIMEOUT')), 1_500)),
        ]);
    } catch {
        return null;
    }
}

async function resolveQuerySourceIds(sourceIds: string[], uploadIds: string[]): Promise<string[]> {
    const direct = new Set(sourceIds);
    if (uploadIds.length === 0) return [...direct];

    try {
        const { data, error } = await getSupabaseServer()
            .from('upload_hashes')
            .select('rag_source_id')
            .in('content_hash', uploadIds);
        if (error) return [...direct];
        for (const row of data ?? []) {
            const sourceId = typeof row.rag_source_id === 'string' ? row.rag_source_id : null;
            if (sourceId) direct.add(sourceId);
        }
    } catch {
        return [...direct];
    }

    return [...direct];
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
