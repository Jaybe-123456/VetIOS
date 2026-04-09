import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getSovereignBenchmark, requireSovereignClient } from '@/lib/sovereign/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const supabase = getSupabaseServer();

    try {
        const sovereignClient = await requireSovereignClient(supabase, req);
        const url = new URL(req.url);
        const systemType = url.searchParams.get('system_type');
        const benchmark = await getSovereignBenchmark(
            supabase,
            sovereignClient,
            systemType === 'llm' || systemType === 'classifier' || systemType === 'diagnostic' || systemType === 'custom'
                ? systemType
                : null,
        );

        return NextResponse.json({
            data: benchmark,
            meta: {
                tenant_id: null,
                timestamp: new Date().toISOString(),
            },
            error: null,
        });
    } catch (error) {
        const status = typeof (error as { status?: number })?.status === 'number'
            ? (error as { status: number }).status
            : 500;
        return NextResponse.json({
            data: null,
            meta: {
                tenant_id: null,
                timestamp: new Date().toISOString(),
            },
            error: {
                code: typeof (error as { code?: string })?.code === 'string' ? (error as { code: string }).code : 'sovereign_benchmark_failed',
                message: error instanceof Error ? error.message : 'Failed to load Sovereign benchmark.',
            },
        }, { status });
    }
}
