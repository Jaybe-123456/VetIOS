import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/http/safeJson';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { getPartnerPlanById, updatePartnerPlan } from '@/lib/api/partner-service';
import { createPartnerSubscription, upgradePartnerPlan } from '@/lib/billing/stripe-service';

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

    const parsed = await safeJson<{ planId?: string }>(request);
    if (!parsed.ok || !parsed.data.planId) {
        return NextResponse.json({ error: 'planId is required.' }, { status: 400 });
    }

    const plan = await getPartnerPlanById(access.access.client, parsed.data.planId);
    if (!plan) {
        return NextResponse.json({ error: 'Requested plan was not found.' }, { status: 404 });
    }

    if (plan.name === 'enterprise') {
        await updatePartnerPlan(access.access.client, access.access.partner.id, plan.id);
        return NextResponse.json({ upgraded: false, contact_sales: true, plan });
    }

    if (access.access.partner.stripeSubscriptionId) {
        await upgradePartnerPlan({
            partnerId: access.access.partner.id,
            newPlanId: plan.id,
        });
    } else {
        await createPartnerSubscription({
            partnerId: access.access.partner.id,
            planId: plan.id,
        });
    }

    return NextResponse.json({ upgraded: true, plan });
}
