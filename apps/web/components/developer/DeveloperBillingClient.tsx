'use client';

import { useEffect, useMemo, useState } from 'react';

interface QuotaUsage {
    plan: string;
    display_name?: string;
    status?: string;
    period_start: string;
    period_end: string;
    renewal_date?: string;
    requests_used: number;
    requests_limit: number;
    pct_used: number;
    projected_month_end: number;
    on_track: boolean;
    flat_monthly_usd?: number;
    price_per_1k_requests?: number;
}

interface Overview {
    billable_requests: number;
    estimated_cost_usd: number;
}

interface InvoiceLineItem {
    description?: string | null;
    amount?: number;
}

interface InvoicePayload {
    amount_due?: number;
    due_date?: number | null;
    lines?: { data?: InvoiceLineItem[] };
    error?: string;
}

const PLAN_CATALOG = [
    {
        id: 'sandbox',
        label: 'Sandbox',
        price: '$0/mo',
        rpm: 10,
        monthly: 500,
        features: ['Inference API', 'Developer portal', 'Low-volume testing'],
    },
    {
        id: 'clinic',
        label: 'Clinic',
        price: '$149/mo',
        rpm: 60,
        monthly: 10000,
        features: ['Inference', 'Outcomes', 'PetPass sync'],
    },
    {
        id: 'research',
        label: 'Research',
        price: '$1,000/mo',
        rpm: 120,
        monthly: 50000,
        features: ['Inference', 'Outcomes', 'Dataset access', 'Simulation'],
    },
    {
        id: 'enterprise',
        label: 'Enterprise',
        price: 'Custom',
        rpm: 1000,
        monthly: 5000000,
        features: ['Full moat layer', 'Usage billing', 'Priority support'],
    },
];

