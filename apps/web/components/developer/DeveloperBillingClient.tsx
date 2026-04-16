'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    ConsoleCard,
    TerminalButton,
    DataRow,
} from '@/components/ui/terminal';

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
        <div className="space-y-6">
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-accent animate-pulse" />
                    <p className="text-[10px] uppercase font-mono tracking-[0.32em] text-accent font-bold">Developer Billing</p>
                </div>
                <h1 className="text-2xl font-mono tracking-tighter uppercase font-bold text-foreground">
                    Plan, quota, and billing controls
                </h1>
                <p className="max-w-3xl font-mono text-xs text-[hsl(0_0%_80%)] leading-relaxed font-medium">
                    Manage the commercial layer behind the VetIOS Developer API, from current plan usage to Stripe billing access.
                </p>
            </div>

            {errorMessage ? (
                <div className="border border-danger/40 bg-danger/10 p-3 font-mono text-xs text-danger font-bold">
                    ERR: {errorMessage}
                </div>
            ) : null}

            <ConsoleCard title="Primary Subscription Vector">
                <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(0_0%_88%)] font-bold mb-1">Active Plan Identity</div>
                            <div className="text-2xl font-mono font-bold text-foreground">
                                {quota?.display_name ?? quota?.plan?.toUpperCase() ?? 'INITIALIZING...'}
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-accent font-medium uppercase tracking-widest flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                                Status: {quota?.status ?? 'active'}
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(0_0%_75%)] font-bold mb-1">Scheduled Renewal</div>
                            <div className="text-sm font-mono font-bold text-foreground">
                                {quota?.renewal_date ? new Date(quota.renewal_date).toLocaleDateString() : 'NO SCHEDULE'}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(0_0%_88%)] font-bold">Monthly Consumption Progress</div>
                        <div className="h-2 border border-grid bg-black/40">
                            <div
                                className={`h-full transition-all duration-500 ${
                                    (quota?.pct_used ?? 0) > 90 ? 'bg-danger' : 
                                    (quota?.pct_used ?? 0) > 75 ? 'bg-warning' : 
                                    'bg-accent'
                                }`}
                                style={{ width: `${Math.min(100, quota?.pct_used ?? 0)}%` }}
                            />
                        </div>
                        <div className="flex flex-wrap gap-4 pt-1 font-mono text-[10px] uppercase tracking-widest text-[hsl(0_0%_75%)] font-bold">
                            <span>Used: <span className="text-foreground">{quota?.requests_used?.toLocaleString() ?? 0}</span></span>
                            <span>Limit: <span className="text-foreground">{quota?.requests_limit?.toLocaleString() ?? 0}</span></span>
                            <span>Projected: <span className="text-foreground">{quota?.projected_month_end?.toLocaleString() ?? 0}</span></span>
                        </div>
                    </div>
                </div>
            </ConsoleCard>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {PLAN_CATALOG.map((plan) => {
                    const isCurrent = quota?.plan === plan.id;
                    return (
                        <ConsoleCard key={plan.id} title={plan.label} className={isCurrent ? 'border-accent' : ''}>
                            <div className="space-y-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-xl font-mono font-bold text-foreground">{plan.price}</div>
                                        {isCurrent && (
                                            <div className="mt-1 text-[9px] font-mono uppercase tracking-widest text-accent font-bold">CURRENT PLAN</div>
                                        )}
                                    </div>
                                </div>
                                
                                <div className="space-y-1 font-mono text-[10px] uppercase tracking-widest text-[hsl(0_0%_75%)] font-bold">
                                    <div>{plan.rpm} REQ/MIN</div>
                                    <div>{plan.monthly.toLocaleString()} REQ/MO</div>
                                </div>

                                <ul className="space-y-1.5 pt-2 border-t border-grid/20">
                                    {plan.features.map((feature) => (
                                        <li key={feature} className="font-mono text-[10px] uppercase tracking-wide text-[hsl(0_0%_88%)] font-semibold flex items-center gap-2">
                                            <span className="text-accent">»</span>
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <div className="pt-2">
                                    {plan.id === 'enterprise' ? (
                                        <TerminalButton onClick={() => window.location.href = 'mailto:api@vetios.tech?subject=VetIOS%20Enterprise%20API'}>
                                            CONTACT SALES
                                        </TerminalButton>
                                    ) : (
                                        <TerminalButton
                                            disabled={isCurrent}
                                            onClick={() => void upgradePlan(plan.id)}
                                            className="w-full"
                                        >
                                            {isCurrent ? 'NOMINAL' : 'SWITCH PLAN'}
                                        </TerminalButton>
                                    )}
                                </div>
                            </div>
                        </ConsoleCard>
                    );
                })}
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr,1fr]">
                <ConsoleCard title="Financial Snapshot">
                    <div className="space-y-6">
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(0_0%_88%)] font-bold mb-1">Upcoming Invoice</div>
                            <div className="text-2xl font-mono font-bold text-foreground">
                                {invoice?.amount_due != null ? `$${(invoice.amount_due / 100).toFixed(2)}` : '$0.00'}
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-[hsl(0_0%_75%)] font-medium uppercase tracking-widest">
                                Due: {invoice?.due_date ? new Date(invoice.due_date * 1000).toLocaleDateString() : 'NEXT CYCLE TERMINUS'}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(0_0%_88%)] font-bold mb-1">Line Items</div>
                            <div className="space-y-2">
                                {(invoice?.lines?.data ?? []).map((line, index) => (
                                    <div key={`${line.description ?? 'line'}-${index}`} className="flex items-center justify-between gap-3 border border-grid/20 bg-black/10 px-3 py-2 font-mono text-[11px]">
                                        <span className="text-[hsl(0_0%_88%)] font-medium">{line.description ?? 'STRIPE_METADATA'}</span>
                                        <span className="text-foreground font-bold">${(((line.amount ?? 0) / 100)).toFixed(2)}</span>
                                    </div>
                                ))}
                                {(invoice?.lines?.data?.length ?? 0) === 0 && (
                                    <div className="text-[10px] font-mono text-[hsl(0_0%_70%)] font-medium italic">No pending charges on the current stream.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Administrative Portal">
                    <div className="space-y-6">
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(0_0%_88%)] font-bold mb-1">Payment Hub</div>
                            <p className="font-mono text-[11px] text-[hsl(0_0%_80%)] leading-relaxed font-medium mb-4">
                                Securely manage payment methods, billing addresses, and historical tax invoices via the Stripe gateway.
                            </p>
                            <TerminalButton onClick={() => void openPortal()}>
                                OPEN STRIPE PORTAL
                            </TerminalButton>
                        </div>

                        {quota?.plan === 'enterprise' ? (
                            <div className="pt-6 border-t border-grid/40">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-accent font-bold mb-1">Legacy Usage Scaling</div>
                                <div className="font-mono text-[11px] text-[hsl(0_0%_82%)] font-medium">
                                    {overview?.billable_requests?.toLocaleString() ?? 0} REQS × ${(quota.price_per_1k_requests ?? 0).toFixed(2)} / 1K
                                </div>
                                <div className="text-xl font-mono font-bold text-foreground mt-1">
                                    EST: ${usageBasedEstimate?.toFixed(2) ?? '0.00'}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </ConsoleCard>
            </div>

            {loading ? (
                <div className="font-mono text-[10px] text-accent font-bold animate-pulse">REFRESHING FINANCIAL TELEMETRY...</div>
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
    if (!confirm(`CONFIRM PLAN UPGRADE TO ${planId.toUpperCase()}?`)) return;
    
    await fetch('/api/developer/billing/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
    });
    window.location.reload();
}
