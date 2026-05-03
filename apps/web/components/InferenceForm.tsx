'use client';

import { useState } from 'react';
import { TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton } from '@/components/ui/terminal';
import { UploadCloud, File, Image as ImageIcon, Type, Code, AlignLeft, ChevronDown, ChevronRight, FlaskConical } from 'lucide-react';
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

interface DiagnosticSelectField {
    name: string;
    label: string;
    options: Array<{ value: string; label: string }>;
}

const PRESENT_ABSENT = [
    { value: 'absent', label: 'Absent' },
    { value: 'present', label: 'Present' },
];

const NOT_PERFORMED_RESULT = [
    { value: 'not_performed', label: 'Not performed' },
    { value: 'negative', label: 'Negative' },
    { value: 'positive', label: 'Positive' },
];

const CBC_FIELDS: DiagnosticSelectField[] = [
    { name: 'diag_cbc_spherocytes', label: 'Spherocytes', options: PRESENT_ABSENT },
    { name: 'diag_cbc_autoagglutination', label: 'Autoagglutination', options: [{ value: 'negative', label: 'Negative' }, { value: 'positive', label: 'Positive' }] },
    { name: 'diag_serology_coombs_test', label: 'Coombs Test', options: NOT_PERFORMED_RESULT },
    { name: 'diag_serology_saline_agglutination', label: 'Saline Agglutination', options: NOT_PERFORMED_RESULT },
    { name: 'diag_cbc_anemia_type', label: 'Anaemia Type', options: [{ value: 'not_assessed', label: 'Not assessed' }, { value: 'regenerative', label: 'Regenerative' }, { value: 'non_regenerative', label: 'Non-regenerative' }] },
    { name: 'diag_cbc_reticulocytosis', label: 'Reticulocytosis', options: [{ value: 'not_assessed', label: 'Not assessed' }, { value: 'normal', label: 'Normal' }, { value: 'elevated', label: 'Elevated' }] },
    { name: 'diag_cbc_thrombocytopenia', label: 'Thrombocytopenia', options: [{ value: 'absent', label: 'Absent' }, { value: 'mild', label: 'Mild' }, { value: 'moderate', label: 'Moderate' }, { value: 'severe', label: 'Severe' }] },
    { name: 'diag_cbc_leukocytosis', label: 'Leukocytosis', options: PRESENT_ABSENT },
    { name: 'diag_cbc_neutrophilia', label: 'Neutrophilia', options: PRESENT_ABSENT },
    { name: 'diag_cbc_eosinophilia', label: 'Eosinophilia', options: [{ value: 'absent', label: 'Absent' }, { value: 'mild', label: 'Mild' }, { value: 'moderate', label: 'Moderate' }, { value: 'severe', label: 'Severe' }] },
    { name: 'diag_cbc_pancytopenia', label: 'Pancytopenia', options: PRESENT_ABSENT },
    { name: 'diag_cbc_microfilaremia', label: 'Microfilaremia', options: [{ value: 'not_assessed', label: 'Not assessed' }, { value: 'absent', label: 'Absent' }, { value: 'present', label: 'Present' }] },
];

const SEROLOGY_FIELDS: DiagnosticSelectField[] = [
    { name: 'diag_serology_tick_borne_disease_panel', label: 'Tick-Borne Disease Panel', options: NOT_PERFORMED_RESULT },
    { name: 'diag_serology_heartworm_antigen', label: 'Heartworm Antigen', options: NOT_PERFORMED_RESULT },
    { name: 'diag_serology_leishmania_serology', label: 'Leishmania Serology', options: NOT_PERFORMED_RESULT },
    { name: 'diag_serology_fcov_antibody_titre', label: 'FCoV Antibody Titre', options: [{ value: 'not_performed', label: 'Not performed' }, { value: 'negative', label: 'Negative' }, { value: 'high_positive', label: 'High positive' }] },
    { name: 'diag_serology_mat_leptospira', label: 'MAT Leptospira', options: NOT_PERFORMED_RESULT },
    { name: 'diag_serology_distemper_antigen', label: 'Distemper Antigen', options: NOT_PERFORMED_RESULT },
    { name: 'diag_serology_total_t4', label: 'Total T4', options: [{ value: 'not_assessed', label: 'Not assessed' }, { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'elevated', label: 'Elevated' }] },
    { name: 'diag_serology_pancreatic_lipase', label: 'Pancreatic Lipase', options: [{ value: 'not_assessed', label: 'Not assessed' }, { value: 'normal', label: 'Normal' }, { value: 'elevated', label: 'Elevated' }, { value: 'markedly_elevated', label: 'Markedly elevated' }] },
    { name: 'diag_serology_acth_stimulation', label: 'ACTH Stimulation', options: [{ value: 'not_performed', label: 'Not performed' }, { value: 'flat_response', label: 'Flat response' }, { value: 'normal_response', label: 'Normal response' }] },
    { name: 'diag_serology_sodium_potassium_ratio', label: 'Sodium:Potassium Ratio', options: [{ value: 'not_assessed', label: 'Not assessed' }, { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }] },
];

