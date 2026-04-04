import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { runPartnerV1Route } from '@/lib/api/v1-route';
import { getQuotaUsageForPartner } from '@/lib/api/partner-service';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    return runPartnerV1Route(request, {
        endpoint: '/v1/usage/quota',
        aggregateType: 'usage',
        isBillable: false,
        handler: async (auth) => {
            const quota = await getQuotaUsageForPartner(getSupabaseServer(), auth.partner.id);
            return NextResponse.json(quota);
        },
    });
}
