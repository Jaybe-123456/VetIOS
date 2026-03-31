import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { formatZodErrors, TreatmentOutcomeRequestSchema } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { recordTreatmentDecisionAndOutcome } from '@/lib/treatmentIntelligence/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const tenantId = session?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const result = TreatmentOutcomeRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json({ error: formatZodErrors(result.error), request_id: requestId }, { status: 400 });
    }

    try {
        const record = await recordTreatmentDecisionAndOutcome(getSupabaseServer(), {
            tenantId,
            body: result.data,
        });

        revalidatePath('/inference');
        revalidatePath('/telemetry');

        const response = NextResponse.json({
            request_id: requestId,
            ...record,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] POST /api/treatment/outcome error:`, error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to log treatment outcome.', request_id: requestId },
            { status: 500 },
        );
    }
}
