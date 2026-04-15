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
                    <div className="sidebar-backdrop lg:hidden" onClick={handleClose} aria-label="Close sidebar" />
                    <div className="sidebar-drawer lg:hidden animate-slide-in">
                        <Sidebar isOpen={sidebarOpen} onClose={handleClose} isMobile={true} />
                    </div>
                </>
            )}

            <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
                <header className="bg-panel border-grid flex h-[52px] items-center justify-between gap-4 border-b px-4 md:px-6 shrink-0">
                    <div className="flex min-w-0 items-center gap-4">
                        <button onClick={handleToggle} className="text-muted-foreground transition-colors hover:text-foreground lg:hidden" aria-label="Toggle sidebar">
                            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                        </button>
                        <div className="hidden flex-col leading-none md:flex">
                            <span className="font-mono text-[18px] font-bold tracking-[0.06em] text-primary">VET_IOS //</span>
                            <span className="text-[8px] tracking-[0.2em] text-muted-foreground">V1.0 OMEGA</span>
                        </div>
                        <div className="hidden h-6 w-px bg-border md:block" />
                        <div className="truncate font-mono text-[10px] tracking-[0.14em] text-secondary-foreground">
                            VET_IOS // {'>'} {pageTitle} <span className="animate-blink-cursor">█</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 text-[10px]">
                        <div className="hidden sm:block"><VetiosGuide /></div>
                        <div className="hidden h-4 w-px bg-border sm:block" />
                        <UserNav />
                    </div>
                </header>

                <main className="flex-1 overflow-auto bg-background">
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
        </>
    );
}
