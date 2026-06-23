'use client';

import { motion } from 'framer-motion';
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
                            <motion.div
                                key={module.title}
                                className="glass-card group rounded-2xl p-5 transition-all duration-300 hover:border-[#38DCC6]/28 hover:bg-white/[0.07] sm:p-6"
                                whileHover={{ y: -7 }}
                                transition={{ type: 'spring', stiffness: 270, damping: 24 }}
                            >
                                <motion.div
                                    className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#0D131A] text-[#9AE4D1] shadow-[0_0_0_rgba(56,220,198,0)] transition-shadow group-hover:shadow-[0_0_28px_rgba(56,220,198,0.18)]"
                                    whileHover={{ rotate: 6, scale: 1.06 }}
                                >
                                    <Icon className="h-5 w-5" />
                                </motion.div>
                                <h3 className="mt-5 text-xl font-medium tracking-[-0.03em] text-white sm:mt-6 sm:text-2xl">
                                    {module.title}
                                </h3>
                                <p className="mt-4 text-sm leading-7 text-white/60">{module.description}</p>
                            </motion.div>
                        );
                    })}
                </div>
            </Reveal>
        </section>
    );
}
