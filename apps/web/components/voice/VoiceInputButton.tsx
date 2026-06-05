'use client';

import { useState } from 'react';
import { Check, Loader2, Mic, RotateCcw, Square, X } from 'lucide-react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { fallbackExtractClinicalFields } from '@/lib/voice/extract';
import type { ExtractedClinicalFields, VoiceExtractResponse, VoiceSurface } from '@/lib/voice/types';

interface VoiceInputButtonProps {
    surface: VoiceSurface;
    onExtracted: (fields: ExtractedClinicalFields) => void;
    label?: string;
}

export function VoiceInputButton({ surface, onExtracted, label = 'Voice input' }: VoiceInputButtonProps) {
    const speech = useSpeechRecognition();
    const [isOpen, setIsOpen] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [fields, setFields] = useState<ExtractedClinicalFields | null>(null);
    const [extractError, setExtractError] = useState<string | null>(null);

    async function extractTranscript(transcriptOverride?: string) {
        const transcript = (transcriptOverride ?? speech.getTranscript()).trim();
        if (!transcript) {
            setExtractError('No speech captured yet.');
            return;
        }
        setIsExtracting(true);
        setExtractError(null);
        try {
            const response = await fetch('/api/voice/extract', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ transcript, surface }),
            });
            const body = await response.json().catch(() => null) as VoiceExtractResponse | null;
            if (!response.ok || !body?.fields) {
                throw new Error('Voice extraction failed.');
            }
            setFields(body.fields);
        } catch (error) {
            setFields(fallbackExtractClinicalFields(transcript));
            setExtractError(error instanceof Error ? error.message : 'Voice extraction failed. Raw transcript was preserved.');
        } finally {
            setIsExtracting(false);
        }
    }

    function stopAndExtract() {
        speech.stop();
        window.setTimeout(() => {
            void extractTranscript();
        }, 350);
    }

    function fillForm() {
        if (!fields) return;
        onExtracted(fields);
        setIsOpen(false);
        setFields(null);
        speech.reset();
        setExtractError(null);
    }

    function resetAll() {
        setFields(null);
        setExtractError(null);
        speech.reset();
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                className="fixed bottom-5 right-5 z-[70] flex h-14 w-14 items-center justify-center rounded-full border border-accent/45 bg-accent text-black shadow-[0_0_30px_rgba(0,255,102,0.35)] transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent/60"
                aria-label={label}
                title={label}
            >
                <Mic className="h-5 w-5" />
            </button>

            {isOpen ? (
                <section className="fixed bottom-24 right-4 z-[70] w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-white/12 bg-[hsl(0_0%_6%)] p-4 text-white shadow-2xl">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">Voice Capture</div>
                            <div className="mt-1 text-xs text-white/55">Review before filling. Nothing is submitted.</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="rounded-md border border-white/10 p-2 text-white/50 transition hover:text-white"
                            aria-label="Close voice input"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {!speech.isSupported ? (
                        <div className="rounded-md border border-yellow-400/30 bg-yellow-400/10 p-3 text-sm text-yellow-100">
                            Voice input is not supported in this browser. Use Chrome or Edge with microphone permissions enabled.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="min-h-[96px] rounded-md border border-white/10 bg-black/35 p-3 text-sm leading-relaxed text-white/80">
                                {speech.transcript || 'Tap start and dictate the case in natural clinical language.'}
                            </div>

                            {speech.error ? <Notice tone="danger">{speech.error}</Notice> : null}
                            {extractError ? <Notice tone="warning">{extractError}</Notice> : null}

                            {fields ? (
                                <div className="rounded-md border border-accent/20 bg-accent/5 p-3">
                                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Extracted Fields</div>
                                    <Preview fields={fields} />
                                </div>
                            ) : null}

                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <ActionButton onClick={speech.start} disabled={speech.isListening || isExtracting}>
                                    <Mic className="h-4 w-4" />
                                    Start
                                </ActionButton>
                                <ActionButton onClick={stopAndExtract} disabled={!speech.isListening || isExtracting}>
                                    <Square className="h-4 w-4" />
                                    Stop
                                </ActionButton>
                                <ActionButton onClick={resetAll} disabled={isExtracting || (!speech.transcript && !fields)}>
                                    <RotateCcw className="h-4 w-4" />
                                    Reset
                                </ActionButton>
                                <ActionButton onClick={fillForm} disabled={!fields || isExtracting} accent>
                                    {isExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                    Fill form
                                </ActionButton>
                            </div>

                            {!speech.isListening && speech.transcript && !fields ? (
                                <button
                                    type="button"
                                    onClick={() => void extractTranscript()}
                                    disabled={isExtracting}
                                    className="w-full rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent transition hover:bg-accent hover:text-black disabled:opacity-50"
                                >
                                    {isExtracting ? 'Extracting...' : 'Extract fields'}
                                </button>
                            ) : null}
                        </div>
                    )}
                </section>
            ) : null}
        </>
    );
}

function ActionButton({
    children,
    onClick,
    disabled,
    accent = false,
}: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    accent?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={[
                'flex min-h-[40px] items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45',
                accent
                    ? 'border-accent/50 bg-accent/15 text-accent hover:bg-accent hover:text-black'
                    : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/25 hover:text-white',
            ].join(' ')}
        >
            {children}
        </button>
    );
}

function Preview({ fields }: { fields: ExtractedClinicalFields }) {
    const rows = [
        ['Species', fields.species],
        ['Breed', fields.breed],
        ['Age', fields.age_value && fields.age_unit ? `${fields.age_value} ${fields.age_unit}` : undefined],
        ['Sex', fields.sex?.replace(/_/g, ' ')],
        ['Signs', fields.symptoms.join(', ')],
        ['Duration', fields.duration_value && fields.duration_unit ? `${fields.duration_value} ${fields.duration_unit}` : undefined],
        ['Labs', fields.labs ? Object.entries(fields.labs).map(([key, value]) => `${key.toUpperCase()} ${value}`).join(', ') : undefined],
    ].filter(([, value]) => Boolean(value));

    return (
        <div className="space-y-1.5 text-xs">
            {rows.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[88px_1fr] gap-2">
                    <span className="text-white/40">{key}</span>
                    <span className="text-white/85">{value}</span>
                </div>
            ))}
        </div>
    );
}

function Notice({ children, tone }: { children: React.ReactNode; tone: 'warning' | 'danger' }) {
    return (
        <div className={[
            'rounded-md border p-2 text-xs',
            tone === 'danger'
                ? 'border-red-400/30 bg-red-400/10 text-red-100'
                : 'border-yellow-400/30 bg-yellow-400/10 text-yellow-100',
        ].join(' ')}
        >
            {children}
        </div>
    );
}
