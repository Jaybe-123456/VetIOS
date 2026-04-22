'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';

/* ── TerminalLabel ─────────────────────────────────────────────────────────── */

export function TerminalLabel({ children, htmlFor }: { children: React.ReactNode, htmlFor?: string }) {
    return (
        <label
            htmlFor={htmlFor}
            className="block font-mono text-[12px] uppercase tracking-[0.16em] text-[hsl(0_0%_94%)] mb-2"
        >
            {children}
        </label>
    );
}

/* ── TerminalInput ───────────────────────────────────────────────────────────── */

export function TerminalInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={`
                w-full bg-[hsl(0_0%_8%_/_0.9)] border border-[hsl(0_0%_100%_/_0.08)]
                px-3 py-2.5 font-mono text-[14px] text-[hsl(0_0%_94%)]
                placeholder:text-[hsl(0_0%_55%)]
                focus:outline-none focus:border-accent/60 focus:bg-[hsl(0_0%_10%)]
                shadow-[inset_0_1px_3px_hsl(0_0%_0%_/_0.3)]
                transition-colors
                ${className}
            `}
            {...props}
        />
    );
}

/* ── TerminalTextarea ──────────────────────────────────────────────────────── */

export function TerminalTextarea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            className={`
                w-full bg-[hsl(0_0%_8%_/_0.9)] border border-[hsl(0_0%_100%_/_0.08)]
                px-3 py-2.5 font-mono text-[14px] text-[hsl(0_0%_94%)]
                placeholder:text-[hsl(0_0%_55%)]
                focus:outline-none focus:border-accent/60 focus:bg-[hsl(0_0%_10%)]
                shadow-[inset_0_1px_3px_hsl(0_0%_0%_/_0.3)]
                transition-colors min-h-[100px] sm:min-h-[120px] resize-y
                ${className}
            `}
            {...props}
        />
    );
}

/* ── TerminalButton ───────────────────────────────────────────────────────── */

