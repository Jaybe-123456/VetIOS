'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseDetail } from '@/lib/cases/caseWorkflow';
import { OutcomeConfirmButton } from './OutcomeConfirmButton';
import { MultimodalEvidenceLedger } from './MultimodalEvidenceLedger';
import { ModelTrustPanel } from './ModelTrustPanel';
import { PatientTimelinePanel } from './PatientTimelinePanel';
import { formatCaseNumber, formatClinicalLabel, formatPercent, type ClinicalDiagnosisResult, type ClinicalUrgency } from './clinicalTypes';
import { generateSOAP } from '@/lib/generateSOAP';

export function ClinicalCaseDetailClient({ clinicalCase }: { clinicalCase: CaseDetail }) {
    const router = useRouter();
    const result = buildResult(clinicalCase);
    const isClosed = Boolean(clinicalCase.confirmed_diagnosis) || clinicalCase.case_status === 'closed';
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
    const soapNote = useMemo(() => {
        if (!result) return '';
        const cire = asRecord(result.cire);
        return generateSOAP({
            inference_event_id: result.inference_event_id,
            differentials: result.differentials,
            confidence: result.confidence,
            recommended_tests: result.recommended_tests,
            cire: {
                phi_hat: readNumber(cire.phi_hat) ?? undefined,
                cps: readNumber(cire.cps) ?? undefined,
                safety_state: readText(cire.safety_state) ?? undefined,
            },
        }, {
            species: clinicalCase.species_display ?? clinicalCase.species_canonical,
            breed: clinicalCase.breed,
            age_years: clinicalCase.age_years,
            weight_kg: clinicalCase.weight_kg,
            sex: clinicalCase.sex,
            presenting_complaint: clinicalCase.presenting_complaint,
            symptoms: clinicalCase.symptoms_normalized,
            duration_text: clinicalCase.duration_text,
            severity: readText(clinicalCase.patient_metadata.severity),
            history: clinicalCase.history,
            vitals: clinicalCase.vitals,
            physical_exam: clinicalCase.physical_exam,
            labs: clinicalCase.labs,
            voice_context: asRecord(clinicalCase.patient_metadata.voice_context),
        });
    }, [clinicalCase, result]);

    async function copySoapNote() {
        if (!soapNote) return;
        try {
            await navigator.clipboard.writeText(soapNote);
            setCopyStatus('copied');
            window.setTimeout(() => setCopyStatus('idle'), 2000);
        } catch {
            setCopyStatus('error');
            window.setTimeout(() => setCopyStatus('idle'), 2000);
        }
    }

    function downloadSoapNote() {
        if (!soapNote) return;
        const blob = new Blob([soapNote], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `vetios-soap-${formatCaseNumber(result?.inference_event_id ?? clinicalCase.id).replace(/[^a-zA-Z0-9-]/g, '')}.txt`;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    return (
        <main className="mx-auto max-w-5xl space-y-8">
            <Link href="/cases" className="inline-flex text-sm text-white/62 transition hover:text-accent">
                Back to cases
            </Link>

            <header className="space-y-3 border-b border-white/10 pb-5">
                <div className="flex flex-col gap-2 text-sm text-white/64 md:flex-row md:items-center md:justify-between">
                    <div className="font-mono text-accent">{formatCaseNumber(result?.inference_event_id ?? clinicalCase.id)}</div>
                    <div>{formatPatientMeta(clinicalCase)}</div>
                    <div>{formatDate(clinicalCase.created_at)}</div>
                    <div className={isClosed ? 'text-accent' : 'text-white/62'}>
                        {isClosed ? 'Confirmed' : 'Pending'}
                    </div>
                </div>
                <h1 className="text-2xl font-semibold text-white">
                    {clinicalCase.patient_name ?? 'Clinical case'}
                </h1>
            </header>

            {result ? (
                <>
                    <ClinicalSection title="Diagnosis">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[680px] border-collapse text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.14em] text-white/46">
                                        <th className="w-16 py-3 font-medium">Rank</th>
                                        <th className="py-3 font-medium">Diagnosis</th>
                                        <th className="w-36 py-3 font-medium">Probability</th>
                                        <th className="w-28 py-3 font-medium">Urgency</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.differentials.map((entry, index) => (
                                        <tr key={`${entry.label}-${index}`} className="border-b border-white/6">
                                            <td className="py-3 font-mono text-white/54">{String(index + 1).padStart(2, '0')}</td>
                                            <td className="py-3 font-medium text-white">{formatClinicalLabel(entry.label)}</td>
                                            <td className="py-3 font-mono text-accent">{formatPercent(entry.probability)}</td>
                                            <td className="py-3">
                                                <UrgencyLabel value={entry.urgency} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </ClinicalSection>

                    <ClinicalSection title="Recommended Tests">
                        {result.recommended_tests.length > 0 ? (
                            <ul className="space-y-3 text-sm text-white/76">
                                {result.recommended_tests.map((test, index) => (
                                    <li key={`${test}-${index}`} className="flex gap-3">
                                        <span className="text-white/44">[ ]</span>
                                        <span>{formatClinicalLabel(test)}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-white/58">No confirmatory tests were returned for this inference. Review the case manually before treatment.</p>
                        )}
                    </ClinicalSection>

                    <ClinicalSection title="Reliability">
                        <div className="space-y-2 text-sm leading-6 text-white/74">
                            <p>
                                {formatConfidenceBand(result.confidence)} confidence - Reliability score {formatReliabilityScore(result)}
                            </p>
                            <p className="text-accent">
                                Action: {buildActionSentence(result)}
                            </p>
                        </div>
                    </ClinicalSection>

                    <ClinicalSection title="Patient Timeline">
                        <PatientTimelinePanel clinicalCase={clinicalCase} />
                    </ClinicalSection>

                    <ClinicalSection title="Model Trust">
                        <ModelTrustPanel clinicalCase={clinicalCase} result={result} />
                    </ClinicalSection>

                    <ClinicalSection title="Multimodal Evidence">
                        <MultimodalEvidenceLedger clinicalCase={clinicalCase} />
                    </ClinicalSection>

                    <ClinicalSection title="Confirm Outcome">
                        {isClosed ? (
                            <div className="rounded-md border border-accent/35 bg-accent/10 p-4 text-sm text-accent">
                                Confirmed diagnosis: {formatClinicalLabel(clinicalCase.confirmed_diagnosis ?? 'Recorded')}
                            </div>
                        ) : (
                            <OutcomeConfirmButton
                                inferenceEventId={result.inference_event_id}
                                suggestedLabel={result.differentials[0]?.label ?? ''}
                                options={result.differentials.map((entry) => entry.label)}
                                onConfirmed={() => router.refresh()}
                            />
                        )}
                    </ClinicalSection>

                    <ClinicalSection title="SOAP Note">
                        <div className="mb-3 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={copySoapNote}
                                className="min-h-[40px] rounded-md border border-accent/55 bg-accent/10 px-3 text-sm text-accent transition hover:bg-accent hover:text-black"
                            >
                                {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy'}
                            </button>
                            <button
                                type="button"
                                onClick={downloadSoapNote}
                                className="min-h-[40px] rounded-md border border-white/15 bg-white/[0.03] px-3 text-sm text-white/78 transition hover:border-white/35"
                            >
                                Download .txt
                            </button>
                        </div>
                        <pre className="max-h-[520px] overflow-auto rounded-md border border-white/8 bg-black/25 p-4 whitespace-pre-wrap text-xs leading-6 text-white/76">
                            {soapNote}
                        </pre>
                    </ClinicalSection>
                </>
            ) : (
                <ClinicalSection title="Diagnosis">
                    <p className="text-sm text-white/62">Diagnosis results are not ready for this case yet.</p>
                </ClinicalSection>
            )}
        </main>
    );
}

function ClinicalSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-4">
            <div className="flex items-center gap-3">
                <h2 className="shrink-0 font-mono text-sm uppercase tracking-[0.18em] text-white">{title}</h2>
                <div className="h-px flex-1 bg-white/12" />
            </div>
            {children}
        </section>
    );
}

function buildResult(clinicalCase: CaseDetail): ClinicalDiagnosisResult | null {
    const inference = clinicalCase.latest_inference;
    const inferenceId = clinicalCase.latest_inference_event_id ?? readText(inference?.id);
    if (!inference || !inferenceId) return null;
    const output = asRecord(inference.output_payload);
    const diagnosis = asRecord(output.diagnosis);
    const rows = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : Array.isArray(output.differentials) ? output.differentials : [];
    const differentials = rows.map((entry) => mapDifferential(asRecord(entry))).filter(Boolean) as ClinicalDiagnosisResult['differentials'];
    const confidence = readNumber(output.confidence_score) ?? readNumber(inference.confidence_score) ?? differentials[0]?.probability ?? 0;
    return {
        inference_event_id: inferenceId,
        differentials,
        confidence,
        recommended_tests: collectRecommendedTests(rows, output),
        reliability_note: buildReliabilityNote(confidence, output, differentials.length),
        cire: asRecord(output.cire),
        raw: inference,
    };
}

function formatPatientMeta(clinicalCase: CaseDetail): string {
    return [
        clinicalCase.species_display ?? clinicalCase.species_canonical ?? 'Species pending',
        clinicalCase.breed,
        clinicalCase.age_years == null ? null : `${clinicalCase.age_years}y`,
        clinicalCase.sex ? formatClinicalLabel(clinicalCase.sex) : null,
    ].filter(Boolean).join(' - ');
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function UrgencyLabel({ value }: { value: ClinicalUrgency }) {
    if (value === 'high') return <span className="text-red-300">HIGH</span>;
    if (value === 'medium') return <span className="text-amber-200">MED</span>;
    return <span className="text-white/60">LOW</span>;
}

function formatConfidenceBand(value: number): string {
    if (value >= 0.75) return 'High';
    if (value >= 0.5) return 'Moderate';
    return 'Low';
}

function formatReliabilityScore(result: ClinicalDiagnosisResult): string {
    const cire = asRecord(result.cire);
    const score = readNumber(cire.phi_hat) ?? result.confidence;
    return score.toFixed(2);
}

function buildActionSentence(result: ClinicalDiagnosisResult): string {
    const top = result.differentials[0];
    const firstTest = result.recommended_tests[0];
    if (!top) return 'Review manually; no ranked differential was returned.';
    if (result.confidence >= 0.75) {
        return firstTest
            ? `Act on the top differential. Run ${formatClinicalLabel(firstTest)} before initiating treatment.`
            : 'Act on the top differential, but document confirmatory evidence before initiating treatment.';
    }
    return firstTest
        ? `Do not close the case yet. Run ${formatClinicalLabel(firstTest)} to reduce uncertainty.`
        : 'Do not close the case yet. Add confirmatory diagnostics to reduce uncertainty.';
}

function buildReliabilityNote(confidence: number, output: Record<string, unknown>, candidateCount: number): string {
    const reliability = asRecord(output.reliability_breakdown);
    const cire = asRecord(output.cire);
    const phi = readNumber(reliability.composite_reliability_score) ?? readNumber(cire.phi_hat) ?? confidence;
    const label = phi >= 0.75 ? 'High reliability' : phi >= 0.5 ? 'Moderate reliability' : 'Low reliability';
    return `${label}. ${Math.round(confidence * 100)}% is the top differential score across ${candidateCount} ranked candidate${candidateCount === 1 ? '' : 's'}; use recommended tests to narrow uncertainty before treatment.`;
}

function mapDifferential(entry: Record<string, unknown>) {
    const label = readText(entry.condition) ?? readText(entry.name) ?? readText(entry.label);
    const probability = readNumber(entry.probability) ?? readNumber(entry.p) ?? readNumber(entry.confidence) ?? 0;
    if (!label) return null;
    return { label, probability, urgency: mapUrgency(readText(entry.clinical_urgency)) };
}

function collectRecommendedTests(rows: unknown[], output: Record<string, unknown>): string[] {
    const tests = new Set<string>();
    for (const row of rows) {
        const record = asRecord(row);
        for (const value of readArray(record.recommended_confirmatory_tests)) tests.add(value);
        for (const value of readEvidenceArray(record.missing_evidence)) tests.add(value);
        const groundTruth = asRecord(record.ground_truth_explanation);
        for (const value of readArray(groundTruth.missing_criteria)) tests.add(value);
    }
    const summary = asRecord(output.ground_truth_summary);
    for (const value of readArray(summary.missing_confirmatory_tests)) tests.add(value);
    for (const value of readArray(output.recommended_tests)) tests.add(value);
    return Array.from(tests).slice(0, 6);
}

function mapUrgency(value: string | null): ClinicalUrgency {
    if (value === 'immediate' || value === 'urgent' || value === 'high') return 'high';
    if (value === 'review' || value === 'medium') return 'medium';
    return 'low';
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function readEvidenceArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => {
            if (typeof entry === 'string') return entry;
            const record = asRecord(entry);
            return readText(record.finding) ?? readText(record.label) ?? readText(record.test);
        })
        .filter((entry): entry is string => Boolean(entry));
}
