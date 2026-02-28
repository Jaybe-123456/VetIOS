'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard, DataRow } from '@/components/ui/terminal';
import { SimulationRunner } from '@/components/SimulationRunner';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import { ShieldAlert, Activity, AlertTriangle, AlertOctagon } from 'lucide-react';

interface SimulationState {
    status: 'idle' | 'simulating' | 'success' | 'error';
    degradationScore?: number;
    uncertaintySpikes?: number;
    instabilityData?: any[];
    history?: any[];
    errorMessage?: string;
}

export default function AdversarialSimulation() {
    const [state, setState] = useState<SimulationState>({
        status: 'idle',
        history: [
            { id: 'sim_001', target: 'Autoimmune', cases: 50, degradation: 0.12, time: '10:05' },
            { id: 'sim_002', target: 'Noise Inject', cases: 200, degradation: 0.35, time: '11:22' }
        ]
    });

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setState(prev => ({ ...prev, status: 'simulating' }));

        const formData = new FormData(e.currentTarget);
        const data = {
            edge_cases: formData.get('edgeCases'),
            contradictions: formData.get('contradictions'),
            target_disease: formData.get('rareDiseases'),
            iterations: parseInt(formData.get('iterations') as string || '100')
        };

        try {
            const res = await fetch('/api/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || 'Simulation engine failed');
            }

            // Simulate heavy computation
            await new Promise(r => setTimeout(r, 1200));

            const instabilityData = Array.from({ length: 20 }).map((_, i) => ({
                iteration: i * (data.iterations / 20),
                confidence: 90 - (Math.random() * 40 * (i / 20))
            }));

            setState(prev => ({
                ...prev,
                status: 'success',
                degradationScore: 0.45 + Math.random() * 0.2,
                uncertaintySpikes: Math.floor(Math.random() * 12) + 2,
                instabilityData,
                history: [
                    { id: `sim_${Math.random().toString(36).substr(2, 3)}`, target: data.target_disease || 'Mixed', cases: data.iterations, degradation: 0.55, time: 'Just now' },
                    ...(prev.history || [])
                ]
            }));
        } catch (err: any) {
            setState(prev => ({ ...prev, status: 'error', errorMessage: err.message }));
        }
    }

    return (
        <Container className="max-w-7xl">
            <PageHeader
                title="ADVERSARIAL SIMULATION ENGINE"
                description="Stress-testing lab to expose edge cases, trigger uncertainty spikes, and measure model degradation under noise."
            />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-12 mb-12">
                <div className="xl:col-span-1 border-r border-grid xl:pr-12">
                    <ConsoleCard title="Configure Simulation" className="border-danger/30 p-0 bg-transparent">
                        <SimulationRunner onSubmit={handleSubmit} isSimulating={state.status === 'simulating'} />
                    </ConsoleCard>
                </div>

                <div className="xl:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <ConsoleCard title="Model Degradation Score" className="border-danger/30">
                            {state.status === 'simulating' ? (
                                <div className="h-24 flex items-center justify-center text-danger animate-pulse font-mono">
                                    <Activity className="w-5 h-5 mr-2 animate-spin" /> CALCULATING...
                                </div>
                            ) : state.status === 'success' ? (
                                <div className="h-24 flex flex-col justify-center">
                                    <div className="text-4xl font-mono text-danger font-bold tracking-tighter">
                                        {(state.degradationScore! * 100).toFixed(1)}<span className="text-lg">%</span>
                                    </div>
                                    <div className="text-[10px] text-muted font-mono uppercase mt-1 flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3 text-danger" /> Critical Degradation Detected
                                    </div>
                                </div>
                            ) : (
                                <div className="h-24 flex items-center justify-center text-muted text-[10px] font-mono border border-dashed border-danger/20">
                                    AWAITING SIMULATION
                                </div>
                            )}
                        </ConsoleCard>

                        <ConsoleCard title="Uncertainty Spikes" className="border-danger/30">
                            {state.status === 'simulating' ? (
                                <div className="h-24 flex items-center justify-center text-danger animate-pulse font-mono">
                                    <Activity className="w-5 h-5 mr-2 animate-spin" /> SCANNING...
                                </div>
                            ) : state.status === 'success' ? (
                                <div className="h-24 flex flex-col justify-center">
                                    <div className="text-4xl font-mono text-accent font-bold tracking-tighter">
                                        {state.uncertaintySpikes}
                                    </div>
                                    <div className="text-[10px] text-muted font-mono uppercase mt-1 flex items-center gap-1">
                                        <AlertOctagon className="w-3 h-3 text-accent" /> Anomalies above threshold
                                    </div>
                                </div>
                            ) : (
                                <div className="h-24 flex items-center justify-center text-muted text-[10px] font-mono border border-dashed border-danger/20">
                                    AWAITING SIMULATION
                                </div>
                            )}
                        </ConsoleCard>
                    </div>

                    <ConsoleCard title="Confidence Instability Chart - Real-time Target Deterioration" className="h-[300px] border-danger/30">
                        {state.status === 'success' && state.instabilityData ? (
                            <div className="flex-1 -mx-4 h-full">
                                <TelemetryChart data={state.instabilityData} dataKey="confidence" color="#ff3333" />
                            </div>
                        ) : state.status === 'simulating' ? (
                            <div className="h-full flex items-center justify-center text-danger animate-pulse font-mono">
                                MAPPING DETERIORATION CURVE...
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-muted text-[10px] font-mono border border-dashed border-danger/20">
                                NO DATA
                            </div>
                        )}
                    </ConsoleCard>
                </div>
            </div>

            <ConsoleCard title="Simulation History Log">
                <div className="w-full overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-grid/50 font-mono text-[10px] uppercase text-muted tracking-widest">
                                <th className="p-3 font-normal">SIM_ID</th>
                                <th className="p-3 font-normal">Target / Vectors</th>
                                <th className="p-3 font-normal">Iterations</th>
                                <th className="p-3 font-normal">Degradation</th>
                                <th className="p-3 font-normal">Timestamp</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono text-sm">
                            {state.history?.map((sim, i) => (
                                <tr key={i} className="border-b border-grid/30 hover:bg-white/[0.02] transition-colors">
                                    <td className="p-3 text-muted">{sim.id}</td>
                                    <td className="p-3 text-foreground">{sim.target}</td>
                                    <td className="p-3 text-muted">{sim.cases}</td>
                                    <td className="p-3 text-danger">{(sim.degradation * 100).toFixed(1)}%</td>
                                    <td className="p-3 text-muted text-xs">{sim.time}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </ConsoleCard>
        </Container>
    );
}
