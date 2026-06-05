'use client';

import { useEffect, useState } from 'react';

interface EntitlementPayload {
    account?: {
        plan?: {
            displayName?: string;
        };
        usage?: {
            diagnosesUsed?: number;
            diagnosisLimit?: number | null;
            diagnosisUsagePct?: number | null;
        };
    };
}

export function PlanUsageBadge() {
    const [payload, setPayload] = useState<EntitlementPayload | null>(null);

    useEffect(() => {
        let mounted = true;
        fetch('/api/account/entitlements', { credentials: 'same-origin' })
            .then((response) => response.ok ? response.json() : null)
            .then((data) => {
                if (mounted) setPayload(data);
            })
            .catch(() => {
                if (mounted) setPayload(null);
            });

        return () => {
            mounted = false;
        };
    }, []);

    const account = payload?.account;
    if (!account) return null;

    const planName = account.plan?.displayName ?? 'Free';
    const used = account.usage?.diagnosesUsed ?? 0;
    const limit = account.usage?.diagnosisLimit;
    const pct = account.usage?.diagnosisUsagePct ?? 0;
    const tone = limit != null && pct >= 90
        ? 'text-[hsl(45_100%_55%)] border-[hsl(45_100%_55%_/_0.4)]'
        : 'text-accent border-accent/30';

    return (
        <a
            href="/billing"
            className={`hidden sm:flex min-h-[32px] items-center gap-2 border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors hover:bg-white/[0.03] ${tone}`}
            title="View billing and plan usage"
        >
            <span>{planName}</span>
            <span className="text-[hsl(0_0%_52%)]">
                {limit == null ? `${used} used` : `${used}/${limit}`}
            </span>
        </a>
    );
}
