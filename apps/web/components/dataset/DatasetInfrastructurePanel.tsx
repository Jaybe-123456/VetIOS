'use client';

import { useEffect, useState, useTransition } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseZap, RefreshCw } from 'lucide-react';

interface DatasetInfrastructurePanelProps {
    onChanged?: () => void;
}

interface InfrastructureResponse {
    data?: DatasetInfrastructureSnapshot | null;
    error?: string | null;
    request_id?: string;
}

interface DatasetInfrastructureSnapshot {
    ready: boolean;
    schema_health: {
        required: number;
        installed: number;
        missing: number;
        errored: number;
        probes: Array<{
            table: string;
            status: 'installed' | 'missing' | 'error';
            message: string | null;
        }>;
    };
    recent_import_jobs: Array<{
        id: string;
        source_name: string | null;
        dry_run: boolean;
        status: string;
        requested_cases: number;
        accepted_count: number;
        rejected_count: number;
        learning_ready_count: number;
        created_at: string;
        completed_at: string | null;
        error_message: string | null;
    }>;
    recent_dataset_versions: Array<{
        id: string;
        dataset_version: string | null;
        dataset_kind: string | null;
        row_count: number;
        created_at: string | null;
    }>;
    recent_learning_cycles: Array<{
        id: string;
        cycle_type: string | null;
        trigger_mode: string | null;
        status: string | null;
        created_at: string | null;
        completed_at: string | null;
    }>;
    recent_model_registry_entries: Array<{
        id: string;
        model_name: string | null;
        model_version: string | null;
        task_type: string | null;
        promotion_status: string | null;
        is_champion: boolean;
        updated_at: string | null;
    }>;
    required_migrations: string[];
    warnings: string[];
}

