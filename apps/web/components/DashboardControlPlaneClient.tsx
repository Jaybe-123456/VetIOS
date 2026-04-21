'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ConsoleCard, Container, DataRow, PageHeader, TerminalButton, TerminalTabs } from '@/components/ui/terminal';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import type {
    ControlPlaneAlertRecord,
    ControlPlaneDashboardGovernanceFamilySummary,
    ControlPlaneDashboardInferenceRecord,
    ControlPlaneDashboardSnapshotResponse,
    ControlPlaneDashboardViewSnapshot,
    ControlPlanePipelineState,
} from '@/lib/settings/types';
import type { TopologySnapshot, TopologyStreamPayload } from '@/lib/intelligence/types';
import type { TelemetrySnapshot, TelemetryStreamPayload } from '@/lib/telemetry/types';
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
    Database,
    Network,
    ShieldAlert,
    Cpu,
} from 'lucide-react';

type StreamStatus = 'connecting' | 'live' | 'disconnected';
type DashboardTab = 'overview' | 'cire';

type CireStatusSnapshot = {
    phi_population_mean: number;
    rolling_cps: number;
    safety_state_distribution: {
        nominal: number;
        warning: number;
        critical: number;
        blocked: number;
    };
    incident_count_7d: number;
    calibration_status: 'calibrated' | 'uncalibrated' | 'stale';
    last_calibrated_at: string | null;
};

type CireIncidentRecord = {
    id: string;
    inference_id: string;
    safety_state: 'nominal' | 'warning' | 'critical' | 'blocked';
    phi_hat: number | null;
    cps: number | null;
    resolved: boolean;
    created_at: string;
};

type CireHistoryPoint = {
    timestamp: string;
    phi_mean: number;
    cps_mean: number;
    incident_count: number;
};

type CireCollapseProfile = {
    model_version: string;
    phi_baseline: number;
    hii: number | null;
    calibrated_at: string;
    m_threshold_map: Record<string, unknown>;
};

interface CireApiResponse<T> {
    data?: T;
    error?: string | { message: string };
}

