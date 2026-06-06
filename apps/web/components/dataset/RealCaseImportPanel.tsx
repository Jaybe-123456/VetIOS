'use client';

import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, FileJson, RefreshCw, UploadCloud } from 'lucide-react';

interface RealCaseImportPanelProps {
    onImported: () => void;
}

interface RealCaseImportReport {
    dry_run: boolean;
    imported: Array<{
        source_case_reference: string;
        status: 'accepted' | 'validated';
        clinical_case_id: string | null;
        outcome_event_id: string | null;
        case_key: string;
        learning_ready: boolean;
    }>;
    rejected: Array<{
        source_case_reference: string | null;
        status: 'rejected';
        error_codes: string[];
        error_messages: string[];
    }>;
    summary: {
        total: number;
        accepted: number;
        rejected: number;
        learning_ready: number;
        consent_required_rejections: number;
        phi_rejections: number;
    };
}

interface ImportApiResponse {
    data?: RealCaseImportReport;
    error?: string;
    detail?: string;
    request_id?: string;
}

export function RealCaseImportPanel({ onImported }: RealCaseImportPanelProps) {
    const samplePayload = useMemo(() => JSON.stringify(buildSamplePayload(), null, 2), []);
    const [payloadText, setPayloadText] = useState(samplePayload);
    const [status, setStatus] = useState<'idle' | 'validating' | 'importing' | 'success' | 'error'>('idle');
    const [report, setReport] = useState<RealCaseImportReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isRefreshing, startRefresh] = useTransition();

    async function submitImport(dryRun: boolean) {
        setStatus(dryRun ? 'validating' : 'importing');
        setError(null);
        setReport(null);

        try {
            const parsed = parsePayload(payloadText, dryRun);
            const response = await fetch('/api/dataset/case-import', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(parsed),
            });
            const body = await response.json().catch(() => ({})) as ImportApiResponse;
            if (!response.ok && !body.data) {
                throw new Error(body.detail ?? body.error ?? 'Import request failed.');
            }

            if (!body.data) {
                throw new Error('Import completed without a report.');
            }

            setReport(body.data);
            setStatus('success');

            if (!dryRun && body.data.summary.accepted > 0) {
                startRefresh(() => onImported());
            }
        } catch (caught) {
            setStatus('error');
            setError(caught instanceof Error ? caught.message : 'Import failed.');
        }
    }

    return (
        <section className="border border-grid bg-black/20 p-4 font-mono">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-accent">
                        <UploadCloud className="h-3.5 w-3.5" />
                        Real case intake
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-foreground">Import de-identified confirmed cases</h2>
                    <p className="mt-2 text-sm leading-relaxed text-[hsl(0_0%_72%)]">
                        Paste exported clinic, PIMS, or lab-confirmed case JSON. VetIOS validates identifiers, consent, diagnosis labels, and required clinical fields before anything is stored.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setPayloadText(samplePayload);
                        setReport(null);
                        setError(null);
                        setStatus('idle');
                    }}
                    className="inline-flex min-h-[38px] items-center justify-center gap-2 border border-grid px-3 text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_78%)] transition hover:border-accent hover:text-accent"
                >
                    <FileJson className="h-3.5 w-3.5" />
                    Load template
                </button>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
                <label className="block">
                    <span className="mb-2 block text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_68%)]">
                        Import payload
                    </span>
                    <textarea
                        value={payloadText}
                        onChange={(event) => setPayloadText(event.target.value)}
                        spellCheck={false}
                        className="min-h-[360px] w-full resize-y border border-grid bg-[hsl(0_0%_5%)] p-3 text-xs leading-relaxed text-foreground outline-none focus:border-accent/60"
                    />
                </label>

                <div className="space-y-3">
                    <div className="border border-grid bg-background/40 p-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_68%)]">Required safeguards</div>
                        <ul className="mt-3 space-y-2 text-xs leading-relaxed text-[hsl(0_0%_76%)]">
                            <li>Patient and owner names must be removed.</li>
                            <li>Microchip IDs and owner contacts must be absent.</li>
                            <li>Each row needs a confirmed diagnosis.</li>
                            <li>De-identified learning consent must be present.</li>
                            <li>Dry-run validation should pass before import.</li>
                        </ul>
                    </div>

                    <div className="grid gap-2">
                        <button
                            type="button"
                            disabled={status === 'validating' || status === 'importing'}
                            onClick={() => submitImport(true)}
                            className="inline-flex min-h-[44px] items-center justify-center gap-2 border border-accent/55 bg-accent/10 px-4 text-sm font-semibold text-accent transition hover:bg-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {status === 'validating' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Validate dry run
                        </button>
                        <button
                            type="button"
                            disabled={status === 'validating' || status === 'importing'}
                            onClick={() => submitImport(false)}
                            className="inline-flex min-h-[44px] items-center justify-center gap-2 border border-grid px-4 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {status === 'importing' || isRefreshing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                            Import accepted cases
                        </button>
                    </div>

                    {error ? (
                        <div className="border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
                            {error}
                        </div>
                    ) : null}

                    {report ? <ImportReportCard report={report} /> : null}
                </div>
            </div>
        </section>
    );
}

