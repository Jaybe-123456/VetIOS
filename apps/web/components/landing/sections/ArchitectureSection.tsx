'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { architectureNodes } from '../data';
import { Panel, Reveal, SectionHeader } from '../shared';
import { joinClasses } from '../utils';

export default function ArchitectureSection() {
    const [activeStage, setActiveStage] = useState(0);

    useEffect(() => {
        const interval = window.setInterval(() => {
            setActiveStage((stage) => (stage + 1) % architectureNodes.length);
        }, 1800);
        return () => window.clearInterval(interval);
    }, []);

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
                    <div className="pointer-events-none absolute bottom-4 left-6 top-4 w-px bg-gradient-to-b from-[#38DCC6]/45 via-[#7CFF4E]/25 to-transparent md:hidden" />
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                        {architectureNodes.map((node, index) => {
                            const Icon = node.icon;
                            const isActive = index === activeStage;

                            return (
                                <motion.div
                                    key={node.title}
                                    layout
                                    onMouseEnter={() => setActiveStage(index)}
                                    whileHover={{ y: -6 }}
                                    transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                                >
                                    <Panel
                                        className={joinClasses(
                                            'group relative h-full overflow-hidden rounded-[28px] p-5 pl-16 transition-all duration-300 md:pl-5',
                                            isActive ? 'glass-card-accent glow-accent border-[#38DCC6]/30 bg-white/[0.06]' : 'glass-card hover:border-[#38DCC6]/24',
                                        )}
                                    >
                                        <motion.div
                                            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#7CFF4E] to-transparent"
                                            initial={false}
                                            animate={{ opacity: isActive ? 1 : 0.15, scaleX: isActive ? 1 : 0.35 }}
                                        />
                                        <div className="absolute left-4 top-5 flex h-8 w-8 items-center justify-center rounded-full border border-[#38DCC6]/28 bg-[#10161E] text-[10px] uppercase tracking-[0.14em] text-white/55 md:left-auto md:right-5 md:h-auto md:w-auto md:rounded-none md:border-0 md:bg-transparent md:tracking-[0.24em] md:text-white/24">
                                            0{index + 1}
                                        </div>
                                        <motion.div
                                            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-[#91FFE4]"
                                            animate={{ scale: isActive ? 1.08 : 1, rotate: isActive ? 4 : 0 }}
                                        >
                                            <Icon className="h-5 w-5" />
                                        </motion.div>
                                        <div className="mt-5 text-xl font-medium tracking-[-0.03em] text-white">
                                            {node.title}
                                        </div>
                                        <p className="mt-3 text-sm leading-7 text-white/60">{node.detail}</p>
                                    </Panel>
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            </Reveal>
        </section>
    );
}
