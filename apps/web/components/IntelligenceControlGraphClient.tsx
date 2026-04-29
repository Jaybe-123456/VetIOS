'use client';

import type { CSSProperties, ReactNode, ChangeEvent } from 'react';
import { useEffect, useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    Handle,
    MarkerType,
    Position,
    type Edge,
    type Node,
    type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
    AlertTriangle,
    Clock3,
    GitBranch,
    Network,
    RefreshCw,
    Siren,
    Workflow,
} from 'lucide-react';
import { Container, ConsoleCard, DataRow, PageHeader, TerminalButton } from '@/components/ui/terminal';
import type {
    TopologyAlert,
    TopologyEdgeSnapshot,
    TopologyNodeSnapshot,
    TopologySimulationScenario,
    TopologySnapshot,
    TopologyStreamPayload,
    TopologyWindow,
} from '@/lib/intelligence/types';
import type { ControlPlaneSimulationModeResponse } from '@/lib/settings/types';

type ControlMode = 'live' | 'rewind_1h' | 'rewind_24h' | 'replay';
type StreamStatus = 'connecting' | 'live' | 'disconnected';
type SimulationMessageTone = 'success' | 'error';

const NODE_TYPES = {
    topologyNode: TopologyGraphNode,
};

const PANEL_LABEL_CLASS = 'font-mono text-[11px] uppercase tracking-[0.14em] text-[hsl(0_0%_74%)]';
const PANEL_META_CLASS = 'font-mono text-[12px] leading-relaxed text-[hsl(0_0%_86%)]';
const PANEL_HINT_CLASS = 'font-mono text-[11px] leading-relaxed text-[hsl(0_0%_68%)]';

