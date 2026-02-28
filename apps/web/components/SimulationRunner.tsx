'use client';

import { TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton } from '@/components/ui/terminal';

interface SimulationRunnerProps {
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    isSimulating: boolean;
}

export function SimulationRunner({ onSubmit, isSimulating }: SimulationRunnerProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-6">
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

            <div>
                <TerminalLabel htmlFor="iterations">Stress Test Iterations</TerminalLabel>
                <TerminalInput id="iterations" name="iterations" type="number" defaultValue={100} min={10} max={1000} />
            </div>

            <TerminalButton type="submit" disabled={isSimulating} className="w-full" variant="danger">
                {isSimulating ? 'RUNNING STRESS TEST...' : 'EXECUTE ADVERSARIAL SIMULATION'}
            </TerminalButton>
        </form>
    );
}
