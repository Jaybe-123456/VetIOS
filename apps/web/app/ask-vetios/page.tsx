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

type AskVetiosContractResponse = {
    narrative?: string;
    differentials?: Array<{
        rank: number;
        diagnosis: string;
        confidence: number;
        supporting_evidence?: string[];
        contradicting_evidence?: string[];
        source_attribution?: string[];
    }>;
    recommended_diagnostics?: string[];
    recommended_treatments?: string[];
    flags?: {
        low_confidence_hypotheses?: string[];
        unsourced_priors?: string[];
        requires_specialist_review?: boolean;
        emergency_flag?: boolean;
    };
    rag_chunks_used?: number;
    response_latency_ms?: number;
    model_version?: string;
    clinical_signs?: string[];
    document_tables?: Array<{
        title: string;
        columns: string[];
        rows: string[][];
    }>;
    error?: string;
    reason?: string;
};

type UploadResponse = {
    upload_id?: string;
    status?: string;
    source_type?: string;
    detected_mime?: string;
    rag_document_id?: string | null;
    chunks_indexed?: number;
    extracted_characters?: number;
    processing_note?: string | null;
    error?: string;
    reason?: string;
    file_name?: string;
};

const DOCUMENT_UPLOAD_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx', 'json']);
const MAX_DOCUMENT_UPLOAD_BYTES = 50 * 1024 * 1024;

