import React from 'react';

export function TerminalLabel({ children, htmlFor }: { children: React.ReactNode, htmlFor?: string }) {
    return (
        <label htmlFor={htmlFor} className="block font-mono text-xs uppercase tracking-widest text-muted mb-2">
            {children}
        </label>
    );
}

export function TerminalInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className="w-full bg-dim border-grid p-3 font-mono text-sm text-foreground focus:outline-none focus:border-accent transition-colors"
            {...props}
        />
    );
}

export function TerminalTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            className="w-full bg-dim border-grid p-3 font-mono text-sm text-foreground focus:outline-none focus:border-accent transition-colors min-h-[120px] resize-y"
            {...props}
        />
    );
}

export function TerminalButton({
    children,
    variant = 'primary',
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
    const baseClasses = "font-mono text-sm uppercase tracking-widest px-6 py-3 transition-colors border";

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

export function Container({ children, className = '' }: { children: React.ReactNode, className?: string }) {
    return (
        <div className={`max-w-4xl mx-auto p-8 ${className}`}>
            {children}
        </div>
    );
}

export function PageHeader({ title, description }: { title: string, description?: string }) {
    return (
        <div className="mb-12 border-b border-grid pb-6">
            <h1 className="font-mono text-2xl mb-2">{title}</h1>
            {description && <p className="font-mono text-muted text-sm">{description}</p>}
        </div>
    );
}

export function DataRow({ label, value }: { label: string, value: React.ReactNode }) {
    return (
        <div className="flex justify-between py-2 border-b border-muted/30">
            <span className="font-mono text-xs text-muted uppercase">{label}</span>
            <span className="font-mono text-sm">{value}</span>
        </div>
    );
}

export function ConsoleCard({
    title,
    children,
    className = '',
    onClick
}: {
    title?: string,
    children: React.ReactNode,
    className?: string,
    onClick?: () => void
}) {
    return (
        <div 
            onClick={onClick}
            className={`border border-grid bg-background p-6 flex flex-col gap-4 ${className}`}
        >
            {title && (
                <div className="font-mono text-xs text-muted uppercase tracking-widest border-b border-grid pb-4 mb-2 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-accent" />
                    {title}
                </div>
            )}
            {children}
        </div>
    );
}
