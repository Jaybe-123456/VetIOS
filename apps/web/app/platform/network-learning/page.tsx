import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BrainCircuit } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { getPublicNetworkLearningSnapshot } from '@/lib/platform/networkLearning';

export const metadata: Metadata = {
    title: 'Network Learning',
    description: 'VetIOS public learning-loop and compounding-data snapshot.',
};

export const dynamic = 'force-dynamic';

export default async function NetworkLearningPage() {
    const snapshot = await getPublicNetworkLearningSnapshot();

    return (
        <PlatformShell
            badge="NETWORK LEARNING"
            title="Show the flywheel, not just the slogan."
            description="This surface exposes the learning-loop evidence behind VetIOS: dataset versions, benchmark reports, calibration reports, audit activity, and now the first live federation layer for participating clinics."
            actions={(
                <>
                    <Link
                        href="/api/public/network-learning"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                    >
                        JSON snapshot
                        <BrainCircuit className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/experiments"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Open experiments
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </>
            )}
        >
            <div className="grid gap-4 md:grid-cols-4">
                <StatCard label="Configured" value={snapshot.configured ? 'YES' : 'NO'} />
                <StatCard label="Dataset versions" value={String(snapshot.summary.dataset_versions)} />
                <StatCard label="Benchmark reports" value={String(snapshot.summary.benchmark_reports)} />
                <StatCard label="Calibration reports" value={String(snapshot.summary.calibration_reports)} />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-4">
                <StatCard label="Federation" value={snapshot.federation.active ? 'LIVE' : 'OFF'} />
                <StatCard label="Participants" value={String(snapshot.federation.participant_count)} />
                <StatCard label="Federation rounds" value={String(snapshot.federation.recent_rounds)} />
                <StatCard label="Aggregate rows" value={snapshot.federation.aggregate_dataset_rows.toLocaleString('en-US')} />
            </div>

            {!snapshot.configured ? (
                <section className="mt-10 rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-8 text-amber-100">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Configuration needed</div>
                    <h2 className="mt-2 text-2xl font-semibold text-white">The learning snapshot is wired, but no public tenant is configured.</h2>
                    <p className="mt-4 max-w-3xl text-sm leading-7">
                        Set <code className="rounded bg-black/20 px-1.5 py-0.5 text-amber-100">VETIOS_PUBLIC_TENANT_ID</code> or sign in to inspect a tenant-scoped learning loop publicly.
                    </p>
                </section>
            ) : (
                <>
                    <section className="mt-10 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
                        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Compounding summary</div>
                            <div className="mt-4 space-y-3">
                                <MetricRow label="Source" value={snapshot.source.toUpperCase()} />
                                <MetricRow label="Tenant" value={snapshot.tenant_id ?? 'NO DATA'} />
                                <MetricRow label="Latest dataset" value={snapshot.summary.latest_dataset_version ?? 'NO DATA'} />
                                <MetricRow label="Latest benchmark status" value={snapshot.summary.latest_benchmark_pass_status ?? 'NO DATA'} />
                                <MetricRow label="Latest calibration ECE" value={formatPercent(snapshot.summary.latest_calibration_ece)} />
                                <MetricRow label="Rows across recent datasets" value={snapshot.summary.total_dataset_rows.toLocaleString('en-US')} />
                            </div>
                        </div>

                        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Why this matters</div>
                            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-300">
                                <p>
                                    VetIOS already compounds value through inference, outcomes, benchmarks, and governance.
                                    This page makes that loop inspectable outside the operator console.
                                </p>
                                <p>
                                    The federation substrate now supports tenant memberships, coordinator governance, automated allow-list enrollment, scheduled rounds, and weighted aggregation. The next frontier is stronger privacy-preserving exchange.
                                </p>
                            </div>
                        </div>
                    </section>

                    <section className="mt-10 grid gap-6 xl:grid-cols-2">
                        <Panel title="Federation Status">
                            <MetricRow label="Federation key" value={snapshot.federation.federation_key ?? 'NO DATA'} />
                                <MetricRow label="Latest round" value={snapshot.federation.latest_round_status?.toUpperCase() ?? 'NO DATA'} />
                                <MetricRow label="Latest snapshot" value={snapshot.federation.latest_snapshot_at ? formatDateTime(snapshot.federation.latest_snapshot_at) : 'NO DATA'} />
                                <MetricRow label="Enrollment mode" value={snapshot.federation.enrollment_mode?.toUpperCase() ?? 'NO DATA'} />
                                <MetricRow label="Next scheduled round" value={snapshot.federation.next_round_due_at ? formatDateTime(snapshot.federation.next_round_due_at) : 'NO DATA'} />
                                <MetricRow label="Benchmark pass rate" value={formatPercent(snapshot.federation.benchmark_pass_rate)} />
                                <MetricRow label="Calibration avg ECE" value={formatPercent(snapshot.federation.calibration_avg_ece)} />
                                <MetricRow label="Diagnosis candidate" value={snapshot.federation.diagnosis_candidate_version ?? 'NO DATA'} />
                                <MetricRow label="Severity candidate" value={snapshot.federation.severity_candidate_version ?? 'NO DATA'} />
                            </Panel>

                        <Panel title="What The Federation Means">
                            <div className="space-y-4 text-sm leading-7 text-slate-300">
                                <p>
                                    Participating clinics can now publish site snapshots, enroll through coordinator governance, and run weighted federation rounds that aggregate champion artifact structure into a network candidate.
                                </p>
                                <p>
                                    Automated round scheduling, allow-list enrollment, and benchmark-calibration gates are now live. This still does not replace deeper privacy-preserving secure aggregation, but it moves VetIOS from a tenant-only loop into a real federation control plane.
                                </p>
                            </div>
                        </Panel>
                    </section>

                    <section className="mt-10 grid gap-6 xl:grid-cols-2">
                        <Panel title="Recent datasets">
                            {snapshot.recent_datasets.length > 0 ? snapshot.recent_datasets.map((dataset) => (
                                <RowCard
                                    key={`${dataset.dataset_version}:${dataset.dataset_kind}:${dataset.created_at}`}
                                    title={dataset.dataset_version}
                                    detail={`${dataset.dataset_kind} • ${dataset.row_count.toLocaleString('en-US')} rows`}
                                    meta={formatDateTime(dataset.created_at)}
                                />
                            )) : <EmptyState text="No dataset versions published yet." />}
                        </Panel>

                        <Panel title="Recent benchmark reports">
                            {snapshot.recent_benchmarks.length > 0 ? snapshot.recent_benchmarks.map((benchmark) => (
                                <RowCard
                                    key={`${benchmark.benchmark_family}:${benchmark.task_type}:${benchmark.created_at}`}
                                    title={`${benchmark.benchmark_family} • ${benchmark.pass_status}`}
                                    detail={`${benchmark.task_type}${benchmark.summary_score == null ? '' : ` • score ${benchmark.summary_score.toFixed(2)}`}`}
                                    meta={formatDateTime(benchmark.created_at)}
                                />
                            )) : <EmptyState text="No benchmark reports published yet." />}
                        </Panel>

                        <Panel title="Recent calibration reports">
                            {snapshot.recent_calibrations.length > 0 ? snapshot.recent_calibrations.map((calibration) => (
                                <RowCard
                                    key={`${calibration.task_type}:${calibration.created_at}`}
                                    title={calibration.task_type}
                                    detail={`ECE ${formatPercent(calibration.ece_score)} • Brier ${formatPercent(calibration.brier_score)}`}
                                    meta={formatDateTime(calibration.created_at)}
                                />
                            )) : <EmptyState text="No calibration reports published yet." />}
                        </Panel>

                        <Panel title="Recent audit events">
                            {snapshot.recent_audit_events.length > 0 ? snapshot.recent_audit_events.map((event) => (
                                <RowCard
                                    key={`${event.event_type}:${event.created_at}`}
                                    title={event.event_type}
                                    detail="Learning audit event"
                                    meta={formatDateTime(event.created_at)}
                                />
                            )) : <EmptyState text="No audit activity published yet." />}
                        </Panel>
                    </section>
                </>
            )}
        </PlatformShell>
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

function Panel({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</div>
            <div className="mt-4 space-y-3">{children}</div>
        </div>
    );
}

function RowCard({
    title,
    detail,
    meta,
}: {
    title: string;
    detail: string;
    meta: string;
}) {
    return (
        <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className="mt-1 text-sm text-slate-300">{detail}</div>
            <div className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">{meta}</div>
        </div>
    );
}

function EmptyState({ text }: { text: string }) {
    return <div className="rounded-2xl border border-white/8 bg-black/15 p-4 text-sm text-slate-300">{text}</div>;
}

function MetricRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-400">{label}</span>
            <span className="text-right text-slate-100">{value}</span>
        </div>
    );
}

function formatPercent(value: number | null): string {
    return value == null ? 'NO DATA' : `${(value * 100).toFixed(1)}%`;
}

function formatDateTime(value: string): string {
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
