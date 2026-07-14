import { NextResponse } from 'next/server';
import { enforceVetiosHighRiskRouteGate } from '@/lib/auth/authTrustRouteGate';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { createPartnerBillingPortalSession } from '@/lib/billing/stripe-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const requestId = crypto.randomUUID();
    const access = await resolveDeveloperRouteAccess({
        request,
        requestId,
        allowApiKey: false,
    });

    if (access.response) {
        return access.response;
    }
    if (!access.access.context) {
        return NextResponse.json({ error: 'Session authorization context required.', request_id: requestId }, { status: 401 });
    }

    const trustGate = await enforceVetiosHighRiskRouteGate({
        client: access.access.client,
        requestId,
        context: access.access.context,
        actionKey: 'billing.owner.update',
        resource: {
            type: 'developer_billing_portal',
            id: access.access.partner.id,
            tenantId: access.access.context.tenantId,
        },
        evidence: {
            route: 'api/developer/billing/portal',
            partner_id: access.access.partner.id,
        },
    });
    if (!trustGate.ok) {
        return trustGate.response;
    }

    const returnUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.vetios.tech'}/developer/billing`;
    const url = await createPartnerBillingPortalSession({
        partnerId: access.access.partner.id,
        returnUrl,
    });

    return NextResponse.json({ url });
}
