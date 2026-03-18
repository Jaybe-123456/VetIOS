'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard,
    TerminalSquare,
    GraduationCap,
    ShieldAlert,
    Database,
    FlaskConical,
    Network,
    Activity,
    Settings,
    Cpu,
    X
} from 'lucide-react';

const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Inference Console', href: '/inference', icon: TerminalSquare },
    { name: 'Outcome Learning', href: '/outcome', icon: GraduationCap },
    { name: 'Adversarial Sim', href: '/simulate', icon: ShieldAlert },
    { name: 'Clinical Dataset', href: '/dataset', icon: Database },
    { name: 'Experiment Track', href: '/experiments', icon: FlaskConical },
    { name: 'Model Registry', href: '/models', icon: Cpu },
    { name: 'Telemetry', href: '/telemetry', icon: Activity },
    { name: 'Network', href: '/intelligence', icon: Network },
    { name: 'Settings', href: '/settings', icon: Settings },
];

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    isMobile: boolean;
}

export default function Sidebar({ isOpen, onClose, isMobile }: SidebarProps) {
    const pathname = usePathname();

    return (
        <aside className={`
            ${isMobile ? 'w-full h-full' : 'w-64 h-full'}
            border-r border-grid bg-dim flex flex-col shrink-0 select-none
        `}>
            {/* Header */}
            <div className="h-14 lg:h-16 flex items-center justify-between px-5 border-b border-grid shrink-0">
                <div className="flex flex-col">
                    <span className="font-mono flex items-center gap-2 font-bold tracking-tight text-accent text-lg">
                        <TerminalSquare className="w-5 h-5" />
                        VET_IOS //
                    </span>
                    <span className="font-mono text-[10px] text-muted tracking-widest uppercase">
                        V1.0 OMEGA
                    </span>
                </div>
                {isMobile && (
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-muted hover:text-accent transition-colors"
                        aria-label="Close sidebar"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-4 lg:py-6 px-3 flex flex-col gap-0.5">
                {navItems.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={isMobile ? onClose : undefined}
                            className={`flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-sm font-mono text-xs uppercase tracking-wider transition-all duration-200 group
                                ${isActive
                                    ? 'bg-accent/10 text-accent border border-accent/20'
                                    : 'text-muted hover:text-foreground hover:bg-white/5 border border-transparent'
                                }`}
                        >
                            <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-accent' : 'text-muted group-hover:text-foreground'}`} />
                            <span className="truncate">{item.name}</span>
                        </Link>
                    );
                })}
            </nav>

            {/* System Status */}
            <div className="p-3 lg:p-4 border-t border-grid shrink-0">
                <div className="flex items-center gap-3 p-3 bg-background border border-grid rounded-sm transition-colors hover:border-accent/30 cursor-crosshair">
                    <div className="w-2 h-2 rounded-full bg-accent animate-pulse shadow-[0_0_8px_rgba(0,255,65,0.6)]" />
                    <div className="flex flex-col w-full overflow-hidden">
                        <span className="font-mono text-[10px] text-muted uppercase">System Status</span>
                        <span className="font-mono text-xs text-accent uppercase truncate">Operational</span>
                    </div>
                </div>
            </div>
        </aside>
    );
}
