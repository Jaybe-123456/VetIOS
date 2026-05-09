'use client';

import { useState } from 'react';
import { TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton } from '@/components/ui/terminal';
import { UploadCloud, File, Image as ImageIcon, Type, Code, AlignLeft, ChevronDown, ChevronRight, FlaskConical } from 'lucide-react';
import type { InputMode } from '@/lib/input/inputNormalizer';
import { PanelSelector } from './inference/PanelSelector';
import type { SystemPanel, Species } from '@vetios/inference-schema';

interface InferenceFormProps {
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    isComputing: boolean;
    inputMode: InputMode | 'panels';
    onModeChange: (mode: InputMode | 'panels') => void;
    species: Species;
    onSpeciesChange: (species: Species) => void;
    activePanels: SystemPanel[];
    onActivePanelsChange: (panels: SystemPanel[]) => void;
}

const MODES: { key: InputMode | 'panels'; label: string; icon: React.ReactNode; desc: string }[] = [
    { key: 'panels', label: 'Multisystemic', icon: <FlaskConical className="w-3.5 h-3.5" />, desc: 'Species-gated panels' },
    { key: 'structured', label: 'Structured', icon: <AlignLeft className="w-3.5 h-3.5" />, desc: 'Form fields' },
    { key: 'freetext', label: 'Free Text', icon: <Type className="w-3.5 h-3.5" />, desc: 'Natural language' },
    { key: 'json', label: 'JSON', icon: <Code className="w-3.5 h-3.5" />, desc: 'Raw JSON' },
];

