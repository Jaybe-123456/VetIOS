'use client';

import { interfaceLogs, systemMetrics } from '../data';
import { Panel, Reveal, SectionHeader } from '../shared';

export default function InterfacePreviewSection() {
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
                                    {['case.input.json', 'runtime.trace', 'policy.guard'].map((tab, index) => (
                                        <div
                                            key={tab}
                                            className={
                                                index === 0
                                                    ? 'shrink-0 rounded-full border border-[#38DCC6]/28 bg-[#38DCC6]/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#B9FFF0] sm:text-[11px] sm:tracking-[0.18em]'
                                                    : 'shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/46 sm:text-[11px] sm:tracking-[0.18em]'
                                            }
                                        >
                                            {tab}
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-5 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                                    <div className="overflow-x-auto rounded-[22px] border border-white/8 bg-[#090D12] p-4 font-mono text-[10px] leading-6 text-[#9FB0C0] sm:text-[11px]">
                                        <div className="mb-3 text-white/44">{'// case.input.json (illustrative)'}</div>
                                        <div>{'{'}</div>
                                        <div className="pl-4">{'"model": { "name": "VetIOS Diagnostics", "version": "latest" },'}</div>
                                        <div className="pl-4">{'"input": {'}</div>
                                        <div className="pl-8">{'"input_signature": {'}</div>
                                        <div className="pl-12">{'"species": "canine",'}</div>
                                        <div className="pl-12">{'"symptoms": ["vomiting", "lethargy"],'}</div>
                                        <div className="pl-12">{'"metadata": {'}</div>
                                        <div className="pl-16">{'"labs": { "wbc": 4.1, "pcv": 29 },'}</div>
                                        <div className="pl-16">{'"hydration": "low"'}</div>
                                        <div className="pl-12">{'}'}</div>
                                        <div className="pl-8">{'}'}</div>
                                        <div className="pl-4">{'}'}</div>
                                        <div>{'}'}</div>
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
                                <div className="mt-4 space-y-3 font-mono text-[11px] leading-6 text-[#9FB0C0]">
                                    {interfaceLogs.map((line) => (
                                        <div key={line} className="rounded-2xl border border-white/6 bg-white/[0.02] px-3 py-2">
                                            {line}
                                        </div>
                                    ))}
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
