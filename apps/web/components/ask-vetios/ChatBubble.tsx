'use client';

import { Message } from '@/store/useChatStore';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useChatStore } from '@/store/useChatStore';
import { TerminalSquare, User, GraduationCap } from 'lucide-react';
import SmartActions from './SmartActions';

interface ChatBubbleProps {
    message: Message;
    onFollowUp: (prompt: string) => void;
}

// ── Minimal markdown renderer (no external dep needed) ─────────────────────
function MarkdownContent({ content }: { content: string }) {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let listBuffer: string[] = [];
    let listType: 'ul' | 'ol' | null = null;
    let key = 0;

    const flushList = () => {
        if (listBuffer.length === 0) return;
        if (listType === 'ul') {
            elements.push(
                <ul key={key++} className="space-y-1 pl-4 my-2">
                    {listBuffer.map((item, i) => (
                        <li key={i} className="font-mono text-sm text-white/75 leading-relaxed flex gap-2">
                            <span className="text-accent/60 mt-1 shrink-0">▸</span>
                            <span dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />
                        </li>
                    ))}
                </ul>
            );
        } else {
            elements.push(
                <ol key={key++} className="space-y-1 pl-4 my-2 list-none">
                    {listBuffer.map((item, i) => (
                        <li key={i} className="font-mono text-sm text-white/75 leading-relaxed flex gap-2">
                            <span className="text-accent/80 shrink-0 w-5">{i + 1}.</span>
                            <span dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />
                        </li>
                    ))}
                </ol>
            );
        }
        listBuffer = [];
        listType = null;
    };

    for (const raw of lines) {
        const line = raw.trimEnd();

        if (/^#{1}\s/.test(line)) {
            flushList();
            elements.push(<h1 key={key++} className="font-mono text-base font-bold text-white uppercase tracking-widest mt-5 mb-2 border-b border-accent/20 pb-1.5">{line.replace(/^#+\s/, '')}</h1>);
        } else if (/^#{2}\s/.test(line)) {
            flushList();
            elements.push(<h2 key={key++} className="font-mono text-sm font-bold text-accent uppercase tracking-wider mt-4 mb-2">{line.replace(/^#+\s/, '')}</h2>);
        } else if (/^#{3}\s/.test(line)) {
            flushList();
            elements.push(<h3 key={key++} className="font-mono text-xs font-bold text-white/80 uppercase tracking-wider mt-3 mb-1">{line.replace(/^#+\s/, '')}</h3>);
        } else if (/^[-*]\s/.test(line)) {
            if (listType === 'ol') flushList();
            listType = 'ul';
            listBuffer.push(line.replace(/^[-*]\s/, ''));
        } else if (/^\d+\.\s/.test(line)) {
            if (listType === 'ul') flushList();
            listType = 'ol';
            listBuffer.push(line.replace(/^\d+\.\s/, ''));
        } else if (line === '') {
            flushList();
            elements.push(<div key={key++} className="h-2" />);
        } else if (/^---+$/.test(line)) {
            flushList();
            elements.push(<hr key={key++} className="border-white/5 my-3" />);
        } else {
            flushList();
            elements.push(
                <p key={key++} className="font-mono text-sm text-white/80 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />
            );
        }
    }
    flushList();
    return <div className="space-y-0.5">{elements}</div>;
}

function inlineFormat(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-bold">$1</strong>')
        .replace(/\*(.+?)\*/g, '<em class="text-white/70 italic">$1</em>')
        .replace(/`(.+?)`/g, '<code class="font-mono text-accent/90 bg-accent/5 px-1 text-[11px]">$1</code>')
        .replace(/❌/g, '<span class="text-red-400">❌</span>')
        .replace(/✔/g, '<span class="text-green-400">✔</span>')
        .replace(/👉/g, '<span>→</span>');
}

// ── Main component ─────────────────────────────────────────────────────────
export default function ChatBubble({ message, onFollowUp }: ChatBubbleProps) {
    const username = useChatStore((s) => s.username);
    const isAssistant = message.role === 'assistant';
    const mode = message.metadata?.mode;
    const isEducational = mode === 'educational';
    const hasMetadata = isAssistant && message.metadata;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
                'flex w-full gap-4 p-6 transition-colors',
                isAssistant ? 'bg-white/[0.02] border-y border-white/[0.04]' : 'bg-transparent',
            )}
        >
            {/* Avatar */}
            <div className="flex-shrink-0">
                <div className={cn(
                    'w-8 h-8 flex items-center justify-center border text-[10px]',
                    isAssistant
                        ? 'bg-accent/10 border-accent/30 text-accent'
                        : 'bg-white/5 border-white/10 text-white/50',
                )}>
                    {isAssistant
                        ? (isEducational ? <GraduationCap className="w-4 h-4" /> : <TerminalSquare className="w-4 h-4" />)
                        : <User className="w-4 h-4" />}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 space-y-3 overflow-hidden min-w-0">
                {/* Header row */}
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">
                        {isAssistant ? 'VETIOS_AI // KOS-MOS' : (username ?? 'OPERATOR')}
                    </span>
                    {isAssistant && mode && (
                        <span className={cn(
                            'px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest border',
                            mode === 'educational' && 'text-blue-400/80 border-blue-400/20 bg-blue-400/5',
                            mode === 'clinical'    && 'text-accent/80 border-accent/20 bg-accent/5',
                            mode === 'general'     && 'text-white/40 border-white/10 bg-white/5',
                        )}>
                            {mode}
                        </span>
                    )}
                    {isAssistant && isEducational && message.metadata?.topic && (
                        <span className="font-mono text-[10px] text-accent/50 truncate">
                            {message.metadata.topic}
                        </span>
                    )}
                    <span className="font-mono text-[10px] text-white/20 ml-auto">
                        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>

                {/* Message body */}
                {isEducational
                    ? <MarkdownContent content={message.content} />
                    : (
                        <p className={cn(
                            'font-mono text-sm leading-relaxed tracking-tight',
                            isAssistant ? 'text-white/85' : 'text-white/65',
                        )}>
                            {message.content}
                        </p>
                    )
                }

                {/* Smart actions */}
                {hasMetadata && (
                    <SmartActions
                        metadata={message.metadata!}
                        messageContent={message.content}
                        onFollowUp={onFollowUp}
                    />
                )}
            </div>
        </motion.div>
    );
}
