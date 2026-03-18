'use client';

import { useState, useEffect, useCallback } from 'react';
import { Container, PageHeader, ConsoleCard } from '@/components/ui/terminal';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import { Activity, Terminal, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface TelemetryMetrics {
    total_inferences_24h: number;
    avg_confidence: number | null;
    p95_latency_ms: number | null;
    confidence_drift_24h: number | null;
    total_simulations: number;
    total_outcomes: number;
}

interface ChartPoint {
    time: string;
    [key: string]: string | number;
}

interface TelemetryData {
    metrics: TelemetryMetrics;
    charts: {
        latency: ChartPoint[];
        drift: ChartPoint[];
    };
}

interface TelemetryState {
    status: 'loading' | 'live' | 'error';
    data?: TelemetryData;
    errorMessage?: string;
    lastRefreshed?: Date;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TelemetrySystem() {
    const [state, setState] = useState<TelemetryState>({ status: 'loading' });
    const [logs, setLogs] = useState<string[]>([]);

    const fetchTelemetry = useCallback(async () => {
        try {
            const res = await fetch('/api/telemetry');
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to fetch telemetry');
            }

            setState({
                status: 'live',
                data,
                lastRefreshed: new Date(),
            });

            // Push a real log entry
            const m = data.metrics;
            setLogs(prev => [
                `[INFO] TELEMETRY_REFRESH: ${m.total_inferences_24h} inferences | p95=${m.p95_latency_ms ?? '—'}ms | confidence=${m.avg_confidence != null ? (m.avg_confidence * 100).toFixed(1) + '%' : '—'}`,
                ...prev,
            ].slice(0, 15));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            setState(prev => ({ ...prev, status: 'error', errorMessage: msg }));
            setLogs(prev => [
                `[ERROR] TELEMETRY_FETCH: ${msg}`,
                ...prev,
            ].slice(0, 15));
        }
    }, []);

    useEffect(() => {
        fetchTelemetry();
        const interval = setInterval(fetchTelemetry, 30_000); // Auto-refresh every 30s
        return () => clearInterval(interval);
    }, [fetchTelemetry]);

    const m = state.data?.metrics;
    const charts = state.data?.charts;

    return (
        <Container>
            <PageHeader
                title="TELEMETRY OBSERVATOR"
                description="Live system health, metric streaming, and model drift telemetry."
            />

            {/* Refresh control */}
            <div className="flex items-center gap-3 mb-4 sm:mb-6 font-mono text-xs text-muted">
                <button
                    onClick={fetchTelemetry}
                    className="flex items-center gap-1.5 hover:text-accent transition-colors"
                    disabled={state.status === 'loading'}
                >
                    <RefreshCw className={`w-3 h-3 ${state.status === 'loading' ? 'animate-spin' : ''}`} />
                    REFRESH
                </button>
                {state.lastRefreshed && (
                    <span className="text-muted">
                        Last: {state.lastRefreshed.toLocaleTimeString()}
                    </span>
                )}
                <span className={`ml-auto flex items-center gap-1 ${state.status === 'live' ? 'text-accent' : state.status === 'error' ? 'text-danger' : 'text-muted'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${state.status === 'live' ? 'bg-accent animate-pulse' : state.status === 'error' ? 'bg-danger' : 'bg-muted'}`} />
                    {state.status === 'loading' ? 'CONNECTING' : state.status === 'live' ? 'LIVE' : 'ERROR'}
                </span>
            </div>

            {/* Error Banner */}
            {state.status === 'error' && (
                <div className="mb-4 sm:mb-6 p-3 border border-danger bg-danger/5 font-mono text-xs text-danger">
                    ERR: {state.errorMessage}
                </div>
            )}

            {/* ── Top Metric Cards ─────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">
                <MetricCard
                    label="Inferences (24h)"
                    value={m ? String(m.total_inferences_24h) : '—'}
                    loading={state.status === 'loading'}
                />
                <MetricCard
                    label="p95 Latency"
                    value={m?.p95_latency_ms != null ? `${m.p95_latency_ms}ms` : '—'}
                    loading={state.status === 'loading'}
                />
                <MetricCard
                    label="Avg Confidence"
                    value={m?.avg_confidence != null ? `${(m.avg_confidence * 100).toFixed(1)}%` : '—'}
                    accent={m?.avg_confidence != null && m.avg_confidence < 0.6 ? 'danger' : 'accent'}
                    loading={state.status === 'loading'}
                />
                <MetricCard
                    label="Confidence Drift"
                    value={m?.confidence_drift_24h != null ? `${(m.confidence_drift_24h * 100).toFixed(2)}%` : '—'}
                    accent={m?.confidence_drift_24h != null && m.confidence_drift_24h < -0.05 ? 'danger' : 'accent'}
                    loading={state.status === 'loading'}
                    icon={m?.confidence_drift_24h != null && m.confidence_drift_24h < -0.05
                        ? <AlertTriangle className="w-3 h-3 text-danger" />
                        : m?.confidence_drift_24h != null
                            ? <CheckCircle2 className="w-3 h-3 text-accent" />
                            : undefined
                    }
                />
                <MetricCard
                    label="Simulations"
                    value={m ? String(m.total_simulations) : '—'}
                    loading={state.status === 'loading'}
                />
                <MetricCard
                    label="Outcomes"
                    value={m ? String(m.total_outcomes) : '—'}
                    loading={state.status === 'loading'}
                />
            </div>

            {/* ── Charts ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
                <ConsoleCard title="Inference Latency (p95) — ms" className="h-[240px] sm:h-[300px]" collapsible>
                    {charts && charts.latency.length > 0 ? (
                        <div className="flex-1 -mx-2 sm:-mx-4 h-full">
                            <TelemetryChart data={charts.latency} dataKey="latency" color="#00ff41" />
                        </div>
                    ) : state.status === 'loading' ? (
                        <div className="h-full flex items-center justify-center text-accent animate-pulse font-mono text-xs sm:text-sm">
                            <Activity className="w-4 h-4 mr-2 animate-spin" /> LOADING LATENCY DATA...
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-muted text-[10px] font-mono border border-dashed border-grid">
                            NO LATENCY DATA — Run inferences to populate
                        </div>
                    )}
                </ConsoleCard>

                <ConsoleCard title="Model Drift Score (L2 Norm)" className="h-[240px] sm:h-[300px]" collapsible>
                    {charts && charts.drift.length > 0 ? (
                        <div className="flex-1 -mx-2 sm:-mx-4 h-full">
                            <TelemetryChart data={charts.drift} dataKey="drift" color="#ff3333" />
                        </div>
                    ) : state.status === 'loading' ? (
                        <div className="h-full flex items-center justify-center text-danger animate-pulse font-mono text-xs sm:text-sm">
                            <Activity className="w-4 h-4 mr-2 animate-spin" /> LOADING DRIFT DATA...
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-muted text-[10px] font-mono border border-dashed border-grid">
                            NO DRIFT DATA — Attach outcomes to generate evaluation events
                        </div>
                    )}
                </ConsoleCard>
            </div>

            {/* ── Live Log Stream ─────────────────────────────────────── */}
            <ConsoleCard title="System Log Stream" collapsible>
                <div className="bg-black border border-grid/50 p-3 sm:p-4 h-[200px] sm:h-[250px] overflow-hidden flex flex-col font-mono text-xs">
                    <div className="flex items-center gap-2 text-accent/50 mb-3 sm:mb-4 border-b border-grid/50 pb-2 text-[10px] sm:text-xs">
                        <Terminal className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span>TAIL -F /VAR/LOG/VETIOS/RUNTIME.LOG</span>
                        <Activity className="w-3 h-3 ml-auto animate-pulse" />
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-1 text-muted/80">
                        {logs.length === 0 ? (
                            <div className="text-muted/40 text-center pt-8">Waiting for telemetry events...</div>
                        ) : (
                            logs.map((log, i) => (
                                <div key={i} className={`truncate text-[10px] sm:text-xs ${log.includes('ERROR') ? 'text-danger' : log.includes('WARN') ? 'text-[#ffcc00]' : ''}`}>
                                    <span className="text-muted/40 mr-2">
                                        {new Date().toISOString().split('T')[1]?.slice(0, 12) ?? ''}
                                    </span>
                                    {log}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </ConsoleCard>
        </Container>
    );
}

// ── Metric Card Component ────────────────────────────────────────────────────

function MetricCard({
    label,
    value,
    accent = 'accent',
    loading = false,
    icon,
}: {
    label: string;
    value: string;
    accent?: string;
    loading?: boolean;
    icon?: React.ReactNode;
}) {
    return (
        <ConsoleCard className={`p-3 sm:p-4 border-${accent}/20`}>
            <div className="font-mono text-[9px] sm:text-[10px] text-muted uppercase mb-1 truncate">{label}</div>
            {loading ? (
                <div className="font-mono text-lg sm:text-2xl text-muted animate-pulse">—</div>
            ) : (
                <div className={`font-mono text-lg sm:text-2xl text-${accent} flex items-center gap-1.5`}>
                    {value}
                    {icon}
                </div>
            )}
        </ConsoleCard>
    );
}
