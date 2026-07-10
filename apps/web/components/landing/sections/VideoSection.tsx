'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Play, RadioTower, ShieldCheck } from 'lucide-react';
import { Panel, Reveal } from '../shared';

const YOUTUBE_VIDEO_ID = 'kE5jfdzfwak';
const YOUTUBE_WATCH_URL = 'https://youtu.be/kE5jfdzfwak?si=XmIAKlugvGdLT1Su';
const YOUTUBE_EMBED_URL = `https://www.youtube-nocookie.com/embed/${YOUTUBE_VIDEO_ID}`;
const YOUTUBE_THUMBNAIL_URL = `https://i.ytimg.com/vi/${YOUTUBE_VIDEO_ID}/hqdefault.jpg`;

const mediaSignals = [
    ['source', 'field signal'],
    ['embed', 'click-to-load'],
    ['autoplay', 'off'],
    ['fallback', 'youtube link'],
] as const;

const traceLines = [
    'media.source accepted youtube:kE5jfdzfwak',
    'embed.mode click_to_load',
    'privacy.mode youtube_nocookie',
    'fallback.ready external_link',
] as const;

export default function VideoSection() {
    const [videoLoaded, setVideoLoaded] = useState(false);

    return (
        <section className="landing-section py-16 sm:py-20 md:py-24">
            <Reveal>
                <Panel className="glass-card-accent overflow-hidden rounded-[28px]">
                    <div className="grid items-stretch gap-0 lg:grid-cols-[0.92fr_1.08fr]">
                        <div className="border-b border-white/8 p-6 sm:p-8 lg:border-b-0 lg:border-r lg:border-white/8 xl:p-10">
                            <div className="landing-eyebrow">
                                <RadioTower className="h-4 w-4 text-[#7CFF4E]" />
                                operator media
                            </div>
                            <h2 className="mt-5 max-w-xl text-[2rem] font-semibold leading-[1.04] tracking-[-0.045em] text-white sm:text-4xl">
                                A field note inside the control plane.
                            </h2>
                            <p className="mt-5 max-w-xl text-sm leading-7 text-white/62 sm:text-base sm:leading-8">
                                The video is context, not the product. VetIOS should feel like the clinical data substrate underneath every visible interface: provenance-aware, outcome-linked, and operational before it is theatrical.
                            </p>

                            <div className="mt-7 grid grid-cols-2 gap-3">
                                {mediaSignals.map(([label, value]) => (
                                    <div
                                        key={label}
                                        className="rounded-[18px] border border-white/8 bg-black/20 p-3"
                                    >
                                        <div className="text-[10px] uppercase tracking-[0.18em] text-white/34">{label}</div>
                                        <div className="mt-2 text-xs text-white/78">{value}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-7 overflow-hidden rounded-[20px] border border-white/8 bg-[#070B10]">
                                <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
                                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#7CFF4E]">media trace</div>
                                    <ShieldCheck className="h-4 w-4 text-[#38DCC6]" />
                                </div>
                                <div className="space-y-2 px-4 py-4 font-mono text-[11px] leading-5 text-white/48">
                                    {traceLines.map((line) => (
                                        <div key={line} className="flex gap-2">
                                            <span className="text-[#38DCC6]">::</span>
                                            <span>{line}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="p-4 sm:p-6 xl:p-7">
                            <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[#05080C] shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
                                <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.03] px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <span className="h-2 w-2 rounded-full bg-[#7CFF4E] shadow-[0_0_14px_rgba(124,255,78,0.85)]" />
                                        <span className="text-[10px] uppercase tracking-[0.2em] text-white/46">field signal</span>
                                    </div>
                                    <Link
                                        href={YOUTUBE_WATCH_URL}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex min-h-[44px] items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#B9FFF0] transition-colors hover:text-white sm:min-h-0"
                                    >
                                        source
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </Link>
                                </div>

                                <div className="relative aspect-video overflow-hidden bg-black">
                                    {videoLoaded ? (
                                        <iframe
                                            className="absolute inset-0 h-full w-full"
                                            src={YOUTUBE_EMBED_URL}
                                            title="VetIOS video"
                                            loading="lazy"
                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                            referrerPolicy="strict-origin-when-cross-origin"
                                            allowFullScreen
                                        />
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setVideoLoaded(true)}
                                            className="group absolute inset-0 grid place-items-center overflow-hidden text-left"
                                            aria-label="Load VetIOS field signal video"
                                        >
                                            <img
                                                src={YOUTUBE_THUMBNAIL_URL}
                                                alt=""
                                                className="absolute inset-0 h-full w-full object-cover opacity-58 grayscale transition duration-500 group-hover:scale-[1.03] group-hover:opacity-72 group-hover:grayscale-0"
                                            />
                                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_42%_35%,rgba(56,220,198,0.24),transparent_32%),linear-gradient(135deg,rgba(0,0,0,0.38),rgba(4,10,12,0.86))]" />
                                            <div className="relative mx-5 max-w-md rounded-[22px] border border-white/10 bg-black/46 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-md transition duration-300 group-hover:border-[#7CFF4E]/36 group-hover:bg-black/58">
                                                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[#7CFF4E]/34 bg-[#7CFF4E]/12 text-[#D8FFC9] shadow-[0_0_28px_rgba(124,255,78,0.18)]">
                                                    <Play className="ml-0.5 h-5 w-5 fill-current" />
                                                </div>
                                                <div className="mt-4 text-lg font-semibold tracking-[-0.035em] text-white">
                                                    Load field signal
                                                </div>
                                                <div className="mt-2 text-sm leading-6 text-white/58">
                                                    Click to open the embedded video in a privacy-enhanced player.
                                                </div>
                                            </div>
                                        </button>
                                    )}
                                </div>

                                <div className="grid gap-3 border-t border-white/8 bg-[#05080C] p-4 sm:grid-cols-3">
                                    {[
                                        ['substrate', 'provenance first'],
                                        ['position', 'supporting evidence'],
                                        ['surface', 'no autoplay'],
                                    ].map(([label, value]) => (
                                        <div key={label} className="min-w-0">
                                            <div className="text-[10px] uppercase tracking-[0.18em] text-white/30">{label}</div>
                                            <div className="mt-1 truncate text-xs text-white/70">{value}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </Panel>
            </Reveal>
        </section>
    );
}
