'use client';

import { Panel, Reveal } from '../shared';

export default function FlywheelSection() {
    return (
        <section className="landing-section">
            <Reveal>
                <div className="mx-auto max-w-5xl text-center">
                    <div className="landing-eyebrow justify-center">compounding moat</div>
                    <h2 className="mt-6 text-4xl font-semibold tracking-[-0.05em] text-white md:text-5xl">
                        The system gets stronger because the loop is the product.
                    </h2>
                    <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-white/62">
                        Every interaction strengthens the system.
                    </p>
                </div>

                <Panel className="relative mt-14 overflow-hidden px-6 py-8 md:px-10 md:py-14">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(21,230,195,0.1),transparent_60%)]" />
                    <div className="absolute left-1/2 top-1/2 hidden h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/6 lg:block" />
                    <div className="absolute left-1/2 top-1/2 hidden h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#38DCC6]/18 lg:block" />

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

                        {[
                            { title: 'Inference', left: '11%', top: '39%' },
                            { title: 'Outcome', left: '36%', top: '11%' },
                            { title: 'Simulation', left: '69%', top: '18%' },
                            { title: 'Improved Intelligence', left: '77%', top: '57%' },
                        ].map((item) => (
                            <div
                                key={item.title}
                                className="absolute h-24 w-44 -translate-x-1/2 -translate-y-1/2 rounded-[26px] border border-white/10 bg-[#0F151D]/92 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.28)]"
                                style={{ left: item.left, top: item.top }}
                            >
                                <div className="text-[11px] uppercase tracking-[0.24em] text-[#9AE4D1]">loop stage</div>
                                <div className="mt-3 text-lg font-medium text-white">{item.title}</div>
                            </div>
                        ))}
                    </div>

                    <div className="relative grid gap-4 lg:hidden">
                        {['Inference', 'Outcome', 'Simulation', 'Improved Intelligence'].map((item) => (
                            <div
                                key={item}
                                className="rounded-[24px] border border-white/10 bg-[#0F151D]/92 p-5"
                            >
                                <div className="text-[11px] uppercase tracking-[0.24em] text-[#9AE4D1]">loop stage</div>
                                <div className="mt-2 text-xl font-medium text-white">{item}</div>
                            </div>
                        ))}
                    </div>
                </Panel>
            </Reveal>
        </section>
    );
}
