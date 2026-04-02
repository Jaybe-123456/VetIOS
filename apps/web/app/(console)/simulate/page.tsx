'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard, DataRow, TerminalTabs } from '@/components/ui/terminal';
import { SimulationRunner } from '@/components/SimulationRunner';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import { Activity, AlertTriangle, CheckCircle2, ShieldAlert, TrendingDown, Settings2, BarChart, ListTree } from 'lucide-react';

type SimulateTab = 'sweep' | 'analytics' | 'step_data';

type StateClassification = 'stable' | 'fragile' | 'metastable' | 'collapsed';

interface PerturbationVector {
    noise: number;
    contradiction: number;
    missingness: number;
    ambiguity: number;
    distribution_shift: number;
}

interface InstabilityMetrics {
    delta_phi: number;
    curvature: number;
    variance_proxy: number;
    divergence: number;
    critical_instability_index: number;
}

interface CapabilityPhi {
    name: string;
    phi: number;
}

interface IntegrityStepResult {
    global_phi: number;
    state: StateClassification;
    collapse_risk: number;
    precliff_detected: boolean;
    instability: InstabilityMetrics;
    capabilities: CapabilityPhi[];
}

interface DifferentialEntry {
    name?: string;
    probability: number;
}

interface SimulationStepResult {
    m: number;
    perturbation_vector: PerturbationVector;
    input_variant: Record<string, unknown>;
    output: Record<string, unknown>;
    integrity: IntegrityStepResult;
}

interface SimulationPayload {
    base_case: Record<string, unknown>;
    collapse_threshold: number | null;
    precliff_regions: number[];
    steps: SimulationStepResult[];
}

interface TargetEvaluation {
    target_disease: string;
    top_diagnosis: string | null;
    target_matched_top: boolean;
}

interface SimResult {
    simulation_event_id: string;
    triggered_inference_event_id: string | null;
    clinical_case_id: string;
    inference_output: Record<string, unknown> | null;
    confidence_score: number | null;
    inference_latency_ms: number;
    contradiction_analysis?: Record<string, unknown> | null;
    differential_diagnosis?: DifferentialEntry[];
    differential_spread?: Record<string, unknown> | null;
    target_evaluation?: TargetEvaluation | null;
    simulation: SimulationPayload;
    request_id: string;
}

interface HistoryEntry {
    id: string;
    collapseThreshold: number | null;
    finalState: StateClassification;
    stepCount: number;
    latency: number;
    time: string;
}

interface SimulationState {
    status: 'idle' | 'simulating' | 'success' | 'error';
    result?: SimResult;
    history: HistoryEntry[];
    errorMessage?: string;
}

