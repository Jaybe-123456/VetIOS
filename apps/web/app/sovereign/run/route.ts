import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { safeJson } from '@/lib/http/safeJson';
import { requireSovereignClient, startSovereignRun } from '@/lib/sovereign/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const supabase = getSupabaseServer();

    try {
        const sovereignClient = await requireSovereignClient(supabase, req);
        const parsed = await safeJson<{
            registration_id: string;
            m_steps?: number;
            samples_per_step?: number;
            perturbation_mix?: {
                noise_weight?: number;
                incompleteness_weight?: number;
                contradiction_weight?: number;
            };
            include_hysteresis_test?: boolean;
        }>(req);

        if (!parsed.ok) {
            return NextResponse.json({
                data: null,
                meta: {
                    tenant_id: null,
                    timestamp: new Date().toISOString(),
                },
                error: {
                    code: 'invalid_body',
                    message: parsed.error,
                },
            }, { status: 400 });
        }

        const run = await startSovereignRun(supabase, sovereignClient, parsed.data);
        return NextResponse.json({
            data: run,
            meta: {
                tenant_id: null,
                timestamp: new Date().toISOString(),
                simulation_id: run.run_id,
            },
            error: null,
        }, { status: 202 });
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
                code: typeof (error as { code?: string })?.code === 'string' ? (error as { code: string }).code : 'sovereign_run_failed',
                message: error instanceof Error ? error.message : 'Failed to start Sovereign run.',
            },
        }, { status });
    }
}
