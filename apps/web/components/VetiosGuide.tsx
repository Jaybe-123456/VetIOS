'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bot, ChevronRight, Compass, Loader2, Sparkles, X, Activity, Cpu, Zap, MessageSquare, ExternalLink, Maximize2 } from 'lucide-react';
import { TerminalButton, TerminalInput } from '@/components/ui/terminal';
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

interface VetiosGuideProps {
    standalone?: boolean;
}

// ── Components ───────────────────────────────────────────────────────────────

function GlassTile({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={`group relative overflow-hidden border border-accent/10 bg-accent/[0.02] backdrop-blur-md transition-all hover:border-accent/30 ${className}`}>
            <div className="absolute top-0 right-0 p-1 opacity-20 transition-opacity group-hover:opacity-60">
                <div className="h-1 w-1 rounded-full bg-accent" />
            </div>
            <div className="border-b border-accent/10 bg-accent/[0.04] px-3 py-1.5 flex justify-between items-center">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-accent/70">{title}</span>
                <div className="flex gap-1">
                    <div className="h-[1px] w-2 bg-accent/20" />
                    <div className="h-[1px] w-1 bg-accent/40" />
                </div>
            </div>
            <div className="px-3 py-3">
                {children}
            </div>
        </div>
    );
}

function AIStatusIndicator({ active }: { active: boolean }) {
    return (
        <div className="flex items-center gap-2 px-2 py-0.5 border border-accent/20 bg-accent/5 rounded-sm">
            <div className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-accent animate-pulse shadow-[0_0_8px_rgba(0,255,157,0.8)]' : 'bg-muted'}`} />
            <span className={`font-mono text-[9px] uppercase tracking-widest ${active ? 'text-accent font-bold' : 'text-muted'}`}>
                {active ? 'SYNAPSE_ACTIVE' : 'IDLE'}
            </span>
        </div>
    );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function VetiosGuide({ standalone = false }: VetiosGuideProps) {
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
        if (typeof window === 'undefined') return;
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = safeParseVisitedPaths(raw);
        const nextVisitedPaths = dedupePaths([...parsed, pathname]).slice(-24);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextVisitedPaths));
        setVisitedPaths(nextVisitedPaths);
    }, [pathname]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, loading, isOpen, standalone]);

    const onboarding = getAssistantOnboardingProgress(visitedPaths);
    const progressPercent = onboarding.totalCount > 0
        ? Math.round((onboarding.visitedCount / onboarding.totalCount) * 100)
        : 0;
    const latestAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant') ?? null;
    const activeMode = latestAssistantMessage?.mode ?? 'fallback';
    const welcomeMessage = buildWelcomeMessage(routeContext, onboarding);

    async function handleSubmit(promptOverride?: string) {
        const message = (promptOverride ?? draft).trim();
        if (!message || loading) return;

        const userMessage: GuideMessage = {
            id: makeMessageId('user'),
            role: 'user',
            content: message,
        };
        const conversation: AssistantConversationMessage[] = [
            ...messages.slice(-6).map((e) => ({ role: e.role, content: e.content })),
            { role: 'user', content: message },
        ];

        setDraft('');
        setErrorMessage(null);
        setMessages((curr) => [...curr, userMessage]);
        setLoading(true);

        try {
            const response = await fetch('/api/assistant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ message, pathname, visited_paths: visitedPaths, conversation }),
            });

            const result = await response.json() as (AssistantReply & { error?: string });
            if (!response.ok) {
                if (response.status === 401) {
                    router.push(`/login?next=${encodeURIComponent(pathname)}`);
                    return;
                }
                throw new Error(result.error ?? 'Unable to reach VetIOS Guide.');
            }

            setMessages((curr) => [
                ...curr,
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
            setErrorMessage(error instanceof Error ? error.message : 'Unable to reach VetIOS Guide.');
            setMessages((curr) => [
                ...curr,
                {
                    id: makeMessageId('assistant'),
                    role: 'assistant',
                    content: 'I could not complete that request cleanly, but I can still help you with route guidance.',
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
            if (!standalone) setIsOpen(false);
            router.push(action.href);
            return;
        }
        if (action.type === 'prompt' && action.prompt) {
            void handleSubmit(action.prompt);
        }
    }

    const GuideContent = (
        <aside className={`${standalone
            ? 'h-[100dvh] w-full max-w-full flex-col border border-accent/10 bg-background/40 backdrop-blur-xl'
            : 'fixed inset-y-0 right-0 z-50 w-full sm:max-w-[420px] md:max-w-[480px] flex-col border-l border-accent/20 bg-background/95 backdrop-blur-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] animate-slide-in'
            } flex overflow-hidden`}>

            {standalone && (
                <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
            )}

            {/* ── Header ── */}
            <div className={`relative border-b border-accent/10 px-4 sm:px-6 ${standalone ? 'py-4 sm:py-6' : 'py-6'} overflow-hidden flex-none`}>
                <div className="absolute -top-4 -right-4 h-24 w-24 bg-accent/5 rounded-full blur-3xl opacity-40" />
                <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <div className="relative h-10 w-10 sm:h-12 sm:w-12 flex items-center justify-center border border-accent/30 bg-accent/10 rounded-sm overflow-hidden shadow-[0_0:15px_rgba(0,255,157,0.1)]">
                            <div className="absolute inset-0 bg-gradient-to-br from-accent/20 to-transparent" />
                            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-accent animate-in zoom-in duration-500" />
                        </div>
                        <div>
                            <div className="font-mono text-[10px] sm:text-xs uppercase tracking-[0.3em] text-accent font-bold flex items-center gap-2">
                                <span className="hidden xs:inline">VetIOS_</span>GUIDE_OS
                                {standalone && <span className="text-[8px] sm:text-[10px] bg-accent/20 px-1 py-0.5 rounded-sm">EXPANDED</span>}
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 mt-1 sm:mt-1.5">
                                <AIStatusIndicator active={activeMode === 'ai'} />
                                <span className="font-mono text-[8px] sm:text-[9px] text-muted tracking-widest uppercase truncate max-w-[100px] sm:max-w-[140px]">
                                    {routeContext.title}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2">
                        {!standalone && (
                            <button
                                type="button"
                                onClick={() => window.open('/guide', '_blank')}
                                title="Open in new tab"
                                className="p-1.5 sm:p-2 text-muted hover:text-accent transition-colors"
                            >
                                <ExternalLink className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </button>
                        )}
                        {!standalone && (
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 sm:p-2 text-muted hover:text-accent transition-colors"
                            >
                                <X className="h-4 w-4 sm:h-5 sm:w-5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Content ── */}
            <div className={`flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 scrollbar-thin min-h-0 ${standalone ? 'grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8' : 'flex flex-col'}`}>
                <div className={`${standalone ? 'lg:col-span-4' : ''} space-y-4 sm:space-y-6 flex-none`}>
                    <GlassTile title="Route_Context">
                        <p className="font-mono text-[10px] sm:text-xs leading-relaxed text-foreground/90">{routeContext.summary}</p>
                        <div className="mt-3 sm:mt-4 flex items-center gap-2 border-t border-accent/5 pt-2 sm:pt-3">
                            <Zap className="h-3 w-3 text-accent" />
                            <div className="font-mono text-[8px] sm:text-[9px] uppercase tracking-widest text-muted">
                                Goal: <span className="text-accent">{routeContext.primary_goal}</span>
                            </div>
                        </div>
                    </GlassTile>

                    <GlassTile title="Onboarding_Flow">
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-widest text-muted">Progress</span>
                            <span className="font-mono text-[9px] sm:text-[10px] text-accent font-bold tracking-widest">{progressPercent}%</span>
                        </div>
                        <div className="h-[2px] w-full bg-accent/10 overflow-hidden">
                            <div className="h-full bg-accent transition-all duration-1000" style={{ width: `${progressPercent}%` }} />
                        </div>
                        <div className="mt-3 sm:mt-4 flex gap-2 sm:gap-3 p-2 bg-accent/[0.03] border border-accent/5">
                            <Compass className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-accent shrink-0" />
                            <div className="font-mono text-[9px] sm:text-[10px] leading-relaxed text-muted uppercase tracking-wider">
                                {onboarding.nextRoute
                                    ? `Vector: ${onboarding.nextRoute.title}`
                                    : 'Initial Synchronization Complete.'}
                            </div>
                        </div>
                    </GlassTile>

                    <GlassTile title="Quick_Prompts" className={standalone ? 'hidden sm:block' : ''}>
                        <div className="grid grid-cols-1 gap-2">
                            {routeContext.starter_prompts.map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => void handleSubmit(p)}
                                    className="group w-full flex items-center justify-between border border-accent/5 bg-accent/[0.02] px-3 py-2 text-left transition-all hover:bg-accent/10 hover:border-accent/30"
                                >
                                    <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-muted group-hover:text-accent transition-colors truncate">{p}</span>
                                    <ChevronRight className="h-3 w-3 text-accent shrink-0 translate-x-0 group-hover:translate-x-1 transition-transform" />
                                </button>
                            ))}
                        </div>
                    </GlassTile>
                </div>

                <div className={`${standalone ? 'lg:col-span-8 flex flex-col h-full min-h-[400px] lg:min-h-0' : 'space-y-4 pt-4 min-h-0'}`}>
                    <div className="flex items-center justify-between mb-4 px-1 flex-none">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-accent/50" />
                            <span className="font-mono text-[8px] sm:text-[9px] uppercase tracking-[0.2em] text-muted">Log_Output</span>
                        </div>
                        {standalone && (
                            <div className="flex items-center gap-3 sm:gap-4">
                                <div className="h-1 w-16 sm:w-24 bg-accent/10 rounded-full overflow-hidden hidden xs:block">
                                    <div className="h-full bg-accent/40 animate-progress-flow" style={{ width: '40%' }} />
                                </div>
                                <span className="font-mono text-[7px] sm:text-[8px] text-muted uppercase">Kernel_Ready</span>
                            </div>
                        )}
                    </div>

                    <div ref={scrollRef} className={`${standalone ? 'flex-1 pr-1' : 'max-h-[40vh] sm:max-h-[45vh] pr-1'} space-y-4 overflow-y-auto scrollbar-thin scroll-smooth min-h-0 scroll-touch`}>
                        {messages.length === 0 && !loading && (
                            <div className="border border-accent/10 bg-accent/5 p-4 sm:p-5 rounded-sm animate-in fade-in slide-in-from-bottom-2 duration-700">
                                <div className="font-mono text-[11px] sm:text-xs leading-relaxed text-foreground/90 mb-4 sm:mb-5 whitespace-pre-wrap">
                                    {welcomeMessage.content}
                                </div>
                                <div className="space-y-2 sm:space-y-3 ml-1">
                                    {welcomeMessage.nextSteps.map((s) => (
                                        <div key={s} className="flex items-start gap-2 sm:gap-3 font-mono text-[9px] sm:text-[10px] text-muted uppercase tracking-widest">
                                            <div className="h-1 w-1 sm:h-1.5 sm:w-1.5 rounded-full bg-accent mt-1.5 shrink-0 shadow-[0_0_5px_rgba(0,255,157,0.5)]" />
                                            <span>{s}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-6 sm:mt-8 flex flex-wrap gap-2 sm:gap-3">
                                    {welcomeMessage.actions.map((a) => (
                                        <button
                                            key={`wel-${a.label}`}
                                            onClick={() => handleAction(a)}
                                            className="border border-accent/20 bg-accent/10 px-3 sm:px-4 py-1.5 sm:py-2 font-mono text-[8px] sm:text-[9px] uppercase tracking-widest text-accent hover:bg-accent/20 transition-all font-bold"
                                        >
                                            {a.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map((m) => (
                            <div
                                key={m.id}
                                className={`p-3 sm:p-4 border animate-in fade-in slide-in-from-bottom-1 duration-300 ${m.role === 'assistant'
                                    ? 'border-accent/10 bg-accent/5 border-l-2 border-l-accent'
                                    : 'border-white/5 bg-white/[0.02] border-r-2 border-r-white/20'
                                    }`}
                            >
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="font-mono text-[7px] sm:text-[8px] uppercase tracking-[0.2em] text-muted">
                                        {m.role === 'assistant' ? 'VetIOS_SYST' : 'USER_UPLINK'}
                                    </span>
                                    {m.role === 'assistant' && activeMode === 'ai' && <Activity className="h-2 w-2 sm:h-2.5 sm:w-2.5 text-accent animate-pulse" />}
                                </div>
                                <div className="font-mono text-[11px] sm:text-xs leading-relaxed text-foreground/90 break-words">
                                    {m.content}
                                </div>
                                {m.actions && m.actions.length > 0 && (
                                    <div className="mt-3 sm:mt-4 flex flex-wrap gap-2">
                                        {m.actions.map((a) => (
                                            <button
                                                key={`${m.id}-${a.label}`}
                                                onClick={() => handleAction(a)}
                                                className="border border-accent/30 bg-accent/10 px-2 sm:px-3 py-1 sm:py-1.5 font-mono text-[8px] sm:text-[9px] uppercase tracking-widest text-accent hover:bg-accent/20 transition-all"
                                            >
                                                {a.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        {loading && (
                            <div className="flex items-center gap-3 p-3 sm:p-4 border border-accent/10 bg-accent/5 font-mono text-[9px] sm:text-[10px] text-accent uppercase tracking-widest animate-pulse">
                                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                                Processing_Logic_Stream...
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Footer ── */}
            <div className={`border-t border-accent/10 p-4 sm:p-6 flex-none ${standalone ? 'bg-accent/[0.04]' : 'bg-accent/[0.02]'}`}>
                {errorMessage && (
                    <div className="mb-3 sm:mb-4 border border-danger/20 bg-danger/10 p-2 font-mono text-[8px] uppercase tracking-[0.1em] text-danger text-center">
                        {errorMessage}
                    </div>
                )}

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void handleSubmit();
                    }}
                    className="space-y-3 sm:space-y-4 max-w-4xl mx-auto w-full"
                >
                    <div className="relative group">
                        <div className="absolute inset-x-0 -top-[1px] h-[1px] bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
                        <TerminalInput
                            value={draft}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
                            placeholder={`QUERY_${routeContext.title.toUpperCase().replace(/\s+/g, '_')}...`}
                            disabled={loading}
                            className={`${standalone ? 'h-12 sm:h-14 text-sm' : 'h-10 sm:h-12 text-[11px] sm:text-xs'} bg-accent/5 border-accent/20 focus:border-accent/50 transition-all font-mono pl-3 sm:pl-4`}
                        />
                    </div>
                    <div className="flex flex-col xs:flex-row items-start xs:items-center justify-between gap-3 xs:gap-6">
                        <div className="flex items-start gap-2">
                            <Cpu className="h-3 w-3 text-muted mt-0.5 shrink-0" />
                            <span className="font-mono text-[7px] sm:text-[8px] uppercase leading-3 text-muted tracking-widest opacity-60">
                                Verify AI output independently. <span className="hidden sm:inline">Kernel_v1.0_PROD</span>
                            </span>
                        </div>
                        <button
                            type="submit"
                            disabled={loading || draft.trim().length === 0}
                            className={`${standalone ? 'h-10 sm:h-12 px-6 sm:px-10' : 'h-9 sm:h-10 px-4 sm:px-6'} w-full xs:w-auto font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.2em] border border-accent bg-accent text-background transition-all hover:bg-accent/90 disabled:opacity-30 disabled:grayscale`}
                        >
                            Execute_Query
                        </button>
                    </div>
                </form>
            </div>
        </aside>
    );

    if (standalone) {
        return (
            <div className="h-[100dvh] w-full bg-background p-2 sm:p-4 lg:p-8 flex flex-col overflow-hidden">
                <style jsx global>{`
                    @keyframes progress-flow {
                        0% { transform: translateX(-100%); }
                        100% { transform: translateX(300%); }
                    }
                    .animate-progress-flow {
                        animation: progress-flow 3s linear infinite;
                    }
                `}</style>
                <div className="fixed inset-0 pointer-events-none opacity-[0.03] overflow-hidden">
                    <div className="h-full w-full bg-[radial-gradient(circle_at_50%_50%,#00ff9d_1px,transparent_1px)] bg-[size:40px_40px]" />
                </div>
                {GuideContent}
            </div>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="group relative flex items-center gap-2 overflow-hidden rounded-sm border border-accent/20 bg-accent/5 px-3 py-2.5 sm:py-2 text-xs font-mono uppercase tracking-widest text-accent transition-all hover:bg-accent/10 hover:border-accent/40 min-h-[44px] sm:min-h-0 touch-manipulation"
            >
                <div className="absolute inset-x-0 bottom-0 h-[1px] w-full bg-accent/30 scale-x-0 transition-transform group-hover:scale-x-100" />
                <Bot className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Guide_OS</span>
                <div className="h-1 w-1 rounded-full bg-accent animate-pulse" />
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md animate-fade-in"
                        onClick={() => setIsOpen(false)}
                        aria-hidden="true"
                    />
                    {GuideContent}
                </>
            )}
        </>
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildWelcomeMessage(
    routeContext: ReturnType<typeof resolveAssistantRouteContext>,
    onboarding: ReturnType<typeof getAssistantOnboardingProgress>,
): {
    content: string;
    nextSteps: string[];
    actions: AssistantAction[];
} {
    const nextRoute = onboarding.nextRoute;
    const isContinuing = nextRoute && nextRoute.href !== routeContext.href;

    const content = isContinuing
        ? `CONNECTED: ${routeContext.title}. \nI can map the local feature set or pivot the guide vector toward ${nextRoute.title} to maintain your onboarding trajectory.`
        : `CONNECTED: ${routeContext.title}. \nI'm syncing with your workflow. I can explain the current module's architecture, assist with first-pass input, or guide you toward the next terminal hub.`;

    const nextSteps = routeContext.recommended_steps.slice(0, 3);
    const actions = [
        ...routeContext.suggested_actions,
        ...(isContinuing
            ? [{
                type: 'navigate' as const,
                label: `Pivot: ${nextRoute.title}`,
                description: 'Continue onboarding.',
                href: nextRoute.href,
            }]
            : []),
    ].slice(0, 3);

    return { content, nextSteps, actions };
}

function safeParseVisitedPaths(raw: string | null): string[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((v): v is string => typeof v === 'string' && v.startsWith('/'));
    } catch {
        return [];
    }
}

function dedupePaths(paths: string[]): string[] {
    return Array.from(new Set(paths));
}

function makeMessageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
