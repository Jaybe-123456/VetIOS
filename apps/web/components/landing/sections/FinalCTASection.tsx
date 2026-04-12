'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Reveal } from '../shared';

export default function FinalCTASection() {
    return (
        <section className="landing-section pb-20">
            <Reveal>
                <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-5 py-8 sm:rounded-[34px] sm:px-6 sm:py-10 md:px-10 md:py-14">
                    <div className="max-w-3xl">
                        <div className="landing-eyebrow">final call</div>
                        <h2 className="mt-6 text-[2.3rem] font-semibold tracking-[-0.05em] text-white sm:text-4xl md:text-5xl">
                            Build on intelligence, not isolated decisions.
                        </h2>
                        <p className="mt-4 max-w-2xl text-base leading-7 text-white/62 sm:mt-5 sm:text-lg sm:leading-8">
                            VetIOS is building the infrastructure layer for veterinary intelligence systems.
                        </p>
                    </div>

                    <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                        <Link
                            href="/signup"
                            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#E8EDF2] px-6 py-3.5 text-sm font-medium text-[#0B0F14] transition-transform duration-200 hover:-translate-y-0.5 sm:w-auto"
                        >
                            Access Platform
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                        <Link
                            href="/platform"
                            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-white/76 sm:w-auto"
                        >
                            View Platform Overview
                        </Link>
                    </div>
                </div>
            </Reveal>
        </section>
    );
}
