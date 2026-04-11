'use client';

import { modules } from '../data';
import { Reveal, SectionHeader } from '../shared';

export default function ModulesSection() {
    return (
        <section id="modules" className="landing-section scroll-mt-28">
            <Reveal>
                <SectionHeader
                    eyebrow="modules"
                    title="Platform modules for the entire clinical loop"
                    description="Each layer is designed as infrastructure: typed inputs, observable execution, and system-level feedback."
                />

                <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {modules.map((module) => {
                        const Icon = module.icon;

                        return (
                            <div
                                key={module.title}
                                className="rounded-2xl border border-white/10 bg-white/[0.05] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[#38DCC6]/28 hover:bg-white/[0.07]"
                            >
                                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#0D131A] text-[#9AE4D1]">
                                    <Icon className="h-5 w-5" />
                                </div>
                                <h3 className="mt-6 text-2xl font-medium tracking-[-0.03em] text-white">
                                    {module.title}
                                </h3>
                                <p className="mt-4 text-sm leading-7 text-white/60">{module.description}</p>
                            </div>
                        );
                    })}
                </div>
            </Reveal>
        </section>
    );
}
