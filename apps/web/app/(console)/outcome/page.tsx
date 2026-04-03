'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard, DataRow, TerminalTabs } from '@/components/ui/terminal';
import { OutcomeAttachForm } from '@/components/OutcomeAttachForm';
import { extractUuidFromText } from '@/lib/utils/uuid';
import { ArrowRight, ArrowDown, BrainCircuit, Activity, Database, GitMerge, CheckCircle2, FlaskConical, MonitorDot } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type PipelineStage = 'idle' | 'prediction' | 'outcome_injected' | 'weights_updated' | 'telemetry_logged';
type OutcomeTab = 'injection' | 'monitor';

interface EvalResult {
    id: string;
    calibration_error: number | null;
    drift_score: number | null;
    outcome_alignment_delta: number | null;
    calibrated_confidence: number | null;
    epistemic_uncertainty: number | null;
    aleatoric_uncertainty: number | null;
}

interface OutcomeState {
    status: 'idle' | 'submitting' | 'success' | 'error';
    pipelineStage: PipelineStage;
    outcomeEventId?: string;
    linkedInferenceId?: string;
    evaluation?: EvalResult;
    errorMessage?: string;
}

// ── Page Component ───────────────────────────────────────────────────────────

export default function OutcomeLearning() {
    const [activeTab, setActiveTab] = useState<OutcomeTab>('injection');
    const [state, setState] = useState<OutcomeState>({
        status: 'idle',
        pipelineStage: 'idle',
    });

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();

        const formData = new FormData(e.currentTarget);
        const inferenceEventId = extractUuidFromText(formData.get('eventId'));
        if (!inferenceEventId) {
            setState({
                status: 'error',
                pipelineStage: 'idle',
                errorMessage: 'Inference Event ID must be a valid UUID. Paste the canonical inference ID or an evt_inference_<uuid> value so VetIOS can extract it.',
            });
            return;
        }

        const data = {
            inference_event_id: inferenceEventId,
            outcome: {
                type: 'clinical_diagnosis',
                payload: {
                    actual_diagnosis: formData.get('actualDiagnosis'),
                    notes: formData.get('notes'),
                },
                timestamp: new Date().toISOString(),
            }
        };

        setActiveTab('monitor'); // Auto-switch to monitor tab
        setState({ status: 'submitting', pipelineStage: 'prediction' });
        await delay(400);

        // Stage 2: Submitting outcome
        setState(prev => ({ ...prev, pipelineStage: 'outcome_injected' }));

        try {
            const res = await fetch('/api/outcome', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json();

            if (!res.ok) {
                throw new Error(result.error || 'Failed to attach outcome');
            }

            // Stage 3: Weights updated (evaluation computed)
            setState(prev => ({
                ...prev,
                pipelineStage: 'weights_updated',
                outcomeEventId: result.outcome_event_id,
                linkedInferenceId: result.linked_inference_event_id,
                evaluation: result.evaluation || null,
            }));
            await delay(500);

            // Stage 4: Telemetry logged
            setState(prev => ({
                ...prev,
                status: 'success',
                pipelineStage: 'telemetry_logged',
            }));
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            setState({ status: 'error', pipelineStage: 'idle', errorMessage: msg });
        }
    }

    return (
        <Container>
            <PageHeader
                title="OUTCOME LEARNING HUB"
                description="Attach ground truth to inference events to calculate calibration curves and reinforce the base model parameters."
            />

            <TerminalTabs
                tabs={[
                    { id: 'injection', label: 'Injection', icon: <FlaskConical className="w-4 h-4" /> },
                    { id: 'monitor', label: 'Monitor', icon: <MonitorDot className="w-4 h-4" /> },
                ]}
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />

            {activeTab === 'injection' ? (
                <div className="max-w-3xl mx-auto animate-scale-in">
                    <ConsoleCard title="Inject Ground Truth" className="border-accent/30 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
                        <OutcomeAttachForm onSubmit={handleSubmit} isSubmitting={state.status === 'submitting'} />
                    </ConsoleCard>
                </div>
            ) : (
                <div className="space-y-6 sm:space-y-8 animate-scale-in">
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 sm:gap-8">
                        <ConsoleCard title="Reinforcement Pipeline Activity">
                            {state.status === 'idle' && (
                                <div className="text-muted font-mono text-xs sm:text-sm grid place-items-center h-24 sm:h-32 border border-dashed border-grid">
                                    AWAITING GROUND TRUTH INJECTION DOCK
                                </div>
                            )}
                            {state.status === 'submitting' && (
                                <div className="text-accent font-mono text-xs sm:text-sm flex items-center justify-center gap-3 h-24 sm:h-32 border border-accent bg-accent/5 p-4 animate-pulse">
                                    <Activity className="w-5 h-5 animate-spin" />
                                    {state.pipelineStage === 'prediction' && 'VALIDATING INFERENCE EVENT...'}
                                    {state.pipelineStage === 'outcome_injected' && 'INJECTING OUTCOME & COMPUTING METRICS...'}
                                    {state.pipelineStage === 'weights_updated' && 'UPDATING WEIGHT GRADIENTS...'}
                                </div>
                            )}
                            {state.status === 'success' && state.evaluation && (
                                <div className="space-y-4">
                                    <div className="p-4 border border-accent bg-accent/5 font-mono">
                                        <div className="text-accent mb-2 font-bold tracking-widest uppercase flex items-center gap-2 text-xs sm:text-sm">
                                            <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
                                            Signal Accepted — Evaluation Complete
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 sm:gap-4 text-[10px] sm:text-xs mt-4">
                                            <MetricCell
                                                label="Calibration Error"
                                                value={state.evaluation.calibration_error != null
                                                    ? `${(state.evaluation.calibration_error * 100).toFixed(2)}%`
                                                    : 'N/A'}
                                                accent={state.evaluation.calibration_error != null && state.evaluation.calibration_error > 0.15 ? 'danger' : 'accent'}
                                            />
                                            <MetricCell
                                                label="Drift Score"
                                                value={state.evaluation.drift_score != null
                                                    ? state.evaluation.drift_score.toFixed(3)
                                                    : 'Insufficient data'}
                                                accent={state.evaluation.drift_score != null && state.evaluation.drift_score > 0.5 ? 'danger' : 'muted'}
                                            />
                                            <MetricCell
                                                label="Outcome Alignment"
                                                value={state.evaluation.outcome_alignment_delta != null
                                                    ? `Δ ${(state.evaluation.outcome_alignment_delta * 100).toFixed(1)}%`
                                                    : 'N/A'}
                                                accent="accent"
                                            />
                                            <MetricCell
                                                label="Calibrated Confidence"
                                                value={state.evaluation.calibrated_confidence != null
                                                    ? `${(state.evaluation.calibrated_confidence * 100).toFixed(1)}%`
                                                    : 'N/A'}
                                                accent="accent"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                            {state.status === 'success' && !state.evaluation && (
                                <div className="space-y-3">
                                    <div className="p-4 border border-accent bg-accent/5 font-mono text-xs sm:text-sm text-accent">
                                        Outcome attached successfully. Evaluation metrics require a matching inference record in the database.
                                    </div>
                                    <DataRow label="Outcome Event" value={<span className="text-accent">{state.outcomeEventId}</span>} />
                                    <DataRow label="Linked Inference" value={<span className="text-muted">{state.linkedInferenceId}</span>} />
                                </div>
                            )}
                            {state.status === 'error' && (
                                <div className="text-danger font-mono text-xs sm:text-sm border border-danger p-4 bg-danger/5">
                                    ERR: {state.errorMessage}
                                </div>
                            )}
                        </ConsoleCard>

                        {/* Event references / Uncertainty shown side-by-side on desktop */}
                        <div className="space-y-6">
                            {state.status === 'success' && state.evaluation && (
                                <>
                                    {(state.evaluation.epistemic_uncertainty != null || state.evaluation.aleatoric_uncertainty != null) && (
                                        <ConsoleCard title="Uncertainty Decomposition" className="border-grid">
                                            <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                                                <div>
                                                    <div className="text-muted uppercase text-[10px] mb-1">Epistemic (Knowledge Gap)</div>
                                                    <UncertaintyBar value={state.evaluation.epistemic_uncertainty ?? 0} />
                                                </div>
                                                <div>
                                                    <div className="text-muted uppercase text-[10px] mb-1">Aleatoric (Inherent Noise)</div>
                                                    <UncertaintyBar value={state.evaluation.aleatoric_uncertainty ?? 0} />
                                                </div>
                                            </div>
                                        </ConsoleCard>
                                    )}

                                    <ConsoleCard title="Event References" className="border-grid">
                                        <DataRow label="Outcome Event" value={<span className="text-accent">{state.outcomeEventId}</span>} />
                                        <DataRow label="Linked Inference" value={<span className="text-muted">{state.linkedInferenceId}</span>} />
                                        <DataRow label="Evaluation ID" value={<span className="text-muted">{state.evaluation.id}</span>} />
                                    </ConsoleCard>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Pipeline Visual is now part of Monitor tab */}
                    <PipelineVisual stage={state.pipelineStage} />
                </div>
            )}
        </Container>
    );
}

// ── Pipeline Visual Component ────────────────────────────────────────────────

const STAGES: { key: PipelineStage; label: string; icon: React.ReactNode; shape: string }[] = [
    { key: 'prediction', label: 'Prediction', icon: <BrainCircuit className="w-5 h-5 sm:w-6 sm:h-6" />, shape: 'rounded-full' },
    { key: 'outcome_injected', label: 'Outcome Injected', icon: <GitMerge className="w-5 h-5 sm:w-6 sm:h-6" />, shape: 'rounded-full' },
    { key: 'weights_updated', label: 'Weights Updated', icon: <Activity className="w-5 h-5 sm:w-6 sm:h-6" />, shape: 'rounded-[4px]' },
    { key: 'telemetry_logged', label: 'Telemetry Logged', icon: <Database className="w-5 h-5 sm:w-6 sm:h-6" />, shape: 'rounded-sm' },
];

function PipelineVisual({ stage }: { stage: PipelineStage }) {
    const stageIndex = STAGES.findIndex(s => s.key === stage);

    return (
        <ConsoleCard title="Runtime Feedback Path" className="bg-background">
            <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-0 justify-between p-2 sm:p-6 overflow-x-auto">
                {STAGES.map((s, i) => {
                    const isCompleted = stageIndex > i;
                    const isActive = stageIndex === i;
                    const isPending = stageIndex < i;

                    return (
                        <div key={s.key} className="flex flex-col sm:flex-row items-center gap-3 sm:gap-0">
                            <div className="flex flex-col items-center gap-2">
                                <div className={`
                                    w-11 h-11 sm:w-12 sm:h-12 ${s.shape} border flex items-center justify-center transition-all duration-500
                                    ${isCompleted
                                        ? 'border-accent bg-accent/15 text-accent'
                                        : isActive
                                            ? 'border-accent bg-accent/10 text-accent outline outline-4 outline-accent/20 animate-pulse-glow'
                                            : 'border-grid bg-dim text-muted'
                                    }
                                `}>
                                    {isCompleted ? <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" /> : s.icon}
                                </div>
                                <span className={`font-mono text-[10px] sm:text-xs uppercase text-center max-w-[90px] sm:max-w-none
                                    ${isCompleted ? 'text-accent' : isActive ? 'text-accent font-bold' : 'text-muted'}
                                `}>
                                    {s.label}
                                </span>
                            </div>
                            {i < STAGES.length - 1 && (
                                <>
                                    <ArrowRight className={`hidden sm:block mx-2 sm:mx-4 w-4 h-4 transition-colors duration-300
                                        ${stageIndex > i ? 'text-accent' : 'text-muted/40'}
                                    `} />
                                    <ArrowDown className={`block sm:hidden w-4 h-4 transition-colors duration-300
                                        ${stageIndex > i ? 'text-accent' : 'text-muted/40'}
                                    `} />
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </ConsoleCard>
    );
}

// ── Helper Components ────────────────────────────────────────────────────────

function MetricCell({ label, value, accent }: { label: string; value: string; accent: string }) {
    return (
        <div className={`border border-${accent}/30 p-2 sm:p-3`}>
            <div className="text-muted uppercase mb-1 text-[9px] sm:text-[10px]">{label}</div>
            <div className={`text-${accent} text-xs sm:text-sm font-bold`}>{value}</div>
        </div>
    );
}

function UncertaintyBar({ value }: { value: number }) {
    const pct = Math.min(100, Math.max(0, value * 100));
    const color = pct > 60 ? 'bg-danger' : pct > 30 ? 'bg-yellow-400' : 'bg-accent';
    return (
        <div className="space-y-1">
            <div className="w-full h-1.5 bg-dim overflow-hidden">
                <div className={`h-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
            </div>
            <div className="text-right text-[10px] text-muted">{pct.toFixed(1)}%</div>
        </div>
    );
}

function delay(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}
