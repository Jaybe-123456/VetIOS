import { NextResponse } from 'next/server';
import {
    getAiProviderApiKey,
    getAiProviderBaseUrl,
} from '@/lib/ai/config';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 2_500;
const AI_TIMEOUT_MS = 1_500;

export async function GET() {
    const startedAt = Date.now();
    const [db, aiProvider] = await Promise.all([
        checkDatabase(),
        checkAiProviderConnectivity(),
    ]);

    return NextResponse.json({
        status: db.ok && aiProvider.ok ? 'ok' : 'degraded',
        db: db.ok ? 'ok' : 'degraded',
        ai_provider: aiProvider.ok ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - startedAt,
        db_latency_ms: db.latencyMs,
        ai_provider_latency_ms: aiProvider.latencyMs,
    });
}

async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number | null }> {
    const startedAt = Date.now();

    try {
        const supabase = getSupabaseServer();
        const result = await Promise.race([
            supabase
                .from('ai_inference_events')
                .select('id', { head: true, count: 'exact' })
                .limit(1)
                .then(({ error }) => ({ ok: !error })),
            new Promise<{ ok: false }>((resolve) => {
                setTimeout(() => resolve({ ok: false }), DB_TIMEOUT_MS);
            }),
        ]);

        return {
            ok: result.ok,
            latencyMs: Date.now() - startedAt,
        };
    } catch {
        return {
            ok: false,
            latencyMs: Date.now() - startedAt,
        };
    }
}

async function checkAiProviderConnectivity(): Promise<{ ok: boolean; latencyMs: number | null }> {
    const startedAt = Date.now();

    if (process.env.VETIOS_DEV_BYPASS === 'true' || process.env.VETIOS_LOCAL_REASONER === 'true') {
        return { ok: true, latencyMs: Date.now() - startedAt };
    }

    let apiKey: string;
    try {
        apiKey = getAiProviderApiKey();
    } catch {
        return { ok: false, latencyMs: Date.now() - startedAt };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
        const response = await fetch(`${getAiProviderBaseUrl().replace(/\/+$/, '')}/models`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
            signal: controller.signal,
            cache: 'no-store',
        });

        return {
            ok: response.ok,
            latencyMs: Date.now() - startedAt,
        };
    } catch {
        return {
            ok: false,
            latencyMs: Date.now() - startedAt,
        };
    } finally {
        clearTimeout(timeout);
    }
}
