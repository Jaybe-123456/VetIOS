import type { Metadata } from 'next';
import Link from 'next/link';
import { Braces, ShieldCheck } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { getCireOpenStandard } from '@/lib/cire/standard';
import { getConfiguredSiteOrigin } from '@/lib/site';

export const metadata: Metadata = {
    title: 'CIRE Public Specification',
    description: 'Public VetIOS runtime telemetry and conformance specification for phi_hat, CPS, safety states, and audit lineage.',
    alternates: {
        canonical: '/platform/cire-standard',
    },
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
        },
    },
};

export default function CireStandardPage() {
    const standard = getCireOpenStandard(getConfiguredSiteOrigin() ?? 'https://www.vetios.tech');

    return (
        <PlatformShell
            badge="PUBLIC SPECIFICATION"
            title="CIRE is the runtime signal contract for veterinary AI infrastructure."
            description="VetIOS publishes the CIRE methodology as a versioned telemetry and conformance specification. Its signals describe output structure and publication state; clinical reliability still requires outcome-linked and external validation. The reference implementation remains subject to the VetIOS licence."
            actions={(
                <Link
                    href="/api/public/cire-standard"
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                >
                    JSON standard
                    <Braces className="h-4 w-4" />
                </Link>
            )}
        >
            <section className="grid gap-4 md:grid-cols-4">
                <MetricCard label="Version" value={standard.version} />
                <MetricCard label="Status" value={standard.status.replace('_', ' ').toUpperCase()} />
                <MetricCard label="Runtime" value={standard.implementation.runtime_surface} />
                <MetricCard label="Package" value={standard.implementation.package_name} />
            </section>

            <section className="mt-10 grid gap-6 xl:grid-cols-[1fr_0.85fr]">
                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        <ShieldCheck className="h-4 w-4" />
                        Reference formulas
                    </div>
                    <div className="mt-5 space-y-4">
                        {standard.formulas.map((formula) => (
                            <article key={formula.key} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <h2 className="font-mono text-base text-white">{formula.key}</h2>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300">
                                        {formula.range}
                                    </span>
                                </div>
                                <p className="mt-2 text-sm font-semibold text-slate-100">{formula.name}</p>
                                <pre className="mt-3 overflow-x-auto rounded-xl border border-white/6 bg-[#07101f] p-3 font-mono text-xs leading-6 text-cyan-100">
                                    {formula.formula}
                                </pre>
                                <p className="mt-3 text-sm leading-7 text-slate-300">{formula.interpretation}</p>
                            </article>
                        ))}
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Safety states</div>
                        <div className="mt-4 space-y-3">
                            {standard.safety_states.map((state) => (
                                <div key={state.safety_state} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="font-mono text-sm text-white">{state.safety_state}</span>
                                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-200">
                                            {state.reliability_badge}
                                        </span>
                                    </div>
                                    <p className="mt-3 text-sm leading-6 text-slate-300">{state.meaning}</p>
                                    <p className="mt-2 text-sm leading-6 text-cyan-100">{state.expected_action}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Required lineage fields</div>
                        <div className="mt-4 flex flex-wrap gap-2">
                            {standard.required_runtime_fields.map((field) => (
                                <span key={field} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-slate-200">
                                    {field}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section className="mt-10 rounded-[24px] border border-cyan-400/15 bg-cyan-400/10 p-6 text-cyan-50">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Infrastructure posture</div>
                <p className="mt-3 max-w-4xl text-sm leading-7">
                    The specification is public; the managed VetIOS infrastructure remains the commercial product. Partners can implement the runtime signal contract, while production deployments use VetIOS for hosted lineage, outcomes, model cards, network learning, and enterprise/government API access.
                </p>
            </section>
        </PlatformShell>
    );
}
function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-2 break-words text-lg font-semibold text-white">{value}</div>
        </div>
    );
}
