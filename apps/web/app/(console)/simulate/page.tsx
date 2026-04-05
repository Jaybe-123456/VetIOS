'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard, TerminalTabs } from '@/components/ui/terminal';
import { SimulationRunner } from '@/components/SimulationRunner';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import { Activity, BarChart, ListTree, Settings2 } from 'lucide-react';

type SimulateTab = 'sweep' | 'analytics' | 'step_data';
type StateClassification = 'stable' | 'fragile' | 'metastable' | 'collapsed';

interface DifferentialEntry {
    condition?: string;
    condition_id?: string;
    probability: number;
    rank?: number;
    determination_basis?: string;
    relationship_to_primary?: { type: 'secondary' | 'complication' | 'co-morbidity' | 'differential'; primary_condition: string };
}

interface StabilityReport {
    global_phi: number;
    collapse_risk: number;
    cii_index: number;
    divergence: number;
    integrity_verdict: StateClassification;
    baseline_target_rank: number;
    clean_clinical_differential: DifferentialEntry[];
    evidence_thresholds: {
        condition_id: string;
        currently_at_rank: number;
        findings_to_reach_rank_1: Array<{
            finding: string;
            finding_type: string;
            probability_delta: number;
            resulting_probability: number;
            resulting_rank: number;
            is_sufficient_alone: boolean;
        }>;
    };
    metastable_conditions: Array<{
        condition_id: string;
        current_rank: number;
        current_probability: number;
        flip_probability: number;
        flip_direction: 'up' | 'down';
        trigger_finding: string;
    }>;
    collapse_conditions: Array<{
        perturbation_vector: string;
        collapse_threshold: number;
        failure_mode: string;
        description: string;
    }>;
    adversarial_differential_at_max_noise: {
        warning: string;
        differential: DifferentialEntry[];
        degradation_vs_baseline: Array<{
            condition_id: string;
            baseline_probability: number;
            adversarial_probability: number;
            rank_change: number;
        }>;
    };
    step_results: Array<{
        step_number: number;
        noise_level: number;
        contradiction_level: number;
        target_condition_rank: number;
        target_condition_probability: number;
        phi: number;
        divergence_from_baseline: number;
        rank_inversions: number;
        collapse_detected: boolean;
        collapse_type?: string;
    }>;
}

interface SimResult {
    simulation_event_id: string;
    inference_latency_ms: number;
    differential_diagnosis?: DifferentialEntry[];
    stability_report?: StabilityReport | null;
    simulation: {
        collapse_threshold: number | null;
        steps: Array<{ integrity: { state: StateClassification } }>;
    };
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
    const [state, setState] = useState<SimulationState>({ status: 'idle', history: [] });

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setState((prev) => ({ ...prev, status: 'simulating', errorMessage: undefined }));

        const formData = new FormData(e.currentTarget);
        const symptoms = String(formData.get('symptoms') ?? '').split(/[,+;\n]/).map((entry) => entry.trim()).filter(Boolean);
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
            if (!res.ok) throw new Error((result as unknown as Record<string, string>).error || 'Adversarial simulation failed');

