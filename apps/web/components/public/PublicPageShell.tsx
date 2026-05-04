'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { BrandMark } from '@/components/landing/shared';
import { footerLinks } from '@/components/landing/data';

export function PublicPageShell({
    children,
    title,
    eyebrow,
    description,
}: {
    children: React.ReactNode;
    title: string;
    eyebrow: string;
    description?: string;
}) {
    return (
        <div className="relative min-h-full overflow-x-clip bg-[#0B0F14] text-[#E8EDF2]">
            {/* Background */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(21,230,195,0.08),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_50%)]" />
                <div className="landing-grid absolute inset-0 opacity-[0.05]" />
            </div>

            {/* Nav */}
            <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#0B0F14]/80 backdrop-blur-md">
                <div className="mx-auto flex h-[64px] max-w-5xl items-center justify-between px-6 md:px-10">
                    <Link href="/" className="flex items-center gap-2.5">
                        <BrandMark compact />
                        <div className="flex flex-col">
                            <span className="text-xs font-semibold tracking-[0.24em] text-white/55">VETIOS</span>
                            <span className="hidden text-xs text-white/35 sm:block">veterinary intelligence platform</span>
                        </div>
                    </Link>
                    <div className="flex items-center gap-4 text-sm text-white/50">
                        <Link href="/docs" className="hover:text-white transition-colors hidden sm:block">Docs</Link>
                        <Link href="/support" className="hover:text-white transition-colors hidden sm:block">Support</Link>
                        <Link
                            href="/login"
                            className="inline-flex items-center gap-2 rounded-full border border-[#6BF7CF]/30 bg-[#6BF7CF]/8 px-4 py-2 text-sm font-medium text-[#C9FFF0] transition-all hover:border-[#6BF7CF]/50 hover:bg-[#6BF7CF]/14"
                        >
                            Sign In <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </div>
                </div>
            </nav>

            {/* Hero */}
            <div className="relative border-b border-white/8">
                <div className="mx-auto max-w-5xl px-6 py-12 md:px-10 md:py-16">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#6BF7CF]" />
                        {eyebrow}
                    </div>
                    <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
                    {description && (
                        <p className="mt-3 max-w-2xl text-base leading-7 text-white/55">{description}</p>
                    )}
                </div>
            </div>

            {/* Content */}
            <main className="relative z-10 mx-auto max-w-5xl px-6 py-12 md:px-10 md:py-16">
                {children}
            </main>

            {/* Footer */}
            <footer className="border-t border-white/8 px-6 py-8 md:px-10">
                <div className="mx-auto max-w-5xl flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <BrandMark compact />
                        <div>
                            <div className="text-sm font-semibold tracking-[0.28em] text-white/55">VETIOS</div>
                            <div className="text-xs text-white/32">system layer for veterinary intelligence</div>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/40">
                        {footerLinks.map((link) => (
                            <Link key={link.label} href={link.href} className="hover:text-white/70 transition-colors">
                                {link.label}
                            </Link>
                        ))}
                    </div>
                </div>
            </footer>
        </div>
    );
}
