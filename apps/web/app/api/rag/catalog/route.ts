import { NextResponse } from 'next/server';
import { z } from 'zod';
import { evaluateRagReadiness, seedCuratedRagCatalog } from '@/lib/agenticRag/automation';
import { getCuratedRagCatalog } from '@/lib/agenticRag/sourceCatalog';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SeedSchema = z.object({
    force_refresh: z.boolean().default(false),
});

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['rag:read'] });
    if (auth.error || !auth.actor) {
        return withHeaders(NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }), requestId, startTime);
    }

    const readiness = await evaluateRagReadiness(supabase, auth.actor.tenantId);
    return withHeaders(NextResponse.json({
        catalog: getCuratedRagCatalog(),
        readiness,
        request_id: requestId,
    }), requestId, startTime);
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 6, windowMs: 60_000, maxBodySize: 16 * 1024 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['rag:write'] });
    if (auth.error || !auth.actor) {
        return withHeaders(NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }), requestId, startTime);
    }

    const json = await safeJson(req);
    if (!json.ok) {
        return withHeaders(NextResponse.json({ error: json.error, request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const parsed = SeedSchema.safeParse(json.data ?? {});
    if (!parsed.success) {
        return withHeaders(NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const result = await seedCuratedRagCatalog({
        client: supabase,
        tenantId: auth.actor.tenantId,
        actorLabel: auth.actor.principalLabel ?? auth.actor.userId ?? auth.actor.authMode,
        forceRefresh: parsed.data.force_refresh,
    });

    return withHeaders(NextResponse.json({ ...result, request_id: requestId }, { status: result.errors.length > 0 ? 207 : 200 }), requestId, startTime);
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