            const finalState = result.stability_report?.integrity_verdict
                ?? result.simulation.steps[result.simulation.steps.length - 1]?.integrity.state
                ?? 'stable';
            const newEntry: HistoryEntry = {
                id: result.simulation_event_id.slice(0, 12),
                collapseThreshold: result.simulation.collapse_threshold,
                finalState,
                stepCount: result.stability_report?.step_results.length ?? result.simulation.steps.length,
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
    const report = result?.stability_report ?? null;
    const cleanDifferential = report?.clean_clinical_differential ?? result?.differential_diagnosis ?? [];
    const maxNoiseDifferential = report?.adversarial_differential_at_max_noise.differential ?? [];
    const thresholdRows = report?.evidence_thresholds.findings_to_reach_rank_1 ?? [];
    const stabilityCurve = report?.step_results.map((step) => ({ time: step.noise_level.toFixed(2), value: Number(step.target_condition_probability.toFixed(3)) })) ?? [];
    const phiCurve = report?.step_results.map((step) => ({ time: step.noise_level.toFixed(2), value: Number(step.phi.toFixed(3)) })) ?? [];

    return (
        <Container>
            <PageHeader
                title="ADVERSARIAL STABILITY ENGINE"
                description="Separate clean clinical inference from adversarial degradation analysis, evidence thresholds, metastability, and collapse behavior."
            />
            <TerminalTabs
                tabs={[
                    { id: 'sweep', label: 'Sweep Config', icon: <Settings2 className="w-4 h-4" /> },
                    { id: 'analytics', label: 'Stability Report', icon: <BarChart className="w-4 h-4" /> },
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
                                {state.history.length === 0 ? <div className="text-muted font-mono text-xs text-center py-6 border border-dashed border-grid">No adversarial sweeps recorded this session</div> : <HistoryTable history={state.history} />}
                            </ConsoleCard>
                            {state.status === 'error' && <ErrorCard message={state.errorMessage ?? 'Unknown simulation error'} />}
                        </div>
                    </div>
                )}
                {activeTab === 'analytics' && renderAnalytics(state.status, report, cleanDifferential, thresholdRows, stabilityCurve, phiCurve, maxNoiseDifferential)}
                {activeTab === 'step_data' && renderSteps(report)}
            </div>
        </Container>
    );
}

function renderAnalytics(
    status: SimulationState['status'],
    report: StabilityReport | null,
    cleanDifferential: DifferentialEntry[],
    thresholdRows: StabilityReport['evidence_thresholds']['findings_to_reach_rank_1'],
    stabilityCurve: Array<{ time: string; value: number }>,
    phiCurve: Array<{ time: string; value: number }>,
    maxNoiseDifferential: DifferentialEntry[],
) {
    return (
        <div className="space-y-6">
            <ConsoleCard title="Integrity Overview" className="border-danger/30">
                {status === 'simulating' ? <LoadingTile label="RUNNING ADVERSARIAL SWEEP..." /> : report ? (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted">Baseline target rank: {report.baseline_target_rank}</div>
                            <div className={`px-3 py-1 border font-mono text-xs uppercase ${badgeClass(report.integrity_verdict)}`}>{report.integrity_verdict}</div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                            <MetricCard label="Global Phi" value={report.global_phi.toFixed(3)} tone="accent" />
                            <MetricCard label="Collapse Risk" value={`${(report.collapse_risk * 100).toFixed(1)}%`} tone="danger" />
                            <MetricCard label="CII Index" value={report.cii_index.toFixed(3)} tone="warning" />
                            <MetricCard label="Divergence" value={report.divergence.toFixed(3)} tone="muted" />
                        </div>
                    </div>
                ) : <AwaitingTile />}
            </ConsoleCard>

            <ConsoleCard title="Clean clinical output (unperturbed)" className="border-accent/50">
                <DifferentialList entries={cleanDifferential} emptyLabel="Awaiting clean clinical differential" accentClass="bg-accent" />
            </ConsoleCard>

            <ConsoleCard title={`What evidence is needed to confirm ${report?.evidence_thresholds.condition_id ?? 'the target condition'}?`} className="border-yellow-400/30">
                {report ? <ThresholdTable rows={thresholdRows} /> : <AwaitingTile />}
            </ConsoleCard>

            <ConsoleCard title="Perturbation Stability Chart" className="border-danger/30">
                {report ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            <ChartCard title="Target probability vs noise level" data={stabilityCurve} color="#00ff9d" />
                            <ChartCard title="Phi stability vs noise level" data={phiCurve} color="#ffb000" />
                        </div>
                        <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase text-muted">
                            <span className="px-2 py-1 border border-accent text-accent">Green zone: rank 1 maintained</span>
                            <span className="px-2 py-1 border border-yellow-400 text-yellow-400">Amber zone: rank 2-3 drift</span>
                            <span className="px-2 py-1 border border-danger text-danger">Red zone: rank 4+ instability</span>
                            <span className="px-2 py-1 border border-grid text-muted">Noise 0.50 = significant perturbation threshold</span>
                        </div>
                    </div>
                ) : <AwaitingTile />}
            </ConsoleCard>

            <ConsoleCard title="Metastable Conditions" className="border-yellow-400/30">
                {report && report.metastable_conditions.length > 0 ? <MetastableList report={report} /> : <EmptyCopy label="No metastable conditions detected for this sweep." />}
            </ConsoleCard>

            <ConsoleCard title="System output at maximum perturbation (noise=1.0)" className="border-danger/40">
                {report ? (
                    <div className="space-y-4">
                        <div className="p-3 border border-danger bg-danger/10 text-danger font-mono text-xs uppercase">{report.adversarial_differential_at_max_noise.warning}</div>
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <div>
                                <div className="text-[10px] font-mono uppercase text-muted mb-3">Baseline</div>
                                <DifferentialList entries={cleanDifferential} emptyLabel="No clean clinical differential" accentClass="bg-accent" />
                            </div>
                            <div>
                                <div className="text-[10px] font-mono uppercase text-muted mb-3">Adversarial degradation result</div>
                                <DifferentialList entries={maxNoiseDifferential} emptyLabel="No degraded differential" accentClass="bg-danger" />
                            </div>
                        </div>
                        <DegradationTable report={report} />
                    </div>
                ) : <AwaitingTile />}
            </ConsoleCard>
        </div>
    );
}