export default function AdversarialSimulation() {
    const [activeTab, setActiveTab] = useState<SimulateTab>('sweep');
    const [state, setState] = useState<SimulationState>({
        status: 'idle',
        history: [],
    });

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setState((prev) => ({ ...prev, status: 'simulating', errorMessage: undefined }));

        const formData = new FormData(e.currentTarget);
        const symptoms = String(formData.get('symptoms') ?? '')
            .split(/[,+;\n]/)
            .map((entry) => entry.trim())
            .filter(Boolean);

        const payload = {
            base_case: {
                species: (formData.get('species') as string) || 'canine',
                breed: (formData.get('breed') as string) || null,
                symptoms,
                metadata: {
                    raw_note: (formData.get('rawNote') as string) || null,
                    history: (formData.get('history') as string) || null,
                    presenting_complaint: (formData.get('presentingComplaint') as string) || null,
                    target_disease: (formData.get('targetDisease') as string) || null,
                },
            },
            steps: parseInt((formData.get('steps') as string) || '10', 10),
            mode: ((formData.get('mode') as string) || 'adaptive') as 'linear' | 'adaptive',
            inference: {
                model: (formData.get('model') as string) || 'gpt-4o-mini',
                model_version: (formData.get('model') as string) || 'gpt-4o-mini',
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
                throw new Error((result as unknown as Record<string, string>).error || 'Integrity sweep failed');
            }

            const steps = result.simulation.steps;
            const finalStep = steps[steps.length - 1];
            const newEntry: HistoryEntry = {
                id: result.simulation_event_id.slice(0, 12),
                collapseThreshold: result.simulation.collapse_threshold,
                finalState: finalStep?.integrity.state ?? 'stable',
                stepCount: steps.length,
                latency: result.inference_latency_ms,
                time: new Date().toLocaleTimeString(),
            };

            setState((prev) => ({
                ...prev,
                status: 'success',
                result,
                history: [newEntry, ...prev.history].slice(0, 10),
            }));
            setActiveTab('analytics');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown simulation error';
            setState((prev) => ({ ...prev, status: 'error', errorMessage: message }));
        }
    }

    const result = state.result;
    const steps = result?.simulation.steps ?? [];
    const finalStep = steps[steps.length - 1];
    const minPhi = steps.length === 0
        ? null
        : steps.reduce((min, step) => Math.min(min, step.integrity.global_phi), 1);
    const maxCollapseRisk = steps.length === 0
        ? null
        : steps.reduce((max, step) => Math.max(max, step.integrity.collapse_risk), 0);
    const phiCurve = steps.map((step) => ({
        time: step.m.toFixed(2),
        value: Number(step.integrity.global_phi.toFixed(3)),
    }));
    const collapseRiskCurve = steps.map((step) => ({
        time: step.m.toFixed(2),
        value: Number(step.integrity.collapse_risk.toFixed(3)),
    }));
    const differentialDiagnosis = result?.differential_diagnosis ?? [];

    return (
        <Container>
            <PageHeader
                title="INTEGRITY SWEEP ENGINE"
                description="Adversarial degradation sweeps that map capability loss, metastability, and collapse thresholds across perturbation load."
            />

            <TerminalTabs
                tabs={[
                    { id: 'sweep', label: 'Sweep Config', icon: <Settings2 className="w-4 h-4" /> },
                    { id: 'analytics', label: 'Integrity View', icon: <BarChart className="w-4 h-4" /> },
                    { id: 'step_data', label: 'Step Analysis', icon: <ListTree className="w-4 h-4" /> },
                ]}
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />

            <div className="animate-scale-in">
                {activeTab === 'sweep' && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                        <ConsoleCard title="Configure Sweep" className="border-danger/30 p-0 bg-transparent">
                            <SimulationRunner onSubmit={handleSubmit} isSimulating={state.status === 'simulating'} />
                        </ConsoleCard>

                        <div className="space-y-6">
                            <ConsoleCard title="Sweep History Log" collapsible>
                                {state.history.length === 0 ? (
                                    <div className="text-muted font-mono text-xs text-center py-6 border border-dashed border-grid">
                                        No integrity sweeps recorded this session
                                    </div>
                                ) : (
                                    <div className="w-full overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-grid/50 font-mono text-[10px] uppercase text-muted tracking-widest">
                                                    <th className="p-2 font-normal">SIM_ID</th>
                                                    <th className="p-2 font-normal">Collapse</th>
                                                    <th className="p-2 font-normal">Final State</th>
                                                </tr>
                                            </thead>
                                            <tbody className="font-mono text-xs">
                                                {state.history.map((entry) => (
                                                    <tr key={`${entry.id}-${entry.time}`} className="border-b border-grid/30">
                                                        <td className="p-2 text-muted">{entry.id}</td>
                                                        <td className="p-2 text-danger">
                                                            {entry.collapseThreshold == null ? 'NONE' : entry.collapseThreshold.toFixed(2)}
                                                        </td>
                                                        <td className={`p-2 uppercase ${stateColor(entry.finalState)}`}>{entry.finalState}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </ConsoleCard>

                            {state.status === 'error' && (
                                <ConsoleCard title="Simulation Error" className="border-danger">
                                    <div className="text-danger font-mono text-xs p-4 border border-danger bg-danger/5">
                                        ERR: {state.errorMessage}
                                    </div>
                                </ConsoleCard>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'analytics' && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <ConsoleCard title="Collapse Threshold" className="border-danger/30 text-center">
                                {state.status === 'simulating' ? <LoadingTile label="MAPPING..." /> : result ? <MetricTile value={result.simulation.collapse_threshold == null ? 'NONE' : result.simulation.collapse_threshold.toFixed(2)} caption="m† collapse threshold" danger={result.simulation.collapse_threshold != null} /> : <AwaitingTile />}
                            </ConsoleCard>
                            <ConsoleCard title="Pre-Cliff Zones" className="border-yellow-400/30 text-center">
                                {state.status === 'simulating' ? <LoadingTile label="SCANNING..." /> : result ? <div className="h-24 flex flex-col justify-center"><div className="text-3xl font-mono text-yellow-400 font-bold">{result.simulation.precliff_regions.length}</div><div className="text-[10px] text-muted font-mono uppercase">Metastable zones</div></div> : <AwaitingTile />}
                            </ConsoleCard>
                            <ConsoleCard title="Final State" className="border-danger/30 text-center">
                                {state.status === 'simulating' ? <LoadingTile label="CLASSIFYING..." /> : finalStep ? <div className="h-24 flex flex-col justify-center"><div className={`text-2xl font-mono font-bold uppercase ${stateColor(finalStep.integrity.state)}`}>{finalStep.integrity.state}</div><div className="text-[10px] text-muted font-mono uppercase">{(maxCollapseRisk! * 100).toFixed(1)}% risk</div></div> : <AwaitingTile />}
                            </ConsoleCard>
                        </div>

                        <ConsoleCard title="Integrity Sweep View" className="border-danger/30">
                            {state.status === 'simulating' ? (
                                <div className="h-64 flex items-center justify-center text-danger animate-pulse font-mono text-sm">
                                    <Activity className="w-5 h-5 mr-2 animate-spin" /> RUNNING DEGRADATION SWEEP...
                                </div>
                            ) : result ? (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                        <div className="h-64 border border-grid/50 p-3">
                                            <div className="text-[10px] font-mono uppercase text-muted mb-2">m vs global phi</div>
                                            <TelemetryChart data={phiCurve} color="#00ff9d" />
                                        </div>
                                        <div className="h-64 border border-grid/50 p-3">
                                            <div className="text-[10px] font-mono uppercase text-muted mb-2">m vs collapse risk</div>
                                            <TelemetryChart data={collapseRiskCurve} color="#ff5555" />
                                        </div>
                                    </div>
                                    <div className="w-full overflow-x-auto">
                                        <table className="w-full text-left border-collapse min-w-[600px]">
                                            <thead>
                                                <tr className="border-b border-grid/50 font-mono text-[10px] uppercase text-muted tracking-widest">
                                                    <th className="p-2 font-normal">m</th>
                                                    <th className="p-2 font-normal">phi</th>
                                                    <th className="p-2 font-normal">state</th>
                                                    <th className="p-2 font-normal">CII</th>
                                                </tr>
                                            </thead>
                                            <tbody className="font-mono text-xs">
                                                {steps.map((step) => (
                                                    <tr key={step.m} className="border-b border-grid/30">
                                                        <td className="p-2 text-muted">{step.m.toFixed(2)}</td>
                                                        <td className="p-2 text-accent">{step.integrity.global_phi.toFixed(3)}</td>
                                                        <td className={`p-2 uppercase ${stateColor(step.integrity.state)}`}>{step.integrity.state}</td>
                                                        <td className="p-2 font-mono text-muted">{step.integrity.instability.critical_instability_index.toFixed(3)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ) : (
                                <AwaitingTile />
                            )}
                        </ConsoleCard>
                    </div>
                )}

                {activeTab === 'step_data' && (
                    <div className="space-y-6">
                        {!finalStep ? (
                            <div className="text-muted font-mono text-xs text-center py-12 border border-dashed border-grid">
                                AWAITING SWEEP DATA...
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <ConsoleCard title="Final Step Integrity" className="border-danger/30">
                                        <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                                            <MetricRow label="Global Phi" value={finalStep.integrity.global_phi.toFixed(3)} valueClass="text-accent" />
                                            <MetricRow label="Collapse Risk" value={`${(finalStep.integrity.collapse_risk * 100).toFixed(1)}%`} valueClass="text-danger" />
                                            <MetricRow label="CII Index" value={finalStep.integrity.instability.critical_instability_index.toFixed(3)} valueClass="text-yellow-400" />
                                            <MetricRow label="Divergence" value={finalStep.integrity.instability.divergence.toFixed(3)} valueClass="text-danger" />
                                        </div>
                                    </ConsoleCard>

                                    <ConsoleCard title="Perturbation Vector" className="border-danger/30">
                                        <div className="grid grid-cols-3 gap-3 font-mono text-[10px]">
                                            <MetricRow label="Noise" value={finalStep.perturbation_vector.noise.toFixed(3)} valueClass="text-foreground" />
                                            <MetricRow label="Contradiction" value={finalStep.perturbation_vector.contradiction.toFixed(3)} valueClass="text-foreground" />
                                            <MetricRow label="Sweep m" value={finalStep.m.toFixed(2)} valueClass="text-accent" />
                                        </div>
                                    </ConsoleCard>
                                </div>

                                {differentialDiagnosis.length > 0 && (
                                    <ConsoleCard title="Final Differential Diagnosis" className="border-danger/30">
                                        <div className="space-y-4">
                                            {differentialDiagnosis.slice(0, 3).map((entry, index) => (
                                                <div key={index}>
                                                    <div className="flex justify-between font-mono text-xs mb-1">
                                                        <span className="text-accent">{entry.name}</span>
                                                        <span>{(entry.probability * 100).toFixed(1)}%</span>
                                                    </div>
                                                    <div className="w-full h-1.5 bg-dim">
                                                        <div className="bg-accent h-full" style={{ width: `${entry.probability * 100}%` }} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </ConsoleCard>
                                )}

                                {result?.inference_output && (
                                    <ConsoleCard title="Final Step Raw Output" collapsible defaultCollapsed>
                                        <pre className="bg-black/50 p-3 font-mono text-[10px] text-green-400 overflow-x-auto max-h-[300px]">
                                            {JSON.stringify(result.inference_output, null, 2)}
                                        </pre>
                                    </ConsoleCard>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </Container>
    );
}

function LoadingTile({ label }: { label: string }) {
    return (
        <div className="h-24 flex items-center justify-center text-danger animate-pulse font-mono text-xs sm:text-sm">
            <Activity className="w-4 h-4 sm:w-5 sm:h-5 mr-2 animate-spin" /> {label}
        </div>
    );
}

function AwaitingTile() {
    return (
        <div className="h-24 flex items-center justify-center text-muted text-[10px] font-mono border border-dashed border-danger/20">
            AWAITING SWEEP
        </div>
    );
}

function MetricTile({ value, caption, danger = false }: { value: string; caption: string; danger?: boolean }) {
    return (
        <div className="h-24 flex flex-col justify-center">
            <div className={`text-3xl font-mono font-bold tracking-tighter ${danger ? 'text-danger' : 'text-accent'}`}>
                {value}
            </div>
            <div className="text-[10px] text-muted font-mono uppercase mt-1">{caption}</div>
        </div>
    );
}

function MetricRow({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
    return (
        <div className="border border-grid/40 p-3">
            <div className="text-[9px] text-muted uppercase mb-1">{label}</div>
            <div className={`text-sm font-bold ${valueClass}`}>{value}</div>
        </div>
    );
}

function stateColor(state: StateClassification) {
    if (state === 'collapsed') return 'text-danger';
    if (state === 'metastable') return 'text-yellow-400';
    if (state === 'fragile') return 'text-orange-300';
    return 'text-accent';
}
