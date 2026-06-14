'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { heroProbabilities, runtimeEvents } from '../data';
import { Panel } from '../shared';
import { joinClasses } from '../utils';

export default function HeroSection() {
    return (
        <section className="landing-section relative pt-24 sm:pt-28">
            <div className="flex min-h-[calc(100vh-7rem)] flex-col justify-center pb-14">
                <div className="max-w-3xl">
                    <div className="landing-eyebrow">
                        <span className="h-2 w-2 rounded-full bg-[#7CFF4E] shadow-[0_0_14px_rgba(124,255,78,0.85)]" />
                        veterinary diagnosis support
                    </div>

                    <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-none text-white sm:mt-8 sm:text-6xl md:text-7xl">
                        Describe your patient. Get ranked diagnoses in seconds.
                    </h1>

                    <p className="mt-6 max-w-2xl text-lg leading-8 text-white/70 md:text-xl">
                        VetIOS turns patient signs, history, and test results into clear possible diagnoses and recommended next tests.
                    </p>

                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                        <Link
                            href="/ask-vetios"
                            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-[#E8EDF2] px-6 text-sm font-medium text-[#0B0F14] transition-transform duration-200 hover:-translate-y-0.5"
                        >
                            Ask VetIOS
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                        <Link
                            href="/login?next=%2Finference"
                            className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-white/14 bg-white/[0.03] px-6 text-sm font-medium text-white/78 transition-colors duration-200 hover:border-white/24 hover:text-white"
                        >
                            Open console
                        </Link>
                    </div>

                    <div className="mt-10 grid max-w-3xl gap-3 sm:grid-cols-3">
                        {['Plain-language case entry', 'Ranked diagnoses', 'One-click confirmation'].map((item) => (
                            <div key={item} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-white/76">
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7CFF4E]" />
                                {item}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="pb-16">
                <div className="mb-5 max-w-2xl">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">technical console preview</div>
                    <h2 className="mt-2 text-2xl font-semibold text-white">The clinical view stays simple. The full console is still there.</h2>
                </div>

                <Panel className="overflow-hidden rounded-lg p-4 md:p-6">
                    <div className="mb-4 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
                        <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">case review</span>
                        <span className="rounded-full border border-[#7CFF4E]/25 bg-[#7CFF4E]/10 px-3 py-1 text-[#CFFFBC]">ready</span>
                        <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">traceable</span>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                        <div className="rounded-lg border border-white/8 bg-[#0C1117]/88 p-5">
                            <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">ranked diagnoses</div>
                            <div className="mt-5 space-y-4">
                                {heroProbabilities.map((item, index) => (
                                    <div key={item.label}>
                                        <div className="mb-2 flex items-center justify-between text-xs">
                                            <span className="text-white/68">{formatLabel(item.label)}</span>
                                            <span className={index === 0 ? 'text-[#CFFFBC]' : 'text-[#9AE4D1]'}>
                                                {Math.round(Number(item.value) * 100)}%
                                            </span>
                                        </div>
                                        <div className="h-2 rounded-full bg-white/[0.04]">
                                            <div
                                                className={joinClasses('h-2 rounded-full', index === 0 ? 'bg-[#7CFF4E]' : 'bg-[#38DCC6]')}
                                                style={{ width: `${Math.round(Number(item.value) * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-lg border border-white/8 bg-[#0C1117]/88 p-5">
                            <div className="flex items-center justify-between">
                                <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">console trace</div>
                                <div className="font-mono text-xs text-white/36">stdout</div>
                            </div>
                            <div className="mt-4 space-y-3 font-mono text-[11px] leading-6 text-[#9FB0C0]">
                                {runtimeEvents.slice(0, 5).map((event) => (
                                    <div key={event} className="flex items-start gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#38DCC6]" />
                                        <span>{event}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </Panel>
            </div>
        </section>
    );
}

function formatLabel(value: string): string {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
