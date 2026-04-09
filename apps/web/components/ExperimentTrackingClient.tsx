'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Gauge, RefreshCw, Search, ShieldAlert } from 'lucide-react';
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
type RegistryAction = 'promote_to_staging' | 'promote_to_production' | 'archive' | 'rollback';

export function ExperimentTrackingClient({
    initialSnapshot,
}: {
    initialSnapshot: ExperimentDashboardSnapshot;
}) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [selectedRunId, setSelectedRunId] = useState(initialSnapshot.selected_run_id);
    const [compareRunIds, setCompareRunIds] = useState<string[]>(
        initialSnapshot.comparison?.source === 'manual' ? initialSnapshot.comparison.run_ids : [],
    );
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [taskFilter, setTaskFilter] = useState('all');
    const [includeSummaryOnly, setIncludeSummaryOnly] = useState(true);
    const [isRefreshing, startRefreshTransition] = useTransition();
    const [isBootstrapping, startBootstrapTransition] = useTransition();
    const [bootstrapMessage, setBootstrapMessage] = useState<string | null>(null);
    const [bootstrapError, setBootstrapError] = useState<string | null>(null);
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());
    const hydratedInitialSnapshotRef = useRef(false);

    useEffect(() => {
        if (snapshot.summary.active_runs <= 0) return;

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

    useEffect(() => {
        if (hydratedInitialSnapshotRef.current) return;
        if (initialSnapshot.runs.length === 0) return;
        if (initialSnapshot.selected_run_detail || initialSnapshot.comparison) return;
        hydratedInitialSnapshotRef.current = true;

        startRefreshTransition(() => {
            void refreshSnapshot(selectedRunId ?? initialSnapshot.selected_run_id ?? null, compareRunIds, setSnapshot);
        });
    }, [compareRunIds, initialSnapshot.comparison, initialSnapshot.runs.length, initialSnapshot.selected_run_detail, initialSnapshot.selected_run_id, selectedRunId]);

    const filteredRuns = useMemo(
        () => snapshot.runs.filter((run) => matchesRunFilter(run, deferredQuery, statusFilter, taskFilter, includeSummaryOnly)),
        [snapshot.runs, deferredQuery, statusFilter, taskFilter, includeSummaryOnly],
    );
    const selectedRunDetail = useMemo(
        () => resolveSelectedRunDetail(snapshot.selected_run_detail, selectedRunId),
        [snapshot.selected_run_detail, selectedRunId],
    );
    const comparison = useMemo(
        () => normalizeComparison(snapshot.comparison, compareRunIds, selectedRunId),
        [snapshot.comparison, compareRunIds, selectedRunId],
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

    const handleBootstrap = () => {
        startBootstrapTransition(() => {
            void seedBootstrapSnapshot({
                setSnapshot,
                setSelectedRunId,
                setCompareRunIds,
                setMessage: setBootstrapMessage,
                setError: setBootstrapError,
            });
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
                title="EXPERIMENT TRACK"
                description="VetIOS Experiment Track is the reproducible AI research stack for veterinary institutions, capturing dataset versions, hyperparameters, model lineage, and comparisons behind every result."
            />

            <div className="mb-8">
                <ConsoleCard title="Reproducible AI Research Stack">
                    <div className="grid gap-4 xl:grid-cols-3">
                        <ResearchPositionCard
                            eyebrow="VERIFIABLE SCIENCE"
                            title="Turn result claims into evidence"
                            body="If a paper reports 94% sensitivity for feline hyperthyroidism, peer reviewers can inspect the exact dataset version, hyperparameters, metrics, and model lineage behind that number."
                        />
                        <ResearchPositionCard
                            eyebrow="WHY IT IS A STACK"
                            title="Every layer depends on the next"
                            body="Dataset versioning, hyperparameter logging, model registry lineage, and the comparison interface work as one system. Each record gives the others scientific meaning."
                        />
                        <ResearchPositionCard
                            eyebrow="RESEARCH INSTITUTIONS"
                            title="Built for independently reproducible work"
                            body="For institutions such as UoN Nairobi, ILRI, Cornell, and RVC, reproducibility is what turns a published result into something another lab can verify, trust, and cite."
                        />
                    </div>
                </ConsoleCard>
            </div>

            <div className="mb-8 flex flex-col gap-4">
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8">
                    <SummaryCard label="Total Runs" value={snapshot.summary.total_runs} />
                    <SummaryCard label="Active Runs" value={snapshot.summary.active_runs} tone={snapshot.summary.active_runs > 0 ? 'accent' : 'default'} tooltip="Runs counted as active must be in a live execution state and have a healthy heartbeat." />
                    <SummaryCard label="Failed Runs" value={snapshot.summary.failed_runs} tone={snapshot.summary.failed_runs > 0 ? 'warn' : 'default'} />
                    <SummaryCard label="Summary Only" value={snapshot.summary.summary_only_runs} tooltip="Historical or backfilled runs can still appear here. Some may include summary telemetry, but they do not have full worker-streamed traces." />
                    <SummaryCard label="Telemetry Coverage" value={`${snapshot.summary.telemetry_coverage_pct}%`} tooltip="Percentage of runs with stored metric telemetry, including aggregate validation, safety, calibration, or adversarial signals when epoch-level traces are unavailable." />
                    <SummaryCard label="Registry Coverage" value={`${snapshot.summary.registry_link_coverage_pct}%`} tooltip="Percentage of runs linked to a registry candidate or champion record." />
                    <SummaryCard label="Safety Signals" value={`${snapshot.summary.safety_metric_coverage_pct}%`} tooltip="Percentage of runs with any clinical safety telemetry present. This means the run has at least basic safety signal coverage, not that it is clinically deployment-ready." />
                    <SummaryCard label="Full Safety" value={`${snapshot.summary.full_safety_metric_coverage_pct}%`} tooltip="Percentage of runs with full clinical safety telemetry: macro F1, critical recall, false-negative critical rate, false reassurance, abstain accuracy, and contradiction detection." />
                </div>

                {snapshot.summary.total_runs === 0 && (
                    <ConsoleCard title="Initialization Required">
                        <div className="space-y-4 font-mono text-xs text-muted">
                            <p>
                                No experiment runs exist for this tenant yet. This screen only fills after a learning cycle materializes telemetry into <span className="text-foreground">experiment_runs</span>, or after you explicitly seed bootstrap smoke runs.
                            </p>
                            <p>
                                If you want real data, trigger a learning cycle. If you only want to validate the experiment UI, seed the bootstrap runs below.
                            </p>
                            {bootstrapMessage && (
                                <div className="border border-accent/40 bg-accent/10 px-3 py-2 text-accent">
                                    {bootstrapMessage}
                                </div>
                            )}
                            {bootstrapError && (
                                <div className="border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
                                    {bootstrapError}
                                </div>
                            )}
                            <div className="flex flex-wrap gap-3">
                                <TerminalButton variant="secondary" onClick={handleBootstrap} disabled={isBootstrapping}>
                                    <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isBootstrapping ? 'animate-spin' : ''}`} />
                                    Seed Bootstrap Runs
                                </TerminalButton>
                                <TerminalButton variant="secondary" onClick={handleRefresh} disabled={isRefreshing}>
                                    <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                                    Refresh Snapshot
                                </TerminalButton>
                            </div>
                        </div>
                    </ConsoleCard>
                )}

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
                <MetricCard title="Training Loss" metricTitle="train_loss vs epoch" metricKey="train_loss" chartSeries={chartSeries} selectedRunDetail={selectedRunDetail} />
                <MetricCard title="Validation Accuracy" metricTitle="val_accuracy vs epoch" metricKey="val_accuracy" chartSeries={chartSeries} selectedRunDetail={selectedRunDetail} />
                <MetricCard title="Validation Loss" metricTitle="val_loss vs epoch" metricKey="val_loss" chartSeries={chartSeries} selectedRunDetail={selectedRunDetail} />
                <MetricCard title="Learning Rate" metricTitle="learning_rate vs epoch" metricKey="learning_rate" chartSeries={chartSeries} selectedRunDetail={selectedRunDetail} />
                <MetricCard title="Gradient Norm" metricTitle="gradient_norm vs epoch" metricKey="gradient_norm" chartSeries={chartSeries} selectedRunDetail={selectedRunDetail} />
                <MetricCard
                    title="Safety Metric"
                    metricTitle={selectedRunDetail?.run.task_type === 'severity_prediction' ? 'recall_critical vs epoch' : 'macro_f1 vs epoch'}
                    metricKey={selectedRunDetail?.run.task_type === 'severity_prediction' ? 'recall_critical' : 'macro_f1'}
                    chartSeries={chartSeries}
                    selectedRunDetail={selectedRunDetail}
                />
            </div>

            <div className="mt-8 grid gap-8 xl:grid-cols-[1.2fr,0.8fr]">
                <ConsoleCard title="Experiment Runs">
                    {filteredRuns.length === 0 ? (
                        <EmptyPanel message="No experiment runs match the active filters. Summary-only historical runs remain hidden when that filter is off." />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-[1260px] w-full text-left border-collapse">
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
                                        <th className="p-3 font-normal">Registry Role</th>
                                        <th className="p-3 font-normal">Eligibility</th>
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
                                                <td className="p-3 text-xs">{renderHeartbeatCell(run)}</td>
                                                <td className="p-3 text-xs">{renderRegistryContext(run)}</td>
                                                <td className="p-3 text-xs">{renderEligibility(run)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </ConsoleCard>
                <div className="space-y-6">
                    <ConsoleCard title="Active Monitoring"><ActiveMonitoringPanel detail={selectedRunDetail} activeRunIds={snapshot.summary.active_run_ids} runs={snapshot.runs} /></ConsoleCard>
                    <ConsoleCard title="Comparison">{comparison && comparison.runs.length > 1 ? <ComparisonPanel comparison={comparison} /> : <EmptyPanel message="No comparable run pair is available yet. Once another structured run with the same task exists, this panel will auto-build a baseline comparison." compact />}</ConsoleCard>
                </div>
            </div>

            <div className="mt-8">
                <ConsoleCard title="Run Detail">
                    {!selectedRunDetail ? <EmptyPanel message="Select a run to inspect calibration, adversarial robustness, governance status, and clinical deployment eligibility." /> : <RunDetail detail={selectedRunDetail} comparison={comparison} onRefresh={handleRefresh} />}
                </ConsoleCard>
            </div>
        </Container>
    );
}

function MetricCard({
    title,
    metricTitle,
    metricKey,
    chartSeries,
    selectedRunDetail,
}: {
    title: string;
    metricTitle: string;
    metricKey: 'train_loss' | 'val_accuracy' | 'val_loss' | 'learning_rate' | 'gradient_norm' | 'macro_f1' | 'recall_critical';
    chartSeries: Array<{ runId: string; label: string; color: string; points: ReturnType<typeof buildExperimentMetricSeries> }>;
    selectedRunDetail: ExperimentRunDetail | null;
}) {
    return (
        <ConsoleCard title={title}>
            <ExperimentMetricChart
                title={metricTitle}
                metricKey={metricKey}
                series={chartSeries}
                emptyMessage={selectedRunDetail ? getEmptyMetricStateMessage(selectedRunDetail.run, selectedRunDetail.metrics) : 'Select a run to view metric telemetry.'}
            />
        </ConsoleCard>
    );
}

function RunDetail({
    detail,
    comparison,
    onRefresh,
}: {
    detail: ExperimentRunDetail;
    comparison: ExperimentComparison | null;
    onRefresh: () => void;
}) {
    const [registryMessage, setRegistryMessage] = useState<string | null>(null);
    const [registryError, setRegistryError] = useState<string | null>(null);
    const [isApplyingAction, startRegistryActionTransition] = useTransition();
    const emptyMetricMessage = getEmptyMetricStateMessage(detail.run, detail.metrics);
    const canStage = !isApplyingAction && (
        detail.model_registry?.lifecycle_status === 'candidate' ||
        detail.model_registry?.lifecycle_status === 'training'
    );
    const canPromoteProduction = !isApplyingAction &&
        detail.model_registry?.lifecycle_status === 'staging' &&
        detail.model_registry?.registry_role === 'challenger' &&
        detail.promotion_gating.can_promote &&
        detail.deployment_decision?.decision === 'approved';
    const canArchive = !isApplyingAction &&
        !(detail.model_registry?.lifecycle_status === 'production' && detail.model_registry?.registry_role === 'champion');
    const canRollback = !isApplyingAction &&
        detail.model_registry?.lifecycle_status === 'production' &&
        detail.model_registry?.registry_role === 'champion' &&
        (detail.model_registry.rollback_target != null || detail.last_stable_model != null);
    const promotionTooltip = detail.promotion_gating.tooltip;
    const isLiveProduction = detail.model_registry?.lifecycle_status === 'production' &&
        detail.model_registry?.registry_role === 'champion';
    const governanceNotes = dedupeText([
        !isLiveProduction && !detail.promotion_gating.can_promote ? detail.promotion_gating.tooltip : null,
        detail.deployment_decision?.reason ?? null,
        ...detail.decision_panel.reasons,
    ]);
    const operationalWatchlist = dedupeText([
        isLiveProduction && detail.adversarial_metrics?.adversarial_pass === false ? 'Adversarial gate has not passed.' : null,
        isLiveProduction && detail.safety_coverage !== 'full' ? 'Clinical safety evaluation is still pending.' : null,
    ]);
    const gradientSeries = useMemo(() => [{
        runId: detail.run.run_id,
        label: detail.run.run_id,
        color: CHART_COLORS[0],
        points: buildExperimentMetricSeries(detail.metrics),
    }], [detail.metrics, detail.run.run_id]);

    const handleRegistryAction = (action: RegistryAction) => {
        startRegistryActionTransition(() => {
            void postRegistryAction(detail.run.run_id, action, setRegistryMessage, setRegistryError, onRefresh);
        });
    };

    return (
        <div className="space-y-6">
            {detail.failure ? (
                <div className="border border-danger/40 bg-danger/10 p-4">
                    <div className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-danger">
                        <AlertTriangle className="h-4 w-4" />
                        Failure Diagnostics
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailStat label="Reason" value={detail.failure.failure_reason} />
                        <DetailStat label="Failure Epoch" value={detail.failure.failure_epoch != null ? String(detail.failure.failure_epoch) : 'n/a'} />
                        <DetailStat label="Failure Step" value={detail.failure.failure_step != null ? String(detail.failure.failure_step) : 'n/a'} />
                        <DetailStat label="NaN Detected" value={detail.failure.nan_detected ? 'Yes' : 'No'} />
                        <DetailStat label="Root Cause Class" value={detail.failure_guidance?.root_cause_classification ?? 'unknown'} />
                        <DetailStat label="Last Train Loss" value={formatMetricValue(detail.failure.last_train_loss)} />
                        <DetailStat label="Last Val Loss" value={formatMetricValue(detail.failure.last_val_loss)} />
                        <DetailStat label="Last LR" value={formatMetricValue(detail.failure.last_learning_rate, 'learning_rate')} />
                        <DetailStat label="Last Gradient Norm" value={formatMetricValue(detail.failure.last_gradient_norm)} />
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                        <ConsoleInset title="Suggested Cause">
                            <div className="font-mono text-xs text-foreground/85">
                                {detail.failure_guidance?.suggested_cause ?? 'No guidance generated yet.'}
                            </div>
                            <div className="mt-3 space-y-2">
                                {(detail.failure_guidance?.remediation_suggestions ?? []).map((suggestion) => (
                                    <div key={suggestion} className="border border-grid/40 bg-black/20 px-3 py-2 font-mono text-xs text-muted">
                                        {suggestion}
                                    </div>
                                ))}
                            </div>
                        </ConsoleInset>
                        <ConsoleInset title="Gradient Trajectory">
                            <ExperimentMetricChart
                                title="gradient_norm vs epoch"
                                metricKey="gradient_norm"
                                series={gradientSeries}
                                emptyMessage={emptyMetricMessage}
                            />
                        </ConsoleInset>
                    </div>
                    {(detail.failure.error_summary || detail.failure.stack_trace_excerpt) ? (
                        <div className="mt-4 grid gap-3 xl:grid-cols-2">
                            <CodeBlock title="Error Summary" value={detail.failure.error_summary ?? 'No summary captured'} />
                            <CodeBlock title="Stack Trace Excerpt" value={detail.failure.stack_trace_excerpt ?? 'No stack trace excerpt captured'} />
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
                <ConsoleInset title="Run Identity">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <DetailStat label="Run ID" value={detail.run.run_id} />
                        <DetailStat label="Task" value={detail.run.task_type} />
                        <DetailStat label="Modality" value={detail.run.modality} />
                        <DetailStat label="Target Type" value={detail.run.target_type ?? 'Not reported'} />
                        <DetailStat label="Model Arch" value={detail.run.model_arch} />
                        <DetailStat label="Model Version" value={detail.run.model_version ?? 'Not reported'} />
                        <DetailStat label="Status" value={formatRunStatus(detail.run)} />
                        <DetailStat label="Progress" value={`${detail.run.progress_percent ?? 0}%`} />
                        <DetailStat label="Created By" value={detail.run.created_by ?? 'system'} />
                    </div>
                </ConsoleInset>

                <ConsoleInset title="Governance Decision">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <DetailStat label="Registry ID" value={detail.model_registry?.registry_id ?? detail.run.registry_id ?? 'Pending candidate'} />
                        <DetailStat label="Registry Link" value={detail.registry_link_state.toUpperCase()} />
                        <DetailStat label="Registry Status" value={detail.model_registry?.status ?? 'candidate_pending'} />
                        <DetailStat label="Registry Role" value={detail.registry_role ?? 'Unlinked'} />
                        <DetailStat label="Calibration Gate" value={renderGateStatus(detail.calibration_metrics?.calibration_pass)} />
                        <DetailStat label="Adversarial Gate" value={renderGateStatus(detail.adversarial_metrics?.adversarial_pass)} />
                        <DetailStat label="Benchmark Gate" value={renderGateStatus(detail.promotion_requirements?.benchmark_pass)} />
                        <DetailStat label="Manual Approval" value={renderGateStatus(detail.promotion_requirements?.manual_approval)} />
                        <DetailStat label="Safety Coverage" value={detail.safety_coverage.toUpperCase()} />
                        <DetailStat label="Promotion Eligibility" value={renderPromotionEligibility(detail)} />
                        <DetailStat label="Deployment Decision" value={renderDeploymentDecision(detail)} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <TerminalButton
                            variant="secondary"
                            disabled={!canStage}
                            title={canStage ? 'Move this artifact into governed staging.' : 'Only training or candidate artifacts can enter staging.'}
                            onClick={() => handleRegistryAction('promote_to_staging')}
                        >
                            Promote Staging
                        </TerminalButton>
                        <TerminalButton
                            variant="secondary"
                            disabled={!canPromoteProduction}
                            title={canPromoteProduction ? 'Promote this staging challenger into production.' : detail.deployment_decision?.reason ?? promotionTooltip}
                            onClick={() => handleRegistryAction('promote_to_production')}
                        >
                            Promote Production
                        </TerminalButton>
                        <TerminalButton
                            variant="secondary"
                            disabled={!canArchive}
                            title={canArchive ? 'Archive this artifact.' : 'Archive is disabled for the active production champion.'}
                            onClick={() => handleRegistryAction('archive')}
                        >
                            Archive
                        </TerminalButton>
                        <TerminalButton
                            variant="secondary"
                            disabled={!canRollback}
                            title={canRollback ? 'Restore the last stable model.' : 'Rollback is unavailable until a rollback target exists.'}
                            onClick={() => handleRegistryAction('rollback')}
                        >
                            Rollback
                        </TerminalButton>
                    </div>
                    {registryMessage ? <div className="mt-3 font-mono text-xs text-accent">{registryMessage}</div> : null}
                    {registryError ? <div className="mt-3 font-mono text-xs text-danger">{registryError}</div> : null}
                    {operationalWatchlist.length > 0 ? (
                        <div className="mt-3 border border-grid bg-black/20 p-3 font-mono text-xs text-muted">
                            Operational watchlist: {operationalWatchlist.join(' ')}
                        </div>
                    ) : null}
                    {governanceNotes.length > 0 ? governanceNotes.map((note, index) => (
                        <div key={`${note}:${index}`} className={`${index === 0 ? 'mt-4' : 'mt-3'} border border-grid bg-black/20 p-3 font-mono text-xs text-foreground/85`}>
                            {note}
                        </div>
                    )) : (
                        <div className="mt-4 border border-grid bg-black/20 p-3 font-mono text-xs text-foreground/85">
                            Deployment decision will populate once calibration, adversarial, and clinical safety gates have all been evaluated.
                        </div>
                    )}
                </ConsoleInset>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
                <CalibrationPanel detail={detail} />
                <AdversarialPanel detail={detail} />
                <SafetyPanel detail={detail} />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <ConsoleInset title="Active Monitoring">
                    <ActiveRunTelemetry detail={detail} emptyMessage={emptyMetricMessage} />
                </ConsoleInset>
                <ConsoleInset title="Subgroup Performance">
                    <SubgroupMetricsPanel detail={detail} />
                </ConsoleInset>
            </div>

            <ContinuousLearningEvidencePanel detail={detail} />

            <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
                <div className="space-y-4">
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
                        <DetailStat label="Heartbeat Freshness" value={renderDetailHeartbeatFreshness(detail)} />
                        <DetailStat label="Best Checkpoint URI" value={detail.artifact_uris.best_checkpoint_uri ?? 'Not recorded'} />
                        <DetailStat label="Checkpoint URI" value={detail.artifact_uris.checkpoint_uri ?? 'Not recorded'} />
                        <DetailStat label="Log URI" value={detail.artifact_uris.log_uri ?? 'Not recorded'} />
                        <DetailStat label="Calibration Report URI" value={detail.artifact_uris.calibration_report_uri ?? 'Not recorded'} />
                        <DetailStat label="Adversarial Report URI" value={detail.artifact_uris.adversarial_report_uri ?? 'Not recorded'} />
                        <DetailStat label="Benchmark Report URI" value={detail.artifact_uris.benchmark_report_uri ?? 'Not recorded'} />
                        <DetailStat label="Missing Telemetry" value={detail.missing_telemetry_fields.length > 0 ? detail.missing_telemetry_fields.join(', ') : 'None'} />
                    </div>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
                <ConsoleInset title="Benchmark Summary">
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
                </ConsoleInset>

                <ConsoleInset title="Artifacts">
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
                </ConsoleInset>
            </div>

            {comparison && comparison.runs.length > 1 ? (
                <ConsoleInset title="Comparison Deltas">
                    <ComparisonPanel comparison={comparison} compact />
                </ConsoleInset>
            ) : null}

            <ConsoleInset title="Audit History">
                <div className="space-y-2 font-mono text-xs">
                    {detail.audit_history.length === 0 ? (
                        <span className="text-muted">No experiment or learning audit events are currently linked to this run.</span>
                    ) : detail.audit_history.map((event, index) => (
                        <div key={`${event.event_type}:${event.created_at}:${index}`} className="border border-grid/40 bg-black/20 p-3">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-accent">{event.event_type}</span>
                                <span className="text-muted">{formatDateTime(event.created_at)}</span>
                            </div>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-muted">{event.actor ?? 'system'}</div>
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-foreground/80">{stringifyJson(event.payload, '{}')}</pre>
                        </div>
                    ))}
                </div>
            </ConsoleInset>
        </div>
    );
}

function CalibrationPanel({ detail }: { detail: ExperimentRunDetail }) {
    const calibration = detail.calibration_metrics;
    return (
        <ConsoleInset title="Calibration">
            {calibration ? (
                <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        <DetailStat label="ECE" value={formatMetricValue(calibration.ece)} />
                        <DetailStat label="Brier Score" value={formatMetricValue(calibration.brier_score)} />
                        <DetailStat label="Calibration Gate" value={renderGateStatus(calibration.calibration_pass)} />
                        <DetailStat label="Notes" value={calibration.calibration_notes ?? 'No notes recorded'} />
                    </div>
                    <ReliabilityCurve bins={calibration.reliability_bins} />
                    <ConfidenceHistogram bins={calibration.confidence_histogram} />
                </div>
            ) : (
                <EmptyPanel message={isGovernanceReviewState(detail.run.status) ? 'Calibration evaluation data is missing for this completed run and should be backfilled before promotion review.' : 'Calibration metrics have not been computed for this run yet.'} compact />
            )}
        </ConsoleInset>
    );
}

function AdversarialPanel({ detail }: { detail: ExperimentRunDetail }) {
    const adversarial = detail.adversarial_metrics;
    return (
        <ConsoleInset title="Adversarial">
            {adversarial ? (
                <div className="grid gap-3 md:grid-cols-2">
                    <DetailStat label="Degradation Score" value={formatMetricValue(adversarial.degradation_score)} />
                    <DetailStat label="Contradiction Robustness" value={formatMetricValue(adversarial.contradiction_robustness)} />
                    <DetailStat label="Critical Recall" value={formatMetricValue(adversarial.critical_case_recall)} />
                    <DetailStat label="Dangerous False Reassurance" value={formatMetricValue(adversarial.dangerous_false_reassurance_rate ?? adversarial.false_reassurance_rate)} />
                    <DetailStat label="Adversarial Gate" value={renderGateStatus(adversarial.adversarial_pass)} />
                    <DetailStat label="Gate Summary" value={adversarial.adversarial_pass ? 'Stable under contradiction stress.' : 'Blocked by degradation or safety regression.'} />
                </div>
            ) : (
                <EmptyPanel message={isGovernanceReviewState(detail.run.status) ? 'Adversarial evaluation data is missing for this completed run and should be backfilled before promotion review.' : 'Adversarial benchmark metrics have not been stored for this run yet.'} compact />
            )}
        </ConsoleInset>
    );
}

function SafetyPanel({ detail }: { detail: ExperimentRunDetail }) {
    const latest = detail.latest_metric;
    return (
        <ConsoleInset title="Clinical Safety">
            <div className="grid gap-3 md:grid-cols-2">
                <DetailStat label="Coverage" value={detail.safety_coverage.toUpperCase()} />
                <DetailStat label="Macro F1" value={formatMetricValue(latest?.macro_f1 ?? readNumber(detail.run.safety_metrics, 'macro_f1'))} />
                <DetailStat label="Critical Recall" value={formatMetricValue(latest?.recall_critical ?? readNumber(detail.run.safety_metrics, 'recall_critical'))} />
                <DetailStat label="FN Critical Rate" value={formatMetricValue(latest?.false_negative_critical_rate ?? readNumber(detail.run.safety_metrics, 'false_negative_critical_rate'))} />
                <DetailStat label="False Reassurance" value={formatMetricValue(latest?.dangerous_false_reassurance_rate ?? readNumber(detail.run.safety_metrics, 'dangerous_false_reassurance_rate'))} />
                <DetailStat label="Abstain Accuracy" value={formatMetricValue(latest?.abstain_accuracy ?? readNumber(detail.run.safety_metrics, 'abstain_accuracy'))} />
                <DetailStat label="Contradiction Detection" value={formatMetricValue(latest?.contradiction_detection_rate ?? readNumber(detail.run.safety_metrics, 'contradiction_detection_rate'))} />
            </div>
        </ConsoleInset>
    );
}

function ActiveMonitoringPanel({
    detail,
    activeRunIds,
    runs,
}: {
    detail: ExperimentRunDetail | null;
    activeRunIds: string[];
    runs: ExperimentRunRecord[];
}) {
    if (detail && isActiveRun(detail.run)) {
        return <ActiveRunTelemetry detail={detail} emptyMessage="No live telemetry available for the selected active run yet." />;
    }

    if (detail?.latest_metric) {
        return (
            <div className="space-y-3">
                <div className="border border-grid bg-black/20 px-3 py-3 font-mono text-xs text-muted">
                    No runs are actively heartbeating right now. Showing the latest structured monitoring evidence for the selected run so telemetry, calibration, and safety context stay reviewable.
                </div>
                <ActiveRunTelemetry detail={detail} emptyMessage="No stored telemetry is available for the selected run." />
            </div>
        );
    }

    if (activeRunIds.length === 0) {
        const recentRuns = runs
            .filter((run) => run.last_heartbeat_at || run.metric_primary_value != null)
            .sort((left, right) => (right.last_heartbeat_at ?? right.updated_at).localeCompare(left.last_heartbeat_at ?? left.updated_at))
            .slice(0, 3);
        if (recentRuns.length === 0) {
            return <EmptyPanel message="No active runs are currently emitting heartbeat telemetry." compact />;
        }

        return (
            <div className="space-y-3">
                <div className="border border-grid bg-black/20 px-3 py-3 font-mono text-xs text-muted">
                    No runs are actively heartbeating right now. Most recent monitored runs are shown below for clinical accountability continuity.
                </div>
                {recentRuns.map((run) => (
                    <div key={run.run_id} className="flex items-center justify-between border border-grid bg-black/20 px-3 py-3 font-mono text-xs">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <Gauge className="h-4 w-4 text-accent" />
                                <span className="text-accent">{run.run_id}</span>
                            </div>
                            <div className="text-muted">
                                last heartbeat {formatHeartbeat(run.last_heartbeat_at)} | primary {renderPrimaryMetric(run)}
                            </div>
                        </div>
                        <FreshnessBadge freshness={classifyHeartbeat(run)} />
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {activeRunIds.map((runId) => (
                <div key={runId} className="flex items-center justify-between border border-grid bg-black/20 px-3 py-3 font-mono text-xs">
                    <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 animate-pulse text-accent" />
                        {runId}
                    </div>
                    <span className="uppercase tracking-[0.15em] text-muted">live heartbeat</span>
                </div>
            ))}
        </div>
    );
}

function ActiveRunTelemetry({
    detail,
    emptyMessage,
}: {
    detail: ExperimentRunDetail;
    emptyMessage: string;
}) {
    const latest = detail.latest_metric;
    if (!latest) {
        return <EmptyPanel message={emptyMessage} compact />;
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between border border-grid bg-black/20 px-3 py-3 font-mono text-xs">
                <div className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-accent" />
                    {detail.run.run_id}
                </div>
                <FreshnessBadge freshness={detail.heartbeat_freshness} />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <DetailStat label="Current Epoch" value={latest.epoch != null ? String(latest.epoch) : 'n/a'} />
                <DetailStat label="Train Loss" value={formatMetricValue(latest.train_loss)} />
                <DetailStat label="Val Loss" value={formatMetricValue(latest.val_loss)} />
                <DetailStat label="Learning Rate" value={formatMetricValue(latest.learning_rate, 'learning_rate')} />
                <DetailStat label="Gradient Norm" value={formatMetricValue(latest.gradient_norm)} />
                <DetailStat label="Steps / Sec" value={formatMetricValue(latest.steps_per_second)} />
                <DetailStat label="GPU Utilization" value={formatPercent(latest.gpu_utilization)} />
                <DetailStat label="CPU Utilization" value={formatPercent(latest.cpu_utilization)} />
                <DetailStat label="Memory Utilization" value={formatPercent(latest.memory_utilization)} />
                <DetailStat label="Heartbeat" value={formatHeartbeat(detail.run.last_heartbeat_at)} />
                <DetailStat label="Progress" value={`${detail.run.progress_percent ?? 0}%`} />
                <DetailStat label="Epoch Plan" value={renderEpochs(detail.run)} />
            </div>
        </div>
    );
}

function ComparisonPanel({
    comparison,
    compact = false,
}: {
    comparison: ExperimentComparison;
    compact?: boolean;
}) {
    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                <span>Baseline: {comparison.run_ids[0] ?? 'n/a'}</span>
                <span>{comparison.source === 'automatic' ? 'Auto baseline' : 'Manual comparison'} | {comparison.rationale}</span>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-grid bg-black/30 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                            <th className="p-3 font-normal">Run</th>
                            <th className="p-3 font-normal">Macro F1</th>
                            <th className="p-3 font-normal">Critical Recall</th>
                            <th className="p-3 font-normal">ECE</th>
                            <th className="p-3 font-normal">Degradation</th>
                            <th className="p-3 font-normal">Decision</th>
                            <th className="p-3 font-normal">Hyperparameter Diff</th>
                            <th className="p-3 font-normal">Dataset Diff</th>
                        </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                        {comparison.comparison_rows.map((row) => (
                            <tr key={row.run_id} className="border-b border-grid/20">
                                <td className="p-3 text-accent">{row.run_id}</td>
                                <td className="p-3">{renderDeltaCell(row.macro_f1, row.macro_f1_delta)}</td>
                                <td className="p-3">{renderDeltaCell(row.recall_critical, row.recall_critical_delta)}</td>
                                <td className="p-3">{renderDeltaCell(row.ece, row.ece_delta, true)}</td>
                                <td className="p-3">{renderDeltaCell(row.degradation_score, row.degradation_delta, true)}</td>
                                <td className="p-3">{comparison.decisions[row.run_id]?.decision ?? 'pending'}</td>
                                <td className="p-3">{row.hyperparameter_diff.length > 0 ? row.hyperparameter_diff.join(', ') : 'No diff'}</td>
                                <td className="p-3">{row.dataset_diff.length > 0 ? row.dataset_diff.join(', ') : 'No diff'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!compact ? (
                <div className="grid gap-3 xl:grid-cols-2">
                    <ConsoleInset title="Calibration / Adversarial Gates">
                        <div className="space-y-2 font-mono text-xs">
                            {comparison.run_ids.map((runId) => (
                                <div key={runId} className="flex items-center justify-between gap-3 border-b border-grid/20 pb-2">
                                    <span>{runId}</span>
                                    <span className="text-muted">
                                        cal={renderGateStatus(comparison.calibration[runId]?.calibration_pass)} / adv={renderGateStatus(comparison.adversarial[runId]?.adversarial_pass)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </ConsoleInset>
                    <ConsoleInset title="Benchmark Families">
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
                    </ConsoleInset>
                </div>
            ) : null}
        </div>
    );
}

function ContinuousLearningEvidencePanel({ detail }: { detail: ExperimentRunDetail }) {
    const evidenceRows = [
        {
            label: 'Iteration Telemetry',
            value: detail.missing_telemetry_fields.length === 0
                ? `${detail.metrics.length} metric events / complete`
                : `${detail.metrics.length} metric events / missing ${detail.missing_telemetry_fields.length} fields`,
        },
        {
            label: 'Calibration Evidence',
            value: detail.calibration_metrics ? `READY / ECE ${formatMetricValue(detail.calibration_metrics.ece)}` : 'MISSING',
        },
        {
            label: 'Adversarial Evidence',
            value: detail.adversarial_metrics ? `READY / degradation ${formatMetricValue(detail.adversarial_metrics.degradation_score)}` : 'MISSING',
        },
        {
            label: 'Clinical Safety',
            value: detail.safety_coverage === 'none' ? 'MISSING' : detail.safety_coverage.toUpperCase(),
        },
        {
            label: 'Benchmark Trail',
            value: detail.benchmarks.length > 0 ? `${detail.benchmarks.length} benchmark report(s)` : 'MISSING',
        },
        {
            label: 'Dataset Lineage',
            value: detail.lineage?.dataset_version ?? detail.run.dataset_version ?? 'MISSING',
        },
        {
            label: 'Registry Trace',
            value: detail.registry_link_state.toUpperCase(),
        },
        {
            label: 'Audit Trail',
            value: `${detail.audit_history.length} linked event(s)`,
        },
    ];
    const accountabilityGaps = [
        detail.missing_telemetry_fields.length > 0 ? `metric stream gaps: ${detail.missing_telemetry_fields.join(', ')}` : null,
        !detail.calibration_metrics ? 'calibration evidence missing' : null,
        !detail.adversarial_metrics ? 'adversarial evidence missing' : null,
        detail.safety_coverage === 'none' ? 'clinical safety metrics missing' : null,
        detail.benchmarks.length === 0 ? 'benchmark evidence missing' : null,
        detail.audit_history.length === 0 ? 'audit trail missing' : null,
    ].filter(Boolean) as string[];
    const clinicalGradeGaps = [
        detail.safety_coverage !== 'full' ? `clinical safety coverage is ${detail.safety_coverage}` : null,
        detail.calibration_metrics?.calibration_pass === false ? 'calibration gate failed' : null,
        detail.adversarial_metrics?.adversarial_pass === false ? 'adversarial gate failed' : null,
        detail.promotion_requirements?.benchmark_pass === false ? 'benchmark gate failed' : null,
        detail.promotion_requirements?.manual_approval === false ? 'manual approval denied' : null,
        detail.deployment_decision?.decision === 'rejected' ? 'deployment decision is rejected' : null,
    ].filter(Boolean) as string[];

    return (
        <ConsoleInset title="Continuous Learning Evidence">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {evidenceRows.map((row) => (
                    <DetailStat key={row.label} label={row.label} value={row.value} />
                ))}
            </div>
            <div className="mt-4 border border-grid bg-black/20 p-3 font-mono text-xs text-foreground/85">
                {accountabilityGaps.length > 0
                    ? `Structured evidence is still incomplete: ${accountabilityGaps.join('; ')}.`
                    : clinicalGradeGaps.length > 0
                        ? `Structured accountability evidence is available, but clinical-grade readiness is still limited: ${clinicalGradeGaps.join('; ')}.`
                        : 'Model iterations are linked to telemetry, governance evidence, lineage, and audit history, and the run is clinically ready for governance review.'}
            </div>
        </ConsoleInset>
    );
}

function SubgroupMetricsPanel({ detail }: { detail: ExperimentRunDetail }) {
    if (detail.subgroup_metrics.length === 0) {
        return <EmptyPanel message="No subgroup performance metrics stored for this run yet." compact />;
    }

    return (
        <div className="overflow-x-auto">
            <table className="min-w-[520px] w-full text-left border-collapse">
                <thead>
                    <tr className="border-b border-grid bg-black/30 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                        <th className="p-3 font-normal">Group</th>
                        <th className="p-3 font-normal">Value</th>
                        <th className="p-3 font-normal">Metric</th>
                        <th className="p-3 font-normal">Score</th>
                    </tr>
                </thead>
                <tbody className="font-mono text-xs">
                    {detail.subgroup_metrics.map((metric) => (
                        <tr key={metric.id} className="border-b border-grid/20">
                            <td className="p-3">{metric.group}</td>
                            <td className="p-3">{metric.group_value}</td>
                            <td className="p-3">{metric.metric}</td>
                            <td className="p-3">{metric.value.toFixed(3)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ReliabilityCurve({
    bins,
}: {
    bins: Array<{ confidence: number; accuracy: number; count: number }>;
}) {
    if (bins.length === 0) {
        return <EmptyPanel message="No reliability bins are available for this run yet." compact />;
    }

    return (
        <div className="space-y-3">
            {bins.map((bin, index) => (
                <div key={`${bin.confidence}:${bin.accuracy}:${index}`} className="space-y-1 font-mono text-xs">
                    <div className="flex items-center justify-between gap-3 text-muted">
                        <span>bin {index + 1}</span>
                        <span>conf {bin.confidence.toFixed(2)} / acc {bin.accuracy.toFixed(2)} / n={bin.count}</span>
                    </div>
                    <div className="grid gap-2">
                        <div className="h-2 overflow-hidden border border-grid bg-black/20">
                            <div className="h-full bg-blue-500/70" style={{ width: `${Math.max(2, bin.confidence * 100)}%` }} />
                        </div>
                        <div className="h-2 overflow-hidden border border-grid bg-black/20">
                            <div className="h-full bg-accent/80" style={{ width: `${Math.max(2, bin.accuracy * 100)}%` }} />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function ConfidenceHistogram({
    bins,
}: {
    bins: Array<{ confidence: number; count: number }>;
}) {
    if (bins.length === 0) {
        return <EmptyPanel message="No confidence histogram source data is stored for this run yet." compact />;
    }

    const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
    return (
        <div className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Confidence Histogram</div>
            {bins.map((bin, index) => (
                <div key={`${bin.confidence}:${index}`} className="space-y-1 font-mono text-xs">
                    <div className="flex items-center justify-between gap-3 text-muted">
                        <span>{bin.confidence.toFixed(2)}</span>
                        <span>n={bin.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden border border-grid bg-black/20">
                        <div className="h-full bg-accent/80" style={{ width: `${Math.max(3, (bin.count / maxCount) * 100)}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

async function postRegistryAction(
    runId: string,
    action: RegistryAction,
    setMessage: (value: string | null) => void,
    setError: (value: string | null) => void,
    onRefresh: () => void,
) {
    setMessage(null);
    setError(null);

    try {
        const response = await fetch(`/api/experiments/runs/${runId}/registry`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(typeof payload?.error === 'string' ? payload.error : 'Registry action failed.');
        }
        setMessage(`Registry action applied: ${action}`);
        onRefresh();
    } catch (error) {
        setError(error instanceof Error ? error.message : 'Registry action failed.');
    }
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

async function seedBootstrapSnapshot(input: {
    setSnapshot: (snapshot: ExperimentDashboardSnapshot) => void;
    setSelectedRunId: (runId: string | null) => void;
    setCompareRunIds: (runIds: string[]) => void;
    setMessage: (value: string | null) => void;
    setError: (value: string | null) => void;
}) {
    input.setMessage(null);
    input.setError(null);

    try {
        const response = await fetch('/api/experiments/bootstrap', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to seed bootstrap runs.');
        }
        if (payload?.snapshot) {
            input.setSnapshot(payload.snapshot);
            input.setSelectedRunId(payload.snapshot.selected_run_id ?? null);
            input.setCompareRunIds([]);
        }

        const seededCount = typeof payload?.summary?.total_runs === 'number'
            ? payload.summary.total_runs
            : typeof payload?.summary?.seeded_run_ids?.length === 'number'
                ? payload.summary.seeded_run_ids.length
                : null;
        input.setMessage(
            seededCount != null
                ? `Bootstrap experiment tracking initialized with ${seededCount} run${seededCount === 1 ? '' : 's'}.`
                : 'Bootstrap experiment tracking initialized.',
        );
    } catch (error) {
        input.setError(error instanceof Error ? error.message : 'Failed to seed bootstrap runs.');
    }
}

function resolveSelectedRunDetail(
    detail: ExperimentRunDetail | null,
    selectedRunId: string | null,
) {
    if (!detail) return null;
    return detail.run.run_id === selectedRunId ? detail : null;
}

function normalizeComparison(
    comparison: ExperimentComparison | null,
    compareRunIds: string[],
    selectedRunId: string | null,
) {
    if (!comparison) return null;
    const requestedRunIds = compareRunIds.length === 0
        ? comparison.run_ids
        : compareRunIds.length === 1 && selectedRunId && !compareRunIds.includes(selectedRunId)
            ? [selectedRunId, ...compareRunIds]
            : compareRunIds;
    const filteredRuns = comparison.runs.filter((run) => requestedRunIds.includes(run.run_id));
    const allowedRunIds = new Set(filteredRuns.map((run) => run.run_id));
    if (filteredRuns.length <= 1) return null;

    return {
        ...comparison,
        runs: filteredRuns,
        run_ids: filteredRuns.map((run) => run.run_id),
        benchmark_summaries: comparison.benchmark_summaries.filter((item) => allowedRunIds.has(item.run_id)),
        comparison_rows: comparison.comparison_rows.filter((item) => allowedRunIds.has(item.run_id)),
        calibration: Object.fromEntries(Object.entries(comparison.calibration).filter(([runId]) => allowedRunIds.has(runId))),
        adversarial: Object.fromEntries(Object.entries(comparison.adversarial).filter(([runId]) => allowedRunIds.has(runId))),
        decisions: Object.fromEntries(Object.entries(comparison.decisions).filter(([runId]) => allowedRunIds.has(runId))),
        metrics: Object.fromEntries(Object.entries(comparison.metrics).filter(([runId]) => allowedRunIds.has(runId))),
    };
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
    return `${run.metric_primary_name}: ${formatMetricValue(run.metric_primary_value, run.metric_primary_name)}`;
}

function renderHeartbeatCell(run: ExperimentRunRecord) {
    const heartbeatLabel = renderHeartbeatStateLabel(run);
    return (
        <div className="flex flex-col gap-1">
            <span>{heartbeatLabel}</span>
            <span className="text-muted">{formatHeartbeat(run.last_heartbeat_at)}</span>
        </div>
    );
}

function renderRegistryContext(run: ExperimentRunRecord) {
    const fallbackLinkState = run.registry_id
        ? 'linked'
        : run.status === 'failed' || run.status === 'aborted'
            ? 'unlinked'
            : isGovernanceReviewState(run.status)
                ? 'pending'
                : 'unlinked';
    const linkState = String(run.registry_context.registry_link_state ?? fallbackLinkState).trim();
    const role = String(run.registry_context.registry_role ?? run.registry_context.champion_or_challenger ?? '').trim();
    return [linkState, role].filter(Boolean).join(' / ');
}

function renderEligibility(run: ExperimentRunRecord) {
    if (run.status === 'failed' || run.status === 'aborted' || run.status === 'interrupted' || run.status === 'stalled') {
        return 'BLOCKED';
    }
    const registryRole = String(run.registry_context.registry_role ?? '').trim().toLowerCase();
    const registryStatus = String(run.registry_context.registry_status ?? run.registry_context.promotion_status ?? '').trim().toLowerCase();
    const eligibility = String(run.registry_context.deployment_eligibility ?? 'Pending review').trim().toLowerCase();

    if (registryRole === 'champion' && registryStatus === 'production') {
        return 'LIVE / PRODUCTION';
    }
    if (eligibility === 'live_production') {
        return 'LIVE / PRODUCTION';
    }
    if (eligibility === 'rollback_target') {
        return 'ROLLBACK TARGET';
    }
    if (eligibility === 'eligible_review') {
        return 'ELIGIBLE REVIEW';
    }
    if (eligibility === 'pending') {
        return 'PENDING REVIEW';
    }
    if (eligibility === 'blocked') {
        return 'BLOCKED';
    }

    return String(run.registry_context.deployment_eligibility ?? 'Pending review');
}

function renderGateStatus(value: boolean | null | undefined) {
    if (value === true) return 'PASS';
    if (value === false) return 'FAIL';
    return 'PENDING';
}

function formatRunStatus(run: ExperimentRunRecord) {
    const reason = !isActiveRun(run) && isHeartbeatDerivedReason(run.status_reason)
        ? null
        : run.status_reason;
    return `${run.status}${reason ? ` / ${reason}` : ''}`;
}

function renderHeartbeatStateLabel(run: ExperimentRunRecord) {
    if (run.status === 'completed' || run.status === 'promoted' || run.status === 'rolled_back') {
        return 'FINALIZED';
    }
    if (run.status === 'failed' || run.status === 'aborted') {
        return 'STOPPED';
    }
    return classifyHeartbeat(run).toUpperCase();
}

function renderDetailHeartbeatFreshness(detail: ExperimentRunDetail) {
    if (!isActiveRun(detail.run)) {
        return renderHeartbeatStateLabel(detail.run);
    }
    return detail.heartbeat_freshness.toUpperCase();
}

function renderPromotionEligibility(detail: ExperimentRunDetail) {
    if (detail.model_registry?.lifecycle_status === 'production' && detail.model_registry.registry_role === 'champion') {
        return 'ALREADY LIVE';
    }
    if (detail.model_registry?.registry_role === 'rollback_target') {
        return 'ROLLBACK TARGET';
    }
    return detail.decision_panel.promotion_eligibility ? 'YES' : 'NO';
}

function renderDeploymentDecision(detail: ExperimentRunDetail) {
    if (detail.model_registry?.lifecycle_status === 'production' && detail.model_registry.registry_role === 'champion') {
        return 'APPROVED';
    }
    return detail.deployment_decision ? detail.deployment_decision.decision.toUpperCase() : 'PENDING';
}

function renderStatusBadge(run: ExperimentRunRecord) {
    const tone = run.status === 'failed'
        ? 'text-danger border-danger/30 bg-danger/10'
        : run.status === 'interrupted'
            ? 'text-danger border-danger/30 bg-danger/10'
            : run.status === 'stalled'
                ? 'text-yellow-300 border-yellow-500/30 bg-yellow-500/10'
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

function isHeartbeatDerivedReason(statusReason: string | null | undefined) {
    return statusReason === 'heartbeat_stale' || statusReason === 'heartbeat_interrupted';
}

function dedupeText(values: Array<string | null | undefined>) {
    return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

function isGovernanceReviewState(status: ExperimentRunRecord['status']) {
    return status === 'completed' ||
        status === 'failed' ||
        status === 'aborted' ||
        status === 'promoted' ||
        status === 'rolled_back';
}

function classifyHeartbeat(run: ExperimentRunRecord) {
    if (!run.last_heartbeat_at) return 'interrupted';
    const ageMs = Date.now() - new Date(run.last_heartbeat_at).getTime();
    if (!Number.isFinite(ageMs)) return 'interrupted';
    if (ageMs <= 10 * 60 * 1000) return 'healthy';
    if (ageMs <= 30 * 60 * 1000) return 'stale';
    return 'interrupted';
}

function formatHeartbeat(value: string | null) {
    if (!value) return 'No heartbeat';
    return formatDateTime(value);
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

function formatMetricValue(value: number | null | undefined, metricName?: string) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    if (metricName === 'learning_rate') {
        return value.toExponential(4);
    }
    if (Math.abs(value) < 0.01 && value !== 0) {
        return value.toExponential(2);
    }
    return value.toFixed(3);
}

function formatPercent(value: number | null | undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
    return `${Math.round(value * 100)}%`;
}

function renderDeltaCell(
    value: number | null,
    delta: number | null,
    invertDeltaTone = false,
) {
    const deltaTone = delta == null
        ? 'text-muted'
        : invertDeltaTone
            ? delta <= 0 ? 'text-accent' : 'text-danger'
            : delta >= 0 ? 'text-accent' : 'text-danger';

    return (
        <div className="flex flex-col gap-1">
            <span>{formatMetricValue(value)}</span>
            <span className={deltaTone}>{delta == null ? 'delta n/a' : `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`}</span>
        </div>
    );
}

function stringifyJson(value: unknown, fallback: string) {
    if (value == null) return fallback;
    if (Array.isArray(value)) {
        return value.length > 0 ? JSON.stringify(value, null, 2) : fallback;
    }
    if (typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>).length > 0
            ? JSON.stringify(value, null, 2)
            : fallback;
    }
    return String(value);
}

function readNumber(record: Record<string, unknown>, key: string) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function uniqueValues(values: string[]) {
    return Array.from(new Set(values.filter(Boolean))).sort();
}

function SummaryCard({
    label,
    value,
    tone = 'default',
    tooltip,
}: {
    label: string;
    value: number | string;
    tone?: 'default' | 'warn' | 'accent';
    tooltip?: string;
}) {
    const toneClass = tone === 'warn' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-foreground';
    return (
        <div className="border border-grid bg-black/20 p-3 font-mono" title={tooltip}>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted">{label}</div>
            <div className={`mt-2 text-2xl ${toneClass}`}>{value}</div>
        </div>
    );
}

function ResearchPositionCard({
    eyebrow,
    title,
    body,
}: {
    eyebrow: string;
    title: string;
    body: string;
}) {
    return (
        <div className="border border-grid bg-black/20 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">{eyebrow}</div>
            <div className="mt-3 text-sm font-semibold text-foreground">{title}</div>
            <div className="mt-2 font-mono text-xs leading-6 text-muted">{body}</div>
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

function ConsoleInset({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="border border-grid bg-black/20 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{title}</div>
            {children}
        </div>
    );
}

function FreshnessBadge({
    freshness,
}: {
    freshness: ExperimentRunDetail['heartbeat_freshness'];
}) {
    const tone = freshness === 'healthy'
        ? 'border-accent/30 bg-accent/10 text-accent'
        : freshness === 'stale'
            ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
            : 'border-danger/30 bg-danger/10 text-danger';
    const Icon = freshness === 'healthy' ? CheckCircle2 : freshness === 'stale' ? ShieldAlert : AlertTriangle;

    return (
        <span className={`inline-flex items-center gap-2 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.15em] ${tone}`}>
            <Icon className="h-3.5 w-3.5" />
            {freshness}
        </span>
    );
}
