import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BellRing, MapPinned, ShieldCheck } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { getPopulationSignalService } from '@/lib/populationSignal/populationSignalService';

export const metadata: Metadata = {
    title: 'Population Intelligence',
    description: 'Aggregate VetIOS disease surveillance and public-health safe advisory feed.',
};

export const dynamic = 'force-dynamic';

export default async function PopulationIntelligencePage() {
    const feed = await getPopulationSignalService().getPublicPopulationIntelligence({ limit: 24 });
    const emergencyCount = feed.advisories.filter((advisory) => advisory.severity === 'emergency').length;
    const alertCount = feed.advisories.filter((advisory) => advisory.severity === 'alert').length;
    const regions = new Set(feed.advisories.map((advisory) => advisory.region)).size;

    return (
        <PlatformShell
            badge="POPULATION INTELLIGENCE"
            title="Turn de-identified case flow into regional disease intelligence."
            description="VetIOS converts aggregate outbreak signals into public-health safe advisories with minimum-clinic thresholds. The feed is built to help clinics, associations, universities, NGOs, and government partners see emerging veterinary patterns without exposing clinic or patient records."
            actions={(
                <>
                    <Link
                        href="/api/public/population-intelligence"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                    >
                        JSON feed
                        <BellRing className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/api/population-signal/report"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Internal signal API
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </>
            )}
        >
            <div className="grid gap-4 md:grid-cols-4">
                <SummaryCard label="Published advisories" value={String(feed.advisories.length)} />
                <SummaryCard label="Regions" value={String(regions)} />
                <SummaryCard label="Emergency signals" value={String(emergencyCount)} />
                <SummaryCard label="Alert signals" value={String(alertCount)} />
            </div>

            <section className="mt-10 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Privacy Gate
                    </div>
                    <div className="mt-5 space-y-4">
                        <MetricRow label="Boundary" value="Aggregate only" />
                        <MetricRow label="Minimum clinics" value={String(feed.minimumClinics)} />
                        <MetricRow label="Source" value={feed.source.toUpperCase()} />
                        <MetricRow label="Generated" value={formatDateTime(feed.generatedAt)} />
                    </div>
                    <p className="mt-5 text-sm leading-7 text-slate-300">
                        Public advisories exclude tenant IDs, clinic identifiers, patient identifiers, owner identifiers, and inference event IDs. Low-support signals are suppressed before publication.
                    </p>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                        <MapPinned className="h-3.5 w-3.5" />
                        Advisory Feed
                    </div>

                    <div className="mt-5 space-y-4">
                        {feed.advisories.length > 0 ? feed.advisories.map((advisory) => (
                            <article key={advisory.advisoryKey} className="rounded-[20px] border border-white/8 bg-black/20 p-5">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                            {advisory.region} / {advisory.species}
                                        </div>
                                        <h2 className="mt-2 text-lg font-semibold text-white">{advisory.disease}</h2>
                                    </div>
                                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${severityClass(advisory.severity)}`}>
                                        {advisory.severity}
                                    </span>
                                </div>
                                <p className="mt-4 text-sm leading-7 text-slate-300">{advisory.publicSummary}</p>
                                <div className="mt-4 grid gap-3 md:grid-cols-3">
                                    <MetricPill label="Current" value={String(advisory.currentCount)} />
                                    <MetricPill label="Baseline" value={String(advisory.baselineCount)} />
                                    <MetricPill label="Clinics" value={`${advisory.affectedClinics}+`} />
                                </div>
                                <div className="mt-4 space-y-2">
                                    {advisory.recommendedActions.slice(0, 3).map((action) => (
                                        <div key={action} className="text-sm leading-6 text-slate-300">{action}</div>
                                    ))}
                                </div>
                            </article>
                        )) : (
                            <div className="rounded-[20px] border border-white/8 bg-black/20 p-5 text-sm leading-7 text-slate-300">
                                No public population advisories are available yet. This means the current signal set is either quiet or below the publication threshold.
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </PlatformShell>
    );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-2 break-all text-lg font-semibold text-white">{value}</div>
        </div>
    );
}

function MetricRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-400">{label}</span>
            <span className="text-right text-slate-100">{value}</span>
        </div>
    );
}

function MetricPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[16px] border border-white/8 bg-white/[0.04] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
            <div className="mt-1 text-sm font-semibold text-white">{value}</div>
        </div>
    );
}

function severityClass(severity: string): string {
    if (severity === 'emergency') return 'border-rose-300/25 bg-rose-400/10 text-rose-100';
    if (severity === 'alert') return 'border-amber-300/25 bg-amber-400/10 text-amber-100';
    if (severity === 'warning') return 'border-yellow-300/25 bg-yellow-400/10 text-yellow-100';
    return 'border-cyan-300/25 bg-cyan-400/10 text-cyan-100';
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
