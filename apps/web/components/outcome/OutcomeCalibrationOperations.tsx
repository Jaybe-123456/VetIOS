'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    CheckCircle2,
    DatabaseZap,
    Play,
    RefreshCw,
    ShieldAlert,
} from 'lucide-react';
import { ConsoleCard, DataRow } from '@/components/ui/terminal';

interface MaterializationExecution {
    mode: 'dry_run' | 'commit';
    algorithm_version: string;
    source_pair_count: number;
    source_inference_count: number;
    materialized_count: number;
    blocked_count: number;
    canonical_materialized_count: number;
    blocker_counts: Record<string, number>;
    warning_counts: Record<string, number>;
    source_digest: string;
    source_limit_reached: boolean;
    inserted_events: number;
    existing_events: number;
    aggregate_run_created: boolean;
    aggregate_run_reused: boolean;
    aggregate_run_id: string | null;
    aggregate: {
        run_status: string;
        bucket_count: number;
        eligible_rows: number;
        blockers: string[];
        warnings: string[];
    };
}

interface MaterializationSnapshot {
    execution: MaterializationExecution;
    persisted: {
        total_events: number;
        materialized_events: number;
        blocked_events: number;
        latest_materialized_at: string | null;
        recent_events: Array<Record<string, unknown>>;
    };
}

type LoadState = 'loading' | 'ready' | 'running' | 'error';

