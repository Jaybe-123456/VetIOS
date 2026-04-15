'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';

export function TerminalLabel({ children, htmlFor }: { children: React.ReactNode, htmlFor?: string }) {
    return (
        <label htmlFor={htmlFor} className="mb-2 block border-l-2 border-primary pl-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            {children}
        </label>
    );
}

export function TerminalInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={`h-9 w-full rounded-md border border-input bg-secondary px-3 font-mono text-[12px] text-foreground placeholder:text-muted-foreground transition-all duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
            {...props}
        />
    );
}

export function TerminalTextarea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            className={`min-h-[120px] w-full resize-y rounded-md border border-input bg-secondary p-3 font-mono text-[12px] text-foreground placeholder:text-muted-foreground transition-all duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${className}`}
            {...props}
        />
    );
}

export function TerminalButton({ children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
    const variants = {
        primary: 'border-primary bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground',
        secondary: 'border-border bg-transparent text-secondary-foreground hover:border-primary hover:text-foreground',
        danger: 'border-destructive bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground',
    };

    return (
        <button
            className={`relative inline-flex items-center justify-center gap-2 rounded-md border px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
            {...props}
        >
            {children}
        </button>
    );
}

export function Container({ children, className = '' }: { children: React.ReactNode, className?: string }) {
    return <div className={`mx-auto w-full max-w-[1700px] px-4 py-5 sm:px-6 ${className}`}>{children}</div>;
}

export function PageHeader({ title, description }: { title: string, description?: string }) {
    return (
        <div className="mb-5 flex flex-col gap-2 border-b border-border pb-4">
            <h1 className="font-mono text-[18px] font-semibold uppercase tracking-[0.14em] text-foreground">{title}</h1>
            {description ? <p className="font-sans text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
    );
}

export function DataRow({ label, value }: { label: string, value: React.ReactNode }) {
    return (
        <div className="flex min-w-0 items-start justify-between gap-4 border-b border-border py-2">
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
            <span className="min-w-0 flex-1 break-all text-right font-mono text-[11px] text-secondary-foreground">{value}</span>
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
                <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-secondary-foreground">
                        <span className="h-1 w-1 bg-primary" />
                        ■ {title}
                    </div>
                    {(collapsible || maximized) ? (
                        <div className="flex items-center gap-1">
                            {collapsible ? (
                                <button onClick={(e) => { e.stopPropagation(); setCollapsed((p) => !p); }} className="p-1 text-muted-foreground hover:text-foreground">
                                    {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                                </button>
                            ) : null}
                            <button onClick={(e) => { e.stopPropagation(); setMaximized((p) => !p); }} className="hidden p-1 text-muted-foreground hover:text-foreground sm:block">
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
                        className={`inline-flex h-[34px] items-center gap-2 rounded-md border px-4 font-mono text-[10px] uppercase tracking-[0.12em] transition-all duration-150 ${active ? 'border-primary bg-primary/10 text-primary shadow-glow' : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
