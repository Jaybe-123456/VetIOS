'use client';

import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CaseSummary } from '@/lib/cases/caseWorkflow';
import { formatClinicalLabel, formatPercent } from './clinicalTypes';

export function ClinicalCaseListClient({ cases }: { cases: CaseSummary[] }) {
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
                {filtered.map((entry) => (
                    <Link key={entry.id} href={`/cases/${entry.id}`} className="rounded-lg border border-white/10 bg-white/[0.025] p-4 transition hover:border-accent/40 hover:bg-accent/5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <div className="text-lg font-semibold text-white">{entry.patient_name ?? 'Unnamed patient'}</div>
                                <div className="mt-1 text-sm text-white/68">
                                    {[entry.species_display, entry.breed].filter(Boolean).join(' - ') || 'Patient details pending'}
                                </div>
                                <div className="mt-3 max-w-2xl text-sm text-white/78">
                                    {entry.presenting_complaint ?? entry.symptom_summary ?? 'No complaint recorded'}
                                </div>
                            </div>
                            <div className="min-w-[190px] rounded-md border border-white/8 bg-black/20 p-3 text-sm">
                                <div className="text-white/46">Top possible diagnosis</div>
                                <div className="mt-1 text-white">{entry.confirmed_diagnosis ?? formatClinicalLabel(entry.top_diagnosis ?? 'Pending')}</div>
                                <div className="mt-2 text-accent">{entry.diagnosis_confidence == null ? 'Needs review' : formatPercent(entry.diagnosis_confidence)}</div>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>

            {filtered.length === 0 ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.025] p-8 text-center text-white/62">
                    No cases match your search.
                </div>
            ) : null}
        </div>
    );
}