function renderSteps(report: StabilityReport | null) {
    return (
        <div className="space-y-6">
            {report ? (
                <>
                    <ConsoleCard title="Step-by-step perturbation analysis" className="border-danger/30">
                        <StepTable report={report} />
                    </ConsoleCard>
                    <ConsoleCard title="Collapse Conditions" className="border-danger/30">
                        {report.collapse_conditions.length > 0 ? (
                            <div className="space-y-3">
                                {report.collapse_conditions.map((entry) => (
                                    <div key={`${entry.perturbation_vector}-${entry.failure_mode}`} className="border border-danger/30 p-3 font-mono text-xs">
                                        <div className="flex justify-between gap-4">
                                            <span className="text-danger">{entry.failure_mode}</span>
                                            <span className="text-muted">{entry.perturbation_vector}</span>
                                        </div>
                                        <div className="text-muted mt-2">{entry.description}</div>
                                    </div>
                                ))}
                            </div>
                        ) : <EmptyCopy label="No collapse conditions detected in this sweep." />}
                    </ConsoleCard>
                    <ConsoleCard title="Raw Stability Report" collapsible defaultCollapsed>
                        <pre className="bg-black/50 p-3 font-mono text-[10px] text-green-400 overflow-x-auto max-h-[360px]">{JSON.stringify(report, null, 2)}</pre>
                    </ConsoleCard>
                </>
            ) : <AwaitingTile />}
        </div>
    );
}

