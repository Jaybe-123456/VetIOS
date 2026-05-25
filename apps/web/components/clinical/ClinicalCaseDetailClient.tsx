'use client';

import { useRouter } from 'next/navigation';
import type { CaseDetail } from '@/lib/cases/caseWorkflow';
import { DiagnosisResultCard } from './DiagnosisResultCard';
import { OutcomeConfirmButton } from './OutcomeConfirmButton';
import { formatClinicalLabel, type ClinicalDiagnosisResult, type ClinicalUrgency } from './clinicalTypes';

export function ClinicalCaseDetailClient({ clinicalCase }: { clinicalCase: CaseDetail }) {
    const router = useRouter();
    const result = buildResult(clinicalCase);
    const isClosed = clinicalCase.case_status === 'closed';

    return (
        <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
                <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                    <h2 className="text-lg font-semibold text-white">Patient summary</h2>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <Field label="Patient" value={clinicalCase.patient_name ?? 'Unnamed patient'} />
                        <Field label="Species" value={clinicalCase.species_display ?? 'Unknown'} />
                        <Field label="Breed" value={clinicalCase.breed ?? 'Not recorded'} />
                        <Field label="Age" value={clinicalCase.age_years == null ? 'Not recorded' : `${clinicalCase.age_years} years`} />
                        <Field label="Sex" value={clinicalCase.sex ? formatClinicalLabel(clinicalCase.sex) : 'Not recorded'} />
                        <Field label="Reason for visit" value={clinicalCase.presenting_complaint ?? clinicalCase.symptom_summary ?? 'Not recorded'} />
                    </div>
                </section>

                {result ? (
                    <DiagnosisResultCard result={result} mode="clinician" />
                ) : (
                    <section className="rounded-lg border border-white/10 bg-white/[0.025] p-5 text-white/70">
                        Diagnosis results are not ready for this case yet.
                    </section>
                )}
            </div>

            <aside className="space-y-5">
                {isClosed ? (
                    <section className="rounded-lg border border-accent/35 bg-accent/10 p-4 text-sm text-accent">
                        Confirmed diagnosis: {formatClinicalLabel(clinicalCase.confirmed_diagnosis ?? 'Recorded')}
                    </section>
                ) : result ? (
                    <OutcomeConfirmButton
                        inferenceEventId={result.inference_event_id}
                        suggestedLabel={result.differentials[0]?.label ?? ''}
                        options={result.differentials.map((entry) => entry.label)}
                        onConfirmed={() => router.refresh()}
                    />
                ) : null}

                <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                    <h3 className="font-semibold text-white">Recommended next steps</h3>
                    <ul className="mt-3 space-y-2 text-sm text-white/72">
                        {(result?.recommended_tests.length ? result.recommended_tests : ['Review the case details', 'Add test results when available']).map((item) => (
                            <li key={item}>- {formatClinicalLabel(item)}</li>
                        ))}
                    </ul>
                </section>
            </aside>
        </div>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-white/8 bg-black/20 p-3">
            <div className="text-xs uppercase tracking-[0.14em] text-white/42">{label}</div>
            <div className="mt-1 text-sm text-white/86">{value}</div>
        </div>
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
        reliability_note: confidence >= 0.75
            ? 'High confidence. Confirm with the recommended tests before treatment.'
            : 'Review with additional testing before making treatment decisions.',
        cire: asRecord(output.cire),
        raw: inference,
    };
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
        const groundTruth = asRecord(record.ground_truth_explanation);
        for (const value of readArray(groundTruth.missing_criteria)) tests.add(value);
    }
    const summary = asRecord(output.ground_truth_summary);
    for (const value of readArray(summary.missing_confirmatory_tests)) tests.add(value);
    return Array.from(tests).slice(0, 5);
}

function mapUrgency(value: string | null): ClinicalUrgency {
    if (value === 'immediate' || value === 'urgent') return 'high';
    if (value === 'review') return 'medium';
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