export default function IntelligenceControlGraphClient() {
    const [snapshot, setSnapshot] = useState<TopologySnapshot | null>(null);
    const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
    const [streamError, setStreamError] = useState<string | null>(null);
    const [mode, setMode] = useState<ControlMode>('live');
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [historicalLoading, setHistoricalLoading] = useState(false);
    const [replayMarkers, setReplayMarkers] = useState<TopologySnapshot['playback']['event_timeline']>([]);
    const [replayIndex, setReplayIndex] = useState<number>(-1);
    const [replayPlaying, setReplayPlaying] = useState(false);
    const [simulationMode, setSimulationMode] = useState(false);
    const [simulationScenario, setSimulationScenario] = useState<TopologySimulationScenario>('failure');
    const [simulationTarget, setSimulationTarget] = useState('diagnostics_model');
    const [simulationSeverity, setSimulationSeverity] = useState<'degraded' | 'critical'>('critical');
    const [simulationMessage, setSimulationMessage] = useState<string | null>(null);
    const [simulationMessageTone, setSimulationMessageTone] = useState<SimulationMessageTone | null>(null);
    const [simulationBusy, setSimulationBusy] = useState(false);
    const [simulationModeError, setSimulationModeError] = useState<string | null>(null);
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
        if (mode !== 'live' || !pageVisible) return;

        setStreamStatus('connecting');
        setStreamError(null);
        const source = new EventSource('/intelligence/stream?window=24h');

        source.onmessage = (event: MessageEvent) => {
            const payload = JSON.parse(event.data) as TopologyStreamPayload;
            setSnapshot(payload.snapshot);
            setReplayMarkers(payload.snapshot.playback.event_timeline);
            setStreamStatus('live');
            setStreamError(null);
        };

        source.addEventListener('stream-error', (event) => {
            const messageEvent = event as MessageEvent<string>;
            try {
                const payload = JSON.parse(messageEvent.data) as { error?: string };
                setStreamError(payload.error ?? 'Topology stream failure');
            } catch {
                setStreamError('Topology stream failure');
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
    }, [mode, pageVisible]);

    useEffect(() => {
        if (mode === 'live') {
            setReplayPlaying(false);
            return;
        }

        if (mode === 'rewind_1h') {
            void loadHistoricalSnapshot('1h');
            return;
        }

        if (mode === 'rewind_24h') {
            void loadHistoricalSnapshot('24h');
            return;
        }

        if (mode === 'replay' && replayMarkers.length === 0) {
            void loadHistoricalSnapshot('24h', undefined, true);
        }
    }, [mode, replayMarkers.length]);

    useEffect(() => {
        if (mode !== 'replay') return;
        if (replayMarkers.length === 0) return;
        if (replayIndex < 0) {
            setReplayIndex(replayMarkers.length - 1);
            return;
        }

        const marker = replayMarkers[replayIndex];
        if (!marker) return;
        void loadHistoricalSnapshot('24h', marker.timestamp, true);
    }, [mode, replayIndex, replayMarkers]);

    useEffect(() => {
        if (mode !== 'replay' || !replayPlaying || replayMarkers.length === 0) return;

        const interval = setInterval(() => {
            setReplayIndex((current) => {
                if (current >= replayMarkers.length - 1) {
                    setReplayPlaying(false);
                    return current;
                }
                return current + 1;
            });
        }, 1_200);

        return () => clearInterval(interval);
    }, [mode, replayPlaying, replayMarkers]);

    const selectedNode = snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;
    const selectedEdge = snapshot?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
    const selectedSimulationTargetNode = snapshot?.nodes.find((node) => node.id === simulationTarget) ?? null;
    const graphNodes = (snapshot?.nodes ?? []).map<Node>((node) => ({
        id: node.id,
        type: 'topologyNode',
        position: node.position,
        data: {
            node,
            selected: node.id === selectedNodeId,
        },
        draggable: false,
        selectable: true,
    }));
    const graphEdges = (snapshot?.edges ?? []).map<Edge>((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.requests_per_min != null ? `${edge.requests_per_min.toFixed(1)}/min` : 'NO DATA',
        animated: edge.animated,
        selectable: true,
        markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeStrokeColor(edge),
        },
        style: {
            stroke: edgeStrokeColor(edge),
            strokeWidth: edgeStrokeWidth(edge),
            opacity: edge.propagated_risk ? 1 : 0.9,
        },
        labelStyle: {
            fill: '#9ca3af',
            fontSize: 10,
            fontFamily: 'monospace',
        },
    }));

    return (
        <Container className="max-w-[1500px]">
            <PageHeader
                title="AI ECOSYSTEM TOPOLOGY"
                description="Real-time control graph for system health, model risk, decision propagation, and failure impact."
            />

            <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4 sm:gap-6 mb-4 sm:mb-6">
                <ConsoleCard className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-center gap-3 font-mono">
                        <div className={PANEL_LABEL_CLASS}>Network Health</div>
                        <div className={`text-3xl ${healthTone(snapshot?.network_health_score ?? 0)}`}>
                            {snapshot ? `${snapshot.network_health_score}%` : 'NO DATA'}
                        </div>
                        <div className="ml-auto flex items-center gap-2 text-xs">
                            <span className={streamStatus === 'live' ? 'text-accent' : streamStatus === 'disconnected' ? 'text-danger' : 'text-muted'}>
                                {streamStatus === 'live' ? 'LIVE STREAM' : streamStatus === 'disconnected' ? 'STREAM DISCONNECTED' : 'CONNECTING'}
                            </span>
                            <RefreshCw className={`w-3 h-3 ${streamStatus === 'connecting' ? 'animate-spin text-muted' : 'text-accent'}`} />
                        </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs font-mono">
                        <SummaryTile icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Where Failing" value={snapshot?.summary.where_failing ?? fallbackValue(streamStatus)} />
                        <SummaryTile icon={<Siren className="w-3.5 h-3.5" />} label="Root Cause" value={snapshot?.summary.root_cause ?? fallbackValue(streamStatus)} />
                        <SummaryTile icon={<Network className="w-3.5 h-3.5" />} label="Impact" value={snapshot?.summary.impact ?? fallbackValue(streamStatus)} />
                        <SummaryTile icon={<Workflow className="w-3.5 h-3.5" />} label="Next Action" value={snapshot?.summary.next_action ?? fallbackValue(streamStatus)} />
                    </div>
                </ConsoleCard>

                <ConsoleCard className="p-4 sm:p-5">
                    <div className={`flex items-center gap-2 mb-3 ${PANEL_LABEL_CLASS}`}>
                        <Clock3 className="w-3.5 h-3.5" />
                        Time Controls
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <ModeButton active={mode === 'live'} onClick={() => setMode('live')}>Live</ModeButton>
                        <ModeButton active={mode === 'rewind_1h'} onClick={() => setMode('rewind_1h')}>Rewind 1h</ModeButton>
                        <ModeButton active={mode === 'rewind_24h'} onClick={() => setMode('rewind_24h')}>Rewind 24h</ModeButton>
                        <ModeButton active={mode === 'replay'} onClick={() => setMode('replay')}>Replay</ModeButton>
                    </div>
                    {mode === 'replay' && (
                        <div className="mt-4 border border-grid/60 p-3 bg-black/20">
                            <div className="flex items-center gap-2 mb-3">
                                <TerminalButton
                                    variant={replayPlaying ? 'danger' : 'secondary'}
                                    onClick={() => setReplayPlaying((current) => !current)}
                                    disabled={replayMarkers.length === 0}
                                >
                                    {replayPlaying ? 'Pause' : 'Play'}
                                </TerminalButton>
                                <button
                                    type="button"
                                    className={`${PANEL_HINT_CLASS} hover:text-accent transition-colors`}
                                    onClick={() => setReplayIndex(Math.max(0, replayIndex - 1))}
                                    disabled={replayMarkers.length === 0}
                                >
                                    STEP BACK
                                </button>
                                <button
                                    type="button"
                                    className={`${PANEL_HINT_CLASS} hover:text-accent transition-colors`}
                                    onClick={() => setReplayIndex(Math.min(replayMarkers.length - 1, replayIndex + 1))}
                                    disabled={replayMarkers.length === 0}
                                >
                                    STEP FWD
                                </button>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={Math.max(0, replayMarkers.length - 1)}
                                value={Math.max(0, replayIndex)}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => setReplayIndex(Number(event.target.value))}
                                className="w-full"
                                disabled={replayMarkers.length === 0}
                            />
                            <div className={PANEL_HINT_CLASS}>
                                {replayMarkers[replayIndex]?.label ?? 'NO DATA'} {replayMarkers[replayIndex] ? `@ ${new Date(replayMarkers[replayIndex]!.timestamp).toLocaleString()}` : ''}
                            </div>
                        </div>
                    )}
                </ConsoleCard>
            </div>

            {(streamError || historicalLoading) && (
                <div className={`mb-4 sm:mb-6 p-3 border font-mono text-xs ${streamError ? 'border-danger bg-danger/5 text-danger' : 'border-grid text-muted'}`}>
                    {streamError ?? 'Loading historical topology snapshot...'}
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[2.1fr_1fr] gap-4 sm:gap-6">
                <ConsoleCard title="Operational Control Graph" className="h-[760px]">
                    <div className={`flex flex-wrap items-center gap-3 mb-4 ${PANEL_HINT_CLASS}`}>
                        <div className="flex items-center gap-2"><div className="w-2 h-2 bg-[#00ff41]" /> Healthy</div>
                        <div className="flex items-center gap-2"><div className="w-2 h-2 bg-[#facc15]" /> Degraded</div>
                        <div className="flex items-center gap-2"><div className="w-2 h-2 bg-[#ef4444]" /> Critical</div>
                        <div className="flex items-center gap-2"><div className="w-2 h-2 bg-[#6b7280]" /> Offline</div>
                        <div className="flex items-center gap-2 ml-auto"><GitBranch className="w-3.5 h-3.5" /> Click nodes or edges for details</div>
                    </div>
                    <div className="w-full h-[680px] border border-grid bg-background/60">
                        <ReactFlow
                            nodes={graphNodes}
                            edges={graphEdges}
                            nodeTypes={NODE_TYPES}
                            fitView
                            onNodeClick={(_, node) => {
                                setSelectedNodeId(node.id);
                                setSelectedEdgeId(null);
                            }}
                            onEdgeClick={(_, edge) => {
                                setSelectedEdgeId(edge.id);
                                setSelectedNodeId(null);
                            }}
                            nodesDraggable={false}
                            nodesConnectable={false}
                            className="bg-background"
                        >
                            <Background color="#111827" gap={22} size={1} />
                            <Controls className="!bg-black !border !border-grid" />
                        </ReactFlow>
                    </div>
                </ConsoleCard>

                <div className="flex flex-col gap-4 sm:gap-6">
                    <ConsoleCard title={selectedNode ? 'Node Panel' : selectedEdge ? 'Edge Panel' : 'Operational Panel'}>
                        {selectedNode ? (
                            <NodePanel node={selectedNode} />
                        ) : selectedEdge ? (
                            <EdgePanel edge={selectedEdge} />
                        ) : (
                            <OverviewPanel
                                snapshot={snapshot}
                                streamStatus={streamStatus}
                                onInspectNode={(nodeId) => {
                                    setSelectedNodeId(nodeId);
                                    setSelectedEdgeId(null);
                                }}
                            />
                        )}
                    </ConsoleCard>

                    <ConsoleCard title="Alerts">
                        <div className="space-y-2 max-h-[220px] overflow-y-auto">
                            {snapshot && snapshot.alerts.length > 0 ? snapshot.alerts.map((alert) => (
                                <AlertRow
                                    key={alert.id}
                                    alert={alert}
                                    onClick={() => {
                                        setSelectedNodeId(alert.node_id);
                                        setSelectedEdgeId(null);
                                    }}
                                />
                            )) : (
                                <div className={PANEL_HINT_CLASS}>{fallbackValue(streamStatus)}</div>
                            )}
                        </div>
                    </ConsoleCard>

                    <ConsoleCard title="Simulation Mode">
                        <div className="space-y-3 font-mono text-xs">
                            <div className="flex items-center justify-between">
                                <span className={PANEL_LABEL_CLASS}>Injection Controls</span>
                                <button
                                    type="button"
                                    className={`text-xs transition-colors ${simulationMode ? 'text-accent' : 'text-[hsl(0_0%_72%)] hover:text-accent'}`}
                                    onClick={() => void handleSimulationModeToggle()}
                                >
                                    {simulationBusy ? 'SYNCING' : simulationMode ? 'ENABLED' : 'DISABLED'}
                                </button>
                            </div>
                            {simulationModeError ? (
                                <div className="border border-danger bg-danger/10 p-2 text-danger">
                                    {simulationModeError}
                                </div>
                            ) : null}
                            {simulationMode ? (
                                <>
                                    <label className="block">
                                        <span className={PANEL_LABEL_CLASS}>Scenario</span>
                                        <select
                                            value={simulationScenario}
                                            onChange={(event: ChangeEvent<HTMLSelectElement>) => setSimulationScenario(event.target.value as TopologySimulationScenario)}
                                            className={simulationSelectClass(resolveScenarioSelectTone(simulationScenario))}
                                        >
                                            <option value="failure">Inject Failure</option>
                                            <option value="drift">Simulate Drift</option>
                                            <option value="adversarial_attack">Adversarial Attack</option>
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className={PANEL_LABEL_CLASS}>Target Node</span>
                                        <select
                                            value={simulationTarget}
                                            onChange={(event: ChangeEvent<HTMLSelectElement>) => setSimulationTarget(event.target.value)}
                                            className={simulationSelectClass(resolveNodeSelectTone(selectedSimulationTargetNode))}
                                        >
                                            {(snapshot?.nodes ?? []).map((node) => (
                                                <option key={node.id} value={node.id}>{node.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className={PANEL_LABEL_CLASS}>Severity</span>
                                        <select
                                            value={simulationSeverity}
                                            onChange={(event: ChangeEvent<HTMLSelectElement>) => setSimulationSeverity(event.target.value as 'degraded' | 'critical')}
                                            className={simulationSelectClass(resolveSeveritySelectTone(simulationSeverity))}
                                        >
                                            <option value="degraded">Degraded</option>
                                            <option value="critical">Critical</option>
                                        </select>
                                    </label>
                                    <TerminalButton
                                        variant={simulationSeverity === 'critical' || simulationScenario === 'adversarial_attack' || simulationScenario === 'failure' ? 'danger' : 'primary'}
                                        disabled={simulationBusy}
                                        onClick={() => void injectSimulation()}
                                    >
                                        {simulationBusy ? 'Injecting...' : 'Inject'}
                                    </TerminalButton>
                                    {simulationMessage && (
                                        <div className={`${PANEL_META_CLASS} border p-2 ${simulationMessageTone === 'error' ? 'border-danger bg-danger/10 text-danger' : 'border-accent/60 bg-accent/10 text-accent'}`}>
                                            {simulationMessage}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className={PANEL_META_CLASS}>Enable simulation mode to inject failure, drift, or adversarial attack conditions into the live graph.</div>
                            )}
                        </div>
                    </ConsoleCard>
                </div>
            </div>
        </Container>
    );

    async function loadHistoricalSnapshot(window: TopologyWindow, until?: string, preserveReplay = false) {
        setHistoricalLoading(true);
        setStreamError(null);
        try {
            const params = new URLSearchParams({ window });
            if (until) params.set('until', until);
            const response = await fetch(`/api/intelligence/topology?${params.toString()}`);
            const payload = await response.json() as { snapshot?: TopologySnapshot; error?: string };
            if (!response.ok || !payload.snapshot) {
                throw new Error(payload.error ?? 'Failed to load topology snapshot');
            }

            setSnapshot(payload.snapshot);
            if (!preserveReplay || payload.snapshot.playback.event_timeline.length > 0) {
                setReplayMarkers(payload.snapshot.playback.event_timeline);
            }
        } catch (error) {
            setStreamError(error instanceof Error ? error.message : 'Failed to load topology snapshot');
        } finally {
            setHistoricalLoading(false);
        }
    }

    async function injectSimulation() {
        setSimulationBusy(true);
        setSimulationMessage(null);
        setSimulationMessageTone(null);
        try {
            const response = await fetch('/api/intelligence/topology', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    scenario: simulationScenario,
                    target_node_id: simulationTarget,
                    severity: simulationSeverity,
                }),
            });
            const payload = await response.json() as { error?: string; injected?: boolean; target?: { node_id: string } };
            if (!response.ok || payload.injected !== true) {
                throw new Error(payload.error ?? 'Failed to inject simulation');
            }

            setSimulationMessage(`Injected ${simulationScenario} into ${payload.target?.node_id ?? simulationTarget}.`);
            setSimulationMessageTone('success');
            if (mode !== 'live') {
                const activeWindow = mode === 'rewind_1h' ? '1h' : '24h';
                await loadHistoricalSnapshot(activeWindow, mode === 'replay' && replayMarkers[replayIndex] ? replayMarkers[replayIndex]!.timestamp : undefined, mode === 'replay');
            }
        } catch (error) {
            setSimulationMessage(error instanceof Error ? error.message : 'Failed to inject simulation');
            setSimulationMessageTone('error');
        } finally {
            setSimulationBusy(false);
        }
    }

    async function handleSimulationModeToggle() {
        const nextMode = !simulationMode;
        setSimulationBusy(true);
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
            setSimulationMessage(nextMode ? 'Simulation mode enabled from the control plane.' : 'Simulation mode disabled from the control plane.');
            setSimulationMessageTone('success');
        } catch (error) {
            setSimulationModeError(error instanceof Error ? error.message : 'Failed to update simulation mode.');
            setSimulationMessageTone('error');
        } finally {
            setSimulationBusy(false);
        }
    }
}

function TopologyGraphNode({ data }: NodeProps<{ node: TopologyNodeSnapshot; selected: boolean }>) {
    const node = data.node;
    const selected = data.selected;
    const accent = nodeAccent(node);
    const governanceAccent = governanceBorderAccent(node);
    const rootStyle: CSSProperties = {
        border: `1px solid ${governanceAccent}`,
        backgroundColor: accent.background,
        color: accent.foreground,
        boxShadow: selected
            ? `0 0 0 1px ${accent.foreground}, 0 0 18px ${accent.glow}`
            : `0 0 14px ${accent.glow}`,
        minWidth: 190,
    };

    return (
        <div
            style={rootStyle}
            className={`relative rounded-sm px-3 py-2 font-mono text-[11px] uppercase ${node.propagated_risk ? 'animate-pulse' : ''}`}
            title={`Drift: ${formatMetric(node.state.drift_score, 'NO DATA')}`}
        >
            <Handle type="target" position={Position.Left} className="!opacity-0 !bg-transparent !border-0" />
            <Handle type="source" position={Position.Right} className="!opacity-0 !bg-transparent !border-0" />
            {(node.state.drift_score ?? 0) >= 0.12 && (
                <div className="absolute inset-0 rounded-sm border border-danger/50 animate-ping pointer-events-none" />
            )}
            <div className="flex items-center gap-2">
                <span className="font-semibold tracking-[0.12em] leading-tight">{node.label}</span>
                {node.alert_count > 0 && (
                    <span className="ml-auto text-[9px] px-1 py-0.5 border border-danger text-danger">{node.alert_count}</span>
                )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] tracking-[0.08em]" style={{ color: accent.secondary }}>
                <span>{node.state.status}</span>
                {node.governance?.registry_role && <span>{node.governance.registry_role}</span>}
                {node.governance?.model_version && <span>{node.governance.model_version}</span>}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                <MetricMini label="LAT" value={formatMetric(node.state.latency, 'NO DATA', 'ms')} labelStyle={{ color: accent.tertiary }} valueStyle={{ color: accent.secondary }} />
                <MetricMini label="THR" value={formatMetric(node.state.throughput, 'NO DATA', '/m')} labelStyle={{ color: accent.tertiary }} valueStyle={{ color: accent.secondary }} />
                <MetricMini label="ERR" value={formatPercent(node.state.error_rate)} labelStyle={{ color: accent.tertiary }} valueStyle={{ color: accent.secondary }} />
                <MetricMini label="DRIFT" value={formatMetric(node.state.drift_score, 'NO DATA')} labelStyle={{ color: accent.tertiary }} valueStyle={{ color: accent.secondary }} />
            </div>
        </div>
    );
}

function NodePanel({ node }: { node: TopologyNodeSnapshot }) {
    return (
        <div className="space-y-3 font-mono text-xs">
            <div className="text-accent uppercase">{node.label}</div>
            <DataRow label="Status" value={node.state.status} />
            <DataRow label="Latency" value={formatMetric(node.state.latency, 'NO DATA', 'ms')} />
            <DataRow label="Throughput" value={formatMetric(node.state.throughput, 'NO DATA', '/min')} />
            <DataRow label="Error Rate" value={formatPercent(node.state.error_rate)} />
            <DataRow label="Drift" value={formatMetric(node.state.drift_score, 'NO DATA')} />
            <DataRow label="Confidence" value={formatPercent(node.state.confidence_avg)} />
            <DataRow label="Last Updated" value={node.state.last_updated ? new Date(node.state.last_updated).toLocaleString() : 'NO DATA'} />
            {node.governance && (
                <>
                    <DataRow label="Model Version" value={node.governance.model_version ?? 'NO DATA'} />
                    <DataRow label="Registry Role" value={node.governance.registry_role ?? 'NO DATA'} />
                    <DataRow label="Deployment" value={node.governance.deployment_status ?? 'NO DATA'} />
                    <DataRow label="Lifecycle" value={node.governance.lifecycle_status ?? 'NO DATA'} />
                </>
            )}
            <div>
                <div className="text-muted uppercase mb-2">Recent Errors</div>
                <div className="space-y-1">
                    {node.recent_errors.length > 0 ? node.recent_errors.map((error, index) => (
                        <div key={`${node.id}-err-${index}`} className="text-danger text-[11px]">{error}</div>
                    )) : <div className="text-muted">NO DATA</div>}
                </div>
            </div>
            <div>
                <div className="text-muted uppercase mb-2">Connected Nodes</div>
                <div className="flex flex-wrap gap-2">
                    {node.connected_node_ids.length > 0 ? node.connected_node_ids.map((connected) => (
                        <span key={connected} className="px-2 py-1 border border-grid text-muted">{connected}</span>
                    )) : <span className="text-muted">NO DATA</span>}
                </div>
            </div>
            <div>
                <div className="text-muted uppercase mb-2">Recommendations</div>
                <div className="space-y-1">
                    {node.recommendations.length > 0 ? node.recommendations.map((entry, index) => (
                        <div key={`${node.id}-rec-${index}`} className="text-[11px] text-accent">{entry}</div>
                    )) : <div className="text-muted">NO DATA</div>}
                </div>
            </div>
        </div>
    );
}

function EdgePanel({ edge }: { edge: TopologyEdgeSnapshot }) {
    return (
        <div className="space-y-3 font-mono text-xs">
            <div className="text-accent uppercase">{edge.label}</div>
            <DataRow label="Requests / Min" value={formatMetric(edge.requests_per_min, 'NO DATA')} />
            <DataRow label="Latency" value={formatMetric(edge.latency, 'NO DATA', 'ms')} />
            <DataRow label="Failure Rate" value={formatPercent(edge.failure_rate)} />
            <DataRow label="Status" value={edge.status} />
            <DataRow label="P50" value={formatMetric(edge.latency_distribution.p50, 'NO DATA', 'ms')} />
            <DataRow label="P95" value={formatMetric(edge.latency_distribution.p95, 'NO DATA', 'ms')} />
            <DataRow label="Max" value={formatMetric(edge.latency_distribution.max, 'NO DATA', 'ms')} />
            <DataRow label="Propagation" value={edge.propagated_risk ? 'CASCADED' : 'NORMAL'} />
        </div>
    );
}

function OverviewPanel({
    snapshot,
    streamStatus,
    onInspectNode,
}: {
    snapshot: TopologySnapshot | null;
    streamStatus: StreamStatus;
    onInspectNode: (nodeId: string) => void;
}) {
    return (
        <div className="space-y-4 font-mono text-xs">
            <div className={PANEL_LABEL_CLASS}>Operational Intelligence</div>
            {snapshot ? (
                <>
                    <div className="space-y-2">
                        {snapshot.recommendations.map((recommendation) => (
                            <div key={recommendation.id} className={`border p-2 ${recommendation.severity === 'critical' ? 'border-danger text-danger' : recommendation.severity === 'warning' ? 'border-[#facc15] text-[#facc15]' : 'border-grid text-accent'}`}>
                                {recommendation.message}
                            </div>
                        ))}
                    </div>
                    <div>
                        <div className={`${PANEL_LABEL_CLASS} mb-2`}>Hot Nodes</div>
                        <div className="space-y-2">
                            {snapshot.nodes
                                .filter((node) => node.alert_count > 0 || node.propagated_risk)
                                .slice(0, 5)
                                .map((node) => (
                                    <button
                                        key={node.id}
                                        type="button"
                                        className={`w-full text-left border p-3 transition-colors ${hotNodeCardClass(node)}`}
                                        onClick={() => onInspectNode(node.id)}
                                    >
                                        <div className="text-[13px] text-foreground leading-relaxed">{node.label}</div>
                                        <div className={PANEL_HINT_CLASS} style={{ color: hotNodeMetaColor(node) }}>
                                            {node.state.status} | alerts={node.alert_count} | drift={formatMetric(node.state.drift_score, 'NO DATA')}
                                        </div>
                                    </button>
                                ))}
                        </div>
                    </div>
                </>
            ) : (
                <div className={PANEL_HINT_CLASS}>{fallbackValue(streamStatus)}</div>
            )}
        </div>
    );
}

function AlertRow({ alert, onClick }: { alert: TopologyAlert; onClick: () => void }) {
    return (
        <button
            type="button"
            className={`w-full text-left border p-2 transition-colors ${alert.severity === 'critical' ? 'border-danger text-danger hover:border-danger/80' : alert.severity === 'warning' ? 'border-[#facc15] text-[#facc15] hover:border-[#facc15]/80' : 'border-grid text-accent hover:border-accent/80'}`}
            onClick={onClick}
        >
            <div className="flex items-center gap-2">
                <Siren className="w-3.5 h-3.5" />
                <span>{alert.title}</span>
            </div>
            <div className="mt-1 text-[11px]">{alert.message}</div>
        </button>
    );
}

function SummaryTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <div className="border border-grid p-3 bg-black/20">
            <div className={`flex items-center gap-2 ${PANEL_LABEL_CLASS}`}>
                {icon}
                {label}
            </div>
            <div className={`mt-2 ${PANEL_META_CLASS} break-words whitespace-normal`}>{value}</div>
        </div>
    );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`font-mono text-xs uppercase border px-3 py-2 transition-colors ${active ? 'border-accent text-accent bg-accent/5' : 'border-grid text-[hsl(0_0%_72%)] hover:text-accent hover:border-accent/60'}`}
        >
            {children}
        </button>
    );
}

