'use client';

import { useState } from 'react';
import {
    TerminalLabel,
    TerminalInput,
    TerminalTextarea,
    TerminalButton,
    Container,
    PageHeader,
} from '@/components/ui/terminal';

export default function SimulationPanel() {
    const [status, setStatus] = useState<'idle' | 'simulating' | 'success'>('idle');
    const [simId, setSimId] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setStatus('simulating');

        // Simulate complex adversarial testing computation
        await new Promise(r => setTimeout(r, 1200));
        setSimId(`sim_${Math.random().toString(36).substr(2, 9)}`);
        setStatus('success');
    }

    return (
        <Container>
            <PageHeader
                title="ADVERSARIAL SIMULATION"
                description="Inject edge-case scenarios to stress-test model degradation without polluting clinical datasets."
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <TerminalLabel htmlFor="adversarial_payload">Adversarial Vector Payload (JSON)</TerminalLabel>
                        <TerminalTextarea
                            id="adversarial_payload"
                            name="adversarial_payload"
                            placeholder={'{\n  "species": "Felis catus",\n  "symptoms": ["hypothermia", "tachycardia", "ataxia"],\n  "contradictory_flags": ["normal_blood_pressure"]\n}'}
                            required
                        />
                    </div>

                    <TerminalButton type="submit" variant="secondary" disabled={status === 'simulating'}>
                        {status === 'simulating' ? 'INJECTING VECTORS...' : 'RUN STRESS TEST'}
                    </TerminalButton>
                </form>

                <div className="space-y-8">
                    {status === 'success' && simId && (
                        <div className="space-y-6 animate-in fade-in duration-500">
                            <div className="p-6 border border-muted bg-dim">
                                <TerminalLabel>Simulation Matrix ID</TerminalLabel>
                                <div className="font-mono text-xl tracking-wider font-bold">
                                    {simId}
                                </div>
                            </div>

                            <div>
                                <TerminalLabel>Degradation Matrix</TerminalLabel>
                                <div className="space-y-4 border border-grid p-4 font-mono text-sm">
                                    <div className="flex justify-between border-b border-muted/30 pb-2 text-muted">
                                        <span>VECTOR</span>
                                        <span>DIVERGENCE</span>
                                    </div>
                                    <div className="flex justify-between text-danger">
                                        <span>Base Confidence</span>
                                        <span>-42.3%</span>
                                    </div>
                                    <div className="flex justify-between text-accent">
                                        <span>Hallucination Rejection</span>
                                        <span>+98.1%</span>
                                    </div>
                                    <div className="flex justify-between text-foreground text-xs mt-4 pt-4 border-t border-muted/30">
                                        <span>System Maintained Coherence</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Container>
    );
}
