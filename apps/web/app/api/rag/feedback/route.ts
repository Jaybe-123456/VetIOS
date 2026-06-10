import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordRagCitationFeedback } from '@/lib/agenticRag/feedback';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CitationSchema = z.object({
    index: z.number().int().min(1).max(50),
    title: z.string().trim().max(220).optional().nullable(),
    source_name: z.string().trim().max(160).optional().nullable(),
    url: z.string().trim().max(500).optional().nullable(),
});

const FeedbackSchema = z.object({
    query_id: z.string().uuid(),
    feedback_kind: z.enum(['answer_useful', 'answer_not_useful', 'citation_useful', 'citation_not_useful', 'needs_review']),
    citation_indexes: z.array(z.number().int().min(1).max(50)).max(20).default([]),
    citations: z.array(CitationSchema).max(20).default([]),
    grounded: z.boolean().optional().nullable(),
    clinical_use_case: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000, maxBodySize: 48 * 1024, selfProtection: true });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['rag:read'] });
    if (auth.error || !auth.actor) {
        return withHeaders(NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }), requestId, startTime);
    }

    const json = await safeJson(req);
    if (!json.ok) {
        return withHeaders(NextResponse.json({ error: json.error, request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const parsed = FeedbackSchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    try {
        const result = await recordRagCitationFeedback(supabase, {
            tenantId: auth.actor.tenantId,
            actorKind: auth.actor.authMode,
            queryId: parsed.data.query_id,
            feedbackKind: parsed.data.feedback_kind,
            citationIndexes: parsed.data.citation_indexes,
            citations: parsed.data.citations,
            grounded: parsed.data.grounded,
            clinicalUseCase: parsed.data.clinical_use_case,
            notes: parsed.data.notes,
            metadata: {
                request_id: requestId,
                origin: 'agentic_rag_console',
            },
        });

        return withHeaders(NextResponse.json({ ...result, request_id: requestId }), requestId, startTime);
    } catch (error) {
        return withHeaders(NextResponse.json({
            error: 'rag_feedback_failed',
            detail: error instanceof Error ? error.message : 'Failed to store RAG feedback.',
            request_id: requestId,
        }, { status: 500 }), requestId, startTime);
    }
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
