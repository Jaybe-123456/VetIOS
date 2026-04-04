import { NextResponse } from 'next/server';
import { safeJson } from '@/lib/http/safeJson';
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

    const parsed = await safeJson<{ planId?: string }>(request);
    if (!parsed.ok || !parsed.data.planId) {
        return NextResponse.json({ error: 'planId is required.' }, { status: 400 });
    }

    const plan = await getPartnerPlanById(access.access.client, parsed.data.planId);
    if (!plan) {
        return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });
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
