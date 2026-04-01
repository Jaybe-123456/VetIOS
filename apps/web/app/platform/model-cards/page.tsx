import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Database, ShieldCheck } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { getPublicModelCardsCatalog, type PublicModelCard } from '@/lib/platform/publicModelCards';

export const metadata: Metadata = {
    title: 'Public Model Cards',
    description: 'Read-only VetIOS model cards backed by the registry control plane.',
};

export const dynamic = 'force-dynamic';

export default async function PublicModelCardsPage() {
    const catalog = await getPublicModelCardsCatalog();

    return (
        <PlatformShell
            badge="PUBLIC MODEL CARDS"
            title="Governance evidence that can leave the control plane."
            description="These cards expose the active registry state, governance gates, and promotion blockers in a read-only public surface. This is the first trust layer for the moat claim around transparency."
            actions={(
                <Link
                    href="/api/public/model-cards"
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                >
                    JSON endpoint
                    <Database className="h-4 w-4" />
                </Link>
            )}
        >
            <div className="grid gap-4 md:grid-cols-4">
                <StatCard label="Configured" value={catalog.configured ? 'YES' : 'NO'} />
                <StatCard label="Source" value={catalog.source.toUpperCase()} />
                <StatCard label="Tenant" value={catalog.tenant_id ?? 'NOT CONFIGURED'} />
                <StatCard label="Refreshed" value={formatDateTime(catalog.refreshed_at)} />
            </div>

            {!catalog.configured ? (
                <section className="mt-10 rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-8 text-amber-100">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Configuration needed</div>
                    <h2 className="mt-2 text-2xl font-semibold text-white">Public model cards are wired, but no public catalog tenant is configured yet.</h2>
                    <p className="mt-4 max-w-3xl text-sm leading-7">
                        Set <code className="rounded bg-black/20 px-1.5 py-0.5 text-amber-100">VETIOS_PUBLIC_TENANT_ID</code> to the tenant whose registry you want to publish, or sign in so the page can fall back to your current session tenant.
                    </p>
                </section>
            ) : (
                <section className="mt-10 space-y-8">
                    {catalog.families.map((family) => (
                        <div key={family.model_family} className="rounded-[26px] border border-white/10 bg-white/[0.04] p-6">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{family.model_family}</div>
                                    <h2 className="mt-2 text-2xl font-semibold text-white">
                                        {family.cards.length > 0 ? `${family.cards.length} published registry cards` : 'No registry cards published'}
                                    </h2>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    <FamilyBadge label="Active" value={family.active_model_version ?? 'NO DATA'} />
                                    <FamilyBadge label="Last stable" value={family.last_stable_model_version ?? 'NO DATA'} />
                                </div>
                            </div>

                            {family.cards.length === 0 ? (
                                <div className="mt-6 rounded-2xl border border-white/8 bg-black/15 p-5 text-sm text-slate-300">
                                    No registry entries are available for this family in the published tenant yet.
                                </div>
                            ) : (
                                <div className="mt-6 grid gap-5 xl:grid-cols-2">
                                    {family.cards.map((card) => (
                                        <ModelCardPanel key={card.registry_id} card={card} />
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </section>
            )}
        </PlatformShell>
    );
}

function ModelCardPanel({ card }: { card: PublicModelCard }) {
    return (
        <article className="rounded-[22px] border border-white/10 bg-[#0a1323] p-5 shadow-[0_20px_70px_rgba(2,6,23,0.25)]">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{card.model_family}</div>
                    <h3 className="mt-2 text-xl font-semibold text-white">{card.model_name}</h3>
                    <div className="mt-1 text-sm text-slate-300">{card.model_version}</div>
                </div>
                <div className="space-y-2 text-right">
                    <Tag tone={card.is_active_route ? 'good' : 'neutral'}>{card.is_active_route ? 'ACTIVE ROUTE' : 'PUBLISHED'}</Tag>
                    <Tag tone={card.deployment_decision === 'approved' ? 'good' : card.deployment_decision === 'rejected' ? 'bad' : 'warn'}>
                        {card.deployment_decision.toUpperCase()}
                    </Tag>
                </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <MetricTile label="Registry role" value={card.registry_role.toUpperCase()} />
                <MetricTile label="Lifecycle" value={card.lifecycle_status.toUpperCase()} />
                <MetricTile label="Macro F1" value={formatPercent(card.clinical_scorecard.macro_f1)} />
                <MetricTile label="Critical recall" value={formatPercent(card.clinical_scorecard.critical_recall)} />
                <MetricTile label="ECE" value={formatPercent(card.clinical_scorecard.ece)} />
                <MetricTile label="Latency p99" value={formatLatency(card.clinical_scorecard.latency_p99)} />
            </div>

            <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    <ShieldCheck className="h-4 w-4" />
                    Governance gates
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <GatePill label="Calibration" value={card.gates.calibration} />
                    <GatePill label="Adversarial" value={card.gates.adversarial} />
                    <GatePill label="Safety" value={card.gates.safety} />
                    <GatePill label="Benchmark" value={card.gates.benchmark} />
                    <GatePill label="Manual approval" value={card.gates.manual_approval} />
                </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Lineage</div>
                <div className="mt-3 grid gap-2 text-sm text-slate-300">
                    <MetricRow label="Dataset" value={card.dataset_version ?? 'NO DATA'} />
                    <MetricRow label="Feature schema" value={card.feature_schema_version ?? 'NO DATA'} />
                    <MetricRow label="Label policy" value={card.label_policy_version ?? 'NO DATA'} />
                    <MetricRow label="Updated" value={formatDateTime(card.updated_at)} />
                </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Promotion blockers</div>
                {card.promotion_blockers.length > 0 ? (
                    <div className="mt-3 space-y-2">
                        {card.promotion_blockers.map((reason) => (
                            <div key={reason} className="rounded-xl border border-amber-400/15 bg-amber-400/10 px-3 py-2 text-sm leading-6 text-amber-100">
                                {reason}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                        No active blockers published for this registry entry.
                    </div>
                )}
            </div>
        </article>
    );
}

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-2 break-all text-lg font-semibold text-white">{value}</div>
        </div>
    );
}

function MetricRow({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-400">{label}</span>
            <span className="text-right text-slate-100">{value}</span>
        </div>
    );
}

function FamilyBadge({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
            <span className="text-slate-400">{label}: </span>
            <span>{value}</span>
        </div>
    );
}

function MetricTile({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
            <div className="mt-2 text-lg font-semibold text-white">{value}</div>
        </div>
    );
}

function GatePill({
    label,
    value,
}: {
    label: string;
    value: PublicModelCard['gates'][keyof PublicModelCard['gates']];
}) {
    const tone = value === 'pass'
        ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
        : value === 'fail'
            ? 'border-rose-400/20 bg-rose-400/10 text-rose-200'
            : 'border-amber-400/20 bg-amber-400/10 text-amber-200';

    return (
        <div className={`flex items-center justify-between rounded-full border px-3 py-2 text-sm ${tone}`}>
            <span>{label}</span>
            <span className="font-semibold uppercase">{value}</span>
        </div>
    );
}

function Tag({
    children,
    tone,
}: {
    children: ReactNode;
    tone: 'good' | 'warn' | 'bad' | 'neutral';
}) {
    const toneClass = tone === 'good'
        ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
        : tone === 'warn'
            ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
            : tone === 'bad'
                ? 'border-rose-400/20 bg-rose-400/10 text-rose-200'
                : 'border-white/10 bg-white/5 text-slate-200';

    return (
        <div className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClass}`}>
            {children}
        </div>
    );
}

function formatPercent(value: number | null): string {
    return value == null ? 'NO DATA' : `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value: number | null): string {
    return value == null ? 'NO DATA' : `${Math.round(value)} ms`;
}

function formatDateTime(value: string | null): string {
    if (!value) {
        return 'NO DATA';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}
