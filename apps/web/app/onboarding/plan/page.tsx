import Link from 'next/link';
import { ProductPlanAction } from '@/components/billing/ProductPlanAction';
import { ConsoleCard, Container, DataRow, PageHeader, TerminalButton } from '@/components/ui/terminal';
import { resolveCurrentAccountProductSummary } from '@/lib/billing/entitlements';
import { listPublicProductPlans } from '@/lib/billing/entitlements';
import { formatPlanLimit, formatPlanPrice } from '@/lib/billing/productPlans';

export const dynamic = 'force-dynamic';

export default async function OnboardingPlanPage() {
    const summary = await resolveCurrentAccountProductSummary();

    if (!summary) {
        return (
            <Container>
                <PageHeader title="Choose Plan" description="Sign in before selecting a VetIOS plan." />
                <ConsoleCard title="Authentication Required">
                    <Link href="/login">
                        <TerminalButton type="button">Sign In</TerminalButton>
                    </Link>
                </ConsoleCard>
            </Container>
        );
    }

    return (
        <Container>
            <PageHeader
                title="Choose Plan"
                description="Start with the clinical workspace. Upgrade into infrastructure only when you need research, API, or federation capabilities."
            />

            <div className="mb-5 flex flex-wrap items-center gap-3 border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_100%_/_0.03)] p-4">
                <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[hsl(0_0%_62%)]">
                        Current plan
                    </div>
                    <div className="font-mono text-lg text-accent">{summary.plan.displayName}</div>
                </div>
                <div className="ml-auto flex flex-wrap gap-2">
                    <Link href="/cases/new?first_case=1">
                        <TerminalButton type="button">Start First Case</TerminalButton>
                    </Link>
                    <Link href="/cases/new?template=demo&first_case=1">
                        <TerminalButton type="button" variant="secondary">Try Demo Draft</TerminalButton>
                    </Link>
                </div>
            </div>

            <section className="mb-5 border border-accent/20 bg-accent/[0.035] p-4">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                    Fastest path
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[hsl(0_0%_74%)]">
                    You can stay on Free and run a first diagnosis now. Choose a paid plan only when clinic volume,
                    voice capture, SOAP notes, API access, or research tooling becomes necessary.
                </p>
            </section>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {listPublicProductPlans().map((plan) => (
                    <ConsoleCard key={plan.key} title={plan.displayName}>
                        <div className="space-y-3">
                            <div className="font-mono text-2xl text-[hsl(0_0%_98%)]">
                                {formatPlanPrice(plan)}
                            </div>
                            <p className="font-mono text-[12px] leading-relaxed text-[hsl(0_0%_72%)]">
                                {plan.description}
                            </p>
                            <DataRow label="Volume" value={formatPlanLimit(plan.monthlyDiagnosisLimit)} />
                            <DataRow label="For" value={plan.recommendedFor} />
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
        </Container>
    );
}
