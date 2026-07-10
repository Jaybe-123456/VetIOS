'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, Copy } from 'lucide-react';
import type { LandingCodeLanguage } from './data';
import { joinClasses } from './utils';

export function Panel(props: { className?: string; children: ReactNode }) {
    return <div className={joinClasses('landing-panel', props.className)}>{props.children}</div>;
}

export function SectionHeader(props: {
    eyebrow: string;
    title: string;
    description: string;
}) {
    return (
        <div className="max-w-3xl">
            <div className="landing-eyebrow">{props.eyebrow}</div>
            <h2 className="mt-5 text-[2.35rem] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:mt-6 sm:text-4xl md:text-5xl">
                {props.title}
            </h2>
            <p className="mt-4 text-base leading-7 text-white/62 sm:mt-5 sm:text-lg sm:leading-8">{props.description}</p>
        </div>
    );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
    return (
        <div
            className={joinClasses(
                'relative grid place-items-center rounded-2xl border border-white/10 bg-white/[0.04]',
                compact ? 'h-10 w-10' : 'h-11 w-11',
            )}
        >
            <div className="absolute inset-[18%] rounded-xl border border-[#38DCC6]/18" />
            <span className="absolute left-[26%] top-[28%] h-1.5 w-1.5 rounded-full bg-[#38DCC6]" />
            <span className="absolute right-[26%] top-[28%] h-1.5 w-1.5 rounded-full bg-[#7CFF4E]" />
            <span className="absolute left-[26%] bottom-[28%] h-1.5 w-1.5 rounded-full bg-[#7CFF4E]" />
            <span className="absolute right-[26%] bottom-[28%] h-1.5 w-1.5 rounded-full bg-[#38DCC6]" />
            <div className="absolute h-px w-[46%] bg-gradient-to-r from-[#38DCC6] to-[#7CFF4E]" />
            <div className="absolute h-[46%] w-px bg-gradient-to-b from-[#38DCC6] to-[#7CFF4E]" />
        </div>
    );
}

export function Reveal({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.12 },
        );

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            className={joinClasses(
                'transition-all duration-700 ease-out',
                isVisible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
                className,
            )}
        >
            {children}
        </div>
    );
}

export function EndpointCard(props: {
    method: string;
    path: string;
    payload: string;
    response: string;
    languageSnippets?: Record<LandingCodeLanguage, string>;
}) {
    const [activeLanguage, setActiveLanguage] = useState<LandingCodeLanguage>('curl');
    const [copied, setCopied] = useState<'request' | 'response' | 'snippet' | null>(null);
    const snippet = props.languageSnippets?.[activeLanguage] ?? props.payload;

    async function copyText(kind: 'request' | 'response' | 'snippet', value: string) {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(kind);
            window.setTimeout(() => setCopied(null), 1600);
        } catch {
            setCopied(null);
        }
    }

    return (
        <div className="glass-card rounded-[24px] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-[#38DCC6]/24 sm:rounded-[28px] sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-[#38DCC6]/24 bg-[#38DCC6]/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-[#B9FFF0] sm:text-[11px] sm:tracking-[0.18em]">
                    <span>{props.method}</span>
                    <span className="break-all">{props.path}</span>
                </div>
                <span className="text-[10px] uppercase tracking-[0.24em] text-white/34">typed route</span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
                {(['curl', 'js', 'python'] as const).map((language) => (
                    <button
                        key={language}
                        type="button"
                        onClick={() => setActiveLanguage(language)}
                        className={joinClasses(
                            'min-h-[44px] rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] transition-all sm:min-h-0',
                            activeLanguage === language
                                ? 'border-[#7CFF4E]/35 bg-[#7CFF4E]/12 text-[#D8FFC9]'
                                : 'border-white/10 bg-white/[0.03] text-white/48 hover:border-white/18 hover:text-white/72',
                        )}
                    >
                        {language}
                    </button>
                ))}
            </div>

            <CodeBlock
                label={`// ${activeLanguage} integration`}
                tone="cyan"
                value={snippet}
                copied={copied === 'snippet'}
                onCopy={() => copyText('snippet', snippet)}
                className="mt-4"
            />

            <CodeBlock
                label="// request"
                tone="cyan"
                value={props.payload}
                copied={copied === 'request'}
                onCopy={() => copyText('request', props.payload)}
                className="mt-4"
            />

            <CodeBlock
                label="// response"
                tone="green"
                value={props.response}
                copied={copied === 'response'}
                onCopy={() => copyText('response', props.response)}
                className="mt-4"
            />
        </div>
    );
}

function CodeBlock(props: {
    label: string;
    tone: 'cyan' | 'green';
    value: string;
    copied: boolean;
    onCopy: () => void;
    className?: string;
}) {
    return (
        <div className={joinClasses(
            'overflow-hidden rounded-[20px] border border-white/8 bg-[#090D12] font-mono text-[10px] leading-6 text-[#9FB0C0] sm:rounded-[22px] sm:text-[11px]',
            props.className,
        )}>
            <div className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-3">
                <div className={props.tone === 'green' ? 'text-[#7CFF4E]' : 'text-[#38DCC6]'}>
                    {props.label}
                </div>
                <button
                    type="button"
                    onClick={props.onCopy}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 text-[10px] uppercase tracking-[0.12em] text-white/52 transition-colors hover:border-[#38DCC6]/24 hover:text-white sm:h-8 sm:min-h-0"
                >
                    {props.copied ? <Check className="h-3.5 w-3.5 text-[#7CFF4E]" /> : <Copy className="h-3.5 w-3.5" />}
                    {props.copied ? 'copied' : 'copy'}
                </button>
            </div>
            <div className="overflow-x-auto p-4">
                <pre className={joinClasses(
                    'whitespace-pre-wrap',
                    props.tone === 'green' && 'text-[#A9F7D7]',
                )}>{props.value}</pre>
            </div>
        </div>
    );
}

export function FooterLink(props: { href: string; label: string }) {
    return (
        <Link href={props.href} className="transition-colors hover:text-white">
            {props.label}
        </Link>
    );
}
