'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DiagnosisResultCard } from './DiagnosisResultCard';
import { OutcomeConfirmButton } from './OutcomeConfirmButton';
import type { ClinicalDiagnosisResult } from './clinicalTypes';

const DEMO_RESULT: ClinicalDiagnosisResult = {
    inference_event_id: 'demo-case-4xk3',
    differentials: [
        { label: 'Canine Parvovirus', probability: 0.82, urgency: 'high' },
        { label: 'Hemorrhagic Gastroenteritis', probability: 0.41, urgency: 'medium' },
        { label: 'Ehrlichiosis', probability: 0.17, urgency: 'medium' },
    ],
    confidence: 0.82,
    recommended_tests: ['Parvovirus ELISA', 'CBC', 'Biochemistry panel'],
    reliability_note: 'High confidence. Recommend parvovirus test before treatment.',
    is_demo: true,
};

export function DemoCase() {
    const [ranDemo, setRanDemo] = useState(false);

    return (
        <div className="min-h-screen bg-[#070A0D] px-4 py-8 text-white sm:px-6 lg:px-8">
            <div className="mx-auto max-w-5xl">
                <header className="flex items-center justify-between gap-4">
                    <Link href="/" className="font-mono text-sm font-semibold tracking-[0.14em] text-accent">VET_IOS</Link>
                    <Link href="/login" className="text-sm text-white/70 transition hover:text-white">Sign in</Link>
                </header>

                <main className="mt-10 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
                    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
                        <div className="text-xs uppercase tracking-[0.18em] text-accent">Demo case</div>
                        <h1 className="mt-3 text-3xl font-semibold tracking-tight">See VetIOS rank a case in seconds.</h1>
                        <div className="mt-6 space-y-3 text-sm text-white/76">
                            <Row label="Species" value="Canine" />
                            <Row label="Breed" value="Mixed" />
                            <Row label="Age" value="3 years" />
                            <Row label="Sex" value="Male uncastrated" />
                            <Row label="Symptoms" value="Vomiting for 2 days, lethargy, reduced appetite" />
                            <Row label="Labs" value="WBC 4.1, PCV 29, hydration low" />
                        </div>
                        <button
                            type="button"
                            onClick={() => setRanDemo(true)}
                            className="mt-6 min-h-[46px] w-full rounded-md border border-accent/65 bg-accent/10 px-5 text-sm font-medium text-accent transition hover:bg-accent hover:text-black"
                        >
                            Run demo diagnosis
                        </button>
                    </section>

                    <section className="space-y-4">
                        {ranDemo ? (
                            <>
                                <div className="rounded-md border border-accent/35 bg-accent/10 p-3 text-sm text-accent">
                                    This is a demo case. Sign in to run real cases.
                                </div>
                                <DiagnosisResultCard result={DEMO_RESULT} mode="clinician" />
                                <OutcomeConfirmButton
                                    inferenceEventId={DEMO_RESULT.inference_event_id}
                                    suggestedLabel={DEMO_RESULT.differentials[0].label}
                                    options={DEMO_RESULT.differentials.map((entry) => entry.label)}
                                    disabled
                                    onConfirmed={() => {}}
                                />
                            </>
                        ) : (
                            <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-white/12 bg-white/[0.02] p-8 text-center text-white/60">
                                Run the demo to see ranked diagnoses and recommended next tests.
                            </div>
                        )}
                    </section>
                </main>
            </div>
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
