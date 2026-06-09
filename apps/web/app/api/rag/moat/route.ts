import { NextResponse } from 'next/server';
import { evaluateRagReadiness } from '@/lib/agenticRag/automation';
import {
    buildLiveAgenticRagMoatSnapshot,
    loadLatestAgenticRagMoatSnapshot,
    persistAgenticRagMoatSnapshot,
} from '@/lib/agenticRag/moatSnapshot';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000, selfProtection: true });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['rag:read'] });
    if (auth.error || !auth.actor) {
        return withHeaders(NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }), requestId, startTime);
    }

    try {
        const readiness = await evaluateRagReadiness(supabase, auth.actor.tenantId);
        const [latest_snapshot, live_snapshot] = await Promise.all([
            loadLatestAgenticRagMoatSnapshot(supabase, auth.actor.tenantId),
            buildLiveAgenticRagMoatSnapshot({
                client: supabase,
                tenantId: auth.actor.tenantId,
                readiness,
            }),
        ]);

        return withHeaders(NextResponse.json({
            readiness,
            live_snapshot,
            latest_snapshot,
            request_id: requestId,
        }), requestId, startTime);
    } catch (error) {
        return withHeaders(NextResponse.json({
            error: 'agentic_rag_moat_failed',
            detail: error instanceof Error ? error.message : 'Unknown Agentic RAG moat failure',
            request_id: requestId,
        }, { status: 500 }), requestId, startTime);
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 12, windowMs: 60_000, maxBodySize: 8 * 1024, selfProtection: true });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['rag:write'] });
    if (auth.error || !auth.actor) {
        return withHeaders(NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }), requestId, startTime);
    }

    try {
        const readiness = await evaluateRagReadiness(supabase, auth.actor.tenantId);
        const result = await persistAgenticRagMoatSnapshot(supabase, {
            tenantId: auth.actor.tenantId,
            readiness,
        });

        return withHeaders(NextResponse.json({
            ...result,
            readiness,
            request_id: requestId,
        }), requestId, startTime);
    } catch (error) {
        return withHeaders(NextResponse.json({
            error: 'agentic_rag_moat_persist_failed',
            detail: error instanceof Error ? error.message : 'Unknown Agentic RAG moat persistence failure',
            request_id: requestId,
        }, { status: 500 }), requestId, startTime);
    }
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
