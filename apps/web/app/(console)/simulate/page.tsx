'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard, DataRow } from '@/components/ui/terminal';
import { SimulationRunner } from '@/components/SimulationRunner';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import { ShieldAlert, Activity, AlertTriangle, AlertOctagon, CheckCircle2, XCircle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContradictionAnalysis {
    score: number;
    contradictions: string[];
    is_plausible: boolean;
    confidence_cap: number;
    confidence_was_capped: boolean;
    original_confidence: number | null;
}

interface DifferentialEntry {
    condition: string;
    probability: number;
    key_drivers?: { feature: string; weight: number }[];
}

interface DifferentialSpread {
    top_1_probability: number | null;
    top_2_probability: number | null;
    top_3_probability: number | null;
    spread: string;
}

interface TargetEvaluation {
    target_disease: string;
    top_diagnosis: string | null;
    target_matched_top: boolean;
}

interface SimResult {
    simulation_event_id: string;
    triggered_inference_event_id: string;
    inference_output: Record<string, unknown>;
    confidence_score: number | null;
    inference_latency_ms: number;
    contradiction_analysis?: ContradictionAnalysis;
    differential_diagnosis?: DifferentialEntry[];
    differential_spread?: DifferentialSpread;
    target_evaluation?: TargetEvaluation | null;
    request_id: string;
}

interface HistoryEntry {
    id: string;
    target: string;
    type: string;
    confidence: number | null;
    latency: number;
    contradictions: number;
    time: string;
}

interface SimulationState {
    status: 'idle' | 'simulating' | 'success' | 'error';
    result?: SimResult;
    history: HistoryEntry[];
    errorMessage?: string;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdversarialSimulation() {
    const [state, setState] = useState<SimulationState>({
        status: 'idle',
        history: [],
    });

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setState(prev => ({ ...prev, status: 'simulating', errorMessage: undefined }));

        const formData = new FormData(e.currentTarget);

        const payload = {
            simulation: {
                type: (formData.get('simulationType') as string) || 'adversarial_scenario',
                parameters: {
                    edge_cases: formData.get('edgeCases') as string,
                    contradictions: formData.get('contradictions') as string,
                    target_disease: formData.get('rareDiseases') as string,
                    iterations: parseInt(formData.get('iterations') as string || '100'),
                },
            },
            inference: {
                model: (formData.get('model') as string) || 'gpt-4o-mini',
                model_version: 'gpt-4o-mini',
            },
        };

        try {
            const res = await fetch('/api/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await res.json() as SimResult;

            if (!res.ok) {
                throw new Error((result as unknown as Record<string, string>).error || 'Simulation engine failed');
            }

            const newEntry: HistoryEntry = {
                id: result.simulation_event_id?.slice(0, 12) || 'sim_unknown',
                target: payload.simulation.parameters.target_disease || 'Mixed Vectors',
                type: payload.simulation.type,
                confidence: result.confidence_score,
                latency: result.inference_latency_ms,
                contradictions: result.contradiction_analysis?.contradictions?.length ?? 0,
                time: new Date().toLocaleTimeString(),
            };

            setState(prev => ({
                ...prev,
                status: 'success',
                result,
                history: [newEntry, ...prev.history].slice(0, 10),
            }));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown simulation error';
            setState(prev => ({ ...prev, status: 'error', errorMessage: msg }));
        }
    }

    // Derived
    const r = state.result;
    const confidenceScore = r?.confidence_score;
    const latencyMs = r?.inference_latency_ms;
    const degradation = confidenceScore != null ? Math.max(0, 1 - confidenceScore) : null;
    const ca = r?.contradiction_analysis;
    const dd = r?.differential_diagnosis ?? [];
    const ds = r?.differential_spread;
    const te = r?.target_evaluation;

    return (
        <Container>
            <PageHeader
                title="ADVERSARIAL SIMULATION ENGINE"
                description="Stress-testing lab to expose edge cases, trigger uncertainty spikes, and measure model degradation under noise."
            />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 sm:gap-8 xl:gap-12 mb-8 sm:mb-12">
                <div className="xl:col-span-1 xl:border-r xl:border-grid xl:pr-12">
                    <ConsoleCard title="Configure Simulation" className="border-danger/30 p-0 bg-transparent">
                        <SimulationRunner onSubmit={handleSubmit} isSimulating={state.status === 'simulating'} />
                    </ConsoleCard>
                </div>

                <div className="xl:col-span-2 space-y-4 sm:space-y-6">
                    {/* ── Row 1: Degradation + Inference Metrics ── */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 lg:gap-6">
                        <ConsoleCard title="Model Degradation Score" className="border-danger/30">
                            {state.status === 'simulating' ? (
                                <div className="h-20 sm:h-24 flex items-center justify-center text-danger animate-pulse font-mono text-xs sm:text-sm">
                                    <Activity className="w-4 h-4 sm:w-5 sm:h-5 mr-2 animate-spin" /> CALCULATING...
                                </div>
                            ) : state.status === 'success' && degradation != null ? (
                                <div className="h-20 sm:h-24 flex flex-col justify-center">
                                    <div className="text-3xl sm:text-4xl font-mono text-danger font-bold tracking-tighter">
                                        {(degradation * 100).toFixed(1)}<span className="text-base sm:text-lg">%</span>
                                    </div>
                                    <div className="text-[10px] text-muted font-mono uppercase mt-1 flex items-center gap-1">
                                        {degradation > 0.3 ? (
                                            <><AlertTriangle className="w-3 h-3 text-danger" /> Critical Degradation</>
                                        ) : degradation > 0.15 ? (
                                            <><AlertTriangle className="w-3 h-3 text-yellow-400" /> Moderate Degradation</>
                                        ) : (
                                            <><CheckCircle2 className="w-3 h-3 text-accent" /> Stable Under Stress</>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="h-20 sm:h-24 flex items-center justify-center text-muted text-[10px] font-mono border border-dashed border-danger/20">
                                    AWAITING SIMULATION
                                </div>
                            )}
                        </ConsoleCard>

                        <ConsoleCard title="Inference Metrics" className="border-danger/30">
                            {state.status === 'simulating' ? (
                                <div className="h-20 sm:h-24 flex items-center justify-center text-danger animate-pulse font-mono text-xs sm:text-sm">
                                    <Activity className="w-4 h-4 sm:w-5 sm:h-5 mr-2 animate-spin" /> SCANNING...
                                </div>
                            ) : state.status === 'success' ? (
                                <div className="h-20 sm:h-24 flex flex-col justify-center gap-2">
                                    <div className="flex justify-between items-baseline">
                                        <span className="font-mono text-[10px] text-muted uppercase">Confidence</span>
                                        <span className="font-mono text-sm sm:text-lg text-accent">
                                            {confidenceScore != null ? `${(confidenceScore * 100).toFixed(1)}%` : 'N/A'}
                                            {ca?.confidence_was_capped && (
                                                <span className="text-[9px] text-yellow-400 ml-1">
                                                    CAPPED (was {((ca.original_confidence ?? 0) * 100).toFixed(0)}%)
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-baseline">
                                        <span className="font-mono text-[10px] text-muted uppercase">Latency</span>
                                        <span className="font-mono text-sm sm:text-lg text-foreground">
                                            {latencyMs != null ? `${latencyMs}ms` : 'N/A'}
                                        </span>
                                    </div>
                                    {ds && (
                                        <div className="flex justify-between items-baseline">
                                            <span className="font-mono text-[10px] text-muted uppercase">Differential Spread</span>
                                            <span className="font-mono text-sm text-foreground">{ds.spread}</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="h-20 sm:h-24 flex items-center justify-center text-muted text-[10px] font-mono border border-dashed border-danger/20">
                                    AWAITING SIMULATION
                                </div>
                            )}
                        </ConsoleCard>
                    </div>

                    {/* ── Contradiction Analysis ── */}
                    {state.status === 'success' && ca && (
                        <ConsoleCard title="Contradiction Analysis" className={`border-${ca.contradictions.length > 0 ? 'danger' : 'accent'}/30`}>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                                <div className="font-mono">
                                    <div className="text-[9px] text-muted uppercase">Score</div>
                                    <div className={`text-lg font-bold ${ca.score > 0.5 ? 'text-danger' : ca.score > 0 ? 'text-yellow-400' : 'text-accent'}`}>
                                        {(ca.score * 100).toFixed(0)}%
                                    </div>
                                </div>
                                <div className="font-mono">
                                    <div className="text-[9px] text-muted uppercase">Plausible</div>
                                    <div className={`text-lg font-bold ${ca.is_plausible ? 'text-accent' : 'text-danger'}`}>
                                        {ca.is_plausible ? 'YES' : 'NO'}
                                    </div>
                                </div>
                                <div className="font-mono">
                                    <div className="text-[9px] text-muted uppercase">Confidence Cap</div>
                                    <div className="text-lg font-bold text-foreground">
                                        {ca.confidence_cap < 1.0 ? `${(ca.confidence_cap * 100).toFixed(0)}%` : 'NONE'}
                                    </div>
                                </div>
                                <div className="font-mono">
                                    <div className="text-[9px] text-muted uppercase">Was Capped</div>
                                    <div className={`text-lg font-bold ${ca.confidence_was_capped ? 'text-yellow-400' : 'text-accent'}`}>
                                        {ca.confidence_was_capped ? 'YES' : 'NO'}
                                    </div>
                                </div>
                            </div>
                            {ca.contradictions.length > 0 && (
                                <div className="border-t border-grid pt-3 space-y-1">
                                    {ca.contradictions.map((c, i) => (
                                        <div key={i} className="flex items-start gap-2 text-xs font-mono text-danger/80">
                                            <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                                            <span>{c}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ConsoleCard>
                    )}

                    {/* ── Differential Diagnosis ── */}
                    {state.status === 'success' && dd.length > 0 && (
                        <ConsoleCard title="Differential Diagnosis — Feature Attribution" className="border-danger/30">
                            <div className="space-y-4">
                                {dd.slice(0, 5).map((d, i) => (
                                    <div key={i} className="border-b border-grid/30 pb-3 last:border-0">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className={`font-mono text-xs sm:text-sm ${i === 0 ? 'text-accent font-bold' : 'text-foreground'}`}>
                                                {d.condition}
                                            </span>
                                            <span className={`font-mono text-sm font-bold ${i === 0 ? 'text-accent' : 'text-muted'}`}>
                                                {(d.probability * 100).toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="w-full h-1.5 bg-dim overflow-hidden mb-2">
                                            <div
                                                className={`h-full ${i === 0 ? 'bg-accent' : i === 1 ? 'bg-yellow-400' : 'bg-muted'}`}
                                                style={{ width: `${d.probability * 100}%` }}
                                            />
                                        </div>
                                        {/* Feature drivers */}
                                        {d.key_drivers && d.key_drivers.length > 0 && (
                                            <div className="flex flex-wrap gap-2 mt-1">
                                                {d.key_drivers.map((driver, j) => (
                                                    <span
                                                        key={j}
                                                        className="font-mono text-[9px] px-1.5 py-0.5 border border-grid/50 text-muted"
                                                    >
                                                        {driver.feature} <span className="text-accent">+{driver.weight.toFixed(2)}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </ConsoleCard>
                    )}

                    {/* ── Target Evaluation ── */}
                    {state.status === 'success' && te && (
                        <ConsoleCard title="Target Bias Evaluation (Post-Hoc)" className="border-yellow-400/30">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
                                <div className="border border-grid/50 p-3">
                                    <div className="text-[9px] text-muted uppercase mb-1">Target Disease</div>
                                    <div className="text-sm text-foreground">{te.target_disease}</div>
                                </div>
                                <div className="border border-grid/50 p-3">
                                    <div className="text-[9px] text-muted uppercase mb-1">Top Prediction</div>
                                    <div className="text-sm text-accent">{te.top_diagnosis ?? 'N/A'}</div>
                                </div>
                                <div className="border border-grid/50 p-3">
                                    <div className="text-[9px] text-muted uppercase mb-1">Target Matched Top</div>
                                    <div className={`text-sm font-bold ${te.target_matched_top ? 'text-danger' : 'text-accent'}`}>
                                        {te.target_matched_top ? 'YES — BIAS LEAKAGE RISK' : 'NO — INDEPENDENT'}
                                    </div>
                                </div>
                            </div>
                            <div className="text-[10px] text-muted font-mono mt-2 border-t border-grid pt-2">
                                Target disease was stripped before inference and used only for post-hoc evaluation. If matched, the model may still be indirectly biased.
                            </div>
                        </ConsoleCard>
                    )}

                    {/* ── Raw inference output ── */}
                    {state.status === 'success' && r?.inference_output && (
                        <ConsoleCard title="Raw Inference Output" collapsible defaultCollapsed>
                            <pre className="bg-black border border-grid p-3 font-mono text-[10px] sm:text-xs text-green-400 overflow-x-auto max-h-[200px] overflow-y-auto">
                                {JSON.stringify(r.inference_output, null, 2)}
                            </pre>
                            <div className="flex flex-wrap gap-2 mt-2">
                                <DataRow label="Simulation ID" value={<span className="text-accent">{r.simulation_event_id}</span>} />
                                <DataRow label="Inference ID" value={<span className="text-muted">{r.triggered_inference_event_id}</span>} />
                            </div>
                        </ConsoleCard>
                    )}
                </div>
            </div>

            {/* Error Display */}
            {state.status === 'error' && (
                <ConsoleCard title="Simulation Error" className="border-danger mb-6 sm:mb-8">
                    <div className="text-danger font-mono text-xs sm:text-sm p-4 border border-danger bg-danger/5">
                        ERR: {state.errorMessage}
                    </div>
                </ConsoleCard>
            )}

            {/* History */}
            <ConsoleCard title="Simulation History Log" collapsible>
                {state.history.length === 0 ? (
                    <div className="text-muted font-mono text-xs text-center py-6 border border-dashed border-grid">
                        No simulations recorded this session
                    </div>
                ) : (
                    <div className="w-full overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[600px]">
                            <thead>
                                <tr className="border-b border-grid/50 font-mono text-[10px] uppercase text-muted tracking-widest">
                                    <th className="p-2 sm:p-3 font-normal">SIM_ID</th>
                                    <th className="p-2 sm:p-3 font-normal">Target / Type</th>
                                    <th className="p-2 sm:p-3 font-normal">Confidence</th>
                                    <th className="p-2 sm:p-3 font-normal">Contradictions</th>
                                    <th className="p-2 sm:p-3 font-normal">Latency</th>
                                    <th className="p-2 sm:p-3 font-normal">Timestamp</th>
                                </tr>
                            </thead>
                            <tbody className="font-mono text-xs sm:text-sm">
                                {state.history.map((sim, i) => (
                                    <tr key={i} className="border-b border-grid/30 hover:bg-white/[0.02] transition-colors">
                                        <td className="p-2 sm:p-3 text-muted">{sim.id}</td>
                                        <td className="p-2 sm:p-3 text-foreground">{sim.target}</td>
                                        <td className={`p-2 sm:p-3 ${(sim.confidence ?? 0) < 0.5 ? 'text-danger' : 'text-accent'}`}>
                                            {sim.confidence != null ? `${(sim.confidence * 100).toFixed(1)}%` : 'N/A'}
                                        </td>
                                        <td className={`p-2 sm:p-3 ${sim.contradictions > 0 ? 'text-yellow-400' : 'text-muted'}`}>
                                            {sim.contradictions}
                                        </td>
                                        <td className="p-2 sm:p-3 text-muted">{sim.latency}ms</td>
                                        <td className="p-2 sm:p-3 text-muted text-xs">{sim.time}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </ConsoleCard>
        </Container>
    );
}
