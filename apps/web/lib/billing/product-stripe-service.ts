import Stripe from 'stripe';
import { getSupabaseServer } from '@/lib/supabaseServer';
import {
    getOrCreateAccountEntitlement,
    loadAccountEntitlement,
    updateAccountPlan,
    type ProductEntitlementStatus,
} from '@/lib/billing/entitlements';
import {
    getProductPlan,
    isProductPlanKey,
    type ProductPlanKey,
} from '@/lib/billing/productPlans';

let stripeClient: Stripe | null = null;

const PRODUCT_PRICE_ENV_BY_PLAN: Partial<Record<ProductPlanKey, string>> = {
    clinic: 'STRIPE_PRODUCT_CLINIC_PRICE_ID',
    practice: 'STRIPE_PRODUCT_PRACTICE_PRICE_ID',
    research: 'STRIPE_PRODUCT_RESEARCH_PRICE_ID',
    developer: 'STRIPE_PRODUCT_DEVELOPER_PRICE_ID',
};

export function getProductStripeClient(): Stripe {
    if (stripeClient) return stripeClient;

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
        throw new Error('Missing STRIPE_SECRET_KEY.');
    }

    stripeClient = new Stripe(secretKey);
    return stripeClient;
}

export function resolveProductStripePriceId(planKey: ProductPlanKey): string | null {
    const envKey = PRODUCT_PRICE_ENV_BY_PLAN[planKey];
    return envKey ? process.env[envKey] ?? null : null;
}

export function resolveProductPlanFromStripePriceId(priceId: string | null | undefined): ProductPlanKey | null {
    if (!priceId) return null;

    for (const [planKey, envKey] of Object.entries(PRODUCT_PRICE_ENV_BY_PLAN)) {
        if (process.env[envKey] === priceId && isProductPlanKey(planKey)) {
            return planKey;
        }
    }

    return null;
}

