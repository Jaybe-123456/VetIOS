import Link from 'next/link';
import { MfaSecurityCard } from '@/components/auth/MfaSecurityCard';
import { ConsoleCard, Container, DataRow, PageHeader, TerminalButton } from '@/components/ui/terminal';
import { resolveAccountProductSummary } from '@/lib/billing/entitlements';
import { formatPlanLimit } from '@/lib/billing/productPlans';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

interface ProfilePageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const STEP_UP_INTENTS = {
    outcome_calibration: {
        actionKey: 'outcome.calibration.materialize',
        resourceType: 'outcome_calibration_evidence',
        operationLabel: 'outcome calibration materialization',
        returnTo: '/outcome?step_up=verified',
    },
} as const;

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
    const session = await resolveSessionTenant();
    const query = await searchParams;
    const stepUpIntent = resolveStepUpIntent(query.step_up);

    if (!session) {
        return (
            <Container>
                <PageHeader title="Profile" description="Sign in to view your VetIOS account." />
                <ConsoleCard title="Authentication Required">
                    <Link href="/login">
                        <TerminalButton type="button">Sign In</TerminalButton>
                    </Link>
                </ConsoleCard>
            </Container>
        );
    }

    const supabase = getSupabaseServer();
    const [summary, contribution] = await Promise.all([
        resolveAccountProductSummary({
            tenantId: session.tenantId,
            userId: session.userId,
            client: supabase,
        }),
        loadContributionSummary(session.tenantId),
    ]);

    return (
        <Container>
            <PageHeader
                title="Profile"
                description="Your clinical account, intelligence contribution, and active VetIOS product access."
            />

            <div className="grid gap-4 lg:grid-cols-3">
                <ConsoleCard title="Account">
                    <DataRow label="Email" value={session.email} />
                    <DataRow label="Tenant" value={shortId(session.tenantId)} />
                    <DataRow label="Plan" value={summary.plan.displayName} tone="accent" />
                    <DataRow label="Status" value={summary.entitlement.status} />
                    <div className="flex gap-2 pt-2">
                        <Link href="/billing">
                            <TerminalButton type="button" variant="secondary">Billing</TerminalButton>
                        </Link>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Clinical Usage">
                    <DataRow
                        label="This Month"
                        value={`${summary.usage.diagnosesUsed.toLocaleString()} diagnoses`}
                        tone="accent"
                    />
                    <DataRow label="Limit" value={formatPlanLimit(summary.usage.diagnosisLimit)} />
                    <DataRow
                        label="Remaining"
                        value={summary.usage.diagnosisRemaining == null
                            ? 'Unlimited'
                            : summary.usage.diagnosisRemaining.toLocaleString()}
                    />
                    <p className="font-mono text-[11px] leading-relaxed text-[hsl(0_0%_64%)]">
                        Usage is counted from successful clinical diagnoses and inference requests.
                    </p>
                </ConsoleCard>

                <ConsoleCard title="Intelligence Contribution">
                    <DataRow label="Cases Submitted" value={contribution.inferenceCount.toLocaleString()} tone="accent" />
                    <DataRow label="Outcomes Confirmed" value={contribution.outcomeCount.toLocaleString()} />
                    <DataRow label="Learning Signals" value={contribution.learningSignals.toLocaleString()} />
                    <DataRow label="Contribution Score" value={`${contribution.contributionScore}%`} tone="accent" />
                    <p className="font-mono text-[11px] leading-relaxed text-[hsl(0_0%_64%)]">
                        Confirmed outcomes are the highest-value signal because they turn clinical use into labelled VetIOS intelligence.
                    </p>
                </ConsoleCard>
            </div>

            <MfaSecurityCard {...stepUpIntent} />
        </Container>
    );
}

function resolveStepUpIntent(value: string | string[] | undefined) {
    const key = Array.isArray(value) ? value[0] : value;
    return key && key in STEP_UP_INTENTS
        ? STEP_UP_INTENTS[key as keyof typeof STEP_UP_INTENTS]
        : undefined;
}

async function loadContributionSummary(tenantId: string) {
    const supabase = getSupabaseServer();
    const [inferenceResult, outcomeResult] = await Promise.all([
        supabase
            .from('ai_inference_events')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId),
        supabase
            .from('clinical_outcome_events')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId),
    ]);

    const inferenceCount = inferenceResult.count ?? 0;
    const outcomeCount = outcomeResult.count ?? 0;
    const learningSignals = outcomeCount;
    const contributionScore = inferenceCount === 0
        ? 0
        : Math.min(100, Math.round((outcomeCount / inferenceCount) * 100));

    return {
        inferenceCount,
        outcomeCount,
        learningSignals,
        contributionScore,
    };
}

function shortId(value: string): string {
    return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}
