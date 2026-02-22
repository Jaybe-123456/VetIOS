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

interface OutcomeState {
    status: 'idle' | 'validating' | 'success' | 'error';
    errorMessage: string | null;
}

export default function OutcomeAttachment() {
    const [state, setState] = useState<OutcomeState>({
        status: 'idle',
        errorMessage: null
    });

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setState({ status: 'validating', errorMessage: null });

        const formData = new FormData(e.currentTarget);
        const parsedContext = formData.get('outcome_context') ? JSON.parse(formData.get('outcome_context') as string) : {};

        const data = {
            tenant_id: "demo-tenant-id", // Hardcoded for demo/local testing
            inference_event_id: formData.get('inferenceId'),
            outcome: {
                type: "clinical_update",
                payload: parsedContext,
                timestamp: new Date().toISOString()
            }
        };

        try {
            if (!data.inference_event_id) throw new Error('Inference Event ID is compulsory.');

            const res = await fetch('/api/outcome', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Failed to attach outcome.');

            // Simulate model re-weight trigger
            await new Promise(r => setTimeout(r, 600));

            setState({ status: 'success', errorMessage: null });
        } catch (err: any) {
            setState({ status: 'error', errorMessage: err.message });
        }
    }

    return (
        <Container>
            <PageHeader
                title="OUTCOME ATTACHMENT"
                description="Anchor clinical reality to a historical inference to calibrate future model weights."
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <TerminalLabel htmlFor="inferenceId">Inference Event ID (Compulsory)</TerminalLabel>
                        <TerminalInput id="inferenceId" name="inferenceId" placeholder="evt_xxxxxxxx" required />
                    </div>

                    <div>
                        <TerminalLabel htmlFor="outcome_context">Actual Clinical Outcome (JSON or String)</TerminalLabel>
                        <TerminalTextarea
                            id="outcome_context"
                            name="outcome_context"
                            placeholder={'{\n  "confirmed_diagnosis": "Parvovirus",\n  "treatment_efficacy": 0.9\n}'}
                            required
                        />
                    </div>

                    <TerminalButton type="submit" disabled={state.status === 'validating' || state.status === 'success'}>
                        {state.status === 'validating' ? 'VALIDATING HASH...' : 'ATTACH OUTCOME & RE-WEIGHT'}
                    </TerminalButton>
                </form>

                <div className="space-y-8">
                    <div>
                        <TerminalLabel>Weight Calibration Status</TerminalLabel>
                        <div className={`p-4 border font-mono text-sm ${state.status === 'idle' ? 'border-muted text-muted' :
                            state.status === 'validating' ? 'border-accent text-accent animate-pulse' :
                                state.status === 'error' ? 'border-danger text-danger' :
                                    'border-accent text-accent'
                            }`}>
                            {state.status === 'idle' && 'AWAITING EVENT ATTACHMENT'}
                            {state.status === 'validating' && 'CLOSING LOOP & CALIBRATING...'}
                            {state.status === 'error' && `ERR: ${state.errorMessage}`}
                            {state.status === 'success' && 'NETWORK WEIGHTS ADJUSTED FOR FUTURE INFERENCE'}
                        </div>
                    </div>
                </div>
            </div>
        </Container>
    );
}
