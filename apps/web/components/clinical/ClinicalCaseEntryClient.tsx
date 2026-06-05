'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, FileText, Sparkles, Stethoscope } from 'lucide-react';
import { ClinicalCaseForm } from './ClinicalCaseForm';
import type { ClinicalCaseFormDraft } from './ClinicalCaseForm';
import type { ClinicalInferenceInput } from './clinicalTypes';

interface ClinicalCaseEntryClientProps {
    firstCaseMode?: boolean;
    useDemoDraft?: boolean;
}

const DEMO_DRAFT: ClinicalCaseFormDraft = {
    patient: {
        species: 'Canine',
        breed: 'Mixed breed',
        age: '0.4',
        ageUnit: 'years',
        sex: 'Male intact',
    },
    signs: {
        symptoms: 'acute vomiting, bloody diarrhea, lethargy, poor appetite, not fully vaccinated',
        duration: '2',
        durationUnit: 'days',
        severity: 'severe',
    },
    labs: {
        WBC: '3.1',
        PCV: '48',
        Glucose: '62',
    },
};

export function ClinicalCaseEntryClient({ firstCaseMode = false, useDemoDraft = false }: ClinicalCaseEntryClientProps) {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [demoDraftEnabled, setDemoDraftEnabled] = useState(useDemoDraft);

    async function submitCase(input: ClinicalInferenceInput) {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/cases', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(toCasePayload(input)),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(readPlainError(body));
            }
            if (typeof body.clinical_case_id !== 'string') {
                throw new Error('Something went wrong. Please try again.');
            }
            router.push(`/cases/${body.clinical_case_id}`);
            router.refresh();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Something went wrong. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="mx-auto max-w-4xl">
            {firstCaseMode ? <FirstCaseQuickStart demoDraftEnabled={demoDraftEnabled} /> : null}
            {error ? (
                <div className="mb-4 rounded-md border border-destructive/45 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                </div>
            ) : null}
            <ClinicalCaseForm
                onSubmit={submitCase}
                isLoading={isLoading}
                initialDraft={demoDraftEnabled ? DEMO_DRAFT : undefined}
                onClearDraft={() => setDemoDraftEnabled(false)}
            />
        </div>
    );
}

function FirstCaseQuickStart({ demoDraftEnabled }: { demoDraftEnabled: boolean }) {
    const steps = [
        { label: 'Describe patient', icon: <Stethoscope className="h-4 w-4" /> },
        { label: 'Review differential', icon: <FileText className="h-4 w-4" /> },
        { label: 'Confirm outcome', icon: <CheckCircle2 className="h-4 w-4" /> },
    ];

    return (
        <section className="mb-5 rounded-lg border border-white/10 bg-white/[0.025] p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                        First case path
                    </div>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/68">
                        Start with the minimum clinical facts. VetIOS will produce ranked differentials, reliability, tests, and a case record.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Link
                        href="/cases/new?template=demo&first_case=1"
                        className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-md border border-accent/55 bg-accent/10 px-3 text-sm font-medium text-accent transition hover:bg-accent hover:text-black"
                    >
                        <Sparkles className="h-4 w-4" />
                        {demoDraftEnabled ? 'Demo loaded' : 'Load demo'}
                    </Link>
                    <Link
                        href="/cases"
                        className="inline-flex min-h-[40px] items-center justify-center rounded-md border border-white/10 px-3 text-sm text-white/68 transition hover:border-white/25 hover:text-white"
                    >
                        My cases
                    </Link>
                </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {steps.map((step, index) => (
                    <div key={step.label} className="flex items-center gap-3 rounded-md border border-white/8 bg-black/20 p-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-accent/35 text-accent">
                            {step.icon}
                        </span>
                        <div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/42">
                                Step {index + 1}
                            </div>
                            <div className="text-sm font-medium text-white/82">{step.label}</div>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

function toCasePayload(input: ClinicalInferenceInput) {
    const metadata = flattenMetadata(input.metadata);
    const diagnosticTests = asRecord(metadata.diagnostic_tests);
    const labs = asRecord(input.diagnostic_tests?.labs)
        ?? asRecord(metadata.labs)
        ?? asRecord(diagnosticTests?.labs)
        ?? {};
    const symptomText = readText(metadata.presenting_complaint) ?? input.symptoms.join('\n');
    const symptoms = sanitizeSymptoms(input.symptoms);
    return {
        patient: {
            species: input.species ?? 'unknown',
            breed: input.breed ?? null,
            age_years: readNumber(input.age_years) ?? readNumber(metadata.age_years),
            sex: normalizeSex(readText(metadata.sex)),
        },
        presenting_complaint: derivePresentingComplaint(symptomText, symptoms),
        history: buildHistory(metadata, symptomText),
        duration_text: readText(metadata.duration_text),
        symptoms,
        vitals: {},
        physical_exam: {},
        labs,
        images: [],
    };
}

function buildHistory(metadata: Record<string, unknown>, symptomText: string): string | null {
    const parts = [
        readText(metadata.duration_text) ? `Duration: ${readText(metadata.duration_text)}` : null,
        readText(metadata.severity) ? `Severity: ${readText(metadata.severity)}` : null,
        symptomText ? `Clinical notes: ${symptomText}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join('. ') : null;
}

function flattenMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
    const direct = metadata ?? {};
    const nested = asRecord(direct.metadata);
    return nested ? { ...direct, ...nested } : direct;
}

function sanitizeSymptoms(symptoms: string[]): string[] {
    return symptoms
        .map((entry) => entry.trim())
        .filter((entry) => entry && !isSectionHeading(entry));
}

function derivePresentingComplaint(symptomText: string, symptoms: string[]): string {
    const firstLine = symptomText
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => entry && !isSectionHeading(entry));

    return firstLine ?? symptoms[0] ?? 'Clinical signs reported';
}

function isSectionHeading(value: string): boolean {
    const normalized = value
        .toLowerCase()
        .replace(/[“”"]/g, '')
        .replace(/[:]+$/g, '')
        .trim();

    return [
        'core clinical signs',
        'systemic & emergency indicators',
        'systemic and emergency indicators',
        'common symptom pattern',
        'typical progression',
        'frequently associated findings',
    ].includes(normalized);
}

function normalizeSex(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (normalized === 'male intact') return 'male';
    if (normalized === 'male neutered') return 'male_neutered';
    if (normalized === 'female intact') return 'female';
    if (normalized === 'female spayed') return 'female_spayed';
    const canonical = normalized.replace(/\s+/g, '_');
    if (['male', 'female', 'male_neutered', 'female_spayed', 'unknown'].includes(canonical)) return canonical;
    return 'unknown';
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

function readPlainError(body: unknown): string {
    if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        const raw = String(record.detail ?? record.error ?? '');
        const lower = raw.toLowerCase();
        if (String(record.error) === 'Unauthorized' || lower.includes('unauthorized')) {
            return 'Please sign in again before saving this case.';
        }
        if (lower.includes('could not find') && lower.includes('column')) {
            return 'The case database is not up to date. Apply the latest migrations and try again.';
        }
        if (lower.includes('check constraint') || lower.includes('violates')) {
            return 'Please check the patient details and try again.';
        }
        if (raw.includes('required')) return 'Please check all required fields are filled.';
        if (lower.includes('timeout')) return 'Diagnosis is taking longer than usual. Retry?';
        if (raw.includes('403')) return "You don't have access to this. Contact support.";
    }
    return 'Something went wrong. Please try again.';
}
