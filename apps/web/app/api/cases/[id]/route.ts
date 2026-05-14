import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { getClinicalCaseDetail } from '@/lib/cases/caseWorkflow';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const params = await context.params;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase });

    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const clinicalCase = await getClinicalCaseDetail(supabase, auth.actor.tenantId, params.id);
        if (!clinicalCase) {
            return NextResponse.json({ error: 'not_found' }, { status: 404 });
        }

        return NextResponse.json({ case: clinicalCase });
    } catch (error) {
        return NextResponse.json(
            { error: 'case_detail_failed', detail: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