export default function DashboardControlPlaneClient() {
    const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
    const [snapshot, setSnapshot] = useState<ControlPlaneDashboardViewSnapshot | null>(null);
    const [telemetrySnapshot, setTelemetrySnapshot] = useState<TelemetrySnapshot | null>(null);
    const [topologySnapshot, setTopologySnapshot] = useState<TopologySnapshot | null>(null);
    const [cireStatus, setCireStatus] = useState<CireStatusSnapshot | null>(null);
    const [cireHistory, setCireHistory] = useState<CireHistoryPoint[]>([]);
    const [cireIncidents, setCireIncidents] = useState<CireIncidentRecord[]>([]);
    const [cireProfile, setCireProfile] = useState<CireCollapseProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [requestError, setRequestError] = useState<string | null>(null);
    const [pageVisible, setPageVisible] = useState(true);
    const [telemetryStreamStatus, setTelemetryStreamStatus] = useState<StreamStatus>('connecting');
    const [topologyStreamStatus, setTopologyStreamStatus] = useState<StreamStatus>('connecting');
    const [lastTelemetryUpdate, setLastTelemetryUpdate] = useState<string | null>(null);
    const [lastTopologyUpdate, setLastTopologyUpdate] = useState<string | null>(null);
    const [cireActionState, setCireActionState] = useState<'idle' | 'working'>('idle');

    const refreshSnapshot = useCallback(async (initial = false) => {
        if (initial) {
            setLoading(true);
        } else {
            setRefreshing(true);
        }

        try {
            const res = await fetch('/api/settings/control-plane?view=dashboard', { cache: 'no-store' });
            const data = await res.json() as ControlPlaneDashboardSnapshotResponse | { error?: string };
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

    const refreshCire = useCallback(async () => {
        try {
            const from = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
            const [statusRes, historyRes, incidentsRes, profileRes] = await Promise.all([
                fetch('/api/cire/status', { cache: 'no-store' }),
                fetch(`/api/cire/phi-history?from=${encodeURIComponent(from)}&granularity=hour`, { cache: 'no-store' }),
                fetch('/api/cire/incidents?resolved=false&limit=6', { cache: 'no-store' }),
                fetch('/api/cire/collapse-profile', { cache: 'no-store' }),
            ]);

            const [statusJson, historyJson, incidentsJson, profileJson] = (await Promise.all([
                statusRes.json(),
                historyRes.json(),
                incidentsRes.json(),
                profileRes.json(),
            ])) as [
                CireApiResponse<CireStatusSnapshot>,
                CireApiResponse<CireHistoryPoint[]>,
                CireApiResponse<CireIncidentRecord[]>,
                CireApiResponse<CireCollapseProfile>
            ];

            if (statusRes.ok) {
                setCireStatus(statusJson.data ?? null);
            }
            if (historyRes.ok) {
                setCireHistory(Array.isArray(statusJson.data) ? (statusJson.data as unknown as CireHistoryPoint[]) : (historyJson.data ?? []));
            }
            if (incidentsRes.ok) {
                setCireIncidents(Array.isArray(incidentsJson.data) ? incidentsJson.data : []);
            }
            if (profileRes.ok) {
                setCireProfile(profileJson.data ?? null);
            }
        } catch (error) {
            console.warn('Failed to refresh CIRE dashboard state:', error);
        }
    }, []);

    useEffect(() => {
        const handleVisibilityChange = () => {
            setPageVisible(document.visibilityState === 'visible');
        };

        handleVisibilityChange();
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const tab = new URLSearchParams(window.location.search).get('tab');
            if (tab === 'cire') {
                setActiveTab('cire');
            }
        }
    }, []);

    useEffect(() => {
        void refreshSnapshot(true);
        void refreshCire();
        const interval = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            void refreshSnapshot(false);
            void refreshCire();
        }, 60_000);

        return () => window.clearInterval(interval);
    }, [refreshSnapshot, refreshCire]);

    useEffect(() => {
        if (!pageVisible) return;
        setTelemetryStreamStatus('connecting');

        const source = new EventSource('/telemetry/stream');

        source.onmessage = (event: MessageEvent) => {
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
    }, [pageVisible]);

    useEffect(() => {
        if (!pageVisible) return;
        setTopologyStreamStatus('connecting');

        const source = new EventSource('/intelligence/stream?window=24h');

        source.onmessage = (event: MessageEvent) => {
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
    }, [pageVisible]);

    const activeAlerts = (snapshot?.alerts ?? []).filter((alert) => !alert.resolved);
    const criticalAlertCount = activeAlerts.filter((alert) => alert.severity === 'critical').length;
    const warningAlertCount = activeAlerts.filter((alert) => alert.severity === 'warning').length;
    const networkHealthScore = topologySnapshot?.network_health_score ?? snapshot?.system_health.network_health_score ?? null;
    const telemetryPulse = snapshot?.system_health.event_ingestion_rate ?? null;
    const dashboardLens = snapshot?.dashboard ?? null;
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
    const governanceFamilies = snapshot?.governance.families ?? [];
    const routingOverview = buildRoutingOverview(topologySnapshot, dashboardLens?.routing ?? null, governanceFamilies);
    const recentInferences = dashboardLens?.recent_inferences ?? [];
    const recentLogs = (snapshot?.logs ?? []).slice(0, 8);
    const pipelineStates = snapshot?.pipelines ?? [];
    const loadingWithoutData = loading && !snapshot && !telemetrySnapshot && !topologySnapshot;
    const cireHistoryChart = cireHistory.map((point) => ({
        time: new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        value: point.phi_mean,
        cps: point.cps_mean,
    }));

    const handleCireCalibration = useCallback(async () => {
        setCireActionState('working');
        try {
            const response = await fetch('/api/cire/calibrate', {
                method: 'POST',
                cache: 'no-store',
            });
            const result = await response.json() as CireApiResponse<{ simulation_id?: string }>;
            if (!response.ok) {
                const errorObj = result.error;
                throw new Error(typeof errorObj === 'object' ? errorObj.message : (errorObj ?? 'Failed to start CIRE calibration.'));
            }
            window.location.href = `/simulate?simulation_id=${result.data?.simulation_id ?? ''}`;
        } catch (error) {
            setRequestError(error instanceof Error ? error.message : 'Failed to start CIRE calibration.');
        } finally {
            setCireActionState('idle');
        }
    }, []);

    const handleResolveCireIncident = useCallback(async (incidentId: string) => {
        setCireActionState('working');
        try {
            const response = await fetch(`/api/cire/incidents/${incidentId}/resolve`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({
                    resolution_notes: 'Resolved from system dashboard',
                }),
            });
            const result = await response.json() as CireApiResponse<unknown>;
            if (!response.ok) {
                const errorObj = result.error;
                throw new Error(typeof errorObj === 'object' ? errorObj.message : (errorObj ?? 'Failed to resolve CIRE incident.'));
            }
            await refreshCire();
        } catch (error) {
            setRequestError(error instanceof Error ? error.message : 'Failed to resolve CIRE incident.');
        } finally {
            setCireActionState('idle');
        }
    }, [refreshCire]);

    return (
        <Container className="pb-10">
            <PageHeader
                title="SYSTEM DASHBOARD"
                description="Live operational control across telemetry, topology, routing, governance, and self-healing decisions."
            />

            <div className="mb-4">
                <TerminalTabs
                    tabs={[
                        { id: 'overview', label: 'Overview', icon: <Activity className="w-4 h-4" /> },
                        { id: 'cire', label: 'CIRE', icon: <ShieldAlert className="w-4 h-4" /> },
                    ]}
                    activeTab={activeTab}
                    onTabChange={(tab) => setActiveTab(tab as DashboardTab)}
                />
            </div>

            {activeTab === 'overview' && (
                <>
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
                </div>

                {/* ── Control Plane Operations HUD ── */}
                <ConsoleCard title="Control Plane Core Operations" className="mt-4 border-accent shadow-[0_0_15px_rgba(0,255,65,0.15)] bg-background" collapsible defaultCollapsed={false}>
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-4">
                        <button type="button" onClick={() => void refreshSnapshot(false)} className="col-span-2 xl:col-span-1 border border-accent/60 shadow-[0_0_10px_rgba(0,255,65,0.2)] bg-accent/5 hover:bg-accent hover:text-black text-accent flex flex-col items-center justify-center gap-2 h-full py-5 transition-all text-[10px] sm:text-xs font-mono uppercase tracking-widest disabled:opacity-50">
                            <Activity className={`w-6 h-6 ${refreshing ? 'animate-spin' : ''}`} />
                            {refreshing ? 'REFRESHING...' : 'REFRESH\nSNAPSHOT'}
                        </button>
                        <Link href="/settings" className="border border-[hsl(0_0%_20%)] hover:border-accent/50 bg-[hsl(0_0%_8%)] flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-accent group-hover:drop-shadow-[0_0_8px_rgba(0,255,65,0.8)]"><Route className="w-6 h-6" /></div>
                            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[hsl(0_0%_82%)] group-hover:text-[hsl(0_0%_95%)]">Outbox Ops</div>
                        </Link>
                        <Link href="/settings" className="border border-[hsl(0_0%_20%)] hover:border-accent/50 bg-[hsl(0_0%_8%)] flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-accent group-hover:drop-shadow-[0_0_8px_rgba(0,255,65,0.8)]"><Workflow className="w-6 h-6" /></div>
                            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[hsl(0_0%_82%)] group-hover:text-[hsl(0_0%_95%)]">Federation Ops</div>
                        </Link>
                        <Link href="/settings" className="border border-grid hover:border-[#ffcc00]/50 bg-background/50 flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-[#ffcc00] group-hover:drop-shadow-[0_0_8px_rgba(255,204,0,0.8)]"><Database className="w-6 h-6" /></div>
                            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[hsl(0_0%_82%)] group-hover:text-[hsl(0_0%_95%)]">PetPass Ops</div>
                        </Link>
                        <Link href="/settings" className="border border-[hsl(0_0%_20%)] hover:border-accent/50 bg-[hsl(0_0%_8%)] flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-accent group-hover:drop-shadow-[0_0_8px_rgba(0,255,65,0.8)]"><Network className="w-6 h-6" /></div>
                            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[hsl(0_0%_82%)] group-hover:text-[hsl(0_0%_95%)]">Partner Ops</div>
                        </Link>
                        <Link href="/settings" className="border border-[hsl(0_0%_20%)] hover:border-accent/50 bg-[hsl(0_0%_8%)] flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-accent group-hover:drop-shadow-[0_0_8px_rgba(0,255,65,0.8)]"><ShieldAlert className="w-6 h-6" /></div>
                            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[hsl(0_0%_82%)] group-hover:text-[hsl(0_0%_95%)]">Trust Ops</div>
                        </Link>
                        <Link href="/settings" className="border border-[hsl(0_0%_20%)] hover:border-accent/50 bg-[hsl(0_0%_8%)] flex flex-col justify-center gap-3 p-4 transition-all group">
                            <div className="text-accent group-hover:drop-shadow-[0_0_8px_rgba(0,255,65,0.7)]"><Cpu className="w-6 h-6" /></div>
                            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[hsl(0_0%_82%)] group-hover:text-[hsl(0_0%_95%)]">Edge Ops</div>
                        </Link>
                    </div>

                    <div className="flex flex-wrap items-center justify-between font-mono text-[10px] sm:text-[11px] text-[hsl(0_0%_82%)] tracking-[0.14em] uppercase border-t border-[hsl(0_0%_20%)] pt-3">
                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-6">
                            <span>
                                T-UPDATE: <span className="text-foreground">{formatTimestampOrState(lastTelemetryUpdate, telemetryStreamStatus)}</span>
                            </span>
                            <span>
                                N-UPDATE: <span className="text-foreground">{formatTimestampOrState(lastTopologyUpdate, topologyStreamStatus)}</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-accent mt-2 sm:mt-0 drop-shadow-[0_0_3px_rgba(0,255,65,0.5)]">
                            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                            {snapshot?.refreshed_at
                                ? `SYNCED ${new Date(snapshot.refreshed_at).toLocaleTimeString()}`
                                : loadingWithoutData
                                    ? 'CONNECTING...'
                                    : 'STANDBY'}
                        </div>
                    </div>
                </ConsoleCard>
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
                    detail={describeControlPlaneState(
                        topologySnapshot?.control_plane_state ?? snapshot?.system_health.topology_state ?? 'CONTROL_PLANE_INITIALIZING',
                        snapshot,
                    )}
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
                    <DataRow label="Latest Trigger" value={snapshot?.decision_engine.latest_trigger ?? (snapshot ? 'STANDBY' : 'NO DATA')} />
                    <DataRow label="Latest Action" value={snapshot?.decision_engine.latest_action ?? (snapshot ? 'No action yet' : 'NO DATA')} />
                    <DataRow label="Safe Execute Threshold" value={snapshot ? `${(snapshot.decision_engine.auto_execute_confidence_threshold * 100).toFixed(0)}%` : 'NO DATA'} />
                </ConsoleCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 lg:gap-6 mb-4 sm:mb-6">
                <ConsoleCard title="Latency Envelope (p95 window input)" className="h-[260px] sm:h-[320px]" collapsible>
                    {(telemetrySnapshot && telemetrySnapshot.charts.latency.length > 0) || (dashboardLens && dashboardLens.latency_history.length > 0) ? (
                        <div className="flex-1 -mx-2 sm:-mx-4 h-full">
                            <TelemetryChart
                                data={telemetrySnapshot?.charts.latency.length ? telemetrySnapshot.charts.latency : (dashboardLens?.latency_history ?? [])}
                                color="#00ff41"
                            />
                        </div>
                    ) : (
                        <EmptyChartState message={resolveLatencyChartMessage(telemetrySnapshot, telemetryStreamStatus, snapshot)} />
                    )}
                </ConsoleCard>

                <ConsoleCard title="Outcome Drift Signal" className="h-[260px] sm:h-[320px]" collapsible>
                    {(telemetrySnapshot && telemetrySnapshot.charts.drift.length > 0) || (dashboardLens && dashboardLens.drift_history.length > 0) ? (
                        <div className="flex-1 -mx-2 sm:-mx-4 h-full">
                            <TelemetryChart
                                data={telemetrySnapshot?.charts.drift.length ? telemetrySnapshot.charts.drift : (dashboardLens?.drift_history ?? [])}
                                color="#ff3333"
                            />
                        </div>
                    ) : (
                        <EmptyChartState message={resolveDriftChartMessage(telemetrySnapshot, telemetryStreamStatus, snapshot)} />
                    )}
                </ConsoleCard>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-6 mb-4 sm:mb-6">
                <ConsoleCard title="Pipeline Health" collapsible>
                    {pipelineStates.length > 0 ? (
                        pipelineStates.map((pipeline) => (
                            <div key={pipeline.key} className="pipeline-row-glass py-2 border-b border-[hsl(0_0%_100%_/_0.06)] px-2 -mx-2">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="font-mono text-[11px] uppercase text-[hsl(0_0%_85%)]">{pipeline.label}</div>
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
                            <div key={family.model_family} className="pipeline-row-glass py-2 border-b border-[hsl(0_0%_100%_/_0.06)] px-2 -mx-2">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="font-mono text-[11px] uppercase text-accent">{family.model_family}</div>
                                    <span className="font-mono text-[11px] text-[hsl(0_0%_72%)]">{family.entry_count} entries</span>
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
                    <DataRow label="Top Route" value={formatTopRoute(routingOverview)} />
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
                                        <span className="text-[hsl(0_0%_78%)] uppercase mr-2">{row.family}</span>
                                        {row.top_model ?? 'NO DATA'}
                                        <span className="text-[hsl(0_0%_72%)] ml-2">{row.total_requests} req</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyListState message={resolveRoutingMessage(snapshot, routingOverview)} compact />
                        )}
                    </div>
                </ConsoleCard>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                <div className="xl:col-span-2">
                    <ConsoleCard title="Recent Inferences" collapsible>
                        {recentInferences.length > 0 ? (
                            recentInferences.map((event) => (
                                <div key={event.id} className="pipeline-row-glass py-2 border-b border-[hsl(0_0%_100%_/_0.06)] px-2 -mx-2">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="font-mono text-xs text-foreground break-all">{event.id}</div>
                                        <StateText tone={eventTone(event)}>
                                            {formatInferenceOutcome(event)}
                                        </StateText>
                                    </div>
                                    <div className="mt-2 font-mono text-[10px] text-muted">
                                        model={resolveRouteModel(event)} | confidence={formatPercent(event.confidence)} | latency={formatLatency(event.latency_ms)}
                                    </div>
                                    <div className="mt-1 font-mono text-[10px] text-muted">
                                        {new Date(event.timestamp).toLocaleString()}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <EmptyListState message={resolveInferenceMessage(snapshot)} />
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
                </>
            )}

            {activeTab === 'cire' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
                        <MetricCard
                            label="Phi Mean"
                            value={cireStatus ? cireStatus.phi_population_mean.toFixed(3) : 'NO DATA'}
                            tone="accent"
                            icon={<ShieldAlert className="w-4 h-4" />}
                            detail="Last 100 inferences"
                        />
                        <MetricCard
                            label="Rolling CPS"
                            value={cireStatus ? cireStatus.rolling_cps.toFixed(3) : 'NO DATA'}
                            tone={cireStatus && cireStatus.rolling_cps >= 0.75 ? 'danger' : cireStatus && cireStatus.rolling_cps >= 0.5 ? 'warning' : 'accent'}
                            icon={<Gauge className="w-4 h-4" />}
                            detail="Tenant collapse proximity"
                        />
                        <MetricCard
                            label="Incidents 7D"
                            value={cireStatus ? String(cireStatus.incident_count_7d) : 'NO DATA'}
                            tone={cireStatus && cireStatus.incident_count_7d > 0 ? 'warning' : 'accent'}
                            icon={<AlertTriangle className="w-4 h-4" />}
                            detail="Critical + blocked snapshots"
                        />
                        <MetricCard
                            label="Calibration"
                            value={cireStatus ? cireStatus.calibration_status.toUpperCase() : 'NO DATA'}
                            tone={cireStatus?.calibration_status === 'calibrated' ? 'accent' : 'warning'}
                            icon={<Cpu className="w-4 h-4" />}
                            detail={cireStatus?.last_calibrated_at ? `Last ${new Date(cireStatus.last_calibrated_at).toLocaleString()}` : 'No calibration yet'}
                        />
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                        <div className="xl:col-span-2">
                            <ConsoleCard title="Rolling Phi History" className="h-[320px]" collapsible>
                                {cireHistoryChart.length > 0 ? (
                                    <div className="h-full -mx-2 sm:-mx-4">
                                        <TelemetryChart data={cireHistoryChart} dataKey="value" color="#00ff41" />
                                    </div>
                                ) : (
                                    <EmptyChartState message="NO CIRE HISTORY" />
                                )}
                            </ConsoleCard>
                        </div>
                        <ConsoleCard title="Safety State Distribution" collapsible>
                            {cireStatus ? (
                                <div className="space-y-3 font-mono text-xs">
                                    {Object.entries(cireStatus.safety_state_distribution).map(([label, value]) => {
                                        const total = Object.values(cireStatus.safety_state_distribution).reduce((sum, count) => sum + count, 0) || 1;
                                        const width = (value / total) * 100;
                                        return (
                                            <div key={label}>
                                                <div className="flex items-center justify-between uppercase text-[hsl(0_0%_82%)]">
                                                    <span>{label}</span>
                                                    <span>{value}</span>
                                                </div>
                                                <div className="mt-1 h-2 bg-black/30 border border-grid">
                                                    <div
                                                        className={label === 'blocked' ? 'h-full bg-danger' : label === 'critical' ? 'h-full bg-orange-500' : label === 'warning' ? 'h-full bg-yellow-400' : 'h-full bg-accent'}
                                                        style={{ width: `${width}%` }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <EmptyListState message="NO CIRE DISTRIBUTION" compact />
                            )}
                        </ConsoleCard>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                        <div className="xl:col-span-2">
                            <ConsoleCard title="Recent CIRE Incidents" collapsible>
                                <div className="mb-4">
                                    <TerminalButton onClick={() => void handleCireCalibration()} disabled={cireActionState === 'working'}>
                                        {cireActionState === 'working' ? 'CALIBRATING...' : 'CALIBRATE'}
                                    </TerminalButton>
                                </div>
                                {cireIncidents.length > 0 ? (
                                    <div className="space-y-3">
                                        {cireIncidents.map((incident) => (
                                            <div key={incident.id} className="border border-grid bg-black/20 p-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="font-mono text-xs text-foreground break-all">{incident.id}</div>
                                                    <StateText tone={incident.safety_state === 'blocked' ? 'danger' : incident.safety_state === 'critical' ? 'warning' : 'accent'}>
                                                        {incident.safety_state.toUpperCase()}
                                                    </StateText>
                                                </div>
                                                <div className="mt-2 font-mono text-[10px] text-muted">
                                                    phi={incident.phi_hat?.toFixed(4) ?? 'n/a'} | cps={incident.cps?.toFixed(4) ?? 'n/a'} | {new Date(incident.created_at).toLocaleString()}
                                                </div>
                                                <div className="mt-3 flex gap-3">
                                                    <TerminalButton onClick={() => void handleResolveCireIncident(incident.id)} disabled={cireActionState === 'working'}>
                                                        Resolve
                                                    </TerminalButton>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <EmptyListState message="NO OPEN CIRE INCIDENTS" />
                                )}
                            </ConsoleCard>
                        </div>

                        <ConsoleCard title="Collapse Profile" collapsible>
                            {cireProfile ? (
                                <div className="space-y-3">
                                    <DataRow label="Model" value={cireProfile.model_version} />
                                    <DataRow label="Phi Baseline" value={cireProfile.phi_baseline.toFixed(4)} />
                                    <DataRow label="HII" value={cireProfile.hii != null ? cireProfile.hii.toFixed(4) : 'NO DATA'} />
                                    <DataRow label="Calibrated" value={new Date(cireProfile.calibrated_at).toLocaleString()} />
                                    <div className="border-t border-grid pt-3">
                                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mb-2">
                                            m† by Capability
                                        </div>
                                        <div className="space-y-2">
                                            {Object.entries(cireProfile.m_threshold_map ?? {}).map(([capability, value]) => {
                                                const numericValue = typeof value === 'number' ? value : 0;
                                                return (
                                                    <div key={capability} className="font-mono text-[10px]">
                                                        <div className="flex items-center justify-between text-[hsl(0_0%_80%)] uppercase">
                                                            <span>{capability}</span>
                                                            <span>{numericValue.toFixed(3)}</span>
                                                        </div>
                                                        <div className="mt-1 h-2 bg-black/30 border border-grid">
                                                            <div className="h-full bg-cyan-400" style={{ width: `${Math.min(100, numericValue * 100)}%` }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <EmptyListState message="NO CIRE PROFILE" />
                            )}
                        </ConsoleCard>
                    </div>
                </div>
            )}
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
    const glassClass = tone === 'accent' ? 'metric-card-accent' : tone === 'warning' ? 'metric-card-warning' : tone === 'danger' ? 'metric-card-danger' : 'console-card-glass';
    return (
        <div className={`${glassClass} p-4 sm:p-5 flex flex-col gap-3 sm:gap-4 animate-scale-in relative overflow-hidden`}>
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
            <div className="flex items-center justify-between mb-2 relative">
                <span className="font-mono text-[11px] text-[hsl(0_0%_88%)] uppercase tracking-[0.14em] font-medium">{label}</span>
                <span className={`${toneClass(tone)} opacity-80`}>{icon}</span>
            </div>
            <div className={`font-mono text-lg sm:text-2xl font-bold relative ${toneClass(tone)}`} style={tone === 'accent' ? {textShadow:'0 0 20px hsl(142 76% 46% / 0.4)'} : tone === 'warning' ? {textShadow:'0 0 20px hsl(45 100% 50% / 0.35)'} : tone === 'danger' ? {textShadow:'0 0 20px hsl(0 72% 55% / 0.4)'} : {}}>{value}</div>
            <div className="font-mono text-[11px] text-[hsl(0_0%_86%)] mt-2 leading-relaxed relative">{detail}</div>
        </div>
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
        <span className={`inline-flex items-center gap-1.5 border px-2 py-1 chip-glass backdrop-blur-sm ${chipToneClass(tone)}`}>
            {icon}
            {label}
        </span>
    );
}

function DataPanel({ label, value }: { label: string; value: string }) {
    return (
        <div className="data-panel-glass p-3 sm:p-4 relative overflow-hidden group transition-all duration-200 hover:border-[hsl(0_0%_100%_/_0.1)]">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.015] to-transparent pointer-events-none" />
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[hsl(0_0%_82%)] mb-2 font-medium relative">{label}</div>
            <div className="font-mono text-sm text-[hsl(0_0%_96%)] leading-relaxed relative">{value}</div>
        </div>
    );
}

function AlertRow({ alert }: { alert: ControlPlaneAlertRecord }) {
    return (
        <div className="flex gap-3">
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${alertDotTone(alert.severity)}`} />
            <div className="flex flex-col gap-1">
                <span className={`font-mono text-[11px] uppercase tracking-wider ${alertTextTone(alert.severity)} font-bold`}>
                    {alert.title}
                </span>
                <span className="font-mono text-[11px] text-[hsl(0_0%_85%)] leading-relaxed">{alert.message}</span>
                <span className="font-mono text-[10px] text-[hsl(0_0%_70%)]">{new Date(alert.timestamp).toLocaleString()}</span>
            </div>
        </div>
    );
}

function EmptyChartState({ message }: { message: string }) {
    return (
        <div className="h-full flex items-center justify-center text-[hsl(0_0%_78%)] text-[11px] font-mono border border-dashed border-[hsl(0_0%_100%_/_0.1)] bg-[hsl(0_0%_100%_/_0.01)]">
            {message}
        </div>
    );
}

function EmptyListState({ message, compact = false }: { message: string; compact?: boolean }) {
    return (
        <div className={`font-mono text-[11px] text-[hsl(0_0%_78%)] border border-dashed border-[hsl(0_0%_100%_/_0.1)] bg-[hsl(0_0%_100%_/_0.01)] grid place-items-center ${compact ? 'h-20' : 'h-32'}`}>
            {message}
        </div>
    );
}

function buildRoutingOverview(
    topologySnapshot: TopologySnapshot | null,
    fallbackRouting: ControlPlaneDashboardViewSnapshot['dashboard']['routing'] | null,
    governanceFamilies: ControlPlaneDashboardGovernanceFamilySummary[],
) {
    const distribution = new Map<string, number>();
    const familyRows: Array<{ family: string; top_model: string | null; total_requests: number }> = [];
    let routingShiftCount = 0;
    let fallbackCount = 0;
    let ensembleCount = 0;
    let familyCount = 0;

    for (const node of topologySnapshot?.nodes ?? []) {
        if (node.kind !== 'model') continue;
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

        const totalRequests = parsed.reduce((sum, entry) => sum + entry.request_count, 0);
        if (totalRequests > 0) {
            familyCount += 1;
        }

        familyRows.push({
            family: node.label,
            top_model: parsed[0]?.model_id ?? textOrNull(node.metadata.active_model_version),
            total_requests: totalRequests,
        });
    }

    let topModels = Array.from(distribution.entries())
        .map(([model_id, request_count]) => ({ model_id, request_count }))
        .sort((left, right) => right.request_count - left.request_count)
        .slice(0, 5);

    if (topModels.length === 0 && fallbackRouting?.top_route) {
        topModels = [{
            model_id: fallbackRouting.top_route,
            request_count: Math.max(
                0,
                ...(fallbackRouting.family_rows.map((row) => row.total_requests)),
            ),
        }];
    }

    if (routingShiftCount === 0 && fallbackRouting) {
        routingShiftCount = fallbackRouting.route_shift_count;
    }
    if (fallbackCount === 0 && fallbackRouting) {
        fallbackCount = fallbackRouting.fallback_count;
    }
    if (ensembleCount === 0 && fallbackRouting) {
        ensembleCount = fallbackRouting.ensemble_count;
    }
    if (familyCount === 0 && fallbackRouting) {
        familyCount = fallbackRouting.family_count;
    }

    if (familyRows.length === 0 && fallbackRouting) {
        familyRows.push(...fallbackRouting.family_rows);
    }

    if (familyRows.length === 0 && governanceFamilies.length > 0) {
        familyRows.push(...governanceFamilies.map((family) => ({
            family: family.model_family,
            top_model: family.current_production_model,
            total_requests: 0,
        })));
    }

    return {
        topModels,
        routingShiftCount,
        fallbackCount,
        ensembleCount,
        familyCount,
        familyRows,
    };
}

function summarizeFamilyGovernance(family: ControlPlaneDashboardGovernanceFamilySummary) {
    if (family.rejected_count > 0) {
        return `${family.rejected_count} rejected candidate(s) blocked from live promotion.`;
    }
    if (family.pending_count > 0) {
        return `${family.pending_count} gated candidate(s) waiting on approval.`;
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
    if (tone === 'warning') return 'border-[#ffcc00]/40 text-[#ffcc00] bg-[#ffcc00]/8 shadow-[0_0_8px_hsl(45_100%_50%_/_0.12)]';
    if (tone === 'danger') return 'border-danger/40 text-danger bg-danger/8 shadow-[0_0_8px_hsl(0_72%_55%_/_0.12)]';
    if (tone === 'muted') return 'border-grid text-muted bg-black/20';
    return 'border-accent/40 text-accent bg-accent/8 shadow-[0_0_8px_hsl(142_76%_46%_/_0.12)]';
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

function resolveDriftChartMessage(
    snapshot: TelemetrySnapshot | null,
    streamStatus: StreamStatus,
    controlPlaneSnapshot?: ControlPlaneDashboardViewSnapshot | null,
) {
    if (streamStatus === 'disconnected' && !snapshot) return 'STREAM DISCONNECTED';
    if (snapshot?.metric_states.drift_score === 'INSUFFICIENT_OUTCOMES' && controlPlaneSnapshot?.system_health.last_evaluation_event_timestamp) {
        return `Need more linked outcomes. Last evaluation ${new Date(controlPlaneSnapshot.system_health.last_evaluation_event_timestamp).toLocaleTimeString()}`;
    }
    if (snapshot?.metric_states.drift_score === 'INSUFFICIENT_OUTCOMES') return 'INSUFFICIENT DATA';
    if (snapshot?.metric_states.drift_score === 'NO_DATA') return 'NO DATA';
    return 'WAITING FOR DRIFT SIGNALS';
}

function resolveLatencyChartMessage(
    snapshot: TelemetrySnapshot | null,
    streamStatus: StreamStatus,
    controlPlaneSnapshot?: ControlPlaneDashboardViewSnapshot | null,
) {
    if (streamStatus === 'disconnected' && !snapshot) return 'STREAM DISCONNECTED';
    if (snapshot?.metric_states.p95_latency === 'NO_DATA' && controlPlaneSnapshot?.system_health.last_inference_timestamp) {
        return `Awaiting fresh latency telemetry. Last inference ${new Date(controlPlaneSnapshot.system_health.last_inference_timestamp).toLocaleTimeString()}`;
    }
    if (snapshot?.metric_states.p95_latency === 'NO_DATA') return 'NO DATA';
    return 'WAITING FOR LATENCY SIGNALS';
}

function describeControlPlaneState(
    state: string,
    snapshot: ControlPlaneDashboardViewSnapshot | null,
) {
    if (state === 'CONTROL_PLANE_INITIALIZING' && snapshot?.system_health.last_inference_timestamp) {
        return 'LIVE / IDLE';
    }
    if (state === 'INSUFFICIENT_OUTCOMES_FOR_DRIFT') {
        return 'LIVE / DRIFT WARMING';
    }
    if (state === 'WAITING_FOR_EVALUATION_EVENTS') {
        return 'LIVE / EVALUATION PENDING';
    }
    return state;
}

function resolveInferenceMessage(snapshot: ControlPlaneDashboardViewSnapshot | null) {
    if (snapshot?.system_health.last_inference_timestamp) {
        return `NO LIVE INFERENCE ACTIVITY | LAST SUCCESS ${new Date(snapshot.system_health.last_inference_timestamp).toLocaleString()}`;
    }
    return 'NO INFERENCE ACTIVITY';
}

function resolveRoutingMessage(
    snapshot: ControlPlaneDashboardViewSnapshot | null,
    routingOverview: ReturnType<typeof buildRoutingOverview>,
) {
    if (routingOverview.familyRows.some((row) => row.top_model)) {
        return 'ROUTES GOVERNED | WAITING FOR LIVE TRAFFIC';
    }
    if (snapshot?.governance.families.length) {
        return 'NO ROUTING DATA YET';
    }
    return 'NO ROUTING DATA';
}

function formatTopRoute(routingOverview: ReturnType<typeof buildRoutingOverview>) {
    if (routingOverview.topModels[0]) {
        return `${routingOverview.topModels[0].model_id} (${routingOverview.topModels[0].request_count})`;
    }
    if (routingOverview.familyRows.some((row) => row.top_model)) {
        return 'IDLE';
    }
    return 'NO DATA';
}

function formatPercent(value: number | null | undefined) {
    if (value == null) return 'NO DATA';
    return `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value: number | null | undefined) {
    if (value == null) return 'NO DATA';
    return `${value.toFixed(1)}ms`;
}

function formatInferenceOutcome(event: ControlPlaneDashboardInferenceRecord) {
    const confidence = formatPercent(event.confidence);
    return confidence === 'NO DATA' ? 'LIVE' : confidence;
}

function resolveRouteModel(event: ControlPlaneDashboardInferenceRecord) {
    return event.route_model_id
        ?? event.model_version
        ?? 'NO DATA';
}

function eventTone(event: ControlPlaneDashboardInferenceRecord) {
    const latency = typeof event.latency_ms === 'number' ? event.latency_ms : null;
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
        <span className={`font-mono text-[11px] uppercase ${toneClass(tone)}`}>
            {children}
        </span>
    );
}