export function DeveloperBillingClient() {
    const [quota, setQuota] = useState<QuotaUsage | null>(null);
    const [overview, setOverview] = useState<Overview | null>(null);
    const [invoice, setInvoice] = useState<InvoicePayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        void (async () => {
            setLoading(true);
            setErrorMessage(null);
            try {
                const [quotaResponse, overviewResponse, invoiceResponse] = await Promise.all([
                    fetch('/api/developer/analytics/quota-usage', { cache: 'no-store' }),
                    fetch('/api/developer/analytics/overview', { cache: 'no-store' }),
                    fetch('/api/developer/billing/invoice', { cache: 'no-store' }),
                ]);

                if (!quotaResponse.ok || !overviewResponse.ok || !invoiceResponse.ok) {
                    throw new Error('Unable to load billing data.');
                }

                const [quotaData, overviewData, invoiceData] = await Promise.all([
                    quotaResponse.json() as Promise<QuotaUsage>,
                    overviewResponse.json() as Promise<Overview>,
                    invoiceResponse.json() as Promise<InvoicePayload>,
                ]);

                setQuota(quotaData);
                setOverview(overviewData);
                setInvoice(invoiceData);
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : 'Unable to load billing data.');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const usageBasedEstimate = useMemo(() => {
        if (!quota || quota.plan !== 'enterprise') {
            return null;
        }
        const rate = quota.price_per_1k_requests ?? 0;
        return Math.round((((overview?.billable_requests ?? 0) / 1000) * rate) * 100) / 100;
    }, [overview, quota]);

    return (
        <div className="space-y-8">
            <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.32em] text-teal-700">Developer Billing</p>
                <h1 className="text-3xl font-semibold text-slate-950">Plan, quota, and billing controls</h1>
                <p className="max-w-3xl text-sm text-slate-600">
                    Manage the commercial layer behind the VetIOS Developer API, from current plan usage to Stripe billing access.
                </p>
            </div>

            {errorMessage ? (
                <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    {errorMessage}
                </div>
            ) : null}

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Current plan</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-semibold text-slate-950">{quota?.display_name ?? quota?.plan ?? 'Loading…'}</h2>
                        <p className="text-sm text-slate-600">
                            Status: <span className="font-medium text-slate-900">{quota?.status ?? 'active'}</span>
                        </p>
                    </div>
                    <div className="text-right text-sm text-slate-600">
                        <p>Renewal date</p>
                        <p className="font-medium text-slate-900">
                            {quota?.renewal_date ? new Date(quota.renewal_date).toLocaleDateString() : 'Not scheduled'}
                        </p>
                    </div>
                </div>
                <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-100">
                    <div className={progressClass(quota?.pct_used ?? 0)} style={{ width: `${Math.min(100, quota?.pct_used ?? 0)}%` }} />
                </div>
                <div className="mt-4 flex flex-wrap gap-6 text-sm text-slate-600">
                    <span>{quota?.requests_used ?? 0} requests used</span>
                    <span>{quota?.requests_limit ?? 0} monthly limit</span>
                    <span>Projected month end: {quota?.projected_month_end ?? 0}</span>
                </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-4">
                {PLAN_CATALOG.map((plan) => {
                    const isCurrent = quota?.plan === plan.id;
                    return (
                        <article key={plan.id} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-xl font-semibold text-slate-950">{plan.label}</h3>
                                    <p className="mt-1 text-sm text-slate-600">{plan.price}</p>
                                </div>
                                {isCurrent ? (
                                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                                        Current plan
                                    </span>
                                ) : null}
                            </div>
                            <div className="mt-5 space-y-2 text-sm text-slate-600">
                                <p>{plan.rpm} requests/minute</p>
                                <p>{plan.monthly.toLocaleString()} requests/month</p>
                            </div>
                            <ul className="mt-5 space-y-2 text-sm text-slate-700">
                                {plan.features.map((feature) => (
                                    <li key={feature}>• {feature}</li>
                                ))}
                            </ul>
                            <div className="mt-6">
                                {plan.id === 'enterprise' ? (
                                    <a
                                        href="mailto:api@vetios.tech?subject=VetIOS%20Enterprise%20API"
                                        className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-800"
                                    >
                                        Contact sales
                                    </a>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={isCurrent}
                                        onClick={() => void upgradePlan(plan.id)}
                                        className={`rounded-full px-4 py-2 text-sm font-medium ${isCurrent ? 'bg-slate-100 text-slate-400' : 'bg-slate-950 text-white'}`}
                                    >
                                        {isCurrent ? 'Current plan' : 'Upgrade'}
                                    </button>
                                )}
                            </div>
                        </article>
                    );
                })}
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.2fr,1fr]">
                <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Upcoming invoice</p>
                    <h2 className="mt-2 text-xl font-semibold text-slate-950">
                        {invoice?.amount_due != null ? `$${(invoice.amount_due / 100).toFixed(2)}` : '$0.00'}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                        Due {invoice?.due_date ? new Date(invoice.due_date * 1000).toLocaleDateString() : 'when the next billing cycle closes'}
                    </p>
                    <div className="mt-5 space-y-3 text-sm text-slate-700">
                        {(invoice?.lines?.data ?? []).map((line, index) => (
                            <div key={`${line.description ?? 'line'}-${index}`} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                                <span>{line.description ?? 'Stripe line item'}</span>
                                <span>${(((line.amount ?? 0) / 100)).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>
                </article>

                <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Payment method</p>
                    <h2 className="mt-2 text-xl font-semibold text-slate-950">Stripe customer portal</h2>
                    <p className="mt-2 text-sm text-slate-600">
                        Update payment details, invoices, and billing contacts from the secure Stripe portal.
                    </p>
                    <button
                        type="button"
                        onClick={() => void openPortal()}
                        className="mt-6 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
                    >
                        Open billing portal
                    </button>

                    {quota?.plan === 'enterprise' ? (
                        <div className="mt-8 rounded-2xl bg-slate-50 p-4">
                            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Usage billing</p>
                            <p className="mt-2 text-sm text-slate-700">
                                {overview?.billable_requests ?? 0} billable requests × ${(quota.price_per_1k_requests ?? 0).toFixed(2)} / 1k
                            </p>
                            <p className="mt-2 text-xl font-semibold text-slate-950">
                                ${usageBasedEstimate?.toFixed(2) ?? '0.00'}
                            </p>
                        </div>
                    ) : null}
                </article>
            </section>

            {loading ? (
                <div className="text-sm text-slate-500">Refreshing billing data…</div>
            ) : null}
        </div>
    );
}

async function openPortal() {
    const response = await fetch('/api/developer/billing/portal', { method: 'POST' });
    if (!response.ok) return;
    const data = await response.json() as { url?: string };
    if (data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
    }
}

async function upgradePlan(planId: string) {
    await fetch('/api/developer/billing/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
    });
    window.location.reload();
}

function progressClass(pctUsed: number) {
    if (pctUsed > 90) return 'h-full rounded-full bg-rose-500';
    if (pctUsed > 70) return 'h-full rounded-full bg-amber-500';
    return 'h-full rounded-full bg-emerald-500';
}
