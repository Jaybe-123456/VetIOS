'use client';

import { stackBlocks, techStackDescriptions } from '../data';
import { Reveal, SectionHeader } from '../shared';

export default function TechStackSection() {
    return (
        <section className="landing-section">
            <Reveal>
                <SectionHeader
                    eyebrow="tech stack"
                    title="Built from production primitives."
                    description="The stack is arranged as interoperable modules, not decorative logo placement."
                />

                <div className="mt-14 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                    {stackBlocks.map((block) => (
                        <div key={block} className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
                            <div className="text-[10px] uppercase tracking-[0.24em] text-white/32">module</div>
                            <div className="mt-3 text-lg font-medium tracking-[-0.03em] text-white">{block}</div>
                            <p className="mt-3 text-sm leading-6 text-white/56">
                                {techStackDescriptions[block]}
                            </p>
                        </div>
                    ))}
                </div>
            </Reveal>
        </section>
    );
}