function simulationSelectClass(tone: 'success' | 'warning' | 'danger' | 'neutral') {
    const toneClass = tone === 'danger'
        ? 'border-danger bg-danger/10 text-danger focus:border-danger'
        : tone === 'warning'
            ? 'border-[#facc15]/70 bg-[#facc15]/10 text-[#fde68a] focus:border-[#facc15]'
            : tone === 'success'
                ? 'border-accent/70 bg-accent/10 text-accent focus:border-accent'
                : 'border-grid bg-black text-foreground focus:border-accent/60';

    return `mt-1 w-full appearance-none border px-3 py-2.5 font-mono text-[13px] transition-colors outline-none ${toneClass}`;
}

function resolveScenarioSelectTone(scenario: TopologySimulationScenario) {
    if (scenario === 'adversarial_attack' || scenario === 'failure') return 'danger';
    if (scenario === 'drift') return 'warning';
    return 'neutral';
}

function resolveSeveritySelectTone(severity: 'degraded' | 'critical') {
    return severity === 'critical' ? 'danger' : 'warning';
}

function resolveNodeSelectTone(node: TopologyNodeSnapshot | null): 'success' | 'warning' | 'danger' | 'neutral' {
    if (!node) return 'neutral';
    if (node.state.status === 'critical') return 'danger';
    if (node.state.status === 'degraded') return 'warning';
    if (node.state.status === 'healthy') return 'success';
    return 'neutral';
}

