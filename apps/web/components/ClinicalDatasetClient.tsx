'use client';

import { useDeferredValue, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Search } from 'lucide-react';
import { Container, PageHeader } from '@/components/ui/terminal';
import { DatasetTable, type DatasetColumn } from '@/components/DatasetTable';
import {
    buildClinicalDatasetExport,
    type ClinicalCaseDatasetRow,
    type DatasetExportMode,
    type DatasetInferenceEventView,
    type TenantClinicalDataset,
} from '@/lib/dataset/clinicalDataset';

type ClientProps = TenantClinicalDataset;

export function ClinicalDatasetClient({
    clinicalCases,
    quarantinedCases,
    inferenceEvents,
    summary,
    refreshedAt,
}: ClientProps) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<'cases' | 'inference'>('cases');
    const [query, setQuery] = useState('');
    const [isRefreshing, startRefreshTransition] = useTransition();
    const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
    const [selectedExportMode, setSelectedExportMode] = useState<DatasetExportMode>('clean_labeled_cases');
    const [filters, setFilters] = useState({
        species: 'all',
        conditionClass: 'all',
        emergencyLevel: 'all',
        labelType: 'all',
        cluster: 'all',
        adversarialOnly: false,
        includeQuarantined: false,
    });
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());

    useEffect(() => {
        const refreshDataset = () => {
            startRefreshTransition(() => {
                router.refresh();
            });
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                refreshDataset();
            }
        };

        const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                refreshDataset();
            }
        }, 10_000);

        window.addEventListener('focus', refreshDataset);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', refreshDataset);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [router]);

    const caseUniverse = useMemo(
        () => (filters.includeQuarantined ? [...clinicalCases, ...quarantinedCases] : clinicalCases),
        [clinicalCases, quarantinedCases, filters.includeQuarantined],
    );
    const filteredClinicalCases = useMemo(
        () => caseUniverse.filter((row) => matchesCaseFilters(row, deferredQuery, filters)),
        [caseUniverse, deferredQuery, filters],
    );
    const filteredInferenceEvents = useMemo(
        () => inferenceEvents.filter((row) => matchesInferenceFilters(row, deferredQuery)),
        [inferenceEvents, deferredQuery],
    );

    const filterOptions = useMemo(() => buildFilterOptions([...clinicalCases, ...quarantinedCases]), [clinicalCases, quarantinedCases]);

    const handleRefresh = () => {
        startRefreshTransition(() => {
            router.refresh();
        });
    };

    const handleExport = () => {
        const scopedDataset: TenantClinicalDataset = {
            clinicalCases: filteredClinicalCases.filter((row) => !row.invalid_case),
            quarantinedCases: filters.includeQuarantined
                ? filteredClinicalCases.filter((row) => row.invalid_case || row.ingestion_status !== 'accepted')
                : quarantinedCases,
            inferenceEvents,
            summary,
            refreshedAt,
        };

        const payload = activeTab === 'cases'
            ? buildClinicalDatasetExport(scopedDataset, selectedExportMode)
            : filteredInferenceEvents;
        downloadJson(
            payload,
            activeTab === 'cases'
                ? `vetios_clinical_dataset_${selectedExportMode}.json`
                : 'vetios_inference_events.json',
        );
    };

    const caseColumns: Array<DatasetColumn<ClinicalCaseDatasetRow>> = [
        { key: 'case_id', label: 'CASE_ID', render: (row) => row.case_id },
        { key: 'species', label: 'SPECIES', render: (row) => row.species ?? 'Unresolved' },
        { key: 'breed', label: 'BREED', render: (row) => row.breed ?? '-' },
        { key: 'symptoms', label: 'SYMPTOMS', render: (row) => row.symptoms_summary ?? '-' },
        { key: 'top_diagnosis', label: 'TOP_DIAGNOSIS', render: (row) => row.top_diagnosis ?? row.confirmed_diagnosis ?? '-' },
        { key: 'condition_class', label: 'CONDITION_CLASS', render: (row) => row.primary_condition_class ?? '-' },
        { key: 'emergency', label: 'EMERGENCY_LEVEL', render: (row) => row.latest_emergency_level ?? '-' },
        { key: 'label_type', label: 'LABEL_TYPE', render: (row) => row.label_type ?? '-' },
        { key: 'timestamp', label: 'TIMESTAMP', render: (row) => row.timestamp },
    ];

    const inferenceColumns: Array<DatasetColumn<DatasetInferenceEventView>> = [
        { key: 'event_id', label: 'EVENT_ID', render: (row) => row.event_id },
        { key: 'case_id', label: 'CASE_ID', render: (row) => row.case_id ?? '-' },
        { key: 'top_prediction', label: 'TOP_PRED', render: (row) => row.top_prediction ?? '-' },
        { key: 'condition_class', label: 'CONDITION_CLASS', render: (row) => row.primary_condition_class ?? '-' },
        { key: 'confidence', label: 'CONFIDENCE', render: (row) => formatPercent(row.confidence) },
        { key: 'emergency', label: 'EMERGENCY_LEVEL', render: (row) => row.emergency_level ?? '-' },
        { key: 'contradiction', label: 'CONTRADICTION', render: (row) => formatPercent(row.contradiction_score) },
        { key: 'model_version', label: 'MODEL_V', render: (row) => row.model_version },
        { key: 'timestamp', label: 'TIMESTAMP', render: (row) => row.timestamp },
    ];

    return (
        <Container className="max-w-[96rem]">
            <PageHeader
                title="CLINICAL DATASET MANAGER"
                description="Explore clinically structured tenant cases, inference logs, learning labels, severity metadata, and adversarial benchmarking signals."
            />

            <div className="mb-8 flex flex-col gap-6">
                <div className="flex flex-col gap-3 border border-grid bg-background/50 p-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-1 items-center gap-2 border border-grid bg-black/20 px-2 py-2">
                        <Search className="ml-1 h-4 w-4 text-muted" />
                        <input
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="QUERY_CASES (species, diagnosis, contradiction flag, event id...)"
                            className="w-full border-none bg-transparent font-mono text-sm text-foreground focus:outline-none"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <select value={selectedExportMode} onChange={(event) => setSelectedExportMode(event.target.value as DatasetExportMode)} className="border border-grid bg-black/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                            <option value="clean_labeled_cases">Clean Labeled</option>
                            <option value="severity_training_set">Severity Set</option>
                            <option value="adversarial_benchmark_set">Adversarial Set</option>
                            <option value="calibration_audit_set">Calibration Set</option>
                            <option value="quarantined_invalid_cases">Quarantined</option>
                        </select>
                        <button onClick={handleRefresh} className="flex items-center gap-2 border border-grid px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition-colors hover:border-accent hover:text-foreground">
                            <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <SummaryCard label="Live Cases" value={summary.live_count} />
                    <SummaryCard label="Quarantined" value={summary.quarantined_count} tone="warn" />
                    <SummaryCard label="Adversarial" value={summary.adversarial_count} tone="accent" />
                    <SummaryCard label="Unlabeled" value={summary.unlabeled_count} />
                    <SummaryCard label="Severity Ready" value={summary.severity_coverage_count} />
                    <SummaryCard label="Contradiction Ready" value={summary.contradiction_coverage_count} />
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center border-b border-grid font-mono text-xs uppercase tracking-wider">
                        <button onClick={() => setActiveTab('cases')} className={`border-b-2 px-6 py-3 transition-colors ${activeTab === 'cases' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground'}`}>Clinical Cases</button>
                        <button onClick={() => setActiveTab('inference')} className={`border-b-2 px-6 py-3 transition-colors ${activeTab === 'inference' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground'}`}>Inference Events</button>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                        Last refresh: {formatRefreshTimestamp(refreshedAt)}
                    </span>
                </div>

                {activeTab === 'cases' ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
                        <FilterSelect label="Species" value={filters.species} options={filterOptions.species} onChange={(value) => setFilters((current) => ({ ...current, species: value }))} />
                        <FilterSelect label="Class" value={filters.conditionClass} options={filterOptions.conditionClasses} onChange={(value) => setFilters((current) => ({ ...current, conditionClass: value }))} />
                        <FilterSelect label="Emergency" value={filters.emergencyLevel} options={filterOptions.emergencyLevels} onChange={(value) => setFilters((current) => ({ ...current, emergencyLevel: value }))} />
                        <FilterSelect label="Label" value={filters.labelType} options={filterOptions.labelTypes} onChange={(value) => setFilters((current) => ({ ...current, labelType: value }))} />
                        <FilterSelect label="Cluster" value={filters.cluster} options={filterOptions.clusters} onChange={(value) => setFilters((current) => ({ ...current, cluster: value }))} />
                        <ToggleFilter label="Adversarial Only" checked={filters.adversarialOnly} onChange={(checked) => setFilters((current) => ({ ...current, adversarialOnly: checked }))} />
                        <ToggleFilter label="Include Quarantined" checked={filters.includeQuarantined} onChange={(checked) => setFilters((current) => ({ ...current, includeQuarantined: checked }))} />
                    </div>
                ) : null}
            </div>

            {activeTab === 'cases' ? (
                <DatasetTable
                    title="Tenant Clinical Cases [Structured Live]"
                    columns={caseColumns}
                    data={filteredClinicalCases}
                    rowKey={(row) => row.case_id}
                    onExport={handleExport}
                    selectedRowKey={selectedCaseId}
                    onRowToggle={(row) => setSelectedCaseId((current) => current === row.case_id ? null : row.case_id)}
                    detailRenderer={renderCaseDetail}
                    filterSlot={<span className="font-mono text-[10px] uppercase tracking-[0.2em]">{filters.includeQuarantined ? 'live + quarantined' : 'live only'}</span>}
                    emptyMessage="NO STRUCTURED CLINICAL CASES MATCH THE ACTIVE TENANT FILTERS"
                />
            ) : (
                <DatasetTable
                    title="Inference Logs [Diagnostic + Severity + Contradiction]"
                    columns={inferenceColumns}
                    data={filteredInferenceEvents}
                    rowKey={(row) => row.event_id}
                    onExport={handleExport}
                    emptyMessage="NO INFERENCE EVENTS MATCH THE ACTIVE FILTERS"
                />
            )}
        </Container>
    );
}

