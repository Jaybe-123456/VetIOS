'use client';

import { PlayCircle } from 'lucide-react';
import { Panel, Reveal } from '../shared';

const YOUTUBE_SHORT_ID = 'uYnJs1MJYzM';

export default function VideoSection() {
    return (
        <section className="landing-section pt-0">
            <Reveal>
                <div className="grid items-center gap-8 lg:grid-cols-[0.92fr_1.08fr]">
                    <div className="max-w-2xl">
                        <div className="landing-eyebrow">
                            <PlayCircle className="h-4 w-4 text-[#7CFF4E]" />
                            field signal
                        </div>
                        <h2 className="mt-5 text-[2.2rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:text-4xl md:text-5xl">
                            Watch the idea move, not just sit on the page.
                        </h2>
                        <p className="mt-5 text-base leading-7 text-white/62 sm:text-lg sm:leading-8">
                            The landing page now carries a short-form video moment alongside the live console preview, so visitors can feel the product rhythm before they enter the clinical workflow.
                        </p>
                    </div>

                    <Panel className="glass-card-accent overflow-hidden rounded-[28px] p-3 sm:p-4">
                        <div className="relative mx-auto aspect-[9/16] max-h-[720px] w-full max-w-[420px] overflow-hidden rounded-[22px] border border-white/10 bg-black shadow-[0_28px_90px_rgba(0,0,0,0.45)]">
                            <iframe
                                className="absolute inset-0 h-full w-full"
                                src={`https://www.youtube.com/embed/${YOUTUBE_SHORT_ID}`}
                                title="VetIOS short video"
                                loading="lazy"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                referrerPolicy="strict-origin-when-cross-origin"
                                allowFullScreen
                            />
                        </div>
                    </Panel>
                </div>
            </Reveal>
        </section>
    );
}
