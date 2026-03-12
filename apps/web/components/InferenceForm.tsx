'use client';

import { useState } from 'react';
import { TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton } from '@/components/ui/terminal';
import { UploadCloud, File, Image } from 'lucide-react';

interface InferenceFormProps {
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    isComputing: boolean;
}

export function InferenceForm({ onSubmit, isComputing }: InferenceFormProps) {
    const [imgFile, setImgFile] = useState<File | null>(null);
    const [docFile, setDocFile] = useState<File | null>(null);

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
                <label className="border border-dashed border-grid bg-background/50 p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-accent transition-colors group relative">
                    <input 
                        type="file" 
                        id="diagnostic-img" 
                        name="diagnostic-img" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => setImgFile(e.target.files?.[0] || null)}
                    />
                    {imgFile ? (
                        <>
                            <Image className="w-6 h-6 text-accent" />
                            <span className="font-mono text-xs text-accent uppercase tracking-wider truncate max-w-[150px]">{imgFile.name}</span>
                        </>
                    ) : (
                        <>
                            <UploadCloud className="w-6 h-6 text-muted group-hover:text-accent transition-colors" />
                            <span className="font-mono text-xs text-muted uppercase tracking-wider group-hover:text-accent text-center">Upload Diagnostic Img</span>
                        </>
                    )}
                </label>
                
                <label className="border border-dashed border-grid bg-background/50 p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-accent transition-colors group relative">
                    <input 
                        type="file" 
                        id="lab-results" 
                        name="lab-results" 
                        accept=".pdf,.xml,.json,.txt" 
                        className="hidden"
                        onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                    />
                    {docFile ? (
                        <>
                            <File className="w-6 h-6 text-accent" />
                            <span className="font-mono text-xs text-accent uppercase tracking-wider truncate max-w-[150px]">{docFile.name}</span>
                        </>
                    ) : (
                        <>
                            <UploadCloud className="w-6 h-6 text-muted group-hover:text-accent transition-colors" />
                            <span className="font-mono text-xs text-muted uppercase tracking-wider group-hover:text-accent text-center">Attach Lab Results</span>
                        </>
                    )}
                </label>
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
