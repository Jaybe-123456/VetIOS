import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { getSovereignRun, requireSovereignClient } from '@/lib/sovereign/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const params = await context.params;
    const supabase = getSupabaseServer();

    try {
        const sovereignClient = await requireSovereignClient(supabase, req);
        const run = await getSovereignRun(supabase, sovereignClient, params.id);
        return NextResponse.json({
            data: run.sentinel_config ?? {},
            meta: {
                tenant_id: null,
                timestamp: new Date().toISOString(),
                simulation_id: run.id,
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
                simulation_id: params.id,
            },
            error: {
                code: typeof (error as { code?: string })?.code === 'string' ? (error as { code: string }).code : 'sovereign_sentinel_config_failed',
                message: error instanceof Error ? error.message : 'Failed to load sentinel config.',
            },
        }, { status });
    }
}
