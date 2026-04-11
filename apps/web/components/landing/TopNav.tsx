'use client';

import Link from 'next/link';
import { ArrowRight, Menu, X } from 'lucide-react';
import { navigationItems } from './data';
import { BrandMark } from './shared';
import { joinClasses } from './utils';

type TopNavProps = {
    menuOpen: boolean;
    scrolled: boolean;
    onCloseMenu: () => void;
    onOpenMenu: () => void;
};

export default function TopNav({
    menuOpen,
    scrolled,
    onCloseMenu,
    onOpenMenu,
}: TopNavProps) {
    return (
        <>
            <nav
                className={joinClasses(
                    'fixed top-0 z-50 w-full transition-all duration-300',
                    scrolled
                        ? 'border-b border-white/10 bg-[#0B0F14]/78 backdrop-blur-md shadow-[0_18px_48px_rgba(0,0,0,0.32)]'
                        : 'border-b border-transparent bg-transparent',
                )}
            >
                <div className="mx-auto flex h-[64px] max-w-[1600px] items-center justify-between px-4 sm:h-[72px] sm:px-6 md:px-10 xl:px-20">
                    <Link href="/" className="flex items-center gap-2.5 sm:gap-3">
                        <BrandMark compact />
                        <div className="flex flex-col">
                            <span className="text-xs font-semibold tracking-[0.24em] text-white/55 sm:text-sm sm:tracking-[0.28em]">VETIOS</span>
                            <span className="hidden text-xs text-white/35 sm:block">veterinary intelligence platform</span>
                        </div>
                    </Link>

                    <div className="hidden items-center gap-7 text-sm text-white/64 lg:flex">
                        {navigationItems.map((item) => (
                            <Link
                                key={item.label}
                                href={item.href}
                                className="transition-colors duration-200 hover:text-white"
                            >
                                {item.label}
                            </Link>
                        ))}
                    </div>

                    <div className="hidden lg:block">
                        <Link
                            href="/signup"
                            className="inline-flex items-center gap-2 rounded-full border border-[#6BF7CF]/35 bg-[#6BF7CF]/10 px-4 py-2 text-sm font-medium text-[#C9FFF0] transition-all duration-200 hover:border-[#6BF7CF]/60 hover:bg-[#6BF7CF]/16"
                        >
                            Access Platform
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                    </div>

                    <button
                        type="button"
                        onClick={menuOpen ? onCloseMenu : onOpenMenu}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/80 transition-colors hover:text-white lg:hidden"
                        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                    >
                        {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </nav>

            <div
                className={joinClasses(
                    'fixed inset-0 z-40 bg-black/65 backdrop-blur-sm transition-opacity duration-300 lg:hidden',
                    menuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
                )}
                onClick={onCloseMenu}
                aria-hidden="true"
            />

            <div
                className={joinClasses(
                    'fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-none flex-col overflow-y-auto border-l border-white/10 bg-[#0A0E13]/96 p-5 shadow-[0_24px_64px_rgba(0,0,0,0.45)] transition-transform duration-300 sm:w-[86vw] sm:max-w-sm sm:p-6 lg:hidden',
                    menuOpen ? 'translate-x-0' : 'translate-x-full',
                )}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <BrandMark compact />
                        <span className="text-sm font-semibold tracking-[0.28em] text-white/55">VETIOS</span>
                    </div>
                    <button
                        type="button"
                        onClick={onCloseMenu}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-white/70"
                        aria-label="Close navigation menu"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="mt-10 flex flex-col gap-4 text-base text-white/75 sm:mt-12 sm:gap-5">
                    {navigationItems.map((item) => (
                        <Link
                            key={item.label}
                            href={item.href}
                            onClick={onCloseMenu}
                            className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 transition-colors hover:border-white/15 hover:text-white"
                        >
                            {item.label}
                        </Link>
                    ))}
                </div>

                <div className="mt-auto rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                    <p className="text-sm leading-6 text-white/58">
                        Closed-loop inference, outcome learning, simulation, and observability in one platform surface.
                    </p>
                    <Link
                        href="/signup"
                        onClick={onCloseMenu}
                        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#6BF7CF]/35 bg-[#6BF7CF]/10 px-4 py-3 text-sm font-medium text-[#C9FFF0] sm:w-auto sm:justify-start sm:py-2"
                    >
                        Access Platform
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            </div>
        </>
    );
}
