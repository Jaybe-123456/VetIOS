'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { interfaceLogs, interfaceTabs, systemMetrics } from '../data';
import { Panel, Reveal, SectionHeader } from '../shared';
import { joinClasses } from '../utils';

export default function InterfacePreviewSection() {
    const [activeTab, setActiveTab] = useState<(typeof interfaceTabs)[number]['id']>('json');
    const [visibleLogCount, setVisibleLogCount] = useState(3);
    const logRef = useRef<HTMLDivElement | null>(null);
    const activeCode = interfaceTabs.find((tab) => tab.id === activeTab) ?? interfaceTabs[0];

    useEffect(() => {
        const interval = window.setInterval(() => {
            setVisibleLogCount((count) => (count >= interfaceLogs.length ? 3 : count + 1));
        }, 900);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    }, [visibleLogCount]);

    return (
        <section id="system" className="landing-section scroll-mt-28">
            <Reveal>
                <SectionHeader
                    eyebrow="interface preview"
                    title="An operator surface built like a system console."
                    description="The interface is designed as a control plane: visible inputs, observable execution, and direct feedback from outcomes and simulation."
                />

                <div className="mt-14 rounded-[28px] border border-white/10 bg-black/40 p-3 shadow-[0_28px_80px_rgba(0,0,0,0.35)] sm:rounded-[32px] sm:p-4 md:p-6">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 sm:rounded-[24px]">
                        <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                            <span className="h-2.5 w-2.5 rounded-full bg-[#FEBB2E]" />
                            <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-white/36 sm:text-[11px] sm:tracking-[0.24em]">
                            inference-console / production
                        </div>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[1.12fr_0.88fr]">
                        <div className="space-y-4">
                            <Panel className="rounded-[28px] border-white/8 bg-[#0B1117]/92 p-5">
                                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                                    {interfaceTabs.map((tab) => (
                                        <button
                                            type="button"
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id)}
                                            className={joinClasses(
                                                'min-h-[44px] shrink-0 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] transition-all sm:min-h-0 sm:text-[11px] sm:tracking-[0.18em]',
                                                activeTab === tab.id
                                                    ? 'border-[#38DCC6]/28 bg-[#38DCC6]/10 text-[#B9FFF0]'
                                                    : 'border-white/10 bg-white/[0.03] text-white/46 hover:border-white/18 hover:text-white/70',
                                            )}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>

                                <div className="mt-5 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                                    <div className="overflow-x-auto rounded-[22px] border border-white/8 bg-[#090D12] p-4 font-mono text-[10px] leading-6 text-[#9FB0C0] sm:text-[11px]">
                                        <AnimatePresence mode="wait">
                                            <motion.div
                                                key={activeCode.id}
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -8 }}
                                            >
                                                <div className="mb-3 text-white/44">{`// ${activeCode.title} (illustrative)`}</div>
                                                <pre className="whitespace-pre-wrap">{activeCode.body}</pre>
                                            </motion.div>
                                        </AnimatePresence>
                                    </div>

                                    <div className="rounded-[22px] border border-white/8 bg-[#090D12] p-4">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="text-[11px] uppercase tracking-[0.24em] text-white/36">ranked output</div>
                                            <div className="text-xs text-[#CFFFBC]">model: inference-v1.27</div>
                                        </div>
                                        <div className="mt-5 space-y-4">
                                            {[
                                                ['canine_parvovirus', 82],
                                                ['hemorrhagic_gastroenteritis', 49],
                                                ['ehrlichiosis', 17],
                                            ].map(([label, value]) => (
                                                <div key={label}>
                                                    <div className="mb-2 flex items-center justify-between text-xs">
                                                        <span className="text-white/68">{label}</span>
                                                        <span className="text-[#9AE4D1]">{value}%</span>
                                                    </div>
                                                    <div className="h-2 rounded-full bg-white/[0.04]">
                                                        <div
                                                            className="h-2 rounded-full bg-gradient-to-r from-[#38DCC6] to-[#7CFF4E]"
                                                            style={{ width: `${value}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </Panel>

                            <div>
                                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                                    {systemMetrics.map((metric) => (
                                        <div key={metric.label} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                                            <div className="text-[10px] uppercase tracking-[0.24em] text-white/35">{metric.label}</div>
                                            <div className="mt-3 text-lg font-medium tracking-[-0.03em] text-white sm:text-xl">
                                                {metric.value}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <p className="mt-3 text-[10px] text-white/35 sm:text-[11px]">
                                    Console metrics above are static examples for the landing preview, not real-time production numbers.
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <Panel className="rounded-[28px] border-white/8 bg-[#0B1117]/92 p-5">
                                <div className="flex items-center justify-between">
                                    <div className="text-[11px] uppercase tracking-[0.24em] text-white/36">event log</div>
                                    <div className="text-xs text-[#9AE4D1]">streaming</div>
                                </div>
                                <div ref={logRef} className="mt-4 max-h-[280px] space-y-3 overflow-hidden font-mono text-[11px] leading-6 text-[#9FB0C0]">
                                    <AnimatePresence initial={false}>
                                        {interfaceLogs.slice(0, visibleLogCount).map((line) => (
                                            <motion.div
                                                key={line}
                                                className="rounded-2xl border border-white/6 bg-white/[0.02] px-3 py-2"
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -8 }}
                                            >
                                            {line}
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                    <div className="flex items-center gap-2 text-[#7CFF4E]">
                                        <span className="terminal-cursor h-4 w-2 bg-[#7CFF4E]/80" />
                                        <span>tail -f vetios.events</span>
                                    </div>
                                </div>
                            </Panel>

                            <Panel className="rounded-[28px] border-white/8 bg-[#0B1117]/92 p-5">
                                <div className="flex items-center justify-between">
                                    <div className="text-[11px] uppercase tracking-[0.24em] text-white/36">diagnostics</div>
                                    <div className="text-xs text-[#CFFFBC]">policy clean</div>
                                </div>
                                <div className="mt-5 space-y-4">
                                    {[
                                        ['schema integrity', 'validated'],
                                        ['guardrail checks', 'pass'],
                                        ['outcome subscription', 'listening'],
                                    ].map(([label, value]) => (
                                        <div key={label} className="flex flex-col gap-1 border-b border-white/6 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                                            <span className="text-sm text-white/64">{label}</span>
                                            <span className="text-sm font-medium text-white">{value}</span>
                                        </div>
                                    ))}
                                </div>
                            </Panel>
                        </div>
                    </div>
                </div>
            </Reveal>
        </section>
    );
}
