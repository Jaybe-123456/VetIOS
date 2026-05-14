'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { CaseSummary } from '@/lib/cases/caseWorkflow';
import { ConsoleCard, DataRow, TerminalInput } from '@/components/ui/terminal';

export function CaseListClient({ cases }: { cases: CaseSummary[] }) {
    const [status, setStatus] = useState('all');
    const [species, setSpecies] = useState('all');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => cases.filter((entry) => {
        if (status !== 'all' && entry.case_status !== status) return false;
        if (species !== 'all' && (entry.species_display ?? '').toLowerCase() !== species) return false;
        if (fromDate && Date.parse(entry.created_at) < Date.parse(fromDate)) return false;
        if (toDate && Date.parse(entry.created_at) > Date.parse(`${toDate}T23:59:59.999Z`)) return false;
        if (query.trim()) {
            const haystack = [
                entry.patient_name,
                entry.presenting_complaint,
                entry.top_diagnosis,
                entry.confirmed_diagnosis,
                entry.symptom_summary,
            ].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(query.trim().toLowerCase())) return false;
        }
        return true;
    }), [cases, fromDate, query, species, status, toDate]);

    const speciesOptions = Array.from(new Set(
        cases.map((entry) => entry.species_display?.toLowerCase()).filter((entry): entry is string => Boolean(entry)),
    )).sort();

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-5 lg:max-w-5xl">
                    <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_62%)]">Search</span>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(0_0%_45%)]" />
                            <TerminalInput value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" />
                        </div>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_62%)]">Status</span>
                        <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-[42px] border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_8%)] px-3 font-mono text-[13px] text-[hsl(0_0%_94%)]">
                            <option value="all">All</option>
                            <option value="open">Open</option>
                            <option value="closed">Closed</option>
                            <option value="referred">Referred</option>
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_62%)]">Species</span>
                        <select value={species} onChange={(event) => setSpecies(event.target.value)} className="h-[42px] border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_8%)] px-3 font-mono text-[13px] text-[hsl(0_0%_94%)]">
                            <option value="all">All</option>
                            {speciesOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_62%)]">From</span>
                        <TerminalInput type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_62%)]">To</span>
                        <TerminalInput type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                    </label>
                </div>
                <Link
                    href="/cases/new"
                    className="flex min-h-[44px] items-center justify-center gap-2 border border-accent/70 bg-[hsl(142_76%_46%_/_0.05)] px-4 font-mono text-[12px] uppercase tracking-[0.16em] text-accent transition hover:bg-accent hover:text-black"
                >
                    <Plus className="h-4 w-4" />
                    New Case
                </Link>
            </div>

            <ConsoleCard title={`Cases ${filtered.length}/${cases.length}`}>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] border-collapse font-mono text-[13px]">
                        <thead>
                            <tr className="border-b border-[hsl(0_0%_100%_/_0.08)] text-left text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_58%)]">
                                <th className="px-3 py-3">Patient</th>
                                <th className="px-3 py-3">Species</th>
                                <th className="px-3 py-3">Presenting Complaint</th>
                                <th className="px-3 py-3">Status</th>
                                <th className="px-3 py-3">Top Differential</th>
                                <th className="px-3 py-3">Confidence</th>
                                <th className="px-3 py-3">Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((entry) => (
                                <tr key={entry.id} className="border-b border-[hsl(0_0%_100%_/_0.05)] hover:bg-[hsl(0_0%_100%_/_0.03)]">
                                    <td className="px-3 py-3">
                                        <Link href={`/cases/${entry.id}`} className="text-[hsl(0_0%_96%)] hover:text-accent">
                                            {entry.patient_name ?? 'Unnamed patient'}
                                        </Link>
                                    </td>
                                    <td className="px-3 py-3 text-[hsl(0_0%_78%)]">{entry.species_display ?? 'unknown'}</td>
                                    <td className="max-w-[280px] px-3 py-3 text-[hsl(0_0%_82%)]">{entry.presenting_complaint ?? entry.symptom_summary ?? '-'}</td>
                                    <td className="px-3 py-3">
                                        <span className={statusClass(entry.case_status)}>{entry.case_status}</span>
                                    </td>
                                    <td className="px-3 py-3 text-[hsl(0_0%_82%)]">{entry.confirmed_diagnosis ?? entry.top_diagnosis ?? '-'}</td>
                                    <td className="px-3 py-3 text-accent">{formatPercent(entry.diagnosis_confidence)}</td>
                                    <td className="px-3 py-3 text-[hsl(0_0%_62%)]">{formatDate(entry.created_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length === 0 && (
                    <div className="py-8">
                        <DataRow label="Result" value="No cases match the current filters." tone="muted" />
                    </div>
                )}
            </ConsoleCard>
        </div>
    );
}

function statusClass(status: CaseSummary['case_status']): string {
    const tone = status === 'closed'
        ? 'border-accent/50 text-accent'
        : status === 'referred'
            ? 'border-[hsl(45_100%_55%_/_0.5)] text-[hsl(45_100%_60%)]'
            : 'border-[hsl(190_90%_60%_/_0.5)] text-[hsl(190_90%_65%)]';
    return `inline-flex border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${tone}`;
}

function formatPercent(value: number | null): string {
    return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-';
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
