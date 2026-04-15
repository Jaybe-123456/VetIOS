'use client';

import { useMemo, useState } from 'react';
import { TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton } from '@/components/ui/terminal';
import { UploadCloud, File, Image as ImageIcon, Type, Code, AlignLeft, Play } from 'lucide-react';
import type { InputMode } from '@/lib/input/inputNormalizer';

interface InferenceFormProps {
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    isComputing: boolean;
    inputMode: InputMode;
    onModeChange: (mode: InputMode) => void;
}

const MODES: { key: InputMode; label: string; icon: React.ReactNode; desc: string }[] = [
    { key: 'structured', label: 'Structured', icon: <AlignLeft className="w-3.5 h-3.5" />, desc: 'Form fields' },
    { key: 'freetext', label: 'Free Text', icon: <Type className="w-3.5 h-3.5" />, desc: 'Natural language' },
    { key: 'json', label: 'JSON', icon: <Code className="w-3.5 h-3.5" />, desc: 'Raw JSON' },
];

export function InferenceForm({ onSubmit, isComputing, inputMode, onModeChange }: InferenceFormProps) {
    const [imgFile, setImgFile] = useState<File | null>(null);
    const [docFile, setDocFile] = useState<File | null>(null);
    const [symptomText, setSymptomText] = useState('');

    const symptomChips = useMemo(
        () => symptomText.split(',').map((value) => value.trim()).filter(Boolean),
        [symptomText],
    );

    return (
        <form onSubmit={onSubmit} className="space-y-6">
            <div>
                <TerminalLabel>Input Mode</TerminalLabel>
                <div className="flex overflow-hidden rounded-[3px] border border-[var(--border-default)]">
                    {MODES.map((m) => (
                        <button
                            key={m.key}
                            type="button"
                            onClick={() => onModeChange(m.key)}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-all duration-150 ${inputMode === m.key ? 'bg-[var(--green-dim)] text-[var(--green-glow)] border-r border-[var(--green-bright)]' : 'bg-transparent text-[var(--text-secondary)]/70 hover:bg-[var(--bg-elevated)]'}`}
                        >
                            {m.icon}
                            <span>{m.label}</span>
                        </button>
                    ))}
                </div>
                <p className="mt-1.5 font-sans text-[12px] text-[var(--text-secondary)]/70">{MODES.find((m) => m.key === inputMode)?.desc}</p>
            </div>

            {inputMode === 'structured' && (
                <>
                    <div>
                        <TerminalLabel htmlFor="species">Species Constraint</TerminalLabel>
                        <TerminalInput id="species" name="species" placeholder="e.g. dog, cat" />
                    </div>

                    <div>
                        <TerminalLabel htmlFor="breed">Breed String</TerminalLabel>
                        <TerminalInput id="breed" name="breed" placeholder="e.g. Golden Retriever" />
                    </div>

                    <div>
                        <TerminalLabel htmlFor="symptoms">Symptom Vector (Comma Separated)</TerminalLabel>
                        <TerminalInput id="symptoms" name="symptoms" value={symptomText} onChange={(e) => setSymptomText(e.target.value)} placeholder="lethargy, vomiting, fever" />
                        {symptomChips.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {symptomChips.map((chip, index) => (
                                    <button
                                        key={`${chip}-${index}`}
                                        type="button"
                                        onClick={() => {
                                            const next = [...symptomChips];
                                            next.splice(index, 1);
                                            setSymptomText(next.join(', '));
                                        }}
                                        className="inline-flex items-center gap-1 border border-[var(--green-mid)] bg-[var(--green-dim)] px-2 py-0.5 font-mono text-[10px] text-[var(--green-bright)]"
                                    >
                                        {chip} <span>×</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <label className="border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[var(--green-mid)] hover:bg-[var(--green-dim)] transition-all duration-150 group">
                            <input type="file" id="diagnostic-img" name="diagnostic-img" accept="image/*" className="hidden" onChange={(e) => setImgFile(e.target.files?.[0] || null)} />
                            {imgFile ? <><ImageIcon className="w-5 h-5 text-[var(--green-glow)]" /><span className="font-mono text-[10px] text-[var(--green-glow)] truncate max-w-[160px]">{imgFile.name}</span></> : <><UploadCloud className="w-5 h-5 text-[var(--text-secondary)]/70 group-hover:text-[var(--green-mid)]" /><span className="font-mono text-[10px] text-[var(--text-secondary)]/70">UPLOAD DIAGNOSTIC IMG</span></>}
                        </label>

                        <label className="border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[var(--green-mid)] hover:bg-[var(--green-dim)] transition-all duration-150 group">
                            <input type="file" id="lab-results" name="lab-results" accept=".pdf,.xml,.json,.txt" className="hidden" onChange={(e) => setDocFile(e.target.files?.[0] || null)} />
                            {docFile ? <><File className="w-5 h-5 text-[var(--green-glow)]" /><span className="font-mono text-[10px] text-[var(--green-glow)] truncate max-w-[160px]">{docFile.name}</span></> : <><UploadCloud className="w-5 h-5 text-[var(--text-secondary)]/70 group-hover:text-[var(--green-mid)]" /><span className="font-mono text-[10px] text-[var(--text-secondary)]/70">ATTACH LAB RESULTS</span></>}
                        </label>
                    </div>

                    <div>
                        <TerminalLabel htmlFor="metadata">Patient History / Metadata</TerminalLabel>
                        <TerminalTextarea id="metadata" name="metadata" placeholder={'7 years old, 32.5 kg\nPrevious history of hip dysplasia'} />
                    </div>
                </>
            )}

            {inputMode === 'freetext' && (
                <div>
                    <TerminalLabel htmlFor="freetext-input">Clinical Notes</TerminalLabel>
                    <TerminalTextarea id="freetext-input" name="freetext-input" className="min-h-[200px]" placeholder="Narrative clinical notes..." />
                </div>
            )}

            {inputMode === 'json' && (
                <div>
                    <TerminalLabel htmlFor="json-input">Raw JSON Input</TerminalLabel>
                    <TerminalTextarea id="json-input" name="json-input" className="min-h-[240px]" placeholder={'{\n  "species": "canine"\n}'} />
                </div>
            )}

            <TerminalButton
                type="submit"
                disabled={isComputing}
                className="w-full h-11 overflow-hidden"
                style={{ cursor: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Cpath d='M8 1v14M1 8h14' stroke='%2322c55e' stroke-width='1.5'/%3E%3C/svg%3E") 8 8, pointer` }}
            >
                {isComputing ? <><span className="absolute inset-0 bg-[var(--green-mid)] opacity-40 animate-pulse" /><span className="relative">PROCESSING VECTORS...</span></> : <><Play className="h-3.5 w-3.5" /> RUN INFERENCE ENGINE</>}
            </TerminalButton>
        </form>
    );
}
