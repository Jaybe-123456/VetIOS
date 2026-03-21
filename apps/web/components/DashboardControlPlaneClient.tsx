'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ConsoleCard, Container, DataRow, PageHeader, TerminalButton } from '@/components/ui/terminal';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import type {
    ControlPlaneAlertRecord,
    ControlPlanePipelineState,
    ControlPlaneSnapshot,
    ControlPlaneSnapshotResponse,
} from '@/lib/settings/types';
import type { TopologySnapshot, TopologyStreamPayload } from '@/lib/intelligence/types';
import type { TelemetryEventRecord, TelemetrySnapshot, TelemetryStreamPayload } from '@/lib/telemetry/types';
import {
    Activity,
    AlertTriangle,
    ArrowUpRight,
    Bot,
    Gauge,
    Route,
    Siren,
    Wifi,
    WifiOff,
    Workflow,
} from 'lucide-react';

type StreamStatus = 'connecting' | 'live' | 'disconnected';

export default function DashboardControlPlaneClient() {
    const [snapshot, setSnapshot] = useState<ControlPlaneSnapshot | null>(null);
    const [telemetrySnapshot, setTelemetrySnapshot] = useState<TelemetrySnapshot | null>(null);
    const [topologySnapshot, setTopologySnapshot] = useState<TopologySnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [requestError, setRequestError] = useState<string | null>(null);
    const [telemetryStreamStatus, setTelemetryStreamStatus] = useState<StreamStatus>('connecting');
    const [topologyStreamStatus, setTopologyStreamStatus] = useState<StreamStatus>('connecting');
    const [lastTelemetryUpdate, setLastTelemetryUpdate] = useState<string | null>(null);
    const [lastTopologyUpdate, setLastTopologyUpdate] = useState<string | null>(null);

    const refreshSnapshot = useCallback(async (initial = false) => {
        if (initial) {
            setLoading(true);
        } else {
            setRefreshing(true);
        }

        try {
            const res = await fetch('/api/settings/control-plane', { cache: 'no-store' });
            const data = await res.json() as ControlPlaneSnapshotResponse | { error?: string };
            const errorMessage = 'error' in data ? data.error : undefined;
            if (!res.ok || !('snapshot' in data)) {
                throw new Error(errorMessage ?? 'Failed to load dashboard control-plane snapshot.');
            }

            setSnapshot(data.snapshot);
            setRequestError(null);
        } catch (error) {
            setRequestError(error instanceof Error ? error.message : 'Unknown dashboard error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void refreshSnapshot(true);
        const interval = window.setInterval(() => {
            void refreshSnapshot(false);
        }, 20_000);

        return () => window.clearInterval(interval);
    }, [refreshSnapshot]);

    useEffect(() => {
        setTelemetryStreamStatus('connecting');

        const source = new EventSource('/telemetry/stream');

        source.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data) as TelemetryStreamPayload;
                setTelemetrySnapshot(payload.snapshot);
                setTelemetryStreamStatus('live');
                setLastTelemetryUpdate(new Date().toISOString());
            } catch {
                setTelemetryStreamStatus('disconnected');
            }
        };

        source.addEventListener('stream-error', () => {
            setTelemetryStreamStatus('disconnected');
        });

        source.onerror = () => {
            setTelemetryStreamStatus('disconnected');
        };

        return () => {
            source.close();
        };
    }, []);

    useEffect(() => {
        setTopologyStreamStatus('connecting');

        const source = new EventSource('/intelligence/stream?window=24h');

        source.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data) as TopologyStreamPayload;
                setTopologySnapshot(payload.snapshot);
                setTopologyStreamStatus('live');
                setLastTopologyUpdate(new Date().toISOString());
            } catch {
                setTopologyStreamStatus('disconnected');
            }
        };

        source.addEventListener('stream-error', () => {
            setTopologyStreamStatus('disconnected');
        });

        source.onerror = () => {
            setTopologyStreamStatus('disconnected');
        };

        return () => {
            source.close();
        };
    }, []);

    const activeAlerts = (snapshot?.alerts ?? []).filter((alert) => !alert.resolved);
    const criticalAlertCount = activeAlerts.filter((alert) => alert.severity === 'critical').length;
    const warningAlertCount = activeAlerts.filter((alert) => alert.severity === 'warning').length;
    const networkHealthScore = topologySnapshot?.network_health_score ?? snapshot?.system_health.network_health_score ?? null;
    const telemetryPulse = snapshot?.system_health.event_ingestion_rate ?? null;
    const topologySummary = topologySnapshot
        ? topologySnapshot.summary
        : snapshot
            ? {
                where_failing: snapshot.diagnostics.where_failing,
                root_cause: snapshot.diagnostics.root_cause,
                impact: snapshot.diagnostics.impact,
                next_action: snapshot.diagnostics.next_action,
            }
            : null;
    const routingOverview = buildRoutingOverview(topologySnapshot);
    const recentInferences = buildRecentInferences(snapshot?.telemetry_events ?? []);
    const recentLogs = (snapshot?.logs ?? []).slice(0, 8);
    const governanceFamilies = snapshot?.governance.families ?? [];
    const pipelineStates = snapshot?.pipelines ?? [];
    const loadingWithoutData = loading && !snapshot && !telemetrySnapshot && !topologySnapshot;

    return (
        <Container className="pb-10">
            <PageHeader
                title="SYSTEM DASHBOARD"
                description="Live operational control across telemetry, topology, routing, governance, and self-healing decisions."
            />

            <div className="mb-4 sm:mb-6 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] sm:text-xs uppercase tracking-[0.2em]">
                    <StatusChip
                        label={telemetryStreamStatus === 'live' ? 'Telemetry Live' : telemetryStreamStatus === 'connecting' ? 'Telemetry Connecting' : 'Telemetry Disconnected'}
                        tone={streamTone(telemetryStreamStatus)}
                        icon={telemetryStreamStatus === 'live' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                    />
                    <StatusChip
                        label={topologyStreamStatus === 'live' ? 'Topology Live' : topologyStreamStatus === 'connecting' ? 'Topology Connecting' : 'Topology Disconnected'}
                        tone={streamTone(topologyStreamStatus)}
                        icon={topologyStreamStatus === 'live' ? <Workflow className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    />
                    <StatusChip
                        label={`Alerts ${activeAlerts.length}`}
                        tone={criticalAlertCount > 0 ? 'danger' : warningAlertCount > 0 ? 'warning' : 'accent'}
                        icon={<Siren className="w-3 h-3" />}
                    />
                    <StatusChip
                        label={`Routing Shifts ${routingOverview.routingShiftCount}`}
                        tone={routingOverview.routingShiftCount > 0 ? 'warning' : 'accent'}
                        icon={<Route className="w-3 h-3" />}
                    />
                    <span className="ml-auto text-muted normal-case tracking-normal">
                        {snapshot?.refreshed_at
                            ? `Control plane refreshed ${new Date(snapshot.refreshed_at).toLocaleTimeString()}`
                            : loadingWithoutData
                                ? 'Loading control-plane snapshot...'
                                : 'No control-plane snapshot loaded'}
                    </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] sm:text-xs text-muted">
                    <TerminalButton type="button" variant="secondary" onClick={() => void refreshSnapshot(false)}>
                        {refreshing ? 'Refreshing...' : 'Refresh Control Plane'}
                    </TerminalButton>
                    <Link href="/telemetry" className="flex items-center gap-1 hover:text-accent transition-colors">
                        Open Telemetry <ArrowUpRight className="w-3 h-3" />
                    </Link>
                    <Link href="/intelligence" className="flex items-center gap-1 hover:text-accent transition-colors">
                        Open Topology <ArrowUpRight className="w-3 h-3" />
                    </Link>
                    <Link href="/settings" className="flex items-center gap-1 hover:text-accent transition-colors">
                        Open Control Plane <ArrowUpRight className="w-3 h-3" />
                    </Link>
                    <span className="ml-auto">
                        Telemetry update {formatTimestampOrState(lastTelemetryUpdate, telemetryStreamStatus)}
                        {' | '}
                        Topology update {formatTimestampOrState(lastTopologyUpdate, topologyStreamStatus)}
                    </span>
                </div>

                {requestError ? (
                    <div className="border border-danger bg-danger/5 p-3 font-mono text-xs text-danger">
                        {requestError}
                    </div>
                ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mb-4 sm:mb-6">
                <MetricCard
                    label="Network Health"
                    value={networkHealthScore != null ? `${networkHealthScore}%` : 'NO DATA'}
                    tone={healthTone(networkHealthScore)}
                    icon={<Gauge className="w-4 h-4" />}
                    detail={topologySnapshot?.control_plane_state ?? snapshot?.system_health.topology_state ?? 'CONTROL_PLANE_INITIALIZING'}
                />
                <MetricCard
                    label="Telemetry Pulse"
                    value={telemetryPulse != null ? `${telemetryPulse.toFixed(2)}/min` : 'NO DATA'}
                    tone={telemetrySnapshot?.system_state === 'STALE' || telemetryStreamStatus === 'disconnected' ? 'danger' : 'accent'}
                    icon={<Activity className="w-4 h-4" />}
                    detail={telemetrySnapshot?.last_event_timestamp ? `Last event ${new Date(telemetrySnapshot.last_event_timestamp).toLocaleTimeString()}` : 'Waiting for telemetry'}
                />
                <MetricCard
                    label="Decision Fabric"
                    value={snapshot ? snapshot.decision_engine.mode.toUpperCase() : 'NO DATA'}
                    tone={snapshot?.decision_engine.mode === 'autonomous' ? 'danger' : snapshot?.decision_engine.mode === 'assist' ? 'warning' : 'accent'}
                    icon={<Bot className="w-4 h-4" />}
                    detail={snapshot ? `${snapshot.decision_engine.active_decision_count} active | ${snapshot.decision_engine.latest_action ?? 'No action yet'}` : 'Decision engine unavailable'}
                />
                <MetricCard
                    label="Active Alerts"
                    value={String(activeAlerts.length)}
                    tone={criticalAlertCount > 0 ? 'danger' : warningAlertCount > 0 ? 'warning' : 'accent'}
                    icon={<AlertTriangle className="w-4 h-4" />}
                    detail={criticalAlertCount > 0 ? `${criticalAlertCount} critical | ${warningAlertCount} warning` : activeAlerts.length > 0 ? `${warningAlertCount} warnings` : 'No unresolved alerts'}
                />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-6 mb-4 sm:mb-6">
                <div className="xl:col-span-2">
                    <ConsoleCard title="Operational Intelligence" collapsible>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                            <DataPanel label="Where Failing" value={topologySummary?.where_failing ?? 'NO DATA'} />
                            <DataPanel label="Root Cause" value={topologySummary?.root_cause ?? 'NO DATA'} />
                            <DataPanel label="Impact" value={topologySummary?.impact ?? 'NO DATA'} />
                            <DataPanel label="Next Action" value={topologySummary?.next_action ?? 'NO DATA'} />
                        </div>
                    </ConsoleCard>
                </div>

                <ConsoleCard title="Autonomous Posture" collapsible>
                    <DataRow label="Decision Mode" value={<StateText tone={snapshot?.decision_engine.mode === 'autonomous' ? 'danger' : snapshot?.decision_engine.mode === 'assist' ? 'warning' : 'accent'}>{snapshot?.decision_engine.mode.toUpperCase() ?? 'NO DATA'}</StateText>} />
                    <DataRow label="Safe Mode" value={snapshot?.decision_engine.safe_mode_enabled ? 'ENABLED' : snapshot ? 'DISABLED' : 'NO DATA'} />
                    <DataRow label="Simulation" value={snapshot?.configuration.simulation_enabled ? 'ENABLED' : snapshot ? 'DISABLED' : 'NO DATA'} />
                    <DataRow label="Active Decisions" value={snapshot ? String(snapshot.decision_engine.active_decision_count) : 'NO DATA'} />
                    <DataRow label="Latest Trigger" value={snapshot?.decision_engine.latest_trigger ?? 'NO DATA'} />
                    <DataRow label="Latest Action" value={snapshot?.decision_engine.latest_action ?? 'NO DATA'} />
                    <DataRow label="Safe Execute Threshold" value={snapshot ? `${(snapshot.decision_engine.auto_execute_confidence_threshold * 100).toFixed(0)}%` : 'NO DATA'} />
                </ConsoleCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 lg:gap-6 mb-4 sm:mb-6">
                <ConsoleCard title="Latency Envelope (p95 window input)" className="h-[260px] sm:h-[320px]" collapsible>
                    {telemetrySnapshot && telemetrySnapshot.charts.latency.length > 0 ? (
                        <div className="flex-1 -mx-2 sm:-mx-4 h-full">
                            <TelemetryChart data={telemetrySnapshot.charts.latency} color="#00ff41" />
                        </div>
                    ) : (
                        <EmptyChartState message={resolveLatencyChartMessage(telemetrySnapshot, telemetryStreamStatus)} />
                    )}
                </ConsoleCard>

                <ConsoleCard title="Outcome Drift Signal" className="h-[260px] sm:h-[320px]" collapsible>
                    {telemetrySnapshot && telemetrySnapshot.charts.drift.length > 0 ? (
                        <div className="flex-1 -mx-2 sm:-mx-4 h-full">
                            <TelemetryChart data={telemetrySnapshot.charts.drift} color="#ff3333" />
                        </div>
                    ) : (
                        <EmptyChartState message={resolveDriftChartMessage(telemetrySnapshot, telemetryStreamStatus)} />
                    )}
                </ConsoleCard>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-6 mb-4 sm:mb-6">
                <ConsoleCard title="Pipeline Health" collapsible>
                    {pipelineStates.length > 0 ? (
                        pipelineStates.map((pipeline) => (
                            <div key={pipeline.key} className="py-2 border-b border-muted/30">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="font-mono text-xs uppercase text-muted">{pipeline.label}</div>
                                    <StateText tone={pipelineTone(pipeline.status)}>{pipeline.status}</StateText>
                                </div>
                                <div className="mt-2 font-mono text-[11px] text-foreground">
                                    {pipeline.last_successful_event ? `Last success ${new Date(pipeline.last_successful_event).toLocaleString()}` : 'NO DATA'}
                                </div>
                                <div className="mt-1 font-mono text-[10px] text-muted">
                                    {pipeline.error_logs.length > 0 ? pipeline.error_logs[0] : 'No active pipeline errors.'}
                                </div>
                            </div>
                        ))
                    ) : (
                        <EmptyListState message="NO PIPELINE SNAPSHOT" />
                    )}
                </ConsoleCard>

                <ConsoleCard title="Model Governance" collapsible>
                    {governanceFamilies.length > 0 ? (
                        governanceFamilies.map((family) => (
                            <div key={family.model_family} className="py-2 border-b border-muted/30">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="font-mono text-xs uppercase text-accent">{family.model_family}</div>
                                    <span className="font-mono text-[10px] text-muted">{family.entries.length} entries</span>
                                </div>
                                <div className="mt-2 font-mono text-[11px] text-foreground">
                                    PROD {family.current_production_model ?? 'NO DATA'}
                                </div>
                                <div className="mt-1 font-mono text-[10px] text-muted">
                                    Stage {family.staging_candidate ?? 'NO DATA'} | Rollback {family.rollback_target ?? 'NO DATA'}
                                </div>
                                <div className="mt-1 font-mono text-[10px] text-muted">
                                    {summarizeFamilyGovernance(family)}
                                </div>
                            </div>
                        ))
                    ) : (
                        <EmptyListState message="NO GOVERNANCE DATA" />
                    )}
                </ConsoleCard>

                <ConsoleCard title="Routing Fabric" collapsible>
                    <DataRow label="Top Route" value={routingOverview.topModels[0] ? `${routingOverview.topModels[0].model_id} (${routingOverview.topModels[0].request_count})` : 'NO DATA'} />
                    <DataRow label="Route Shifts" value={String(routingOverview.routingShiftCount)} />
                    <DataRow label="Fallbacks" value={String(routingOverview.fallbackCount)} />
                    <DataRow label="Ensembles" value={String(routingOverview.ensembleCount)} />
                    <DataRow label="Families Active" value={String(routingOverview.familyCount)} />
                    <div className="mt-3 border-t border-grid pt-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mb-2">
                            Live Distribution
                        </div>
                        {routingOverview.familyRows.length > 0 ? (
                            <div className="space-y-2">
                                {routingOverview.familyRows.slice(0, 4).map((row) => (
                                    <div key={row.family} className="font-mono text-[11px] text-foreground">
                                        <span className="text-muted uppercase mr-2">{row.family}</span>
                                        {row.top_model ?? 'NO DATA'}
                                        <span className="text-muted ml-2">{row.total_requests} req</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyListState message="NO ROUTING DATA" compact />
                        )}
                    </div>
                </ConsoleCard>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                <div className="xl:col-span-2">
                    <ConsoleCard title="Recent Inferences" collapsible>
                        {recentInferences.length > 0 ? (
                            recentInferences.map((event) => (
                                <div key={event.event_id} className="py-2 border-b border-muted/30">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="font-mono text-xs text-foreground break-all">{event.event_id}</div>
                                        <StateText tone={eventTone(event)}>
                                            {formatInferenceOutcome(event)}
                                        </StateText>
                                    </div>
                                    <div className="mt-2 font-mono text-[10px] text-muted">
                                        model={resolveRouteModel(event)} | confidence={formatPercent(event.metrics.confidence)} | latency={formatLatency(event.metrics.latency_ms)}
                                    </div>
                                    <div className="mt-1 font-mono text-[10px] text-muted">
                                        {new Date(event.timestamp).toLocaleString()}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <EmptyListState message="NO INFERENCE ACTIVITY" />
                        )}
                    </ConsoleCard>
                </div>

                <ConsoleCard title="System Alerts" collapsible>
                    {activeAlerts.length > 0 ? (
                        <div className="space-y-3">
                            {activeAlerts.slice(0, 6).map((alert) => (
                                <AlertRow key={alert.id} alert={alert} />
                            ))}
                        </div>
                    ) : (
                        <EmptyListState message="NO ACTIVE ALERTS" />
                    )}

                    <div className="mt-4 border-t border-grid pt-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mb-2">
                            Recent Signal Flow
                        </div>
                        {recentLogs.length > 0 ? (
                            <div className="space-y-2">
                                {recentLogs.map((log) => (
                                    <div key={log.id} className={`font-mono text-[10px] break-words ${logTone(log.level)}`}>
                                        <span className="text-muted mr-2">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                        {log.message}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyListState message="NO CONTROL-PLANE LOGS" compact />
                        )}
                    </div>
                </ConsoleCard>
            </div>
        </Container>
    );
}

function MetricCard({
    label,
    value,
    tone,
    icon,
    detail,
}: {
    label: string;
    value: string;
    tone: 'accent' | 'warning' | 'danger' | 'muted';
    icon: ReactNode;
    detail: string;
}) {
    return (
        <ConsoleCard>
            <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] sm:text-xs text-muted uppercase">{label}</span>
                <span className={toneClass(tone)}>{icon}</span>
            </div>
            <div className={`font-mono text-lg sm:text-2xl ${toneClass(tone)}`}>{value}</div>
            <div className="font-mono text-[10px] text-muted mt-2">{detail}</div>
        </ConsoleCard>
    );
}

function StatusChip({
    label,
    tone,
    icon,
}: {
    label: string;
    tone: 'accent' | 'warning' | 'danger' | 'muted';
    icon?: ReactNode;
}) {
    return (
        <span className={`inline-flex items-center gap-1.5 border px-2 py-1 ${chipToneClass(tone)}`}>
            {icon}
            {label}
        </span>
    );
}

function DataPanel({ label, value }: { label: string; value: string }) {
    return (
        <div className="border border-grid bg-black/20 p-3 sm:p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mb-2">{label}</div>
            <div className="font-mono text-sm text-foreground leading-relaxed">{value}</div>
        </div>
    );
}

function AlertRow({ alert }: { alert: ControlPlaneAlertRecord }) {
    return (
        <div className="flex gap-3">
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${alertDotTone(alert.severity)}`} />
            <div className="flex flex-col gap-1">
                <span className={`font-mono text-xs uppercase tracking-wider ${alertTextTone(alert.severity)}`}>
                    {alert.title}
                </span>
                <span className="font-mono text-[10px] text-muted leading-relaxed">{alert.message}</span>
                <span className="font-mono text-[10px] text-muted/70">{new Date(alert.timestamp).toLocaleString()}</span>
            </div>
        </div>
    );
}

function EmptyChartState({ message }: { message: string }) {
    return (
        <div className="h-full flex items-center justify-center text-muted text-[10px] sm:text-xs font-mono border border-dashed border-grid">
            {message}
        </div>
    );
}

function EmptyListState({ message, compact = false }: { message: string; compact?: boolean }) {
    return (
        <div className={`font-mono text-xs text-muted border border-dashed border-grid grid place-items-center ${compact ? 'h-20' : 'h-32'}`}>
            {message}
        </div>
    );
}

function buildRecentInferences(events: TelemetryEventRecord[]) {
    return events
        .filter((event) => event.event_type === 'inference')
        .slice()
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
        .slice(0, 6);
}

function buildRoutingOverview(topologySnapshot: TopologySnapshot | null) {
    const distribution = new Map<string, number>();
    const familyRows: Array<{ family: string; top_model: string | null; total_requests: number }> = [];
    let routingShiftCount = 0;
    let fallbackCount = 0;
    let ensembleCount = 0;
    let familyCount = 0;

    for (const node of topologySnapshot?.nodes ?? []) {
        if (node.kind !== 'model') continue;
        familyCount += 1;
        routingShiftCount += numberOrZero(node.metadata.routing_shift_count);
        fallbackCount += numberOrZero(node.metadata.fallback_count);
        ensembleCount += numberOrZero(node.metadata.ensemble_count);

        const routedDistribution = Array.isArray(node.metadata.routed_model_distribution)
            ? node.metadata.routed_model_distribution
            : [];

        const parsed = routedDistribution
            .map((entry) => asRecord(entry))
            .map((entry) => ({
                model_id: textOrNull(entry.model_id),
                request_count: numberOrZero(entry.request_count),
            }))
            .filter((entry) => entry.model_id != null);

        for (const entry of parsed) {
            distribution.set(entry.model_id!, (distribution.get(entry.model_id!) ?? 0) + entry.request_count);
        }

        familyRows.push({
            family: node.label,
            top_model: parsed[0]?.model_id ?? null,
            total_requests: parsed.reduce((sum, entry) => sum + entry.request_count, 0),
        });
    }

    const topModels = Array.from(distribution.entries())
        .map(([model_id, request_count]) => ({ model_id, request_count }))
        .sort((left, right) => right.request_count - left.request_count)
        .slice(0, 5);

    return {
        topModels,
        routingShiftCount,
        fallbackCount,
        ensembleCount,
        familyCount,
        familyRows,
    };
}

function summarizeFamilyGovernance(family: ControlPlaneSnapshot['governance']['families'][number]) {
    const rejected = family.entries.filter((entry) => entry.deployment_decision === 'rejected').length;
    const pending = family.entries.filter((entry) => entry.deployment_decision === 'hold').length;
    if (rejected > 0) {
        return `${rejected} rejected candidate(s) blocked from live promotion.`;
    }
    if (pending > 0) {
        return `${pending} gated candidate(s) waiting on approval.`;
    }
    return 'Active route is clear for governed deployment.';
}

function streamTone(status: StreamStatus) {
    if (status === 'live') return 'accent' as const;
    if (status === 'disconnected') return 'danger' as const;
    return 'muted' as const;
}

function healthTone(score: number | null) {
    if (score == null) return 'muted' as const;
    if (score < 55) return 'danger' as const;
    if (score < 75) return 'warning' as const;
    return 'accent' as const;
}

function pipelineTone(status: ControlPlanePipelineState['status']) {
    if (status === 'FAILED') return 'danger' as const;
    if (status === 'INITIALIZING') return 'warning' as const;
    return 'accent' as const;
}

function toneClass(tone: 'accent' | 'warning' | 'danger' | 'muted') {
    if (tone === 'warning') return 'text-[#ffcc00]';
    if (tone === 'danger') return 'text-danger';
    if (tone === 'muted') return 'text-muted';
    return 'text-accent';
}

function chipToneClass(tone: 'accent' | 'warning' | 'danger' | 'muted') {
    if (tone === 'warning') return 'border-[#ffcc00]/30 text-[#ffcc00] bg-[#ffcc00]/5';
    if (tone === 'danger') return 'border-danger/30 text-danger bg-danger/5';
    if (tone === 'muted') return 'border-grid text-muted bg-black/20';
    return 'border-accent/30 text-accent bg-accent/5';
}

function alertDotTone(severity: ControlPlaneAlertRecord['severity']) {
    if (severity === 'critical') return 'bg-danger';
    if (severity === 'warning') return 'bg-[#ffcc00]';
    return 'bg-accent';
}

function alertTextTone(severity: ControlPlaneAlertRecord['severity']) {
    if (severity === 'critical') return 'text-danger';
    if (severity === 'warning') return 'text-[#ffcc00]';
    return 'text-accent';
}

function logTone(level: 'INFO' | 'WARN' | 'ERROR') {
    if (level === 'ERROR') return 'text-danger';
    if (level === 'WARN') return 'text-[#ffcc00]';
    return 'text-muted/80';
}

function formatTimestampOrState(timestamp: string | null, streamStatus: StreamStatus) {
    if (timestamp) return new Date(timestamp).toLocaleTimeString();
    return streamStatus === 'disconnected' ? 'STREAM DISCONNECTED' : 'NO DATA';
}

function resolveLatencyChartMessage(snapshot: TelemetrySnapshot | null, streamStatus: StreamStatus) {
    if (streamStatus === 'disconnected' && !snapshot) return 'STREAM DISCONNECTED';
    if (snapshot?.metric_states.p95_latency === 'NO_DATA') return 'NO DATA';
    return 'WAITING FOR LATENCY SIGNALS';
}

function resolveDriftChartMessage(snapshot: TelemetrySnapshot | null, streamStatus: StreamStatus) {
    if (streamStatus === 'disconnected' && !snapshot) return 'STREAM DISCONNECTED';
    if (snapshot?.metric_states.drift_score === 'INSUFFICIENT_OUTCOMES') return 'INSUFFICIENT DATA';
    if (snapshot?.metric_states.drift_score === 'NO_DATA') return 'NO DATA';
    return 'WAITING FOR DRIFT SIGNALS';
}

function formatPercent(value: number | null | undefined) {
    if (value == null) return 'NO DATA';
    return `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value: number | null | undefined) {
    if (value == null) return 'NO DATA';
    return `${value.toFixed(1)}ms`;
}

function formatInferenceOutcome(event: TelemetryEventRecord) {
    const confidence = formatPercent(event.metrics.confidence);
    return confidence === 'NO DATA' ? 'LIVE' : confidence;
}

function resolveRouteModel(event: TelemetryEventRecord) {
    return textOrNull(event.metadata.routing_selected_model_id)
        ?? textOrNull(event.metadata.routing_selected_model_name)
        ?? event.model_version
        ?? 'NO DATA';
}

function eventTone(event: TelemetryEventRecord) {
    const latency = typeof event.metrics.latency_ms === 'number' ? event.metrics.latency_ms : null;
    if (latency != null && latency > 2_000) return 'danger' as const;
    if (latency != null && latency > 800) return 'warning' as const;
    return 'accent' as const;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function textOrNull(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberOrZero(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function StateText({
    children,
    tone,
}: {
    children: ReactNode;
    tone: 'accent' | 'warning' | 'danger' | 'muted';
}) {
    return (
        <span className={`font-mono text-xs uppercase ${toneClass(tone)}`}>
            {children}
        </span>
    );
}