function MetricMini({
    label,
    value,
    labelStyle,
    valueStyle,
}: {
    label: string;
    value: string;
    labelStyle?: CSSProperties;
    valueStyle?: CSSProperties;
}) {
    return (
        <div>
            <div style={labelStyle}>{label}</div>
            <div style={valueStyle}>{value}</div>
        </div>
    );
}

function nodeAccent(node: TopologyNodeSnapshot) {
    if (node.state.status === 'critical') {
        return {
            background: 'rgba(69, 10, 10, 0.92)',
            foreground: '#f87171',
            glow: 'rgba(239, 68, 68, 0.35)',
            secondary: '#fecaca',
            tertiary: '#fca5a5',
        };
    }
    if (node.state.status === 'degraded') {
        return {
            background: 'rgba(69, 44, 4, 0.92)',
            foreground: '#facc15',
            glow: 'rgba(250, 204, 21, 0.28)',
            secondary: '#fef3c7',
            tertiary: '#fcd34d',
        };
    }
    if (node.state.status === 'offline') {
        return {
            background: 'rgba(17, 24, 39, 0.92)',
            foreground: '#9ca3af',
            glow: 'rgba(107, 114, 128, 0.2)',
            secondary: '#e5e7eb',
            tertiary: '#cbd5e1',
        };
    }
    return {
        background: 'rgba(3, 22, 12, 0.92)',
        foreground: '#4ade80',
        glow: 'rgba(74, 222, 128, 0.25)',
        secondary: '#d1fae5',
        tertiary: '#86efac',
    };
}

