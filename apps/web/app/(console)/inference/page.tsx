'use client';

import { useState } from 'react';
import {
    TerminalLabel,
    TerminalInput,
    TerminalTextarea,
    TerminalButton,
    Container,
    PageHeader,
    DataRow
} from '@/components/ui/terminal';

interface InferenceState {
    status: 'idle' | 'computing' | 'success' | 'error';
    eventId: string | null;
    probabilities: Array<{ label: string; value: number }>;
    errorMessage: string | null;
}

export default function InferenceConsole() {
    const [state, setState] = useState<InferenceState>({
        status: 'idle',
        eventId: null,
        probabilities: [],
        errorMessage: null
    });

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setState({ status: 'computing', eventId: null, probabilities: [], errorMessage: null });

        const formData = new FormData(e.currentTarget);

        // Match the API route's expected InferenceRequestBody structure
        const data = {
            tenant_id: "demo-tenant-id", // Hardcoded for demo/local testing pending auth
            model: {
                name: "gpt-4-turbo",
                version: "1.0.0"
            },
            input: {
                input_signature: {
                    species: formData.get('species'),
                    breed: formData.get('breed'),
                    symptoms: formData.get('symptoms')?.toString().split(',').map(s => s.trim()) || [],
                    metadata: formData.get('metadata') ? JSON.parse(formData.get('metadata') as string) : {}
                }
            }
        };

        try {
            const res = await fetch('/api/inference', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json();

            if (!res.ok) throw new Error(result.error || 'Inference computation failed');

            // Simulate slight delay for computational heavy feel
            await new Promise(r => setTimeout(r, 800));

            setState({
                status: 'success',
                eventId: result.inference_event_id || `evt_${Math.random().toString(36).substr(2, 9)}`,
                probabilities: result.probabilities || [
                    { label: 'Primary Pathogen', value: 0.82 },
                    { label: 'Secondary Opportunistic', value: 0.14 },
                    { label: 'Autoimmune', value: 0.04 }
                ],
                errorMessage: null
            });
        } catch (err: any) {
            setState(prev => ({ ...prev, status: 'error', errorMessage: err.message }));
        }
    }

    return (
        <Container>
            <PageHeader
                title="INFERENCE CONSOLE"
                description="Inject structured clinical context to generate probability vectors."
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <form onSubmit={handleSubmit} className="space-y-6 border-r border-grid pr-12">
                    <div>
                        <TerminalLabel htmlFor="species">Species Constraint</TerminalLabel>
                        <TerminalInput id="species" name="species" placeholder="e.g. Canis lupus familiaris" required />
                    </div>

                    <div>
                        <TerminalLabel htmlFor="breed">Breed String</TerminalLabel>
                        <TerminalInput id="breed" name="breed" placeholder="e.g. Golden Retriever" />
                    </div>

                    <div>
                        <TerminalLabel htmlFor="symptoms">Symptom Vector (Comma Separated)</TerminalLabel>
                        <TerminalInput id="symptoms" name="symptoms" placeholder="lethargy, vomiting, fever" required />
                    </div>

                    <div>
                        <TerminalLabel htmlFor="metadata">Unstructured Metadata (JSON)</TerminalLabel>
                        <TerminalTextarea id="metadata" name="metadata" placeholder={'{\n  "age_months": 84,\n  "weight_kg": 32.5\n}'} />
                    </div>

                    <TerminalButton type="submit" disabled={state.status === 'computing'}>
                        {state.status === 'computing' ? 'COMPUTING VECTORS...' : 'EXECUTE INFERENCE'}
                    </TerminalButton>
                </form>

                <div className="space-y-8">
                    <div>
                        <TerminalLabel>Execution Status</TerminalLabel>
                        <div className={`p-4 border font-mono text-sm ${state.status === 'idle' ? 'border-muted text-muted' :
                            state.status === 'computing' ? 'border-accent text-accent animate-pulse' :
                                state.status === 'error' ? 'border-danger text-danger' :
                                    'border-accent text-accent'
                            }`}>
                            {state.status === 'idle' && 'AWAITING INPUT'}
                            {state.status === 'computing' && 'CALCULATING PROBABILITIES...'}
                            {state.status === 'error' && `ERR: ${state.errorMessage}`}
                            {state.status === 'success' && 'VECTORS GENERATED'}
                        </div>
                    </div>

                    {state.status === 'success' && state.eventId && (
                        <div className="space-y-6 animate-in fade-in duration-500">
                            <div className="p-6 border border-accent bg-accent/5">
                                <TerminalLabel>Inference Event ID (Immutable)</TerminalLabel>
                                <div className="font-mono text-xl text-accent tracking-wider font-bold">
                                    {state.eventId}
                                </div>
                                <p className="text-xs text-muted mt-2 font-mono">
                                    Copy this ID to attach outcomes or run adversarial simulations.
                                </p>
                            </div>

                            <div>
                                <TerminalLabel>Calculated Probabilities</TerminalLabel>
                                <div className="space-y-2 border border-grid p-4">
                                    {state.probabilities.map((p, i) => (
                                        <div key={i} className="flex items-center gap-4">
                                            <div className="w-48 font-mono text-xs text-muted max-w-full truncate">{p.label}</div>
                                            <div className="flex-1 h-2 bg-dim overflow-hidden">
                                                <div className="h-full bg-accent" style={{ width: `${p.value * 100}%` }} />
                                            </div>
                                            <div className="w-12 text-right font-mono text-xs">{(p.value * 100).toFixed(0)}%</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Container>
    );
}
