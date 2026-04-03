'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bot, ChevronRight, Compass, Loader2, Sparkles, X } from 'lucide-react';
import { ConsoleCard, TerminalButton, TerminalInput } from '@/components/ui/terminal';
import {
    getAssistantOnboardingProgress,
    resolveAssistantRouteContext,
} from '@/lib/assistant/routeContext';
import type {
    AssistantAction,
    AssistantConversationMessage,
    AssistantReply,
} from '@/lib/assistant/types';

const STORAGE_KEY = 'vetios.guide.visited-paths';

interface GuideMessage {
    id: string;
    role: 'assistant' | 'user';
    content: string;
    nextSteps?: string[];
    actions?: AssistantAction[];
    mode?: AssistantReply['mode'];
}

export default function VetiosGuide() {
    const pathname = usePathname() ?? '/dashboard';
    const router = useRouter();
    const routeContext = resolveAssistantRouteContext(pathname);
    const [isOpen, setIsOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<GuideMessage[]>([]);
    const [visitedPaths, setVisitedPaths] = useState<string[]>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = safeParseVisitedPaths(raw);
        const nextVisitedPaths = dedupePaths([...parsed, pathname]).slice(-24);

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextVisitedPaths));
        setVisitedPaths(nextVisitedPaths);
    }, [pathname]);

    useEffect(() => {
        if (!scrollRef.current) {
            return;
        }

        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, loading, isOpen]);

    const onboarding = getAssistantOnboardingProgress(visitedPaths);
    const progressPercent = onboarding.totalCount > 0
        ? Math.round((onboarding.visitedCount / onboarding.totalCount) * 100)
        : 0;
    const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant') ?? null;
    const activeMode = latestAssistantMessage?.mode ?? 'fallback';
    const welcomeMessage = buildWelcomeMessage(routeContext, onboarding);

    async function handleSubmit(promptOverride?: string) {
        const message = (promptOverride ?? draft).trim();
        if (!message || loading) {
            return;
        }

        const userMessage: GuideMessage = {
            id: makeMessageId('user'),
            role: 'user',
            content: message,
        };
        const conversation: AssistantConversationMessage[] = [
            ...messages.slice(-6).map((entry) => ({
                role: entry.role,
                content: entry.content,
            })),
            {
                role: 'user',
                content: message,
            },
        ];

        setDraft('');
        setErrorMessage(null);
        setMessages((current) => [...current, userMessage]);
        setLoading(true);

        try {
            const response = await fetch('/api/assistant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify({
                    message,
                    pathname,
                    visited_paths: visitedPaths,
                    conversation,
                }),
            });

            const result = await response.json() as (AssistantReply & {
                error?: string;
                request_id?: string;
            });

            if (!response.ok) {
                if (response.status === 401) {
                    router.push(`/login?next=${encodeURIComponent(pathname)}`);
                    return;
                }

                throw new Error(result.error ?? 'Unable to reach VetIOS Guide.');
            }

            setMessages((current) => [
                ...current,
                {
                    id: makeMessageId('assistant'),
                    role: 'assistant',
                    content: result.answer,
                    nextSteps: result.next_steps,
                    actions: result.suggested_actions,
                    mode: result.mode,
                },
            ]);
        } catch (error) {
            const nextError = error instanceof Error ? error.message : 'Unable to reach VetIOS Guide.';
            setErrorMessage(nextError);
            setMessages((current) => [
                ...current,
                {
                    id: makeMessageId('assistant'),
                    role: 'assistant',
                    content: 'I could not complete that request cleanly, but I can still help you with route guidance and starter prompts from this page.',
                    nextSteps: routeContext.recommended_steps.slice(0, 3),
                    actions: routeContext.suggested_actions.slice(0, 3),
                    mode: 'fallback',
                },
            ]);
        } finally {
            setLoading(false);
        }
    }

    function handleAction(action: AssistantAction) {
        if (action.type === 'navigate' && action.href) {
            setIsOpen(false);
            router.push(action.href);
            return;
        }

        if (action.type === 'prompt' && action.prompt) {
            void handleSubmit(action.prompt);
        }
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 rounded-md border border-grid px-3 py-2 text-xs font-mono uppercase tracking-[0.18em] text-muted transition-colors hover:border-accent/40 hover:text-accent"
                aria-label="Open VetIOS Guide"
                title="Open VetIOS Guide"
            >
                <Bot className="h-4 w-4" />
                <span className="hidden sm:inline">Guide</span>
                <span className="hidden md:inline text-[10px] text-accent">{onboarding.visitedCount}/{onboarding.totalCount}</span>
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
                        onClick={() => setIsOpen(false)}
                        aria-hidden="true"
                    />
                    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-grid bg-background shadow-2xl">
                        <div className="flex items-center justify-between border-b border-grid px-4 py-4">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-accent/30 bg-accent/10 text-accent">
                                        <Sparkles className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <div className="font-mono text-xs uppercase tracking-[0.24em] text-accent">VetIOS Guide</div>
                                        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                                            <span>{routeContext.title}</span>
                                            <span className={`border px-2 py-0.5 ${activeMode === 'ai'
                                                ? 'border-accent/30 text-accent'
                                                : 'border-grid text-muted'
                                                }`}>
                                                {activeMode === 'ai' ? 'AI mode' : 'Guide mode'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="rounded-sm border border-grid p-2 text-muted transition-colors hover:border-accent/40 hover:text-accent"
                                aria-label="Close VetIOS Guide"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 py-4">
                            <div className="space-y-4">
                                <ConsoleCard title="Current Route" className="p-4">
                                    <p className="font-mono text-xs leading-relaxed text-foreground">{routeContext.summary}</p>
                                    <div className="mt-3 text-[10px] font-mono uppercase tracking-[0.18em] text-muted">
                                        Primary goal: <span className="text-accent">{routeContext.primary_goal}</span>
                                    </div>
                                    <div className="mt-3 border border-grid bg-dim/60 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                                        {activeMode === 'ai'
                                            ? 'Live AI assistance is active for this session.'
                                            : 'Route-aware guide mode is active, so responses stay useful even without the model layer.'}
                                    </div>
                                </ConsoleCard>

                                <ConsoleCard title="Onboarding Progress" className="p-4">
                                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                                        <span>Core modules explored</span>
                                        <span className="text-accent">{onboarding.visitedCount}/{onboarding.totalCount}</span>
                                    </div>
                                    <div className="mt-3 h-1.5 w-full bg-dim">
                                        <div className="h-full bg-accent transition-all" style={{ width: `${progressPercent}%` }} />
                                    </div>
                                    <div className="mt-3 flex items-start gap-2 font-mono text-xs text-muted">
                                        <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                                        <span>
                                            {onboarding.nextRoute
                                                ? `Next recommended module: ${onboarding.nextRoute.title}`
                                                : 'You have touched every core module in the first-pass onboarding path.'}
                                        </span>
                                    </div>
                                </ConsoleCard>

                                <ConsoleCard title="Quick Prompts" className="p-4">
                                    <div className="grid grid-cols-1 gap-2">
                                        {routeContext.starter_prompts.map((prompt) => (
                                            <button
                                                key={prompt}
                                                type="button"
                                                onClick={() => void handleSubmit(prompt)}
                                                className="flex items-center justify-between gap-3 border border-grid bg-dim/60 px-3 py-3 text-left font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-accent/30 hover:text-foreground"
                                            >
                                                <span>{prompt}</span>
                                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-accent" />
                                            </button>
                                        ))}
                                    </div>
                                </ConsoleCard>

                                <ConsoleCard title="Conversation" className="p-4">
                                    <div ref={scrollRef} className="max-h-[32vh] space-y-3 overflow-y-auto pr-1">
                                        {messages.length === 0 && !loading && (
                                            <div className="border border-accent/20 bg-accent/5 px-3 py-3">
                                                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                                                    VetIOS Guide
                                                </div>
                                                <div className="font-mono text-xs leading-relaxed text-foreground">
                                                    {welcomeMessage.content}
                                                </div>
                                                <div className="mt-3 space-y-2">
                                                    {welcomeMessage.nextSteps.map((step) => (
                                                        <div key={step} className="flex items-start gap-2 font-mono text-[11px] text-muted">
                                                            <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-accent" />
                                                            <span>{step}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {welcomeMessage.actions.map((action) => (
                                                        <button
                                                            key={`welcome-${action.label}`}
                                                            type="button"
                                                            onClick={() => handleAction(action)}
                                                            className="border border-grid px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted transition-colors hover:border-accent/30 hover:text-accent"
                                                        >
                                                            {action.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {messages.map((message) => (
                                            <div
                                                key={message.id}
                                                className={`border px-3 py-3 ${message.role === 'assistant'
                                                    ? 'border-accent/20 bg-accent/5'
                                                    : 'border-grid bg-dim/70'
                                                    }`}
                                            >
                                                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                                                    {message.role === 'assistant' ? `VetIOS Guide${message.mode === 'fallback' ? ' fallback' : ''}` : 'You'}
                                                </div>
                                                <div className="font-mono text-xs leading-relaxed text-foreground">
                                                    {message.content}
                                                </div>

                                                {message.nextSteps && message.nextSteps.length > 0 && (
                                                    <div className="mt-3 space-y-2">
                                                        {message.nextSteps.map((step) => (
                                                            <div key={step} className="flex items-start gap-2 font-mono text-[11px] text-muted">
                                                                <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-accent" />
                                                                <span>{step}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {message.actions && message.actions.length > 0 && (
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        {message.actions.map((action) => (
                                                            <button
                                                                key={`${message.id}-${action.label}`}
                                                                type="button"
                                                                onClick={() => handleAction(action)}
                                                                className="border border-grid px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted transition-colors hover:border-accent/30 hover:text-accent"
                                                            >
                                                                {action.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}

                                        {loading && (
                                            <div className="flex items-center gap-2 border border-grid bg-dim/70 px-3 py-3 font-mono text-xs text-muted">
                                                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                                                VetIOS Guide is preparing the next action path...
                                            </div>
                                        )}
                                    </div>
                                </ConsoleCard>
                            </div>
                        </div>

                        <div className="border-t border-grid px-4 py-4">
                            {errorMessage && (
                                <div className="mb-3 border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-danger">
                                    {errorMessage}
                                </div>
                            )}

                            <form
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    void handleSubmit();
                                }}
                                className="space-y-3"
                            >
                                <TerminalInput
                                    value={draft}
                                    onChange={(event) => setDraft(event.target.value)}
                                    placeholder={`Ask about ${routeContext.title.toLowerCase()}...`}
                                    disabled={loading}
                                />
                                <div className="flex items-center justify-between gap-3">
                                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                                        Workflow guidance only. Verify critical clinical decisions independently.
                                    </div>
                                    <TerminalButton type="submit" disabled={loading || draft.trim().length === 0}>
                                        Ask Guide
                                    </TerminalButton>
                                </div>
                            </form>
                        </div>
                    </aside>
                </>
            )}
        </>
    );
}

function buildWelcomeMessage(
    routeContext: ReturnType<typeof resolveAssistantRouteContext>,
    onboarding: ReturnType<typeof getAssistantOnboardingProgress>,
): {
    content: string;
    nextSteps: string[];
    actions: AssistantAction[];
} {
    const content = onboarding.nextRoute && onboarding.nextRoute.href !== routeContext.href
        ? `You are on ${routeContext.title}. I can explain this page, map the next best action, or move you into ${onboarding.nextRoute.title} if you want to continue the guided onboarding path.`
        : `You are on ${routeContext.title}. I can explain what this page does, help you complete a first workflow, or point you to the right workspace for the job you want to do.`;

    const nextSteps = routeContext.recommended_steps.slice(0, 3);
    const actions = [
        ...routeContext.suggested_actions,
        ...(onboarding.nextRoute && onboarding.nextRoute.href !== routeContext.href
            ? [{
                type: 'navigate' as const,
                label: `Next: ${onboarding.nextRoute.title}`,
                description: 'Continue the onboarding path.',
                href: onboarding.nextRoute.href,
            }]
            : []),
    ].slice(0, 3);

    return {
        content,
        nextSteps,
        actions,
    };
}

function safeParseVisitedPaths(raw: string | null): string[] {
    if (!raw) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter((value): value is string => typeof value === 'string' && value.startsWith('/'));
    } catch {
        return [];
    }
}

function dedupePaths(paths: string[]): string[] {
    return [...new Set(paths)];
}

function makeMessageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
