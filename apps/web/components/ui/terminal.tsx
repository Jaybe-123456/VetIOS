'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';

/* ── TerminalLabel ─────────────────────────────────────────────────────────── */

export function TerminalLabel({ children, htmlFor }: { children: React.ReactNode, htmlFor?: string }) {
    return (
        <label
            htmlFor={htmlFor}
            className="block font-mono text-[11px] uppercase tracking-[0.16em] text-[hsl(0_0%_88%)] mb-2"
        >
            {children}
        </label>
    );
}

/* ── TerminalInput ─────────────────────────────────────────────────────────── */

export function TerminalInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={`
                w-full bg-[hsl(0_0%_10%)] border border-[hsl(0_0%_20%)]
                px-3 py-2.5 font-mono text-[13px] text-[hsl(0_0%_90%)]
                placeholder:text-[hsl(0_0%_62%)]
                focus:outline-none focus:border-accent focus:bg-[hsl(0_0%_11%)]
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
                w-full bg-[hsl(0_0%_10%)] border border-[hsl(0_0%_20%)]
                px-3 py-2.5 font-mono text-[13px] text-[hsl(0_0%_90%)]
                placeholder:text-[hsl(0_0%_62%)]
                focus:outline-none focus:border-accent focus:bg-[hsl(0_0%_11%)]
                transition-colors min-h-[100px] sm:min-h-[120px] resize-y
                ${className}
            `}
            {...props}
        />
    );
}

/* ── TerminalButton ────────────────────────────────────────────────────────── */

export function TerminalButton({
    children,
    variant = 'primary',
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
    const baseClasses = "font-mono text-[12px] uppercase tracking-[0.16em] px-4 sm:px-5 py-2.5 transition-all border";

    const variants = {
        primary:   "border-accent text-accent hover:bg-accent hover:text-black",
        secondary: "border-[hsl(0_0%_28%)] text-[hsl(0_0%_68%)] hover:border-[hsl(0_0%_48%)] hover:text-[hsl(0_0%_88%)]",
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

/* ── Container ─────────────────────────────────────────────────────────────── */

export function Container({ children, className = '' }: { children: React.ReactNode, className?: string }) {
    return (
        <div className={`w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 ${className}`}>
            {children}
        </div>
    );
}

/* ── PageHeader ────────────────────────────────────────────────────────────── */

export function PageHeader({ title, description }: { title: string, description?: string }) {
    return (
        <div className="mb-6 sm:mb-8 pb-4 sm:pb-5 border-b border-[hsl(0_0%_18%)]">
            <h1 className="font-mono text-lg sm:text-xl font-semibold text-[hsl(0_0%_94%)] tracking-[0.08em] mb-1.5">
                {title}
            </h1>
            {description && (
                <p className="font-mono text-[12px] text-[hsl(0_0%_80%)] leading-relaxed max-w-3xl">
                    {description}
                </p>
            )}
        </div>
    );
}

/* ── DataRow ───────────────────────────────────────────────────────────────── */

export function DataRow({ label, value }: { label: string, value: React.ReactNode }) {
    return (
        <div className="flex justify-between items-start gap-4 py-2.5 border-b border-[hsl(0_0%_16%)] min-w-0 last:border-b-0">
            <span className="font-mono text-[10px] sm:text-[11px] text-[hsl(0_0%_82%)] uppercase tracking-[0.14em] shrink-0 mt-0.5">
                {label}
            </span>
            <span className="font-mono text-[12px] sm:text-[13px] text-[hsl(0_0%_86%)] text-right break-all sm:break-words min-w-0 flex-1">
                {value}
            </span>
        </div>
    );
}

/* ── ConsoleCard ───────────────────────────────────────────────────────────── */

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
                border border-[hsl(0_0%_18%)] bg-[hsl(0_0%_8%)]
                p-4 sm:p-5 flex flex-col gap-3 sm:gap-4 animate-scale-in
                ${maximized ? 'fixed inset-4 z-50 overflow-auto' : ''}
                ${className}
            `}
        >
            {title && (
                <div className="
                    font-mono text-[10px] sm:text-[11px] text-[hsl(0_0%_80%)]
                    uppercase tracking-[0.18em]
                    border-b border-[hsl(0_0%_18%)] pb-3 sm:pb-4 mb-1
                    flex items-center justify-between
                ">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-accent shrink-0" />
                        <span className="text-[hsl(0_0%_90%)]">{title}</span>
                    </div>
                    {(collapsible || maximized) && (
                        <div className="flex items-center gap-1">
                            {collapsible && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
                                    className="p-1 text-[hsl(0_0%_40%)] hover:text-accent transition-colors"
                                    aria-label={collapsed ? 'Expand' : 'Collapse'}
                                >
                                    {collapsed
                                        ? <ChevronDown className="w-3.5 h-3.5" />
                                        : <ChevronUp className="w-3.5 h-3.5" />
                                    }
                                </button>
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); setMaximized(!maximized); }}
                                className="p-1 text-[hsl(0_0%_40%)] hover:text-accent transition-colors hidden sm:block"
                                aria-label={maximized ? 'Minimize' : 'Maximize'}
                            >
                                {maximized
                                    ? <Minimize2 className="w-3.5 h-3.5" />
                                    : <Maximize2 className="w-3.5 h-3.5" />
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

/* ── TerminalTabs ──────────────────────────────────────────────────────────── */

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
                            px-4 py-2 sm:px-5 sm:py-2 border font-mono
                            text-[10px] sm:text-[11px] uppercase tracking-[0.16em]
                            transition-all flex items-center gap-2
                            ${isActive
                                ? 'border-accent text-accent bg-[hsl(142_76%_46%_/_0.1)]'
                                : 'border-[hsl(0_0%_20%)] text-[hsl(0_0%_82%)] hover:border-[hsl(0_0%_32%)] hover:text-[hsl(0_0%_92%)] bg-[hsl(0_0%_8%)]'
                            }
                        `}
                    >
                        {tab.icon && (
                            <span className={isActive ? 'text-accent' : 'text-[hsl(0_0%_38%)]'}>
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
