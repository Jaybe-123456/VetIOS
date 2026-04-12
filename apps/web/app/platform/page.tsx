import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, Workflow, PlugZap, Telescope } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';

export const metadata: Metadata = {
    title: 'Platform',
    description: 'VetIOS platform overview for clinical intelligence infrastructure.',
};

const platformPillars = [
    {
        title: 'Clinical Intelligence Runtime',
        body: 'VetIOS is designed as a system layer for routed inference, governed decision support, and outcome-aware operational workflows.',
        icon: Workflow,
    },
    {
        title: 'Enterprise Integration Surface',
        body: 'The platform is built to connect with real clinical systems, partner tooling, and operational workflows without turning each deployment into a custom project.',
        icon: PlugZap,
    },
    {
        title: 'Trust And Control',
        body: 'Deployment discipline, observability, and governance are treated as first-class platform responsibilities, not afterthoughts.',
        icon: ShieldCheck,
    },
] as const;

const engagementTracks = [
    'Operator access for internal teams running inference, review, and model operations.',
    'Partner onboarding for organizations evaluating integration and deployment alignment.',
    'Governed rollout pathways for teams that need reliability, auditability, and policy control.',
] as const;

const platformPrinciples = [
    'Infrastructure over feature sprawl',
    'Clinical workflows over generic AI demos',
    'Governed deployment over one-off model drops',
    'Compound learning over isolated predictions',
] as const;

export default function PlatformPage() {
    return (
        <PlatformShell
            badge="PLATFORM OVERVIEW"
            title="Infrastructure for veterinary intelligence systems."
            description="VetIOS is built as a clinical intelligence layer for teams that need disciplined inference, operational trust, and scalable integration paths. The public overview stays high level by design."
            showNav={false}
            actions={(
                <>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                    >
                        Access Platform
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                        href="mailto:platform@vetios.ai"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Contact Platform Team
                    </Link>
                </>
            )}
        >
            <section className="grid gap-6 lg:grid-cols-3">
                {platformPillars.map((pillar) => {
                    const Icon = pillar.icon;
                    return (
                        <article key={pillar.title} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
                                <Icon className="h-5 w-5" />
                            </div>
                            <h2 className="mt-5 text-xl font-semibold text-white">{pillar.title}</h2>
                            <p className="mt-3 text-sm leading-7 text-slate-300">{pillar.body}</p>
                        </article>
                    );
                })}
            </section>

            <section className="mt-12 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                        <Telescope className="h-3.5 w-3.5" />
                        Design Principles
                    </div>
                    <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white">Built for serious operating environments.</h2>
                    <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
                        The public platform story is intentionally concise. It communicates the system posture and deployment philosophy without exposing the operating blueprint, internal control surfaces, or detailed partner contracts.
                    </p>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                        {platformPrinciples.map((principle) => (
                            <div key={principle} className="rounded-2xl border border-white/8 bg-black/15 px-4 py-4 text-sm text-slate-200">
                                {principle}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,24,39,0.95),rgba(7,16,31,0.98))] p-8">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Engagement Paths</div>
                    <div className="mt-6 space-y-4">
                        {engagementTracks.map((track) => (
                            <div key={track} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4 text-sm leading-7 text-slate-200">
                                {track}
                            </div>
                        ))}
                    </div>
                    <div className="mt-8 rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-5 text-sm leading-7 text-cyan-50">
                        Detailed product architecture, internal trust controls, and live partner surfaces are restricted to authenticated platform access.
                    </div>
                </div>
            </section>

            <section className="mt-12 rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
                <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Access Model</div>
                        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">Public overview outside. Operational detail inside.</h2>
                        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
                            VetIOS exposes a controlled public narrative while keeping implementation detail, integration contracts, and live operating telemetry inside authenticated surfaces. That boundary is intentional.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                        <Link
                            href="/login"
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                        >
                            Open Console
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                        <Link
                            href="mailto:platform@vetios.ai"
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-3 text-sm text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-400/15"
                        >
                            Request Platform Access
                        </Link>
                    </div>
                </div>
            </section>
        </PlatformShell>
    );
}
