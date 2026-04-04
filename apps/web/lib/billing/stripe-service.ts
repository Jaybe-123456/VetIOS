import Stripe from 'stripe';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
    getApiPartnerById,
    getPartnerPlanById,
    getPartnerPlanByName,
} from '@/lib/api/partner-service';
import type { ApiPartner } from '@/lib/api/types';

let stripeClient: Stripe | null = null;

function getStripeClient() {
    if (stripeClient) {
        return stripeClient;
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
        throw new Error('Missing STRIPE_SECRET_KEY.');
    }

    stripeClient = new Stripe(secretKey);
    return stripeClient;
}

export async function createPartnerStripeCustomer(partner: ApiPartner): Promise<string> {
    const stripe = getStripeClient();
    const client = getSupabaseServer();
    const customer = await stripe.customers.create({
        email: partner.billingEmail,
        name: partner.name,
        metadata: {
            vetios_partner_id: partner.id,
        },
    });

    const { error } = await client
        .from('api_partners')
        .update({ stripe_customer_id: customer.id })
        .eq('id', partner.id);

    if (error) {
        throw new Error(`Failed to persist Stripe customer id: ${error.message}`);
    }

    return customer.id;
}

export async function createPartnerSubscription(params: {
    partnerId: string;
    planId: string;
}): Promise<Stripe.Subscription> {
    const client = getSupabaseServer();
    const stripe = getStripeClient();
    const partner = await getApiPartnerById(client, params.partnerId);
    const plan = await getPartnerPlanById(client, params.planId);

    if (!partner || !plan) {
        throw new Error('Partner or plan not found.');
    }

    const stripePriceId = resolveStripePriceId(plan.name, plan.stripePriceId);
    if (!stripePriceId) {
        throw new Error(`Plan ${plan.name} does not have a Stripe price configured.`);
    }

    const customerId = partner.stripeCustomerId ?? await createPartnerStripeCustomer(partner);
    const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: stripePriceId }],
        metadata: { vetios_partner_id: partner.id },
    });
    const subscriptionRecord = subscription as unknown as Record<string, unknown>;

    const { error } = await client
        .from('api_partners')
        .update({
            plan_id: plan.id,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            current_period_start: toIso(readUnixTimestamp(subscriptionRecord.current_period_start)),
            current_period_end: toIso(readUnixTimestamp(subscriptionRecord.current_period_end)),
            status: 'active',
        })
        .eq('id', partner.id);

    if (error) {
        throw new Error(`Failed to persist Stripe subscription: ${error.message}`);
    }

    return subscription;
}

export async function cancelPartnerSubscription(partnerId: string): Promise<void> {
    const client = getSupabaseServer();
    const stripe = getStripeClient();
    const partner = await getApiPartnerById(client, partnerId);

    if (!partner?.stripeSubscriptionId) {
        throw new Error('Partner does not have an active Stripe subscription.');
    }

    await stripe.subscriptions.cancel(partner.stripeSubscriptionId);

    const { error } = await client
        .from('api_partners')
        .update({ status: 'cancelled' })
        .eq('id', partnerId);

    if (error) {
        throw new Error(`Failed to mark partner subscription as cancelled: ${error.message}`);
    }
}

export async function upgradePartnerPlan(params: {
    partnerId: string;
    newPlanId: string;
}): Promise<void> {
    const client = getSupabaseServer();
    const stripe = getStripeClient();
    const partner = await getApiPartnerById(client, params.partnerId);
    const plan = await getPartnerPlanById(client, params.newPlanId);

    if (!partner || !plan) {
        throw new Error('Partner or plan not found.');
    }

    if (plan.name === 'enterprise') {
        throw new Error('Enterprise upgrades are handled through VetIOS sales.');
    }

    if (!partner.stripeSubscriptionId) {
        await createPartnerSubscription({ partnerId: params.partnerId, planId: params.newPlanId });
        return;
    }

    const stripePriceId = resolveStripePriceId(plan.name, plan.stripePriceId);
    if (!stripePriceId) {
        throw new Error(`Plan ${plan.name} does not have a Stripe price configured.`);
    }

    const subscription = await stripe.subscriptions.retrieve(partner.stripeSubscriptionId);
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) {
        throw new Error('Stripe subscription is missing a subscription item.');
    }

    await stripe.subscriptions.update(partner.stripeSubscriptionId, {
        items: [{ id: itemId, price: stripePriceId }],
        proration_behavior: 'always_invoice',
        metadata: { vetios_partner_id: partner.id },
    });

    const { error } = await client
        .from('api_partners')
        .update({ plan_id: plan.id })
        .eq('id', partner.id);

    if (error) {
        throw new Error(`Failed to persist upgraded plan: ${error.message}`);
    }
}

