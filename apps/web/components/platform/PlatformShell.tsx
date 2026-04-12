import type { ReactNode } from 'react';
import Link from 'next/link';
import { PlatformNav } from '@/components/platform/PlatformNav';

export function PlatformShell({
    badge,
    title,
    description,
    actions,
    children,
    showNav = true,
}: {
    badge: string;
    title: string;
    description: string;
    actions?: ReactNode;
    children: ReactNode;
    showNav?: boolean;
}) {
    return (
        <div className="min-h-full bg-[#07101f] text-white">
            <div className="mx-auto max-w-7xl px-6 py-10 sm:px-8 lg:px-12">
                <div className="rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_32%),linear-gradient(180deg,_rgba(15,23,42,0.97),_rgba(7,16,31,0.98))] p-8 shadow-[0_30px_120px_rgba(2,6,23,0.45)] sm:p-10">
                    <div className="flex flex-wrap items-start justify-between gap-6">
                        <div className="max-w-4xl">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-200">
                                {badge}
                            </div>
                            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-5xl">{title}</h1>
                            <p className="mt-4 max-w-3xl text-base leading-8 text-slate-300">{description}</p>
                        </div>
                        <div className="flex flex-col items-start gap-4 lg:items-end">
                            {showNav ? <PlatformNav /> : null}
                            <div className="flex flex-wrap gap-3">
                                {actions}
                                <Link
                                    href="/login"
                                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white transition hover:border-white/30 hover:bg-white/10"
                                >
                                    Open console
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-10">
                    {children}
                </div>
            </div>
        </div>
    );
}
