'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
    Activity,
    Cpu,
    Database,
    FlaskConical,
    GitMerge,
    LayoutDashboard,
    Layers,
    Network,
    Settings2,
    TestTube2,
    X,
} from 'lucide-react';

const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Inference Console', href: '/inference', icon: Cpu },
    { name: 'Outcome Learning', href: '/outcome', icon: GitMerge },
    { name: 'Adversarial Sim', href: '/simulate', icon: FlaskConical },
    { name: 'Clinical Dataset', href: '/dataset', icon: Database },
    { name: 'Experiment Track', href: '/experiments', icon: TestTube2 },
    { name: 'Model Registry', href: '/models', icon: Layers },
    { name: 'Telemetry', href: '/telemetry', icon: Activity },
    { name: 'Network', href: '/intelligence', icon: Network },
    { name: 'Settings', href: '/settings', icon: Settings2 },
];

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    isMobile: boolean;
}

export default function Sidebar({ onClose, isMobile }: SidebarProps) {
    const pathname = usePathname();
    const [uptimeSeconds, setUptimeSeconds] = useState(0);
    const [snapshotStats, setSnapshotStats] = useState({ inf: 0, evt: 0, err: 0 });

    useEffect(() => {
        const mountedAt = Date.now();
        const interval = window.setInterval(() => {
            setUptimeSeconds(Math.floor((Date.now() - mountedAt) / 1000));
        }, 1000);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        void (async () => {
            try {
                const res = await fetch('/api/diagnostic/snapshot', { cache: 'no-store' });
                if (!res.ok) return;
                const json = await res.json() as Record<string, unknown>;
                const data = (json.snapshot ?? json.data ?? json) as Record<string, unknown>;
                setSnapshotStats({
                    inf: Number(data?.inference_count ?? data?.inferences_today ?? 0),
                    evt: Number(data?.event_count ?? data?.events_total ?? 0),
                    err: Number(data?.error_count ?? 0),
                });
            } catch {
                setSnapshotStats((current) => ({ ...current, err: current.err || 0 }));
            }
        })();
    }, []);

    const uptimeLabel = useMemo(() => {
        const d = Math.floor(uptimeSeconds / 86400);
        const h = Math.floor((uptimeSeconds % 86400) / 3600);
        const m = Math.floor((uptimeSeconds % 3600) / 60);
        return `UP ${d}D ${h}H ${m}M`;
    }, [uptimeSeconds]);

    return (
        <aside className={`${isMobile ? 'w-full h-full' : 'w-[220px] xl:w-[220px] min-[1280px]:w-[48px] min-[1440px]:w-[220px]'} border-r border-grid bg-panel flex flex-col shrink-0`}>
            <div className="h-[72px] px-4 py-3 border-b border-grid flex items-center justify-between">
                <div className="leading-none">
                    <div className="font-mono text-[20px] font-bold tracking-[0.08em] text-[var(--green-glow)] sidebar-label">VET_IOS //</div>
                    <div className="font-mono text-[9px] tracking-[0.2em] text-[var(--text-secondary)]/60 sidebar-label">V1.0 OMEGA</div>
                </div>
                {isMobile && <button onClick={onClose} className="text-[var(--text-ghost)] hover:text-[var(--text-muted)]"><X className="w-4 h-4" /></button>}
            </div>

            <div className="pt-4">
                <div className="px-4 pb-2 text-[8px] tracking-[0.2em] text-[var(--text-secondary)]/60 sidebar-label">NAVIGATION</div>
                <nav className="flex flex-col">
                    {navItems.map((item) => {
                        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                        const Icon = item.icon;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={isMobile ? onClose : undefined}
                                title={item.name.toUpperCase()}
                                className={`relative h-10 px-4 flex items-center gap-2 transition-all duration-150 border-l-2 ${active ? 'bg-[var(--green-dim)] border-l-[var(--green-bright)] text-[var(--green-glow)]' : 'border-l-transparent text-[var(--text-secondary)]/70 hover:text-[var(--green-glow)] hover:bg-[var(--bg-elevated)]'}`}
                            >
                                <Icon className={`w-[14px] h-[14px] ${active ? 'text-[var(--green-bright)]' : 'text-[var(--text-secondary)]/70'}`} />
                                <span className="sidebar-label font-mono text-[10px] tracking-[0.12em] uppercase">{item.name}</span>
                                {active && <span className="absolute right-4 h-1 w-1 bg-[var(--green-bright)]" />}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            <div className="mt-auto border-t border-grid px-4 py-3">
                <div className="flex items-center gap-2 text-[9px] font-mono tracking-[0.16em] text-[var(--text-secondary)]">
                    <span className="h-1 w-1 bg-[var(--green-bright)] animate-pulse-dot" />
                    <span className="sidebar-label">OPERATIONAL</span>
                    <span className="text-[var(--text-secondary)]/70 sidebar-label">{uptimeLabel}</span>
                </div>
                <div className="mt-2 font-mono text-[9px] text-[var(--text-secondary)]/60 sidebar-label">
                    INF: {snapshotStats.inf} · EVT: {snapshotStats.evt} · ERR: {snapshotStats.err}
                </div>
            </div>
        </aside>
    );
}
