'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseDetail } from '@/lib/cases/caseWorkflow';
import { OutcomeConfirmButton } from './OutcomeConfirmButton';
import { MultimodalEvidenceLedger } from './MultimodalEvidenceLedger';
import { ModelTrustPanel } from './ModelTrustPanel';
import { PatientTimelinePanel } from './PatientTimelinePanel';
import { formatCaseNumber, formatClinicalLabel, formatPercent, repairDisplayText, type ClinicalDiagnosisResult, type ClinicalUrgency } from './clinicalTypes';
import { generateSOAP } from '@/lib/generateSOAP';

export function ClinicalCaseDetailClient({ clinicalCase }: { clinicalCase: CaseDetail }) {
    const router = useRouter();
    const result = buildResult(clinicalCase);
    const isClosed = Boolean(clinicalCase.confirmed_diagnosis) || clinicalCase.case_status === 'closed';
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
    const reasoning = useMemo(() => result ? buildReasoningSummary(result) : null, [result]);
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

                    {reasoning ? (
                        <ClinicalSection title="Reasoning & Evidence">
                            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                                <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">Top reasoning path</div>
                                    <p className="mt-3 text-sm leading-6 text-white/76">
                                        {formatClinicalLabel(reasoning.topLabel)} leads at {formatPercent(reasoning.topProbability)}.
                                        {' '}
                                        {reasoning.confirmationStatus
                                            ? `Confirmation status: ${formatClinicalLabel(reasoning.confirmationStatus)}.`
                                            : 'Confirmation status has not been recorded yet.'}
                                    </p>

                                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                                        <ReasoningEvidenceList title="Supports" items={reasoning.supportingEvidence} tone="accent" />
                                        <ReasoningEvidenceList title="Missing" items={reasoning.missingEvidence} tone="warn" />
                                        <ReasoningEvidenceList title="Against" items={reasoning.contradictingEvidence} tone="muted" />
                                    </div>
                                </div>

                                <div className="rounded-md border border-accent/20 bg-accent/[0.04] p-4">
                                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">CIRE / phi interpretation</div>
                                    <div className="mt-3 grid grid-cols-3 gap-2">
                                        <ReasoningMetric label="Phi" value={reasoning.phi == null ? 'n/a' : reasoning.phi.toFixed(2)} tone={reasoning.phi != null && reasoning.phi >= 0.75 ? 'accent' : 'warn'} />
                                        <ReasoningMetric label="CPS" value={reasoning.cps == null ? 'n/a' : reasoning.cps.toFixed(2)} tone={reasoning.cps != null && reasoning.cps <= 0.25 ? 'accent' : 'warn'} />
                                        <ReasoningMetric label="Safety" value={formatClinicalLabel(reasoning.safetyState ?? 'unscored')} tone={reasoning.safetyState === 'nominal' ? 'accent' : 'warn'} />
                                    </div>
                                    <p className="mt-4 text-sm leading-6 text-white/74">{reasoning.interpretation}</p>

                                    {reasoning.reliabilityRows.length > 0 ? (
                                        <div className="mt-4 divide-y divide-white/8 border-t border-white/8 pt-2">
                                            {reasoning.reliabilityRows.map((row) => (
                                                <div key={row.label} className="flex items-center justify-between gap-3 py-2 text-sm">
                                                    <span className="text-white/48">{row.label}</span>
                                                    <span className={row.tone === 'accent' ? 'text-accent' : row.tone === 'warn' ? 'text-amber-200' : 'text-white/70'}>
                                                        {row.value}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </ClinicalSection>
                    ) : null}

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

type ClinicalReasoningSummary = {
    topLabel: string;
    topProbability: number;
    supportingEvidence: string[];
    missingEvidence: string[];
    contradictingEvidence: string[];
    confirmationStatus: string | null;
    phi: number | null;
    cps: number | null;
    safetyState: string | null;
    interpretation: string;
    reliabilityRows: Array<{ label: string; value: string; tone: 'accent' | 'warn' | 'muted' }>;
};

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

function ReasoningEvidenceList({
    title,
    items,
    tone,
}: {
    title: string;
    items: string[];
    tone: 'accent' | 'warn' | 'muted';
}) {
    const markerClass = tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-amber-200' : 'text-white/44';
    return (
        <div className="rounded-md border border-white/8 bg-black/15 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/44">{title}</div>
            {items.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm leading-5 text-white/72">
                    {items.map((item) => (
                        <li key={item} className="flex gap-2">
                            <span className={markerClass}>-</span>
                            <span>{formatEvidenceText(item)}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mt-2 text-sm leading-5 text-white/44">None captured</p>
            )}
        </div>
    );
}

function ReasoningMetric({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone: 'accent' | 'warn';
}) {
    return (
        <div className="rounded-md border border-white/8 bg-black/15 p-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/42">{label}</div>
            <div className={`mt-1 text-base font-semibold ${tone === 'accent' ? 'text-accent' : 'text-amber-200'}`}>{value}</div>
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
    const differentials = dedupeDifferentials(
        rows.map((entry) => mapDifferential(asRecord(entry))).filter(Boolean) as ClinicalDiagnosisResult['differentials'],
    );
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

function buildReasoningSummary(result: ClinicalDiagnosisResult): ClinicalReasoningSummary {
    const raw = asRecord(result.raw);
    const output = asRecord(raw.output_payload);
    const diagnosis = asRecord(output.diagnosis);
    const rows = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : Array.isArray(output.differentials) ? output.differentials : [];
    const top = result.differentials[0];
    const topRecord = findTopDifferentialRecord(rows, top?.label);
    const groundTruth = asRecord(topRecord.ground_truth_explanation);
    const reliability = asRecord(output.reliability_breakdown);
    const cire = { ...asRecord(output.cire), ...asRecord(raw.cire), ...asRecord(result.cire) };
    const phi = readNumber(reliability.composite_reliability_score)
        ?? readNumber(cire.phi_hat)
        ?? readNumber(raw.phi_hat)
        ?? result.confidence;
    const cps = readNumber(cire.cps);
    const safetyState = readText(cire.safety_state) ?? inferClinicalSafetyState(phi);
    const supportingEvidence = collectEvidenceList(
        readEvidenceArray(topRecord.supporting_evidence),
        readEvidenceArray(groundTruth.supporting_findings),
    );
    const missingEvidence = collectEvidenceList(
        readEvidenceArray(topRecord.missing_evidence),
        readArray(groundTruth.missing_criteria),
    );
    const contradictingEvidence = collectEvidenceList(
        readEvidenceArray(topRecord.contradicting_evidence),
        readEvidenceArray(groundTruth.contradicting_findings),
    );
    const reliabilityRows = [
        reliabilityRow('Input completeness', reliability.input_completeness),
        reliabilityRow('Evidence density', reliability.evidence_density),
        reliabilityRow('Diagnostic separation', reliability.diagnostic_separation),
        reliabilityRow('Ontology match', reliability.ontology_match),
        reliabilityRow('Contradiction burden', reliability.contradiction_burden),
        reliabilityRow('Composite reliability', reliability.composite_reliability_score),
    ].filter((row): row is ClinicalReasoningSummary['reliabilityRows'][number] => Boolean(row));

    return {
        topLabel: top?.label ?? readText(topRecord.condition) ?? readText(topRecord.label) ?? 'Undetermined',
        topProbability: top?.probability ?? readNumber(topRecord.probability) ?? result.confidence,
        supportingEvidence,
        missingEvidence,
        contradictingEvidence,
        confirmationStatus: readText(groundTruth.confirmation_status),
        phi,
        cps,
        safetyState,
        interpretation: buildCireInterpretation({
            phi,
            cps,
            safetyState,
            supportingEvidence,
            missingEvidence,
            contradictingEvidence,
        }),
        reliabilityRows,
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
    const label = cleanClinicalText(readText(entry.condition) ?? readText(entry.name) ?? readText(entry.label));
    const probability = readNumber(entry.probability) ?? readNumber(entry.p) ?? readNumber(entry.confidence) ?? 0;
    if (!label) return null;
    return { label, probability, urgency: mapUrgency(readText(entry.clinical_urgency)) };
}

function dedupeDifferentials(entries: ClinicalDiagnosisResult['differentials']): ClinicalDiagnosisResult['differentials'] {
    const byLabel = new Map<string, ClinicalDiagnosisResult['differentials'][number]>();
    for (const entry of entries) {
        const key = normalizeDiagnosisKey(entry.label);
        const existing = byLabel.get(key);
        if (!existing) {
            byLabel.set(key, entry);
            continue;
        }
        byLabel.set(key, {
            label: existing.label,
            probability: Math.max(existing.probability, entry.probability),
            urgency: mergeUrgency(existing.urgency, entry.urgency),
        });
    }
    return Array.from(byLabel.values()).sort((left, right) => right.probability - left.probability).slice(0, 8);
}

function collectRecommendedTests(rows: unknown[], output: Record<string, unknown>): string[] {
    const tests = new Set<string>();
    for (const row of rows) {
        const record = asRecord(row);
        for (const value of readArray(record.recommended_confirmatory_tests)) tests.add(cleanClinicalText(value) ?? value);
        for (const value of readEvidenceArray(record.missing_evidence)) tests.add(cleanClinicalText(value) ?? value);
        const groundTruth = asRecord(record.ground_truth_explanation);
        for (const value of readArray(groundTruth.missing_criteria)) tests.add(cleanClinicalText(value) ?? value);
    }
    const summary = asRecord(output.ground_truth_summary);
    for (const value of readArray(summary.missing_confirmatory_tests)) tests.add(cleanClinicalText(value) ?? value);
    for (const value of readArray(output.recommended_tests)) tests.add(cleanClinicalText(value) ?? value);
    return Array.from(tests).slice(0, 6);
}

function mapUrgency(value: string | null): ClinicalUrgency {
    if (value === 'immediate' || value === 'urgent' || value === 'high') return 'high';
    if (value === 'review' || value === 'medium') return 'medium';
    return 'low';
}

function mergeUrgency(left: ClinicalUrgency, right: ClinicalUrgency): ClinicalUrgency {
    const rank = { low: 0, medium: 1, high: 2 } satisfies Record<ClinicalUrgency, number>;
    return rank[right] > rank[left] ? right : left;
}

function normalizeDiagnosisKey(value: string): string {
    return repairDisplayText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanClinicalText(value: string | null): string | null {
    const repaired = value == null ? null : repairDisplayText(value).replace(/^Test:\s*/i, '').trim();
    return repaired && repaired.length > 0 ? repaired : null;
}

function findTopDifferentialRecord(rows: unknown[], label: string | null | undefined): Record<string, unknown> {
    const normalizedLabel = label ? normalizeDiagnosisKey(label) : null;
    const records = rows.map((entry) => asRecord(entry));
    if (normalizedLabel) {
        const match = records.find((entry) => {
            const candidate = readText(entry.condition) ?? readText(entry.name) ?? readText(entry.label);
            return candidate ? normalizeDiagnosisKey(candidate) === normalizedLabel : false;
        });
        if (match) return match;
    }
    return records[0] ?? {};
}

function collectEvidenceList(...groups: string[][]): string[] {
    const values = new Map<string, string>();
    for (const group of groups) {
        for (const value of group) {
            const cleaned = cleanClinicalText(value);
            if (!cleaned) continue;
            const key = normalizeDiagnosisKey(cleaned);
            if (!values.has(key)) values.set(key, cleaned);
        }
    }
    return Array.from(values.values()).slice(0, 6);
}

function reliabilityRow(label: string, value: unknown): ClinicalReasoningSummary['reliabilityRows'][number] | null {
    const score = readNumber(value);
    if (score == null) return null;
    return {
        label,
        value: formatPercent(score),
        tone: score >= 0.75 ? 'accent' : score >= 0.5 ? 'muted' : 'warn',
    };
}

function buildCireInterpretation(input: {
    phi: number | null;
    cps: number | null;
    safetyState: string | null;
    supportingEvidence: string[];
    missingEvidence: string[];
    contradictingEvidence: string[];
}): string {
    const phiText = input.phi == null
        ? 'CIRE phi has not been scored for this inference'
        : input.phi >= 0.75
            ? 'CIRE phi is high, meaning the differential distribution is concentrated and the inference is less entropic'
            : input.phi >= 0.5
                ? 'CIRE phi is moderate, meaning the case has useful signal but still needs clinician review'
                : 'CIRE phi is low, meaning the differential distribution or evidence quality is too weak for confident closure';
    const cpsText = input.cps == null
        ? 'collapse pressure is not recorded'
        : input.cps <= 0.25
            ? 'collapse pressure is low'
            : input.cps <= 0.5
                ? 'collapse pressure is moderate'
                : 'collapse pressure is elevated';
    const evidenceText = input.contradictingEvidence.length > 0
        ? 'Contradicting evidence is present, so this should remain in review until reconciled.'
        : input.missingEvidence.length > 0
            ? 'Missing confirmatory evidence should be collected before closing or treating the case as outcome-confirmed.'
            : input.supportingEvidence.length > 0
                ? 'Captured supporting evidence is present, but outcome confirmation is still needed for calibration.'
                : 'No structured evidence map was captured, so manual review is required.';
    return `${phiText}; ${cpsText}; safety state is ${formatClinicalLabel(input.safetyState ?? 'unscored')}. ${evidenceText}`;
}

function inferClinicalSafetyState(phi: number | null): string | null {
    if (phi == null) return null;
    if (phi >= 0.75) return 'nominal';
    if (phi >= 0.5) return 'review';
    return 'hold';
}

function formatEvidenceText(value: string): string {
    return formatClinicalLabel(value.replace(/[.:]+/g, ' '));
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
