'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard,
    MessageSquare,
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
    { name: 'Dashboard',         href: '/dashboard',    icon: LayoutDashboard },
    { name: 'Ask VetIOS',        href: '/ask-vetios',   icon: MessageSquare   },
    { name: 'Inference Console', href: '/inference',    icon: TerminalSquare  },
    { name: 'Outcome Learning',  href: '/outcome',      icon: GraduationCap   },
    { name: 'Adversarial Sim',   href: '/simulate',     icon: ShieldAlert     },
    { name: 'Clinical Dataset',  href: '/dataset',      icon: Database        },
    { name: 'Experiment Track',  href: '/experiments',  icon: FlaskConical    },
    { name: 'Model Registry',    href: '/models',       icon: Cpu             },
    { name: 'Telemetry',         href: '/telemetry',    icon: Activity        },
    { name: 'Network',           href: '/intelligence', icon: Network         },
    { name: 'Settings',          href: '/settings',     icon: Settings        },
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
                    Navigation
                </span>
            </div>

            {/* ── Navigation Items ── */}
            <nav className="flex-1 overflow-y-auto py-1 px-2 flex flex-col gap-0.5">
                {navItems.map((item) => {
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
            </nav>

            {/* ── System Status ── */}
            <div className="p-3 border-t border-[hsl(0_0%_100%_/_0.07)] shrink-0">
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
