'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import type { CaseDetail } from '@/lib/cases/caseWorkflow';
import { ConsoleCard, DataRow, TerminalButton, TerminalInput, TerminalLabel, TerminalTextarea } from '@/components/ui/terminal';

export function CaseDetailClient({ clinicalCase }: { clinicalCase: CaseDetail }) {
    const router = useRouter();
    const differentials = useMemo(() => extractDifferentials(clinicalCase.latest_inference), [clinicalCase.latest_inference]);
    const [diagnosis, setDiagnosis] = useState(clinicalCase.confirmed_diagnosis ?? differentials[0]?.label ?? '');
    const [diagnosisMethod, setDiagnosisMethod] = useState('clinical');
    const [confidence, setConfidence] = useState('0.9');
    const [treatment, setTreatment] = useState('');
    const [notes, setNotes] = useState('');
    const [followup, setFollowup] = useState('');
    const [trainingConsent, setTrainingConsent] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<Record<string, unknown> | null>(null);

    async function submitOutcome(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!clinicalCase.latest_inference_event_id) {
            setError('This case has no linked inference event.');
            return;
        }

        setSubmitting(true);
        setError(null);
        setResult(null);

        const payload = {
            inference_event_id: clinicalCase.latest_inference_event_id,
            outcome: {
                type: 'diagnosis_confirmed',
                payload: {
                    label: diagnosis.trim(),
                    confidence: Number(confidence),
                    confirmed_diagnosis: diagnosis.trim(),
                    actual_diagnosis: diagnosis.trim(),
                    diagnosis_method: diagnosisMethod,
                    clinician_notes: notes.trim() || null,
                    treatment_initiated: splitList(treatment),
                    outcome_at_followup: followup.trim() || null,
                    clinical_case_id: clinicalCase.id,
                },
                timestamp: new Date().toISOString(),
            },
            learning_consent: {
                deidentified_training: trainingConsent,
                network_learning: false,
                consent_version: 'vetios_case_closure_v1',
            },
        };

        try {
            const response = await fetch('/api/outcome', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(body.detail ?? body.error ?? 'Outcome closure failed.');
            }
            setResult(body);
            router.refresh();
        } catch (closureError) {
            setError(closureError instanceof Error ? closureError.message : 'Outcome closure failed.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="flex flex-col gap-4">
                <ConsoleCard title="Encounter">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <DataRow label="Patient" value={clinicalCase.patient_name ?? 'Unnamed patient'} />
                        <DataRow label="Status" value={clinicalCase.case_status} tone={clinicalCase.case_status === 'closed' ? 'accent' : 'cyan'} />
                        <DataRow label="Species" value={clinicalCase.species_display ?? 'unknown'} />
                        <DataRow label="Breed" value={clinicalCase.breed ?? '-'} />
                        <DataRow label="Age" value={clinicalCase.age_years == null ? '-' : `${clinicalCase.age_years} years`} />
                        <DataRow label="Weight" value={clinicalCase.weight_kg == null ? '-' : `${clinicalCase.weight_kg} kg`} />
                        <DataRow label="Complaint" value={clinicalCase.presenting_complaint ?? '-'} />
                        <DataRow label="Duration" value={clinicalCase.duration_text ?? '-'} />
                    </div>
                    {clinicalCase.history && (
                        <div className="border-t border-[hsl(0_0%_100%_/_0.06)] pt-3 font-mono text-[13px] leading-relaxed text-[hsl(0_0%_82%)]">
                            {clinicalCase.history}
                        </div>
                    )}
                </ConsoleCard>

                <ConsoleCard title="Inference Differentials">
                    {differentials.length > 0 ? (
                        <div className="flex flex-col gap-3">
                            {differentials.map((entry, index) => (
                                <div key={`${entry.label}-${index}`} className="border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_100%_/_0.03)] p-3">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="font-mono text-[13px] uppercase tracking-[0.12em] text-[hsl(0_0%_92%)]">
                                            {index + 1}. {entry.label}
                                        </div>
                                        <div className="font-mono text-[13px] text-accent">{formatPercent(entry.confidence)}</div>
                                    </div>
                                    <div className="mt-2 h-2 bg-[hsl(0_0%_100%_/_0.08)]">
                                        <div className="h-full bg-accent" style={{ width: `${Math.round((entry.confidence ?? 0) * 100)}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <DataRow label="Differentials" value="No structured differentials were found for this case." tone="muted" />
                    )}
                </ConsoleCard>

                <ConsoleCard title="Clinical Evidence">
                    <StructuredTable title="Vitals" data={clinicalCase.vitals} />
                    <StructuredTable title="Physical Exam" data={clinicalCase.physical_exam} />
                    <StructuredTable title="Labs" data={clinicalCase.labs} />
                </ConsoleCard>
            </div>

            <div className="flex flex-col gap-4">
                <ConsoleCard title="Outcome Closure">
                    {clinicalCase.case_status === 'closed' ? (
                        <div className="flex items-start gap-3 border border-accent/35 bg-accent/10 p-3 text-[13px] text-[hsl(0_0%_86%)]">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                            <div>
                                <div className="font-mono uppercase tracking-[0.14em] text-accent">Closed</div>
                                <div className="mt-1">
                                    Confirmed diagnosis: {clinicalCase.confirmed_diagnosis ?? String(clinicalCase.diagnosis_records[0]?.confirmed_diagnosis ?? 'recorded')}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={submitOutcome} className="flex flex-col gap-4">
                            {!clinicalCase.latest_inference_event_id && (
                                <div className="flex gap-3 border border-[hsl(45_100%_55%_/_0.45)] bg-[hsl(45_100%_55%_/_0.08)] p-3 text-[13px] text-[hsl(45_100%_70%)]">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                    This case cannot close until an inference event is linked.
                                </div>
                            )}
                            <Field label="Confirmed Diagnosis">
                                <TerminalInput required value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} />
                            </Field>
                            <Field label="Diagnosis Method">
                                <select value={diagnosisMethod} onChange={(event) => setDiagnosisMethod(event.target.value)} className={selectClass()}>
                                    <option value="clinical">Clinical</option>
                                    <option value="lab_confirmed">Lab confirmed</option>
                                    <option value="imaging_confirmed">Imaging confirmed</option>
                                    <option value="pathology">Pathology</option>
                                    <option value="response_to_treatment">Response to treatment</option>
                                </select>
                            </Field>
                            <Field label="Clinician Confidence">
                                <TerminalInput type="number" min="0" max="1" step="0.05" value={confidence} onChange={(event) => setConfidence(event.target.value)} />
                            </Field>
                            <Field label="Treatment Initiated">
                                <TerminalTextarea value={treatment} onChange={(event) => setTreatment(event.target.value)} placeholder="maropitant, fluids, analgesia" />
                            </Field>
                            <Field label="Clinician Notes">
                                <TerminalTextarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                            </Field>
                            <Field label="Outcome At Follow-Up">
                                <TerminalInput value={followup} onChange={(event) => setFollowup(event.target.value)} />
                            </Field>
                            <label className="flex items-start gap-3 font-mono text-[12px] text-[hsl(0_0%_78%)]">
                                <input
                                    type="checkbox"
                                    checked={trainingConsent}
                                    onChange={(event) => setTrainingConsent(event.target.checked)}
                                    className="mt-0.5"
                                />
                                Use this de-identified outcome for VetIOS model calibration.
                            </label>
                            {error && <div className="border border-destructive/50 bg-destructive/10 p-3 font-mono text-[12px] text-destructive">{error}</div>}
                            {result && <div className="border border-accent/40 bg-accent/10 p-3 font-mono text-[12px] text-accent">Outcome saved. Calibration delta: {String(result.calibration_delta ?? 'recorded')}</div>}
                            <TerminalButton type="submit" disabled={submitting || !diagnosis.trim() || !clinicalCase.latest_inference_event_id}>
                                <ClipboardCheck className="mr-2 h-4 w-4" />
                                {submitting ? 'Closing...' : 'Close Case'}
                            </TerminalButton>
                        </form>
                    )}
                </ConsoleCard>

                <ConsoleCard title="Ground Truth Records">
                    {clinicalCase.diagnosis_records.length > 0 ? (
                        <div className="flex flex-col gap-3">
                            {clinicalCase.diagnosis_records.map((record) => (
                                <div key={String(record.id)} className="border border-[hsl(0_0%_100%_/_0.08)] p-3">
                                    <DataRow label="Diagnosis" value={String(record.confirmed_diagnosis ?? '-')} />
                                    <DataRow label="Method" value={String(record.diagnosis_method ?? '-')} />
                                    <DataRow label="Created" value={formatDate(String(record.created_at ?? ''))} />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <DataRow label="Records" value="No confirmed diagnosis record has been written yet." tone="muted" />
                    )}
                </ConsoleCard>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            {children}
        </div>
    );
}

function StructuredTable({ title, data }: { title: string; data: Record<string, unknown> }) {
    const entries = Object.entries(data).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');
    return (
        <div className="mb-4 last:mb-0">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[hsl(0_0%_62%)]">{title}</div>
            {entries.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {entries.map(([key, value]) => (
                        <DataRow key={key} label={labelize(key)} value={renderValue(value)} />
                    ))}
                </div>
            ) : (
                <DataRow label={title} value="No structured values recorded." tone="muted" />
            )}
        </div>
    );
}

function extractDifferentials(inference: Record<string, unknown> | null): Array<{ label: string; confidence: number | null }> {
    const output = asRecord(inference?.output_payload);
    const diagnosis = asRecord(output.diagnosis);
    const source = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : Array.isArray(output.differentials)
            ? output.differentials
            : [];

    return source.map((entry) => {
        const record = asRecord(entry);
        const label = readText(record.condition) ?? readText(record.name) ?? readText(record.label);
        const confidence = readNumber(record.probability) ?? readNumber(record.p) ?? readNumber(record.confidence_score);
        return label ? { label, confidence } : null;
    }).filter((entry): entry is { label: string; confidence: number | null } => Boolean(entry));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function renderValue(value: unknown): string {
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

function splitList(value: string): string[] {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function labelize(value: string): string {
    return value.replace(/_/g, ' ');
}

function formatPercent(value: number | null): string {
    return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-';
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function selectClass(): string {
    return 'h-[42px] w-full border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_8%)] px-3 font-mono text-[13px] text-[hsl(0_0%_94%)] focus:border-accent/60 focus:outline-none';
}
