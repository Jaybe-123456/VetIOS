import { NextResponse } from 'next/server';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { getApiPartnerById, listPartnerUsageEvents } from '@/lib/api/partner-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    const params = await context.params;
    const access = await resolveDeveloperRouteAccess({
        request,
        requestId: crypto.randomUUID(),
        allowApiKey: false,
        requireAdmin: true,
        partnerId: params.id,
    });

    if (access.response) {
        return access.response;
    }

    const partner = await getApiPartnerById(access.access.client, params.id);
    if (!partner) {
        return NextResponse.json({ error: 'Partner not found.' }, { status: 404 });
    }

    const recentUsage = await listPartnerUsageEvents(access.access.client, params.id, { limit: 50, days: 30 });
    return NextResponse.json({ partner, recent_usage: recentUsage });
}
