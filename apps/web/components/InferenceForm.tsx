'use client';

import { TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton } from '@/components/ui/terminal';
import { UploadCloud } from 'lucide-react';

interface InferenceFormProps {
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    isComputing: boolean;
}

export function InferenceForm({ onSubmit, isComputing }: InferenceFormProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-6">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-dashed border-grid bg-background/50 p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-accent transition-colors group">
                    <UploadCloud className="w-6 h-6 text-muted group-hover:text-accent transition-colors" />
                    <span className="font-mono text-xs text-muted uppercase tracking-wider group-hover:text-accent">Upload Diagnostic Img</span>
                </div>
                <div className="border border-dashed border-grid bg-background/50 p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-accent transition-colors group">
                    <UploadCloud className="w-6 h-6 text-muted group-hover:text-accent transition-colors" />
                    <span className="font-mono text-xs text-muted uppercase tracking-wider group-hover:text-accent">Attach Lab Results</span>
                </div>
            </div>

            <div>
                <TerminalLabel htmlFor="metadata">Patient History / Unstructured Metadata (JSON)</TerminalLabel>
                <TerminalTextarea id="metadata" name="metadata" placeholder={'{\n  "age_months": 84,\n  "weight_kg": 32.5\n}'} />
            </div>

            <TerminalButton type="submit" disabled={isComputing} className="w-full">
                {isComputing ? 'COMPUTING VECTORS...' : 'EXECUTE INFERENCE PIPELINE'}
            </TerminalButton>
        </form>
    );
}
