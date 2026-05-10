import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { answerRagQuery } from '@/lib/agenticRag/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const QuerySchema = z.object({
    question: z.string().trim().min(1).max(2000),
    source_ids: z.array(z.string().uuid()).max(20).default([]),
    species: z.string().trim().max(80).optional().nullable(),
    domain: z.string().trim().max(80).optional().nullable(),
    strategy: z.enum(['hybrid', 'vector', 'lexical', 'clinical_guideline', 'drug_safety', 'lab_reference']).optional().nullable(),
    limit: z.number().int().min(1).max(8).default(6),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000, maxBodySize: 64 * 1024, selfProtection: true });
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

    const parsed = QuerySchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    try {
        const result = await answerRagQuery({
            tenantId: auth.actor.tenantId,
            actorKind: auth.actor.authMode,
            client: supabase,
            question: parsed.data.question,
            sourceIds: parsed.data.source_ids,
            species: parsed.data.species,
            domain: parsed.data.domain,
            strategy: parsed.data.strategy,
            limit: parsed.data.limit,
        });

        return withHeaders(NextResponse.json({ ...result, request_id: requestId }), requestId, startTime);
    } catch (error) {
        return withHeaders(NextResponse.json({
            error: 'rag_query_failed',
            detail: error instanceof Error ? error.message : 'Unknown RAG query failure',
            request_id: requestId,
        }, { status: 500 }), requestId, startTime);
    }
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