export async function getUpcomingInvoice(partnerId: string): Promise<Stripe.Invoice> {
    const client = getSupabaseServer();
    const stripe = getStripeClient();
    const partner = await getApiPartnerById(client, partnerId);

    if (!partner?.stripeCustomerId) {
        throw new Error('Partner does not have a Stripe customer id.');
    }

    const invoices = stripe.invoices as unknown as {
        retrieveUpcoming?: (input: { customer: string }) => Promise<Stripe.Invoice>;
        createPreview?: (input: { customer: string }) => Promise<Stripe.Invoice>;
    };

    if (invoices.retrieveUpcoming) {
        return invoices.retrieveUpcoming({
            customer: partner.stripeCustomerId,
        });
    }

    if (invoices.createPreview) {
        return invoices.createPreview({
            customer: partner.stripeCustomerId,
        });
    }

    throw new Error('Configured Stripe SDK does not expose an upcoming invoice preview method.');
}

export async function createPartnerBillingPortalSession(params: {
    partnerId: string;
    returnUrl: string;
}): Promise<string> {
    const client = getSupabaseServer();
    const stripe = getStripeClient();
    const partner = await getApiPartnerById(client, params.partnerId);

    if (!partner) {
        throw new Error('Partner not found.');
    }

    const customerId = partner.stripeCustomerId ?? await createPartnerStripeCustomer(partner);
    const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: params.returnUrl,
    });

    return session.url;
}

export async function reportBillableUsageToStripe(usageEventId: string): Promise<void> {
    const client = getSupabaseServer();
    const stripe = getStripeClient();
    const { data, error } = await client
        .from('api_usage_events')
        .select('*')
        .eq('id', usageEventId)
        .maybeSingle();

    if (error || !data) {
        throw new Error(`Failed to load usage event for billing sync: ${error?.message ?? 'Unknown error'}`);
    }

    const usageEvent = data as Record<string, unknown>;
    if (usageEvent.billed_at || usageEvent.is_billable === false) {
        return;
    }

    const partnerId = typeof usageEvent.partner_id === 'string' ? usageEvent.partner_id : null;
    if (!partnerId) {
        return;
    }

    const partner = await getApiPartnerById(client, partnerId);
    if (!partner?.stripeCustomerId) {
        return;
    }

    const plan = partner.plan ?? await getPartnerPlanById(client, partner.planId);
    if (!plan || (plan.pricePer1kRequests ?? 0) <= 0) {
        return;
    }

    const meterEvents = (stripe.billing as unknown as {
        meterEvents?: {
            create: (input: {
                event_name: string;
                payload: { stripe_customer_id: string; value: string };
                timestamp: number;
                identifier: string;
            }) => Promise<unknown>;
        };
    }).meterEvents;

    if (!meterEvents?.create) {
        throw new Error('Configured Stripe SDK does not expose billing.meterEvents.create.');
    }

    await meterEvents.create({
        event_name: 'vetios_api_request',
        payload: {
            stripe_customer_id: partner.stripeCustomerId,
            value: '1',
        },
        timestamp: Math.floor(new Date(String(usageEvent.created_at)).getTime() / 1000),
        identifier: usageEventId,
    });

    const { error: updateError } = await client
        .from('api_usage_events')
        .update({ billed_at: new Date().toISOString() })
        .eq('id', usageEventId);

    if (updateError) {
        throw new Error(`Failed to mark usage event as billed: ${updateError.message}`);
    }
}

export async function resolvePlanFromStripePriceId(priceId: string | null | undefined) {
    if (!priceId) {
        return null;
    }

    const client = getSupabaseServer();
    const { data, error } = await client
        .from('api_partner_plans')
        .select('*')
        .eq('stripe_price_id', priceId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to resolve partner plan from Stripe price: ${error.message}`);
    }

    if (data) {
        return data;
    }

    for (const [planName, envKey] of Object.entries(PRICE_ENV_BY_PLAN)) {
        if (process.env[envKey] === priceId) {
            return getPartnerPlanByName(client, planName);
        }
    }

    return null;
}

const PRICE_ENV_BY_PLAN: Record<string, string> = {
    sandbox: 'STRIPE_SANDBOX_PRICE_ID',
    clinic: 'STRIPE_CLINIC_PRICE_ID',
    research: 'STRIPE_RESEARCH_PRICE_ID',
};

function resolveStripePriceId(planName: string, dbPriceId: string | null): string | null {
    if (dbPriceId) {
        return dbPriceId;
    }

    const envKey = PRICE_ENV_BY_PLAN[planName];
    return envKey ? process.env[envKey] ?? null : null;
}

function toIso(unixSeconds: number | null | undefined) {
    return typeof unixSeconds === 'number'
        ? new Date(unixSeconds * 1000).toISOString()
        : null;
}

function readUnixTimestamp(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
