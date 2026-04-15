'use client';

import { useMemo, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import UserNav from '@/components/UserNav';
import VetiosGuide from '@/components/VetiosGuide';
import { Menu, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { isShelllessPublicPath } from '@/lib/site';

const PAGE_TITLES: Record<string, string> = {
    '/dashboard': 'DASHBOARD',
    '/inference': 'INFERENCE CONSOLE',
    '/outcome': 'OUTCOME LEARNING',
    '/simulate': 'SIMULATION WORKBENCH',
    '/dataset': 'CLINICAL DATASET',
    '/experiments': 'EXPERIMENT TRACK',
    '/models': 'MODEL REGISTRY',
    '/telemetry': 'TELEMETRY',
    '/intelligence': 'NETWORK',
    '/settings': 'SETTINGS',
};

export default function AppShell({ children }: { children: React.ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const pathname = usePathname();

    const handleToggle = useCallback(() => setSidebarOpen((prev) => !prev), []);
    const handleClose = useCallback(() => setSidebarOpen(false), []);

    const isShelllessSurface = pathname ? isShelllessPublicPath(pathname) : false;
    const pageTitle = useMemo(() => {
        if (!pathname) return 'DASHBOARD';
        const matched = Object.entries(PAGE_TITLES).find(([route]) => pathname === route || pathname.startsWith(`${route}/`));
        return matched?.[1] ?? 'CONSOLE';
    }, [pathname]);

    if (isShelllessSurface) {
        return <div className="flex-1 h-full overflow-auto bg-background">{children}</div>;
    }

    return (
        <>
            <div className="hidden lg:block">
                <Sidebar isOpen={true} onClose={() => undefined} isMobile={false} />
            </div>

            {sidebarOpen && (
                <>
                    <div className="sidebar-backdrop lg:hidden animate-fade-in" onClick={handleClose} aria-label="Close sidebar" />
                    <div className="sidebar-drawer lg:hidden animate-slide-in">
                        <Sidebar isOpen={sidebarOpen} onClose={handleClose} isMobile={true} />
                    </div>
                </>
            )}

            <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
                <header className="h-[52px] border-b border-grid bg-panel px-4 md:px-6 shrink-0 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                        <button onClick={handleToggle} className="lg:hidden text-[var(--text-secondary)]/70 hover:text-[var(--green-glow)] transition-all" aria-label="Toggle sidebar">
                            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                        </button>
                        <div className="hidden md:flex flex-col leading-none">
                            <span className="font-mono text-[18px] font-bold tracking-[0.06em] text-[var(--green-glow)]">VET_IOS //</span>
                            <span className="text-[8px] tracking-[0.2em] text-[var(--text-secondary)]/70">V1.0 OMEGA</span>
                        </div>
                        <div className="hidden md:block h-6 w-px bg-[var(--border-subtle)]" />
                        <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-secondary)] truncate">
                            VET_IOS // {'>'} {pageTitle} <span className="animate-blink-cursor">█</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 text-[10px]">
                        <div className="hidden sm:block"><VetiosGuide /></div>
                        <div className="hidden sm:block h-4 w-px bg-[var(--border-subtle)]" />
                        <UserNav />
                    </div>
                </header>

                <main className="flex-1 overflow-auto bg-background px-0">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={pathname}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 8 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="h-full"
                        >
                            {children}
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>

            <div className="desktop-recommended-overlay md:hidden">
                <div>
                    <div className="text-[var(--green-glow)] mb-2">DESKTOP RECOMMENDED</div>
                    <div style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                        VetIOS is optimized for 1280px+ clinical workstations.
                    </div>
                </div>
            </div>
        </>
    );
}
