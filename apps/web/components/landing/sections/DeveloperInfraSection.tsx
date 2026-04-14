'use client';

import Link from 'next/link';
import { Database, Gauge, Network, ShieldCheck } from 'lucide-react';
import { endpointCards } from '../data';
import { EndpointCard, Reveal, SectionHeader } from '../shared';

export default function DeveloperInfraSection() {
    return (
        <section className="landing-section">
            <Reveal>
                <SectionHeader
                    eyebrow="developer infrastructure"
                    title="API-first, typed, and observable."
                    description="The platform exposes clear runtime contracts, structured payloads, and direct operational signals for every major loop stage."
                />

                <p className="mt-5 max-w-3xl text-sm leading-7 text-white/55">
                    Examples below match authenticated{' '}
                    <code className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-[#B9FFF0]">
                        /api/*
                    </code>{' '}
                    routes (session cookies or platform scopes). External integrations typically use{' '}
                    <code className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-white/70">
                        api.vetios.tech/v1
                    </code>
                    — see the{' '}
                    <Link className="text-[#9AE4D1] underline decoration-[#38DCC6]/40 underline-offset-4 hover:text-white" href="/api-spec/openapi-v1.yaml">
                        OpenAPI specification
                    </Link>
                    {' '}or{' '}
                    <Link className="text-[#9AE4D1] underline decoration-[#38DCC6]/40 underline-offset-4 hover:text-white" href="/developer">
                        developer hub
                    </Link>
                    .
                </p>

                <div className="mt-14 grid grid-cols-1 gap-6 xl:grid-cols-3">
                    {endpointCards.map((card) => (
                        <EndpointCard key={card.path} {...card} />
                    ))}
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
                    {[
                        { icon: Gauge, label: 'latency channel', value: 'p95 218 ms' },
                        { icon: Network, label: 'event throughput', value: '18.4k spans / min' },
                        { icon: ShieldCheck, label: 'policy evaluation', value: 'shadow + release' },
                        { icon: Database, label: 'trace retention', value: '7 day hot window' },
                    ].map((item) => {
                        const Icon = item.icon;

                        return (
                            <div key={item.label} className="rounded-[24px] border border-white/10 bg-[#0E141B]/92 p-4 sm:p-5">
                                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-[#9AE4D1]">
                                    <Icon className="h-4 w-4" />
                                </div>
                                <div className="mt-4 text-[10px] uppercase tracking-[0.24em] text-white/35">{item.label}</div>
                                <div className="mt-2 text-xs font-medium text-white/85 sm:text-sm">{item.value}</div>
                            </div>
                        );
                    })}
                </div>
                <p className="mt-4 text-center text-[11px] leading-relaxed text-white/38 sm:text-left">
                    Throughput and retention figures are illustrative marketing examples, not live telemetry.
                </p>
            </Reveal>
        </section>
    );
}
