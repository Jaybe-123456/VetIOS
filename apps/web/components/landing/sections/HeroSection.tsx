'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { heroCases } from '../data';
import { Panel } from '../shared';
import { joinClasses } from '../utils';

export default function HeroSection() {
    const [activeCaseIndex, setActiveCaseIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [visibleTraceCount, setVisibleTraceCount] = useState(0);
    const activeCase = heroCases[activeCaseIndex] ?? heroCases[0];

    useEffect(() => {
        setIsLoading(true);
        setVisibleTraceCount(0);
        const loadTimer = window.setTimeout(() => setIsLoading(false), 520);
        return () => window.clearTimeout(loadTimer);
    }, [activeCaseIndex]);

    useEffect(() => {
        if (isLoading) return undefined;
        setVisibleTraceCount(0);
        const interval = window.setInterval(() => {
            setVisibleTraceCount((count) => Math.min(activeCase.trace.length, count + 1));
        }, 260);
        return () => window.clearInterval(interval);
    }, [activeCase.trace.length, isLoading]);

    return (
        <section className="landing-section relative pt-24 sm:pt-28">
            <div className="flex min-h-[calc(100svh-7rem)] flex-col justify-center pb-14 md:min-h-[calc(100dvh-7rem)]">
                <motion.div
                    className="max-w-3xl"
                    initial="hidden"
                    animate="visible"
                    variants={{
                        hidden: { opacity: 0 },
                        visible: {
                            opacity: 1,
                            transition: { staggerChildren: 0.08 },
                        },
                    }}
                >
                    <motion.div
                        className="landing-eyebrow"
                        variants={fadeUp}
                    >
                        <span className="h-2 w-2 rounded-full bg-[#7CFF4E] shadow-[0_0_14px_rgba(124,255,78,0.85)]" />
                        veterinary intelligence infrastructure
                    </motion.div>

                    <motion.h1
                        className="mt-6 max-w-4xl text-5xl font-semibold leading-none text-white sm:mt-8 sm:text-6xl md:text-7xl"
                        variants={fadeUp}
                    >
                        The outcome-confirmed data layer for veterinary AI.
                    </motion.h1>

                    <motion.p
                        className="mt-6 max-w-2xl text-lg leading-8 text-white/70 md:text-xl"
                        variants={fadeUp}
                    >
                        VetIOS captures the scarce layer every veterinary model needs: de-identified clinical evidence linked to provenance, clinician review, lab context, follow-up, and trust scores.
                    </motion.p>

                    <motion.div className="mt-8 flex flex-col gap-3 sm:flex-row" variants={fadeUp}>
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
                            Open evidence console
                        </Link>
                    </motion.div>

                    <motion.div className="mt-10 grid max-w-3xl gap-3 sm:grid-cols-3" variants={fadeUp}>
                        {['Outcome-linked records', 'Provenance trust scores', 'Federated learning gates'].map((item) => (
                            <div key={item} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-white/76">
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7CFF4E]" />
                                {item}
                            </div>
                        ))}
                    </motion.div>
                </motion.div>
            </div>

            <div className="pb-16">
                <div className="mb-5 max-w-2xl">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">substrate console preview</div>
                    <h2 className="mt-2 text-2xl font-semibold text-white">The interface is visible. The evidence ledger is the asset.</h2>
                </div>

                <Panel className="overflow-hidden rounded-lg p-4 md:p-6">
                    <div className="mb-4 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
                        <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">evidence ledger</span>
                        <span className="rounded-full border border-[#7CFF4E]/25 bg-[#7CFF4E]/10 px-3 py-1 text-[#CFFFBC]">
                            {isLoading ? 'ranking' : 'ready'}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">provenance scored</span>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                        <div className="glass-card-accent rounded-lg p-5">
                            <div className="mb-5 flex flex-wrap gap-2">
                                {heroCases.map((item, index) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setActiveCaseIndex(index)}
                                        className={joinClasses(
                                            'min-h-[44px] rounded-full border px-3 py-2 text-left text-[10px] uppercase tracking-[0.14em] transition-all sm:text-[11px]',
                                            index === activeCaseIndex
                                                ? 'border-[#7CFF4E]/35 bg-[#7CFF4E]/12 text-[#D8FFC9]'
                                                : 'border-white/10 bg-white/[0.03] text-white/50 hover:border-white/18 hover:text-white/78',
                                        )}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>

                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={activeCase.id}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    transition={{ duration: 0.22 }}
                                    className="mb-5 rounded-[20px] border border-white/8 bg-[#090D12]/72 p-4"
                                >
                                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#9AE4D1]">{activeCase.species}</div>
                                    <p className="mt-2 text-sm leading-6 text-white/68">{activeCase.input}</p>
                                </motion.div>
                            </AnimatePresence>

                            <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">ranked hypotheses</div>
                            <div className="mt-5 space-y-4">
                                {activeCase.probabilities.map((item, index) => (
                                    <motion.div
                                        key={`${activeCase.id}-${item.label}`}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: isLoading ? 0 : index * 0.08 }}
                                    >
                                        <div className="mb-2 flex items-center justify-between text-xs">
                                            <span className="text-white/68">{formatLabel(item.label)}</span>
                                            <span className={index === 0 ? 'text-[#CFFFBC]' : 'text-[#9AE4D1]'}>
                                                {isLoading ? '--' : `${Math.round(item.value * 100)}%`}
                                            </span>
                                        </div>
                                        <div className="h-2 rounded-full bg-white/[0.04]">
                                            <motion.div
                                                className={joinClasses('h-2 rounded-full', index === 0 ? 'bg-[#7CFF4E]' : 'bg-[#38DCC6]')}
                                                initial={{ width: 0 }}
                                                animate={{ width: isLoading ? '12%' : `${Math.round(item.value * 100)}%` }}
                                                transition={{ duration: 0.7, ease: 'easeOut' }}
                                            />
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </div>

                        <div className="glass-card rounded-lg p-5">
                            <div className="flex items-center justify-between">
                                <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">provenance trace</div>
                                <div className="font-mono text-xs text-white/36">stdout</div>
                            </div>
                            <div className="mt-4 space-y-3 font-mono text-[11px] leading-6 text-[#9FB0C0]">
                                <AnimatePresence>
                                    {(isLoading ? ['ranking.case loading_context=true'] : activeCase.trace.slice(0, visibleTraceCount)).map((event) => (
                                        <motion.div
                                            key={`${activeCase.id}-${event}`}
                                            className="flex items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.02] px-3 py-2"
                                            initial={{ opacity: 0, x: 12 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -12 }}
                                        >
                                            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#38DCC6]" />
                                            <span>{event}</span>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                                <div className="flex items-center gap-2 text-[#7CFF4E]">
                                    <span className="terminal-cursor h-4 w-2 bg-[#7CFF4E]/80" />
                                    <span>{isLoading ? 'resolving...' : 'awaiting clinician confirmation'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Panel>
            </div>
        </section>
    );
}

const fadeUp: Variants = {
    hidden: { y: 18, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { duration: 0.48, ease: 'easeOut' } },
};

function formatLabel(value: string): string {
    return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