export function TerminalButton({
    children,
    variant = 'primary',
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
    const baseClasses = "font-mono text-[13px] uppercase tracking-[0.16em] px-4 sm:px-5 py-3 sm:py-2.5 transition-all border min-h-[44px] touch-manipulation flex items-center justify-center";

    const variants = {
        primary:   "border-accent/70 text-accent hover:bg-accent hover:text-black bg-[hsl(142_76%_46%_/_0.05)] shadow-[0_0_12px_hsl(142_76%_46%_/_0.1)] hover:shadow-[0_0_20px_hsl(142_76%_46%_/_0.3)] transition-all",
        secondary: "border-[hsl(0_0%_32%)] text-[hsl(0_0%_78%)] hover:border-[hsl(0_0%_48%)] hover:text-[hsl(0_0%_94%)]",
        danger:    "border-destructive text-destructive hover:bg-destructive hover:text-white",
    };

    return (
        <button
            className={`${baseClasses} ${variants[variant]} disabled:opacity-40 disabled:cursor-not-allowed`}
            {...props}
        >
            {children}
        </button>
    );
}

/* ── Container ────────────────────────────────────────────────────────────── */

export function Container({ children, className = '' }: { children: React.ReactNode, className?: string }) {
    return (
        <div className={`w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 ${className}`}>
            {children}
        </div>
    );
}

/* ── PageHeader ───────────────────────────────────────────────────────────── */

export function PageHeader({ title, description }: { title: string, description?: string }) {
    return (
        <div className="mb-6 sm:mb-8 pb-4 sm:pb-5 border-b border-[hsl(0_0%_100%_/_0.08)] relative accent-line-top">
            <h1 className="font-mono text-xl sm:text-2xl font-semibold text-[hsl(0_0%_97%)] tracking-[0.08em] mb-1.5">
                {title}
            </h1>
            {description && (
                <p className="font-mono text-[13px] sm:text-[14px] text-[hsl(0_0%_92%)] leading-relaxed max-w-3xl">
                    {description}
                </p>
            )}
        </div>
    );
}

/* ── DataRow ──────────────────────────────────────────────────────────────── */

export function DataRow({ label, value, tone }: { label: string, value: React.ReactNode, tone?: 'accent' | 'warning' | 'danger' | 'muted' | 'cyan' | 'violet' }) {
    const toneClass = tone === 'accent'  ? 'text-[hsl(142_76%_50%)]'
                    : tone === 'warning' ? 'text-[hsl(45_100%_55%)]'
                    : tone === 'danger'  ? 'text-[hsl(0_85%_62%)]'
                    : tone === 'muted'   ? 'text-[hsl(0_0%_50%)]'
                    : tone === 'cyan'    ? 'text-[hsl(190_90%_60%)]'
                    : tone === 'violet'  ? 'text-[hsl(265_80%_72%)]'
                    : 'text-[hsl(0_0%_98%)]';
    return (
        <div className="flex justify-between items-start gap-4 py-2.5 border-b border-[hsl(0_0%_100%_/_0.06)] min-w-0 last:border-b-0">
            <span className="font-mono text-[11px] sm:text-[12px] text-[hsl(0_0%_60%)] uppercase tracking-[0.14em] shrink-0 mt-0.5">
                {label}
            </span>
            <span className={"font-mono text-[13px] sm:text-[14px] text-right break-all sm:break-words min-w-0 flex-1 " + toneClass}>
                {value}
            </span>
        </div>
    );
}

/* ── ConsoleCard ──────────────────────────────────────────────────────────── */

export function ConsoleCard({
    title,
    children,
    className = '',
    onClick,
    collapsible = false,
    defaultCollapsed = false,
}: {
    title?: string,
    children: React.ReactNode,
    className?: string,
    onClick?: () => void,
    collapsible?: boolean,
    defaultCollapsed?: boolean,
}) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    const [maximized, setMaximized] = useState(false);

    const cardContent = (
        <div
            onClick={onClick}
            className={`
                console-card-glass
                p-4 sm:p-5 flex flex-col gap-3 sm:gap-4 animate-scale-in
                ${maximized ? 'fixed inset-4 z-50 overflow-auto' : ''}
                ${className}
            `}
        >
            {title && (
                <div className="
                    font-mono text-[11px] sm:text-[12px] text-[hsl(0_0%_96%)]
                    uppercase tracking-[0.18em]
                    border-b border-[hsl(0_0%_100%_/_0.07)] pb-3 sm:pb-4 mb-1
                    flex items-center justify-between
                    bg-gradient-to-r from-[hsl(0_0%_100%_/_0.03)] to-transparent
                    -mx-4 sm:-mx-5 px-4 sm:px-5 -mt-4 sm:-mt-5 pt-4 sm:pt-5 rounded-t-sm
                ">

                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-accent shrink-0 shadow-[0_0_6px_hsl(142_76%_46%_/_0.8)]" />
                        <span className="text-[hsl(0_0%_96%)]">{title}</span>
                    </div>
                    {(collapsible || maximized) && (
                        <div className="flex items-center gap-1">
                            {collapsible && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
                                    className="p-2 sm:p-1 text-[hsl(0_0%_62%)] hover:text-accent transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center touch-manipulation"
                                    aria-label={collapsed ? 'Expand' : 'Collapse'}
                                >
                                    {collapsed
                                        ? <ChevronDown className="w-4 h-4" />
                                        : <ChevronUp className="w-4 h-4" />
                                    }
                                </button>
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); setMaximized(!maximized); }}
                                className="p-1 text-[hsl(0_0%_48%)] hover:text-accent transition-colors hidden sm:block"
                                aria-label={maximized ? 'Minimize' : 'Maximize'}
                            >
                                {maximized
                                    ? <Minimize2 className="w-4 h-4" />
                                    : <Maximize2 className="w-4 h-4" />
                                }
                            </button>
                        </div>
                    )}
                </div>
            )}
            {!collapsed && children}
        </div>
    );

    if (maximized) {
        return (
            <>
                <div
                    className="fixed inset-0 bg-black/90 z-40"
                    onClick={() => setMaximized(false)}
                />
                {cardContent}
            </>
        );
    }

    return cardContent;
}

/* ── TerminalTabs ────────────────────────────────────────────────────────── */

export function TerminalTabs<T extends string>({
    tabs,
    activeTab,
    onTabChange,
    className = '',
}: {
    tabs: Array<{ id: T; label: string; icon?: React.ReactNode }>;
    activeTab: T;
    onTabChange: (id: T) => void;
    className?: string;
}) {
    return (
        <div className={`flex flex-wrap gap-1.5 mb-6 sm:mb-8 ${className}`}>
            {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onTabChange(tab.id)}
                        className={`
                            px-3 py-3 sm:px-5 sm:py-2 border font-mono min-h-[44px] touch-manipulation
                            text-[11px] sm:text-[12px] uppercase tracking-[0.16em]
                            transition-all flex items-center gap-2
                            ${isActive
                                ? 'border-accent/70 text-accent bg-[hsl(142_76%_46%_/_0.1)] shadow-[0_0_12px_hsl(142_76%_46%_/_0.15),inset_0_1px_0_hsl(142_76%_46%_/_0.2)]'
                                : 'border-[hsl(0_0%_28%)] text-[hsl(0_0%_90%)] hover:border-[hsl(0_0%_42%)] hover:text-[hsl(0_0%_98%)] bg-[hsl(0_0%_9%)]'
                            }
                        `}
                    >
                        {tab.icon && (
                            <span className={isActive ? 'text-accent' : 'text-[hsl(0_0%_44%)]'}>
                                {tab.icon}
                            </span>
                        )}
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
