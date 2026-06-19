'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react';
import { normalizeInferenceInput } from '@/lib/input/inputNormalizer';
import { VoiceInputButton } from '@/components/voice/VoiceInputButton';
import type { ExtractedClinicalFields, VoiceAgeUnit, VoiceSex, VoiceSpecies } from '@/lib/voice/types';
import type { ClinicalInferenceInput } from './clinicalTypes';

interface ClinicalCaseFormProps {
    onSubmit: (normalizedInput: ClinicalInferenceInput) => void;
    isLoading: boolean;
    initialDraft?: ClinicalCaseFormDraft;
    onClearDraft?: () => void;
}

const SPECIES = ['Canine', 'Feline', 'Equine', 'Bovine', 'Avian', 'Other'];
const SEXES = ['Male intact', 'Male neutered', 'Female intact', 'Female spayed'];
const LABS = ['WBC', 'PCV', 'BUN', 'Creatinine', 'Glucose'];

export interface ClinicalCaseFormDraft {
    patient?: Partial<{
        species: string;
        breed: string;
        age: string;
        ageUnit: string;
        sex: string;
    }>;
    signs?: Partial<{
        symptoms: string;
        duration: string;
        durationUnit: string;
        severity: string;
    }>;
    labs?: Record<string, string>;
}

interface VoiceCaptureContext {
    raw_transcript: string;
    extraction_confidence?: number;
    extraction_notes?: string[];
    source: 'vetios_voice_mode';
    captured_at: string;
    fallback_used?: boolean;
}

const EMPTY_PATIENT = { species: '', breed: '', age: '', ageUnit: 'years', sex: '' };
const EMPTY_SIGNS = { symptoms: '', duration: '', durationUnit: 'days', severity: 'moderate' };

