'use client';

import { TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton } from '@/components/ui/terminal';

interface SimulationRunnerProps {
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    isSimulating: boolean;
}

export function SimulationRunner({ onSubmit, isSimulating }: SimulationRunnerProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-4 sm:space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                    <TerminalLabel htmlFor="species">Species</TerminalLabel>
                    <select
                        id="species"
                        name="species"
                        className="w-full bg-dim border-grid p-3 font-mono text-sm text-foreground focus:outline-none focus:border-accent transition-colors"
                        defaultValue="canine"
                    >
                        <option value="canine">Canine</option>
                        <option value="feline">Feline</option>
                        <option value="equine">Equine</option>
                        <option value="bovine">Bovine</option>
                    </select>
                </div>
                <div>
                    <TerminalLabel htmlFor="breed">Breed</TerminalLabel>
                    <TerminalInput id="breed" name="breed" placeholder="e.g. Labrador Retriever" />
                </div>
            </div>

            <div>
                <TerminalLabel htmlFor="symptoms">Core Symptoms</TerminalLabel>
                <TerminalTextarea
                    id="symptoms"
                    name="symptoms"
                    placeholder="Comma-separated symptoms, e.g. vomiting, abdominal distension, unproductive retching"
                    rows={4}
                    required
                />
            </div>

            <div>
                <TerminalLabel htmlFor="presentingComplaint">Presenting Complaint</TerminalLabel>
                <TerminalInput
                    id="presentingComplaint"
                    name="presentingComplaint"
                    placeholder="e.g. acute abdominal emergency with repeated unproductive retching"
                />
            </div>

            <div>
                <TerminalLabel htmlFor="rawNote">Clinical Note</TerminalLabel>
                <TerminalTextarea
                    id="rawNote"
                    name="rawNote"
                    placeholder="Enter the primary clinical narrative for the base case."
                    rows={5}
                />
            </div>

            <div>
                <TerminalLabel htmlFor="history">History</TerminalLabel>
                <TerminalTextarea
                    id="history"
                    name="history"
                    placeholder="Relevant patient history, previous episodes, diagnostics, or owner observations."
                    rows={4}
                />
            </div>

            <div>
                <TerminalLabel htmlFor="targetDisease">Optional Target Disease</TerminalLabel>
                <TerminalInput id="targetDisease" name="targetDisease" placeholder="e.g. Dysautonomia" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div>
                    <TerminalLabel htmlFor="steps">Sweep Steps</TerminalLabel>
                    <TerminalInput id="steps" name="steps" type="number" defaultValue={10} min={5} max={15} />
                </div>
                <div>
                    <TerminalLabel htmlFor="mode">Sweep Mode</TerminalLabel>
                    <select
                        id="mode"
                        name="mode"
                        className="w-full bg-dim border-grid p-3 font-mono text-sm text-foreground focus:outline-none focus:border-accent transition-colors"
                        defaultValue="adaptive"
                    >
                        <option value="adaptive">Adaptive</option>
                        <option value="linear">Linear</option>
                    </select>
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
                {isSimulating ? 'RUNNING INTEGRITY SWEEP...' : 'EXECUTE INTEGRITY SWEEP'}
            </TerminalButton>
        </form>
    );
}