function ImportReportCard({ report }: { report: RealCaseImportReport }) {
    return (
        <div className="border border-grid bg-background/40 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_68%)]">
                {report.dry_run ? 'Dry-run report' : 'Import report'}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniMetric label="Accepted" value={report.summary.accepted} tone="accent" />
                <MiniMetric label="Rejected" value={report.summary.rejected} tone={report.summary.rejected > 0 ? 'warn' : 'default'} />
                <MiniMetric label="Learning" value={report.summary.learning_ready} tone="accent" />
            </div>
            {report.rejected.length > 0 ? (
                <div className="mt-3 space-y-2">
                    {report.rejected.slice(0, 4).map((entry, index) => (
                        <div key={`${entry.source_case_reference ?? 'row'}-${index}`} className="border border-amber-300/25 bg-amber-300/10 p-2 text-xs leading-relaxed text-amber-100">
                            <div className="font-semibold">{entry.source_case_reference ?? `Row ${index + 1}`}</div>
                            <div>{entry.error_messages.join(' ')}</div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="mt-3 text-xs text-[hsl(0_0%_72%)]">
                    No rejected rows. This payload is ready for import.
                </div>
            )}
        </div>
    );
}

function MiniMetric({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'accent' | 'warn' }) {
    const toneClass = tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-amber-200' : 'text-foreground';
    return (
        <div className="border border-grid bg-black/20 p-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-[hsl(0_0%_62%)]">{label}</div>
            <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
        </div>
    );
}

function parsePayload(text: string, dryRun: boolean): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('Payload must be valid JSON.');
    }

    if (Array.isArray(parsed)) {
        return { dry_run: dryRun, cases: parsed };
    }

    if (!isRecord(parsed)) {
        throw new Error('Payload must be a JSON object or an array of case rows.');
    }

    const cases = parsed.cases;
    if (!Array.isArray(cases) || cases.length === 0) {
        throw new Error('Payload must include a non-empty cases array.');
    }

    return { ...parsed, dry_run: dryRun };
}

function buildSamplePayload() {
    return {
        dry_run: true,
        source_name: 'clinic_pims_export',
        cases: [
            {
                source_case_reference: `demo-case-${new Date().toISOString().slice(0, 10)}`,
                usage_class: 'credentialed_deidentified',
                deidentified: true,
                patient: {
                    species: 'canine',
                    breed: 'mixed breed',
                    age_years: 1.5,
                    weight_kg: 8.2,
                    sex: 'female',
                    deidentified_patient_ref: 'clinic-patient-001',
                },
                presenting_complaint: 'Acute vomiting, bloody diarrhea, anorexia, and lethargy',
                symptoms: ['vomiting', 'bloody diarrhea', 'lethargy', 'anorexia'],
                history: 'Unvaccinated juvenile dog from multi-dog household. No owner identifiers included.',
                physical_exam: {
                    hydration: 'moderate dehydration',
                    temperature_c: 39.5,
                    mentation: 'quiet but responsive',
                },
                labs: {
                    parvovirus_elisa: 'positive',
                    pcv_percent: 38,
                    wbc: 'low',
                },
                confirmed_diagnosis: 'canine_parvovirus',
                diagnosis_method: 'lab_confirmed',
                diagnosis_confidence: 0.98,
                primary_condition_class: 'Infectious',
                outcome_at_followup: 'Hospitalized with supportive care and improving at 48h recheck',
                learning_consent: {
                    deidentified_training: true,
                    consent_version: 'vetios_learning_consent_v1',
                },
                metadata: {
                    import_note: 'Template row. Replace with a real de-identified clinic export before importing.',
                },
            },
        ],
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
