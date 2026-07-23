import { NextResponse } from 'next/server';
import { GBSClient } from '@vetios/quantum';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const auth = await resolveClinicalApiActor(req, {
        client: getSupabaseServer(),
        requiredScopes: ['evaluation:read'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json(
            { error: auth.error?.message ?? 'Unauthorized', request_id: guard.requestId },
            { status: auth.error?.status ?? 401 },
        );
    }

    const enabled = process.env.QUANTUM_ENABLED === 'true';
    const serviceUrl = process.env.QUANTUM_SERVICE_URL?.trim() ?? null;
    const timeoutMs = readPositiveInt(process.env.QUANTUM_SERVICE_TIMEOUT_MS, 10_000);
    const startedAt = Date.now();

    let available = false;
    if (enabled && serviceUrl) {
        available = await new GBSClient(serviceUrl, timeoutMs).isAvailable();
    }

    return NextResponse.json({
        status: enabled && available ? 'ok' : enabled ? 'degraded' : 'disabled',
        enabled,
        service_url_configured: Boolean(serviceUrl),
        available,
        backend: process.env.QUANTUM_BACKEND ?? 'simulator',
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - startedAt,
    });
}

function readPositiveInt(value: unknown, fallback: number): number {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : fallback;
}
