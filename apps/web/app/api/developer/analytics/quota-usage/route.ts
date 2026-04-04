import { NextResponse } from 'next/server';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { getQuotaUsageForPartner } from '@/lib/api/partner-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const partnerId = url.searchParams.get('partner_id');
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

    const quota = await getQuotaUsageForPartner(access.access.client, access.access.partner.id);
    return NextResponse.json({
        ...quota,
        status: access.access.partner.status,
        renewal_date: access.access.partner.currentPeriodEnd?.toISOString() ?? quota.period_end,
        display_name: access.access.partner.plan?.displayName ?? quota.plan,
        flat_monthly_usd: access.access.partner.plan?.flatMonthlyUsd ?? 0,
        price_per_1k_requests: access.access.partner.plan?.pricePer1kRequests ?? 0,
    });
}
