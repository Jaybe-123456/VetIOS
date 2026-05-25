'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ClinicalCaseForm } from './ClinicalCaseForm';
import type { ClinicalInferenceInput } from './clinicalTypes';

export function ClinicalCaseEntryClient() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
            {error ? (
                <div className="mb-4 rounded-md border border-destructive/45 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                </div>
            ) : null}
            <ClinicalCaseForm onSubmit={submitCase} isLoading={isLoading} />
        </div>
    );
}

function toCasePayload(input: ClinicalInferenceInput) {
    const metadata = input.metadata ?? {};
    const labs = asRecord(input.diagnostic_tests?.labs) ?? asRecord(metadata.labs) ?? {};
    return {
        patient: {
            species: input.species ?? 'unknown',
            breed: input.breed ?? null,
            age_years: readNumber(input.age_years) ?? readNumber(metadata.age_years),
            sex: readText(metadata.sex),
        },
        presenting_complaint: readText(metadata.presenting_complaint) ?? input.symptoms.join(', '),
        history: buildHistory(metadata),
        duration_text: readText(metadata.duration_text),
        symptoms: input.symptoms,
        vitals: {},
        physical_exam: {},
        labs,
        images: [],
    };
}

function buildHistory(metadata: Record<string, unknown>): string | null {
    const parts = [
        readText(metadata.duration_text) ? `Duration: ${readText(metadata.duration_text)}` : null,
        readText(metadata.severity) ? `Severity: ${readText(metadata.severity)}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join('. ') : null;
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
        if (raw.includes('required')) return 'Please check all required fields are filled.';
        if (raw.includes('timeout')) return 'Diagnosis is taking longer than usual. Retry?';
        if (raw.includes('403')) return "You don't have access to this. Contact support.";
    }
    return 'Something went wrong. Please try again.';
}
