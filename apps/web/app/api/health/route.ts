import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 1_000;

export async function GET() {
    const startedAt = Date.now();
    const db = await checkDatabase();
    const aiProvider = checkAiProvider();

    return NextResponse.json({
        status: 'ok',
        db: db.ok ? 'ok' : 'degraded',
        ai_provider: aiProvider ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        latency_ms: Date.now() - startedAt,
        db_latency_ms: db.latencyMs,
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

function checkAiProvider(): boolean {
    return Boolean(
        process.env.AI_PROVIDER_API_KEY
        || process.env.OPENAI_API_KEY
        || process.env.VETIOS_DEV_BYPASS === 'true'
        || process.env.VETIOS_LOCAL_REASONER === 'true',
    );
}
