import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { resolvePlanFromStripePriceId } from '@/lib/billing/stripe-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!secret || !key) {
        return NextResponse.json({ error: 'Stripe webhook is not configured.' }, { status: 500 });
    }

    const signature = request.headers.get('stripe-signature');
    if (!signature) {
        return NextResponse.json({ error: 'Missing Stripe signature.' }, { status: 400 });
    }

    const stripe = new Stripe(key);
    const payload = await request.text();
    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid Stripe signature.' }, { status: 400 });
    }

    const client = getSupabaseServer();

    if (event.type === 'customer.subscription.updated') {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionRecord = subscription as unknown as Record<string, unknown>;
        const plan = await resolvePlanFromStripePriceId(subscription.items.data[0]?.price.id ?? null);
        await client
            .from('api_partners')
            .update({
                plan_id: (plan as { id?: string } | null)?.id ?? null,
                stripe_subscription_id: subscription.id,
                status: 'active',
                current_period_start: toIsoDate(readUnixTimestamp(subscriptionRecord.current_period_start)),
                current_period_end: toIsoDate(readUnixTimestamp(subscriptionRecord.current_period_end)),
            })
            .eq('stripe_customer_id', subscription.customer);
    }

    if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object as Stripe.Subscription;
        await client
            .from('api_partners')
            .update({ status: 'cancelled' })
            .eq('stripe_subscription_id', subscription.id);
    }

    if (event.type === 'invoice.payment_failed') {
        const invoice = event.data.object as Stripe.Invoice;
        await client
            .from('api_partners')
            .update({ status: 'suspended' })
            .eq('stripe_customer_id', invoice.customer);
    }

    if (event.type === 'invoice.paid') {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceRecord = invoice as unknown as Record<string, unknown>;
        await client
            .from('api_partners')
            .update({
                status: 'active',
                current_period_start: toIsoDate(readUnixTimestamp(invoiceRecord.period_start)),
                current_period_end: toIsoDate(readUnixTimestamp(invoiceRecord.period_end)),
            })
            .eq('stripe_customer_id', invoice.customer);
    }

    return NextResponse.json({ received: true });
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

function toIsoDate(unixSeconds: number | null) {
    return unixSeconds != null ? new Date(unixSeconds * 1000).toISOString() : null;
}
