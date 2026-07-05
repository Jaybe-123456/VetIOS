'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard,
    MessageSquare,
    ClipboardList,
    TerminalSquare,
    GraduationCap,
    ShieldAlert,
    Database,
    FlaskConical,
    Network,
    Activity,
    Settings,
    Cpu,
    BookOpenCheck,
    X
} from 'lucide-react';

const navItems = [
    {
        label: 'Start Here',
        items: [
            { name: 'System Dashboard', href: '/dashboard', icon: LayoutDashboard },
        ],
    },
    {
        label: 'Clinical Loop',
        items: [
            { name: 'Inference Console', href: '/inference', icon: TerminalSquare },
            { name: 'Outcome Learning', href: '/outcome', icon: GraduationCap },
            { name: 'Ask VetIOS', href: '/ask-vetios', icon: MessageSquare },
            { name: 'Clinical Cases', href: '/cases', icon: ClipboardList },
        ],
    },
    {
        label: 'Evidence Layer',
        items: [
            { name: 'Clinical Dataset', href: '/dataset', icon: Database },
            { name: 'Agentic RAG', href: '/rag', icon: BookOpenCheck },
        ],
    },
    {
        label: 'Model Ops',
        items: [
            { name: 'Adversarial Sim', href: '/simulate', icon: ShieldAlert },
            { name: 'Experiment Track', href: '/experiments', icon: FlaskConical },
            { name: 'Model Registry', href: '/models', icon: Cpu },
        ],
    },
    {
        label: 'Infrastructure Ops',
        items: [
            { name: 'Telemetry', href: '/telemetry', icon: Activity },
            { name: 'Topology', href: '/intelligence', icon: Network },
            { name: 'Control Plane', href: '/settings', icon: Settings },
        ],
    },
];

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    isMobile: boolean;
}

export default function Sidebar({ isOpen, onClose, isMobile }: SidebarProps) {
    const pathname = usePathname();

    function rememberClinicalMode() {
        window.localStorage.setItem('vetios_mode', 'clinician');
    }

    return (
        <aside className={`
            ${isMobile ? 'w-full h-full' : 'w-64 h-full'}
            glass-sidebar flex flex-col shrink-0 select-none
        `}>
            {/* ── Logo Header ── */}
            <div className="h-14 lg:h-16 flex items-center justify-between px-5 border-b border-[hsl(0_0%_100%_/_0.07)] shrink-0">
                <div className="flex flex-col gap-0.5">
                    <span className="font-mono flex items-center gap-2 font-bold tracking-tight text-accent text-base">
                        <TerminalSquare className="w-4 h-4" />
                        VET_IOS //
                    </span>
                    <span className="font-mono text-[9px] text-[hsl(0_0%_52%)] tracking-[0.22em] uppercase">
                        V1.0 OMEGA
                    </span>
                </div>
                {isMobile && (
                    <button
                        onClick={onClose}
                        className="p-3 -mr-2 text-[hsl(0_0%_55%)] hover:text-accent transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                        aria-label="Close sidebar"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}
            </div>

            {/* ── Nav label ── */}
            <div className="px-5 pt-4 pb-1">
                <span className="font-mono text-[9px] text-[hsl(0_0%_48%)] tracking-[0.22em] uppercase">
                    Infrastructure Console
                </span>
            </div>

            {/* ── Navigation Items ── */}
            <nav className="flex-1 overflow-y-auto py-1 px-2 flex flex-col gap-2">
                {navItems.map((section) => (
                    <div key={section.label} className="flex flex-col gap-0.5">
                        <div className="px-3 pt-2 pb-1 font-mono text-[8px] uppercase tracking-[0.2em] text-[hsl(0_0%_42%)]">
                            {section.label}
                        </div>
                        {section.items.map((item) => {
                            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={isMobile ? onClose : undefined}
                                    className={`
                                        flex items-center gap-3 px-3 py-3 sm:py-2.5 font-mono text-[11px] min-h-[44px]
                                        uppercase tracking-[0.12em] transition-all duration-150 group
                                        border-l-2
                                        ${isActive
                                            ? 'border-l-accent nav-item-active text-accent'
                                            : 'border-l-transparent text-[hsl(0_0%_62%)] hover:text-[hsl(0_0%_90%)] nav-item-glass hover:border-l-[hsl(0_0%_32%)]'
                                        }
                                    `}
                                >
                                    <Icon className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                        isActive
                                            ? 'text-accent'
                                            : 'text-[hsl(0_0%_48%)] group-hover:text-[hsl(0_0%_75%)]'
                                    }`} />
                                    <span className="truncate leading-none">{item.name}</span>
                                    {isActive && (
                                        <span className="ml-auto w-1 h-1 bg-accent shrink-0" />
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                ))}
            </nav>

            {/* ── System Status ── */}
            <div className="p-3 border-t border-[hsl(0_0%_100%_/_0.07)] shrink-0">
                <Link
                    href="/cases"
                    onClick={rememberClinicalMode}
                    className="mb-2 flex min-h-[36px] items-center px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(0_0%_58%)] transition-colors hover:text-accent"
                >
                    Clinical view -&gt;
                </Link>
                <div className="flex items-center gap-3 px-3 py-2.5 glass-card hover:border-accent/30 transition-all duration-300 cursor-default">
                    <div className="w-1.5 h-1.5 bg-accent animate-pulse shadow-[0_0_8px_hsl(142_76%_46%),0_0_16px_hsl(142_76%_46%_/_0.5)] shrink-0" />
                    <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-mono text-[9px] text-[hsl(0_0%_55%)] uppercase tracking-[0.18em]">System Status</span>
                        <span className="font-mono text-[11px] text-accent uppercase tracking-[0.12em] font-medium">Operational</span>
                    </div>
                </div>
            </div>
        </aside>
    );
}
