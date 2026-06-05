'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ClipboardList, Plus, Stethoscope, Menu, X } from 'lucide-react';
import { toast } from 'sonner';
import UserNav from '@/components/UserNav';

export function ClinicianShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [drawerOpen, setDrawerOpen] = useState(false);

    useEffect(() => {
        window.localStorage.setItem('vetios_mode', 'clinician');
    }, []);

    useEffect(() => {
        if (searchParams.get('console_access') === 'admin_required') {
            toast.error('Console access requires an admin account.');
        }
    }, [searchParams]);

    function rememberConsoleMode() {
        window.localStorage.setItem('vetios_mode', 'console');
    }

    return (
        <div className="flex h-full min-h-0 w-full bg-background text-foreground">
            {/* ── Desktop Sidebar ── */}
            <aside className="hidden w-60 shrink-0 border-r border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_6%_/_0.96)] p-4 lg:flex lg:flex-col">
                <Link href="/cases" className="flex items-center gap-2 text-accent">
                    <Stethoscope className="h-4 w-4" />
                    <span className="font-mono text-sm font-semibold tracking-[0.12em]">VET_IOS</span>
                </Link>
                <nav className="mt-8 flex flex-col gap-2">
                    <ClinicalNavLink href="/cases/new" active={pathname === '/cases/new'} icon={<Plus className="h-4 w-4" />}>
                        New Case
                    </ClinicalNavLink>
                    <ClinicalNavLink href="/cases" active={pathname === '/cases'} icon={<ClipboardList className="h-4 w-4" />}>
                        My Cases
                    </ClinicalNavLink>
                </nav>
                <Link
                    href="/console"
                    onClick={rememberConsoleMode}
                    className="mt-auto font-mono text-xs text-[hsl(0_0%_52%)] transition-colors hover:text-accent"
                >
                    Console view -&gt;
                </Link>
            </aside>

            {/* ── Mobile Sidebar Drawer ── */}
            {drawerOpen && (
                <>
                    <div
                        className="fixed inset-0 bg-black/80 z-40 lg:hidden animate-fade-in"
                        onClick={() => setDrawerOpen(false)}
                        aria-label="Close sidebar"
                    />
                    <div className="fixed top-0 left-0 bottom-0 z-50 w-64 max-w-[80vw] bg-[hsl(0_0%_6%_/_0.98)] p-4 flex flex-col border-r border-white/10 lg:hidden animate-slide-in">
                        <div className="flex items-center justify-between">
                            <Link href="/cases" className="flex items-center gap-2 text-accent" onClick={() => setDrawerOpen(false)}>
                                <Stethoscope className="h-4 w-4" />
                                <span className="font-mono text-sm font-semibold tracking-[0.12em]">VET_IOS</span>
                            </Link>
                            <button
                                onClick={() => setDrawerOpen(false)}
                                className="p-1 text-[hsl(0_0%_62%)] hover:text-accent min-h-[40px] min-w-[40px] flex items-center justify-center"
                                aria-label="Close menu"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <nav className="mt-8 flex flex-col gap-2">
                            <ClinicalNavLink
                                href="/cases/new"
                                active={pathname === '/cases/new'}
                                icon={<Plus className="h-4 w-4" />}
                                onClick={() => setDrawerOpen(false)}
                            >
                                New Case
                            </ClinicalNavLink>
                            <ClinicalNavLink
                                href="/cases"
                                active={pathname === '/cases'}
                                icon={<ClipboardList className="h-4 w-4" />}
                                onClick={() => setDrawerOpen(false)}
                            >
                                My Cases
                            </ClinicalNavLink>
                        </nav>
                        <Link
                            href="/console"
                            onClick={() => {
                                rememberConsoleMode();
                                setDrawerOpen(false);
                            }}
                            className="mt-auto font-mono text-xs text-[hsl(0_0%_52%)] transition-colors hover:text-accent py-2"
                        >
                            Console view -&gt;
                        </Link>
                    </div>
                </>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-[hsl(0_0%_100%_/_0.08)] px-4 lg:px-6">
                    <div className="flex items-center gap-2 lg:hidden">
                        <button
                            onClick={() => setDrawerOpen((prev) => !prev)}
                            className="p-1.5 -ml-1 text-[hsl(0_0%_62%)] hover:text-accent transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
                            aria-label="Toggle menu"
                        >
                            <Menu className="h-4 w-4" />
                        </button>
                        <Stethoscope className="h-4 w-4 text-accent" />
                        <span className="font-mono text-sm font-semibold tracking-[0.12em] text-accent">VET_IOS</span>
                    </div>
                    <div className="hidden items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[hsl(0_0%_60%)] lg:flex">
                        Clinical workspace
                    </div>
                    <div className="flex items-center gap-3">
                        <Link href="/cases/new" className="font-mono text-xs text-accent lg:hidden">New Case</Link>
                        <UserNav />
                    </div>
                </header>
                {/* pb-24 adds extra space at bottom on mobile to prevent buttons from being cut off by dynamic address bar */}
                <main className="min-h-0 flex-1 overflow-auto pb-24 lg:pb-0">{children}</main>
            </div>
        </div>
    );
}

function ClinicalNavLink({
    href,
    active,
    icon,
    children,
    onClick,
}: {
    href: string;
    active: boolean;
    icon: ReactNode;
    children: ReactNode;
    onClick?: () => void;
}) {
    return (
        <Link
            href={href}
            onClick={onClick}
            className={`flex min-h-[42px] items-center gap-3 border-l-2 px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
                active
                    ? 'border-l-accent bg-accent/10 text-accent'
                    : 'border-l-transparent text-[hsl(0_0%_68%)] hover:bg-white/[0.03] hover:text-white'
            }`}
        >
            {icon}
            {children}
        </Link>
    );
}

