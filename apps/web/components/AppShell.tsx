'use client';

import { useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import UserNav from '@/components/UserNav';
import VetiosGuide from '@/components/VetiosGuide';
import { Menu, X, TerminalSquare, ArrowLeft } from 'lucide-react';
import { isShelllessPublicPath } from '@/lib/site';

export default function AppShell({ children }: { children: React.ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const pathname = usePathname();
    const router = useRouter();

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
                    {/* Left: hamburger + branding on mobile, and back button */}
                    <div className="flex items-center gap-2 lg:gap-4">
                        <div className="flex items-center gap-3 lg:hidden">
                            <button
                                onClick={handleToggle}
                                className="p-2 -ml-2 text-muted hover:text-accent transition-colors"
                                aria-label="Toggle sidebar"
                            >
                                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                            </button>
                            <span className="font-mono flex items-center gap-1.5 font-bold tracking-tight text-accent text-sm mr-1">
                                <TerminalSquare className="w-4 h-4" />
                                VET_IOS
                            </span>
                        </div>

                        {/* Back Button */}
                        <button
                            onClick={() => router.back()}
                            className="flex items-center gap-1.5 p-1.5 lg:px-2.5 lg:py-1.5 rounded-md text-muted hover:text-accent hover:bg-muted/10 transition-all text-sm font-medium group"
                            aria-label="Go back"
                            title="Go back"
                        >
                            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                            <span className="hidden sm:inline">Back</span>
                        </button>
                    </div>

                    {/* Spacer for desktop */}
                    <div className="hidden lg:block flex-1" />

                    {/* Right: user nav */}
                    <div className="flex items-center gap-4">
                        <VetiosGuide />
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
