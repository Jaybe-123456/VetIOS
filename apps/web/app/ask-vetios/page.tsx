'use client';

import { useCallback, useEffect } from 'react';
import { useChatStore } from '@/store/useChatStore';
import UsernamePrompt from '@/components/ask-vetios/UsernamePrompt';
import ChatContainer from '@/components/ask-vetios/ChatContainer';
import ChatInput from '@/components/ask-vetios/ChatInput';
import { DashboardMetrics, AnalyticsChart } from '@/components/ask-vetios/DashboardMetrics';
import { RecentCases } from '@/components/ask-vetios/RecentCases';
import {
    Plus, History, Share2, Download, Trash2, MessageSquare, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export default function AskVetIOSPage() {
    const {
    createChat, activeChatId, addMessage, setLoading, isLoading,
    switchChat, chats, deleteChat, username   // ← add username here
} = useChatStore();

    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Auto-create first chat
    useEffect(() => {
        if (chats.length === 0) {
            createChat();
        } else if (!activeChatId) {
            switchChat(chats[0].id);
        }
    }, [chats, activeChatId, createChat, switchChat]);

    const sendMessage = useCallback(async (content: string) => {
        if (!activeChatId || !content.trim()) return;

        // Capture history before adding new message
        const activeChat = chats.find(c => c.id === activeChatId);
        const history = (activeChat?.messages ?? [])
            .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0 && m.content.trim().length <= 4000)
            .slice(-16)
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        addMessage(activeChatId, { role: 'user', content });
        setLoading(true);

        try {
            const response = await fetch('/api/ask-vetios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: content, conversation: history }),
            });

            const data = await response.json() as {
                mode?: string; content?: string; topic?: string; metadata?: unknown; error?: string;
            };

            if (data.error) throw new Error(data.error);

            addMessage(activeChatId, {
                role: 'assistant',
                content: data.content ?? '',
                metadata: {
                    mode: (data.mode as 'educational' | 'clinical' | 'general') ?? 'general',
                    topic: data.topic,
                    ...(data.metadata as object ?? {}),
                },
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Intelligence gateway error. Please check that the AI provider key is configured and the gateway is operational.';
            addMessage(activeChatId, {
                role: 'assistant',
                content: msg,
                metadata: { mode: 'general' },
            });
        } finally {
            setLoading(false);
        }
    }, [activeChatId, chats, addMessage, setLoading]);

    const handleFollowUp = useCallback((prompt: string) => {
        void sendMessage(prompt);
    }, [sendMessage]);

    const activeChat = chats.find(c => c.id === activeChatId);


const [shareFeedback, setShareFeedback] = useState('');

const handleDownload = useCallback(() => {
    if (!activeChat?.messages.length) return;
    const date = new Date().toISOString().slice(0, 10);
    const lines = [
        `# VetIOS Session — ${username}`,
        `Date: ${date}`, `Session: ${activeChat.title}`, ``,
        ...activeChat.messages.map(m => [
            `### ${m.role === 'user' ? username : 'VETIOS_AI'} — ${new Date(m.timestamp).toLocaleTimeString()}`,
            ``, m.content, ``, `---`, ``
        ].join('\n')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vetios-${date}.md`; a.click();
    URL.revokeObjectURL(url);
}, [activeChat, username]);

const handleShare = useCallback(async () => {
    if (!activeChat?.messages.length) return;
    const text = activeChat.messages.slice(0, 6)
        .map(m => `${m.role === 'user' ? username : 'VETIOS_AI'}:\n${m.content.slice(0, 200)}`)
        .join('\n\n');
    if (navigator.share) {
        await navigator.share({ title: `VetIOS — ${username}`, text }).catch(() => {});
    } else {
        await navigator.clipboard.writeText(text);
        setShareFeedback('COPIED');
        setTimeout(() => setShareFeedback(''), 2000);
    }
}, [activeChat, username]);

if (!username) return <UsernamePrompt />;

return (
    
        <div className="flex h-full bg-[#050505] text-white overflow-hidden">

            {/* ── Chat history sidebar ─────────────────────────────────── */}
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 240, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="shrink-0 border-r border-white/5 bg-[#0a0a0a] flex flex-col overflow-hidden"
                    >
                        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between shrink-0">
                            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">Sessions</span>
                            <button
                                onClick={() => { createChat(); setSidebarOpen(false); }}
                                className="flex items-center gap-1 px-2 py-1 bg-accent/10 border border-accent/20 text-accent font-mono text-[9px] uppercase tracking-widest hover:bg-accent/20 transition-all"
                            >
                                <Plus className="w-2.5 h-2.5" /> New
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto py-2">
                            {chats.length === 0 ? (
                                <p className="px-4 py-3 font-mono text-[10px] text-white/20">No sessions yet</p>
                            ) : chats.map((chat) => (
                                <div
                                    key={chat.id}
                                    className={cn(
                                        'group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-all border-l-2',
                                        chat.id === activeChatId
                                            ? 'border-accent bg-accent/5 text-white'
                                            : 'border-transparent hover:bg-white/[0.03] text-white/50 hover:text-white/80',
                                    )}
                                    onClick={() => { switchChat(chat.id); setSidebarOpen(false); }}
                                >
                                    <MessageSquare className="w-3 h-3 mt-0.5 shrink-0 text-accent/60" />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-mono text-[10px] uppercase tracking-tight truncate leading-tight">
                                            {chat.title}
                                        </p>
                                        <div className="flex items-center gap-1 mt-0.5">
                                            <Clock className="w-2.5 h-2.5 text-white/20" />
                                            <span className="font-mono text-[9px] text-white/20">
                                                {new Date(chat.createdAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                                        className="opacity-0 group-hover:opacity-100 p-0.5 text-white/20 hover:text-red-400 transition-all shrink-0"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            {/* ── Main column ─────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

                {/* Page header */}
                <header className="px-5 py-4 flex items-center justify-between gap-4 border-b border-white/5 shrink-0">
                    <div className="flex items-center gap-4 min-w-0">
                        <button
                            onClick={() => setSidebarOpen(v => !v)}
                            className={cn(
                                'p-2 border transition-all shrink-0',
                                sidebarOpen
                                    ? 'border-accent/40 bg-accent/10 text-accent'
                                    : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white',
                            )}
                        >
                            <History className="w-4 h-4" />
                        </button>

                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="font-mono text-lg font-bold tracking-tighter uppercase">
                                    Ask VetIOS
                                </h1>
                                <span className="text-accent animate-pulse text-lg">●</span>
                                <div className="px-2 py-0.5 bg-accent/10 border border-accent/20 text-accent font-mono text-[8px] tracking-widest uppercase">
                                    V1.0 Intelligence
                                </div>
                            </div>
                            {activeChat && (
                                <p className="font-mono text-[9px] text-white/30 uppercase tracking-widest truncate mt-0.5">
                                    {activeChat.title}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => createChat()}
                            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-black font-mono text-[10px] font-bold uppercase tracking-widest hover:bg-accent/90 transition-all shadow-[0_0_12px_rgba(0,255,102,0.2)]"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            New Chat
                        </button>
                        <button
    onClick={handleShare}
    title={shareFeedback || 'Share session'}
    className="p-2 border border-white/10 hover:border-white/20 transition-all text-white/40 hover:text-white relative"
>
    {shareFeedback
        ? <span className="font-mono text-[8px] text-accent uppercase tracking-widest px-1">{shareFeedback}</span>
        : <Share2 className="w-4 h-4" />}
</button>
<button
    onClick={handleDownload}
    title="Download session"
    className="p-2 border border-white/10 hover:border-white/20 transition-all text-white/40 hover:text-white"
>
    <Download className="w-4 h-4" />
</button>
                    </div>
                </header>

                {/* Chat workspace */}
                <div className="flex-1 flex flex-col overflow-hidden">

                    {/* Session status bar */}
                    <div className="px-4 py-2 border-b border-white/5 bg-white/[0.01] flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <History className="w-3 h-3 text-accent/60" />
                            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">
                                Active_Intelligence_Session
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-black border border-white/8">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                            <span className="font-mono text-[9px] text-accent/60 uppercase">Connected</span>
                        </div>
                    </div>

                    {/* Messages */}
                    <ChatContainer onFollowUp={handleFollowUp} />

                    {/* Input */}
                    <div className="shrink-0 border-t border-white/5 bg-[#080808]">
                        <ChatInput onSend={sendMessage} disabled={isLoading} />
                    </div>
                </div>
            </div>

            {/* ── Analytics drawer (scrollable, below the chat fold) ── */}
            {/* Rendered as a separate scrollable section accessible via scroll */}
            <style>{`
                @media (min-height: 900px) {
                    .analytics-section { display: block; }
                }
            `}</style>
        </div>
    );
}