export default function AskVetIOSPage() {
    const {
    createChat, activeChatId, addMessage, setLoading, isLoading,
    switchChat, chats, deleteChat, username, incrementUsage
} = useChatStore();

    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [chatUploads, setChatUploads] = useState<Record<string, UploadResponse[]>>({});

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

        if (!incrementUsage()) {
            addMessage(activeChatId, { role: 'user', content });
            addMessage(activeChatId, {
                role: 'assistant',
                content: "Free tier usage limit reached (40/40). Intelligence access will refresh in 6 hours. Upgrade to Premium for unmetered access.",
                metadata: { mode: 'operational' },
            });
            return;
        }

        addMessage(activeChatId, { role: 'user', content });
        setLoading(true);

        try {
            const activeUploads = chatUploads[activeChatId] ?? [];
            if (activeUploads.length > 0 && isUploadedDocumentQuestion(content)) {
                const queryResponse = await fetch('/api/ask-vetios/query', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: activeChatId,
                        query: content,
                        upload_ids: activeUploads
                            .map((upload) => upload.upload_id)
                            .filter((value): value is string => Boolean(value)),
                        domain: 'clinical_document,diagnostics,lab_reference',
                    }),
                });
                const analysis = await queryResponse.json() as AskVetiosContractResponse;
                if (!queryResponse.ok || analysis.error) {
                    throw new Error(analysis.reason || analysis.error || 'Uploaded document analysis failed.');
                }
                const latestUpload = activeUploads[activeUploads.length - 1] ?? {};
                addMessage(activeChatId, {
                    role: 'assistant',
                    content: formatDocumentAnalysis(latestUpload.file_name ?? 'uploaded document', latestUpload, analysis),
                    metadata: buildDocumentAnalysisMetadata(analysis, latestUpload),
                });
                return;
            }

            const response = await fetch('/api/ask-vetios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: content, conversation: history }),
            });

            const data = await response.json() as {
                mode?: string; content?: string; topic?: string; metadata?: unknown; error?: string; query_history_id?: string | null;
            };

            if (data.error) throw new Error(data.error);

            addMessage(activeChatId, {
                role: 'assistant',
                content: data.content ?? '',
                metadata: {
                    mode: (data.mode as 'educational' | 'clinical' | 'general') ?? 'general',
                    topic: data.topic,
                    query_history_id: data.query_history_id,
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
    }, [activeChatId, chats, chatUploads, addMessage, setLoading, incrementUsage]);

    const handleFollowUp = useCallback((prompt: string) => {
        void sendMessage(prompt);
    }, [sendMessage]);

    const handleUploadFile = useCallback(async (file: File) => {
        if (!activeChatId || uploading) return;

        const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!DOCUMENT_UPLOAD_EXTENSIONS.has(extension)) {
            addMessage(activeChatId, {
                role: 'assistant',
                content: 'This command upload path currently accepts document and lab files: PDF, DOCX, TXT, MD, CSV, XLSX, or JSON. Images and video are handled by the dedicated multimodal processors.',
                metadata: { mode: 'general' },
            });
            return;
        }
        if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
            addMessage(activeChatId, {
                role: 'assistant',
                content: 'Upload rejected before transfer: document files must be 50 MB or smaller.',
                metadata: { mode: 'general' },
            });
            return;
        }
        if (!incrementUsage()) {
            addMessage(activeChatId, { role: 'user', content: `Upload document for analysis: ${file.name}` });
            addMessage(activeChatId, {
                role: 'assistant',
                content: "Free tier usage limit reached (40/40). Intelligence access will refresh in 6 hours. Upgrade to Premium for unmetered access.",
                metadata: { mode: 'operational' },
            });
            return;
        }

        const analysisPrompt = buildDocumentAnalysisPrompt(file.name);
        addMessage(activeChatId, {
            role: 'user',
            content: `Uploaded document: ${file.name}\n\n${analysisPrompt}`,
        });
        setUploading(true);
        setLoading(true);

        try {
            const form = new FormData();
            form.append('file', file);
            form.append('session_id', activeChatId);
            form.append('domain', 'clinical_document,diagnostics,lab_reference');

            const uploadResponse = await fetch('/api/ask-vetios/upload', {
                method: 'POST',
                body: form,
            });
            const upload = await uploadResponse.json() as UploadResponse;
            if (!uploadResponse.ok || upload.error || !upload.upload_id) {
                throw new Error(upload.reason || upload.error || 'Upload failed security validation.');
            }
            upload.file_name = file.name;
            if ((upload.chunks_indexed ?? 0) <= 0) {
                throw new Error(upload.processing_note || 'The file passed security validation, but no extractable text was indexed.');
            }
            setChatUploads((current) => ({
                ...current,
                [activeChatId]: [...(current[activeChatId] ?? []), upload],
            }));

            const queryResponse = await fetch('/api/ask-vetios/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: activeChatId,
                    query: analysisPrompt,
                    upload_ids: [upload.upload_id],
                    domain: 'clinical_document,diagnostics,lab_reference',
                }),
            });
            const analysis = await queryResponse.json() as AskVetiosContractResponse;
            if (!queryResponse.ok || analysis.error) {
                throw new Error(analysis.reason || analysis.error || 'Document analysis failed.');
            }

            addMessage(activeChatId, {
                role: 'assistant',
                content: formatDocumentAnalysis(file.name, upload, analysis),
                metadata: buildDocumentAnalysisMetadata(analysis, upload),
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Document analysis failed.';
            addMessage(activeChatId, {
                role: 'assistant',
                content: `Document analysis could not complete.\n\nReason: ${msg}`,
                metadata: { mode: 'general' },
            });
        } finally {
            setUploading(false);
            setLoading(false);
        }
    }, [activeChatId, uploading, addMessage, setLoading, incrementUsage]);

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
    
        <div className="h-full min-h-0 w-full flex bg-[#050505] text-white overflow-hidden">

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
                <header className="px-4 sm:px-5 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 shrink-0">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0 w-full sm:w-auto">
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

                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                        <button
                            onClick={() => createChat()}
                            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-black font-mono text-[10px] font-bold uppercase tracking-widest hover:bg-accent/90 transition-all shadow-[0_0_12px_rgba(0,255,102,0.2)] whitespace-nowrap"
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
                    <div className="shrink-0 border-t-2 border-accent/20 bg-[#060606] relative z-10">
                        <ChatInput
                            onSend={sendMessage}
                            onUploadFile={handleUploadFile}
                            disabled={isLoading}
                            uploadDisabled={uploading}
                        />
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

function isUploadedDocumentQuestion(content: string): boolean {
    return /\b(uploaded|document|file|pdf|docx|spreadsheet|csv|analy[sz]e|review|summari[sz]e|extract|all information|what does it say|this case|clinical signs?|findings?|diagnostics?|differentials?|labs?|values?|treatments?|outcomes?|sources?|citations?|tables?)\b/i.test(content);
}

