'use client';

import { useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import UserNav from '@/components/UserNav';
import VetiosGuide from '@/components/VetiosGuide';
import { Menu, X, TerminalSquare, ChevronLeft } from 'lucide-react';
import { isShelllessPublicPath } from '@/lib/site';

export default function AppShell({ children }: { children: React.ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const pathname = usePathname();
    const router = useRouter();

    const handleToggle = useCallback(() => setSidebarOpen(prev => !prev), []);
    const handleClose = useCallback(() => setSidebarOpen(false), []);
    const isShelllessSurface = pathname ? isShelllessPublicPath(pathname) : false;

    // Derive page title from pathname for center display
    const pageTitle = pathname
        ? pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ').toUpperCase() ?? 'DASHBOARD'
        : 'DASHBOARD';

    if (isShelllessSurface) {
        return (
            <div
                data-shellless-scroll="true"
                className="flex-1 flex flex-col h-full overflow-auto scroll-smooth bg-background"
            >
                {children}
            </div>
        );
    }

    return (
        <>
            {/* ── Desktop Sidebar ── */}
            <div className="hidden lg:block">
                <Sidebar isOpen={true} onClose={() => {}} isMobile={false} />
            </div>

            {/* ── Mobile Sidebar Drawer ── */}
            {sidebarOpen && (
                <>
                    <div
                        className="sidebar-backdrop lg:hidden animate-fade-in"
                        onClick={handleClose}
                        aria-label="Close sidebar"
                    />
                    <div className="sidebar-drawer lg:hidden animate-slide-in">
                        <Sidebar isOpen={sidebarOpen} onClose={handleClose} isMobile={true} />
                    </div>
                </>
            )}

            {/* ── Main Content Area ── */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative">

                {/* ── UPGRADED Topbar ── */}
                <header className="
                    h-12 lg:h-14 safe-top
                    flex items-center justify-between px-4 lg:px-6
                    shrink-0 glass-topbar sticky top-0 z-30
                ">
                    {/* Left: hamburger (mobile) + back button */}
                    <div className="flex items-center gap-2 lg:gap-3">
                        {/* Mobile hamburger */}
                        <button
                            onClick={handleToggle}
                            className="lg:hidden p-1.5 text-[hsl(0_0%_62%)] hover:text-accent transition-colors"
                            aria-label="Toggle sidebar"
                        >
                            {sidebarOpen
                                ? <X className="w-4 h-4" />
                                : <Menu className="w-4 h-4" />
                            }
                        </button>

                        {/* Mobile logo */}
                        <span className="lg:hidden font-mono flex items-center gap-1.5 font-bold tracking-tight text-accent text-sm">
                            <TerminalSquare className="w-4 h-4" />
                            VET_IOS
                        </span>

                        {/* Back button — desktop */}
                        <button
                            onClick={() => router.back()}
                            className="
                                hidden lg:flex items-center gap-1.5 px-2.5 py-1.5
                                text-[hsl(0_0%_58%)] hover:text-[hsl(0_0%_88%)]
                                border border-transparent hover:border-[hsl(0_0%_100%_/_0.12)]
                                hover:bg-[hsl(0_0%_100%_/_0.04)]
                                transition-all text-[11px] font-mono uppercase tracking-[0.14em] group
                            "
                            aria-label="Go back"
                        >
                            <ChevronLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                            Back
                        </button>
                    </div>

                    {/* Center: current page title */}
                    <div className="hidden lg:flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
                        <span className="font-mono text-[10px] topbar-title tracking-[0.18em] uppercase">
                            {pageTitle}
                        </span>
                        <span className="font-mono text-accent animate-blink text-xs leading-none">█</span>
                    </div>

                    {/* Right: guide + user nav */}
                    <div className="flex items-center gap-3">
                        <VetiosGuide />
                        <UserNav />
                    </div>
                </header>

                {/* ── Main content ── */}
                <main className="flex-1 min-h-0 overflow-auto bg-background safe-bottom">
                    {children}
                </main>
            </div>
        </>
    );
}
