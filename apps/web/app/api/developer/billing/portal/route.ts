import { NextResponse } from 'next/server';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { createPartnerBillingPortalSession } from '@/lib/billing/stripe-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const access = await resolveDeveloperRouteAccess({
        request,
        requestId: crypto.randomUUID(),
        allowApiKey: false,
    });

    if (access.response) {
        return access.response;
    }

    const returnUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.vetios.tech'}/developer/billing`;
    const url = await createPartnerBillingPortalSession({
        partnerId: access.access.partner.id,
        returnUrl,
    });

    return NextResponse.json({ url });
}
