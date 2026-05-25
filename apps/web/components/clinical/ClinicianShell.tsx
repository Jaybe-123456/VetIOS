'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { ClipboardList, Plus, Stethoscope } from 'lucide-react';
import { toast } from 'sonner';
import UserNav from '@/components/UserNav';

export function ClinicianShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const searchParams = useSearchParams();

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
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-[hsl(0_0%_100%_/_0.08)] px-4 lg:px-6">
                    <div className="flex items-center gap-2 lg:hidden">
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
                <main className="min-h-0 flex-1 overflow-auto">{children}</main>
            </div>
        </div>
    );
}

function ClinicalNavLink({
    href,
    active,
    icon,
    children,
}: {
    href: string;
    active: boolean;
    icon: ReactNode;
    children: ReactNode;
}) {
    return (
        <Link
            href={href}
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
