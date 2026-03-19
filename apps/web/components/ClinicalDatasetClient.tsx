'use client';

import { useDeferredValue, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Container, PageHeader } from '@/components/ui/terminal';
import { DatasetTable } from '@/components/DatasetTable';
import { RefreshCw, Search } from 'lucide-react';

interface ClinicalDatasetClientProps {
    clinicalCases: Array<Record<string, string>>;
    inferenceEvents: Array<Record<string, string>>;
    refreshedAt: string;
}

export function ClinicalDatasetClient({
    clinicalCases,
    inferenceEvents,
    refreshedAt,
}: ClinicalDatasetClientProps) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<'cases' | 'inference'>('cases');
    const [query, setQuery] = useState('');
    const [isRefreshing, startRefreshTransition] = useTransition();
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());

    useEffect(() => {
        const interval = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            startRefreshTransition(() => {
                router.refresh();
            });
        }, 15_000);

        return () => window.clearInterval(interval);
    }, [router]);

    const filteredClinicalCases = useMemo(
        () => filterDatasetRows(clinicalCases, deferredQuery),
        [clinicalCases, deferredQuery],
    );
    const filteredInferenceEvents = useMemo(
        () => filterDatasetRows(inferenceEvents, deferredQuery),
        [inferenceEvents, deferredQuery],
    );

    const handleRefresh = () => {
        startRefreshTransition(() => {
            router.refresh();
        });
    };

    return (
        <Container className="max-w-7xl">
            <PageHeader
                title="CLINICAL DATASET MANAGER"
                description="Explore structured clinical cases, inference logs, and outcome reinforcement events across the tenant boundary."
            />

            <div className="mb-8 flex flex-col gap-6">
                <div className="flex items-center justify-between gap-4 border border-grid bg-background/50 p-2">
                    <div className="flex flex-1 items-center gap-2">
                        <Search className="ml-2 h-4 w-4 text-muted" />
                        <input
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="QUERY_VECTORS (e.g. EVENT_ID: evt_98f...)"
                            className="w-full border-none bg-transparent font-mono text-sm text-foreground focus:outline-none"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        className="flex items-center gap-2 border border-grid px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition-colors hover:border-accent hover:text-foreground"
                    >
                        <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center border-b border-grid font-mono text-xs uppercase tracking-wider">
                        <button
                            onClick={() => setActiveTab('cases')}
                            className={`px-6 py-3 transition-colors border-b-2 ${activeTab === 'cases' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground'}`}
                        >
                            Clinical Cases
                        </button>
                        <button
                            onClick={() => setActiveTab('inference')}
                            className={`px-6 py-3 transition-colors border-b-2 ${activeTab === 'inference' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground'}`}
                        >
                            Inference Events
                        </button>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                        Last refresh: {formatRefreshTimestamp(refreshedAt)}
                    </span>
                </div>
            </div>

            {activeTab === 'cases' ? (
                <DatasetTable
                    title="Tenant Clinical Cases [Live]"
                    columns={['CASE_ID', 'SPECIES', 'BREED', 'SYMPTOMS', 'TIMESTAMP']}
                    data={filteredClinicalCases}
                />
            ) : (
                <DatasetTable
                    title="Inference Logs [Normalized]"
                    columns={['EVENT_ID', 'CASE_ID', 'TOP_PRED', 'CONFIDENCE', 'MODEL_V']}
                    data={filteredInferenceEvents}
                />
            )}
        </Container>
    );
}

function filterDatasetRows(
    rows: Array<Record<string, string>>,
    query: string,
): Array<Record<string, string>> {
    if (!query) return rows;

    return rows.filter((row) =>
        Object.values(row).some((value) => value.toLowerCase().includes(query)),
    );
}

function formatRefreshTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
