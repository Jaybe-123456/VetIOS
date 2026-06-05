'use client';

import { useState } from 'react';
import { TerminalButton } from '@/components/ui/terminal';
import type { ProductPlanKey } from '@/lib/billing/productPlans';

export function ProductPlanAction({
    planKey,
    currentPlanKey,
    label,
    custom,
}: {
    planKey: ProductPlanKey;
    currentPlanKey: ProductPlanKey;
    label: string;
    custom: boolean;
}) {
    const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'contact'>('idle');
    const [message, setMessage] = useState<string | null>(null);
    const isCurrent = planKey === currentPlanKey;

    async function handleClick() {
        if (isCurrent) return;
        if (custom) {
            setStatus('contact');
            setMessage('Contact VetIOS to configure this plan for your organization.');
            return;
        }

        setStatus('loading');
        setMessage(null);

        try {
            const response = await fetch('/api/billing/checkout', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ plan_key: planKey }),
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                setStatus('error');
                setMessage(resolveCheckoutErrorMessage(payload));
                return;
            }

            if (typeof payload.url === 'string') {
                window.location.href = payload.url;
                return;
            }

            if (typeof payload.redirect_url === 'string') {
                window.location.href = payload.redirect_url;
                return;
            }

            if (payload.contact_sales) {
                setStatus('contact');
                setMessage('Contact VetIOS to configure this plan for your organization.');
                return;
            }

            setStatus('idle');
            window.location.reload();
        } catch (error) {
            setStatus('error');
            setMessage(error instanceof Error ? error.message : 'Unable to start checkout.');
        }
    }

    return (
        <div className="space-y-2">
            <TerminalButton
                type="button"
                variant={isCurrent ? 'secondary' : 'primary'}
                onClick={handleClick}
                disabled={status === 'loading' || isCurrent}
            >
                {isCurrent ? 'Current Plan' : status === 'loading' ? 'Starting...' : label}
            </TerminalButton>
            {message ? (
                <p className={`font-mono text-[11px] leading-relaxed ${
                    status === 'error' ? 'text-danger' : 'text-[hsl(0_0%_72%)]'
                }`}>
                    {message}
                </p>
            ) : null}
        </div>
    );
}

function resolveCheckoutErrorMessage(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
        return 'Checkout is not configured for this plan yet.';
    }

    const record = payload as Record<string, unknown>;
    if (record.error === 'billing_schema_not_ready') {
        return 'Billing storage is still being activated for this deployment. Apply the Supabase billing migration, then retry.';
    }

    return typeof record.message === 'string'
        ? record.message
        : 'Checkout is not configured for this plan yet.';
}
