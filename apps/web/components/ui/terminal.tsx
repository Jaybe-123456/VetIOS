'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';

/* ── TerminalLabel ─────────────────────────────────────────────────────────── */

export function TerminalLabel({ children, htmlFor }: { children: React.ReactNode, htmlFor?: string }) {
    return (
        <label htmlFor={htmlFor} className="block font-mono text-xs uppercase tracking-widest text-muted mb-2">
            {children}
        </label>
    );
}

/* ── TerminalInput ─────────────────────────────────────────────────────────── */

export function TerminalInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={`w-full bg-dim border-grid p-3 sm:p-3 font-mono text-sm text-foreground focus:outline-none focus:border-accent transition-colors ${className}`}
            {...props}
        />
    );
}

/* ── TerminalTextarea ──────────────────────────────────────────────────────── */

export function TerminalTextarea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            className={`w-full bg-dim border-grid p-3 font-mono text-sm text-foreground focus:outline-none focus:border-accent transition-colors min-h-[100px] sm:min-h-[120px] resize-y ${className}`}
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
    const baseClasses = "font-mono text-sm uppercase tracking-widest px-4 sm:px-6 py-3 transition-colors border";

    const variants = {
        primary: "border-accent text-accent hover:bg-accent hover:text-black",
        secondary: "border-muted text-muted hover:border-foreground hover:text-foreground focus:bg-[#222]",
        danger: "border-danger text-danger hover:bg-danger hover:text-white"
    };

    return (
        <button
            className={`${baseClasses} ${variants[variant]} disabled:opacity-50 disabled:cursor-not-allowed`}
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
        <div className="mb-6 sm:mb-8 lg:mb-12 border-b border-grid pb-4 sm:pb-6">
            <h1 className="font-mono text-xl sm:text-2xl mb-1 sm:mb-2">{title}</h1>
            {description && <p className="font-mono text-muted text-xs sm:text-sm leading-relaxed">{description}</p>}
        </div>
    );
}

/* ── DataRow ───────────────────────────────────────────────────────────────── */

export function DataRow({ label, value }: { label: string, value: React.ReactNode }) {
    return (
        <div className="flex justify-between items-start gap-4 py-2 border-b border-muted/30 min-w-0">
            <span className="font-mono text-[10px] sm:text-xs text-muted uppercase shrink-0 mt-0.5">{label}</span>
            <span className="font-mono text-xs sm:text-sm text-right break-all sm:break-words min-w-0 flex-1">{value}</span>
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
            className={`border border-grid bg-background p-4 sm:p-6 flex flex-col gap-3 sm:gap-4 animate-scale-in
                ${maximized ? 'fixed inset-4 z-50 overflow-auto' : ''}
                ${className}`}
        >
            {title && (
                <div className="font-mono text-[10px] sm:text-xs text-muted uppercase tracking-widest border-b border-grid pb-3 sm:pb-4 mb-1 sm:mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-accent" />
                        {title}
                    </div>
                    {(collapsible || maximized) && (
                        <div className="flex items-center gap-1">
                            {collapsible && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
                                    className="p-1 text-muted hover:text-accent transition-colors"
                                    aria-label={collapsed ? 'Expand' : 'Collapse'}
                                >
                                    {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                                </button>
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); setMaximized(!maximized); }}
                                className="p-1 text-muted hover:text-accent transition-colors hidden sm:block"
                                aria-label={maximized ? 'Minimize' : 'Maximize'}
                            >
                                {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                            </button>
                        </div>
                    )}
                </div>
            )}
            {!collapsed && children}
        </div>
    );

    // When maximized, render a backdrop
    if (maximized) {
        return (
            <>
                <div
                    className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40"
                    onClick={() => setMaximized(false)}
                />
                {cardContent}
            </>
        );
    }

    return cardContent;
}

/* ── TerminalTabs ─────────────────────────────────────────────────────────── */

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
        <div className={`flex flex-wrap gap-2 mb-6 sm:mb-8 ${className}`}>
            {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onTabChange(tab.id)}
                        className={`
                            px-4 py-2 sm:px-6 sm:py-3 border font-mono text-[10px] sm:text-xs uppercase tracking-[0.2em] transition-all flex items-center gap-2
                            ${isActive
                                ? 'border-accent text-accent bg-accent/10 shadow-[0_0_10px_rgba(0,255,157,0.1)]'
                                : 'border-grid text-muted hover:border-muted hover:text-foreground bg-dim/50'
                            }
                        `}
                    >
                        {tab.icon && <span className={isActive ? 'text-accent' : 'text-muted'}>{tab.icon}</span>}
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
