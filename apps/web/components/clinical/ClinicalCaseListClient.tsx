'use client';

import Link from 'next/link';
import { ClipboardList, Plus, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseSummary } from '@/lib/cases/caseWorkflow';
import { formatClinicalLabel, formatPercent } from './clinicalTypes';
import { OutcomeConfirmButton } from './OutcomeConfirmButton';

export function ClinicalCaseListClient({ cases }: { cases: CaseSummary[] }) {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => cases.filter((entry) => {
        if (!query.trim()) return true;
        const haystack = [entry.patient_name, entry.presenting_complaint, entry.top_diagnosis, entry.confirmed_diagnosis]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
    }), [cases, query]);

    return (
        <div className="space-y-5">
            {cases.length === 0 ? <FirstCaseEmptyState /> : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative max-w-md flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/38" />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search cases"
                        className="min-h-[44px] w-full rounded-md border border-white/10 bg-[hsl(0_0%_8%)] pl-10 pr-3 text-sm text-white outline-none focus:border-accent/60"
                    />
                </div>
                <Link href="/cases/new" className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-accent/65 bg-accent/10 px-4 text-sm font-medium text-accent transition hover:bg-accent hover:text-black">
                    <Plus className="h-4 w-4" />
                    New Case
                </Link>
            </div>

            <div className="grid gap-3">
                {filtered.map((entry) => {
                    const isClosed = entry.case_status === 'closed';
                    const caseHref = `/cases/${entry.latest_inference_event_id ?? entry.id}`;
                    const differentials = readCardDifferentials(entry);
                    const confirmOptions = differentials.map((differential) => differential.label);

                    return (
                    <article key={entry.id} className="rounded-lg border border-white/10 bg-white/[0.025] p-4 transition hover:border-accent/40 hover:bg-accent/5">
                        <Link href={caseHref} className="block">
                            <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 text-lg font-semibold text-white">
                                    {entry.patient_name ?? 'Unnamed patient'}
                                </div>
                                <div className="text-sm text-white/62">
                                    {formatPatientMeta(entry)}
                                </div>
                            </div>

                            <div className="border-y border-white/8 py-3">
                                <div className="space-y-2.5">
                                    {differentials.slice(0, 3).map((differential, index) => (
                                        <div
                                            key={`${entry.id}-${differential.label}-${index}`}
                                            className="grid gap-2 sm:grid-cols-[36px_minmax(160px,1fr)_minmax(96px,180px)_54px_58px] sm:items-center"
                                        >
                                            <div className="font-mono text-xs text-white/44">
                                                {String(index + 1).padStart(2, '0')}
                                            </div>
                                            <div className="min-w-0 truncate text-sm font-medium text-white" title={formatClinicalLabel(differential.label)}>
                                                {formatClinicalLabel(differential.label)}
                                            </div>
                                            <div className="h-2 overflow-hidden rounded-full bg-white/8" aria-hidden>
                                                <div className="h-full rounded-full bg-accent" style={{ width: formatPercent(differential.probability) }} />
                                            </div>
                                            <div className="font-mono text-sm text-accent">
                                                {formatPercent(differential.probability)}
                                            </div>
                                            <UrgencyBadge value={differential.urgency} />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                                <div className="text-white/72">{formatReliability(entry)}</div>
                                <span className={`inline-flex min-h-[28px] w-fit items-center rounded-full border px-3 text-xs ${isClosed ? 'border-accent/40 text-accent' : 'border-white/15 text-white/58'}`}>
                                    {isClosed ? 'Confirmed' : 'Pending'}
                                </span>
                            </div>
                            </div>
                        </Link>
                        {!isClosed && entry.latest_inference_event_id ? (
                            <div className="mt-4 border-t border-white/8 pt-4">
                                <OutcomeConfirmButton
                                    inferenceEventId={entry.latest_inference_event_id}
                                    suggestedLabel={entry.top_diagnosis ?? confirmOptions[0] ?? ''}
                                    options={confirmOptions}
                                    compact
                                    title="Confirm outcome"
                                    onConfirmed={() => router.refresh()}
                                />
                            </div>
                        ) : null}
                    </article>
                    );
                })}
            </div>

            {filtered.length === 0 ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.025] p-8 text-center text-white/62">
                    No cases match your search.
                </div>
            ) : null}
        </div>
    );
}

function FirstCaseEmptyState() {
    return (
        <section className="rounded-lg border border-accent/24 bg-accent/[0.035] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                        Start here
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-white">Run your first clinical case</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/68">
                        VetIOS only needs species and clinical signs to begin. Add age, duration, sex, or labs when available.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Link
                        href="/cases/new?first_case=1"
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-accent/65 bg-accent/10 px-4 text-sm font-medium text-accent transition hover:bg-accent hover:text-black"
                    >
                        <ClipboardList className="h-4 w-4" />
                        New case
                    </Link>
                    <Link
                        href="/cases/new?template=demo&first_case=1"
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-white/12 px-4 text-sm text-white/72 transition hover:border-white/30 hover:text-white"
                    >
                        <Sparkles className="h-4 w-4" />
                        Try demo draft
                    </Link>
                </div>
            </div>
        </section>
    );
}

function readCardDifferentials(entry: CaseSummary) {
    if (entry.top_differentials.length > 0) return entry.top_differentials;
    if (entry.top_diagnosis) {
        return [{
            label: entry.confirmed_diagnosis ?? entry.top_diagnosis,
            probability: entry.diagnosis_confidence ?? 0,
            urgency: 'low' as const,
        }];
    }
    return [{
        label: 'Diagnosis pending',
        probability: 0,
        urgency: 'low' as const,
    }];
}

function UrgencyBadge({ value }: { value: 'high' | 'medium' | 'low' }) {
    const tone = value === 'high'
        ? 'border-red-400/45 text-red-300'
        : value === 'medium'
            ? 'border-amber-300/45 text-amber-200'
            : 'border-white/15 text-white/56';
    return (
        <span className={`inline-flex min-h-[26px] items-center justify-center rounded-full border px-2 text-[11px] uppercase tracking-[0.12em] ${tone}`}>
            {formatUrgency(value)}
        </span>
    );
}

function formatPatientMeta(entry: CaseSummary): string {
    const age = readNumber(entry.patient_metadata.age_years)
        ?? readNumber(entry.latest_input_signature.age_years);
    const sex = readText(entry.patient_metadata.sex)
        ?? readText(entry.latest_input_signature.sex);
    return [
        entry.species_display ?? entry.species_canonical ?? 'Species pending',
        age == null ? null : `${age}y`,
        sex ? formatClinicalLabel(sex) : null,
    ].filter(Boolean).join(' - ');
}

function formatReliability(entry: CaseSummary): string {
    const score = entry.reliability_score ?? entry.diagnosis_confidence;
    if (score == null) return 'Reliability: Needs review';
    return `Reliability: ${formatReliabilityBand(score)} (phi ${score.toFixed(2)})`;
}

function formatReliabilityBand(score: number): string {
    if (score >= 0.75) return 'High';
    if (score >= 0.5) return 'Moderate';
    return 'Low';
}

function formatUrgency(value: 'high' | 'medium' | 'low'): string {
    if (value === 'high') return 'HIGH';
    if (value === 'medium') return 'MED';
    return 'LOW';
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