const URINALYSIS_FIELDS: DiagnosticSelectField[] = [
    { name: 'diag_urinalysis_glucose_in_urine', label: 'Glucose In Urine', options: PRESENT_ABSENT },
    { name: 'diag_urinalysis_hemoglobinuria', label: 'Hemoglobinuria', options: PRESENT_ABSENT },
    { name: 'diag_urinalysis_bilirubinuria', label: 'Bilirubinuria', options: [{ value: 'absent', label: 'Absent' }, { value: 'present', label: 'Present' }, { value: 'mild', label: 'Mild' }] },
    { name: 'diag_urinalysis_proteinuria', label: 'Proteinuria', options: PRESENT_ABSENT },
];

const IMAGING_FIELDS: DiagnosticSelectField[] = [
    {
        name: 'diag_imaging_abdominal_ultrasound',
        label: 'Abdominal Ultrasound',
        options: [
            { value: 'not_performed', label: 'Not performed' },
            { value: 'no_uterine_pathology', label: 'No uterine pathology' },
            { value: 'uterine_distension', label: 'Uterine distension' },
            { value: 'splenic_mass', label: 'Splenic mass' },
            { value: 'hepatic_changes', label: 'Hepatic changes' },
            { value: 'free_fluid', label: 'Free fluid' },
            { value: 'other', label: 'Other' },
        ],
    },
    {
        name: 'diag_imaging_thoracic_radiograph',
        label: 'Thoracic Radiograph',
        options: [
            { value: 'not_performed', label: 'Not performed' },
            { value: 'normal', label: 'Normal' },
            { value: 'pulmonary_artery_enlargement', label: 'Pulmonary artery enlargement' },
            { value: 'pleural_effusion', label: 'Pleural effusion' },
            { value: 'gastric_volvulus', label: 'Gastric volvulus' },
            { value: 'cardiomegaly', label: 'Cardiomegaly' },
            { value: 'other', label: 'Other' },
        ],
    },
];

export function InferenceForm({ onSubmit, isComputing, inputMode, onModeChange }: InferenceFormProps) {
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
                            <div className="border-t border-grid p-3 sm:p-4 space-y-5">
                                <DiagnosticFieldset title="CBC Panel" fields={CBC_FIELDS} />
                                <div>
                                    <TerminalLabel htmlFor="diag_cbc_packed_cell_volume_percent">Packed Cell Volume Percent</TerminalLabel>
                                    <TerminalInput
                                        id="diag_cbc_packed_cell_volume_percent"
                                        name="diag_cbc_packed_cell_volume_percent"
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.1"
                                        placeholder="Optional"
                                    />
                                </div>
                                <DiagnosticFieldset title="Serology / Infectious Tests" fields={SEROLOGY_FIELDS} />
                                <DiagnosticFieldset title="Urinalysis" fields={URINALYSIS_FIELDS} />
                                <DiagnosticFieldset title="Imaging" fields={IMAGING_FIELDS} />
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

function DiagnosticFieldset({ title, fields }: { title: string; fields: DiagnosticSelectField[] }) {
    return (
        <fieldset className="space-y-3">
            <legend className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted mb-2">{title}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {fields.map((field) => (
                    <DiagnosticSelect key={field.name} field={field} />
                ))}
            </div>
        </fieldset>
    );
}

function DiagnosticSelect({ field }: { field: DiagnosticSelectField }) {
    return (
        <label className="block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted mb-1.5">{field.label}</span>
            <select
                name={field.name}
                defaultValue=""
                className="w-full bg-[hsl(0_0%_8%_/_0.9)] border border-[hsl(0_0%_100%_/_0.08)] px-3 py-2.5 font-mono text-[13px] text-[hsl(0_0%_94%)] focus:outline-none focus:border-accent/60 focus:bg-[hsl(0_0%_10%)] transition-colors"
            >
                <option value="">Unspecified</option>
                {field.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
        </label>
    );
}
