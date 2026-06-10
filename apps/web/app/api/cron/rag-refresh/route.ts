import { NextResponse } from 'next/server';
import { refreshCuratedRagCatalog } from '@/lib/agenticRag/automation';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
    return runRagRefresh(req);
}

export async function POST(req: Request) {
    return runRagRefresh(req);
}

async function runRagRefresh(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 4, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const cronAuth = authorizeCron(req);
    if (!cronAuth.ok) {
        return withHeaders(NextResponse.json({ error: cronAuth.error, request_id: requestId }, { status: cronAuth.status }), requestId, startTime);
    }

    const supabase = getSupabaseServer();
    const tenantId = resolveRagTenant(req);
    const refreshOptions = resolveRefreshOptions(req);
    const result = await refreshCuratedRagCatalog({
        client: supabase,
        tenantId,
        actorLabel: 'vetios_rag_refresh_cron',
        onlyDue: true,
        batchSize: refreshOptions.batchSize,
        cursor: refreshOptions.cursor,
        remoteMode: refreshOptions.remoteMode,
    });

    return withHeaders(NextResponse.json({ tenant_id: tenantId, ...result, request_id: requestId }, {
        status: result.errors.length > 0 ? 207 : 200,
    }), requestId, startTime);
}

function authorizeCron(req: Request): { ok: true } | { ok: false; status: number; error: string } {
    const expected = process.env.VETIOS_CRON_SECRET
        ?? process.env.CRON_SECRET
        ?? process.env.VETIOS_INTERNAL_API_TOKEN
        ?? null;

    if (!expected && process.env.NODE_ENV !== 'production') {
        return { ok: true };
    }
    if (!expected) {
        return { ok: false, status: 503, error: 'cron_secret_not_configured' };
    }

    const authorization = req.headers.get('authorization') ?? '';
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
    const headerSecret = req.headers.get('x-vetios-cron-secret')?.trim() ?? null;
    if (bearer === expected || headerSecret === expected) {
        return { ok: true };
    }
    return { ok: false, status: 401, error: 'unauthorized_cron' };
}

function resolveRagTenant(req: Request): string {
    const headerTenant = req.headers.get('x-vetios-tenant-id')?.trim();
    return headerTenant
        || process.env.VETIOS_PUBLIC_RAG_TENANT_ID
        || process.env.VETIOS_DEV_TENANT_ID
        || 'public';
}

function resolveRefreshOptions(req: Request): {
    batchSize: number;
    cursor: string | null;
    remoteMode: 'summaries_only' | 'full_remote';
} {
    const url = new URL(req.url);
    const requestedBatchSize = Number(url.searchParams.get('batch_size') ?? 6);
    const remoteMode = url.searchParams.get('remote_mode') === 'full_remote'
        ? 'full_remote'
        : 'summaries_only';

    return {
        batchSize: Number.isFinite(requestedBatchSize)
            ? Math.min(Math.max(Math.floor(requestedBatchSize), 1), 8)
            : 6,
        cursor: url.searchParams.get('cursor')?.trim() || null,
        remoteMode,
    };
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