export async function createProductCheckoutSession(input: {
    tenantId: string;
    userId: string;
    email: string;
    planKey: ProductPlanKey;
    origin: string;
}): Promise<{ url: string; stripeCustomerId: string }> {
    const plan = getProductPlan(input.planKey);
    if (plan.monthlyPriceUsd == null || plan.monthlyPriceUsd === 0 || plan.custom) {
        throw new Error(`Plan ${plan.key} does not use Stripe checkout.`);
    }

    const priceId = resolveProductStripePriceId(plan.key);
    if (!priceId) {
        throw new Error(`Missing product Stripe price for plan ${plan.key}.`);
    }

    const stripe = getProductStripeClient();
    const client = getSupabaseServer();
    const entitlement = await getOrCreateAccountEntitlement(client, {
        tenantId: input.tenantId,
        userId: input.userId,
    });
    const customerId = entitlement.stripeCustomerId
        ?? await createProductStripeCustomer({
            tenantId: input.tenantId,
            userId: input.userId,
            email: input.email,
        });

    if (!entitlement.stripeCustomerId) {
        await updateAccountPlan({
            tenantId: input.tenantId,
            userId: input.userId,
            planKey: entitlement.planKey,
            status: entitlement.status,
            billingProvider: 'stripe',
            stripeCustomerId: customerId,
            metadata: entitlement.metadata,
            client,
        });
    }

    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${input.origin}/billing?checkout=success&plan=${plan.key}`,
        cancel_url: `${input.origin}/billing?checkout=cancelled&plan=${plan.key}`,
        metadata: buildProductMetadata(input.tenantId, input.userId, plan.key),
        subscription_data: {
            metadata: buildProductMetadata(input.tenantId, input.userId, plan.key),
        },
        allow_promotion_codes: true,
    });

    if (!session.url) {
        throw new Error('Stripe did not return a checkout URL.');
    }

    return {
        url: session.url,
        stripeCustomerId: customerId,
    };
}

export async function handleProductCheckoutCompleted(session: Stripe.Checkout.Session): Promise<boolean> {
    const metadata = readProductMetadata(session.metadata);
    if (!metadata) return false;

    await updateAccountPlan({
        tenantId: metadata.tenantId,
        userId: metadata.userId,
        planKey: metadata.planKey,
        status: 'active',
        billingProvider: 'stripe',
        stripeCustomerId: readStripeId(session.customer),
        stripeSubscriptionId: readStripeId(session.subscription),
        onboardingCompleted: true,
        metadata: {
            stripe_checkout_session_id: session.id,
        },
    });

    return true;
}

export async function handleProductSubscriptionUpdated(subscription: Stripe.Subscription): Promise<boolean> {
    const metadata = readProductMetadata(subscription.metadata)
        ?? await readProductMetadataFromCustomer(String(subscription.customer));
    const pricePlan = resolveProductPlanFromStripePriceId(subscription.items.data[0]?.price.id ?? null);
    const planKey = pricePlan ?? metadata?.planKey;
    const tenantId = metadata?.tenantId;
    const userId = metadata?.userId;

    if (!tenantId || !userId || !planKey) return false;

    const subscriptionRecord = subscription as unknown as Record<string, unknown>;
    await updateAccountPlan({
        tenantId,
        userId,
        planKey,
        status: mapStripeSubscriptionStatus(subscription.status),
        billingProvider: 'stripe',
        stripeCustomerId: String(subscription.customer),
        stripeSubscriptionId: subscription.id,
        currentPeriodStart: toIso(readUnixTimestamp(subscriptionRecord.current_period_start)),
        currentPeriodEnd: toIso(readUnixTimestamp(subscriptionRecord.current_period_end)),
        onboardingCompleted: true,
        metadata: {
            stripe_subscription_status: subscription.status,
        },
    });

    return true;
}

export async function handleProductSubscriptionDeleted(subscription: Stripe.Subscription): Promise<boolean> {
    const client = getSupabaseServer();
    const subscriptionId = subscription.id;
    const existingBySubscription = await loadEntitlementByStripeSubscription(subscriptionId);
    const entitlement = existingBySubscription
        ?? await loadEntitlementByStripeCustomer(String(subscription.customer));

    if (!entitlement) return false;

    await updateAccountPlan({
        tenantId: entitlement.tenantId,
        userId: entitlement.userId,
        planKey: 'free',
        status: 'cancelled',
        billingProvider: 'stripe',
        stripeCustomerId: entitlement.stripeCustomerId,
        stripeSubscriptionId: subscriptionId,
        currentPeriodStart: entitlement.currentPeriodStart,
        currentPeriodEnd: entitlement.currentPeriodEnd,
        metadata: {
            previous_plan_key: entitlement.planKey,
            cancelled_subscription_id: subscriptionId,
        },
        client,
    });

    return true;
}

async function createProductStripeCustomer(input: {
    tenantId: string;
    userId: string;
    email: string;
}): Promise<string> {
    const customer = await getProductStripeClient().customers.create({
        email: input.email,
        metadata: buildProductMetadata(input.tenantId, input.userId, 'free'),
    });

    return customer.id;
}

async function readProductMetadataFromCustomer(customerId: string): Promise<ProductMetadata | null> {
    try {
        const customer = await getProductStripeClient().customers.retrieve(customerId);
        if (customer.deleted) return null;
        return readProductMetadata(customer.metadata);
    } catch {
        return null;
    }
}

async function loadEntitlementByStripeSubscription(subscriptionId: string) {
    const client = getSupabaseServer();
    const { data, error } = await client
        .from('account_entitlements')
        .select('*')
        .eq('stripe_subscription_id', subscriptionId)
        .maybeSingle();

    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return loadAccountEntitlement(client, String(row.tenant_id));
}

async function loadEntitlementByStripeCustomer(customerId: string) {
    const client = getSupabaseServer();
    const { data, error } = await client
        .from('account_entitlements')
        .select('*')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();

    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return loadAccountEntitlement(client, String(row.tenant_id));
}

interface ProductMetadata {
    tenantId: string;
    userId: string;
    planKey: ProductPlanKey;
}

function buildProductMetadata(tenantId: string, userId: string, planKey: ProductPlanKey): Record<string, string> {
    return {
        vetios_product: 'clinical_platform',
        vetios_tenant_id: tenantId,
        vetios_user_id: userId,
        vetios_product_plan: planKey,
    };
}

function readProductMetadata(metadata: Stripe.Metadata | null | undefined): ProductMetadata | null {
    const tenantId = metadata?.vetios_tenant_id;
    const userId = metadata?.vetios_user_id;
    const planKey = metadata?.vetios_product_plan;

    if (!tenantId || !userId || !isProductPlanKey(planKey)) return null;

    return {
        tenantId,
        userId,
        planKey,
    };
}

function readStripeId(value: string | { id?: string } | null): string | null {
    if (typeof value === 'string') return value;
    return value?.id ?? null;
}

function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): ProductEntitlementStatus {
    if (status === 'trialing') return 'trialing';
    if (status === 'past_due' || status === 'unpaid' || status === 'incomplete' || status === 'incomplete_expired') {
        return 'past_due';
    }
    if (status === 'canceled' || status === 'paused') return 'cancelled';
    return 'active';
}

function readUnixTimestamp(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function toIso(unixSeconds: number | null | undefined) {
    return typeof unixSeconds === 'number'
        ? new Date(unixSeconds * 1000).toISOString()
        : null;
}
