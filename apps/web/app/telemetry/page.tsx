'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Container, PageHeader, ConsoleCard, DataRow, TerminalButton } from '@/components/ui/terminal';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import type { ControlPlaneSimulationModeResponse } from '@/lib/settings/types';
import type {
    TelemetryLogEntry,
    TelemetryMetricState,
    TelemetrySnapshot,
    TelemetryStreamPayload,
} from '@/lib/telemetry/types';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    RefreshCw,
    Terminal,
    Wifi,
    WifiOff,
} from 'lucide-react';

type StreamStatus = 'connecting' | 'live' | 'disconnected';

export default function TelemetryObserverPage() {
    const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
    const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
    const [streamError, setStreamError] = useState<string | null>(null);
    const [simulationMode, setSimulationMode] = useState(false);
    const [simulationModeBusy, setSimulationModeBusy] = useState(false);
    const [simulationModeError, setSimulationModeError] = useState<string | null>(null);
    const [streamNonce, setStreamNonce] = useState(0);
    const [lastStreamUpdate, setLastStreamUpdate] = useState<Date | null>(null);
    const [pageVisible, setPageVisible] = useState(true);

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
        if (!pageVisible) return;
        let cancelled = false;

        const syncSimulationMode = async () => {
            try {
                const response = await fetch('/api/settings/control-plane?view=simulation_mode', { cache: 'no-store' });
                const payload = await response.json() as ControlPlaneSimulationModeResponse | { error?: string };
                if (!response.ok || !('simulation_enabled' in payload)) {
                    throw new Error('error' in payload && typeof payload.error === 'string' ? payload.error : 'Failed to load simulation mode.');
                }
                if (!cancelled) {
                    setSimulationMode(payload.simulation_enabled);
                    setSimulationModeError(null);
                }
            } catch (error) {
                if (!cancelled) {
                    setSimulationModeError(error instanceof Error ? error.message : 'Failed to load simulation mode.');
                }
            }
        };

        void syncSimulationMode();
        const interval = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            void syncSimulationMode();
        }, 60_000);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [pageVisible]);

    useEffect(() => {
        if (!pageVisible) return;
        setStreamStatus('connecting');
        setStreamError(null);

        const params = new URLSearchParams();
        if (simulationMode) {
            params.set('simulation', '1');
        }

        const source = new EventSource(`/telemetry/stream${params.toString() ? `?${params}` : ''}`);

        source.onmessage = (event) => {
            const payload = JSON.parse(event.data) as TelemetryStreamPayload;
            setSnapshot(payload.snapshot);
            setStreamStatus('live');
            setStreamError(null);
            setLastStreamUpdate(new Date());
        };

        source.addEventListener('stream-error', (event) => {
            const messageEvent = event as MessageEvent<string>;
            try {
                const payload = JSON.parse(messageEvent.data) as { error?: string };
                setStreamError(payload.error ?? 'Telemetry stream failure');
            } catch {
                setStreamError('Telemetry stream failure');
            }
            setStreamStatus('disconnected');
        });

        source.onerror = () => {
            setStreamStatus('disconnected');
            setStreamError('STREAM DISCONNECTED');
        };

        return () => {
            source.close();
        };
    }, [pageVisible, simulationMode, streamNonce]);

    const hasSnapshot = snapshot !== null;
    const disconnectedWithoutData = streamStatus === 'disconnected' && !hasSnapshot;
    const stale = snapshot?.system_state === 'STALE';

    return (
        <Container>
            <PageHeader
                title="TELEMETRY OBSERVER"
                description="Real-time clinical telemetry, rolling accuracy, failure tracking, and observer health."
            />

            <div className="flex flex-col gap-3 mb-4 sm:mb-6">
                <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
                    <button
                        type="button"
                        onClick={() => setStreamNonce((value) => value + 1)}
                        className="flex items-center gap-1.5 hover:text-accent transition-colors"
                    >
                        <RefreshCw className="w-3 h-3" />
                        RECONNECT STREAM
                    </button>
                    <TerminalButton
                        type="button"
                        variant={simulationMode ? 'primary' : 'secondary'}
                        onClick={() => void handleSimulationModeToggle()}
                        disabled={simulationModeBusy}
                    >
                        SIMULATION MODE {simulationModeBusy ? 'SYNCING' : simulationMode ? 'ON' : 'OFF'}
                    </TerminalButton>
                    {lastStreamUpdate ? (
                        <span>Last stream update: {lastStreamUpdate.toLocaleTimeString()}</span>
                    ) : (
                        <span>{streamStatus === 'connecting' ? 'Connecting to /telemetry/stream...' : 'No stream payload received yet'}</span>
                    )}
                    <span className={`ml-auto flex items-center gap-1 ${statusTone(streamStatus)}`}>
                        {streamStatus === 'live' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                        {streamStatus === 'live' ? 'LIVE STREAM' : streamStatus === 'connecting' ? 'CONNECTING' : 'STREAM DISCONNECTED'}
                    </span>
                </div>

                {streamError && (
                    <div className="p-3 border border-danger bg-danger/5 font-mono text-xs text-danger">
                        {streamError}
                    </div>
                )}

                {simulationModeError && (
                    <div className="p-3 border border-[#ffcc00] bg-[#ffcc00]/5 font-mono text-xs text-[#ffcc00]">
                        {simulationModeError}
                    </div>
                )}

                {stale && (
                    <div className="p-3 border border-[#ffcc00] bg-[#ffcc00]/5 font-mono text-xs text-[#ffcc00]">
                        HEARTBEAT WARNING: observer is stale because no telemetry event has been received in the last 60 seconds.
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">
                <MetricCard
                    label="Inferences (24h)"
                    value={formatCount(snapshot?.metrics.inference_count, disconnectedWithoutData)}
                    tone="accent"
                />
                <MetricCard
                    label="p95 Latency"
                    value={formatLatencyMetric(snapshot, streamStatus)}
                    tone={snapshot?.metrics.anomaly_count ? 'danger' : 'accent'}
                    icon={snapshot?.metrics.anomaly_count ? <AlertTriangle className="w-3 h-3 text-danger" /> : undefined}
                />
                <MetricCard
                    label="Avg Confidence"
                    value={formatPercentMetric(snapshot?.metrics.avg_confidence, snapshot?.metric_states.avg_confidence, streamStatus)}
                    tone={(snapshot?.metrics.avg_confidence ?? 1) < 0.6 ? 'danger' : 'accent'}
                />
                <MetricCard
                    label="Raw Accuracy"
                    value={formatPercentMetric(snapshot?.metrics.accuracy, snapshot?.metric_states.accuracy, streamStatus)}
                    tone="accent"
                    icon={snapshot?.metric_states.accuracy === 'READY' ? <CheckCircle2 className="w-3 h-3 text-accent" /> : undefined}
                />
                <MetricCard
                    label="Rolling Top-1"
                    value={formatPercentMetric(snapshot?.metrics.rolling_top1_accuracy, snapshot?.metric_states.rolling_top1_accuracy, streamStatus)}
                    tone={(snapshot?.metrics.rolling_top1_accuracy ?? 1) < 0.75 ? 'danger' : 'accent'}
                />
                <MetricCard
                    label="Rolling Top-3"
                    value={formatPercentMetric(snapshot?.metrics.rolling_top3_accuracy, snapshot?.metric_states.rolling_top3_accuracy, streamStatus)}
                    tone={(snapshot?.metrics.rolling_top3_accuracy ?? 1) < 0.9 ? 'danger' : 'accent'}
                />
                <MetricCard
                    label="Drift Score"
                    value={formatDriftMetric(snapshot, streamStatus)}
                    tone={snapshot?.metric_states.drift_score === 'READY' && (snapshot.metrics.drift_score ?? 0) > 0.2 ? 'danger' : 'accent'}
                    icon={snapshot?.metric_states.drift_score === 'READY' && (snapshot.metrics.drift_score ?? 0) > 0.2 ? <AlertTriangle className="w-3 h-3 text-danger" /> : undefined}
                />
                <MetricCard
                    label="Calibration Gap"
                    value={formatPercentMetric(snapshot?.metrics.calibration_gap, snapshot?.metric_states.calibration_gap, streamStatus)}
                    tone={(snapshot?.metrics.calibration_gap ?? 0) > 0.15 ? 'danger' : 'accent'}
                />
                <MetricCard
                    label="Abstention Rate"
                    value={formatPercentMetric(snapshot?.metrics.abstention_rate, snapshot?.metric_states.rolling_top1_accuracy, streamStatus)}
                    tone={(snapshot?.metrics.abstention_rate ?? 0) > 0.12 ? 'danger' : 'accent'}
                />
                <MetricCard
                    label="Outcomes (24h)"
                    value={formatCount(snapshot?.metrics.outcome_count, disconnectedWithoutData)}
                    tone="accent"
                />
                <MetricCard
                    label="Failure Events"
                    value={formatCount(snapshot?.metrics.failure_event_count, disconnectedWithoutData)}
                    tone={(snapshot?.metrics.failure_event_count ?? 0) > 0 ? 'danger' : 'muted'}
                />
                <MetricCard
                    label="Near Misses"
                    value={formatCount(snapshot?.metrics.near_miss_count, disconnectedWithoutData)}
                    tone={(snapshot?.metrics.near_miss_count ?? 0) > 0 ? 'danger' : 'muted'}
                />
                <MetricCard
                    label="Latency Anomalies"
                    value={formatCount(snapshot?.metrics.anomaly_count, disconnectedWithoutData)}
                    tone={snapshot?.metrics.anomaly_count ? 'danger' : 'muted'}
                />
                <MetricCard
                    label="Memory Usage"
                    value={formatPercentMetric(snapshot?.metrics.memory_usage, snapshot?.metric_states.memory, streamStatus)}
                    tone={(snapshot?.metrics.memory_usage ?? 0) > 0.8 ? 'danger' : 'accent'}
                />
                <MetricCard
                    label="Buffer Depth"
                    value={formatCount(snapshot?.metrics.buffer_size, disconnectedWithoutData)}
                    tone={(snapshot?.metrics.buffer_size ?? 0) > 100 ? 'danger' : 'muted'}
                />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 sm:gap-6 mb-4 sm:mb-6">
                <div className="xl:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                    <ConsoleCard title="Inference Latency (p95 window input)" className="h-[260px] sm:h-[320px]" collapsible>
                        {snapshot && snapshot.charts.latency.length > 0 ? (
                            <div className="flex-1 -mx-2 sm:-mx-4 h-full">
                                <TelemetryChart data={snapshot.charts.latency} color="#00ff41" />
                            </div>
                        ) : (
                            <EmptyChartState message={resolveLatencyChartMessage(snapshot, streamStatus)} />
                        )}
                    </ConsoleCard>

                    <ConsoleCard title="Distribution Drift (L2 norm)" className="h-[260px] sm:h-[320px]" collapsible>
                        {snapshot && snapshot.charts.drift.length > 0 ? (
                            <div className="flex-1 -mx-2 sm:-mx-4 h-full">
                                <TelemetryChart data={snapshot.charts.drift} color="#ff3333" />
                            </div>
                        ) : (
                            <EmptyChartState message={resolveDriftChartMessage(snapshot, streamStatus)} />
                        )}
                    </ConsoleCard>
                </div>

                <ConsoleCard title="Observer State" collapsible>
                    <div className="space-y-2">
                        <DataRow label="System State" value={snapshot?.system_state ?? stateForMissingSnapshot(streamStatus)} />
                        <DataRow
                            label="Last Event"
                            value={snapshot?.last_event_timestamp ? new Date(snapshot.last_event_timestamp).toLocaleString() : stateForMissingSnapshot(streamStatus)}
                        />
                        <DataRow
                            label="Traffic Mode"
                            value={snapshot?.traffic_mode === 'simulation' ? 'SIMULATION' : 'PRODUCTION'}
                        />
                        <DataRow
                            label="CPU"
                            value={formatUtilization(snapshot?.latest_system.cpu, streamStatus)}
                        />
                        <DataRow
                            label="GPU"
                            value={formatUtilization(snapshot?.latest_system.gpu, streamStatus)}
                        />
                        <DataRow
                            label="Memory"
                            value={formatUtilization(snapshot?.latest_system.memory, streamStatus)}
                        />
                        <DataRow
                            label="Observer Memory"
                            value={formatPercentMetric(snapshot?.metrics.memory_usage, snapshot?.metric_states.memory, streamStatus)}
                        />
                        <DataRow
                            label="Buffer Size"
                            value={snapshot ? String(snapshot.observability.buffer.buffer_size) : stateForMissingSnapshot(streamStatus)}
                        />
                        <DataRow
                            label="Queue Depth"
                            value={snapshot ? String(snapshot.observability.buffer.log_queue_depth) : stateForMissingSnapshot(streamStatus)}
                        />
                        <DataRow
                            label="Simulation"
                            value={simulationMode ? 'ENABLED' : 'DISABLED'}
                        />
                    </div>
                </ConsoleCard>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
                <ConsoleCard title="Memory Pressure Trend" className="h-[240px] sm:h-[280px]" collapsible>
                    {snapshot && snapshot.charts.memory.length > 0 ? (
                        <div className="flex-1 -mx-2 sm:-mx-4 h-full">
                            <TelemetryChart data={snapshot.charts.memory} color="#ffaa00" />
                        </div>
                    ) : (
                        <EmptyChartState message="NO MEMORY SERIES YET" />
                    )}
                </ConsoleCard>

                <ConsoleCard title="Disease Performance" collapsible>
                    <div className="space-y-2 font-mono text-xs">
                        {snapshot && snapshot.observability.disease_performance.length > 0 ? (
                            snapshot.observability.disease_performance.slice(0, 6).map((row) => (
                                <div key={row.disease_name} className="border border-grid/60 p-2 space-y-1">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-accent truncate">{row.disease_name}</span>
                                        <span className="text-muted">n={row.support_n}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[10px] text-muted">
                                        <span>PREC {formatInlinePercent(row.precision)}</span>
                                        <span>REC {formatInlinePercent(row.recall)}</span>
                                        <span>TOP1 {formatInlinePercent(row.top1_accuracy)}</span>
                                        <span>TOP3 {formatInlinePercent(row.top3_recall)}</span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-muted/50">NO DISEASE PERFORMANCE SNAPSHOT</div>
                        )}
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Failure Telemetry" collapsible>
                    <div className="space-y-2 font-mono text-xs">
                        {snapshot && snapshot.observability.recent_failures.length > 0 ? (
                            snapshot.observability.recent_failures.map((failure) => (
                                <div key={failure.id} className="border border-grid/60 p-2">
                                    <div className={`text-[10px] uppercase ${failure.severity === 'critical' ? 'text-danger' : failure.severity === 'warning' ? 'text-[#ffcc00]' : 'text-muted'}`}>
                                        {failure.error_type.replace(/_/g, ' ')} / {failure.failure_classification.replace(/_/g, ' ')}
                                    </div>
                                    <div className="text-muted mt-1 truncate">
                                        {failure.predicted ?? 'ABSTAIN'} {'->'} {failure.actual ?? 'OUTCOME PENDING'}
                                    </div>
                                    <div className="text-[10px] text-muted/70 mt-1">
                                        conf={formatInlinePercent(failure.confidence)} top3={failure.actual_in_top3 ? 'yes' : 'no'} abstain={failure.abstained ? 'yes' : 'no'}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-muted/50">NO FAILURE EVENTS</div>
                        )}
                    </div>
                </ConsoleCard>
            </div>

            <ConsoleCard title="System Log Stream" collapsible>
                <div className="bg-black border border-grid/50 p-3 sm:p-4 h-[220px] sm:h-[280px] overflow-hidden flex flex-col font-mono text-xs">
                    <div className="flex items-center gap-2 text-accent/50 mb-3 sm:mb-4 border-b border-grid/50 pb-2 text-[10px] sm:text-xs">
                        <Terminal className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span>EVENT-DRIVEN TELEMETRY LOG</span>
                        <Activity className="w-3 h-3 ml-auto animate-pulse" />
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1 text-muted/80">
                        {snapshot && snapshot.logs.length > 0 ? (
                            snapshot.logs.map((log) => (
                                <LogLine key={log.id} log={log} />
                            ))
                        ) : (
                            <div className="text-muted/40 text-center pt-8">
                                {disconnectedWithoutData ? 'STREAM DISCONNECTED' : 'NO DATA'}
                            </div>
                        )}
                    </div>
                </div>
            </ConsoleCard>
        </Container>
    );

    async function handleSimulationModeToggle() {
        const nextMode = !simulationMode;
        setSimulationModeBusy(true);
        setSimulationModeError(null);

        try {
            const response = await fetch('/api/settings/control-plane', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'set_simulation_mode',
                    enabled: nextMode,
                }),
            });
            const payload = await response.json() as { error?: string; snapshot?: { configuration?: { simulation_enabled?: boolean } } };
            if (!response.ok) {
                throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to update simulation mode.');
            }
            setSimulationMode(payload.snapshot?.configuration?.simulation_enabled ?? nextMode);
            setStreamNonce((value) => value + 1);
        } catch (error) {
            setSimulationModeError(error instanceof Error ? error.message : 'Failed to update simulation mode.');
        } finally {
            setSimulationModeBusy(false);
        }
    }
}

function MetricCard({
    label,
    value,
    tone,
    icon,
}: {
    label: string;
    value: string;
    tone: 'accent' | 'danger' | 'muted';
    icon?: ReactNode;
}) {
    const tones = {
        accent: {
            border: 'border-accent/20',
            text: 'text-accent',
        },
        danger: {
            border: 'border-danger/20',
            text: 'text-danger',
        },
        muted: {
            border: 'border-muted/20',
            text: 'text-muted',
        },
    } as const;

    return (
        <ConsoleCard className={`p-3 sm:p-4 h-full ${tones[tone].border}`}>
            <div className="font-mono text-[9px] sm:text-[10px] text-muted uppercase mb-2 leading-snug whitespace-normal break-words min-h-[1.6rem] sm:min-h-[1.9rem]">
                {label}
            </div>
            <div className={`font-mono text-base sm:text-xl xl:text-2xl flex items-start gap-1.5 leading-tight whitespace-normal break-words min-w-0 ${tones[tone].text}`}>
                <span className="min-w-0 break-words whitespace-normal">{value}</span>
                {icon ? <span className="shrink-0 pt-0.5">{icon}</span> : null}
            </div>
        </ConsoleCard>
    );
}

function EmptyChartState({ message }: { message: string }) {
    return (
        <div className="h-full flex items-center justify-center text-muted text-[10px] sm:text-xs font-mono border border-dashed border-grid">
            <span className="px-4 text-center leading-relaxed whitespace-normal break-words">{message}</span>
        </div>
    );
}

function LogLine({ log }: { log: TelemetryLogEntry }) {
    const tone = log.level === 'ERROR'
        ? 'text-danger'
        : log.level === 'WARN'
            ? 'text-[#ffcc00]'
            : 'text-muted/80';

    return (
        <div className={`truncate text-[10px] sm:text-xs ${tone}`}>
            <span className="text-muted/40 mr-2">
                {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            {log.message}
        </div>
    );
}

function formatCount(value: number | undefined, disconnectedWithoutData: boolean) {
    if (typeof value === 'number') {
        return String(value);
    }
    return disconnectedWithoutData ? 'STREAM DISCONNECTED' : 'NO DATA';
}

function formatLatencyMetric(snapshot: TelemetrySnapshot | null, streamStatus: StreamStatus) {
    if (snapshot?.metric_states.p95_latency === 'READY' && snapshot.metrics.p95_latency_ms != null) {
        return `${snapshot.metrics.p95_latency_ms.toFixed(1)}ms`;
    }
    return formatMetricState(snapshot?.metric_states.p95_latency, streamStatus);
}

function formatPercentMetric(
    value: number | null | undefined,
    state: TelemetryMetricState | undefined,
    streamStatus: StreamStatus,
) {
    if (state === 'READY' && value != null) {
        return `${(value * 100).toFixed(1)}%`;
    }
    return formatMetricState(state, streamStatus);
}

function formatInlinePercent(value: number | null | undefined) {
    if (value == null) {
        return 'NO DATA';
    }
    return `${(value * 100).toFixed(1)}%`;
}

function formatDriftMetric(snapshot: TelemetrySnapshot | null, streamStatus: StreamStatus) {
    if (snapshot?.metric_states.drift_score === 'READY' && snapshot.metrics.drift_score != null) {
        return snapshot.metrics.drift_score.toFixed(4);
    }
    return formatMetricState(snapshot?.metric_states.drift_score, streamStatus, true);
}

function formatMetricState(
    state: TelemetryMetricState | undefined,
    streamStatus: StreamStatus,
    useInsufficientDataLabel = false,
) {
    if (streamStatus === 'disconnected' && !state) {
        return 'STREAM DISCONNECTED';
    }

    if (state === 'NO_DATA') {
        return 'NO DATA';
    }

    if (state === 'INSUFFICIENT_OUTCOMES') {
        return useInsufficientDataLabel ? 'INSUFFICIENT DATA' : 'INSUFFICIENT OUTCOMES';
    }

    if (state === 'STREAM_DISCONNECTED' || streamStatus === 'disconnected') {
        return 'STREAM DISCONNECTED';
    }

    return 'NO DATA';
}

function formatUtilization(value: number | null | undefined, streamStatus: StreamStatus) {
    if (value == null) {
        return stateForMissingSnapshot(streamStatus);
    }
    return `${(value * 100).toFixed(1)}%`;
}

function resolveLatencyChartMessage(snapshot: TelemetrySnapshot | null, streamStatus: StreamStatus) {
    if (streamStatus === 'disconnected' && !snapshot) {
        return 'STREAM DISCONNECTED';
    }
    if (snapshot?.metric_states.p95_latency === 'NO_DATA') {
        return 'NO DATA';
    }
    return 'NO DATA';
}

function resolveDriftChartMessage(snapshot: TelemetrySnapshot | null, streamStatus: StreamStatus) {
    if (streamStatus === 'disconnected' && !snapshot) {
        return 'STREAM DISCONNECTED';
    }
    if (snapshot?.metric_states.drift_score === 'INSUFFICIENT_OUTCOMES') {
        if ((snapshot.metrics.outcome_count ?? 0) === 1) {
            return 'NEED 1 MORE OUTCOME';
        }
        return 'INSUFFICIENT DATA';
    }
    return 'NO DATA';
}

function stateForMissingSnapshot(streamStatus: StreamStatus) {
    if (streamStatus === 'disconnected') {
        return 'STREAM DISCONNECTED';
    }
    return 'NO DATA';
}

function statusTone(streamStatus: StreamStatus) {
    if (streamStatus === 'live') return 'text-accent';
    if (streamStatus === 'disconnected') return 'text-danger';
    return 'text-muted';
}
