'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Activity, Brain, Save } from 'lucide-react';
import { ConsoleCard, TerminalButton, TerminalInput, TerminalLabel, TerminalTextarea } from '@/components/ui/terminal';

const SYSTEMS = ['cardiovascular', 'respiratory', 'gi', 'neurological', 'musculoskeletal', 'skin', 'eyes', 'ears'] as const;
const LAB_FIELDS = ['wbc', 'hct', 'platelets', 'alt', 'alp', 'creatinine', 'bun', 'glucose', 'lipase'] as const;

export function CaseIntakeClient() {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [patient, setPatient] = useState({
        species: 'canine',
        breed: '',
        name: '',
        age_years: '',
        weight_kg: '',
        sex: 'unknown',
        owner_name: '',
        owner_phone: '',
        microchip_id: '',
    });
    const [caseCore, setCaseCore] = useState({
        presenting_complaint: '',
        symptoms: '',
        duration_text: '',
        history: '',
    });
    const [vitals, setVitals] = useState({
        temperature_c: '',
        heart_rate: '',
        respiratory_rate: '',
        mucous_membrane_color: '',
        crt_seconds: '',
        bcs: '',
        pain_score: '',
    });
    const [exam, setExam] = useState<Record<string, string>>(
        Object.fromEntries(SYSTEMS.map((system) => [system, ''])),
    );
    const [labs, setLabs] = useState<Record<string, string>>(
        Object.fromEntries(LAB_FIELDS.map((field) => [field, ''])),
    );

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);

        const payload = {
            patient: {
                species: patient.species,
                breed: emptyToNull(patient.breed),
                name: emptyToNull(patient.name),
                age_years: emptyToNull(patient.age_years),
                weight_kg: emptyToNull(patient.weight_kg),
                sex: patient.sex,
                owner_name: emptyToNull(patient.owner_name),
                owner_contact: { phone: emptyToNull(patient.owner_phone) },
                microchip_id: emptyToNull(patient.microchip_id),
            },
            presenting_complaint: caseCore.presenting_complaint,
            history: emptyToNull(caseCore.history),
            duration_text: emptyToNull(caseCore.duration_text),
            symptoms: splitList(caseCore.symptoms),
            vitals: cleanRecord(vitals),
            physical_exam: cleanRecord(exam),
            labs: cleanRecord(labs, true),
            images: [],
        };

        try {
            const response = await fetch('/api/cases', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(body.detail ?? body.error ?? 'Case creation failed.');
            }
            router.push(`/cases/${body.clinical_case_id}`);
            router.refresh();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Case creation failed.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex flex-col gap-4">
                <ConsoleCard title="Step 1 - Patient">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <Field label="Species">
                            <select value={patient.species} onChange={(event) => setPatient({ ...patient, species: event.target.value })} className={selectClass()}>
                                <option value="canine">Canine</option>
                                <option value="feline">Feline</option>
                                <option value="equine">Equine</option>
                                <option value="bovine">Bovine</option>
                                <option value="avian">Avian</option>
                                <option value="exotic">Exotic</option>
                            </select>
                        </Field>
                        <Field label="Patient Name">
                            <TerminalInput value={patient.name} onChange={(event) => setPatient({ ...patient, name: event.target.value })} />
                        </Field>
                        <Field label="Breed">
                            <TerminalInput value={patient.breed} onChange={(event) => setPatient({ ...patient, breed: event.target.value })} />
                        </Field>
                        <Field label="Age Years">
                            <TerminalInput type="number" step="0.1" value={patient.age_years} onChange={(event) => setPatient({ ...patient, age_years: event.target.value })} />
                        </Field>
                        <Field label="Weight KG">
                            <TerminalInput type="number" step="0.01" value={patient.weight_kg} onChange={(event) => setPatient({ ...patient, weight_kg: event.target.value })} />
                        </Field>
                        <Field label="Sex">
                            <select value={patient.sex} onChange={(event) => setPatient({ ...patient, sex: event.target.value })} className={selectClass()}>
                                <option value="unknown">Unknown</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="male_neutered">Male neutered</option>
                                <option value="female_spayed">Female spayed</option>
                            </select>
                        </Field>
                        <Field label="Owner Name">
                            <TerminalInput value={patient.owner_name} onChange={(event) => setPatient({ ...patient, owner_name: event.target.value })} />
                        </Field>
                        <Field label="Owner Contact">
                            <TerminalInput value={patient.owner_phone} onChange={(event) => setPatient({ ...patient, owner_phone: event.target.value })} />
                        </Field>
                        <Field label="Microchip">
                            <TerminalInput value={patient.microchip_id} onChange={(event) => setPatient({ ...patient, microchip_id: event.target.value })} />
                        </Field>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Step 2 - Complaint And History">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Field label="Presenting Complaint" className="md:col-span-2">
                            <TerminalInput required value={caseCore.presenting_complaint} onChange={(event) => setCaseCore({ ...caseCore, presenting_complaint: event.target.value })} />
                        </Field>
                        <Field label="Active Symptoms">
                            <TerminalInput placeholder="vomiting, lethargy, anorexia" value={caseCore.symptoms} onChange={(event) => setCaseCore({ ...caseCore, symptoms: event.target.value })} />
                        </Field>
                        <Field label="Duration">
                            <TerminalInput placeholder="12 hours" value={caseCore.duration_text} onChange={(event) => setCaseCore({ ...caseCore, duration_text: event.target.value })} />
                        </Field>
                        <Field label="History" className="md:col-span-2">
                            <TerminalTextarea value={caseCore.history} onChange={(event) => setCaseCore({ ...caseCore, history: event.target.value })} />
                        </Field>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Step 3 - Vitals And Exam">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                        {Object.keys(vitals).map((key) => (
                            <Field key={key} label={labelize(key)}>
                                <TerminalInput value={vitals[key as keyof typeof vitals]} onChange={(event) => setVitals({ ...vitals, [key]: event.target.value })} />
                            </Field>
                        ))}
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        {SYSTEMS.map((system) => (
                            <Field key={system} label={`${system} exam`}>
                                <TerminalTextarea value={exam[system]} onChange={(event) => setExam({ ...exam, [system]: event.target.value })} />
                            </Field>
                        ))}
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Step 4 - Labs">
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                        {LAB_FIELDS.map((field) => (
                            <Field key={field} label={field.toUpperCase()}>
                                <TerminalInput type="number" step="0.01" value={labs[field]} onChange={(event) => setLabs({ ...labs, [field]: event.target.value })} />
                            </Field>
                        ))}
                    </div>
                </ConsoleCard>
            </div>

            <div className="flex flex-col gap-4">
                <ConsoleCard title="Step 5 - Run Inference">
                    <div className="flex flex-col gap-3 text-[13px] text-[hsl(0_0%_78%)]">
                        <div className="flex items-start gap-3">
                            <Activity className="mt-0.5 h-4 w-4 text-accent" />
                            <span>The encounter is persisted as an open case and linked to the inference event.</span>
                        </div>
                        <div className="flex items-start gap-3">
                            <Brain className="mt-0.5 h-4 w-4 text-accent" />
                            <span>Closing the case later writes the confirmed diagnosis into the training flywheel.</span>
                        </div>
                    </div>
                    {error && (
                        <div className="border border-destructive/50 bg-destructive/10 p-3 font-mono text-[12px] text-destructive">
                            {error}
                        </div>
                    )}
                    <TerminalButton type="submit" disabled={submitting || !caseCore.presenting_complaint.trim()}>
                        <Save className="mr-2 h-4 w-4" />
                        {submitting ? 'Running...' : 'Get Differential'}
                    </TerminalButton>
                </ConsoleCard>
            </div>
        </form>
    );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={className}>
            <TerminalLabel>{label}</TerminalLabel>
            {children}
        </div>
    );
}

function selectClass(): string {
    return 'h-[42px] w-full border border-[hsl(0_0%_100%_/_0.08)] bg-[hsl(0_0%_8%)] px-3 font-mono text-[13px] text-[hsl(0_0%_94%)] focus:border-accent/60 focus:outline-none';
}

function emptyToNull(value: string): string | null {
    return value.trim() ? value.trim() : null;
}

function splitList(value: string): string[] {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function cleanRecord(record: Record<string, string>, numeric = false): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(record)
            .filter(([, value]) => value.trim().length > 0)
            .map(([key, value]) => [key, numeric ? Number(value) : value.trim()]),
    );
}

function labelize(value: string): string {
    return value.replace(/_/g, ' ');
}
