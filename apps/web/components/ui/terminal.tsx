'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';

export function TerminalLabel({ children, htmlFor }: { children: React.ReactNode, htmlFor?: string }) {
    return (
        <label htmlFor={htmlFor} className="mb-2 block border-l-2 border-[var(--green-mid)] pl-2 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-ghost)]">
            {children}
        </label>
    );
}

export function TerminalInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={`h-9 w-full rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 font-mono text-[12px] text-[var(--green-glow)] placeholder:text-[var(--text-ghost)] transition-all duration-150 focus:border-[var(--green-bright)] focus:bg-[var(--bg-overlay)] focus:outline-none ${className}`}
            {...props}
        />
    );
}

export function TerminalTextarea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            className={`min-h-[120px] w-full resize-y rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 font-mono text-[12px] text-[var(--green-glow)] placeholder:text-[var(--text-ghost)] transition-all duration-150 focus:border-[var(--green-bright)] focus:bg-[var(--bg-overlay)] focus:outline-none ${className}`}
            {...props}
        />
    );
}

export function TerminalButton({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
    const variants = {
        primary: 'border-[var(--green-bright)] bg-[var(--green-dim)] text-[var(--green-glow)] hover:bg-[var(--green-mid)] hover:text-[var(--bg-base)]',
        secondary: 'border-[var(--border-default)] bg-transparent text-[var(--text-secondary)] hover:border-[var(--green-bright)] hover:text-[var(--green-glow)]',
        danger: 'border-[var(--red-bright)] bg-[var(--red-dim)] text-[var(--red-bright)] hover:bg-[var(--red-bright)] hover:text-[var(--bg-base)]',
    };

    return (
        <button
            className={`relative inline-flex items-center justify-center gap-2 rounded-[3px] border px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
            {...props}
        >
            {children}
        </button>
    );
}

export function Container({ children, className = '' }: { children: React.ReactNode, className?: string }) {
    return <div className={`mx-auto w-full max-w-[1700px] px-6 py-6 ${className}`}>{children}</div>;
}

export function PageHeader({ title, description }: { title: string, description?: string }) {
    return (
        <div className="mb-5 flex flex-col gap-2 border-b border-[var(--border-subtle)] pb-4">
            <h1 className="font-mono text-[18px] font-semibold uppercase tracking-[0.14em] text-[var(--text-primary)]">{title}</h1>
            {description ? <p className="font-sans text-[13px] leading-relaxed text-[var(--text-muted)]">{description}</p> : null}
        </div>
    );
}

export function DataRow({ label, value }: { label: string, value: React.ReactNode }) {
    return (
        <div className="flex min-w-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)] py-2">
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-ghost)]">{label}</span>
            <span className="min-w-0 flex-1 break-all text-right font-mono text-[11px] text-[var(--text-secondary)]">{value}</span>
        </div>
    );
}

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

    const card = (
        <section onClick={onClick} className={`card-surface p-4 md:p-5 transition-all duration-150 ${maximized ? 'fixed inset-4 z-50 overflow-auto' : ''} ${className}`}>
            {title ? (
                <div className="mb-3 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                        <span className="h-1 w-1 bg-[var(--green-bright)]" />
                        ■ {title}
                    </div>
                    {(collapsible || maximized) ? (
                        <div className="flex items-center gap-1">
                            {collapsible ? (
                                <button onClick={(e) => { e.stopPropagation(); setCollapsed((p) => !p); }} className="p-1 text-[var(--text-ghost)] hover:text-[var(--text-muted)]">
                                    {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                                </button>
                            ) : null}
                            <button onClick={(e) => { e.stopPropagation(); setMaximized((p) => !p); }} className="hidden p-1 text-[var(--text-ghost)] hover:text-[var(--text-muted)] sm:block">
                                {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : null}
            {!collapsed ? children : null}
        </section>
    );

    if (!maximized) return card;
    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/90" onClick={() => setMaximized(false)} />
            {card}
        </>
    );
}

export function TerminalTabs<T extends string>({ tabs, activeTab, onTabChange, className = '' }: { tabs: Array<{ id: T; label: string; icon?: React.ReactNode }>; activeTab: T; onTabChange: (id: T) => void; className?: string; }) {
    return (
        <div className={`mb-4 flex flex-wrap gap-2 ${className}`}>
            {tabs.map((tab) => {
                const active = tab.id === activeTab;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onTabChange(tab.id)}
                        className={`inline-flex h-[34px] items-center gap-2 rounded-[3px] border px-4 font-mono text-[10px] uppercase tracking-[0.12em] transition-all duration-150 ${active ? 'border-[var(--green-mid)] bg-[var(--green-dim)] text-[var(--green-glow)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-ghost)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-muted)]'}`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
