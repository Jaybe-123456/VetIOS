import type { Metadata } from 'next';
import Link from 'next/link';
import { BellRing, CalendarClock, ShieldCheck } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { petPassPreview } from '@/lib/platform/petpassPreview';

export const metadata: Metadata = {
    title: 'PetPass',
    description: 'VetIOS consumer-layer PetPass preview.',
};

export default function PetPassPage() {
    return (
        <PlatformShell
            badge="PETPASS PREVIEW"
            title="Start the consumer layer before the network effect starts elsewhere."
            description="PetPass is now represented by a concrete owner-facing preview inside VetIOS. It is not yet a fully backed production consumer app, but it establishes the product shape for owner alerts, health history, and clinic-to-owner follow-through."
            actions={(
                <>
                    <Link
                        href="/platform/passive-signals"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
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
            <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
                <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Owner profile</div>
                    <div className="mt-5 rounded-[24px] border border-cyan-400/15 bg-[linear-gradient(180deg,_rgba(34,211,238,0.18),_rgba(8,17,32,0.2))] p-5">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <div className="text-2xl font-semibold text-white">{petPassPreview.profile.pet_name}</div>
                                <div className="mt-1 text-sm text-slate-200">
                                    {petPassPreview.profile.breed} • {petPassPreview.profile.species} • {petPassPreview.profile.age_display}
                                </div>
                            </div>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                                petPassPreview.profile.risk_state === 'stable'
                                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                                    : petPassPreview.profile.risk_state === 'watch'
                                        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                                        : 'border-rose-400/20 bg-rose-400/10 text-rose-200'
                            }`}>
                                {petPassPreview.profile.risk_state}
                            </span>
                        </div>
                        <div className="mt-4 text-sm leading-7 text-slate-200">
                            Linked clinic: {petPassPreview.profile.clinic_name}
                        </div>
                    </div>

                    <div className="mt-6 space-y-3">
                        {petPassPreview.features.map((feature) => (
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
                            {petPassPreview.alerts.map((alert) => (
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
                            {petPassPreview.timeline.map((item) => (
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
