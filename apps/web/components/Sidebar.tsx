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
        <aside className={`${isMobile ? 'w-full h-full' : 'w-[220px] xl:w-[220px] min-[1280px]:w-[48px] min-[1440px]:w-[220px]'} border-grid bg-panel flex flex-col shrink-0 border-r`}>
            <div className="border-grid flex h-[72px] items-center justify-between border-b px-4 py-3">
                <div className="leading-none">
                    <div className="sidebar-label font-mono text-[20px] font-bold tracking-[0.08em] text-primary">VET_IOS //</div>
                    <div className="sidebar-label font-mono text-[9px] tracking-[0.2em] text-muted-foreground">V1.0 OMEGA</div>
                </div>
                {isMobile && <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>

            <div className="pt-4">
                <div className="sidebar-label px-4 pb-2 text-[8px] tracking-[0.2em] text-muted-foreground">NAVIGATION</div>
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
                                className={`relative flex h-10 items-center gap-2 border-l-2 px-4 transition-all duration-150 ${active ? 'border-l-primary bg-primary/10 text-primary shadow-glow' : 'border-l-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                            >
                                <Icon className={`h-[14px] w-[14px] ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                                <span className="sidebar-label font-mono text-[10px] uppercase tracking-[0.12em]">{item.name}</span>
                                {active && <span className="absolute right-4 h-1 w-1 bg-primary" />}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            <div className="border-grid mt-auto border-t px-4 py-3">
                <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-secondary-foreground">
                    <span className="h-1 w-1 bg-primary animate-pulse-dot" />
                    <span className="sidebar-label">OPERATIONAL</span>
                    <span className="sidebar-label text-muted-foreground">{uptimeLabel}</span>
                </div>
                <div className="sidebar-label mt-2 font-mono text-[9px] text-muted-foreground">
                    INF: {snapshotStats.inf} · EVT: {snapshotStats.evt} · ERR: {snapshotStats.err}
                </div>
            </div>
        </aside>
    );
}
