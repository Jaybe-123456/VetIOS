'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { networkPoints } from '../data';
import { Panel, Reveal, SectionHeader } from '../shared';

export default function GlobalNetworkSection() {
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);

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
                            <div className="absolute inset-0 grid grid-cols-2 gap-3 overflow-y-auto p-4 sm:hidden">
                                {networkPoints.map((point) => (
                                    <button
                                        type="button"
                                        key={point.label}
                                        onClick={() => setHoveredNode(hoveredNode === point.label ? null : point.label)}
                                        className="min-h-[44px] rounded-[18px] border border-white/8 bg-[#0F151D]/80 px-3 py-3 text-left transition-colors hover:border-[#38DCC6]/24"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="h-2.5 w-2.5 rounded-full bg-[#6BF7CF] shadow-[0_0_16px_rgba(21,230,195,0.95)]" />
                                            <span className="text-[10px] uppercase tracking-[0.16em] text-white/68">{point.label}</span>
                                        </div>
                                        {hoveredNode === point.label && (
                                            <div className="mt-3 grid gap-1.5 text-[11px] text-white/58">
                                                <div className="flex justify-between gap-2"><span>latency</span><span className="text-white">{point.latency}</span></div>
                                                <div className="flex justify-between gap-2"><span>CPU</span><span className="text-white">{point.load}</span></div>
                                                <div className="flex justify-between gap-2"><span>models</span><span className="text-white">{point.models}</span></div>
                                            </div>
                                        )}
                                    </button>
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
                                <path className="animate-dash-flow" d="M92 272 C192 178 298 126 440 154" fill="none" stroke="url(#network-line)" strokeWidth="2.5" />
                                <path className="animate-dash-flow animation-delay-200" d="M440 154 C548 180 626 198 756 162" fill="none" stroke="url(#network-line)" strokeWidth="2.5" />
                                <path className="animate-dash-flow animation-delay-400" d="M756 162 C860 130 972 128 1094 198" fill="none" stroke="url(#network-line)" strokeWidth="2.5" />
                                <path className="animate-dash-flow animation-delay-600" d="M440 154 C548 238 642 290 756 308" fill="none" stroke="url(#network-line)" strokeWidth="2.5" />
                                <path className="animate-dash-flow animation-delay-800" d="M756 308 C852 276 958 242 1098 236" fill="none" stroke="url(#network-line)" strokeWidth="2.5" />
                            </svg>

                            {networkPoints.map((point) => (
                                <motion.div
                                    key={point.label}
                                    className="absolute hidden -translate-x-1/2 -translate-y-1/2 sm:block"
                                    style={{ left: point.left, top: point.top }}
                                    onMouseEnter={() => setHoveredNode(point.label)}
                                    onMouseLeave={() => setHoveredNode(null)}
                                    whileHover={{ scale: 1.04 }}
                                >
                                    <div className="mx-auto h-3 w-3 rounded-full bg-[#6BF7CF] shadow-[0_0_16px_rgba(21,230,195,0.95)]" />
                                    <div className="mt-3 rounded-full border border-white/10 bg-[#0F151D]/90 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white/65">
                                        {point.label}
                                    </div>
                                    {hoveredNode === point.label && (
                                        <motion.div
                                            className="absolute left-1/2 top-full z-10 mt-3 w-48 -translate-x-1/2 rounded-[18px] border border-[#38DCC6]/24 bg-[#071018]/95 p-3 text-left shadow-[0_18px_42px_rgba(0,0,0,0.42)] backdrop-blur-md"
                                            initial={{ opacity: 0, y: -4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                        >
                                            <div className="text-[10px] uppercase tracking-[0.18em] text-[#9AE4D1]">node telemetry</div>
                                            <div className="mt-3 grid gap-2 text-xs text-white/68">
                                                <div className="flex justify-between gap-3"><span>latency</span><span className="text-white">{point.latency}</span></div>
                                                <div className="flex justify-between gap-3"><span>CPU load</span><span className="text-white">{point.load}</span></div>
                                                <div className="flex justify-between gap-3"><span>models</span><span className="text-white">{point.models}</span></div>
                                            </div>
                                        </motion.div>
                                    )}
                                </motion.div>
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
