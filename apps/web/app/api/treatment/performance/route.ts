import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { loadTreatmentPerformance } from '@/lib/treatmentIntelligence/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 40, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const tenantId = session?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const { searchParams } = new URL(req.url);

    try {
        const performance = await loadTreatmentPerformance(getSupabaseServer(), {
            tenantId,
            disease: searchParams.get('disease'),
            pathway: searchParams.get('pathway') as 'gold_standard' | 'resource_constrained' | 'supportive_only' | null,
        });
        const response = NextResponse.json({
            request_id: requestId,
            performance,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] GET /api/treatment/performance error:`, error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to load treatment performance.', request_id: requestId },
            { status: 500 },
        );
    }
}
