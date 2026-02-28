'use client';

import { Container, PageHeader, ConsoleCard, DataRow } from '@/components/ui/terminal';
import { TelemetryChart } from '@/components/ui/TelemetryChart';
import { Activity } from 'lucide-react';

const mockLossData = Array.from({ length: 50 }).map((_, i) => ({
    iteration: i * 100,
    loss: Math.exp(-i / 10) + Math.random() * 0.05
}));

const mockValAccuracy = Array.from({ length: 50 }).map((_, i) => ({
    iteration: i * 100,
    accuracy: 0.5 + 0.45 * (1 - Math.exp(-i / 15)) + Math.random() * 0.02
}));

export default function ExperimentTracking() {
    return (
        <Container className="max-w-7xl">
            <PageHeader
                title="EXPERIMENT TRACKING"
                description="Monitor training curves, hyperparameter sweeps, and architectural iterations in real-time."
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
                <ConsoleCard title="Training Loss (Log Scale)" className="h-[300px]">
                    <div className="flex-1 -mx-4">
                        <TelemetryChart data={mockLossData} dataKey="loss" color="#00ff41" />
                    </div>
                </ConsoleCard>
                <ConsoleCard title="Validation Accuracy" className="h-[300px]">
                    <div className="flex-1 -mx-4">
                        <TelemetryChart data={mockValAccuracy} dataKey="accuracy" color="#00ff41" />
                    </div>
                </ConsoleCard>
            </div>

            <ConsoleCard title="Recent Experiment Runs">
                <div className="w-full overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                        <thead>
                            <tr className="border-b border-grid font-mono text-[10px] uppercase text-muted tracking-widest bg-black/40">
                                <th className="p-4 font-normal">RUN_ID</th>
                                <th className="p-4 font-normal">Model Arch</th>
                                <th className="p-4 font-normal">Dataset</th>
                                <th className="p-4 font-normal">Epochs</th>
                                <th className="p-4 font-normal">Val_Acc</th>
                                <th className="p-4 font-normal">Status</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono text-sm">
                            <tr className="border-b border-grid/20 hover:bg-white/[0.02] transition-colors cursor-crosshair">
                                <td className="p-4 text-accent">run_xl_v1.5a</td>
                                <td className="p-4 text-foreground">Transformer-14B</td>
                                <td className="p-4 text-muted">vet_clinical_subset_b</td>
                                <td className="p-4 text-muted">240</td>
                                <td className="p-4 text-foreground">94.8%</td>
                                <td className="p-4">
                                    <span className="flex items-center gap-2 text-accent text-[10px] uppercase border border-accent/30 px-2 py-1 bg-accent/10 w-fit">
                                        <Activity className="w-3 h-3 animate-spin" /> Training
                                    </span>
                                </td>
                            </tr>
                            <tr className="border-b border-grid/20 hover:bg-white/[0.02] transition-colors cursor-crosshair">
                                <td className="p-4 text-muted">run_sm_v1.4</td>
                                <td className="p-4 text-foreground">ResNet-Distilled</td>
                                <td className="p-4 text-muted">vet_vision_v3</td>
                                <td className="p-4 text-muted">500</td>
                                <td className="p-4 text-foreground">89.2%</td>
                                <td className="p-4">
                                    <span className="text-muted text-[10px] uppercase border border-grid px-2 py-1 w-fit">
                                        Completed
                                    </span>
                                </td>
                            </tr>
                            <tr className="border-b border-grid/20 hover:bg-white/[0.02] transition-colors cursor-crosshair">
                                <td className="p-4 text-muted">run_base_v1.3</td>
                                <td className="p-4 text-foreground">Transformer-7B</td>
                                <td className="p-4 text-muted">vet_clinical_base</td>
                                <td className="p-4 text-muted">120</td>
                                <td className="p-4 text-foreground">81.4%</td>
                                <td className="p-4">
                                    <span className="text-danger text-[10px] uppercase border border-danger/30 px-2 py-1 bg-danger/10 w-fit">
                                        Exploded Gradient
                                    </span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </ConsoleCard>
        </Container>
    );
}
