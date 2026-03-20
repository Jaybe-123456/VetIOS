'use client';

import { useDeferredValue, useEffect, useMemo, useState, useTransition } from 'react';
import { Activity, AlertTriangle, BarChart3, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { ConsoleCard, Container, PageHeader, TerminalButton } from '@/components/ui/terminal';
import { ExperimentMetricChart } from '@/components/ExperimentMetricChart';
import { buildExperimentMetricSeries, getEmptyMetricStateMessage } from '@/lib/experiments/service';
import type {
    ExperimentComparison,
    ExperimentDashboardSnapshot,
    ExperimentRunDetail,
    ExperimentRunRecord,
} from '@/lib/experiments/types';

const CHART_COLORS = ['#00ff41', '#3b82f6', '#f59e0b', '#ef4444'];

export function ExperimentTrackingClient({
    initialSnapshot,
}: {
    initialSnapshot: ExperimentDashboardSnapshot;
}) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [selectedRunId, setSelectedRunId] = useState(initialSnapshot.selected_run_id);
    const [compareRunIds, setCompareRunIds] = useState<string[]>(initialSnapshot.comparison?.run_ids ?? []);
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [taskFilter, setTaskFilter] = useState('all');
    const [includeSummaryOnly, setIncludeSummaryOnly] = useState(true);
    const [isRefreshing, startRefreshTransition] = useTransition();
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());

    useEffect(() => {
        const hasActiveRuns = snapshot.summary.active_runs > 0;
        if (!hasActiveRuns) return;

        const refresh = () => {
            if (document.visibilityState !== 'visible') return;
            startRefreshTransition(() => {
                void refreshSnapshot(selectedRunId, compareRunIds, setSnapshot);
            });
        };

        const interval = window.setInterval(refresh, 15_000);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [snapshot.summary.active_runs, selectedRunId, compareRunIds]);

    const filteredRuns = useMemo(
        () => snapshot.runs.filter((run) => matchesRunFilter(run, deferredQuery, statusFilter, taskFilter, includeSummaryOnly)),
        [snapshot.runs, deferredQuery, statusFilter, taskFilter, includeSummaryOnly],
    );
    const selectedRunDetail = useMemo(
        () => resolveSelectedRunDetail(snapshot.selected_run_detail, selectedRunId, filteredRuns),
        [snapshot.selected_run_detail, selectedRunId, filteredRuns],
    );
    const comparison = useMemo(
        () => normalizeComparison(snapshot.comparison, compareRunIds),
        [snapshot.comparison, compareRunIds],
    );
    const chartSeries = useMemo(
        () => buildChartSeries(selectedRunDetail, comparison),
        [selectedRunDetail, comparison],
    );
    const statusOptions = useMemo(() => uniqueValues(snapshot.runs.map((run) => run.status)), [snapshot.runs]);
    const taskOptions = useMemo(() => uniqueValues(snapshot.runs.map((run) => run.task_type)), [snapshot.runs]);

    const handleRefresh = () => {
        startRefreshTransition(() => {
            void refreshSnapshot(selectedRunId, compareRunIds, setSnapshot);
        });
    };

    const handleSelectRun = (runId: string) => {
        setSelectedRunId(runId);
        startRefreshTransition(() => {
            void refreshSnapshot(runId, compareRunIds, setSnapshot);
        });
    };

    const handleToggleCompare = (runId: string) => {
        const next = compareRunIds.includes(runId)
            ? compareRunIds.filter((value) => value !== runId)
            : [...compareRunIds, runId].slice(-4);
        setCompareRunIds(next);
        startRefreshTransition(() => {
            void refreshSnapshot(selectedRunId, next, setSnapshot);
        });
    };

    return (
        <Container className="max-w-[96rem]">
            <PageHeader
                title="EXPERIMENT TRACKING"
                description="Operate experiment telemetry, failure diagnostics, safety benchmarks, dataset lineage, and model governance from one clinical MLOps surface."
            />

            <div className="mb-8 flex flex-col gap-4">
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <SummaryCard label="Total Runs" value={snapshot.summary.total_runs} />
                    <SummaryCard label="Active Runs" value={snapshot.summary.active_runs} tone={snapshot.summary.active_runs > 0 ? 'accent' : 'default'} />
                    <SummaryCard label="Failed Runs" value={snapshot.summary.failed_runs} tone={snapshot.summary.failed_runs > 0 ? 'warn' : 'default'} />
                    <SummaryCard label="Summary Only" value={snapshot.summary.summary_only_runs} />
                    <SummaryCard label="Telemetry Coverage" value={`${snapshot.summary.telemetry_coverage_pct}%`} />
                    <SummaryCard label="Registry Coverage" value={`${snapshot.summary.registry_link_coverage_pct}%`} />
                </div>

                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-1 items-center gap-2 border border-grid bg-black/20 px-3 py-2">
                        <Search className="h-4 w-4 text-muted" />
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="QUERY_RUNS (run id, model, dataset, status reason, task...)"
                            className="w-full bg-transparent font-mono text-sm text-foreground outline-none"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="border border-grid bg-black/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                            <option value="all">All Statuses</option>
                            {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)} className="border border-grid bg-black/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                            <option value="all">All Tasks</option>
                            {taskOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <label className="flex items-center gap-2 border border-grid bg-black/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
                            <input type="checkbox" checked={includeSummaryOnly} onChange={(event) => setIncludeSummaryOnly(event.target.checked)} className="accent-current" />
                            Include Summary Runs
                        </label>
                        <TerminalButton variant="secondary" onClick={handleRefresh}>
                            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                            Refresh
                        </TerminalButton>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Training Loss">
                    <ExperimentMetricChart
                        title="train_loss vs epoch"
                        metricKey="train_loss"
                        series={chartSeries}
                        emptyMessage={selectedRunDetail ? getEmptyMetricStateMessage(selectedRunDetail.run, selectedRunDetail.metrics) : 'Select a run to view metric telemetry.'}
                    />
                </ConsoleCard>
                <ConsoleCard title="Validation Accuracy">
                    <ExperimentMetricChart
                        title="val_accuracy vs epoch"
                        metricKey="val_accuracy"
                        series={chartSeries}
                        emptyMessage={selectedRunDetail ? getEmptyMetricStateMessage(selectedRunDetail.run, selectedRunDetail.metrics) : 'Select a run to view metric telemetry.'}
                    />
                </ConsoleCard>
                <ConsoleCard title="Validation Loss">
                    <ExperimentMetricChart
                        title="val_loss vs epoch"
                        metricKey="val_loss"
                        series={chartSeries}
                        emptyMessage={selectedRunDetail ? getEmptyMetricStateMessage(selectedRunDetail.run, selectedRunDetail.metrics) : 'Select a run to view metric telemetry.'}
                    />
                </ConsoleCard>
                <ConsoleCard title="Learning Rate">
                    <ExperimentMetricChart
                        title="learning_rate vs epoch"
                        metricKey="learning_rate"
                        series={chartSeries}
                        emptyMessage={selectedRunDetail ? getEmptyMetricStateMessage(selectedRunDetail.run, selectedRunDetail.metrics) : 'Select a run to view metric telemetry.'}
                    />
                </ConsoleCard>
                <ConsoleCard title="Gradient Norm">
                    <ExperimentMetricChart
                        title="gradient_norm vs epoch"
                        metricKey="gradient_norm"
                        series={chartSeries}
                        emptyMessage={selectedRunDetail ? getEmptyMetricStateMessage(selectedRunDetail.run, selectedRunDetail.metrics) : 'Select a run to view metric telemetry.'}
                    />
                </ConsoleCard>
                <ConsoleCard title="Safety Metric">
                    <ExperimentMetricChart
                        title="macro_f1 / recall_critical"
                        metricKey={selectedRunDetail?.run.task_type === 'severity_prediction' ? 'recall_critical' : 'macro_f1'}
                        series={chartSeries}
                        emptyMessage={selectedRunDetail ? getEmptyMetricStateMessage(selectedRunDetail.run, selectedRunDetail.metrics) : 'Select a run to view safety telemetry.'}
                    />
                </ConsoleCard>
            </div>

            <div className="mt-8 grid gap-8 xl:grid-cols-[1.2fr,0.8fr]">
                <ConsoleCard title="Experiment Runs">
                    {filteredRuns.length === 0 ? (
                        <EmptyPanel message="No experiment runs match the active filters. Summary-only historical runs remain hidden when that filter is off." />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-[1120px] w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-grid bg-black/40 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                                        <th className="p-3 font-normal">Compare</th>
                                        <th className="p-3 font-normal">RUN_ID</th>
                                        <th className="p-3 font-normal">Task</th>
                                        <th className="p-3 font-normal">Model</th>
                                        <th className="p-3 font-normal">Dataset</th>
                                        <th className="p-3 font-normal">Epochs</th>
                                        <th className="p-3 font-normal">Primary Metric</th>
                                        <th className="p-3 font-normal">Status</th>
                                        <th className="p-3 font-normal">Heartbeat</th>
                                        <th className="p-3 font-normal">Registry</th>
                                    </tr>
                                </thead>
                                <tbody className="font-mono text-sm">
                                    {filteredRuns.map((run) => {
                                        const selected = run.run_id === selectedRunId;
                                        return (
                                            <tr
                                                key={run.run_id}
                                                onClick={() => handleSelectRun(run.run_id)}
                                                className={`cursor-pointer border-b border-grid/20 transition-colors hover:bg-white/[0.03] ${selected ? 'bg-accent/10' : ''}`}
                                            >
                                                <td className="p-3" onClick={(event) => event.stopPropagation()}>
                                                    <input type="checkbox" checked={compareRunIds.includes(run.run_id)} onChange={() => handleToggleCompare(run.run_id)} className="accent-current" />
                                                </td>
                                                <td className="p-3 text-accent">{run.run_id}</td>
                                                <td className="p-3">{run.task_type}<div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-muted">{run.modality}</div></td>
                                                <td className="p-3">{run.model_arch}<div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-muted">{run.model_version ?? 'No model version'}</div></td>
                                                <td className="p-3">{run.dataset_name}<div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-muted">{run.dataset_version ?? 'No dataset version'}</div></td>
                                                <td className="p-3">{renderEpochs(run)}</td>
                                                <td className="p-3">{renderPrimaryMetric(run)}</td>
                                                <td className="p-3">{renderStatusBadge(run)}</td>
                                                <td className="p-3 text-xs text-muted">{formatHeartbeat(run.last_heartbeat_at)}</td>
                                                <td className="p-3 text-xs">{renderRegistryContext(run)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </ConsoleCard>

                <div className="space-y-6">
                    <ConsoleCard title="Active Monitoring">
                        {snapshot.summary.active_runs > 0 ? (
                            <div className="space-y-3">
                                {snapshot.summary.active_run_ids.map((runId) => (
                                    <div key={runId} className="flex items-center justify-between border border-grid bg-black/20 px-3 py-3 font-mono text-xs">
                                        <div className="flex items-center gap-2">
                                            <Activity className="h-4 w-4 animate-pulse text-accent" />
                                            {runId}
                                        </div>
                                        <span className="uppercase tracking-[0.15em] text-muted">live heartbeat</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyPanel message="No active runs are currently emitting heartbeat telemetry." compact />
                        )}
                    </ConsoleCard>

                    <ConsoleCard title="Comparison">
                        {comparison && comparison.runs.length > 1 ? (
                            <div className="space-y-4">
                                {comparison.runs.map((run) => (
                                    <div key={run.run_id} className="border border-grid bg-black/20 p-3">
                                        <div className="font-mono text-xs text-accent">{run.run_id}</div>
                                        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted">{run.model_arch} / {run.task_type}</div>
                                        <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
                                            <span>Primary metric: {renderPrimaryMetric(run)}</span>
                                            <span>Status: {run.status}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyPanel message="Select at least two runs in the table to compare sweeps, architectures, or datasets side by side." compact />
                        )}
                    </ConsoleCard>
                </div>
            </div>

            <div className="mt-8">
                <ConsoleCard title="Run Detail">
                    {!selectedRunDetail ? (
                        <EmptyPanel message="Select a run to inspect configuration, telemetry, failure diagnostics, artifacts, and registry status." />
                    ) : (
                        <RunDetail detail={selectedRunDetail} comparison={comparison} />
                    )}
                </ConsoleCard>
            </div>
        </Container>
    );
}

function RunDetail({
    detail,
    comparison,
}: {
    detail: ExperimentRunDetail;
    comparison: ExperimentComparison | null;
}) {
    const emptyMetricMessage = getEmptyMetricStateMessage(detail.run, detail.metrics);
    const registry = detail.registry_link;

    return (
        <div className="space-y-6">
            {detail.failure ? (
                <div className="border border-danger/40 bg-danger/10 p-4">
                    <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-danger">
                        <AlertTriangle className="h-4 w-4" />
                        Failure Diagnostics
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailStat label="Reason" value={detail.failure.failure_reason} />
                        <DetailStat label="Failure Epoch" value={detail.failure.failure_epoch != null ? String(detail.failure.failure_epoch) : 'n/a'} />
                        <DetailStat label="Failure Step" value={detail.failure.failure_step != null ? String(detail.failure.failure_step) : 'n/a'} />
                        <DetailStat label="NaN Detected" value={detail.failure.nan_detected ? 'Yes' : 'No'} />
                        <DetailStat label="Last Train Loss" value={formatNullableNumber(detail.failure.last_train_loss)} />
                        <DetailStat label="Last Val Loss" value={formatNullableNumber(detail.failure.last_val_loss)} />
                        <DetailStat label="Last LR" value={formatNullableNumber(detail.failure.last_learning_rate)} />
                        <DetailStat label="Last Gradient Norm" value={formatNullableNumber(detail.failure.last_gradient_norm)} />
                    </div>
                    {(detail.failure.error_summary || detail.failure.stack_trace_excerpt) ? (
                        <div className="mt-4 grid gap-3 xl:grid-cols-2">
                            <CodeBlock title="Error Summary" value={detail.failure.error_summary ?? 'No summary captured'} />
                            <CodeBlock title="Stack Trace Excerpt" value={detail.failure.stack_trace_excerpt ?? 'No stack trace excerpt captured'} />
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
                <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <DetailStat label="Run ID" value={detail.run.run_id} />
                        <DetailStat label="Task" value={detail.run.task_type} />
                        <DetailStat label="Modality" value={detail.run.modality} />
                        <DetailStat label="Target Type" value={detail.run.target_type ?? 'Not reported'} />
                        <DetailStat label="Model Arch" value={detail.run.model_arch} />
                        <DetailStat label="Model Version" value={detail.run.model_version ?? 'Not reported'} />
                        <DetailStat label="Status" value={`${detail.run.status}${detail.run.status_reason ? ` / ${detail.run.status_reason}` : ''}`} />
                        <DetailStat label="Progress" value={`${detail.run.progress_percent ?? 0}%`} />
                        <DetailStat label="Summary Only" value={detail.run.summary_only ? 'Yes' : 'No'} />
                    </div>

                    <CodeBlock title="Hyperparameters" value={stringifyJson(detail.run.hyperparameters, 'No hyperparameters recorded')} />
                    <CodeBlock title="Dataset Lineage" value={stringifyJson(detail.run.dataset_lineage, 'No dataset lineage recorded')} />
                    <CodeBlock title="Config Snapshot" value={stringifyJson(detail.run.config_snapshot, 'No config snapshot recorded')} />
                </div>

                <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        <DetailStat label="Dataset Version" value={detail.run.dataset_version ?? 'Not reported'} />
                        <DetailStat label="Feature Schema" value={detail.run.feature_schema_version ?? 'Not reported'} />
                        <DetailStat label="Label Policy" value={detail.run.label_policy_version ?? 'Not reported'} />
                        <DetailStat label="Epochs" value={renderEpochs(detail.run)} />
                        <DetailStat label="Primary Metric" value={renderPrimaryMetric(detail.run)} />
                        <DetailStat label="Last Heartbeat" value={formatHeartbeat(detail.run.last_heartbeat_at)} />
                        <DetailStat label="Registry Role" value={registry?.champion_or_challenger ?? 'Unlinked'} />
                        <DetailStat label="Promotion" value={registry?.promotion_status ?? 'Pending'} />
                        <DetailStat label="Calibration Gate" value={registry?.calibration_status ?? 'Pending'} />
                        <DetailStat label="Adversarial Gate" value={registry?.adversarial_gate_status ?? 'Pending'} />
                        <DetailStat label="Deployment Eligibility" value={registry?.deployment_eligibility ?? 'Pending review'} />
                        <DetailStat label="Missing Telemetry" value={detail.missing_telemetry_fields.length > 0 ? detail.missing_telemetry_fields.join(', ') : 'None'} />
                    </div>

                    <CodeBlock title="Safety Metrics" value={stringifyJson(detail.run.safety_metrics, 'No safety summary recorded')} />
                    <CodeBlock title="Resource Usage" value={stringifyJson(detail.run.resource_usage, emptyMetricMessage)} />
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
                <div className="space-y-4">
                    <div className="border border-grid bg-black/20 p-4">
                        <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                            <ShieldCheck className="h-4 w-4 text-accent" />
                            Benchmark Summary
                        </div>
                        <div className="space-y-2 font-mono text-xs">
                            {detail.benchmarks.length === 0 ? (
                                <span className="text-muted">No benchmark telemetry stored for this run.</span>
                            ) : detail.benchmarks.map((benchmark) => (
                                <div key={benchmark.id} className="flex items-center justify-between gap-3 border-b border-grid/20 pb-2">
                                    <span>{benchmark.benchmark_family}</span>
                                    <span className={benchmark.pass_status === 'pass' ? 'text-accent' : 'text-danger'}>
                                        {benchmark.summary_score != null ? benchmark.summary_score.toFixed(3) : 'n/a'} [{benchmark.pass_status}]
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border border-grid bg-black/20 p-4">
                        <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                            <BarChart3 className="h-4 w-4 text-accent" />
                            Artifacts
                        </div>
                        <div className="space-y-2 font-mono text-xs">
                            {detail.artifacts.length === 0 ? (
                                <span className="text-muted">No artifact lineage recorded for this run.</span>
                            ) : detail.artifacts.map((artifact) => (
                                <div key={artifact.id} className="border border-grid/40 bg-black/20 p-3">
                                    <div className="text-accent">{artifact.label ?? artifact.artifact_type}</div>
                                    <div className="mt-1 break-all text-muted">{artifact.uri ?? 'No URI recorded'}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    {comparison && comparison.runs.length > 1 ? (
                        <div className="border border-grid bg-black/20 p-4">
                            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Comparison Families</div>
                            <div className="space-y-2 font-mono text-xs">
                                {comparison.benchmark_summaries.length === 0 ? (
                                    <span className="text-muted">No comparison benchmarks available for the selected runs.</span>
                                ) : comparison.benchmark_summaries.map((benchmark) => (
                                    <div key={`${benchmark.run_id}:${benchmark.benchmark_family}`} className="flex items-center justify-between gap-3 border-b border-grid/20 pb-2">
                                        <span>{benchmark.run_id} / {benchmark.benchmark_family}</span>
                                        <span className={benchmark.pass_status === 'pass' ? 'text-accent' : 'text-danger'}>
                                            {benchmark.summary_score != null ? benchmark.summary_score.toFixed(3) : 'n/a'} [{benchmark.pass_status}]
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    <div className="border border-grid bg-black/20 p-4">
                        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Audit History</div>
                        <div className="space-y-2 font-mono text-xs">
                            {detail.audit_history.length === 0 ? (
                                <span className="text-muted">No learning audit events are currently linked to this run.</span>
                            ) : detail.audit_history.map((event, index) => (
                                <div key={`${event.event_type}:${event.created_at}:${index}`} className="border border-grid/40 bg-black/20 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-accent">{event.event_type}</span>
                                        <span className="text-muted">{formatDateTime(event.created_at)}</span>
                                    </div>
                                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-foreground/80">{stringifyJson(event.payload, '{}')}</pre>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

async function refreshSnapshot(
    selectedRunId: string | null,
    compareRunIds: string[],
    setSnapshot: (snapshot: ExperimentDashboardSnapshot) => void,
) {
    const url = new URL('/api/experiments/runs', window.location.origin);
    if (selectedRunId) {
        url.searchParams.set('selected_run_id', selectedRunId);
    }
    compareRunIds.forEach((runId) => url.searchParams.append('compare_run_id', runId));

    const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload?.snapshot) {
        setSnapshot(payload.snapshot);
    }
}

function resolveSelectedRunDetail(
    detail: ExperimentRunDetail | null,
    selectedRunId: string | null,
    runs: ExperimentRunRecord[],
) {
    if (detail && detail.run.run_id === selectedRunId) return detail;
    if (!selectedRunId) return null;
    const run = runs.find((candidate) => candidate.run_id === selectedRunId);
    return run ? null : null;
}

function normalizeComparison(
    comparison: ExperimentComparison | null,
    compareRunIds: string[],
) {
    if (!comparison) return null;
    const filteredRuns = comparison.runs.filter((run) => compareRunIds.includes(run.run_id));
    return filteredRuns.length > 1
        ? {
            ...comparison,
            runs: filteredRuns,
            run_ids: filteredRuns.map((run) => run.run_id),
            benchmark_summaries: comparison.benchmark_summaries.filter((item) => compareRunIds.includes(item.run_id)),
          }
        : null;
}

function buildChartSeries(
    detail: ExperimentRunDetail | null,
    comparison: ExperimentComparison | null,
) {
    if (comparison && comparison.runs.length > 1) {
        return comparison.runs.map((run, index) => ({
            runId: run.run_id,
            label: run.run_id,
            color: CHART_COLORS[index % CHART_COLORS.length],
            points: buildExperimentMetricSeries(comparison.metrics[run.run_id] ?? []),
        }));
    }
    if (!detail) return [];
    return [{
        runId: detail.run.run_id,
        label: detail.run.run_id,
        color: CHART_COLORS[0],
        points: buildExperimentMetricSeries(detail.metrics),
    }];
}

function matchesRunFilter(
    run: ExperimentRunRecord,
    query: string,
    statusFilter: string,
    taskFilter: string,
    includeSummaryOnly: boolean,
) {
    if (!includeSummaryOnly && run.summary_only) return false;
    if (statusFilter !== 'all' && run.status !== statusFilter) return false;
    if (taskFilter !== 'all' && run.task_type !== taskFilter) return false;
    if (!query) return true;

    return [
        run.run_id,
        run.task_type,
        run.modality,
        run.model_arch,
        run.model_version,
        run.dataset_name,
        run.dataset_version,
        run.status,
        run.status_reason,
    ].some((value) => String(value ?? '').toLowerCase().includes(query));
}

function renderEpochs(run: ExperimentRunRecord) {
    if (run.epochs_planned != null || run.epochs_completed != null) {
        return `${run.epochs_completed ?? 0} / ${run.epochs_planned ?? '?'}`;
    }
    return run.summary_only ? 'Summary only' : 'Not reported';
}

function renderPrimaryMetric(run: ExperimentRunRecord) {
    if (!run.metric_primary_name || run.metric_primary_value == null) {
        return run.summary_only ? 'Summary metric pending' : 'Telemetry pending';
    }
    return `${run.metric_primary_name}: ${run.metric_primary_value.toFixed(3)}`;
}

function renderRegistryContext(run: ExperimentRunRecord) {
    const role = String(run.registry_context.champion_or_challenger ?? '').trim();
    const status = String(run.registry_context.promotion_status ?? '').trim();
    if (!role && !status) return 'Unlinked';
    return [role, status].filter(Boolean).join(' / ');
}

function renderStatusBadge(run: ExperimentRunRecord) {
    const tone = run.status === 'failed'
        ? 'text-danger border-danger/30 bg-danger/10'
        : run.status === 'promoted'
            ? 'text-accent border-accent/30 bg-accent/10'
            : isActiveRun(run)
                ? 'text-accent border-accent/30 bg-accent/10'
                : 'text-muted border-grid bg-black/20';

    return (
        <span className={`inline-flex items-center gap-2 border px-2 py-1 text-[10px] uppercase tracking-[0.15em] ${tone}`}>
            {isActiveRun(run) ? <Activity className="h-3 w-3 animate-pulse" /> : null}
            {run.status}
        </span>
    );
}

function isActiveRun(run: ExperimentRunRecord) {
    return run.status === 'queued' ||
        run.status === 'initializing' ||
        run.status === 'training' ||
        run.status === 'validating' ||
        run.status === 'checkpointing';
}

function formatHeartbeat(value: string | null) {
    if (!value) return 'No heartbeat';
    return formatDateTime(value);
}

function formatNullableNumber(value: number | null) {
    return typeof value === 'number' ? value.toFixed(4) : 'n/a';
}

function formatDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function stringifyJson(value: Record<string, unknown>, fallback: string) {
    return Object.keys(value).length > 0
        ? JSON.stringify(value, null, 2)
        : fallback;
}

function uniqueValues(values: string[]) {
    return Array.from(new Set(values.filter(Boolean))).sort();
}

function SummaryCard({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'warn' | 'accent' }) {
    const toneClass = tone === 'warn' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-foreground';
    return (
        <div className="border border-grid bg-black/20 p-3 font-mono">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted">{label}</div>
            <div className={`mt-2 text-2xl ${toneClass}`}>{value}</div>
        </div>
    );
}

function EmptyPanel({ message, compact = false }: { message: string; compact?: boolean }) {
    return (
        <div className={`flex items-center justify-center border border-dashed border-grid bg-black/10 px-6 text-center font-mono text-xs text-muted ${compact ? 'min-h-[120px]' : 'min-h-[220px]'}`}>
            {message}
        </div>
    );
}

function DetailStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="border border-grid bg-black/20 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{label}</div>
            <div className="mt-2 break-all font-mono text-xs text-foreground/85">{value}</div>
        </div>
    );
}

function CodeBlock({ title, value }: { title: string; value: string }) {
    return (
        <div className="border border-grid bg-black/20 p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{title}</div>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-foreground/80">{value}</pre>
        </div>
    );
}
