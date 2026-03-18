'use client';

import { TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton } from '@/components/ui/terminal';

interface SimulationRunnerProps {
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    isSimulating: boolean;
}

export function SimulationRunner({ onSubmit, isSimulating }: SimulationRunnerProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-4 sm:space-y-6">
            <div>
                <TerminalLabel htmlFor="simulationType">Simulation Type</TerminalLabel>
                <select
                    id="simulationType"
                    name="simulationType"
                    className="w-full bg-dim border-grid p-3 font-mono text-sm text-foreground focus:outline-none focus:border-accent transition-colors"
                    defaultValue="adversarial_scenario"
                >
                    <option value="adversarial_scenario">Adversarial Scenario</option>
                    <option value="boundary_probe">Boundary Probe</option>
                    <option value="model_stress_test">Model Stress Test</option>
                    <option value="intervention_test">Intervention Test</option>
                </select>
            </div>

            <div>
                <TerminalLabel htmlFor="edgeCases">Edge Case Symptom Vectors</TerminalLabel>
                <TerminalInput id="edgeCases" name="edgeCases" placeholder="e.g. fever + hypothermia simultaneously" required />
            </div>

            <div>
                <TerminalLabel htmlFor="contradictions">Contradictory Signals (Noise Injection)</TerminalLabel>
                <TerminalInput id="contradictions" name="contradictions" placeholder="e.g. age: 2 months, weight: 80kg" />
            </div>

            <div>
                <TerminalLabel htmlFor="rareDiseases">Target Rare Disease Profile</TerminalLabel>
                <TerminalInput id="rareDiseases" name="rareDiseases" placeholder="e.g. Dysautonomia" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                    <TerminalLabel htmlFor="iterations">Stress Test Iterations</TerminalLabel>
                    <TerminalInput id="iterations" name="iterations" type="number" defaultValue={100} min={10} max={1000} />
                </div>
                <div>
                    <TerminalLabel htmlFor="model">Inference Model</TerminalLabel>
                    <select
                        id="model"
                        name="model"
                        className="w-full bg-dim border-grid p-3 font-mono text-sm text-foreground focus:outline-none focus:border-accent transition-colors"
                        defaultValue="gpt-4o-mini"
                    >
                        <option value="gpt-4o-mini">GPT-4o Mini</option>
                        <option value="gpt-4o">GPT-4o</option>
                    </select>
                </div>
            </div>

            <TerminalButton type="submit" disabled={isSimulating} variant="danger">
                {isSimulating ? 'RUNNING STRESS TEST...' : 'EXECUTE ADVERSARIAL SIMULATION'}
            </TerminalButton>
        </form>
    );
}