function renderCaseDetail(row: ClinicalCaseDatasetRow) {
    return (
        <div className="grid gap-4 xl:grid-cols-[1.3fr,1fr]">
            <div className="space-y-3">
                <DetailBlock label="Normalized Symptom Vector" value={JSON.stringify(row.symptom_vector_normalized, null, 2)} code />
                <DetailBlock label="Uncertainty Notes" value={row.uncertainty_notes.length > 0 ? row.uncertainty_notes.join(', ') : 'None'} />
                <DetailBlock label="Contradiction Flags" value={row.contradiction_flags.length > 0 ? row.contradiction_flags.join(', ') : 'None'} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
                <DetailStat label="Confirmed Diagnosis" value={row.confirmed_diagnosis ?? '-'} />
                <DetailStat label="Severity Score" value={formatPercent(row.severity_score)} />
                <DetailStat label="Contradiction Score" value={formatPercent(row.contradiction_score)} />
                <DetailStat label="Case Cluster" value={row.case_cluster ?? '-'} />
                <DetailStat label="Adversarial" value={row.adversarial_case ? `YES (${row.adversarial_case_type ?? 'flagged'})` : 'NO'} />
                <DetailStat label="Telemetry Status" value={row.telemetry_status ?? '-'} />
                <DetailStat label="Inference ID" value={row.latest_inference_event_id ?? '-'} />
                <DetailStat label="Outcome ID" value={row.latest_outcome_event_id ?? '-'} />
                <DetailStat label="Simulation ID" value={row.latest_simulation_event_id ?? '-'} />
                <DetailStat label="Validation" value={row.validation_error_code ?? row.ingestion_status} />
                <DetailStat label="Model Version" value={row.model_version ?? '-'} />
                <DetailStat label="Triage Priority" value={row.triage_priority ?? '-'} />
            </div>
        </div>
    );
}

