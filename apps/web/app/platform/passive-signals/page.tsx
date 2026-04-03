import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, PlugZap } from 'lucide-react';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { passiveSignalConnectors } from '@/lib/platform/passiveSignalCatalog';
import { passiveSignalMarketplace } from '@/lib/platform/passiveSignalMarketplace';

export const metadata: Metadata = {
    title: 'Passive Signals',
    description: 'VetIOS passive signal engine catalog and connector readiness.',
};

export default function PassiveSignalsPage() {
    return (
        <PlatformShell
            badge="PASSIVE SIGNAL ENGINE"
            title="Turn clinic work into clinical signal without asking the team to type everything twice."
            description="VetIOS already normalizes passive connector events into episode-aware signals. This surface now publishes both the normalized connector types and the connector marketplace packs that schedule vendor sync at fleet scale."
            actions={(
                <>
                    <Link
                        href="/outcome"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
                    >
                        Open workflow panel
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                        href="/platform/developers"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                    >
                        Connector API docs
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </>
            )}
        >
            <div className="grid gap-4 md:grid-cols-3">
                <SummaryCard label="Supported connectors" value={String(passiveSignalConnectors.filter((connector) => connector.readiness === 'live').length)} />
                <SummaryCard label="Marketplace packs" value={String(passiveSignalMarketplace.length)} />
                <SummaryCard label="Scheduled vendors" value={String(passiveSignalMarketplace.filter((connector) => connector.sync_mode === 'scheduled_pull').length)} />
            </div>

            <section className="mt-10 grid gap-6 xl:grid-cols-2">
                {passiveSignalMarketplace.map((connector) => (
                    <article key={connector.id} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                                    <PlugZap className="h-3.5 w-3.5" />
                                    {connector.vendor_name}
                                </div>
                                <h2 className="mt-4 text-xl font-semibold text-white">{connector.label}</h2>
                            </div>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                                connector.readiness === 'live'
                                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                                    : connector.readiness === 'beta'
                                        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                                        : 'border-rose-400/20 bg-rose-400/10 text-rose-200'
                            }`}>
                                {connector.readiness}
                            </span>
                        </div>
                        <p className="mt-4 text-sm leading-7 text-slate-300">{connector.summary}</p>
                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                            <MetricCard label="Sync mode" value={connector.sync_mode} />
                            <MetricCard label="Auth" value={connector.auth_strategy} />
                            <MetricCard label="Schedule" value={connector.sample_schedule ?? 'manual'} />
                            <MetricCard label="Connector types" value={connector.supported_connector_types.join(', ')} />
                        </div>
                    </article>
                ))}
            </section>

            <section className="mt-10 grid gap-6 xl:grid-cols-2">
                {passiveSignalConnectors.map((connector) => (
                    <article key={connector.id} className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                                    <PlugZap className="h-3.5 w-3.5" />
                                    {connector.sourceType}
                                </div>
                                <h2 className="mt-4 text-xl font-semibold text-white">{connector.label}</h2>
                            </div>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                                connector.readiness === 'live'
                                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                                    : connector.readiness === 'beta'
                                        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
                                        : 'border-rose-400/20 bg-rose-400/10 text-rose-200'
                            }`}>
                                {connector.readiness}
                            </span>
                        </div>

                        <p className="mt-4 text-sm leading-7 text-slate-300">{connector.summary}</p>

                        <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Normalized facts</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {connector.normalizedFacts.map((fact) => (
                                    <span key={fact} className="rounded-full border border-white/8 bg-white/[0.05] px-3 py-1 text-xs text-slate-200">
                                        {fact}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className="mt-5 rounded-2xl border border-white/8 bg-[#0a1323] p-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Sample vendor payload</div>
                            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-white/6 bg-black/20 p-3 font-mono text-xs leading-6 text-slate-200">
                                {JSON.stringify(connector.samplePayload, null, 2)}
                            </pre>
                        </div>
                    </article>
                ))}
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

function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[18px] border border-white/8 bg-black/20 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-2 text-sm text-slate-100">{value}</div>
        </div>
    );
}