export function ClinicalCaseForm({ onSubmit, isLoading, initialDraft, onClearDraft }: ClinicalCaseFormProps) {
    const [patient, setPatient] = useState(() => ({ ...EMPTY_PATIENT, ...initialDraft?.patient }));
    const [signs, setSigns] = useState(() => ({ ...EMPTY_SIGNS, ...initialDraft?.signs }));
    const [labs, setLabs] = useState<Record<string, string>>(() => initialDraft?.labs ?? {});
    const [files, setFiles] = useState<FileList | null>(null);
    const [touched, setTouched] = useState<Record<string, boolean>>({});
    const [voiceCapture, setVoiceCapture] = useState<VoiceCaptureContext | null>(null);
    const fileUploadEnabled = process.env.NEXT_PUBLIC_VETIOS_FILE_UPLOAD === 'true';
    const errors = useMemo(() => ({
        species: !patient.species ? "Please select the animal's species" : '',
        symptoms: !signs.symptoms.trim() ? 'Please describe what you are seeing' : '',
    }), [patient.species, signs.symptoms]);
    const hasErrors = Boolean(errors.species || errors.symptoms);
    const readiness = useMemo(() => getReadiness(patient, signs), [patient, signs]);

    useEffect(() => {
        if (!initialDraft) return;
        setPatient({ ...EMPTY_PATIENT, ...initialDraft.patient });
        setSigns({ ...EMPTY_SIGNS, ...initialDraft.signs });
        setLabs(initialDraft.labs ?? {});
        setTouched({
            species: Boolean(initialDraft.patient?.species),
            symptoms: Boolean(initialDraft.signs?.symptoms),
        });
        setVoiceCapture(null);
    }, [initialDraft]);

    function applyVoiceFields(fields: ExtractedClinicalFields) {
        setVoiceCapture(buildVoiceCaptureContext(fields));
        setPatient((current) => ({
            ...current,
            species: speciesToFormValue(fields.species) ?? current.species,
            breed: fields.breed ?? current.breed,
            age: ageToFormValue(fields.age_value, fields.age_unit)?.value ?? current.age,
            ageUnit: ageToFormValue(fields.age_value, fields.age_unit)?.unit ?? current.ageUnit,
            sex: sexToFormValue(fields.sex) ?? current.sex,
        }));
        setSigns((current) => ({
            ...current,
            symptoms: fields.symptoms.length > 0 ? fields.symptoms.join(', ') : current.symptoms,
            duration: fields.duration_value ? String(fields.duration_value) : current.duration,
            durationUnit: fields.duration_unit ?? current.durationUnit,
            severity: fields.severity ?? current.severity,
        }));
        const labValues = labsToFormValues(fields.labs);
        if (Object.keys(labValues).length > 0) {
            setLabs((current) => ({ ...current, ...labValues }));
        }
        setTouched((current) => ({ ...current, species: true, symptoms: true }));
    }

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setTouched({ species: true, symptoms: true });
        if (hasErrors) return;
        const ageYears = parseAge(patient.age, patient.ageUnit);
        const labValues = Object.fromEntries(
            LABS.map((label) => [label.toLowerCase(), numberOrNull(labs[label])]).filter(([, value]) => value !== null),
        );
        const raw = {
            species: patient.species.toLowerCase(),
            breed: patient.breed.trim() || undefined,
            symptoms: splitSymptoms(signs.symptoms),
            age_years: ageYears,
            diagnostic_tests: { labs: labValues },
            metadata: {
                age_years: ageYears,
                sex: patient.sex,
                duration_text: signs.duration ? `${signs.duration} ${signs.durationUnit}` : undefined,
                severity: signs.severity,
                presenting_complaint: signs.symptoms.trim(),
                labs: labValues,
                voice_context: voiceCapture ?? undefined,
                uploaded_files: files ? Array.from(files).map((file) => file.name) : undefined,
            },
        };
        onSubmit(normalizeInferenceInput(JSON.stringify(raw), 'json'));
    }

    function clearDraft() {
        setPatient(EMPTY_PATIENT);
        setSigns(EMPTY_SIGNS);
        setLabs({});
        setTouched({});
        setVoiceCapture(null);
        onClearDraft?.();
    }

    return (
        <form onSubmit={submit} className="space-y-5">
            <VoiceInputButton surface="case_intake" onExtracted={applyVoiceFields} label="Dictate case intake" />
            <section className="rounded-lg border border-accent/20 bg-accent/[0.035] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                            First case readiness
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-white/68">
                            Fill species and clinical signs to unlock diagnosis. Age, sex, duration, and labs improve ranking quality.
                        </p>
                    </div>
                    <div className="min-w-[160px]">
                        <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
                            <span>{readiness.label}</span>
                            <span>{readiness.percent}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${readiness.percent}%` }} />
                        </div>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    {readiness.items.map((item) => (
                        <span
                            key={item.label}
                            className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
                                item.done
                                    ? 'border-accent/45 bg-accent/10 text-accent'
                                    : 'border-white/12 bg-white/[0.03] text-white/45'
                            }`}
                        >
                            {item.label}
                        </span>
                    ))}
                </div>
                {initialDraft ? (
                    <button
                        type="button"
                        onClick={clearDraft}
                        className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-white/45 transition hover:text-white"
                    >
                        Clear demo draft
                    </button>
                ) : null}
            </section>
            <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                <StepTitle value="1" title="Tell me about the patient" />
                <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Species" error={touched.species ? errors.species : ''}>
                        <select value={patient.species} onBlur={() => touch('species', setTouched)} onChange={(e) => setPatient({ ...patient, species: e.target.value })} className={inputClass()}>
                            <option value="">Select species</option>
                            {SPECIES.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                    </Field>
                    <Field label="Breed optional">
                        <input value={patient.breed} onChange={(e) => setPatient({ ...patient, breed: e.target.value })} className={inputClass()} />
                    </Field>
                    <Field label="Age">
                        <div className="grid grid-cols-[1fr_120px] gap-2">
                            <input type="number" min="0" step="0.1" value={patient.age} onChange={(e) => setPatient({ ...patient, age: e.target.value })} className={inputClass()} />
                            <select value={patient.ageUnit} onChange={(e) => setPatient({ ...patient, ageUnit: e.target.value })} className={inputClass()}>
                                <option>years</option>
                                <option>months</option>
                            </select>
                        </div>
                    </Field>
                    <Field label="Sex">
                        <select value={patient.sex} onChange={(e) => setPatient({ ...patient, sex: e.target.value })} className={inputClass()}>
                            <option value="">Select sex</option>
                            {SEXES.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                    </Field>
                </div>
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                <StepTitle value="2" title="What are you seeing?" />
                <Field label="Symptoms" error={touched.symptoms ? errors.symptoms : ''}>
                    <textarea value={signs.symptoms} onBlur={() => touch('symptoms', setTouched)} onChange={(e) => setSigns({ ...signs, symptoms: e.target.value })} placeholder="e.g. vomiting for 2 days, not eating, seems very tired" className={`${inputClass()} min-h-[110px] resize-y`} />
                </Field>
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_170px]">
                    <Field label="Duration">
                        <div className="grid grid-cols-[1fr_120px] gap-2">
                            <input type="number" min="0" step="1" value={signs.duration} onChange={(e) => setSigns({ ...signs, duration: e.target.value })} className={inputClass()} />
                            <select value={signs.durationUnit} onChange={(e) => setSigns({ ...signs, durationUnit: e.target.value })} className={inputClass()}>
                                <option>hours</option>
                                <option>days</option>
                                <option>weeks</option>
                            </select>
                        </div>
                    </Field>
                    <Field label="Severity">
                        <div className="grid grid-cols-3 gap-1">
                            {['low', 'moderate', 'severe'].map((value) => (
                                <button key={value} type="button" onClick={() => setSigns({ ...signs, severity: value })} className={`${inputClass()} px-2 capitalize ${signs.severity === value ? 'border-accent text-accent' : ''}`}>{value}</button>
                            ))}
                        </div>
                    </Field>
                </div>
            </section>

            <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                <StepTitle value="3" title="Any test results? optional" />
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    {LABS.map((label) => <Field key={label} label={label}><input type="number" step="0.01" placeholder="not tested" value={labs[label] ?? ''} onChange={(e) => setLabs({ ...labs, [label]: e.target.value })} className={inputClass()} /></Field>)}
                </div>
                {fileUploadEnabled ? <input type="file" multiple accept="image/*,.pdf" onChange={(e) => setFiles(e.target.files)} className="mt-4 text-sm text-[hsl(0_0%_72%)]" /> : null}
            </section>

            <button type="submit" disabled={isLoading} className="min-h-[48px] w-full rounded-md border border-accent/65 bg-accent/10 px-5 text-sm font-medium text-accent transition hover:bg-accent hover:text-black disabled:opacity-50">
                {isLoading ? 'Getting diagnosis...' : 'Get diagnosis'}
            </button>
        </form>
    );
}