function matchesCaseFilters(row: ClinicalCaseDatasetRow, query: string, filters: {
    species: string;
    conditionClass: string;
    emergencyLevel: string;
    labelType: string;
    cluster: string;
    adversarialOnly: boolean;
    includeQuarantined: boolean;
}) {
    if (!matchesQuery(Object.values({
        case_id: row.case_id,
        species: row.species,
        breed: row.breed,
        symptoms: row.symptoms_summary,
        top_diagnosis: row.top_diagnosis,
        confirmed_diagnosis: row.confirmed_diagnosis,
        condition_class: row.primary_condition_class,
        emergency: row.latest_emergency_level,
        cluster: row.case_cluster,
        validation: row.validation_error_code,
        contradiction: row.contradiction_flags.join(', '),
    }), query)) {
        return false;
    }

    if (filters.species !== 'all' && row.species !== filters.species) return false;
    if (filters.conditionClass !== 'all' && row.primary_condition_class !== filters.conditionClass) return false;
    if (filters.emergencyLevel !== 'all' && row.latest_emergency_level !== filters.emergencyLevel) return false;
    if (filters.labelType !== 'all' && row.label_type !== filters.labelType) return false;
    if (filters.cluster !== 'all' && row.case_cluster !== filters.cluster) return false;
    if (filters.adversarialOnly && !row.adversarial_case) return false;
    return true;
}

