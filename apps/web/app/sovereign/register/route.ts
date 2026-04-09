import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { safeJson } from '@/lib/http/safeJson';
import { registerSovereignSystem, requireSovereignClient } from '@/lib/sovereign/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const supabase = getSupabaseServer();

    try {
        const sovereignClient = await requireSovereignClient(supabase, req);
        const parsed = await safeJson<{
            system_name: string;
            system_type: 'llm' | 'classifier' | 'diagnostic' | 'custom';
            inference_endpoint: string;
            auth_header?: string | null;
            input_schema: Record<string, unknown>;
            output_schema: Record<string, unknown>;
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

        const registration = await registerSovereignSystem(supabase, sovereignClient, parsed.data);
        return NextResponse.json({
            data: registration,
            meta: {
                tenant_id: null,
                timestamp: new Date().toISOString(),
            },
            error: null,
        }, { status: 201 });
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
                code: typeof (error as { code?: string })?.code === 'string' ? (error as { code: string }).code : 'sovereign_register_failed',
                message: error instanceof Error ? error.message : 'Failed to register Sovereign system.',
            },
        }, { status });
    }
}