function HistoryTable({ history }: { history: HistoryEntry[] }) {
    return (
        <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="border-b border-grid/50 font-mono text-[10px] uppercase text-muted tracking-widest">
                        <th className="p-2 font-normal">SIM_ID</th>
                        <th className="p-2 font-normal">Collapse</th>
                        <th className="p-2 font-normal">Final State</th>
                        <th className="p-2 font-normal">Latency</th>
                    </tr>
                </thead>
                <tbody className="font-mono text-xs">
                    {history.map((entry) => (
                        <tr key={`${entry.id}-${entry.time}`} className="border-b border-grid/30">
                            <td className="p-2 text-muted">{entry.id}</td>
                            <td className="p-2 text-danger">{entry.collapseThreshold == null ? 'NONE' : entry.collapseThreshold.toFixed(2)}</td>
                            <td className={`p-2 uppercase ${stateColor(entry.finalState)}`}>{entry.finalState}</td>
                            <td className="p-2 text-muted">{entry.latency}ms</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ThresholdTable({ rows }: { rows: StabilityReport['evidence_thresholds']['findings_to_reach_rank_1'] }) {
    return (
        <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[720px] text-left border-collapse">
                <thead>
                    <tr className="border-b border-grid/50 font-mono text-[10px] uppercase text-muted tracking-widest">
                        <th className="p-2 font-normal">Finding</th>
                        <th className="p-2 font-normal">Type</th>
                        <th className="p-2 font-normal">Prob. Delta</th>
                        <th className="p-2 font-normal">Result Rank</th>
                        <th className="p-2 font-normal">Sufficient Alone?</th>
                    </tr>
                </thead>
                <tbody className="font-mono text-xs">
                    {rows.map((entry) => (
                        <tr key={entry.finding} className="border-b border-grid/30">
                            <td className="p-2 text-foreground">{entry.finding}</td>
                            <td className="p-2 text-muted">{entry.finding_type}</td>
                            <td className={`p-2 ${entry.probability_delta >= 0 ? 'text-accent' : 'text-danger'}`}>{entry.probability_delta >= 0 ? '+' : ''}{entry.probability_delta.toFixed(3)}</td>
                            <td className="p-2">#{entry.resulting_rank}</td>
                            <td className="p-2">
                                <span className={`px-2 py-1 border ${entry.is_sufficient_alone ? 'border-accent text-accent' : entry.probability_delta > 0 ? 'border-yellow-400 text-yellow-400' : 'border-grid text-muted'}`}>
                                    {entry.is_sufficient_alone ? 'YES' : entry.probability_delta > 0 ? 'HELPFUL' : 'MINOR'}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function MetastableList({ report }: { report: StabilityReport }) {
    return (
        <div className="space-y-3">
            {report.metastable_conditions.map((entry) => (
                <div key={`${entry.condition_id}-${entry.trigger_finding}`} className="border border-grid/40 p-3 font-mono text-xs">
                    <div className="flex justify-between gap-4">
                        <span className="text-foreground">{entry.condition_id}</span>
                        <span className={entry.flip_direction === 'up' ? 'text-accent' : 'text-danger'}>
                            flip {entry.flip_direction} ({(entry.flip_probability * 100).toFixed(0)}%)
                        </span>
                    </div>
                    <div className="text-muted mt-2">
                        current rank #{entry.current_rank} at {(entry.current_probability * 100).toFixed(1)}% - trigger: {entry.trigger_finding}
                    </div>
                </div>
            ))}
        </div>
    );
}

function DegradationTable({ report }: { report: StabilityReport }) {
    return (
        <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[640px] text-left border-collapse">
                <thead>
                    <tr className="border-b border-grid/50 font-mono text-[10px] uppercase text-muted tracking-widest">
                        <th className="p-2 font-normal">Condition</th>
                        <th className="p-2 font-normal">Baseline</th>
                        <th className="p-2 font-normal">Adversarial</th>
                        <th className="p-2 font-normal">Rank Change</th>
                    </tr>
                </thead>
                <tbody className="font-mono text-xs">
                    {report.adversarial_differential_at_max_noise.degradation_vs_baseline.map((entry) => (
                        <tr key={entry.condition_id} className="border-b border-grid/30">
                            <td className="p-2 text-foreground">{entry.condition_id}</td>
                            <td className="p-2 text-accent">{(entry.baseline_probability * 100).toFixed(1)}%</td>
                            <td className="p-2 text-danger">{(entry.adversarial_probability * 100).toFixed(1)}%</td>
                            <td className={`p-2 ${entry.rank_change > 0 ? 'text-danger' : entry.rank_change < 0 ? 'text-accent' : 'text-muted'}`}>
                                {entry.rank_change > 0 ? '+' : ''}{entry.rank_change}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function StepTable({ report }: { report: StabilityReport }) {
    return (
        <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[760px] text-left border-collapse">
                <thead>
                    <tr className="border-b border-grid/50 font-mono text-[10px] uppercase text-muted tracking-widest">
                        <th className="p-2 font-normal">Step</th>
                        <th className="p-2 font-normal">Noise</th>
                        <th className="p-2 font-normal">Contradiction</th>
                        <th className="p-2 font-normal">Target Rank</th>
                        <th className="p-2 font-normal">Target Prob.</th>
                        <th className="p-2 font-normal">Phi</th>
                        <th className="p-2 font-normal">Rank Inversions</th>
                        <th className="p-2 font-normal">Collapse</th>
                    </tr>
                </thead>
                <tbody className="font-mono text-xs">
                    {report.step_results.map((step) => (
                        <tr key={step.step_number} className="border-b border-grid/30">
                            <td className="p-2 text-muted">{step.step_number}</td>
                            <td className="p-2">{step.noise_level.toFixed(2)}</td>
                            <td className="p-2">{step.contradiction_level.toFixed(2)}</td>
                            <td className="p-2">#{step.target_condition_rank}</td>
                            <td className="p-2 text-accent">{(step.target_condition_probability * 100).toFixed(1)}%</td>
                            <td className="p-2">{step.phi.toFixed(3)}</td>
                            <td className="p-2">{step.rank_inversions}</td>
                            <td className={`p-2 uppercase ${step.collapse_detected ? 'text-danger' : 'text-accent'}`}>
                                {step.collapse_detected ? step.collapse_type ?? 'yes' : 'no'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function DifferentialList({ entries, emptyLabel, accentClass }: { entries: DifferentialEntry[]; emptyLabel: string; accentClass: string }) {
    if (entries.length === 0) return <EmptyCopy label={emptyLabel} />;
    return (
        <div className="space-y-4">
            {entries.slice(0, 5).map((entry, index) => {
                const label = entry.condition ?? entry.condition_id ?? `Differential ${index + 1}`;
                return (
                    <div key={`${label}-${index}`}>
                        <div className="flex justify-between font-mono text-xs mb-1 gap-4">
                            <span className="text-foreground">{label}</span>
                            <span>{(entry.probability * 100).toFixed(1)}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-dim">
                            <div className={`${accentClass} h-full`} style={{ width: `${entry.probability * 100}%` }} />
                        </div>
                        {entry.relationship_to_primary && <div className="text-[10px] font-mono text-muted mt-2 uppercase">{entry.relationship_to_primary.type} to {entry.relationship_to_primary.primary_condition}</div>}
                    </div>
                );
            })}
        </div>
    );
}

function ChartCard({ title, data, color }: { title: string; data: Array<{ time: string; value: number }>; color: string }) {
    return (
        <div className="h-64 border border-grid/50 p-3">
            <div className="text-[10px] font-mono uppercase text-muted mb-2">{title}</div>
            <TelemetryChart data={data} color={color} />
        </div>
    );
}

function ErrorCard({ message }: { message: string }) {
    return (
        <ConsoleCard title="Simulation Error" className="border-danger">
            <div className="text-danger font-mono text-xs p-4 border border-danger bg-danger/5">ERR: {message}</div>
        </ConsoleCard>
    );
}

function LoadingTile({ label }: { label: string }) {
    return <div className="h-24 flex items-center justify-center text-danger animate-pulse font-mono text-xs sm:text-sm"><Activity className="w-4 h-4 sm:w-5 sm:h-5 mr-2 animate-spin" /> {label}</div>;
}

function AwaitingTile() {
    return <div className="h-24 flex items-center justify-center text-muted text-[10px] font-mono border border-dashed border-grid">AWAITING ADVERSARIAL REPORT</div>;
}

function EmptyCopy({ label }: { label: string }) {
    return <div className="text-muted font-mono text-xs border border-dashed border-grid p-4">{label}</div>;
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'accent' | 'danger' | 'warning' | 'muted' }) {
    const className = tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-yellow-400' : 'text-foreground';
    return (
        <div className="border border-grid/40 p-4">
            <div className="text-[9px] text-muted uppercase mb-2 font-mono">{label}</div>
            <div className={`text-3xl font-mono font-bold tracking-tighter ${className}`}>{value}</div>
        </div>
    );
}

function badgeClass(state: StateClassification) {
    if (state === 'collapsed') return 'border-danger text-danger';
    if (state === 'metastable') return 'border-yellow-400 text-yellow-400';
    if (state === 'fragile') return 'border-orange-300 text-orange-300';
    return 'border-accent text-accent';
}

function stateColor(state: StateClassification) {
    if (state === 'collapsed') return 'text-danger';
    if (state === 'metastable') return 'text-yellow-400';
    if (state === 'fragile') return 'text-orange-300';
    return 'text-accent';
}