export function DatasetInfrastructurePanel({ onChanged }: DatasetInfrastructurePanelProps) {
    const [snapshot, setSnapshot] = useState<DatasetInfrastructureSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const loadSnapshot = () => {
        startTransition(() => {
            void fetchSnapshot();
        });
    };

    useEffect(() => {
        loadSnapshot();
    }, []);

    async function fetchSnapshot() {
        try {
            setError(null);
            const response = await fetch('/api/dataset/infrastructure', {
                method: 'GET',
                credentials: 'same-origin',
                headers: { accept: 'application/json' },
            });
            const body = await response.json().catch(() => ({})) as InfrastructureResponse;
            if (!response.ok || !body.data) {
                throw new Error(body.error ?? 'Dataset infrastructure check failed.');
            }
            setSnapshot(body.data);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Dataset infrastructure check failed.');
        }
    }

    const ready = snapshot?.ready === true;
    const missingTables = snapshot?.schema_health.probes.filter((probe) => probe.status !== 'installed') ?? [];

    return (
        <section className="border border-grid bg-black/20 p-4 font-mono">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-accent">
                        <DatabaseZap className="h-3.5 w-3.5" />
                        Dataset infrastructure
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-foreground">Learning system readiness</h2>
                    <p className="mt-2 max-w-4xl text-sm leading-relaxed text-[hsl(0_0%_72%)]">
                        VetIOS checks the installed schema, import ledgers, dataset versions, learning cycles, and model registry before treating clinical data as infrastructure-grade.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        loadSnapshot();
                        onChanged?.();
                    }}
                    className="inline-flex min-h-[38px] items-center justify-center gap-2 border border-grid px-3 text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_78%)] transition hover:border-accent hover:text-accent"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <InfrastructureMetric
                    label="Schema"
                    value={snapshot ? `${snapshot.schema_health.installed}/${snapshot.schema_health.required}` : 'Checking'}
                    tone={ready ? 'accent' : 'warn'}
                />
                <InfrastructureMetric label="Import Jobs" value={snapshot?.recent_import_jobs.length ?? 0} />
                <InfrastructureMetric label="Dataset Versions" value={snapshot?.recent_dataset_versions.length ?? 0} />
                <InfrastructureMetric label="Learning Cycles" value={snapshot?.recent_learning_cycles.length ?? 0} />
                <InfrastructureMetric label="Registry Entries" value={snapshot?.recent_model_registry_entries.length ?? 0} />
            </div>

            {error ? (
                <div className="mt-4 border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
                    {error}
                </div>
            ) : null}

            {snapshot ? (
                <div className={`mt-4 border p-3 text-xs leading-relaxed ${ready ? 'border-accent/35 bg-accent/10 text-[hsl(0_0%_78%)]' : 'border-amber-300/30 bg-amber-300/10 text-amber-100'}`}>
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                        {ready ? <CheckCircle2 className="h-4 w-4 text-accent" /> : <AlertTriangle className="h-4 w-4 text-amber-200" />}
                        {ready ? 'Clinical dataset infrastructure is installed.' : 'Clinical dataset infrastructure still needs migrations.'}
                    </div>
                    {!ready ? (
                        <div className="mt-3 space-y-2">
                            {missingTables.map((probe) => (
                                <div key={probe.table}>
                                    <span className="font-semibold text-foreground">{probe.table}</span>: {probe.message ?? probe.status}
                                </div>
                            ))}
                            <div className="pt-2 text-[hsl(0_0%_76%)]">
                                Required order: {snapshot.required_migrations.join(' -> ')}
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {snapshot?.warnings.length ? (
                <div className="mt-4 border border-amber-300/25 bg-amber-300/10 p-3 text-xs leading-relaxed text-amber-100">
                    {snapshot.warnings.slice(0, 4).map((warning) => (
                        <div key={warning}>{warning}</div>
                    ))}
                </div>
            ) : null}

            {snapshot ? (
                <div className="mt-4 grid gap-4 xl:grid-cols-3">
                    <RecentList
                        title="Recent import jobs"
                        empty="No import jobs recorded yet."
                        rows={snapshot.recent_import_jobs.map((job) => ({
                            id: job.id,
                            title: `${job.dry_run ? 'Dry run' : 'Import'} · ${job.status}`,
                            detail: `${job.accepted_count}/${job.requested_cases} accepted · ${job.rejected_count} rejected · ${formatTimestamp(job.created_at)}`,
                            tone: job.status === 'failed' ? 'warn' : 'default',
                        }))}
                    />
                    <RecentList
                        title="Dataset versions"
                        empty="No dataset versions published yet."
                        rows={snapshot.recent_dataset_versions.map((version) => ({
                            id: version.id,
                            title: version.dataset_version ?? 'Unnamed dataset',
                            detail: `${version.dataset_kind ?? 'dataset'} · ${version.row_count} rows · ${formatTimestamp(version.created_at)}`,
                        }))}
                    />
                    <RecentList
                        title="Learning cycles"
                        empty="No learning cycles recorded yet."
                        rows={snapshot.recent_learning_cycles.map((cycle) => ({
                            id: cycle.id,
                            title: `${cycle.cycle_type ?? 'learning_cycle'} · ${cycle.status ?? 'unknown'}`,
                            detail: `${cycle.trigger_mode ?? 'manual'} · ${formatTimestamp(cycle.created_at)}`,
                            tone: cycle.status === 'failed' ? 'warn' : 'default',
                        }))}
                    />
                </div>
            ) : null}
        </section>
    );
}

function InfrastructureMetric({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'accent' | 'warn' }) {
    const toneClass = tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-amber-200' : 'text-foreground';
    return (
        <div className="border border-grid bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[hsl(0_0%_78%)]">{label}</div>
            <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
        </div>
    );
}

function RecentList({
    title,
    empty,
    rows,
}: {
    title: string;
    empty: string;
    rows: Array<{ id: string; title: string; detail: string; tone?: 'default' | 'warn' }>;
}) {
    return (
        <div className="border border-grid bg-background/40 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_68%)]">{title}</div>
            {rows.length > 0 ? (
                <div className="mt-3 space-y-2">
                    {rows.slice(0, 5).map((row) => (
                        <div key={row.id} className="border border-grid bg-black/20 p-2">
                            <div className={row.tone === 'warn' ? 'text-amber-200' : 'text-foreground'}>{row.title}</div>
                            <div className="mt-1 text-[11px] leading-relaxed text-[hsl(0_0%_68%)]">{row.detail}</div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="mt-3 text-xs text-[hsl(0_0%_72%)]">{empty}</div>
            )}
        </div>
    );
}

function formatTimestamp(value: string | null): string {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}
