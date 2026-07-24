'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, ClipboardCheck, GitBranch, ShieldCheck, Sparkles } from 'lucide-react';
import { DiagnosisResultCard } from './DiagnosisResultCard';
import type { ClinicalDiagnosisResult } from './clinicalTypes';

type DemoStatus = 'idle' | 'running' | 'complete';

interface DemoCaseDefinition {
    id: string;
    title: string;
    summary: string;
    patient: Array<{ label: string; value: string }>;
    result: ClinicalDiagnosisResult;
    graphPriors: Array<{ label: string; value: string }>;
    trace: Array<{ label: string; value: string }>;
    outcome: string;
}

const DEMO_CASES: DemoCaseDefinition[] = [
    {
        id: 'canine-gastro',
        title: 'Acute gastroenteritis risk',
        summary: 'Young canine patient with vomiting, lethargy, reduced appetite, low WBC, low PCV, and dehydration.',
        patient: [
            { label: 'Species', value: 'Canine' },
            { label: 'Breed', value: 'Mixed breed' },
            { label: 'Age', value: '3 years' },
            { label: 'Sex', value: 'Male uncastrated' },
            { label: 'Symptoms', value: 'Vomiting for 2 days, lethargy, reduced appetite' },
            { label: 'Labs', value: 'WBC 4.1, PCV 29, hydration low' },
        ],
        result: {
            inference_event_id: 'demo-canine-gastro-4xk3',
            differentials: [
                { label: 'canine_parvovirus', probability: 0.82, urgency: 'high' },
                { label: 'hemorrhagic_gastroenteritis', probability: 0.41, urgency: 'medium' },
                { label: 'ehrlichiosis', probability: 0.17, urgency: 'medium' },
            ],
            confidence: 0.82,
            recommended_tests: ['parvovirus_elisa', 'cbc', 'biochemistry_panel', 'fecal_float'],
            reliability_note: 'High confidence, but confirm with parvovirus ELISA before definitive treatment decisions.',
            cire: {
                phi_hat: 0.84,
                cps: 0.18,
                safety_state: 'review_required',
                calibration_band: 'high-confidence-demo',
            },
            is_demo: true,
        },
        graphPriors: [
            { label: 'Matched symptoms', value: '4 / 5' },
            { label: 'Graph support', value: 'strong canine GI cluster' },
            { label: 'Outcome loop', value: 'demo only' },
        ],
        trace: [
            { label: 'Input normalized', value: 'species, signs, labs, duration' },
            { label: 'Graph priors applied', value: 'disease-symptom edges' },
            { label: 'Reliability scored', value: 'CIRE phi_hat 0.84' },
        ],
        outcome: 'In production, confirming or rejecting the diagnosis closes the learning loop for future cases.',
    },
    {
        id: 'feline-renal',
        title: 'Chronic renal pattern',
        summary: 'Older feline patient with weight loss, increased thirst, poor appetite, and elevated renal markers.',
        patient: [
            { label: 'Species', value: 'Feline' },
            { label: 'Breed', value: 'Domestic shorthair' },
            { label: 'Age', value: '11 years' },
            { label: 'Sex', value: 'Female spayed' },
            { label: 'Symptoms', value: 'Weight loss, polydipsia, reduced appetite' },
            { label: 'Labs', value: 'Creatinine 2.6, BUN 46, USG 1.018' },
        ],
        result: {
            inference_event_id: 'demo-feline-renal-92hd',
            differentials: [
                { label: 'chronic_kidney_disease', probability: 0.76, urgency: 'medium' },
                { label: 'hyperthyroidism', probability: 0.39, urgency: 'medium' },
                { label: 'diabetes_mellitus', probability: 0.21, urgency: 'medium' },
            ],
            confidence: 0.76,
            recommended_tests: ['urinalysis', 'sdma', 'blood_pressure', 'total_t4'],
            reliability_note: 'Moderate-high confidence. Stage renal disease only after repeat renal panel and urinalysis.',
            cire: {
                phi_hat: 0.78,
                cps: 0.24,
                safety_state: 'clinician_review',
                calibration_band: 'moderate-confidence-demo',
            },
            is_demo: true,
        },
        graphPriors: [
            { label: 'Matched symptoms', value: '5 / 6' },
            { label: 'Graph support', value: 'renal-endocrine overlap' },
            { label: 'Outcome loop', value: 'demo only' },
        ],
        trace: [
            { label: 'Input normalized', value: 'signalment, labs, signs' },
            { label: 'Graph priors applied', value: 'renal and endocrine edges' },
            { label: 'Reliability scored', value: 'CIRE phi_hat 0.78' },
        ],
        outcome: 'Real VetIOS deployments use confirmed outcomes to calibrate disease ranking over time.',
    },
    {
        id: 'bovine-respiratory',
        title: 'Respiratory herd signal',
        summary: 'Bovine patient with fever, cough, nasal discharge, depression, and recent transport stress.',
        patient: [
            { label: 'Species', value: 'Bovine' },
            { label: 'Production class', value: 'Feedlot calf' },
            { label: 'Age', value: '8 months' },
            { label: 'Risk context', value: 'Recent transport and commingling' },
            { label: 'Symptoms', value: 'Fever, cough, nasal discharge, depression' },
            { label: 'Vitals', value: 'Temperature 40.3 C, respiratory rate 52' },
        ],
        result: {
            inference_event_id: 'demo-bovine-resp-7mqa',
            differentials: [
                { label: 'bovine_respiratory_disease_complex', probability: 0.79, urgency: 'high' },
                { label: 'mannheimia_haemolytica_pneumonia', probability: 0.52, urgency: 'high' },
                { label: 'infectious_bovine_rhinotracheitis', probability: 0.26, urgency: 'medium' },
            ],
            confidence: 0.79,
            recommended_tests: ['thoracic_ultrasound', 'nasal_swab_pcr', 'culture_sensitivity', 'herd_temperature_screen'],
            reliability_note: 'High-risk respiratory pattern. Confirm pathogen and sensitivity before broad treatment changes.',
            cire: {
                phi_hat: 0.81,
                cps: 0.21,
                safety_state: 'review_required',
                calibration_band: 'population-signal-demo',
            },
            is_demo: true,
        },
        graphPriors: [
            { label: 'Matched signs', value: '6 / 7' },
            { label: 'Graph support', value: 'respiratory population cluster' },
            { label: 'Outcome loop', value: 'demo only' },
        ],
        trace: [
            { label: 'Input normalized', value: 'signs, vitals, herd context' },
            { label: 'Graph priors applied', value: 'respiratory and AMR edges' },
            { label: 'Reliability scored', value: 'CIRE phi_hat 0.81' },
        ],
        outcome: 'Production cases can feed population surveillance and AMR signal workflows when operators consent.',
    },
];