function matchesInferenceFilters(row: DatasetInferenceEventView, query: string) {
    return matchesQuery(Object.values(row), query);
}

function matchesQuery(values: unknown[], query: string) {
    if (!query) return true;
    return values.some((value) => String(value ?? '').toLowerCase().includes(query));
}

function buildFilterOptions(rows: ClinicalCaseDatasetRow[]) {
    return {
        species: uniqueValues(rows.map((row) => row.species)),
        conditionClasses: uniqueValues(rows.map((row) => row.primary_condition_class)),
        emergencyLevels: uniqueValues(rows.map((row) => row.latest_emergency_level)),
        labelTypes: uniqueValues(rows.map((row) => row.label_type)),
        clusters: uniqueValues(rows.map((row) => row.case_cluster)),
    };
}

function uniqueValues(values: Array<string | null>) {
    return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}

function downloadJson(payload: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function formatPercent(value: number | null) {
    return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-';
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

function SummaryCard({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warn' | 'accent' }) {
    const toneClass = tone === 'warn' ? 'text-amber-400' : tone === 'accent' ? 'text-accent' : 'text-foreground';
    return (
        <div className="border border-grid bg-black/20 p-3 font-mono">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted">{label}</div>
            <div className={`mt-2 text-2xl ${toneClass}`}>{value}</div>
        </div>
    );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
    return (
        <label className="flex flex-col gap-1 border border-grid bg-black/20 p-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
            {label}
            <select value={value} onChange={(event) => onChange(event.target.value)} className="bg-transparent text-xs text-foreground outline-none">
                <option value="all">All</option>
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
        </label>
    );
}

function ToggleFilter({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex items-center justify-between gap-3 border border-grid bg-black/20 p-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
            <span>{label}</span>
            <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-current" />
        </label>
    );
}

function DetailBlock({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
    return (
        <div className="border border-grid bg-black/20 p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{label}</div>
            {code ? (
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-foreground/80">{value}</pre>
            ) : (
                <div className="font-mono text-xs text-foreground/80">{value}</div>
            )}
        </div>
    );
}

function DetailStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="border border-grid bg-black/20 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{label}</div>
            <div className="mt-2 font-mono text-xs text-foreground/80 break-all">{value}</div>
        </div>
    );
}
