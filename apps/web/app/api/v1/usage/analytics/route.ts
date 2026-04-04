import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { runPartnerV1Route } from '@/lib/api/v1-route';
import { getUsageSummaryForPartner } from '@/lib/api/partner-service';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const days = Number(url.searchParams.get('days') ?? '30');

    return runPartnerV1Route(request, {
        endpoint: '/v1/usage/analytics',
        aggregateType: 'usage',
        isBillable: false,
        handler: async (auth) => {
            const overview = await getUsageSummaryForPartner(getSupabaseServer(), auth.partner.id, Number.isFinite(days) ? days : 30);
            return NextResponse.json(overview);
        },
    });
}
