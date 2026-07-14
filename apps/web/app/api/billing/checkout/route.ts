import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildRouteAuthorizationContext } from '@/lib/auth/authorization';
import { enforceVetiosHighRiskRouteGate } from '@/lib/auth/authTrustRouteGate';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { isBillingSchemaNotReadyError, updateAccountPlan } from '@/lib/billing/entitlements';
import { createProductCheckoutSession } from '@/lib/billing/product-stripe-service';
import { getProductPlan, isProductPlanKey } from '@/lib/billing/productPlans';
import { safeJson } from '@/lib/http/safeJson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CheckoutSchema = z.object({
    plan_key: z.string().min(1),
}).strict();

export async function POST(req: Request) {
    const requestId = crypto.randomUUID();
    const session = await resolveSessionTenant();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        return NextResponse.json({ error: 'invalid_json', detail: parsedJson.error }, { status: 400 });
    }

    const parsed = CheckoutSchema.safeParse(parsedJson.data);
    if (!parsed.success || !isProductPlanKey(parsed.data.plan_key)) {
        return NextResponse.json({ error: 'invalid_plan' }, { status: 400 });
    }

    const client = getSupabaseServer();
    const actor = resolveRequestActor(session);
    const context = buildRouteAuthorizationContext({
        tenantId: actor.tenantId,
        userId: actor.userId,
        authMode: 'session',
        user: (await session.supabase.auth.getUser()).data.user ?? null,
    });
    const trustGate = await enforceVetiosHighRiskRouteGate({
        client,
        requestId,
        context,
        actionKey: 'billing.owner.update',
        resource: {
            type: 'product_billing_plan',
            id: parsed.data.plan_key,
            tenantId: context.tenantId,
        },
        evidence: {
            route: 'api/billing/checkout',
            plan_key: parsed.data.plan_key,
        },
    });
    if (!trustGate.ok) {
        return trustGate.response;
    }

    const plan = getProductPlan(parsed.data.plan_key);

    if (plan.key === 'free') {
        try {
            await updateAccountPlan({
                tenantId: session.tenantId,
                userId: session.userId,
                planKey: 'free',
                status: 'active',
                billingProvider: 'internal',
                onboardingCompleted: true,
                client,
            });
        } catch (error) {
            if (isBillingSchemaNotReadyError(error)) {
                return billingSchemaPendingResponse(plan);
            }
            throw error;
        }

        return NextResponse.json({
            checkout_required: false,
            redirect_url: '/cases',
            plan,
        });
    }

    if (plan.custom) {
        return NextResponse.json({
            checkout_required: false,
            contact_sales: true,
            message: `${plan.displayName} is configured through VetIOS sales.`,
            plan,
        });
    }

    try {
        const checkout = await createProductCheckoutSession({
            tenantId: session.tenantId,
            userId: session.userId,
            email: session.email,
            planKey: plan.key,
            origin: new URL(req.url).origin,
        });

        return NextResponse.json({
            checkout_required: true,
            url: checkout.url,
            stripe_customer_id: checkout.stripeCustomerId,
            plan,
        });
    } catch (error) {
        if (isBillingSchemaNotReadyError(error)) {
            return billingSchemaPendingResponse(plan);
        }

        return NextResponse.json(
            {
                error: 'checkout_unavailable',
                message: error instanceof Error ? error.message : 'Checkout is not configured.',
                plan,
            },
            { status: 503 },
        );
    }
}

function billingSchemaPendingResponse(plan: ReturnType<typeof getProductPlan>) {
    return NextResponse.json(
        {
            error: 'billing_schema_not_ready',
            message: 'Billing storage is not active on this deployment yet. Apply the VetIOS product entitlement migration in Supabase, then retry.',
            plan,
        },
        { status: 503 },
    );
}
