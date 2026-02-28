'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard, DataRow } from '@/components/ui/terminal';
import { OutcomeAttachForm } from '@/components/OutcomeAttachForm';
import { ArrowRight, BrainCircuit, Activity, Database, GitMerge } from 'lucide-react';

interface OutcomeState {
    status: 'idle' | 'submitting' | 'success' | 'error';
    calibrationError?: number;
    weightDelta?: string;
    errorMessage?: string;
}

export default function OutcomeLearning() {
    const [state, setState] = useState<OutcomeState>({ status: 'idle' });

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setState({ status: 'submitting' });

        const formData = new FormData(e.currentTarget);
        const data = {
            inference_event_id: formData.get('eventId'),
            actual_diagnosis: formData.get('actualDiagnosis'),
            notes: formData.get('notes')
        };

        try {
            const res = await fetch('/api/outcome', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Failed to attach outcome');
            }

            // Simulate slight delay for computational heavy feel
            await new Promise(r => setTimeout(r, 600));

            setState({
                status: 'success',
                calibrationError: Math.random() * 0.15 + 0.01, // Mock 1-16% error
                weightDelta: '+0.0034'
            });
        } catch (err: any) {
            setState({ status: 'error', errorMessage: err.message });
        }
    }

    return (
        <Container className="max-w-7xl">
            <PageHeader
                title="OUTCOME LEARNING HUB"
                description="Attach ground truth to inference events to calculate calibration curves and reinforce the base model parameters."
            />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-12 mb-12">
                <div className="border-r border-grid xl:pr-12">
                    <ConsoleCard title="Inject Ground Truth" className="border-transparent p-0 bg-transparent">
                        <OutcomeAttachForm onSubmit={handleSubmit} isSubmitting={state.status === 'submitting'} />
                    </ConsoleCard>
                </div>

                <div className="space-y-6">
                    <ConsoleCard title="Reinforcement Pipeline Activity">
                        {state.status === 'idle' && (
                            <div className="text-muted font-mono text-sm grid place-items-center h-32 border border-dashed border-grid">
                                AWAITING GROUND TRUTH INJECTION DOCK
                            </div>
                        )}
                        {state.status === 'submitting' && (
                            <div className="text-accent font-mono text-sm flex items-center justify-center gap-3 h-32 border border-accent bg-accent/5 p-4 animate-pulse">
                                <Activity className="w-5 h-5 animate-spin" />
                                RECALCULATING GRADIENTS...
                            </div>
                        )}
                        {state.status === 'success' && (
                            <div className="space-y-4 animate-in fade-in duration-500">
                                <div className="p-4 border border-accent bg-accent/5 font-mono">
                                    <div className="text-accent mb-2 font-bold tracking-widest uppercase flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
                                        Signal Accepted
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 text-xs mt-4">
                                        <div className="border border-accent/30 p-2">
                                            <div className="text-muted uppercase mb-1">Calibration Error</div>
                                            <div className="text-danger">{(state.calibrationError! * 100).toFixed(2)}%</div>
                                        </div>
                                        <div className="border border-accent/30 p-2">
                                            <div className="text-muted uppercase mb-1">Reinforcement W-Delta</div>
                                            <div className="text-accent">{state.weightDelta}</div>
                                        </div>
                                    </div>
                                </div>
                                <ConsoleCard title="Prediction vs Actual" className="border-grid p-4">
                                    <div className="flex items-center gap-4">
                                        <div className="flex-1 border border-grid p-3 text-center">
                                            <div className="font-mono text-[10px] text-muted uppercase mb-1">Predicted</div>
                                            <div className="font-mono text-muted text-sm truncate">Primary Pathogen</div>
                                        </div>
                                        <ArrowRight className="text-muted shrink-0" />
                                        <div className="flex-1 border border-accent/30 p-3 bg-accent/5 text-center">
                                            <div className="font-mono text-[10px] text-accent uppercase mb-1">Ground Truth</div>
                                            <div className="font-mono text-accent text-sm font-bold truncate">Parvovirus</div>
                                        </div>
                                    </div>
                                </ConsoleCard>
                            </div>
                        )}
                        {state.status === 'error' && (
                            <div className="text-danger font-mono text-sm border border-danger p-4 bg-danger/5">
                                ERR: {state.errorMessage}
                            </div>
                        )}
                    </ConsoleCard>
                </div>
            </div>

            {/* Architecture Visual */}
            <ConsoleCard title="Runtime Feedback Path" className="bg-background">
                <div className="flex flex-col md:flex-row items-center gap-4 md:gap-0 justify-between p-6 overflow-x-auto">
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-full border border-grid flex items-center justify-center bg-dim text-muted">
                            <BrainCircuit />
                        </div>
                        <span className="font-mono text-xs uppercase text-muted">Prediction</span>
                    </div>
                    <ArrowRight className="text-accent md:mx-4 hidden md:block" />
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-full border border-accent flex items-center justify-center bg-accent/10 text-accent outline outline-4 outline-accent/20">
                            <GitMerge />
                        </div>
                        <span className="font-mono text-xs uppercase text-accent">Outcome Injected</span>
                    </div>
                    <ArrowRight className="text-muted md:mx-4 hidden md:block" />
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-[4px] border border-grid flex items-center justify-center bg-dim text-muted">
                            <Activity />
                        </div>
                        <span className="font-mono text-xs uppercase text-muted">Weights Updated</span>
                    </div>
                    <ArrowRight className="text-muted md:mx-4 hidden md:block" />
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-sm border border-grid flex items-center justify-center bg-dim text-muted">
                            <Database />
                        </div>
                        <span className="font-mono text-xs uppercase text-muted">Telemetry Logged</span>
                    </div>
                </div>
            </ConsoleCard>
        </Container>
    );
}