export function OutcomeCalibrationOperations() {
    const [snapshot, setSnapshot] = useState<MaterializationSnapshot | null>(null);
    const [state, setState] = useState<LoadState>('loading');
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setState('loading');
        setError(null);
        try {
            const response = await fetch('/api/platform/outcome-calibration', {
                credentials: 'same-origin',
                cache: 'no-store',
            });
            const body = await response.json();
            if (!response.ok) {
                throw new Error(formatError(body, 'Calibration evidence is unavailable.'));
            }
            setSnapshot(body.data as MaterializationSnapshot);
            setState('ready');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Calibration evidence is unavailable.');
            setState('error');
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    async function run(mode: 'dry_run' | 'commit') {
        setState('running');
        setError(null);
        try {
            const response = await fetch('/api/platform/outcome-calibration', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify({ mode }),
            });
            const body = await response.json();
            if (!response.ok) {
                throw new Error(formatError(body, 'Calibration materialization failed.'));
            }
            await refresh();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Calibration materialization failed.');
            setState('error');
        }
    }

    const execution = snapshot?.execution;
    const persisted = snapshot?.persisted;
    const busy = state === 'loading' || state === 'running';
    const blockerEntries = Object.entries(execution?.blocker_counts ?? {})
        .sort((left, right) => right[1] - left[1]);

    return (
        <div className="space-y-6 animate-scale-in">
            <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                    type="button"
                    title="Refresh calibration evidence"
                    aria-label="Refresh calibration evidence"
                    onClick={() => void refresh()}
                    disabled={busy}
                    className="inline-flex min-h-11 items-center justify-center border border-grid px-3 text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                </button>
                <button
                    type="button"
                    onClick={() => void run('dry_run')}
                    disabled={busy}
                    className="inline-flex min-h-11 items-center gap-2 border border-grid px-4 font-mono text-xs uppercase text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Play className="h-4 w-4" />
                    Dry Run
                </button>
                <button
                    type="button"
                    onClick={() => void run('commit')}
                    disabled={busy}
                    className="inline-flex min-h-11 items-center gap-2 border border-accent bg-accent px-4 font-mono text-xs font-bold uppercase text-black transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <DatabaseZap className="h-4 w-4" />
                    Commit
                </button>
            </div>

            {error && (
                <div className="flex items-start gap-3 border border-danger bg-danger/5 p-4 font-mono text-xs text-danger">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 break-words">{error}</span>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Metric label="Linked Pairs" value={execution?.source_pair_count} />
                <Metric label="Inferences" value={execution?.source_inference_count} />
                <Metric label="Ready" value={execution?.materialized_count} accent />
                <Metric label="Blocked" value={execution?.blocked_count} danger />
                <Metric label="Canonical" value={execution?.canonical_materialized_count} />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <ConsoleCard title="Materialization Ledger">
                    {execution ? (
                        <div className="space-y-1">
                            <DataRow
                                label="Algorithm"
                                value={<span className="break-all text-accent">{execution.algorithm_version}</span>}
                            />
                            <DataRow
                                label="Persisted"
                                value={`${persisted?.materialized_events ?? 0} materialized / ${persisted?.blocked_events ?? 0} blocked`}
                            />
                            <DataRow
                                label="Aggregate"
                                value={`${execution.aggregate.run_status} / ${execution.aggregate.bucket_count} buckets`}
                            />
                            <DataRow
                                label="Last Materialized"
                                value={formatTimestamp(persisted?.latest_materialized_at)}
                            />
                            <DataRow
                                label="Source Digest"
                                value={<span className="break-all text-muted">{execution.source_digest}</span>}
                            />
                            {execution.source_limit_reached && (
                                <div className="mt-3 border border-danger/60 bg-danger/5 p-3 font-mono text-xs text-danger">
                                    SOURCE ROW LIMIT REACHED
                                </div>
                            )}
                        </div>
                    ) : (
                        <LoadingLine />
                    )}
                </ConsoleCard>

                <ConsoleCard title="Evidence Blockers">
                    {blockerEntries.length > 0 ? (
                        <div className="space-y-2">
                            {blockerEntries.map(([code, count]) => (
                                <div
                                    key={code}
                                    className="flex min-h-10 items-center justify-between gap-4 border-b border-grid px-1 font-mono text-xs last:border-b-0"
                                >
                                    <span className="min-w-0 break-words text-muted">
                                        {formatCode(code)}
                                    </span>
                                    <span className="shrink-0 text-danger">{count}</span>
                                </div>
                            ))}
                        </div>
                    ) : execution ? (
                        <div className="flex min-h-24 items-center justify-center gap-2 font-mono text-xs text-accent">
                            <CheckCircle2 className="h-4 w-4" />
                            NO ACTIVE BLOCKERS
                        </div>
                    ) : (
                        <LoadingLine />
                    )}
                </ConsoleCard>
            </div>

            <ConsoleCard title="Recent Calibration Evidence">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse font-mono text-xs">
                        <thead>
                            <tr className="border-b border-grid text-left text-[10px] uppercase text-muted">
                                <th className="px-3 py-3 font-normal">Status</th>
                                <th className="px-3 py-3 font-normal">Authority</th>
                                <th className="px-3 py-3 font-normal">Confirmed</th>
                                <th className="px-3 py-3 font-normal">Predicted</th>
                                <th className="px-3 py-3 font-normal">Confidence</th>
                                <th className="px-3 py-3 font-normal">Observed</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(persisted?.recent_events ?? []).slice(0, 20).map((row) => {
                                const status = text(row.materialization_status);
                                return (
                                    <tr key={text(row.id)} className="border-b border-grid/70 last:border-b-0">
                                        <td className={status === 'materialized' ? 'px-3 py-3 text-accent' : 'px-3 py-3 text-danger'}>
                                            {status?.toUpperCase() ?? 'UNKNOWN'}
                                        </td>
                                        <td className="px-3 py-3 text-muted">{formatCode(text(row.authority_type))}</td>
                                        <td className="px-3 py-3 text-foreground">{formatCode(text(row.canonical_label))}</td>
                                        <td className="px-3 py-3 text-foreground">{formatCode(text(row.predicted_label))}</td>
                                        <td className="px-3 py-3 text-muted">{formatConfidence(row.top_label_confidence)}</td>
                                        <td className="px-3 py-3 text-muted">{formatTimestamp(text(row.observed_at))}</td>
                                    </tr>
                                );
                            })}
                            {(persisted?.recent_events.length ?? 0) === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-3 py-10 text-center text-muted">
                                        NO MATERIALIZATION EVENTS
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </ConsoleCard>
        </div>
    );
}

function Metric({
    label,
    value,
    accent = false,
    danger = false,
}: {
    label: string;
    value: number | undefined;
    accent?: boolean;
    danger?: boolean;
}) {
    const valueClass = danger ? 'text-danger' : accent ? 'text-accent' : 'text-foreground';
    return (
        <div className="min-w-0 border border-grid bg-dim/20 p-3">
            <div className="truncate font-mono text-[9px] uppercase text-muted">{label}</div>
            <div className={`mt-2 font-mono text-xl font-bold ${valueClass}`}>
                {value ?? '...'}
            </div>
        </div>
    );
}

function LoadingLine() {
    return (
        <div className="flex min-h-24 items-center justify-center gap-2 font-mono text-xs text-muted">
            <RefreshCw className="h-4 w-4 animate-spin" />
            LOADING EVIDENCE
        </div>
    );
}

function formatCode(value: string | null): string {
    return value ? value.replaceAll('_', ' ').toUpperCase() : 'UNKNOWN';
}

function formatTimestamp(value: string | null | undefined): string {
    if (!value) return 'NEVER';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatConfidence(value: unknown): string {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : 'N/A';
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatError(value: unknown, fallback: string): string {
    if (!value || typeof value !== 'object') return fallback;
    const record = value as Record<string, unknown>;
    const detail = text(record.detail);
    const error = text(record.error);
    return detail ?? error ?? fallback;
}
