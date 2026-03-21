'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
    Archive,
    ArrowRight,
    GitBranchPlus,
    RefreshCw,
    Route,
    RotateCcw,
    ShieldAlert,
} from 'lucide-react';
import { ConsoleCard, Container, PageHeader, TerminalButton } from '@/components/ui/terminal';
import type {
    GateStatus,
    ModelFamily,
    ModelRegistryControlPlaneEntry,
    ModelRegistryControlPlaneSnapshot,
} from '@/lib/experiments/types';

type RegistryAction = 'promote_to_staging' | 'promote_to_production' | 'set_manual_approval' | 'archive' | 'rollback';

export function ModelRegistryControlPlaneClient({
    initialSnapshot,
}: {
    initialSnapshot: ModelRegistryControlPlaneSnapshot;
}) {
    const router = useRouter();
    const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const [pendingRunId, setPendingRunId] = useState<string | null>(null);
    const [isRefreshing, startRefreshTransition] = useTransition();

    const totalEntries = initialSnapshot.families.reduce((sum, family) => sum + family.entries.length, 0);
    const activeRoutes = initialSnapshot.families.filter((family) => family.active_model != null).length;
    const blockedEntries = initialSnapshot.families.reduce(
        (sum, family) => sum + family.entries.filter((entry) => entry.decision_panel.deployment_decision === 'rejected').length,
        0,
    );

    const submitAction = (
        runId: string,
        action: RegistryAction,
        options: {
            manualApproval?: boolean;
            reason?: string;
            incidentId?: string | null;
        } = {},
    ) => {
        startRefreshTransition(() => {
            void (async () => {
                setPendingRunId(runId);
                setMessage(null);
                try {
                    const response = await fetch(`/api/experiments/runs/${runId}/registry`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            action,
                            manual_approval: options.manualApproval,
                            reason: options.reason,
                            incident_id: options.incidentId ?? null,
                        }),
                    });
                    const payload = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Registry action failed.');
                    }

                    setMessage({
                        tone: 'success',
                        text: action === 'rollback'
                            ? 'Emergency rollback executed through the registry control plane.'
                            : action === 'set_manual_approval'
                                ? options.manualApproval === true
                                    ? 'Manual production approval granted.'
                                    : 'Manual production approval revoked.'
                                : `Registry action applied: ${formatActionLabel(action)}`,
                    });
                    router.refresh();
                } catch (error) {
                    setMessage({
                        tone: 'error',
                        text: error instanceof Error ? error.message : 'Registry action failed.',
                    });
                } finally {
                    setPendingRunId(null);
                }
            })();
        });
    };

    const handleRollback = (entry: ModelRegistryControlPlaneEntry) => {
        const reason = window.prompt(
            'Rollback reason',
            'Clinical safety incident detected in production.',
        );
        if (reason == null) return;
        const incidentId = window.prompt('Incident ID (optional)', '');
        submitAction(entry.registry.run_id, 'rollback', {
            reason: reason.trim() || 'Clinical safety incident detected in production.',
            incidentId: incidentId?.trim() || null,
        });
    };

    return (
        <Container className="max-w-[96rem]">
            <PageHeader
                title="MODEL REGISTRY CONTROL PLANE"
                description="Operate artifact lifecycle, staging readiness, production routing, rollback execution, clinical safety gates, lineage, and audit history from one governed registry."
            />

            <div className="mb-8 grid gap-3 md:grid-cols-4">
                <SummaryCard label="Families" value={initialSnapshot.families.length} />
                <SummaryCard label="Tracked Artifacts" value={totalEntries} />
                <SummaryCard label="Active Routes" value={activeRoutes} tone="accent" />
                <SummaryCard label="Rejected" value={blockedEntries} tone={blockedEntries > 0 ? 'warn' : 'default'} />
            </div>

            <div className="mb-8 flex flex-wrap items-center gap-3">
                <TerminalButton variant="secondary" onClick={() => router.refresh()}>
                    <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh Registry
                </TerminalButton>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                    Refreshed {formatDateTime(initialSnapshot.refreshed_at)}
                </span>
            </div>

            {message ? (
                <div className={`mb-8 border px-4 py-3 font-mono text-xs ${
                    message.tone === 'success'
                        ? 'border-accent/40 bg-accent/10 text-accent'
                        : 'border-danger/40 bg-danger/10 text-danger'
                }`}>
                    {message.text}
                </div>
            ) : null}

            <div className="space-y-8">
                {initialSnapshot.families.map((family) => (
                    <ConsoleCard key={family.model_family} title={`${formatFamilyLabel(family.model_family)} Registry`}>
                        <div className="mb-6 grid gap-3 lg:grid-cols-3">
                            <FamilyStat
                                label="Active Route"
                                value={family.active_model
                                    ? `${family.active_model.model_name} ${family.active_model.model_version}`
                                    : 'No production route'}
                                tone={family.active_model ? 'accent' : 'default'}
                            />
                            <FamilyStat
                                label="Last Stable"
                                value={family.last_stable_model
                                    ? `${family.last_stable_model.model_name} ${family.last_stable_model.model_version}`
                                    : 'No rollback target'}
                            />
                            <FamilyStat
                                label="Artifacts"
                                value={String(family.entries.length)}
                            />
                        </div>

                        {family.entries.length === 0 ? (
                            <EmptyPanel message="No registry artifacts are tracked in this family yet." />
                        ) : (
                            <div className="grid gap-6 xl:grid-cols-2">
                                {family.entries.map((entry) => (
                                    <RegistryEntryCard
                                        key={entry.registry.registry_id}
                                        entry={entry}
                                        isPending={pendingRunId === entry.registry.run_id && isRefreshing}
                                        onArchive={() => submitAction(entry.registry.run_id, 'archive', {
                                            reason: 'Archived from model registry control plane.',
                                        })}
                                        onGrantApproval={() => submitAction(entry.registry.run_id, 'set_manual_approval', {
                                            manualApproval: true,
                                            reason: 'Manual production approval granted from registry control plane.',
                                        })}
                                        onPromote={() => submitAction(entry.registry.run_id, 'promote_to_production')}
                                        onRollback={() => handleRollback(entry)}
                                        onRevokeApproval={() => submitAction(entry.registry.run_id, 'set_manual_approval', {
                                            manualApproval: false,
                                            reason: 'Manual production approval revoked from registry control plane.',
                                        })}
                                        onStage={() => submitAction(entry.registry.run_id, 'promote_to_staging')}
                                    />
                                ))}
                            </div>
                        )}
                    </ConsoleCard>
                ))}
            </div>

            <div className="mt-8">
                <ConsoleCard title="Registry Audit Trail">
                    {initialSnapshot.audit_history.length === 0 ? (
                        <EmptyPanel message="No registry audit events have been recorded yet." compact />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-[880px] w-full border-collapse text-left">
                                <thead>
                                    <tr className="border-b border-grid bg-black/30 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                                        <th className="p-3 font-normal">Timestamp</th>
                                        <th className="p-3 font-normal">Registry</th>
                                        <th className="p-3 font-normal">Event</th>
                                        <th className="p-3 font-normal">Actor</th>
                                        <th className="p-3 font-normal">Metadata</th>
                                    </tr>
                                </thead>
                                <tbody className="font-mono text-xs">
                                    {initialSnapshot.audit_history.slice(0, 20).map((event) => (
                                        <tr key={event.event_id} className="border-b border-grid/20">
                                            <td className="p-3 text-muted">{formatDateTime(event.timestamp)}</td>
                                            <td className="p-3">{event.registry_id}</td>
                                            <td className="p-3">{event.event_type}</td>
                                            <td className="p-3">{event.actor ?? 'system'}</td>
                                            <td className="p-3">{summarizeMetadata(event.metadata)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </ConsoleCard>
            </div>
        </Container>
    );
}

function RegistryEntryCard({
    entry,
    isPending,
    onArchive,
    onGrantApproval,
    onPromote,
    onRollback,
    onRevokeApproval,
    onStage,
}: {
    entry: ModelRegistryControlPlaneEntry;
    isPending: boolean;
    onArchive: () => void;
    onGrantApproval: () => void;
    onPromote: () => void;
    onRollback: () => void;
    onRevokeApproval: () => void;
    onStage: () => void;
}) {
    const registry = entry.registry;
    const isLiveProduction = registry.lifecycle_status === 'production' && registry.registry_role === 'champion';
    const canStage = registry.lifecycle_status === 'candidate' || registry.lifecycle_status === 'training';
    const canPromote = registry.lifecycle_status === 'staging' &&
        registry.registry_role === 'challenger' &&
        entry.promotion_gating.can_promote;
    const canRollback = registry.lifecycle_status === 'production' &&
        registry.registry_role === 'champion' &&
        (registry.rollback_target != null || entry.last_stable_model != null);
    const canArchive = !(registry.lifecycle_status === 'production' && registry.registry_role === 'champion');
    const approvalGranted = entry.promotion_requirements?.manual_approval === true;
    const showApprovalControls = registry.lifecycle_status === 'staging';

    return (
        <div className="border border-grid bg-black/20 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="font-mono text-lg text-foreground">
                        {registry.model_name}
                    </div>
                    <div className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-muted">
                        {registry.model_version} • {registry.registry_id}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {entry.is_active_route ? (
                        <span className="inline-flex items-center gap-2 border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
                            <Route className="h-3 w-3" />
                            Active Route
                        </span>
                    ) : null}
                    <Badge className={roleBadgeClass(registry.registry_role)}>
                        {formatRoleLabel(registry.registry_role)}
                    </Badge>
                    <Badge className={lifecycleBadgeClass(registry.lifecycle_status)}>
                        {registry.lifecycle_status}
                    </Badge>
                </div>
            </div>

            <LifecycleTimeline current={registry.lifecycle_status} />

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Stat label="Run" value={registry.run_id} />
                <Stat label="Dataset" value={registry.dataset_version ?? 'n/a'} />
                <Stat label="Feature Schema" value={registry.feature_schema_version ?? 'n/a'} />
                <Stat label="Label Policy" value={registry.label_policy_version ?? 'n/a'} />
            </div>

            <Section title="Clinical Scorecard">
                <div className="grid gap-3 md:grid-cols-3">
                    <MetricTile label="Global Accuracy" value={formatMetric(entry.clinical_scorecard.global_accuracy)} />
                    <MetricTile label="Macro F1" value={formatMetric(entry.clinical_scorecard.macro_f1)} />
                    <MetricTile label="Latency P99" value={formatLatency(entry.clinical_scorecard.latency_p99)} />
                    <MetricTile label="Critical Recall" value={formatMetric(entry.clinical_scorecard.critical_recall)} emphasis />
                    <MetricTile label="False Reassurance" value={formatMetric(entry.clinical_scorecard.false_reassurance_rate)} emphasis />
                    <MetricTile label="FN Critical Rate" value={formatMetric(entry.clinical_scorecard.fn_critical_rate)} emphasis />
                    <MetricTile label="ECE" value={formatMetric(entry.clinical_scorecard.ece)} />
                    <MetricTile label="Brier Score" value={formatMetric(entry.clinical_scorecard.brier_score)} />
                    <MetricTile label="Adv. Degradation" value={formatMetric(entry.clinical_scorecard.adversarial_degradation)} />
                </div>
            </Section>

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr,0.9fr]">
                <Section title="Promotion Gates">
                    <div className="grid gap-2">
                        <GateRow label="Calibration" status={entry.promotion_gating.gates.calibration} />
                        <GateRow label="Adversarial" status={entry.promotion_gating.gates.adversarial} />
                        <GateRow label="Clinical Safety" status={entry.promotion_gating.gates.safety} />
                        <GateRow label="Benchmarks" status={entry.promotion_gating.gates.benchmark} />
                        <GateRow label="Manual Approval" status={entry.promotion_gating.gates.manual_approval} />
                    </div>
                    {entry.promotion_gating.blockers.length > 0 ? (
                        <div className={`mt-4 p-3 ${isLiveProduction ? 'border border-yellow-500/30 bg-yellow-500/10' : 'border border-danger/30 bg-danger/10'}`}>
                            <div className={`mb-2 font-mono text-[10px] uppercase tracking-[0.18em] ${isLiveProduction ? 'text-yellow-300' : 'text-danger'}`}>
                                {isLiveProduction ? 'Operational Watchlist' : 'Promotion Blockers'}
                            </div>
                            <div className="space-y-2 font-mono text-xs text-foreground/85">
                                {entry.promotion_gating.blockers.map((blocker) => (
                                    <div key={blocker}>{blocker}</div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </Section>

                <Section title="Decision Panel">
                    <div className="grid gap-3 md:grid-cols-2">
                        <DecisionStat
                            label="Promotion Eligibility"
                            value={renderPromotionEligibility(entry)}
                            tone={resolvePromotionEligibilityTone(entry)}
                        />
                        <DecisionStat
                            label="Deployment Decision"
                            value={renderDeploymentDecision(entry)}
                            tone={entry.decision_panel.deployment_decision === 'approved' ? 'accent' : entry.decision_panel.deployment_decision === 'hold' ? 'default' : 'warn'}
                        />
                    </div>
                    <div className="mt-4 space-y-2 font-mono text-xs text-foreground/85">
                        {entry.decision_panel.reasons.length > 0 ? (
                            <div>
                                <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted">{isLiveProduction ? 'Live Deployment Notes' : 'Reasons'}</div>
                                {entry.decision_panel.reasons.map((reason) => (
                                    <div key={reason}>{reason}</div>
                                ))}
                            </div>
                        ) : null}
                        {entry.decision_panel.missing_evaluations.length > 0 ? (
                            <div>
                                <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted">{isLiveProduction ? 'Monitoring Gaps' : 'Missing Evaluations'}</div>
                                {entry.decision_panel.missing_evaluations.map((item) => (
                                    <div key={item}>{item}</div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </Section>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr,0.95fr]">
                <Section title="Lineage">
                    <div className="grid gap-3 md:grid-cols-2">
                        <Stat label="Experiment Group" value={entry.lineage.experiment_group ?? 'n/a'} />
                        <Stat label="Benchmark ID" value={entry.lineage.benchmark_id ?? 'n/a'} />
                        <Stat label="Calibration Report" value={entry.lineage.calibration_report_uri ?? 'n/a'} />
                        <Stat label="Adversarial Report" value={entry.lineage.adversarial_report_uri ?? 'n/a'} />
                    </div>
                </Section>

                <Section title="Rollback State">
                    <div className="grid gap-3 md:grid-cols-2">
                        <Stat
                            label="Rollback Target"
                            value={registry.rollback_target ?? entry.last_stable_model?.registry_id ?? 'None'}
                        />
                        <Stat
                            label="Last Stable Model"
                            value={entry.last_stable_model
                                ? `${entry.last_stable_model.model_name} ${entry.last_stable_model.model_version}`
                                : 'None'}
                        />
                    </div>
                    {entry.rollback_history.length > 0 ? (
                        <div className="mt-4 space-y-2">
                            {entry.rollback_history.slice(0, 3).map((event) => (
                                <div key={event.event_id} className="border border-grid/40 bg-black/20 px-3 py-2 font-mono text-xs text-foreground/85">
                                    <div className="text-muted">{formatDateTime(event.timestamp)}</div>
                                    <div>{summarizeMetadata(event.metadata)}</div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </Section>
            </div>

            {registry.rollback_metadata ? (
                <div className="mt-5 border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-foreground/85">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-danger">Last Rollback Metadata</div>
                    <div>Triggered: {formatDateTime(registry.rollback_metadata.triggered_at)}</div>
                    <div>By: {registry.rollback_metadata.triggered_by ?? 'system'}</div>
                    <div>Reason: {registry.rollback_metadata.reason}</div>
                    <div>Incident: {registry.rollback_metadata.incident_id ?? 'n/a'}</div>
                </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2 border-t border-grid/30 pt-4">
                <TerminalButton variant="secondary" disabled={!canStage || isPending} onClick={onStage} title={canStage ? 'Move this candidate into governed staging.' : isLiveProduction ? 'The active production champion cannot be moved back to staging.' : 'Only training or candidate artifacts can be staged.'}>
                    <GitBranchPlus className="mr-2 h-3.5 w-3.5" />
                    Promote To Staging
                </TerminalButton>
                {showApprovalControls ? (
                    <TerminalButton variant="secondary" disabled={isPending} onClick={approvalGranted ? onRevokeApproval : onGrantApproval}>
                        <ShieldAlert className="mr-2 h-3.5 w-3.5" />
                        {approvalGranted ? 'Revoke Approval' : 'Grant Approval'}
                    </TerminalButton>
                ) : null}
                <TerminalButton variant="secondary" disabled={!canPromote || isPending} onClick={onPromote} title={canPromote ? 'Promote this staging challenger into production.' : isLiveProduction ? 'This model is already serving production traffic.' : entry.promotion_gating.tooltip}>
                    <ArrowRight className="mr-2 h-3.5 w-3.5" />
                    Promote To Production
                </TerminalButton>
                <TerminalButton variant="danger" disabled={!canRollback || isPending} onClick={onRollback} title={canRollback ? 'Restore the last stable registry target.' : 'Rollback is unavailable until a rollback target exists.'}>
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    Emergency Rollback
                </TerminalButton>
                <TerminalButton variant="secondary" disabled={!canArchive || isPending} onClick={onArchive} title={canArchive ? 'Archive this registry artifact.' : 'Archive is disabled for the active production champion.'}>
                    <Archive className="mr-2 h-3.5 w-3.5" />
                    Archive
                </TerminalButton>
            </div>

            {entry.latest_registry_events.length > 0 ? (
                <div className="mt-5 border-t border-grid/30 pt-4">
                    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Latest Registry Events</div>
                    <div className="space-y-2">
                        {entry.latest_registry_events.slice(0, 4).map((event) => (
                            <div key={event.event_id} className="flex items-start justify-between gap-3 border border-grid/30 bg-black/20 px-3 py-2 font-mono text-xs">
                                <div>
                                    <div className="text-foreground/90">{event.event_type}</div>
                                    <div className="mt-1 text-muted">{summarizeMetadata(event.metadata)}</div>
                                </div>
                                <div className="text-muted">{formatDateTime(event.timestamp)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function SummaryCard({
    label,
    value,
    tone = 'default',
}: {
    label: string;
    value: number | string;
    tone?: 'default' | 'warn' | 'accent';
}) {
    return (
        <div className="border border-grid bg-black/20 p-3 font-mono">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted">{label}</div>
            <div className={`mt-2 text-2xl ${tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-danger' : 'text-foreground'}`}>
                {value}
            </div>
        </div>
    );
}

function FamilyStat({
    label,
    value,
    tone = 'default',
}: {
    label: string;
    value: string;
    tone?: 'default' | 'accent';
}) {
    return (
        <div className="border border-grid bg-black/20 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
            <div className={`mt-2 font-mono text-xs ${tone === 'accent' ? 'text-accent' : 'text-foreground/85'}`}>{value}</div>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="border border-grid/40 bg-black/20 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{title}</div>
            {children}
        </div>
    );
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
    return (
        <span className={`inline-flex items-center gap-2 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${className}`}>
            {children}
        </span>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="border border-grid/30 bg-black/20 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
            <div className="mt-2 break-all font-mono text-xs text-foreground/85">{value}</div>
        </div>
    );
}

function MetricTile({
    label,
    value,
    emphasis = false,
}: {
    label: string;
    value: string;
    emphasis?: boolean;
}) {
    return (
        <div className={`border p-3 ${emphasis ? 'border-danger/30 bg-danger/10' : 'border-grid/30 bg-black/20'}`}>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
            <div className={`mt-2 font-mono text-lg ${emphasis ? 'text-danger' : 'text-foreground'}`}>{value}</div>
        </div>
    );
}

function GateRow({ label, status }: { label: string; status: GateStatus }) {
    return (
        <div className="flex items-center justify-between gap-3 border border-grid/30 bg-black/20 px-3 py-2 font-mono text-xs">
            <span className="text-foreground/85">{label}</span>
            <span className={`inline-flex items-center border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${gateBadgeClass(status)}`}>
                {status}
            </span>
        </div>
    );
}

function DecisionStat({
    label,
    value,
    tone = 'default',
}: {
    label: string;
    value: string;
    tone?: 'default' | 'accent' | 'warn';
}) {
    return (
        <div className="border border-grid/30 bg-black/20 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
            <div className={`mt-2 font-mono text-lg ${tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-danger' : 'text-foreground'}`}>
                {value}
            </div>
        </div>
    );
}

function LifecycleTimeline({
    current,
}: {
    current: 'training' | 'candidate' | 'staging' | 'production' | 'archived';
}) {
    const order = ['training', 'candidate', 'staging', 'production', 'archived'] as const;
    const currentIndex = order.indexOf(current);

    return (
        <div className="grid gap-2 md:grid-cols-5">
            {order.map((step, index) => {
                const isCurrent = step === current;
                const isReached = current === 'archived'
                    ? index <= currentIndex
                    : step === 'archived'
                        ? false
                        : index <= currentIndex;

                return (
                    <div
                        key={step}
                        className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] ${
                            isCurrent
                                ? 'border-accent/40 bg-accent/10 text-accent'
                                : isReached
                                    ? 'border-grid/50 bg-black/30 text-foreground/85'
                                    : 'border-grid/20 bg-black/10 text-muted'
                        }`}
                    >
                        {step}
                    </div>
                );
            })}
        </div>
    );
}

function renderPromotionEligibility(entry: ModelRegistryControlPlaneEntry) {
    if (entry.registry.lifecycle_status === 'production' && entry.registry.registry_role === 'champion') {
        return 'ALREADY LIVE';
    }
    if (entry.registry.registry_role === 'rollback_target') {
        return 'ROLLBACK TARGET';
    }
    return entry.decision_panel.promotion_eligibility ? 'YES' : 'NO';
}

function resolvePromotionEligibilityTone(entry: ModelRegistryControlPlaneEntry): 'default' | 'accent' | 'warn' {
    if (entry.registry.lifecycle_status === 'production' && entry.registry.registry_role === 'champion') {
        return 'accent';
    }
    if (entry.registry.registry_role === 'rollback_target') {
        return 'default';
    }
    return entry.decision_panel.promotion_eligibility ? 'accent' : 'warn';
}

function renderDeploymentDecision(entry: ModelRegistryControlPlaneEntry) {
    if (entry.registry.lifecycle_status === 'production' && entry.registry.registry_role === 'champion') {
        return 'APPROVED';
    }
    return entry.decision_panel.deployment_decision.toUpperCase();
}

function formatFamilyLabel(modelFamily: ModelFamily) {
    return modelFamily.charAt(0).toUpperCase() + modelFamily.slice(1);
}

function formatActionLabel(action: RegistryAction) {
    if (action === 'set_manual_approval') return 'manual approval updated';
    return action.replace(/_/g, ' ');
}

function formatDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function summarizeMetadata(metadata: Record<string, unknown>) {
    const entries = Object.entries(metadata).slice(0, 3);
    if (entries.length === 0) return 'No metadata';
    return entries.map(([key, value]) => `${key}=${formatMetadataValue(value)}`).join(' | ');
}

function formatMetadataValue(value: unknown) {
    if (value == null) return 'n/a';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value);
}

function formatMetric(value: number | null) {
    if (value == null || Number.isNaN(value)) return 'n/a';
    if (Math.abs(value) >= 100) return value.toFixed(1);
    if (Math.abs(value) >= 10) return value.toFixed(2);
    return value.toFixed(3);
}

function formatLatency(value: number | null) {
    if (value == null || Number.isNaN(value)) return 'n/a';
    return value >= 100 ? `${value.toFixed(0)} ms` : `${value.toFixed(1)} ms`;
}

function formatRoleLabel(role: string) {
    return role.replace(/_/g, ' ');
}

function roleBadgeClass(role: string) {
    switch (role) {
        case 'champion':
            return 'border-accent/40 bg-accent/10 text-accent';
        case 'challenger':
            return 'border-sky-500/40 bg-sky-500/10 text-sky-300';
        case 'rollback_target':
            return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
        case 'experimental':
            return 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300';
        case 'archived':
            return 'border-grid/40 bg-black/20 text-muted';
        default:
            return 'border-grid/40 bg-black/20 text-foreground/80';
    }
}

function lifecycleBadgeClass(status: string) {
    switch (status) {
        case 'production':
            return 'border-accent/40 bg-accent/10 text-accent';
        case 'staging':
            return 'border-sky-500/40 bg-sky-500/10 text-sky-300';
        case 'training':
            return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
        case 'archived':
            return 'border-grid/40 bg-black/20 text-muted';
        default:
            return 'border-grid/40 bg-black/20 text-foreground/80';
    }
}

function gateBadgeClass(status: GateStatus) {
    switch (status) {
        case 'pass':
            return 'border-accent/40 bg-accent/10 text-accent';
        case 'fail':
            return 'border-danger/40 bg-danger/10 text-danger';
        default:
            return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    }
}