function getReadiness(
    patient: typeof EMPTY_PATIENT,
    signs: typeof EMPTY_SIGNS,
) {
    const items = [
        { label: 'Species', done: Boolean(patient.species) },
        { label: 'Clinical signs', done: Boolean(signs.symptoms.trim()) },
        { label: 'Duration', done: Boolean(signs.duration) },
        { label: 'Age/Sex', done: Boolean(patient.age || patient.sex) },
    ];
    const percent = Math.round((items.filter((item) => item.done).length / items.length) * 100);
    return {
        items,
        percent,
        label: percent >= 75 ? 'Strong' : percent >= 50 ? 'Ready' : 'Needs basics',
    };
}

function StepTitle({ value, title }: { value: string; title: string }) {
    return <h2 className="mb-4 text-base font-semibold text-white"><span className="mr-2 text-accent">{value}</span>{title}</h2>;
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
    return <label className="block text-sm text-[hsl(0_0%_74%)]">{label}<div className="mt-1">{children}</div>{error ? <div className="mt-1 text-xs text-destructive">{error}</div> : null}</label>;
}

function inputClass() {
    return 'min-h-[42px] w-full rounded-md border border-white/10 bg-[hsl(0_0%_8%)] px-3 text-sm text-white outline-none transition focus:border-accent/60';
}

function touch(key: string, setTouched: Dispatch<SetStateAction<Record<string, boolean>>>) {
    setTouched((current) => ({ ...current, [key]: true }));
}

function parseAge(value: string, unit: string): number | undefined {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return undefined;
    return unit === 'months' ? Number((number / 12).toFixed(2)) : number;
}

function numberOrNull(value: string | undefined): number | null {
    const parsed = Number(value);
    return value && Number.isFinite(parsed) ? parsed : null;
}

function splitSymptoms(value: string): string[] {
    return value.split(/,|\n/).map((entry) => entry.trim()).filter(Boolean);
}

function speciesToFormValue(species: VoiceSpecies | undefined): string | undefined {
    if (!species || species === 'unknown') return undefined;
    if (species === 'exotic') return 'Other';
    return `${species[0]?.toUpperCase() ?? ''}${species.slice(1)}`;
}

function sexToFormValue(sex: VoiceSex | undefined): string | undefined {
    if (!sex || sex === 'unknown') return undefined;
    return sex
        .split('_')
        .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
        .join(' ');
}

function ageToFormValue(value: number | undefined, unit: VoiceAgeUnit | undefined): { value: string; unit: string } | null {
    if (!value || !unit) return null;
    if (unit === 'years') return { value: String(value), unit: 'years' };
    if (unit === 'months') return { value: String(value), unit: 'months' };
    const months = Math.max(0.1, Number((value / 30).toFixed(1)));
    return { value: String(months), unit: 'months' };
}

function labsToFormValues(labs: Record<string, number> | undefined): Record<string, string> {
    if (!labs) return {};
    const mapping: Record<string, string> = {
        wbc: 'WBC',
        pcv: 'PCV',
        hct: 'PCV',
        bun: 'BUN',
        creatinine: 'Creatinine',
        glucose: 'Glucose',
    };
    return Object.fromEntries(
        Object.entries(labs)
            .map(([key, value]) => [mapping[key.toLowerCase()], String(value)] as const)
            .filter(([key]) => Boolean(key)),
    );
}

function buildVoiceCaptureContext(fields: ExtractedClinicalFields): VoiceCaptureContext | null {
    const transcript = fields.raw_transcript?.trim();
    if (!transcript) return null;
    return {
        raw_transcript: transcript,
        extraction_confidence: fields.confidence,
        extraction_notes: fields.extraction_notes,
        source: 'vetios_voice_mode',
        captured_at: new Date().toISOString(),
        fallback_used: fields.fallback_used,
    };
}
