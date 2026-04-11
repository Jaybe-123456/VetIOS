'use client';

import { architectureNodes } from '../data';
import { Panel, Reveal, SectionHeader } from '../shared';

export default function ArchitectureSection() {
    return (
        <section id="architecture" className="landing-section scroll-mt-28">
            <Reveal>
                <SectionHeader
                    eyebrow="architecture"
                    title="One runtime. Five compounding stages."
                    description="VetIOS operates as a compounding intelligence loop, not a static model."
                />

                <div className="relative mt-14">
                    <div className="pointer-events-none absolute left-0 right-0 top-1/2 hidden h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-[#38DCC6]/45 to-transparent xl:block" />
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                        {architectureNodes.map((node, index) => {
                            const Icon = node.icon;

                            return (
                                <Panel
                                    key={node.title}
                                    className="group relative overflow-hidden rounded-[28px] p-5 transition-all duration-300 hover:-translate-y-1 hover:border-[#38DCC6]/30 hover:bg-white/[0.05]"
                                >
                                    <div className="absolute right-5 top-5 text-[10px] uppercase tracking-[0.24em] text-white/24">
                                        0{index + 1}
                                    </div>
                                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-[#91FFE4]">
                                        <Icon className="h-5 w-5" />
                                    </div>
                                    <div className="mt-5 text-xl font-medium tracking-[-0.03em] text-white">
                                        {node.title}
                                    </div>
                                    <p className="mt-3 text-sm leading-7 text-white/60">{node.detail}</p>
                                </Panel>
                            );
                        })}
                    </div>
                </div>
            </Reveal>
        </section>
    );
}
