import { NextResponse } from 'next/server';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { getUsageSummaryForPartner } from '@/lib/api/partner-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const partnerId = url.searchParams.get('partner_id');
    const days = Number(url.searchParams.get('days') ?? '30');
    const access = await resolveDeveloperRouteAccess({
        request,
        requestId: crypto.randomUUID(),
        allowApiKey: true,
        partnerId,
        requireAdmin: Boolean(partnerId),
    });

    if (access.response) {
        return access.response;
    }

    const overview = await getUsageSummaryForPartner(access.access.client, access.access.partner.id, Number.isFinite(days) ? days : 30);
    return NextResponse.json(overview);
}
