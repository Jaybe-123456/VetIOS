import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getPopulationSignalService } from '@/lib/populationSignal/populationSignalService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const ERROR_CACHE_CONTROL = 'no-store';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    try {
        const url = new URL(req.url);
        const region = url.searchParams.get('region') ?? undefined;
        const limitRaw = Number(url.searchParams.get('limit') ?? 20);
        const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

        const feed = await getPopulationSignalService().getPublicPopulationIntelligence({
            region,
            limit,
        });

        const response = NextResponse.json({
            feed,
            privacy: {
                boundary: 'aggregate_only',
                excludes: ['tenant_ids', 'clinic_identifiers', 'patient_identifiers', 'owner_identifiers', 'inference_event_ids'],
                minimum_clinics: feed.minimumClinics,
            },
            meta: {
                timestamp: new Date().toISOString(),
                request_id: requestId,
            },
        });
        withRequestHeaders(response.headers, requestId, startTime);
        response.headers.set('Cache-Control', CACHE_CONTROL);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unable to load population intelligence feed.' },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        response.headers.set('Cache-Control', ERROR_CACHE_CONTROL);
        return response;
    }
}