function hotNodeCardClass(node: TopologyNodeSnapshot) {
    if (node.state.status === 'critical') {
        return 'border-danger bg-danger/10 hover:border-danger/80';
    }
    if (node.state.status === 'degraded') {
        return 'border-[#facc15]/70 bg-[#facc15]/10 hover:border-[#facc15]';
    }
    if (node.propagated_risk || node.alert_count > 0) {
        return 'border-accent/60 bg-accent/10 hover:border-accent';
    }
    return 'border-grid bg-black/20 hover:border-accent/60';
}

function hotNodeMetaColor(node: TopologyNodeSnapshot) {
    if (node.state.status === 'critical') return '#fca5a5';
    if (node.state.status === 'degraded') return '#fde68a';
    if (node.propagated_risk || node.alert_count > 0) return '#86efac';
    return '#9ca3af';
}

function governanceBorderAccent(node: TopologyNodeSnapshot) {
    if (!node.governance) {
        return nodeAccent(node).foreground;
    }
    if (node.governance.border_state === 'failed') {
        return '#ef4444';
    }
    if (node.governance.border_state === 'pending') {
        return '#facc15';
    }
    return nodeAccent(node).foreground;
}

function edgeStrokeColor(edge: TopologyEdgeSnapshot) {
    if (edge.status === 'failing') return '#ef4444';
    if (edge.status === 'stressed') return '#facc15';
    return '#4ade80';
}

function edgeStrokeWidth(edge: TopologyEdgeSnapshot) {
    const hint = typeof edge.metadata.stroke_width_hint === 'number' ? edge.metadata.stroke_width_hint : 2;
    return edge.propagated_risk ? Math.max(4, hint) : hint;
}

function healthTone(score: number) {
    if (score < 55) return 'text-danger';
    if (score < 75) return 'text-[#facc15]';
    return 'text-accent';
}

function fallbackValue(streamStatus: StreamStatus) {
    return streamStatus === 'disconnected' ? 'STREAM DISCONNECTED' : 'NO DATA';
}

function formatMetric(value: number | null | undefined, fallback: string, suffix = '') {
    if (value == null) return fallback;
    return `${value.toFixed(suffix === 'ms' ? 1 : 2)}${suffix}`;
}

function formatPercent(value: number | null | undefined) {
    if (value == null) return 'NO DATA';
    return `${(value * 100).toFixed(1)}%`;
}
