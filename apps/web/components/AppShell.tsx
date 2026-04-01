'use client';

import { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import UserNav from '@/components/UserNav';
import { Menu, X, TerminalSquare } from 'lucide-react';
import { isShelllessPublicPath } from '@/lib/site';

export default function AppShell({ children }: { children: React.ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const pathname = usePathname();

    const handleToggle = useCallback(() => setSidebarOpen(prev => !prev), []);
    const handleClose = useCallback(() => setSidebarOpen(false), []);
    const isShelllessSurface = pathname ? isShelllessPublicPath(pathname) : false;

    if (isShelllessSurface) {
        return (
            <div className="flex-1 flex flex-col h-full overflow-auto bg-background">
                {children}
            </div>
        );
    }

    return (
        <>
            {/* ── Desktop Sidebar (always visible on lg+) ── */}
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
                {/* Header */}
                <header className="h-14 lg:h-16 border-b border-grid flex items-center justify-between px-4 lg:px-6 shrink-0 bg-background/80 backdrop-blur-md sticky top-0 z-30">
                    {/* Left: hamburger + branding on mobile */}
                    <div className="flex items-center gap-3 lg:hidden">
                        <button
                            onClick={handleToggle}
                            className="p-2 -ml-2 text-muted hover:text-accent transition-colors"
                            aria-label="Toggle sidebar"
                        >
                            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                        </button>
                        <span className="font-mono flex items-center gap-1.5 font-bold tracking-tight text-accent text-sm">
                            <TerminalSquare className="w-4 h-4" />
                            VET_IOS
                        </span>
                    </div>

                    {/* Spacer for desktop (sidebar provides branding) */}
                    <div className="hidden lg:block" />

                    {/* Right: user nav */}
                    <div className="flex items-center gap-4">
                        <UserNav />
                    </div>
                </header>

                {/* Main */}
                <main className="flex-1 overflow-auto bg-background">
                    {children}
                </main>
            </div>
        </>
    );
}
