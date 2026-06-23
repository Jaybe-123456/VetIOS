'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { flywheelStages } from '../data';
import { Panel, Reveal } from '../shared';
import { joinClasses } from '../utils';

export default function FlywheelSection() {
    const [activeStage, setActiveStage] = useState(0);
    const selectedStage = flywheelStages[activeStage] ?? flywheelStages[0];

    return (
        <section className="landing-section">
            <Reveal>
                <div className="mx-auto max-w-5xl text-center">
                    <div className="landing-eyebrow justify-center">compounding moat</div>
                    <h2 className="mt-6 text-[2.35rem] font-semibold tracking-[-0.05em] text-white sm:text-4xl md:text-5xl">
                        The system gets stronger because the loop is the product.
                    </h2>
                    <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/62 sm:mt-5 sm:text-lg sm:leading-8">
                        Every interaction strengthens the system.
                    </p>
                </div>

                <Panel className="relative mt-14 overflow-hidden px-4 py-6 sm:px-6 sm:py-8 md:px-10 md:py-14">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(21,230,195,0.1),transparent_60%)]" />
                    <div className="absolute left-1/2 top-1/2 hidden h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/6 lg:block" />
                    <div className="absolute left-1/2 top-1/2 hidden h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#38DCC6]/18 lg:block" />
                    <motion.div
                        className="absolute left-1/2 top-1/2 hidden h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full lg:block"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
                    >
                        <div className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-[#7CFF4E] shadow-[0_0_24px_rgba(124,255,78,0.95)]" />
                    </motion.div>
                    <motion.div
                        className="absolute left-1/2 top-1/2 hidden h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full lg:block"
                        animate={{ rotate: -360 }}
                        transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
                    >
                        <div className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[#38DCC6] shadow-[0_0_22px_rgba(56,220,198,0.9)]" />
                    </motion.div>

                    <div className="relative hidden min-h-[440px] lg:block">
                        <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#7CFF4E]/25 bg-[#0B1117] shadow-[0_0_80px_rgba(21,230,195,0.12)]">
                            <div className="absolute inset-3 rounded-full border border-[#38DCC6]/18" />
                            <div className="absolute inset-0 animate-landing-pulse rounded-full bg-[#38DCC6]/12" />
                            <div className="relative flex h-full flex-col items-center justify-center text-center">
                                <div className="text-[11px] uppercase tracking-[0.24em] text-white/35">central state</div>
                                <div className="mt-3 px-6 text-xl font-medium tracking-[-0.03em] text-white">
                                    Improved Intelligence
                                </div>
                            </div>
                        </div>

                        {flywheelStages.map((item, index) => (
                            <button
                                key={item.title}
                                type="button"
                                onClick={() => setActiveStage(index)}
                                className={joinClasses(
                                    'absolute h-24 w-44 -translate-x-1/2 -translate-y-1/2 rounded-[26px] border p-4 text-left shadow-[0_18px_40px_rgba(0,0,0,0.28)] transition-all duration-300',
                                    index === activeStage
                                        ? 'border-[#7CFF4E]/35 bg-[#102016]/94 shadow-[0_0_40px_rgba(124,255,78,0.12)]'
                                        : 'border-white/10 bg-[#0F151D]/92 hover:border-[#38DCC6]/28',
                                )}
                                style={{ left: item.left, top: item.top }}
                            >
                                <div className="text-[11px] uppercase tracking-[0.24em] text-[#9AE4D1]">loop stage</div>
                                <div className="mt-3 text-lg font-medium text-white">{item.title}</div>
                            </button>
                        ))}

                        <motion.div
                            key={selectedStage.title}
                            className="absolute bottom-6 left-1/2 w-[420px] -translate-x-1/2 rounded-[24px] border border-white/10 bg-black/35 p-5 backdrop-blur-md"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <div className="text-[10px] uppercase tracking-[0.22em] text-[#7CFF4E]">{selectedStage.metric}</div>
                            <p className="mt-2 text-sm leading-6 text-white/66">{selectedStage.detail}</p>
                        </motion.div>
                    </div>

                    <div className="relative grid gap-4 lg:hidden">
                        <div className="mx-auto mb-2 flex h-28 w-28 items-center justify-center rounded-full border border-[#7CFF4E]/25 bg-[#0B1117] shadow-[0_0_60px_rgba(21,230,195,0.12)]">
                            <div className="flex h-[82%] w-[82%] flex-col items-center justify-center rounded-full border border-[#38DCC6]/18 text-center">
                                <div className="text-[10px] uppercase tracking-[0.22em] text-white/35">core</div>
                                <div className="mt-2 px-3 text-sm font-medium leading-5 text-white">Improved Intelligence</div>
                            </div>
                        </div>
                        {flywheelStages.map((item, index) => (
                            <button
                                key={item.title}
                                type="button"
                                onClick={() => setActiveStage(index)}
                                className={joinClasses(
                                    'rounded-[24px] border p-5 text-left transition-all',
                                    index === activeStage ? 'border-[#7CFF4E]/35 bg-[#102016]/94' : 'border-white/10 bg-[#0F151D]/92',
                                )}
                            >
                                <div className="text-[11px] uppercase tracking-[0.24em] text-[#9AE4D1]">loop stage</div>
                                <div className="mt-2 text-xl font-medium text-white">{item.title}</div>
                                {index === activeStage && (
                                    <p className="mt-3 text-sm leading-6 text-white/60">{item.detail}</p>
                                )}
                            </button>
                        ))}
                    </div>
                </Panel>
            </Reveal>
        </section>
    );
}
