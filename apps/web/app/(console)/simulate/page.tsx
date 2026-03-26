'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard, DataRow } from '@/components/ui/terminal';
import { SimulationRunner } from '@/components/SimulationRunner';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import { Activity, AlertTriangle, CheckCircle2, ShieldAlert, TrendingDown } from 'lucide-react';

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

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 sm:gap-8 xl:gap-12 mb-8 sm:mb-12">
                <div className="xl:col-span-1 xl:border-r xl:border-grid xl:pr-12">
                    <ConsoleCard title="Configure Sweep" className="border-danger/30 p-0 bg-transparent">
                        <SimulationRunner onSubmit={handleSubmit} isSimulating={state.status === 'simulating'} />
                    </ConsoleCard>
                </div>

                <div className="xl:col-span-2 space-y-4 sm:space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                        <ConsoleCard title="Collapse Threshold" className="border-danger/30">
                            {state.status === 'simulating' ? (
                                <LoadingTile label="MAPPING..." />
                            ) : result ? (
                                <MetricTile
                                    value={result.simulation.collapse_threshold == null ? 'NONE' : result.simulation.collapse_threshold.toFixed(2)}
                                    caption={result.simulation.collapse_threshold == null ? 'No collapse detected in sweep' : 'm† collapse threshold'}
                                    danger={result.simulation.collapse_threshold != null}
                                />
                            ) : (
                                <AwaitingTile />
                            )}
                        </ConsoleCard>

                        <ConsoleCard title="Pre-Cliff Zones" className="border-yellow-400/30">
                            {state.status === 'simulating' ? (
                                <LoadingTile label="SCANNING..." />
                            ) : result ? (
                                <div className="h-24 flex flex-col justify-center gap-2">
                                    <div className="text-3xl font-mono text-yellow-400 font-bold tracking-tighter">
                                        {result.simulation.precliff_regions.length}
                                    </div>
                                    <div className="text-[10px] text-muted font-mono uppercase">
                                        {result.simulation.precliff_regions.length === 0
                                            ? 'No metastable zones detected'
                                            : result.simulation.precliff_regions.map((value) => value.toFixed(2)).join(', ')}
                                    </div>
                                </div>
                            ) : (
                                <AwaitingTile />
                            )}
                        </ConsoleCard>

                        <ConsoleCard title="Final State" className="border-danger/30">
                            {state.status === 'simulating' ? (
                                <LoadingTile label="CLASSIFYING..." />
                            ) : finalStep ? (
                                <div className="h-24 flex flex-col justify-center gap-2">
                                    <div className={`text-2xl font-mono font-bold uppercase ${stateColor(finalStep.integrity.state)}`}>
                                        {finalStep.integrity.state}
                                    </div>
                                    <div className="text-[10px] text-muted font-mono uppercase">
                                        Max collapse risk {((maxCollapseRisk ?? 0) * 100).toFixed(1)}%
                                    </div>
                                </div>
                            ) : (
                                <AwaitingTile />
                            )}
                        </ConsoleCard>
                    </div>

                    <ConsoleCard title="Integrity Sweep View" className="border-danger/30">
                        {state.status === 'simulating' ? (
                            <div className="h-64 flex items-center justify-center text-danger animate-pulse font-mono text-sm">
                                <Activity className="w-5 h-5 mr-2 animate-spin" /> RUNNING DEGRADATION SWEEP...
                            </div>
                        ) : result ? (
                            <div className="space-y-4">
                                <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase">
                                    <span className="border border-grid px-2 py-1 text-muted">
                                        Steps {steps.length}
                                    </span>
                                    <span className="border border-grid px-2 py-1 text-accent">
                                        Min Phi {minPhi?.toFixed(3) ?? 'N/A'}
                                    </span>
                                    <span className="border border-grid px-2 py-1 text-danger">
                                        Collapse {result.simulation.collapse_threshold == null ? 'none' : result.simulation.collapse_threshold.toFixed(2)}
                                    </span>
                                    {result.simulation.precliff_regions.map((value) => (
                                        <span key={value} className="border border-yellow-400/50 px-2 py-1 text-yellow-400">
                                            Pre-cliff {value.toFixed(2)}
                                        </span>
                                    ))}
                                </div>

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
                                    <table className="w-full text-left border-collapse min-w-[760px]">
                                        <thead>
                                            <tr className="border-b border-grid/50 font-mono text-[10px] uppercase text-muted tracking-widest">
                                                <th className="p-2 font-normal">m</th>
                                                <th className="p-2 font-normal">phi</th>
                                                <th className="p-2 font-normal">state</th>
                                                <th className="p-2 font-normal">delta_phi</th>
                                                <th className="p-2 font-normal">CII</th>
                                                <th className="p-2 font-normal">pre-cliff</th>
                                            </tr>
                                        </thead>
                                        <tbody className="font-mono text-xs sm:text-sm">
                                            {steps.map((step) => (
                                                <tr key={step.m} className="border-b border-grid/30">
                                                    <td className="p-2 text-muted">{step.m.toFixed(2)}</td>
                                                    <td className="p-2 text-accent">{step.integrity.global_phi.toFixed(3)}</td>
                                                    <td className={`p-2 uppercase ${stateColor(step.integrity.state)}`}>{step.integrity.state}</td>
                                                    <td className={`p-2 ${step.integrity.instability.delta_phi < -0.15 ? 'text-danger' : 'text-muted'}`}>
                                                        {step.integrity.instability.delta_phi.toFixed(3)}
                                                    </td>
                                                    <td className={`${step.integrity.instability.critical_instability_index > 0.3 ? 'text-yellow-400' : 'text-muted'} p-2`}>
                                                        {step.integrity.instability.critical_instability_index.toFixed(3)}
                                                    </td>
                                                    <td className={`p-2 ${step.integrity.precliff_detected ? 'text-yellow-400' : 'text-muted'}`}>
                                                        {step.integrity.precliff_detected ? 'YES' : 'NO'}
                                                    </td>
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

                    {finalStep && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                            <ConsoleCard title="Final Step Integrity" className="border-danger/30">
                                <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                                    <MetricRow label="Global Phi" value={finalStep.integrity.global_phi.toFixed(3)} valueClass="text-accent" />
                                    <MetricRow label="Collapse Risk" value={`${(finalStep.integrity.collapse_risk * 100).toFixed(1)}%`} valueClass="text-danger" />
                                    <MetricRow label="Delta Phi" value={finalStep.integrity.instability.delta_phi.toFixed(3)} valueClass={finalStep.integrity.instability.delta_phi < -0.15 ? 'text-danger' : 'text-foreground'} />
                                    <MetricRow label="Curvature" value={finalStep.integrity.instability.curvature.toFixed(3)} valueClass={finalStep.integrity.instability.curvature < -0.05 ? 'text-yellow-400' : 'text-foreground'} />
                                    <MetricRow label="Variance Proxy" value={finalStep.integrity.instability.variance_proxy.toFixed(3)} valueClass="text-foreground" />
                                    <MetricRow label="Divergence" value={finalStep.integrity.instability.divergence.toFixed(3)} valueClass={finalStep.integrity.instability.divergence > 0.2 ? 'text-danger' : 'text-foreground'} />
                                </div>
                            </ConsoleCard>

                            <ConsoleCard title="Perturbation Vector" className="border-danger/30">
                                <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                                    <MetricRow label="Noise" value={finalStep.perturbation_vector.noise.toFixed(3)} valueClass="text-foreground" />
                                    <MetricRow label="Contradiction" value={finalStep.perturbation_vector.contradiction.toFixed(3)} valueClass="text-foreground" />
                                    <MetricRow label="Missingness" value={finalStep.perturbation_vector.missingness.toFixed(3)} valueClass="text-foreground" />
                                    <MetricRow label="Ambiguity" value={finalStep.perturbation_vector.ambiguity.toFixed(3)} valueClass="text-foreground" />
                                    <MetricRow label="Distribution Shift" value={finalStep.perturbation_vector.distribution_shift.toFixed(3)} valueClass="text-foreground" />
                                    <MetricRow label="Sweep m" value={finalStep.m.toFixed(2)} valueClass="text-accent" />
                                </div>
                            </ConsoleCard>
                        </div>
                    )}

                    {result?.target_evaluation && (
                        <ConsoleCard title="Target Evaluation" className="border-yellow-400/30">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
                                <MetricRow label="Target Disease" value={result.target_evaluation.target_disease} valueClass="text-foreground" />
                                <MetricRow label="Top Diagnosis" value={result.target_evaluation.top_diagnosis ?? 'N/A'} valueClass="text-accent" />
                                <MetricRow
                                    label="Matched Top"
                                    value={result.target_evaluation.target_matched_top ? 'YES' : 'NO'}
                                    valueClass={result.target_evaluation.target_matched_top ? 'text-danger' : 'text-accent'}
                                />
                            </div>
                        </ConsoleCard>
                    )}

                    {differentialDiagnosis.length > 0 && (
                        <ConsoleCard title="Final Differential Diagnosis" className="border-danger/30">
                            <div className="space-y-3">
                                {differentialDiagnosis.slice(0, 5).map((entry, index) => (
                                    <div key={`${entry.name ?? 'dx'}-${index}`} className="border-b border-grid/30 pb-3 last:border-0">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className={`font-mono text-sm ${index === 0 ? 'text-accent font-bold' : 'text-foreground'}`}>
                                                {entry.name ?? 'Unknown'}
                                            </span>
                                            <span className={`font-mono text-sm ${index === 0 ? 'text-accent' : 'text-muted'}`}>
                                                {(entry.probability * 100).toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="w-full h-1.5 bg-dim overflow-hidden">
                                            <div
                                                className={`${index === 0 ? 'bg-accent' : index === 1 ? 'bg-yellow-400' : 'bg-muted'} h-full`}
                                                style={{ width: `${entry.probability * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ConsoleCard>
                    )}

                    {result?.inference_output && (
                        <ConsoleCard title="Final Step Output" collapsible defaultCollapsed>
                            <pre className="bg-black border border-grid p-3 font-mono text-[10px] sm:text-xs text-green-400 overflow-x-auto max-h-[260px] overflow-y-auto">
                                {JSON.stringify(result.inference_output, null, 2)}
                            </pre>
                            <div className="flex flex-wrap gap-2 mt-2">
                                <DataRow label="Simulation ID" value={<span className="text-accent">{result.simulation_event_id}</span>} />
                                <DataRow label="Clinical Case" value={<span className="text-muted">{result.clinical_case_id}</span>} />
                            </div>
                        </ConsoleCard>
                    )}
                </div>
            </div>

            {state.status === 'error' && (
                <ConsoleCard title="Simulation Error" className="border-danger mb-6 sm:mb-8">
                    <div className="text-danger font-mono text-xs sm:text-sm p-4 border border-danger bg-danger/5">
                        ERR: {state.errorMessage}
                    </div>
                </ConsoleCard>
            )}

            <ConsoleCard title="Sweep History Log" collapsible>
                {state.history.length === 0 ? (
                    <div className="text-muted font-mono text-xs text-center py-6 border border-dashed border-grid">
                        No integrity sweeps recorded this session
                    </div>
                ) : (
                    <div className="w-full overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead>
                                <tr className="border-b border-grid/50 font-mono text-[10px] uppercase text-muted tracking-widest">
                                    <th className="p-2 sm:p-3 font-normal">SIM_ID</th>
                                    <th className="p-2 sm:p-3 font-normal">Collapse m†</th>
                                    <th className="p-2 sm:p-3 font-normal">Final State</th>
                                    <th className="p-2 sm:p-3 font-normal">Steps</th>
                                    <th className="p-2 sm:p-3 font-normal">Latency</th>
                                    <th className="p-2 sm:p-3 font-normal">Timestamp</th>
                                </tr>
                            </thead>
                            <tbody className="font-mono text-xs sm:text-sm">
                                {state.history.map((entry) => (
                                    <tr key={`${entry.id}-${entry.time}`} className="border-b border-grid/30">
                                        <td className="p-2 sm:p-3 text-muted">{entry.id}</td>
                                        <td className="p-2 sm:p-3 text-danger">
                                            {entry.collapseThreshold == null ? 'NONE' : entry.collapseThreshold.toFixed(2)}
                                        </td>
                                        <td className={`p-2 sm:p-3 uppercase ${stateColor(entry.finalState)}`}>{entry.finalState}</td>
                                        <td className="p-2 sm:p-3 text-foreground">{entry.stepCount}</td>
                                        <td className="p-2 sm:p-3 text-muted">{entry.latency}ms</td>
                                        <td className="p-2 sm:p-3 text-muted text-xs">{entry.time}</td>
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