export function InferenceForm({ 
    onSubmit, 
    isComputing, 
    inputMode, 
    onModeChange,
    species,
    onSpeciesChange,
    activePanels,
    onActivePanelsChange
}: InferenceFormProps) {
    const [imgFile, setImgFile] = useState<File | null>(null);
    const [docFile, setDocFile] = useState<File | null>(null);
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

    return (
        <form onSubmit={onSubmit} className="space-y-6">
            {/* ── Mode Selector ── */}
            <div>
                <TerminalLabel>Input Mode</TerminalLabel>
                <div className="flex gap-0 border border-grid">
                    {MODES.map((m) => (
                        <button
                            key={m.key}
                            type="button"
                            onClick={() => onModeChange(m.key)}
                            className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-3 sm:py-2.5 px-2 sm:px-3 font-mono text-[10px] sm:text-xs uppercase tracking-wider transition-all
                                ${inputMode === m.key
                                    ? 'bg-accent/15 text-accent border-b-2 border-accent'
                                    : 'text-muted hover:text-foreground hover:bg-dim'
                                }`}
                        >
                            {m.icon}
                            <span>{m.label}</span>
                        </button>
                    ))}
                </div>
                <p className="font-mono text-[10px] text-muted mt-1.5 uppercase">
                    {MODES.find(m => m.key === inputMode)?.desc}
                </p>
            </div>

            {/* ── Multisystemic Mode ── */}
            {inputMode === 'panels' && (
                <div className="space-y-6">
                    <PanelSelector 
                        species={species}
                        onSpeciesChange={onSpeciesChange}
                        activePanels={activePanels}
                        onChange={onActivePanelsChange}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                            <TerminalLabel htmlFor="panel_breed">Breed</TerminalLabel>
                            <TerminalInput id="panel_breed" name="panel_breed" placeholder="e.g. Golden Retriever" />
                        </div>
                        <div>
                            <TerminalLabel htmlFor="panel_sex">Sex</TerminalLabel>
                            <select
                                id="panel_sex"
                                name="panel_sex"
                                defaultValue="unknown"
                                className="w-full bg-background border border-grid px-3 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:border-accent/60 transition-colors"
                            >
                                <option value="unknown">Unknown</option>
                                <option value="male_intact">Male intact</option>
                                <option value="male_neutered">Male neutered</option>
                                <option value="female_intact">Female intact</option>
                                <option value="female_spayed">Female spayed</option>
                            </select>
                        </div>
                        <div>
                            <TerminalLabel htmlFor="panel_weight_kg">Weight Kg</TerminalLabel>
                            <TerminalInput id="panel_weight_kg" name="panel_weight_kg" type="number" min="0" step="0.1" placeholder="Optional" />
                        </div>
                        <div>
                            <TerminalLabel htmlFor="panel_age_years">Age Years</TerminalLabel>
                            <TerminalInput id="panel_age_years" name="panel_age_years" type="number" min="0" step="0.1" placeholder="Optional" />
                        </div>
                    </div>

                    <div>
                        <TerminalLabel htmlFor="panel_presenting_complaints">Presenting Complaints</TerminalLabel>
                        <TerminalInput
                            id="panel_presenting_complaints"
                            name="panel_presenting_complaints"
                            placeholder="lethargy, vomiting, pale gums"
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                        <div>
                            <TerminalLabel htmlFor="panel_temp_c">Temp C</TerminalLabel>
                            <TerminalInput id="panel_temp_c" name="panel_temp_c" type="number" step="0.1" placeholder="-" />
                        </div>
                        <div>
                            <TerminalLabel htmlFor="panel_hr">HR</TerminalLabel>
                            <TerminalInput id="panel_hr" name="panel_hr" type="number" step="1" placeholder="-" />
                        </div>
                        <div>
                            <TerminalLabel htmlFor="panel_rr">RR</TerminalLabel>
                            <TerminalInput id="panel_rr" name="panel_rr" type="number" step="1" placeholder="-" />
                        </div>
                        <div>
                            <TerminalLabel htmlFor="panel_mm_colour">MM Colour</TerminalLabel>
                            <select
                                id="panel_mm_colour"
                                name="panel_mm_colour"
                                defaultValue=""
                                className="w-full bg-background border border-grid px-3 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:border-accent/60 transition-colors"
                            >
                                <option value="">-</option>
                                <option value="pink">Pink</option>
                                <option value="pale">Pale</option>
                                <option value="white">White</option>
                                <option value="yellow">Yellow</option>
                                <option value="brick_red">Brick red</option>
                                <option value="cyanotic">Cyanotic</option>
                                <option value="muddy">Muddy</option>
                            </select>
                        </div>
                        <div>
                            <TerminalLabel htmlFor="panel_crt_seconds">CRT Sec</TerminalLabel>
                            <TerminalInput id="panel_crt_seconds" name="panel_crt_seconds" type="number" min="0" step="0.1" placeholder="-" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                            <TerminalLabel htmlFor="panel_duration_days">Duration Days</TerminalLabel>
                            <TerminalInput id="panel_duration_days" name="panel_duration_days" type="number" min="0" step="1" placeholder="Optional" />
                        </div>
                        <div>
                            <TerminalLabel htmlFor="panel_medications">Medications</TerminalLabel>
                            <TerminalInput id="panel_medications" name="panel_medications" placeholder="prednisolone, doxycycline" />
                        </div>
                    </div>

                    <div>
                        <TerminalLabel htmlFor="panel_history">History / Free Text</TerminalLabel>
                        <TerminalTextarea
                            id="panel_history"
                            name="panel_history"
                            placeholder="Relevant history, prior diagnostics, owner observations"
                            className="min-h-[120px]"
                        />
                    </div>
                </div>
            )}

            {/* ── Structured Mode ── */}
            {inputMode === 'structured' && (
                <>
                    <div>
                        <TerminalLabel htmlFor="species">Species Constraint</TerminalLabel>
                        <TerminalInput id="species" name="species" placeholder="e.g. Canis lupus familiaris, dog, cat" />
                    </div>

                    <div>
                        <TerminalLabel htmlFor="breed">Breed String</TerminalLabel>
                        <TerminalInput id="breed" name="breed" placeholder="e.g. Golden Retriever" />
                    </div>

                    <div>
                        <TerminalLabel htmlFor="symptoms">Symptom Vector (Comma Separated)</TerminalLabel>
                        <TerminalInput id="symptoms" name="symptoms" placeholder="lethargy, vomiting, fever" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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
                                    <ImageIcon className="w-6 h-6 text-accent" />
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
                        <TerminalLabel htmlFor="metadata">Patient History / Metadata (Optional)</TerminalLabel>
                        <TerminalTextarea id="metadata" name="metadata" placeholder={'7 years old, 32.5 kg\nPrevious history of hip dysplasia'} />
                    </div>

                    <div className="border border-grid bg-background/40">
                        <button
                            type="button"
                            onClick={() => setDiagnosticsOpen((open) => !open)}
                            className="w-full min-h-[44px] px-3 py-3 flex items-center justify-between gap-3 font-mono text-[12px] uppercase tracking-[0.16em] text-foreground hover:text-accent hover:bg-dim transition-colors"
                            aria-expanded={diagnosticsOpen}
                        >
                            <span className="flex items-center gap-2">
                                <FlaskConical className="w-4 h-4" />
                                Diagnostic Tests
                            </span>
                            {diagnosticsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        {diagnosticsOpen && (
                            <div className="border-t border-grid p-3 sm:p-4">
                                <PanelSelector
                                    species={species}
                                    onSpeciesChange={onSpeciesChange}
                                    activePanels={activePanels}
                                    onChange={onActivePanelsChange}
                                />
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ── Free Text Mode ── */}
            {inputMode === 'freetext' && (
                <div>
                    <TerminalLabel htmlFor="freetext-input">Clinical Notes</TerminalLabel>
                    <TerminalTextarea
                        id="freetext-input"
                        name="freetext-input"
                        placeholder={`Type naturally, e.g.:\n\nGolden Retriever, 7 years old, vomiting and lethargy for 2 days\n\nor\n\nSpecies: dog | Breed: German Shepherd | Symptoms: fever, cough`}
                        className="min-h-[160px] sm:min-h-[200px]"
                    />
                    <p className="font-mono text-[10px] text-muted mt-2">
                        VetIOS will automatically extract species, breed, symptoms, and metadata from your notes.
                    </p>
                </div>
            )}

            {/* ── JSON Mode ── */}
            {inputMode === 'json' && (
                <div>
                    <TerminalLabel htmlFor="json-input">Raw JSON Input</TerminalLabel>
                    <TerminalTextarea
                        id="json-input"
                        name="json-input"
                        placeholder={`{\n  "species": "canine",\n  "breed": "Golden Retriever",\n  "symptoms": ["vomiting", "fever"],\n  "metadata": {\n    "age_months": 84,\n    "weight_kg": 32.5\n  }\n}`}
                        className="min-h-[180px] sm:min-h-[240px] font-mono text-xs"
                    />
                    <p className="font-mono text-[10px] text-muted mt-2">
                        Partial or malformed JSON will be auto-repaired. Unknown keys are preserved in metadata.
                    </p>
                </div>
            )}

            <TerminalButton type="submit" disabled={isComputing} className="w-full">
                {isComputing ? 'NORMALIZING & COMPUTING VECTORS...' : 'EXECUTE INFERENCE PIPELINE'}
            </TerminalButton>
        </form>
    );
}
