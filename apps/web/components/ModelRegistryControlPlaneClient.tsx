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
    RegistryControlPlaneVerificationResult,
    ModelRegistryControlPlaneEntry,
    ModelRegistryControlPlaneSnapshot,
} from '@/lib/experiments/types';

interface RegistryControlPlaneApiResponse {
    snapshot?: ModelRegistryControlPlaneSnapshot;
    verification?: RegistryControlPlaneVerificationResult;
    error?: string;
}

type RegistryAction = 'promote_to_staging' | 'promote_to_production' | 'set_manual_approval' | 'archive' | 'rollback';

export function ModelRegistryControlPlaneClient({
    initialSnapshot,
    canSystemAdminOverride = false,
}: {
    initialSnapshot: ModelRegistryControlPlaneSnapshot;
    canSystemAdminOverride?: boolean;
}) {
    const router = useRouter();
    const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const [verification, setVerification] = useState<RegistryControlPlaneVerificationResult | null>(null);
    const [verificationBusy, setVerificationBusy] = useState(false);
    const [refreshBusy, setRefreshBusy] = useState(false);
    const [pendingRunId, setPendingRunId] = useState<string | null>(null);
    const [unblockBusyVersion, setUnblockBusyVersion] = useState<string | null>(null);
    const [isRefreshing, startRefreshTransition] = useTransition();

    const totalEntries = initialSnapshot.families.reduce((sum, family) => sum + family.entries.length, 0);
    const activeRoutes = initialSnapshot.families.filter((family) => family.active_model != null).length;
    const blockedEntries = initialSnapshot.families.reduce(
        (sum, family) => sum + family.entries.filter((entry) => entry.decision_panel.deployment_decision === 'rejected').length,
        0,
    );
    const consistencyIssueCount = initialSnapshot.consistency_issues.length;

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
                    const payload = await response.json().catch(() => ({})) as RegistryControlPlaneApiResponse;
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

    const handleVerifyControlPlane = async () => {
        setVerificationBusy(true);
        setMessage(null);
        try {
            const response = await fetch('/api/models/registry/control-plane', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'verify_control_plane',
                }),
            });
            const payload = await response.json().catch(() => ({})) as RegistryControlPlaneApiResponse;
            if (!response.ok || !payload?.verification) {
                throw new Error(typeof payload?.error === 'string' ? payload.error : 'Registry verification failed.');
            }
            setVerification(payload.verification as RegistryControlPlaneVerificationResult);
            setMessage({
                tone: payload.verification.status === 'PASS' ? 'success' : 'error',
                text: payload.verification.summary,
            });
        } catch (error) {
            setMessage({
                tone: 'error',
                text: error instanceof Error ? error.message : 'Registry verification failed.',
            });
        } finally {
            setVerificationBusy(false);
        }
    };

    const handleRefreshRegistry = async () => {
        setRefreshBusy(true);
        setMessage(null);
        try {
            const response = await fetch('/api/models/registry/control-plane', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'refresh_registry',
                }),
            });
            const payload = await response.json().catch(() => ({})) as RegistryControlPlaneApiResponse;
            if (!response.ok || !payload?.snapshot) {
                throw new Error(typeof payload?.error === 'string' ? payload.error : 'Registry refresh failed.');
            }

            setVerification(null);
            setMessage({
                tone: 'success',
                text: 'Registry control plane refreshed from source.',
            });
            startRefreshTransition(() => {
                router.refresh();
            });
        } catch (error) {
            setMessage({
                tone: 'error',
                text: error instanceof Error ? error.message : 'Registry refresh failed.',
            });
        } finally {
            setRefreshBusy(false);
        }
    };

    const handleRefreshRunGovernance = (entry: ModelRegistryControlPlaneEntry) => {
        startRefreshTransition(() => {
            void (async () => {
                setPendingRunId(entry.registry.run_id);
                setMessage(null);
                try {
                    const response = await fetch('/api/models/registry/control-plane', {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            action: 'refresh_run_governance',
                            run_id: entry.registry.run_id,
                        }),
                    });
                    const payload = await response.json().catch(() => ({})) as RegistryControlPlaneApiResponse;
                    if (!response.ok || !payload?.snapshot) {
                        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Governance refresh failed.');
                    }

                    setVerification(null);
                    setMessage({
                        tone: 'success',
                        text: `Governance telemetry recomputed for ${entry.registry.run_id}.`,
                    });
                    router.refresh();
                } catch (error) {
                    setMessage({
                        tone: 'error',
                        text: error instanceof Error ? error.message : 'Governance refresh failed.',
                    });
                } finally {
                    setPendingRunId(null);
                }
            })();
        });
    };

    const handleUnblockRegistryModel = (entry: ModelRegistryControlPlaneEntry) => {
        startRefreshTransition(() => {
            void (async () => {
                setUnblockBusyVersion(entry.registry.model_version);
                setMessage(null);
                try {
                    const response = await fetch(`/api/models/${encodeURIComponent(entry.registry.model_version)}/unblock`, {
                        method: 'PATCH',
                        credentials: 'include',
                    });
                    const payload = await response.json().catch(() => ({})) as RegistryControlPlaneApiResponse;
                    if (!response.ok) {
                        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Model unblock failed.');
                    }

                    setMessage({
                        tone: 'success',
                        text: `Simulation block override applied to ${entry.registry.model_version}.`,
                    });
                    router.refresh();
                } catch (error) {
                    setMessage({
                        tone: 'error',
                        text: error instanceof Error ? error.message : 'Model unblock failed.',
                    });
                } finally {
                    setUnblockBusyVersion(null);
                }
            })();
        });
    };

    return (
        <Container className="max-w-[112rem]">
            <PageHeader
                title="MODEL REGISTRY CONTROL PLANE"
                description="Operate artifact lifecycle, staging readiness, production routing, rollback execution, clinical safety gates, lineage, and audit history from one governed registry."
            />

            <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                <SummaryCard label="Families" value={initialSnapshot.families.length} />
                <SummaryCard label="Tracked Artifacts" value={totalEntries} />
                <SummaryCard label="Active Routes" value={activeRoutes} tone="accent" />
                <SummaryCard label="Rejected" value={blockedEntries} tone={blockedEntries > 0 ? 'warn' : 'default'} />
                <SummaryCard
                    label="Registry Health"
                    value={initialSnapshot.registry_health.toUpperCase()}
                    tone={initialSnapshot.registry_health === 'degraded' ? 'warn' : 'accent'}
                    pulse={initialSnapshot.registry_health === 'degraded'}
                />
                <SummaryCard
                    label="Consistency Issues"
                    value={consistencyIssueCount}
                    tone={consistencyIssueCount > 0 ? 'warn' : 'default'}
                />
            </div>

            <div className="mb-8 flex flex-wrap items-center gap-3">
                <TerminalButton variant="secondary" onClick={() => void handleRefreshRegistry()} disabled={refreshBusy}>
                    <RefreshCw className={`mr-2 h-3.5 w-3.5 ${(refreshBusy || isRefreshing) ? 'animate-spin' : ''}`} />
                    {refreshBusy ? 'REFRESHING...' : 'Refresh Registry'}
                </TerminalButton>
                <TerminalButton variant="secondary" onClick={() => void handleVerifyControlPlane()} disabled={verificationBusy}>
                    <ShieldAlert className={`mr-2 h-3.5 w-3.5 ${verificationBusy ? 'animate-pulse' : ''}`} />
                    {verificationBusy ? 'VERIFYING...' : 'Verify Control Plane'}
                </TerminalButton>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[hsl(0_0%_85%)]">
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

            {initialSnapshot.consistency_issues.length > 0 ? (
                <ConsoleCard title="Registry Consistency">
                    <div className="grid gap-2 font-mono text-xs">
                        {initialSnapshot.consistency_issues.map((issue) => (
                            <div
                                key={`${issue.code}:${issue.registry_id ?? 'none'}:${issue.run_id ?? 'none'}`}
                                className={`border px-3 py-2 ${
                                    issue.severity === 'critical'
                                        ? 'border-danger/40 bg-danger/10 text-danger'
                                        : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
                                }`}
                            >
                                <div className="text-[10px] uppercase tracking-[0.16em] font-medium">{issue.code}</div>
                                <div className="mt-1 text-foreground/95">{issue.message}</div>
                            </div>
                        ))}
                    </div>
                </ConsoleCard>
            ) : null}

            {verification ? (
                <div className="mb-8 mt-8">
                    <ConsoleCard title="Verification Mode">
                        <div className="mb-4 grid gap-3 md:grid-cols-3">
                            <SummaryCard
                                label="Verification"
                                value={verification.status}
                                tone={verification.status === 'PASS' ? 'accent' : 'warn'}
                            />
                            <SummaryCard label="Failed Checks" value={verification.failed_checks.length} tone={verification.failed_checks.length > 0 ? 'warn' : 'default'} />
                            <SummaryCard label="Warnings" value={verification.warnings.length} tone={verification.warnings.length > 0 ? 'warn' : 'default'} />
                        </div>
                        <div className="mb-4 font-mono text-xs text-foreground/85">{verification.summary}</div>
                        <div className="grid gap-4 xl:grid-cols-2">
                            {verification.checks.map((check) => (
                                <div key={check.key} className="border border-grid/40 bg-black/20 p-4">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[hsl(0_0%_88%)] font-medium">{check.label}</div>
                                        <Badge className={check.status === 'pass' ? 'border-accent/50 bg-accent/10 text-accent font-bold' : check.status === 'warning' ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-300 font-bold' : 'border-danger/50 bg-danger/10 text-danger font-bold'}>
                                            {check.status}
                                        </Badge>
                                    </div>
                                    <div className="font-mono text-xs text-foreground/95">{check.summary}</div>
                                    {check.failures.length > 0 ? (
                                        <div className="mt-3 space-y-2 font-mono text-xs text-danger">
                                            {check.failures.map((failure) => (
                                                <div key={failure}>{failure}</div>
                                            ))}
                                        </div>
                                    ) : null}
                                    {check.warnings.length > 0 ? (
                                        <div className="mt-3 space-y-2 font-mono text-xs text-yellow-200">
                                            {check.warnings.map((warning) => (
                                                <div key={warning}>{warning}</div>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                        <div className="mt-5 border-t border-grid/30 pt-4">
                            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Failure Simulation</div>
                            <div className="grid gap-3 md:grid-cols-2">
                                {verification.simulated_failures.map((item) => (
                                    <div key={item.scenario} className={`border px-3 py-2 font-mono text-xs ${item.detected ? 'border-accent/40 bg-accent/10 text-foreground' : 'border-danger/40 bg-danger/10 text-danger'}`}>
                                        <div className="text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_82%)] font-medium">{item.scenario.replaceAll('_', ' ')}</div>
                                        <div className="mt-1">{item.summary}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </ConsoleCard>
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
                                        onRefreshGovernance={() => handleRefreshRunGovernance(entry)}
                                        onRollback={() => handleRollback(entry)}
                                        onUnblock={() => handleUnblockRegistryModel(entry)}
                                        onRevokeApproval={() => submitAction(entry.registry.run_id, 'set_manual_approval', {
                                            manualApproval: false,
                                            reason: 'Manual production approval revoked from registry control plane.',
                                        })}
                                        onStage={() => submitAction(entry.registry.run_id, 'promote_to_staging')}
                                        canSystemAdminOverride={canSystemAdminOverride}
                                        isUnblockPending={unblockBusyVersion === entry.registry.model_version && isRefreshing}
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
                            <table className="min-w-[880px] w-full border-collapse text-left border border-grid/20">
                                <thead>
                                    <tr className="border-b border-grid bg-black/60 font-mono text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_90%)] font-bold">
                                        <th className="p-3 font-bold border-r border-grid/20">Timestamp</th>
                                        <th className="p-3 font-bold border-r border-grid/20">Registry</th>
                                        <th className="p-3 font-bold border-r border-grid/20">Event</th>
                                        <th className="p-3 font-bold border-r border-grid/20">Actor</th>
                                        <th className="p-3 font-bold">Metadata</th>
                                    </tr>
                                </thead>
                                <tbody className="font-mono text-xs">
                                    {initialSnapshot.audit_history.slice(0, 20).map((event, idx) => (
                                        <tr key={event.event_id} className={`border-b border-grid/20 hover:bg-accent/5 ${idx % 2 === 0 ? 'bg-black/10' : 'bg-transparent'}`}>
                                            <td className="p-3 text-[hsl(0_0%_80%)] font-medium border-r border-grid/20">{formatDateTime(event.timestamp)}</td>
                                            <td className="p-3 break-all align-top text-foreground/90 border-r border-grid/20">{event.registry_id}</td>
                                            <td className="p-3 break-words align-top font-bold text-accent border-r border-grid/20">{event.event_type}</td>
                                            <td className="p-3 break-all align-top text-foreground/90 border-r border-grid/20">{event.actor ?? 'system'}</td>
                                            <td className="max-w-[30rem] p-3 align-top break-all whitespace-pre-wrap text-foreground/95">{summarizeMetadata(event.metadata)}</td>
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
    canSystemAdminOverride,
    entry,
    isPending,
    isUnblockPending,
    onArchive,
    onGrantApproval,
    onPromote,
    onRefreshGovernance,
    onRollback,
    onUnblock,
    onRevokeApproval,
    onStage,
}: {
    canSystemAdminOverride: boolean;
    entry: ModelRegistryControlPlaneEntry;
    isPending: boolean;
    isUnblockPending: boolean;
    onArchive: () => void;
    onGrantApproval: () => void;
    onPromote: () => void;
    onRefreshGovernance: () => void;
    onRollback: () => void;
    onUnblock: () => void;
    onRevokeApproval: () => void;
    onStage: () => void;
}) {
    const registry = entry.registry;
    const isLiveProduction = registry.lifecycle_status === 'production' && registry.registry_role === 'champion';
    const canStage = (registry.lifecycle_status === 'candidate' || registry.lifecycle_status === 'training') &&
        entry.registration_validation.status === 'valid';
    const canPromote = registry.lifecycle_status === 'staging' &&
        registry.registry_role === 'challenger' &&
        entry.promotion_gating.can_promote &&
        entry.registration_validation.status === 'valid';
    const canRollback = registry.lifecycle_status === 'production' &&
        registry.registry_role === 'champion' &&
        entry.rollback_readiness.ready;
    const canArchive = !(registry.lifecycle_status === 'production' && registry.registry_role === 'champion');
    const approvalGranted = entry.promotion_requirements?.manual_approval === true;
    const showApprovalControls = registry.lifecycle_status !== 'production' && registry.lifecycle_status !== 'archived';
    const isSimulationBlocked = registry.blocked === true;

    return (
        <div className="min-w-0 border border-grid bg-black/20 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="break-words font-mono text-lg leading-tight text-foreground font-bold">
                        {registry.model_name}
                    </div>
                    <div className="mt-1 break-all font-mono text-xs uppercase tracking-[0.16em] text-[hsl(0_0%_88%)] font-medium">{`${registry.model_version} | ${registry.registry_id}`}</div>{/* legacy separator preserved for diff stability
                        {registry.model_version} • {registry.registry_id}
                    */}
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
                    {isSimulationBlocked ? (
                        <Badge className="border-warning bg-warning/10 text-warning">
                            BLOCKED
                        </Badge>
                    ) : null}
                </div>
            </div>

            <LifecycleTimeline current={registry.lifecycle_status} />

            {isSimulationBlocked ? (
                <div className="mt-4 border border-warning/40 bg-warning/10 p-3 font-mono text-xs text-foreground/85">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-warning">Regression Simulation Block</div>
                    <div>Reason: {registry.block_reason ?? 'Regression simulation'}</div>
                    <div>Blocked At: {registry.blocked_at ? formatDateTime(registry.blocked_at) : 'n/a'}</div>
                    <div>
                        Simulation:{' '}
                        {registry.blocked_by_simulation_id ? (
                            <a href={`/simulate?simulation_id=${registry.blocked_by_simulation_id}`} className="text-accent underline underline-offset-2">
                                {registry.blocked_by_simulation_id}
                            </a>
                        ) : 'n/a'}
                    </div>
                </div>
            ) : null}

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
                            <div className="space-y-2 break-words font-mono text-xs text-foreground/85">
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
                    <div className="mt-4 space-y-2 break-words font-mono text-xs text-foreground/85">
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
                <Section title="Control Plane Readiness">
                    <div className="grid gap-3 md:grid-cols-3">
                        <DecisionStat
                            label="Registration"
                            value={entry.registration_validation.status === 'valid' ? 'VALID' : 'BLOCKED'}
                            tone={entry.registration_validation.status === 'valid' ? 'accent' : 'warn'}
                        />
                        <DecisionStat
                            label="Rollback Ready"
                            value={renderRollbackReadinessValue(entry)}
                            tone={resolveRollbackReadinessTone(entry)}
                        />
                        <DecisionStat
                            label="Audit Trail"
                            value={entry.audit_trail_ready ? 'RECORDED' : 'MISSING'}
                            tone={entry.audit_trail_ready ? 'accent' : 'warn'}
                        />
                    </div>
                    {entry.registration_validation.reasons.length > 0 ? (
                        <div className="mt-4 space-y-2 break-words font-mono text-xs text-danger">
                            {entry.registration_validation.reasons.map((reason) => (
                                <div key={reason}>{reason}</div>
                            ))}
                        </div>
                    ) : null}
                    {!entry.rollback_readiness.ready && entry.rollback_readiness.reasons.length > 0 ? (
                        <div className="mt-4 space-y-2 break-words font-mono text-xs text-danger">
                            {entry.rollback_readiness.reasons.map((reason) => (
                                <div key={reason}>{reason}</div>
                            ))}
                        </div>
                    ) : null}
                </Section>

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
                            value={entry.rollback_readiness.target_registry_id ?? 'None'}
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
                                <div key={event.event_id} className="border border-grid/40 bg-black/20 px-3 py-2 font-mono text-xs text-foreground/95">
                                    <div className="text-[hsl(0_0%_82%)] font-medium mb-1">{formatDateTime(event.timestamp)}</div>
                                    <div className="break-all whitespace-pre-wrap font-mono">{summarizeMetadata(event.metadata)}</div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </Section>
            </div>

            {registry.rollback_metadata ? (
                <div className="mt-5 border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-foreground/85">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-danger">Last Rollback Metadata</div>
                    <div className="break-words">Triggered: {formatDateTime(registry.rollback_metadata.triggered_at)}</div>
                    <div className="break-all">By: {registry.rollback_metadata.triggered_by ?? 'system'}</div>
                    <div className="break-words">Reason: {registry.rollback_metadata.reason}</div>
                    <div className="break-all">Incident: {registry.rollback_metadata.incident_id ?? 'n/a'}</div>
                </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2 border-t border-grid/30 pt-4">
                <TerminalButton
                    variant="secondary"
                    disabled={isPending}
                    onClick={onRefreshGovernance}
                    title="Recompute calibration, adversarial, safety, and deployment state from stored telemetry."
                >
                    <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
                    Refresh Governance
                </TerminalButton>
                <TerminalButton variant="secondary" disabled={!canStage || isPending} onClick={onStage} title={canStage ? 'Move this candidate into governed staging.' : isLiveProduction ? 'The active production champion cannot be moved back to staging.' : 'Only training or candidate artifacts can be staged.'}>
                    <GitBranchPlus className="mr-2 h-3.5 w-3.5" />
                    Promote To Staging
                </TerminalButton>
                {showApprovalControls ? (
                    <TerminalButton variant="secondary" disabled={isPending} onClick={approvalGranted ? onRevokeApproval : onGrantApproval}>
                        <ShieldAlert className="mr-2 h-3.5 w-3.5" />
                        {approvalGranted ? 'Revoke Manual Approval' : 'Initiate Manual Approval'}
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
                {isSimulationBlocked && canSystemAdminOverride ? (
                    <TerminalButton variant="secondary" disabled={isPending || isUnblockPending} onClick={onUnblock} title="Clear the regression simulation block and re-enable this registry model for promotion workflows.">
                        <ShieldAlert className={`mr-2 h-3.5 w-3.5 ${isUnblockPending ? 'animate-pulse' : ''}`} />
                        {isUnblockPending ? 'OVERRIDING...' : 'System Admin Override'}
                    </TerminalButton>
                ) : null}
            </div>

            {entry.latest_registry_events.length > 0 ? (
                <div className="mt-5 border-t border-grid/30 pt-4">
                    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_88%)] font-bold">Latest Registry Events</div>
                    <div className="space-y-2">
                        {entry.latest_registry_events.slice(0, 4).map((event) => (
                            <div key={event.event_id} className="grid gap-2 border border-grid/30 bg-black/20 px-3 py-2 font-mono text-xs md:grid-cols-[minmax(0,1fr),auto] md:items-start">
                                <div className="min-w-0">
                                    <div className="text-foreground/90">{event.event_type}</div>
                                    <div className="mt-1 break-all whitespace-pre-wrap text-muted">{summarizeMetadata(event.metadata)}</div>
                                </div>
                                <div className="break-words text-muted md:text-right">{formatDateTime(event.timestamp)}</div>
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
    pulse = false,
}: {
    label: string;
    value: number | string;
    tone?: 'default' | 'warn' | 'accent';
    pulse?: boolean;
}) {
    return (
        <div className={`border border-grid bg-black/20 p-3 font-mono transition-all hover:bg-black/30 relative overflow-hidden group ${pulse ? 'ring-1 ring-danger/20' : ''}`}>
            {pulse && <div className="absolute inset-0 bg-danger/5 animate-pulse" />}
            <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                    {pulse && <div className="w-1.5 h-1.5 bg-danger rounded-full animate-ping" />}
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[hsl(0_0%_82%)] font-bold">{label}</div>
                </div>
                <div className={`break-words text-xl leading-tight md:text-2xl font-bold ${tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-danger' : 'text-foreground'}`}>
                    {value}
                </div>
            </div>
            <div className={`absolute bottom-0 left-0 h-[2px] w-0 transition-all duration-500 group-hover:w-full ${tone === 'accent' ? 'bg-accent' : tone === 'warn' ? 'bg-danger' : 'bg-grid'}`} />
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
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_82%)] font-bold">{label}</div>
            <div className={`mt-2 break-words font-mono text-[11px] leading-relaxed font-medium ${tone === 'accent' ? 'text-accent' : 'text-foreground/95'}`}>{value}</div>
        </div>
    );
}

function EmptyPanel({ message, compact = false }: { message: string; compact?: boolean }) {
    return (
        <div className={`flex items-center justify-center border border-dashed border-grid bg-black/10 px-6 text-center font-mono text-xs text-[hsl(0_0%_80%)] font-medium ${compact ? 'min-h-[120px]' : 'min-h-[220px]'}`}>
            {message}
        </div>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="border border-grid/40 bg-black/20 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[hsl(0_0%_88%)] font-bold">{title}</div>
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
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_82%)] font-bold">{label}</div>
            <div className="mt-2 break-all font-mono text-xs text-foreground/95">{value}</div>
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
    const numValue = parseFloat(value);
    const isSafetyMetric = label.toLowerCase().includes('recall') || label.toLowerCase().includes('reassurance') || label.toLowerCase().includes('critical');
    
    let colorClass = 'text-foreground';
    let borderAccent = 'bg-grid/40';
    let bgTint = 'bg-black/20';

    if (!Number.isNaN(numValue)) {
        if (isSafetyMetric) {
            if (numValue < 0.95) { colorClass = 'text-danger'; borderAccent = 'bg-danger'; bgTint = 'bg-danger/5'; }
            else { colorClass = 'text-rose-400'; borderAccent = 'bg-rose-500/50'; }
        } else {
            if (numValue >= 0.90) { colorClass = 'text-accent'; borderAccent = 'bg-accent'; }
            else if (numValue >= 0.75) { colorClass = 'text-warning'; borderAccent = 'bg-warning'; }
            else { colorClass = 'text-danger'; borderAccent = 'bg-danger'; bgTint = 'bg-danger/5'; }
        }
    }

    return (
        <div className={`relative border border-grid/30 p-3 pl-4 transition-all hover:bg-black/40 group ${bgTint}`}>
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${borderAccent} group-hover:w-1.5 transition-all`} />
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_82%)] font-bold">{label}</div>
            <div className={`mt-2 break-words font-mono text-base leading-tight md:text-lg font-bold ${colorClass}`}>{value}</div>
        </div>
    );
}

function GateRow({ label, status }: { label: string; status: GateStatus }) {
    const isFailing = status === 'fail';
    const isPending = status === 'hold' || status === 'unknown';
    
    return (
        <div className={`flex items-center justify-between gap-3 border border-grid/30 px-3 py-2 font-mono text-xs transition-colors ${
            isFailing ? 'bg-danger/10 border-danger/20' : 
            isPending ? 'bg-amber-500/5 border-amber-500/20' : 
            'bg-accent/5 border-accent/20'
        }`}>
            <span className={`min-w-0 break-words font-bold ${isFailing ? 'text-danger' : 'text-foreground/95'}`}>{label}</span>
            <span className={`inline-flex items-center border px-2 py-1 text-[10px] uppercase tracking-[0.16em] font-bold shadow-sm ${gateBadgeClass(status)}`}>
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
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[hsl(0_0%_82%)] font-bold">{label}</div>
            <div className={`mt-2 break-words font-mono text-base leading-tight md:text-lg font-bold ${tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-danger' : 'text-foreground'}`}>
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
        <div className="relative">
            <div className="flex items-center justify-between gap-1">
                {order.map((step, index) => {
                    const isCurrent = step === current;
                    const isReached = current === 'archived'
                        ? index <= currentIndex
                        : step === 'archived'
                            ? false
                            : index <= currentIndex;

                    return (
                        <div key={step} className="flex-1 group relative">
                            {index < order.length - 1 && (
                                <div className={`absolute top-1/2 left-full w-full h-[1px] -translate-y-1/2 z-0 hidden md:block ${
                                    index < currentIndex ? 'bg-accent/40 shadow-[0_0_8px_rgba(var(--accent-rgb),0.3)]' : 'bg-grid/20'
                                }`} />
                            )}
                            <div
                                className={`relative z-10 min-w-0 truncate text-center border px-2 py-2 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.1em] xl:tracking-[0.16em] transition-all duration-300 ${
                                    isCurrent
                                        ? 'border-accent bg-accent/20 text-accent font-bold shadow-[0_0_15px_rgba(var(--accent-rgb),0.2)]'
                                        : isReached
                                            ? 'border-accent/40 bg-accent/5 text-accent/80'
                                            : 'border-grid/20 bg-black/10 text-[hsl(0_0%_60%)]'
                                }`}
                                title={step}
                            >
                                {isReached && !isCurrent && <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-accent/40" />}
                                {step}
                            </div>
                        </div>
                    );
                })}
            </div>
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

function renderRollbackReadinessValue(entry: ModelRegistryControlPlaneEntry) {
    if (entry.registry.lifecycle_status !== 'production' || entry.registry.registry_role !== 'champion') {
        return 'NOT REQUIRED';
    }
    return entry.rollback_readiness.ready ? 'READY' : 'BLOCKED';
}

function resolveRollbackReadinessTone(entry: ModelRegistryControlPlaneEntry): 'default' | 'accent' | 'warn' {
    if (entry.registry.lifecycle_status !== 'production' || entry.registry.registry_role !== 'champion') {
        return 'default';
    }
    return entry.rollback_readiness.ready ? 'accent' : 'warn';
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
        return truncateMetadataValue(String(value));
    }
    return truncateMetadataValue(JSON.stringify(value));
}

function truncateMetadataValue(value: string) {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
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
