'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { heroProbabilities, networkStats, runtimeEvents } from '../data';
import { Panel } from '../shared';
import { joinClasses } from '../utils';

export default function HeroSection() {
    return (
        <section className="landing-section relative min-h-screen pt-28 pb-20">
            <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
                <div className="max-w-2xl">
                    <div className="landing-eyebrow">
                        <span className="h-2 w-2 rounded-full bg-[#7CFF4E] shadow-[0_0_14px_rgba(124,255,78,0.85)]" />
                        clinical intelligence runtime
                    </div>

                    <h1 className="mt-8 text-5xl font-semibold leading-[0.96] tracking-[-0.06em] text-white md:text-7xl xl:text-[5.2rem]">
                        VetIOS - AI Infrastructure for Veterinary Intelligence
                    </h1>

                    <p className="mt-6 max-w-xl text-lg leading-8 text-white/62 md:text-xl">
                        A closed-loop system that transforms clinical signals into continuously improving intelligence.
                    </p>

                    <div className="mt-10 flex flex-col gap-4 sm:flex-row">
                        <Link
                            href="/login?next=%2Finference"
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#E8EDF2] px-6 py-3.5 text-sm font-medium text-[#0B0F14] transition-transform duration-200 hover:-translate-y-0.5"
                        >
                            Run Inference
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                        <Link
                            href="#architecture"
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-white/74 transition-colors duration-200 hover:border-white/20 hover:text-white"
                        >
                            Explore Architecture
                        </Link>
                    </div>

                    <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {[
                            ['control mode', 'closed loop'],
                            ['runtime surface', 'observable'],
                            ['deployment shape', 'distributed'],
                        ].map(([label, value]) => (
                            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="text-[11px] uppercase tracking-[0.24em] text-white/40">{label}</div>
                                <div className="mt-2 text-sm font-medium text-white/86">{value}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="relative">
                    <div className="absolute inset-4 rounded-[36px] bg-[radial-gradient(circle,rgba(21,230,195,0.18),transparent_70%)] blur-3xl" />
                    <Panel className="relative overflow-hidden p-4 md:p-6">
                        <div className="absolute left-8 right-8 top-0 h-px bg-gradient-to-r from-transparent via-[#6BF7CF]/45 to-transparent" />
                        <div className="mb-4 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.24em] text-white/45">
                            <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">global-control-plane</span>
                            <span className="rounded-full border border-[#7CFF4E]/25 bg-[#7CFF4E]/10 px-3 py-1 text-[#CFFFBC]">stable</span>
                            <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">traceable runtime</span>
                        </div>

                        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                            <div className="rounded-[24px] border border-white/8 bg-[#0C1117]/88 p-5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">system graph</div>
                                        <div className="mt-1 text-sm font-medium text-white/84">Runtime path</div>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-[#CFFFBC]">
                                        <span className="h-2 w-2 rounded-full bg-[#7CFF4E] shadow-[0_0_12px_rgba(124,255,78,0.8)]" />
                                        live
                                    </div>
                                </div>

                                <div className="relative mt-6 h-[270px] overflow-hidden rounded-[20px] border border-white/6 bg-[#0A0E13]">
                                    <div className="landing-grid absolute inset-0 opacity-[0.16]" />
                                    <svg viewBox="0 0 480 270" className="absolute inset-0 h-full w-full opacity-90">
                                        <defs>
                                            <linearGradient id="hero-line" x1="0" x2="1">
                                                <stop offset="0%" stopColor="rgba(21,230,195,0.1)" />
                                                <stop offset="50%" stopColor="rgba(21,230,195,0.9)" />
                                                <stop offset="100%" stopColor="rgba(124,255,78,0.5)" />
                                            </linearGradient>
                                        </defs>
                                        <path d="M58 174 C96 150 126 120 168 100" fill="none" stroke="url(#hero-line)" strokeWidth="2" />
                                        <path d="M168 100 C215 78 246 82 282 130" fill="none" stroke="url(#hero-line)" strokeWidth="2" />
                                        <path d="M282 130 C320 172 350 184 398 166" fill="none" stroke="url(#hero-line)" strokeWidth="2" />
                                        <path d="M282 130 C324 112 354 96 408 88" fill="none" stroke="url(#hero-line)" strokeWidth="2" strokeDasharray="5 7" />
                                    </svg>

                                    {[
                                        { left: '8%', top: '58%', label: 'Input' },
                                        { left: '28%', top: '28%', label: 'Inference' },
                                        { left: '49%', top: '41%', label: 'Outcome' },
                                        { left: '70%', top: '62%', label: 'Simulation' },
                                        { left: '78%', top: '18%', label: 'Intelligence' },
                                    ].map((node) => (
                                        <div
                                            key={node.label}
                                            className="absolute -translate-x-1/2 -translate-y-1/2"
                                            style={{ left: node.left, top: node.top }}
                                        >
                                            <div className="rounded-full border border-[#6BF7CF]/25 bg-[#101821]/95 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-white/75 shadow-[0_0_30px_rgba(21,230,195,0.12)]">
                                                {node.label}
                                            </div>
                                            <div className="mx-auto mt-2 h-2.5 w-2.5 rounded-full bg-[#6BF7CF] shadow-[0_0_18px_rgba(21,230,195,0.95)]" />
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                                    {networkStats.map((item) => (
                                        <div key={item.label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                                            <div className="text-[10px] uppercase tracking-[0.24em] text-white/36">{item.label}</div>
                                            <div className="mt-2 text-sm font-medium text-white/82">{item.value}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="rounded-[24px] border border-white/8 bg-[#0C1117]/88 p-5">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">probability field</div>
                                        <div className="text-xs text-[#9AE4D1]">ranked output</div>
                                    </div>
                                    <div className="mt-5 space-y-4">
                                        {heroProbabilities.map((item, index) => (
                                            <div key={item.label}>
                                                <div className="mb-2 flex items-center justify-between text-xs">
                                                    <span className="text-white/62">{item.label}</span>
                                                    <span className={index === 0 ? 'text-[#CFFFBC]' : 'text-[#9AE4D1]'}>
                                                        {item.value}
                                                    </span>
                                                </div>
                                                <div className="h-2 rounded-full bg-white/[0.04]">
                                                    <div
                                                        className={joinClasses(
                                                            'h-2 rounded-full',
                                                            index === 0 ? 'bg-[#7CFF4E]' : 'bg-[#38DCC6]',
                                                        )}
                                                        style={{ width: `${Math.round(Number(item.value) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-[24px] border border-white/8 bg-[#0C1117]/88 p-5">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">runtime trace</div>
                                        <div className="font-mono text-xs text-white/36">stdout</div>
                                    </div>
                                    <div className="mt-4 space-y-3 font-mono text-[11px] leading-6 text-[#9FB0C0]">
                                        {runtimeEvents.map((event) => (
                                            <div key={event} className="flex items-start gap-3">
                                                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#38DCC6]" />
                                                <span>{event}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Panel>
                </div>
            </div>
        </section>
    );
}
