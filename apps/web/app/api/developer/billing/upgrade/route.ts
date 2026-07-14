import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/http/safeJson';
import { enforceVetiosHighRiskRouteGate } from '@/lib/auth/authTrustRouteGate';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { getPartnerPlanById, updatePartnerPlan } from '@/lib/api/partner-service';
import { createPartnerSubscription, upgradePartnerPlan } from '@/lib/billing/stripe-service';

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

    const parsed = await safeJson<{ planId?: string }>(request);
    if (!parsed.ok || !parsed.data.planId) {
        return NextResponse.json({ error: 'planId is required.' }, { status: 400 });
    }
    if (!access.access.context) {
        return NextResponse.json({ error: 'Session authorization context required.', request_id: requestId }, { status: 401 });
    }

    const plan = await getPartnerPlanById(access.access.client, parsed.data.planId);
    if (!plan) {
        return NextResponse.json({ error: 'Requested plan was not found.' }, { status: 404 });
    }

    const trustGate = await enforceVetiosHighRiskRouteGate({
        client: access.access.client,
        requestId,
        context: access.access.context,
        actionKey: 'billing.owner.update',
        resource: {
            type: 'developer_partner_plan',
            id: plan.id,
            tenantId: access.access.context.tenantId,
        },
        evidence: {
            route: 'api/developer/billing/upgrade',
            partner_id: access.access.partner.id,
            plan_id: plan.id,
            plan_name: plan.name,
        },
    });
    if (!trustGate.ok) {
        return trustGate.response;
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
