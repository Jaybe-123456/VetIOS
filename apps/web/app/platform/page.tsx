import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, RefreshCw, Route, ShieldCheck, Workflow } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';

export const metadata: Metadata = {
    title: 'Platform',
    description: 'VetIOS platform overview for veterinary inference, outcomes, and simulation.',
    alternates: { canonical: '/platform' },
};

const layers = [
    {
        title: 'Inference',
        body: 'Clinical inputs are normalized, routed through the deterministic clinical inference core, optionally augmented by configured model providers, and stored with CIRE runtime signals.',
        icon: Route,
    },
    {
        title: 'Outcome',
        body: 'Confirmed labels are linked back to inference events, producing calibration deltas that improve future confidence estimates.',
        icon: ShieldCheck,
    },
    {
        title: 'Simulation',
        body: 'Synthetic case variants pressure-test the same inference path and report stability across confidence and safety states.',
        icon: Workflow,
    },
] as const;

export default function PlatformPage() {
    return (
        <PlatformShell
            badge="PLATFORM"
            title="VetIOS closes the loop between prediction, outcome, and simulation."
            description="A tenant-scoped clinical intelligence platform for veterinary teams that need auditable inference, measurable calibration, and simple operational feedback loops."
            showNav={false}
            actions={(
                <>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                    >
                        Get access
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Back to homepage
                    </Link>
                </>
            )}
        >
            <section className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">What VetIOS is</div>
                <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
                    VetIOS is a clinical intelligence layer for veterinary diagnostics. It receives structured case data, runs the versioned inference core, records the result, and keeps later outcomes and simulations connected to the original inference event. Optional external or hosted models are augmentations, not the declared clinical authority.
                </p>
            </section>

            <section className="mt-8">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">The three layers</div>
                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                    {layers.map((layer) => {
                        const Icon = layer.icon;
                        return (
                            <article key={layer.title} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
                                <Icon className="h-5 w-5 text-cyan-200" />
                                <h2 className="mt-4 text-xl font-semibold text-white">{layer.title}</h2>
                                <p className="mt-3 text-sm leading-7 text-slate-300">{layer.body}</p>
                            </article>
                        );
                    })}
                </div>
            </section>

            <section className="mt-8 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                <div>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                        <RefreshCw className="h-4 w-4" />
                        How the loop compounds
                    </div>
                    <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
                        Each resolved outcome writes a calibration delta. The next inference for the same tenant can read that per-label adjustment, nudging confidence without retraining weights or adding a new ML subsystem.
                    </p>
                </div>
                <Link
                    href="/signup"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-200 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-100"
                >
                    Get access
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </section>
        </PlatformShell>
    );
}
