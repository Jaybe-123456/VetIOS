import { getSupabaseServer } from '@/lib/supabaseServer';
import { buildSovereignReportPdf, getSovereignRun, requireSovereignClient } from '@/lib/sovereign/service';

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
        const pdf = buildSovereignReportPdf(run);

        return new Response(pdf, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="sovereign-run-${run.id}.pdf"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Failed to generate report.', {
            status: typeof (error as { status?: number })?.status === 'number'
                ? (error as { status: number }).status
                : 500,
        });
    }
}
