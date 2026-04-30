'use client';

import { useEffect, useMemo, useState } from 'react';
import { LibraryBig, Check, X } from 'lucide-react';
import { detectSpeciesFromTexts } from '@/lib/askVetios/context';

interface ConversationMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

interface SimilarCasesPanelProps {
    messageContent: string;
    conversationMessages: ConversationMessage[];
    queryText?: string;
    onFollowUp: (prompt: string) => void;
}

interface SimilarCase {
    caseId: string;
    inferenceEventId: string | null;
    species: string;
    presentingSigns: string[];
    finalDiagnosis: string;
    outcome: string;
    similarity: number;
    clinicalSummary: string;
}

interface SimilarCasesPayload {
    species: string;
    retrievalSummary: string;
    cases: SimilarCase[];
}

function extractFallbackSigns(content: string) {
    const matches = content.toLowerCase().match(/\b(vomiting|diarrhea|cough|dyspnea|ataxia|seizure|lameness|anorexia|fever|lethargy)\b/g) ?? [];
    return Array.from(new Set(matches)).slice(0, 4);
}

export default function SimilarCasesPanel({ messageContent, conversationMessages, queryText, onFollowUp }: SimilarCasesPanelProps) {
    const fallbackPayload = useMemo<SimilarCasesPayload>(() => ({
        species: detectSpeciesFromTexts([queryText, messageContent]),
        retrievalSummary: 'No live similar-case retrieval available yet for this message.',
        cases: [],
    }), [messageContent, queryText]);

    const [payload, setPayload] = useState<SimilarCasesPayload>(fallbackPayload);
    const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [feedbackState, setFeedbackState] = useState<Record<string, 'confirmed' | 'rejected'>>({});

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setStatus('loading');

            try {
                const response = await fetch('/api/ask-vetios/similar-cases', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messageContent,
                        conversation: conversationMessages.slice(-8).map((message) => ({
                            role: message.role,
                            content: message.content,
                        })),
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Request failed with ${response.status}`);
                }

                const data = (await response.json()) as SimilarCasesPayload;
                if (!cancelled) {
                    setPayload({
                        species: data.species || fallbackPayload.species,
                        retrievalSummary: data.retrievalSummary || fallbackPayload.retrievalSummary,
                        cases: Array.isArray(data.cases) ? data.cases : [],
                    });
                    setStatus('ready');
                }
            } catch {
                if (!cancelled) {
                    setPayload(fallbackPayload);
                    setStatus('error');
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [conversationMessages, fallbackPayload, messageContent]);

    const submitFeedback = async (item: SimilarCase, verdict: 'confirmed' | 'rejected') => {
        setFeedbackState((current) => ({ ...current, [item.caseId]: verdict }));

        try {
            await fetch('/api/rlhf/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inferenceEventId: item.inferenceEventId ?? item.caseId,
                    feedbackType: verdict === 'confirmed' ? 'diagnosis_confirmed' : 'diagnosis_rejected',
                    predictedDiagnosis: item.finalDiagnosis,
                    actualDiagnosis: verdict === 'confirmed' ? item.finalDiagnosis : null,
                    predictedConfidence: item.similarity,
                    vetConfidence: 0.85,
                    species: item.species,
                    vetNotes: `Similarity panel ${verdict} for case ${item.caseId}`,
                    labelType: 'expert',
                    extractedFeatures: {},
                }),
            });
        } catch {
            // Non-blocking: keep UI state even if RLHF submission is unavailable.
        }
    };

    const fallbackSigns = extractFallbackSigns(messageContent);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <LibraryBig className="h-4 w-4 text-[#00ff88]" />
                        <h3 className="font-mono text-xs uppercase tracking-[0.22em] text-[#00ff88]">
                            Real-Time Similar Cases
                        </h3>
                    </div>
                    <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-white/58">
                        {payload.retrievalSummary}
                    </p>
                </div>

                <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Species</div>
                    <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/76">{payload.species}</div>
                </div>
            </div>

            {status === 'loading' && (
                <div className="border border-white/10 bg-white/[0.02] px-4 py-3 font-mono text-[11px] text-white/54">
                    Searching the VetIOS case vector store for nearest historical analogs...
                </div>
            )}

            {status === 'error' && (
                <div className="border border-amber-500/20 bg-amber-500/6 px-4 py-3 font-mono text-[11px] leading-relaxed text-amber-200/80">
                    Similar-case retrieval is unavailable right now. The panel is still preserving the case-learning workflow for the current session.
                </div>
            )}

            {payload.cases.length > 0 ? (
                <div className="grid gap-3">
                    {payload.cases.map((item) => (
                        <div key={item.caseId} className="space-y-3 border border-white/10 bg-white/[0.02] p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <span className="border border-[#00ff88]/20 bg-[#00ff88]/8 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#00ff88]">
                                            {Math.round(item.similarity * 100)}% similarity
                                        </span>
                                        <span className="border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/46">
                                            anonymized case
                                        </span>
                                    </div>
                                    <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/76">
                                        {item.finalDiagnosis}
                                    </div>
                                    <p className="font-mono text-[11px] leading-relaxed text-white/62">
                                        {item.clinicalSummary}
                                    </p>
                                </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="border border-white/8 bg-black/25 px-3 py-2">
                                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Species</div>
                                    <div className="mt-1 font-mono text-[11px] text-white/76">{item.species}</div>
                                </div>
                                <div className="border border-white/8 bg-black/25 px-3 py-2 sm:col-span-2">
                                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Presenting Signs</div>
                                    <div className="mt-1 font-mono text-[11px] leading-relaxed text-white/76">
                                        {item.presentingSigns.join(' • ')}
                                    </div>
                                </div>
                            </div>

                            <div className="border border-white/8 bg-black/25 px-3 py-2">
                                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Outcome</div>
                                <div className="mt-1 font-mono text-[11px] leading-relaxed text-white/76">{item.outcome}</div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => onFollowUp(`Compare this case with the current patient and explain what I should learn from it: diagnosis ${item.finalDiagnosis}, presenting signs ${item.presentingSigns.join(', ')}, outcome ${item.outcome}.`)}
                                    className="border border-[#00ff88]/20 bg-[#00ff88]/8 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#00ff88] transition-colors hover:bg-[#00ff88]/14"
                                >
                                    Learn from this case
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void submitFeedback(item, 'confirmed')}
                                    className={`inline-flex items-center gap-2 border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                                        feedbackState[item.caseId] === 'confirmed'
                                            ? 'border-[#00ff88]/35 bg-[#00ff88]/12 text-[#00ff88]'
                                            : 'border-white/10 bg-black/25 text-white/64 hover:border-white/20 hover:text-white'
                                    }`}
                                >
                                    <Check className="h-3 w-3" />
                                    Confirm Similar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void submitFeedback(item, 'rejected')}
                                    className={`inline-flex items-center gap-2 border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                                        feedbackState[item.caseId] === 'rejected'
                                            ? 'border-red-400/35 bg-red-500/10 text-red-300'
                                            : 'border-white/10 bg-black/25 text-white/64 hover:border-white/20 hover:text-white'
                                    }`}
                                >
                                    <X className="h-3 w-3" />
                                    Reject Similar
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="space-y-3 border border-dashed border-white/10 bg-black/20 px-4 py-5">
                    <div className="font-mono text-[11px] text-white/48">
                        No similar historical cases were returned for this snapshot.
                    </div>
                    {fallbackSigns.length > 0 && (
                        <div className="font-mono text-[11px] text-white/42">
                            Active sign anchors: {fallbackSigns.join(' • ')}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
