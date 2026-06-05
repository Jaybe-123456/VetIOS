import Link from 'next/link';
import { ProductPlanAction } from '@/components/billing/ProductPlanAction';
import { ConsoleCard, Container, DataRow, PageHeader, TerminalButton } from '@/components/ui/terminal';
import { resolveCurrentAccountProductSummary } from '@/lib/billing/entitlements';
import { formatPlanLimit, formatPlanPrice } from '@/lib/billing/productPlans';
import { listPublicProductPlans } from '@/lib/billing/entitlements';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
    const summary = await resolveCurrentAccountProductSummary();

    if (!summary) {
        return (
            <Container>
                <PageHeader title="Billing" description="Sign in to manage your VetIOS plan." />
                <ConsoleCard title="Authentication Required">
                    <Link href="/login">
                        <TerminalButton type="button">Sign In</TerminalButton>
                    </Link>
                </ConsoleCard>
            </Container>
        );
    }

    const usage = summary.usage;
    const usagePct = usage.diagnosisUsagePct ?? 0;

    return (
        <Container>
            <PageHeader
                title="Billing"
                description="Manage clinical access, usage, and platform upgrade paths without mixing clinician tools with infrastructure products."
            />

            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
                <ConsoleCard title="Current Plan">
                    <DataRow label="Plan" value={summary.plan.displayName} tone="accent" />
                    <DataRow label="Status" value={summary.entitlement.status} />
                    <DataRow label="Diagnosis Limit" value={formatPlanLimit(summary.plan.monthlyDiagnosisLimit)} />
                    <DataRow
                        label="Usage"
                        value={`${usage.diagnosesUsed.toLocaleString()} used${usage.diagnosisRemaining == null ? '' : ` · ${usage.diagnosisRemaining.toLocaleString()} remaining`}`}
                    />
                    <div className="h-2 w-full overflow-hidden border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_10%)]">
                        <div
                            className="h-full bg-accent transition-all"
                            style={{ width: `${usage.diagnosisLimit == null ? 18 : Math.min(100, usagePct)}%` }}
                        />
                    </div>
                    <p className="font-mono text-[11px] leading-relaxed text-[hsl(0_0%_64%)]">
                        Usage is currently metered for visibility first. Hard quota blocking will be enabled only after production counters are validated.
                    </p>
                </ConsoleCard>

                <div className="grid gap-4 md:grid-cols-2">
                    {listPublicProductPlans().map((plan) => (
                        <ConsoleCard key={plan.key} title={plan.displayName}>
                            <div className="space-y-3">
                                <div>
                                    <div className="font-mono text-xl text-[hsl(0_0%_98%)]">
                                        {formatPlanPrice(plan)}
                                    </div>
                                    <p className="mt-2 font-mono text-[12px] leading-relaxed text-[hsl(0_0%_72%)]">
                                        {plan.description}
                                    </p>
                                </div>
                                <DataRow label="Volume" value={formatPlanLimit(plan.monthlyDiagnosisLimit)} />
                                <DataRow label="Best For" value={plan.recommendedFor} />
                                <ProductPlanAction
                                    planKey={plan.key}
                                    currentPlanKey={summary.plan.key}
                                    label={plan.cta}
                                    custom={plan.custom}
                                />
                            </div>
                        </ConsoleCard>
                    ))}
                </div>
            </div>
        </Container>
    );
}
