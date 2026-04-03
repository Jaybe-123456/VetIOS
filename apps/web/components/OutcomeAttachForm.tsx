'use client';

import { TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton } from '@/components/ui/terminal';

interface OutcomeAttachFormProps {
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    isSubmitting: boolean;
}

export function OutcomeAttachForm({ onSubmit, isSubmitting }: OutcomeAttachFormProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-6">
            <div>
                <TerminalLabel htmlFor="eventId">Inference Event ID (UUID)</TerminalLabel>
                <TerminalInput
                    id="eventId"
                    name="eventId"
                    placeholder="e.g. 6f1f7d2c-90d4-4c29-a53a-7c59f3b5c81a"
                    required
                />
                <p className="mt-2 font-mono text-[11px] text-muted">
                    Paste the canonical inference UUID. If you copied a telemetry ID like `evt_inference_...`,
                    VetIOS will extract the UUID automatically.
                </p>
            </div>

            <div>
                <TerminalLabel htmlFor="actualDiagnosis">Ground Truth / Actual Diagnosis</TerminalLabel>
                <TerminalInput id="actualDiagnosis" name="actualDiagnosis" placeholder="e.g. Parvovirus" required />
            </div>

            <div>
                <TerminalLabel htmlFor="notes">Clinical Notes & Justification (Optional)</TerminalLabel>
                <TerminalTextarea id="notes" name="notes" placeholder="Detailed vet notes on why the prediction was right or wrong..." />
            </div>

            <TerminalButton type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'ATTACHING & RECALIBRATING...' : 'SUBMIT REINFORCEMENT SIGNAL'}
            </TerminalButton>
        </form>
    );
}
