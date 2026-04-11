'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Reveal } from '../shared';

export default function FinalCTASection() {
    return (
        <section className="landing-section pb-20">
            <Reveal>
                <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-6 py-10 md:px-10 md:py-14">
                    <div className="max-w-3xl">
                        <div className="landing-eyebrow">final call</div>
                        <h2 className="mt-6 text-4xl font-semibold tracking-[-0.05em] text-white md:text-5xl">
                            Build on intelligence, not isolated decisions.
                        </h2>
                        <p className="mt-5 max-w-2xl text-lg leading-8 text-white/62">
                            VetIOS is building the infrastructure layer for veterinary intelligence systems.
                        </p>
                    </div>

                    <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                        <Link
                            href="/signup"
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#E8EDF2] px-6 py-3.5 text-sm font-medium text-[#0B0F14] transition-transform duration-200 hover:-translate-y-0.5"
                        >
                            Access Platform
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                        <Link
                            href="/platform/developers"
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-white/76"
                        >
                            View Developer Surface
                        </Link>
                    </div>
                </div>
            </Reveal>
        </section>
    );
}
