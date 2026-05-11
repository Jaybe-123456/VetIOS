'use client';

import { useState } from 'react';
import { Message } from '@/store/useChatStore';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useChatStore } from '@/store/useChatStore';
import { TerminalSquare, User, GraduationCap, ThumbsUp, ThumbsDown } from 'lucide-react';
import SmartActions from './SmartActions';

interface ChatBubbleProps {
    message: Message;
    conversationMessages: Message[];
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

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const raw = lines[lineIndex];
        const line = raw.trimEnd();

        if (isTableHeader(line, lines[lineIndex + 1] ?? '')) {
            flushList();
            const tableLines = [line];
            lineIndex += 2;
            while (lineIndex < lines.length && lines[lineIndex].includes('|')) {
                tableLines.push(lines[lineIndex].trimEnd());
                lineIndex += 1;
            }
            lineIndex -= 1;
            elements.push(renderMarkdownTable(tableLines, key++));
        } else if (/^#{1}\s/.test(line)) {
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

function isTableHeader(line: string, nextLine: string): boolean {
    return line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(nextLine);
}

function parseTableRow(line: string): string[] {
    return line
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

function renderMarkdownTable(tableLines: string[], key: number): React.ReactNode {
    const headers = parseTableRow(tableLines[0] ?? '');
    const rows = tableLines.slice(1).map(parseTableRow);

    return (
        <div key={key} className="my-3 overflow-x-auto border border-white/10 bg-black/20">
            <table className="w-full min-w-[520px] border-collapse text-left font-mono text-[11px]">
                <thead>
                    <tr className="bg-white/[0.04] text-accent/80">
                        {headers.map((header, index) => (
                            <th key={`${header}-${index}`} className="border-b border-white/10 px-3 py-2 font-normal uppercase tracking-[0.12em]"
                                dangerouslySetInnerHTML={{ __html: inlineFormat(header) }} />
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-white/[0.05] last:border-b-0">
                            {headers.map((_header, cellIndex) => (
                                <td key={`${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top text-white/72"
                                    dangerouslySetInnerHTML={{ __html: inlineFormat(row[cellIndex] ?? '') }} />
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
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
export default function ChatBubble({ message, conversationMessages, onFollowUp }: ChatBubbleProps) {
    const username = useChatStore((s) => s.username);
    const [feedbackState, setFeedbackState] = useState<'idle' | 'helpful' | 'not_helpful' | 'sent'>('idle');
    const [feedbackReason, setFeedbackReason] = useState<'images_missing' | 'drug_dose_wrong' | 'sources_irrelevant' | 'information_incomplete'>('information_incomplete');
    const [feedbackNotes, setFeedbackNotes] = useState('');
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
                {isAssistant
                    ? <MarkdownContent content={message.content} />
                    : (
                        <p className={cn(
                            'font-mono text-sm leading-relaxed tracking-tight whitespace-pre-wrap',
                            'text-white/65',
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
                        messageId={message.id}
                        messageTimestamp={message.timestamp}
                        conversationMessages={conversationMessages}
                        onFollowUp={onFollowUp}
                    />
                )}

                {isAssistant && message.metadata?.query_history_id && (
                    <div className="space-y-2 border-t border-white/5 pt-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => submitFeedback('helpful')}
                                disabled={feedbackState === 'sent'}
                                className="inline-flex items-center gap-1.5 border border-white/10 bg-white/[0.02] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/46 transition-colors hover:border-accent/25 hover:text-accent disabled:opacity-50"
                            >
                                <ThumbsUp className="h-3 w-3" />
                                Helpful
                            </button>
                            <button
                                type="button"
                                onClick={() => setFeedbackState('not_helpful')}
                                disabled={feedbackState === 'sent'}
                                className="inline-flex items-center gap-1.5 border border-white/10 bg-white/[0.02] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/46 transition-colors hover:border-amber-400/25 hover:text-amber-200 disabled:opacity-50"
                            >
                                <ThumbsDown className="h-3 w-3" />
                                Not helpful
                            </button>
                            {feedbackState === 'sent' && (
                                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent/70">Feedback saved</span>
                            )}
                        </div>

                        {feedbackState === 'not_helpful' && (
                            <div className="grid gap-2 border border-white/8 bg-black/20 p-2">
                                <select
                                    value={feedbackReason}
                                    onChange={(event) => setFeedbackReason(event.target.value as typeof feedbackReason)}
                                    className="border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/70 outline-none focus:border-accent/35"
                                >
                                    <option value="images_missing">Images were missing</option>
                                    <option value="drug_dose_wrong">Drug dose was wrong</option>
                                    <option value="sources_irrelevant">Sources were irrelevant</option>
                                    <option value="information_incomplete">Information was incomplete</option>
                                </select>
                                <input
                                    value={feedbackNotes}
                                    onChange={(event) => setFeedbackNotes(event.target.value.slice(0, 200))}
                                    placeholder="Optional note"
                                    className="border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white/70 outline-none placeholder:text-white/25 focus:border-accent/35"
                                />
                                <button
                                    type="button"
                                    onClick={() => submitFeedback('not_helpful')}
                                    className="justify-self-start border border-amber-400/20 bg-amber-400/8 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-100/80 transition-colors hover:bg-amber-400/12"
                                >
                                    Send feedback
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </motion.div>
    );

    async function submitFeedback(kind: 'helpful' | 'not_helpful') {
        const queryId = message.metadata?.query_history_id;
        if (!queryId) return;
        await fetch('/api/ask-vetios/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query_id: queryId,
                user_feedback: kind,
                reason: kind === 'not_helpful' ? feedbackReason : undefined,
                feedback_notes: kind === 'not_helpful' ? feedbackNotes : undefined,
            }),
        }).catch(() => null);
        setFeedbackState('sent');
    }
}