export function DemoCase() {
    const [selectedCaseId, setSelectedCaseId] = useState(DEMO_CASES[0].id);
    const [status, setStatus] = useState<DemoStatus>('idle');
    const selectedCase = useMemo(
        () => DEMO_CASES.find((demoCase) => demoCase.id === selectedCaseId) ?? DEMO_CASES[0],
        [selectedCaseId],
    );

    useEffect(() => {
        if (status !== 'running') {
            return;
        }
        const timer = window.setTimeout(() => setStatus('complete'), 850);
        return () => window.clearTimeout(timer);
    }, [status, selectedCaseId]);

    function selectCase(caseId: string) {
        setSelectedCaseId(caseId);
        setStatus('idle');
    }

    function runDemo() {
        setStatus('running');
    }

    return (
        <div className="min-h-screen bg-[#070A0D] px-4 py-8 text-white sm:px-6 lg:px-8">
            <div className="mx-auto max-w-6xl">
                <header className="flex items-center justify-between gap-4">
                    <Link href="/" className="font-mono text-sm font-semibold tracking-[0.14em] text-accent">VETIOS</Link>
                    <nav className="flex items-center gap-4 text-sm">
                        <Link href="/about" className="hidden text-white/60 transition hover:text-white sm:inline">About</Link>
                        <Link href="/login" className="text-white/70 transition hover:text-white">Sign in</Link>
                    </nav>
                </header>

                <main className="mt-10 grid gap-6 lg:grid-cols-[0.88fr_1.12fr]">
                    <section className="space-y-4">
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
                            <div className="text-xs uppercase tracking-[0.18em] text-accent">Public demo</div>
                            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Try a VetIOS demo case.</h1>
                            <p className="mt-3 text-sm leading-6 text-white/62">
                                Run representative veterinary cases through a deterministic demo of the VetIOS flow:
                                structured input, graph priors, ranked differentials, runtime integrity signals, and outcome learning.
                            </p>
                            <div className="mt-5 rounded-md border border-accent/25 bg-accent/10 p-3 text-sm text-accent">
                                Demo data stays in the browser. No patient data is sent or saved.
                            </div>
                        </div>

                        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                            <div className="mb-3 text-xs uppercase tracking-[0.18em] text-white/42">Choose case</div>
                            <div className="grid gap-2">
                                {DEMO_CASES.map((demoCase) => (
                                    <button
                                        key={demoCase.id}
                                        type="button"
                                        onClick={() => selectCase(demoCase.id)}
                                        className={`rounded-md border p-3 text-left transition ${
                                            demoCase.id === selectedCase.id
                                                ? 'border-accent/60 bg-accent/10'
                                                : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                                        }`}
                                    >
                                        <div className="text-sm font-medium text-white">{demoCase.title}</div>
                                        <div className="mt-1 text-xs leading-5 text-white/52">{demoCase.summary}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
                            <div className="text-xs uppercase tracking-[0.18em] text-white/42">Case input</div>
                            <div className="mt-5 space-y-3 text-sm text-white/76">
                                {selectedCase.patient.map((row) => (
                                    <Row key={row.label} label={row.label} value={row.value} />
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={runDemo}
                                disabled={status === 'running'}
                                className="mt-6 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-md border border-accent/65 bg-accent/10 px-5 text-sm font-medium text-accent transition hover:bg-accent hover:text-black disabled:cursor-wait disabled:opacity-70"
                            >
                                {status === 'running' ? (
                                    <>
                                        <Sparkles className="h-4 w-4 animate-pulse" />
                                        Running VetIOS demo
                                    </>
                                ) : (
                                    <>
                                        Run demo diagnosis
                                        <ArrowRight className="h-4 w-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    </section>

                    <section className="space-y-4" aria-live="polite">
                        {status === 'idle' ? (
                            <EmptyState />
                        ) : status === 'running' ? (
                            <RunningState trace={selectedCase.trace} />
                        ) : (
                            <>
                                <div className="rounded-md border border-accent/35 bg-accent/10 p-3 text-sm text-accent">
                                    Representative demo complete. Sign in to run real cases and persist outcomes.
                                </div>
                                <DiagnosisResultCard result={selectedCase.result} mode="clinician" />
                                <SignalGrid graphPriors={selectedCase.graphPriors} trace={selectedCase.trace} />
                                <OutcomePanel outcome={selectedCase.outcome} />
                            </>
                        )}
                    </section>
                </main>
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="flex min-h-[440px] items-center justify-center rounded-lg border border-dashed border-white/12 bg-white/[0.02] p-8 text-center">
            <div>
                <Activity className="mx-auto h-8 w-8 text-accent" />
                <h2 className="mt-4 text-xl font-semibold text-white">Ready to rank a case.</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-white/60">
                    Select a case and run the demo to see ranked diagnoses, next tests, graph support, and runtime integrity signals.
                </p>
            </div>
        </div>
    );
}

function RunningState({ trace }: { trace: DemoCaseDefinition['trace'] }) {
    return (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center gap-3 text-accent">
                <Sparkles className="h-5 w-5 animate-pulse" />
                <span className="text-sm font-medium">VetIOS is processing the demo case</span>
            </div>
            <div className="mt-6 space-y-3">
                {trace.map((item) => (
                    <div key={item.label} className="flex gap-3 rounded-md border border-white/8 bg-black/20 p-3 text-sm">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                        <div>
                            <div className="font-medium text-white">{item.label}</div>
                            <div className="mt-1 text-white/52">{item.value}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SignalGrid({
    graphPriors,
    trace,
}: {
    graphPriors: DemoCaseDefinition['graphPriors'];
    trace: DemoCaseDefinition['trace'];
}) {
    return (
        <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <GitBranch className="h-4 w-4 text-accent" />
                    Graph priors
                </div>
                <div className="mt-4 space-y-3">
                    {graphPriors.map((item) => (
                        <Metric key={item.label} label={item.label} value={item.value} />
                    ))}
                </div>
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <ShieldCheck className="h-4 w-4 text-accent" />
                    Runtime trace
                </div>
                <div className="mt-4 space-y-3">
                    {trace.map((item) => (
                        <Metric key={item.label} label={item.label} value={item.value} />
                    ))}
                </div>
            </section>
        </div>
    );
}

function OutcomePanel({ outcome }: { outcome: string }) {
    return (
        <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ClipboardCheck className="h-4 w-4 text-accent" />
                Outcome learning
            </div>
            <p className="mt-3 text-sm leading-6 text-white/62">{outcome}</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Link
                    href="/signup"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-black transition hover:bg-accent/90"
                >
                    Create account
                    <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                    href="/docs"
                    className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-white/12 px-4 text-sm text-white/78 transition hover:border-white/24 hover:text-white"
                >
                    Read docs
                </Link>
            </div>
        </section>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border border-white/8 bg-black/20 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-white/38">{label}</div>
            <div className="mt-1 text-sm text-white/78">{value}</div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-b border-white/8 pb-3 last:border-b-0">
            <div className="text-xs uppercase tracking-[0.16em] text-white/42">{label}</div>
            <div className="mt-1 text-white/86">{value}</div>
        </div>
    );
}