function buildDocumentAnalysisMetadata(analysis: AskVetiosContractResponse, upload: UploadResponse) {
    return {
        mode: 'clinical' as const,
        topic: 'Uploaded Document Analysis',
        diagnosis_ranked: (analysis.differentials ?? []).map((entry) => ({
            name: entry.diagnosis,
            confidence: entry.confidence,
            reasoning: (entry.supporting_evidence ?? []).join('; ') || 'Extracted from uploaded document evidence.',
        })),
        recommended_tests: analysis.recommended_diagnostics ?? [],
        red_flags: analysis.flags?.emergency_flag ? ['Emergency flag detected in uploaded document analysis.'] : [],
        rag_grounded: (analysis.rag_chunks_used ?? 0) > 0,
        clinical_signs: analysis.clinical_signs ?? [],
        document_tables: analysis.document_tables ?? [],
        rag_retrieval_stats: {
            rag_chunks_used: analysis.rag_chunks_used ?? 0,
            response_latency_ms: analysis.response_latency_ms,
            model_version: analysis.model_version,
            upload_status: upload.status,
            chunks_indexed: upload.chunks_indexed,
        },
    };
}

function buildDocumentAnalysisPrompt(fileName: string): string {
    return [
        `Analyze the uploaded clinical document "${fileName}" in full detail.`,
        'Extract all clinically relevant information from the indexed source.',
        'Provide complete source-grounded reasoning: case facts, signalment if present, clinical findings, lab or imaging values, differential implications, contradictions, missing diagnostics, safety flags, and recommended next steps.',
        'Cite the uploaded source evidence and clearly label uncertainty. Do not invent facts that are not present in the uploaded document.',
    ].join(' ');
}

function formatDocumentAnalysis(
    fileName: string,
    upload: UploadResponse,
    analysis: AskVetiosContractResponse,
): string {
    const lines = [
        `# Uploaded Document Analysis`,
        ``,
        `| Field | Value |`,
        `| --- | --- |`,
        `| File | ${fileName} |`,
        `| Indexed chunks | ${upload.chunks_indexed ?? 0} |`,
        `| Extracted characters | ${upload.extracted_characters ?? 0} |`,
        `| RAG chunks used | ${analysis.rag_chunks_used ?? 0} |`,
        ``,
        `## Full Reasoning`,
        analysis.narrative?.trim() || 'No narrative was returned.',
    ];

    if (analysis.differentials?.length) {
        lines.push('', '## Differential Reasoning', '| Rank | Differential | Confidence | Supporting Evidence | Contradictions | Sources |', '| --- | --- | --- | --- | --- | --- |');
        for (const differential of analysis.differentials) {
            lines.push(
                `| ${differential.rank} | ${escapeTableCell(differential.diagnosis)} | ${Math.round(differential.confidence * 100)}% | ${escapeTableCell((differential.supporting_evidence ?? []).join('; ') || 'None supplied')} | ${escapeTableCell((differential.contradicting_evidence ?? []).join('; ') || 'None supplied')} | ${escapeTableCell((differential.source_attribution ?? []).join('; ') || 'model_prior')} |`,
            );
        }
    }

    if (analysis.recommended_diagnostics?.length) {
        lines.push('', '## Recommended Diagnostics', ...analysis.recommended_diagnostics.map((item) => `- ${item}`));
    }
    if (analysis.recommended_treatments?.length) {
        lines.push('', '## Recommended Treatments', ...analysis.recommended_treatments.map((item) => `- ${item}`));
    }

    const flags = analysis.flags;
    if (flags) {
        lines.push(
            '',
            '## Safety And Uncertainty Flags',
            `| Flag | Value |`,
            `| --- | --- |`,
            `| Emergency flag | ${flags.emergency_flag ? 'yes' : 'no'} |`,
            `| Specialist review | ${flags.requires_specialist_review ? 'yes' : 'no'} |`,
            `| Low-confidence hypotheses | ${escapeTableCell((flags.low_confidence_hypotheses ?? []).join(', ') || 'none')} |`,
            `| Unsourced priors | ${escapeTableCell((flags.unsourced_priors ?? []).join(', ') || 'none')} |`,
        );
    }

    return lines.join('\n');
}

function escapeTableCell(value: string): string {
    return value.replace(/\|/g, '/').replace(/\n+/g, ' ').trim();
}
