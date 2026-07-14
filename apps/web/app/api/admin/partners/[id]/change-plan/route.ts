import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/http/safeJson';
import { enforceVetiosHighRiskRouteGate } from '@/lib/auth/authTrustRouteGate';
import { resolveDeveloperRouteAccess } from '@/lib/api/developer-access';
import { getPartnerPlanById, updatePartnerPlan } from '@/lib/api/partner-service';
import { upgradePartnerPlan } from '@/lib/billing/stripe-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    const params = await context.params;
    const requestId = crypto.randomUUID();
    const access = await resolveDeveloperRouteAccess({
        request,
        requestId,
        allowApiKey: false,
        requireAdmin: true,
        partnerId: params.id,
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
        return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });
    }
    const trustGate = await enforceVetiosHighRiskRouteGate({
        client: access.access.client,
        requestId,
        context: access.access.context,
        actionKey: 'billing.owner.update',
        resource: {
            type: 'admin_partner_plan',
            id: params.id,
            tenantId: access.access.context.tenantId,
        },
        evidence: {
            route: 'api/admin/partners/[id]/change-plan',
            partner_id: params.id,
            plan_id: plan.id,
            plan_name: plan.name,
        },
    });
    if (!trustGate.ok) {
        return trustGate.response;
    }

    try {
        await upgradePartnerPlan({
            partnerId: params.id,
            newPlanId: plan.id,
        });
    } catch {
        await updatePartnerPlan(access.access.client, params.id, plan.id);
    }

    return NextResponse.json({ changed: true, plan });
}
