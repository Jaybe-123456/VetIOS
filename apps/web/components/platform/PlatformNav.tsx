'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
    { href: '/platform', label: 'Overview' },
    { href: '/platform/model-cards', label: 'Model Cards' },
    { href: '/platform/developers', label: 'Developers' },
    { href: '/platform/passive-signals', label: 'Passive Signals' },
    { href: '/platform/network-learning', label: 'Network Learning' },
    { href: '/platform/petpass', label: 'PetPass' },
    { href: '/platform/edge-box', label: 'Edge Box' },
];

export function PlatformNav() {
    const pathname = usePathname();

    return (
        <div className="flex flex-wrap gap-2">
            {navItems.map((item) => {
                const isActive = pathname === item.href || (item.href !== '/platform' && pathname?.startsWith(`${item.href}/`));
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`rounded-full border px-4 py-2 text-sm transition ${
                            isActive
                                ? 'border-white/20 bg-white text-slate-950'
                                : 'border-white/12 bg-white/[0.04] text-slate-200 hover:border-white/25 hover:bg-white/10'
                        }`}
                    >
                        {item.label}
                    </Link>
                );
            })}
        </div>
    );
}
