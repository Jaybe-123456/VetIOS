'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import {
    confidenceLabel,
    formatCaseNumber,
    formatClinicalLabel,
    formatPercent,
    type ClinicalDiagnosisResult,
} from './clinicalTypes';

interface DiagnosisResultCardProps {
    result: ClinicalDiagnosisResult;
    onConfirmOutcome?: (diagnosisLabel: string) => void;
    mode: 'clinician' | 'console';
}

export function DiagnosisResultCard({ result, onConfirmOutcome, mode }: DiagnosisResultCardProps) {
    const [selected, setSelected] = useState(result.differentials[0]?.label ?? '');
    const canConfirm = Boolean(onConfirmOutcome && selected && !result.is_demo);

    if (mode === 'console') {
        return (
            <section className="rounded-lg border border-[hsl(0_0%_100%_/_0.1)] bg-[hsl(0_0%_7%)] p-5">
                <div className="font-mono text-sm uppercase tracking-[0.14em] text-accent">Console result</div>
                <div className="mt-4 grid gap-3 font-mono text-xs text-[hsl(0_0%_78%)]">
                    <div>inference_event_id: {result.inference_event_id}</div>
                    <div>confidence_score: {result.confidence.toFixed(4)}</div>
                    {result.cire ? <pre className="overflow-auto rounded bg-black/40 p-3">{JSON.stringify(result.cire, null, 2)}</pre> : null}
                    {result.raw ? <pre className="overflow-auto rounded bg-black/40 p-3">{JSON.stringify(result.raw, null, 2)}</pre> : null}
                </div>
            </section>
        );
    }

    return (
        <section className="rounded-lg border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_7%)] p-4 sm:p-5">
            <div className="flex flex-col gap-2 border-b border-[hsl(0_0%_100%_/_0.08)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[hsl(0_0%_56%)]">
                        {formatCaseNumber(result.inference_event_id)}
                    </div>
                    <h2 className="mt-1 text-xl font-semibold text-[hsl(0_0%_96%)]">Ranked diagnoses</h2>
                </div>
                <div className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-sm text-accent">
                    {confidenceLabel(result.confidence)}
                </div>
            </div>

            <div className="mt-5 space-y-3">
                {result.differentials.map((entry, index) => (
                    <button
                        key={`${entry.label}-${index}`}
                        type="button"
                        onClick={() => setSelected(entry.label)}
                        className={`w-full rounded-md border p-3 text-left transition ${
                            selected === entry.label ? 'border-accent/60 bg-accent/10' : 'border-[hsl(0_0%_100%_/_0.08)] bg-white/[0.02]'
                        }`}
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="font-medium text-[hsl(0_0%_94%)]">
                                {index + 1}. {formatClinicalLabel(entry.label)}
                            </div>
                            <span className={urgencyClass(entry.urgency)}>{entry.urgency} urgency</span>
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                            <div className="h-2 flex-1 rounded-full bg-white/[0.06]">
                                <div className={`h-2 rounded-full ${probabilityClass(entry.probability)}`} style={{ width: formatPercent(entry.probability) }} />
                            </div>
                            <span className="w-12 text-right text-sm text-[hsl(0_0%_72%)]">{formatPercent(entry.probability)}</span>
                        </div>
                    </button>
                ))}
            </div>

            {result.recommended_tests.length > 0 ? (
                <div className="mt-5 rounded-md border border-[hsl(0_0%_100%_/_0.08)] bg-white/[0.025] p-4">
                    <div className="mb-3 font-medium text-[hsl(0_0%_92%)]">Recommended next tests</div>
                    <div className="space-y-2">
                        {result.recommended_tests.map((test) => (
                            <div key={test} className="flex items-start gap-2 text-sm text-[hsl(0_0%_78%)]">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                                <span>{formatClinicalLabel(test)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {result.reliability_note ? (
                <div className="mt-4 flex gap-3 rounded-md border border-[hsl(45_100%_55%_/_0.28)] bg-[hsl(45_100%_55%_/_0.08)] p-3 text-sm text-[hsl(45_100%_78%)]">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{result.reliability_note}</span>
                </div>
            ) : null}

            {onConfirmOutcome ? (
                <button
                    type="button"
                    title={result.is_demo ? 'Sign in to confirm' : undefined}
                    disabled={!canConfirm}
                    onClick={() => selected && onConfirmOutcome(selected)}
                    className="mt-5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-4 text-sm font-medium text-accent transition hover:bg-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-45"
                >
                    <ClipboardCheck className="h-4 w-4" />
                    Confirm diagnosis
                </button>
            ) : null}
        </section>
    );
}

function probabilityClass(value: number): string {
    if (value > 0.7) return 'bg-[hsl(0_85%_62%)]';
    if (value >= 0.3) return 'bg-[hsl(45_100%_55%)]';
    return 'bg-[hsl(0_0%_48%)]';
}

function urgencyClass(value: string): string {
    const tone = value === 'high' ? 'border-red-400/40 text-red-300' : value === 'medium' ? 'border-amber-300/40 text-amber-200' : 'border-white/15 text-white/60';
    return `rounded-full border px-2 py-1 text-xs capitalize ${tone}`;
}
