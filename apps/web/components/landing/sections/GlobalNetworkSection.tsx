'use client';

import { networkPoints } from '../data';
import { Panel, Reveal, SectionHeader } from '../shared';

export default function GlobalNetworkSection() {
    return (
        <section className="landing-section">
            <Reveal>
                <SectionHeader
                    eyebrow="global network"
                    title="Distributed intelligence, not a single deployment."
                    description="VetIOS scales as a distributed intelligence network."
                />

                <Panel className="relative mt-14 overflow-hidden px-4 py-6 sm:px-6 sm:py-8 md:px-10 md:py-10">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_16%,rgba(124,255,78,0.08),transparent_28%),radial-gradient(circle_at_84%_30%,rgba(21,230,195,0.12),transparent_30%)]" />
                    <div className="relative grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
                        <div className="relative min-h-[280px] overflow-hidden rounded-[28px] border border-white/8 bg-[#0C1117] sm:min-h-[320px]">
                            <div className="landing-grid absolute inset-0 opacity-[0.16]" />
                            <div className="absolute inset-0 grid grid-cols-2 gap-3 p-4 sm:hidden">
                                {networkPoints.map((point) => (
                                    <div
                                        key={point.label}
                                        className="rounded-[18px] border border-white/8 bg-[#0F151D]/80 px-3 py-3"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="h-2.5 w-2.5 rounded-full bg-[#6BF7CF] shadow-[0_0_16px_rgba(21,230,195,0.95)]" />
                                            <span className="text-[10px] uppercase tracking-[0.16em] text-white/68">{point.label}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <svg viewBox="0 0 1200 460" className="absolute inset-0 hidden h-full w-full opacity-85 sm:block">
                                <defs>
                                    <linearGradient id="network-line" x1="0" x2="1">
                                        <stop offset="0%" stopColor="rgba(21,230,195,0.06)" />
                                        <stop offset="40%" stopColor="rgba(21,230,195,0.85)" />
                                        <stop offset="100%" stopColor="rgba(124,255,78,0.36)" />
                                    </linearGradient>
                                </defs>
                                <path d="M92 272 C192 178 298 126 440 154" fill="none" stroke="url(#network-line)" strokeWidth="2.5" />
                                <path d="M440 154 C548 180 626 198 756 162" fill="none" stroke="url(#network-line)" strokeWidth="2.5" />
                                <path d="M756 162 C860 130 972 128 1094 198" fill="none" stroke="url(#network-line)" strokeWidth="2.5" />
                                <path d="M440 154 C548 238 642 290 756 308" fill="none" stroke="url(#network-line)" strokeWidth="2.5" strokeDasharray="6 8" />
                                <path d="M756 308 C852 276 958 242 1098 236" fill="none" stroke="url(#network-line)" strokeWidth="2.5" />
                            </svg>

                            {networkPoints.map((point) => (
                                <div
                                    key={point.label}
                                    className="absolute hidden -translate-x-1/2 -translate-y-1/2 sm:block"
                                    style={{ left: point.left, top: point.top }}
                                >
                                    <div className="mx-auto h-3 w-3 rounded-full bg-[#6BF7CF] shadow-[0_0_16px_rgba(21,230,195,0.95)]" />
                                    <div className="mt-3 rounded-full border border-white/10 bg-[#0F151D]/90 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white/65">
                                        {point.label}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex flex-col justify-between gap-6">
                            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                                <div className="text-[11px] uppercase tracking-[0.24em] text-white/36">deployment model</div>
                                <p className="mt-4 text-base leading-7 text-white/66">
                                    Each cluster can ingest, infer, simulate, and report locally while contributing to the shared system graph.
                                </p>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
                                {[
                                    ['cluster independence', 'policy aware'],
                                    ['shared learning', 'event synchronized'],
                                    ['control plane', 'runtime visible'],
                                ].map(([label, value]) => (
                                    <div key={label} className="rounded-[24px] border border-white/10 bg-[#0F151D]/90 p-5">
                                        <div className="text-[10px] uppercase tracking-[0.24em] text-white/35">{label}</div>
                                        <div className="mt-2 text-sm font-medium text-white/85">{value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </Panel>
            </Reveal>
        </section>
    );
}
