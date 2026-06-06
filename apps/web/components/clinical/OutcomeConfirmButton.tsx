'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import { formatClinicalLabel } from './clinicalTypes';

interface OutcomeConfirmButtonProps {
    inferenceEventId: string;
    suggestedLabel: string;
    onConfirmed: (outcomeEventId: string) => void;
    disabled?: boolean;
    options?: string[];
    compact?: boolean;
    title?: string;
}

const OTHER_VALUE = '__other_diagnosis__';
const DIAGNOSIS_METHODS = [
    { value: 'clinical', label: 'Clinical review' },
    { value: 'lab_confirmed', label: 'Lab confirmed' },
    { value: 'imaging_confirmed', label: 'Imaging confirmed' },
    { value: 'pathology', label: 'Pathology' },
    { value: 'response_to_treatment', label: 'Response to treatment' },
] as const;

export function OutcomeConfirmButton({
    inferenceEventId,
    suggestedLabel,
    onConfirmed,
    disabled = false,
    options,
    compact = false,
    title = 'What was the actual diagnosis?',
}: OutcomeConfirmButtonProps) {
    const labels = useMemo(() => Array.from(new Set([suggestedLabel, ...(options ?? [])].filter(Boolean))), [options, suggestedLabel]);
    const [selectedLabel, setSelectedLabel] = useState(suggestedLabel || labels[0] || OTHER_VALUE);
    const [customLabel, setCustomLabel] = useState('');
    const [diagnosisMethod, setDiagnosisMethod] = useState<(typeof DIAGNOSIS_METHODS)[number]['value']>('clinical');
    const [notes, setNotes] = useState('');
    const [requestId] = useState(() => crypto.randomUUID());
    const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);
    const actualLabel = selectedLabel === OTHER_VALUE ? customLabel.trim() : selectedLabel;

    async function confirmOutcome() {
        if (disabled || status === 'saved' || !actualLabel) return;
        setStatus('saving');
        setError(null);
        try {
            const response = await fetch('/api/outcome', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    request_id: requestId,
                    inference_event_id: inferenceEventId,
                    outcome: {
                        type: 'confirmed_diagnosis',
                        payload: {
                            label: actualLabel,
                            actual_diagnosis: actualLabel,
                            confirmed_diagnosis: actualLabel,
                            confidence: 0.98,
                            label_type: 'expert_reviewed',
                            diagnosis_method: diagnosisMethod,
                            clinician_notes: notes.trim() || undefined,
                        },
                        timestamp: new Date().toISOString(),
                    },
                }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(readPlainError(body));
            }
            const outcomeId = typeof body.outcome_event_id === 'string' ? body.outcome_event_id : requestId;
            setStatus('saved');
            onConfirmed(outcomeId);
        } catch {
            setStatus('error');
            setError("Couldn't save the outcome. Please try again.");
        }
    }

    return (
        <section className={[
            'rounded-lg border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_7%)]',
            compact ? 'p-3' : 'p-4 sm:p-5',
        ].join(' ')}>
            <h3 className={compact ? 'text-sm font-semibold text-[hsl(0_0%_94%)]' : 'text-lg font-semibold text-[hsl(0_0%_94%)]'}>
                {title}
            </h3>
            <div className={compact ? 'mt-3' : 'mt-4'}>
                <label className="mb-2 block text-sm text-[hsl(0_0%_70%)]">Confirmed diagnosis</label>
                <select
                    value={selectedLabel}
                    disabled={disabled || status === 'saving' || status === 'saved'}
                    onChange={(event) => setSelectedLabel(event.target.value)}
                    className="min-h-[44px] w-full rounded-md border border-[hsl(0_0%_100%_/_0.12)] bg-[hsl(0_0%_9%)] px-3 text-sm text-[hsl(0_0%_94%)] focus:border-accent/60 focus:outline-none"
                >
                    {labels.map((label) => (
                        <option key={label} value={label}>{formatClinicalLabel(label)}</option>
                    ))}
                    <option value={OTHER_VALUE}>Other diagnosis...</option>
                </select>
            </div>

            {selectedLabel === OTHER_VALUE ? (
                <div className="mt-3">
                    <label className="mb-2 block text-sm text-[hsl(0_0%_70%)]">Actual diagnosis</label>
                    <input
                        value={customLabel}
                        disabled={disabled || status === 'saving' || status === 'saved'}
                        onChange={(event) => setCustomLabel(event.target.value)}
                        placeholder="Enter confirmed diagnosis"
                        className="min-h-[44px] w-full rounded-md border border-[hsl(0_0%_100%_/_0.12)] bg-[hsl(0_0%_9%)] px-3 text-sm text-[hsl(0_0%_94%)] focus:border-accent/60 focus:outline-none"
                    />
                </div>
            ) : null}

            {!compact ? (
                <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
                    <div>
                        <label className="mb-2 block text-sm text-[hsl(0_0%_70%)]">Confirmation method</label>
                        <select
                            value={diagnosisMethod}
                            disabled={disabled || status === 'saving' || status === 'saved'}
                            onChange={(event) => setDiagnosisMethod(event.target.value as typeof diagnosisMethod)}
                            className="min-h-[44px] w-full rounded-md border border-[hsl(0_0%_100%_/_0.12)] bg-[hsl(0_0%_9%)] px-3 text-sm text-[hsl(0_0%_94%)] focus:border-accent/60 focus:outline-none"
                        >
                            {DIAGNOSIS_METHODS.map((method) => (
                                <option key={method.value} value={method.value}>{method.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="mb-2 block text-sm text-[hsl(0_0%_70%)]">Clinician notes optional</label>
                        <input
                            value={notes}
                            disabled={disabled || status === 'saving' || status === 'saved'}
                            onChange={(event) => setNotes(event.target.value)}
                            placeholder="e.g. ELISA positive, recovered after supportive care"
                            className="min-h-[44px] w-full rounded-md border border-[hsl(0_0%_100%_/_0.12)] bg-[hsl(0_0%_9%)] px-3 text-sm text-[hsl(0_0%_94%)] focus:border-accent/60 focus:outline-none"
                        />
                    </div>
                </div>
            ) : null}

            {status === 'saved' ? (
                <div className="mt-4 flex gap-3 rounded-md border border-accent/35 bg-accent/10 p-3 text-sm text-accent">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Confirmed. This case is now helping improve future diagnoses.</span>
                </div>
            ) : null}

            {status === 'error' && error ? (
                <div className="mt-4 rounded-md border border-destructive/45 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                </div>
            ) : null}

            <button
                type="button"
                title={disabled ? 'Sign in to confirm' : undefined}
                disabled={disabled || !actualLabel || status === 'saving' || status === 'saved'}
                onClick={confirmOutcome}
                className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-4 text-sm font-medium text-accent transition hover:bg-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-45"
            >
                <ClipboardCheck className="h-4 w-4" />
                {status === 'saving' ? 'Saving...' : status === 'error' ? 'Retry' : 'Confirm diagnosis'}
            </button>
        </section>
    );
}

function readPlainError(body: unknown): string {
    if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        const raw = record.detail ?? record.error;
        if (typeof raw === 'string' && raw.includes('403')) return "You don't have access to this. Contact support.";
    }
    return 'Something went wrong. Please try again.';
}
