import type { Metadata } from 'next';
import Link from 'next/link';
import { BellRing, CalendarClock, ShieldCheck } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { getPublicPetPassSnapshot } from '@/lib/petpass/service';

export const metadata: Metadata = {
    title: 'PetPass',
    description: 'VetIOS consumer-layer PetPass network surface.',
};

export const dynamic = 'force-dynamic';

export default async function PetPassPage() {
    const snapshot = await getPublicPetPassSnapshot();

    return (
        <PlatformShell
            badge={snapshot.data_mode === 'live' ? 'PETPASS NETWORK' : 'PETPASS PREVIEW'}
            title="Start the consumer layer before the network effect starts elsewhere."
            description="PetPass now has a real owner-network substrate underneath it: owner accounts, pet links, clinic sync links, consents, timeline entries, and notification deliveries. The consumer app is still early, but the network plane is no longer just a mock."
            actions={(
                <>
                    <Link
                        href="/api/public/petpass"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                    >
                        JSON snapshot
                        <ShieldCheck className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/platform/passive-signals"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        See signal engine
                        <ShieldCheck className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/platform/network-learning"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        See learning loop
                        <CalendarClock className="h-4 w-4" />
                    </Link>
                </>
            )}
        >
            <div className="grid gap-4 md:grid-cols-4">
                <StatCard label="Mode" value={snapshot.data_mode.toUpperCase()} />
                <StatCard label="Owners" value={String(snapshot.network_summary.owner_accounts)} />
                <StatCard label="Linked Pets" value={String(snapshot.network_summary.linked_pets)} />
                <StatCard label="Sent Alerts" value={String(snapshot.network_summary.sent_notifications)} />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
                <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Owner profile</div>
                    <div className="mt-5 rounded-[24px] border border-cyan-400/15 bg-[linear-gradient(180deg,_rgba(34,211,238,0.18),_rgba(8,17,32,0.2))] p-5">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <div className="text-2xl font-semibold text-white">{snapshot.profile.pet_name}</div>
                                <div className="mt-1 text-sm text-slate-200">
                                    {snapshot.profile.breed} • {snapshot.profile.species} • {snapshot.profile.age_display}
                                </div>
                            </div>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                                snapshot.profile.risk_state === 'stable'
                                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                                    : snapshot.profile.risk_state === 'watch'
                                        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                                        : 'border-rose-400/20 bg-rose-400/10 text-rose-200'
                            }`}>
                                {snapshot.profile.risk_state}
                            </span>
                        </div>
                        <div className="mt-4 text-sm leading-7 text-slate-200">
                            Linked clinic: {snapshot.profile.clinic_name}
                        </div>
                    </div>

                    <div className="mt-6 space-y-3">
                        {snapshot.features.map((feature) => (
                            <div key={feature.title} className="rounded-2xl border border-white/8 bg-black/15 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="text-sm font-semibold text-white">{feature.title}</div>
                                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                                        feature.readiness === 'preview'
                                            ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'
                                            : 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                                    }`}>
                                        {feature.readiness}
                                    </span>
                                </div>
                                <div className="mt-2 text-sm leading-6 text-slate-300">{feature.summary}</div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="grid gap-6">
                    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                            <BellRing className="h-4 w-4" />
                            Active alerts
                        </div>
                        <div className="mt-4 grid gap-4 lg:grid-cols-3">
                            {snapshot.alerts.map((alert) => (
                                <div key={alert.id} className={`rounded-[22px] border p-4 ${
                                    alert.severity === 'urgent'
                                        ? 'border-rose-400/20 bg-rose-400/10'
                                        : alert.severity === 'watch'
                                            ? 'border-amber-400/20 bg-amber-400/10'
                                            : 'border-cyan-400/20 bg-cyan-400/10'
                                }`}>
                                    <div className="text-sm font-semibold text-white">{alert.title}</div>
                                    <div className="mt-2 text-sm leading-6 text-slate-200">{alert.detail}</div>
                                    <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">{alert.action}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Health history timeline</div>
                        <div className="mt-5 space-y-4">
                            {snapshot.timeline.map((item) => (
                                <div key={item.id} className="rounded-2xl border border-white/8 bg-black/15 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="text-sm font-semibold text-white">{item.title}</div>
                                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                                            {item.type}
                                        </div>
                                    </div>
                                    <div className="mt-2 text-sm leading-6 text-slate-300">{item.detail}</div>
                                    <div className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-500">{item.at}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </div>
        </PlatformShell>
    );
}

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-2 text-lg font-semibold text-white">{value}</div>
        </div>
    );
}
