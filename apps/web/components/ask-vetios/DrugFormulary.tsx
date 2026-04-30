'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pill, Printer } from 'lucide-react';
import {
    detectSpeciesFromTexts,
    isVetiosSpecies,
    type DetectedVetiosSpecies,
    type VetiosSpecies,
    VETIOS_SPECIES,
} from '@/lib/askVetios/context';

type Species = VetiosSpecies;

interface DrugFormularyProps {
    messageContent: string;
    topic?: string;
    queryText?: string;
    messageId?: string;
}

interface PharmacOSDrug {
    name: string;
    brand: string;
    class: string;
    indication: string;
    mechanism: string;
    dose_mg_per_kg: number | string;
    dose_range_low: number;
    dose_range_high: number;
    total_dose_mg: number | string;
    dose_calculation: string;
    volume_calculation: string;
    route: string;
    frequency: string;
    duration: string;
    onset_of_action: string;
    reference: string;
    label_status: 'FDA-approved' | 'extra-label' | 'compounded';
    withdrawal_days: number | null;
    withdrawal_note: string;
    contraindications: string;
    interactions: string;
    adverse_effects: string;
    monitoring: string;
    clinical_commentary: string;
    dose_adjustments: string;
    overdose_management: string;
    compounding_note: string;
    pk: {
        bioavailability: string;
        half_life_hours: number;
        volume_of_distribution: string;
        protein_binding: string;
        metabolism: string;
        excretion: string;
        species_note: string;
    };
}

interface PharmacOSPayload {
    species: Species;
    condition: string;
    patient_weight_kg: number;
    protocol_phase: 'complete';
    drugs: PharmacOSDrug[];
    treatment_protocol: {
        phase1_stabilization: string;
        phase2_active_treatment: string;
        phase3_recovery: string;
        fluid_therapy: string;
        nutritional_support: string;
        discharge_criteria: string;
    };
    interaction_warnings: string[];
    total_drugs: number;
    protocol_source: string;
    summary?: string;
}

const SPECIES_ORDER: Species[] = [...VETIOS_SPECIES];

function buildFallbackPayload(messageContent: string, topic?: string, queryText?: string): PharmacOSPayload {
    const detected: DetectedVetiosSpecies = detectSpeciesFromTexts([queryText, topic, messageContent]);
    const species = isVetiosSpecies(detected) ? detected : 'canine';
    const condition = topic?.trim() || 'Current VetIOS treatment context';
    const patientWeightKg = extractWeightKg([queryText, topic, messageContent].filter(Boolean).join(' ')) ?? 10;
    return {
        species,
        condition,
        patient_weight_kg: patientWeightKg,
        protocol_phase: 'complete',
        drugs: [],
        treatment_protocol: {
            phase1_stabilization: 'Triage and stabilize airway, breathing, circulation, hydration, pain, and red flags before drug escalation.',
            phase2_active_treatment: 'Name a drug or condition-specific treatment protocol to resolve PharmacOS dosing.',
            phase3_recovery: 'Transition to oral/home care only after clinical stability and clinician verification.',
            fluid_therapy: 'Build a fluid plan from deficit, maintenance, ongoing losses, and comorbid renal/cardiac status.',
            nutritional_support: 'Prefer enteral nutrition as soon as safe.',
            discharge_criteria: 'Stable vitals, owner medication plan, monitoring plan, and no unresolved emergency findings.',
        },
        interaction_warnings: [],
        total_drugs: 0,
        protocol_source: 'VetIOS PharmacOS local resolver',
        summary: 'No medication candidates have been resolved yet.',
    };
}

function extractWeightKg(text: string) {
    const explicit = text.match(/\b(?:weight|wt|patient weight|patient_weight_kg)\D{0,24}(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i);
    const generic = explicit ?? text.match(/\b(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i);
    if (!generic?.[1]) return null;
    const value = Number(generic[1]);
    return Number.isFinite(value) && value > 0 ? Math.min(value, 2500) : null;
}

function formatValue(value: number | string, suffix = '') {
    if (typeof value === 'number') return `${value}${suffix}`;
    return suffix && !/[a-zA-Z]/.test(value) ? `${value}${suffix}` : value;
}

function statusClasses(status: PharmacOSDrug['label_status']) {
    if (status === 'FDA-approved') return 'border-[#00ff88]/25 bg-[#00ff88]/10 text-[#00ff88]';
    if (status === 'compounded') return 'border-blue-400/20 bg-blue-400/10 text-blue-200';
    return 'border-amber-400/20 bg-amber-400/10 text-amber-200';
}

export default function DrugFormulary({ messageContent, topic, queryText, messageId }: DrugFormularyProps) {
    const fallback = useMemo(() => buildFallbackPayload(messageContent, topic, queryText), [messageContent, queryText, topic]);
    const [payload, setPayload] = useState<PharmacOSPayload>(fallback);
    const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [selectedSpecies, setSelectedSpecies] = useState<Species>(fallback.species);
    const [weightKg, setWeightKg] = useState('10');

    useEffect(() => {
        setSelectedSpecies(fallback.species);
        setPayload(fallback);
        setWeightKg((fallback.patient_weight_kg || 10).toString());
    }, [fallback, messageId]);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            const parsedWeight = Number.parseFloat(weightKg);
            setStatus('loading');

            try {
                const response = await fetch('/api/ask-vetios/drug-formulary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        topic,
                        messageContent,
                        queryText,
                        selectedSpecies,
                        patientWeightKg: Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : undefined,
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Request failed with ${response.status}`);
                }

                const data = (await response.json()) as PharmacOSPayload;
                if (!cancelled) {
                    setPayload({
                        ...fallback,
                        ...data,
                        drugs: Array.isArray(data.drugs) ? data.drugs : [],
                        interaction_warnings: Array.isArray(data.interaction_warnings) ? data.interaction_warnings : [],
                        treatment_protocol: data.treatment_protocol ?? fallback.treatment_protocol,
                    });
                    setStatus('ready');
                }
            } catch {
                if (!cancelled) {
                    setPayload(fallback);
                    setStatus('error');
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [fallback, messageContent, queryText, selectedSpecies, topic, weightKg]);

    const weightValue = Number.parseFloat(weightKg);
    const warnings = useMemo(() => Array.from(new Set(payload.interaction_warnings.filter(Boolean))), [payload.interaction_warnings]);

    const handleExportPdf = () => {
        const win = window.open('', '_blank', 'noopener,noreferrer,width=980,height=760');
        if (!win) return;

        const rows = payload.drugs.map((drug) => `
            <tr>
                <td>${drug.name}</td>
                <td>${drug.class}</td>
                <td>${formatValue(drug.dose_mg_per_kg, ' mg/kg')}</td>
                <td>${formatValue(drug.total_dose_mg, ' mg')}</td>
                <td>${drug.route}</td>
                <td>${drug.frequency}</td>
                <td>${drug.reference}</td>
            </tr>
        `).join('');

        win.document.write(`
            <html>
                <head>
                    <title>VetIOS PharmacOS Export</title>
                    <style>
                        body { font-family: "JetBrains Mono", monospace; background: #ffffff; color: #111111; padding: 24px; }
                        h1 { font-size: 18px; text-transform: uppercase; letter-spacing: 0.18em; }
                        h2 { font-size: 13px; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.12em; }
                        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                        th, td { border: 1px solid #d1d5db; padding: 9px; font-size: 11px; text-align: left; vertical-align: top; }
                        th { background: #f3f4f6; text-transform: uppercase; letter-spacing: 0.12em; font-size: 9px; }
                        .meta, p { font-size: 11px; line-height: 1.5; }
                    </style>
                </head>
                <body>
                    <h1>VetIOS PharmacOS</h1>
                    <div class="meta">Species: ${payload.species}</div>
                    <div class="meta">Condition: ${payload.condition}</div>
                    <div class="meta">Weight: ${Number.isFinite(weightValue) ? `${weightValue.toFixed(1)} kg` : `${payload.patient_weight_kg} kg`}</div>
                    <div class="meta">Source: ${payload.protocol_source}</div>
                    <table>
                        <thead>
                            <tr>
                                <th>Drug</th>
                                <th>Class</th>
                                <th>Dose</th>
                                <th>Total</th>
                                <th>Route</th>
                                <th>Frequency</th>
                                <th>Reference</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                    <h2>Treatment Protocol</h2>
                    <p>${payload.treatment_protocol.phase1_stabilization}</p>
                    <p>${payload.treatment_protocol.phase2_active_treatment}</p>
                    <p>${payload.treatment_protocol.phase3_recovery}</p>
                </body>
            </html>
        `);
        win.document.close();
        win.focus();
        win.print();
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Pill className="h-4 w-4 text-[#00ff88]" />
                        <h3 className="font-mono text-xs uppercase tracking-[0.22em] text-[#00ff88]">
                            VetIOS PharmacOS Drug Doses
                        </h3>
                    </div>
                    <p className="max-w-3xl font-mono text-[11px] leading-relaxed text-white/58">
                        {payload.summary}
                    </p>
                </div>

                <button
                    type="button"
                    onClick={handleExportPdf}
                    className="inline-flex items-center gap-2 border border-[#00ff88]/20 bg-[#00ff88]/6 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#00ff88] transition-colors hover:bg-[#00ff88]/12"
                >
                    <Printer className="h-3 w-3" />
                    Export PDF
                </button>
            </div>

            {status === 'loading' && (
                <div className="border border-white/10 bg-white/[0.02] px-4 py-3 font-mono text-[11px] text-white/54">
                    Resolving species, condition, drug candidates, dose calculations, and cross-drug warnings...
                </div>
            )}

            {status === 'error' && (
                <div className="border border-amber-500/20 bg-amber-500/6 px-4 py-3 font-mono text-[11px] leading-relaxed text-amber-200/80">
                    PharmacOS enrichment did not complete. Add explicit species, condition, patient weight, and drug names, then retry.
                </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.8fr)]">
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {SPECIES_ORDER.map((species) => (
                            <button
                                key={species}
                                type="button"
                                onClick={() => setSelectedSpecies(species)}
                                className={`border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                                    selectedSpecies === species
                                        ? 'border-[#00ff88]/40 bg-[#00ff88]/12 text-[#00ff88]'
                                        : 'border-white/10 bg-white/[0.02] text-white/56 hover:border-white/20 hover:text-white/82'
                                }`}
                            >
                                {species}
                            </button>
                        ))}
                    </div>

                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Patient Weight</div>
                        <div className="mt-3 flex items-center gap-3">
                            <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={weightKg}
                                onChange={(event) => setWeightKg(event.target.value)}
                                className="w-32 border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:border-[#00ff88]/40"
                            />
                            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/48">kg</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {payload.drugs.length > 0 ? payload.drugs.map((drug) => (
                            <div key={drug.name} className="space-y-3 border border-white/10 bg-white/[0.02] p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">
                                            {drug.class}
                                        </div>
                                        <div className="mt-1 break-words font-mono text-[12px] uppercase tracking-[0.14em] text-[#00ff88]">
                                            {drug.name}{drug.brand ? ` (${drug.brand})` : ''}
                                        </div>
                                        <p className="mt-2 max-w-3xl font-mono text-[11px] leading-relaxed text-white/66">
                                            {drug.indication}
                                        </p>
                                    </div>
                                    <div className={`border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] ${statusClasses(drug.label_status)}`}>
                                        {drug.label_status}
                                    </div>
                                </div>

                                <p className="font-mono text-[11px] leading-relaxed text-white/58">
                                    {drug.mechanism}
                                </p>

                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                    <Metric label="Dose" value={formatValue(drug.dose_mg_per_kg, ' mg/kg')} />
                                    <Metric label="Total Dose" value={formatValue(drug.total_dose_mg, ' mg')} />
                                    <Metric label="Route" value={drug.route} />
                                    <Metric label="Frequency" value={drug.frequency} />
                                    <Metric label="Duration" value={drug.duration} />
                                    <Metric label="Onset" value={drug.onset_of_action} />
                                    <Metric label="Withdrawal" value={drug.withdrawal_days == null ? drug.withdrawal_note : `${drug.withdrawal_days} days`} />
                                    <Metric label="Half-life" value={drug.pk.half_life_hours > 0 ? `${drug.pk.half_life_hours} h` : 'species/formulation review'} />
                                </div>

                                <div className="grid gap-3 lg:grid-cols-2">
                                    <InfoBlock title="Dose Calculation" text={`${drug.dose_calculation} ${drug.volume_calculation}`} />
                                    <InfoBlock title="Reference" text={drug.reference} />
                                    <InfoBlock title="PK" text={`Bioavailability: ${drug.pk.bioavailability} Metabolism: ${drug.pk.metabolism} Excretion: ${drug.pk.excretion} Protein binding: ${drug.pk.protein_binding}. ${drug.pk.species_note}`} />
                                    <InfoBlock title="Monitoring" text={drug.monitoring} />
                                    <InfoBlock title="Contraindications" text={drug.contraindications} danger />
                                    <InfoBlock title="Interactions" text={drug.interactions} warning />
                                    <InfoBlock title="Adverse Effects" text={drug.adverse_effects} />
                                    <InfoBlock title="Adjustments / Overdose" text={`${drug.dose_adjustments} Overdose: ${drug.overdose_management}`} />
                                </div>

                                <InfoBlock title="Clinical Commentary" text={`${drug.clinical_commentary} Compounding: ${drug.compounding_note}`} />
                            </div>
                        )) : (
                            <div className="border border-dashed border-white/10 bg-black/20 px-4 py-5 font-mono text-[11px] text-white/48">
                                No medication candidates were resolved for the current response.
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Interaction Warnings</div>
                        <div className="mt-3 space-y-2">
                            {warnings.length > 0 ? warnings.map((warning) => (
                                <div key={warning} className="border border-amber-500/20 bg-amber-500/6 px-3 py-2 font-mono text-[11px] leading-relaxed text-amber-100/84">
                                    {warning}
                                </div>
                            )) : (
                                <p className="font-mono text-[11px] text-white/48">
                                    No cross-drug interaction warnings were returned for the current drug list.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">PharmacOS Status</div>
                        <div className="mt-3 space-y-2 font-mono text-[11px] text-white/64">
                            <div>Mode: {status === 'loading' ? 'loading' : status === 'error' ? 'fallback' : 'live'}</div>
                            <div>Species: {payload.species}</div>
                            <div>Condition: {payload.condition}</div>
                            <div>Weight: {payload.patient_weight_kg} kg</div>
                            <div>Drugs resolved: {payload.total_drugs}</div>
                        </div>
                    </div>

                    <div className="space-y-3 border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Complete Treatment Protocol</div>
                        <InfoBlock title="0-6 Hours" text={payload.treatment_protocol.phase1_stabilization} />
                        <InfoBlock title="6-72 Hours" text={payload.treatment_protocol.phase2_active_treatment} />
                        <InfoBlock title="72h+" text={payload.treatment_protocol.phase3_recovery} />
                        <InfoBlock title="Fluid Therapy" text={payload.treatment_protocol.fluid_therapy} />
                        <InfoBlock title="Nutrition" text={payload.treatment_protocol.nutritional_support} />
                        <InfoBlock title="Discharge" text={payload.treatment_protocol.discharge_criteria} />
                        <div className="border border-white/10 bg-black/25 px-3 py-2 font-mono text-[10px] leading-relaxed text-white/44">
                            {payload.protocol_source}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-h-[72px] border border-white/8 bg-black/25 px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">{label}</div>
            <div className="mt-1 break-words font-mono text-[11px] leading-relaxed text-white/76">{value}</div>
        </div>
    );
}

function InfoBlock({ title, text, danger, warning }: { title: string; text: string; danger?: boolean; warning?: boolean }) {
    const tone = danger
        ? 'border-red-500/20 bg-red-500/6 text-red-100/84'
        : warning
            ? 'border-amber-500/20 bg-amber-500/6 text-amber-100/84'
            : 'border-white/10 bg-black/25 text-white/60';
    const titleTone = danger ? 'text-red-300' : warning ? 'text-amber-300' : 'text-white/34';
    return (
        <div className={`space-y-2 border p-3 ${tone}`}>
            <div className={`font-mono text-[10px] uppercase tracking-[0.18em] ${titleTone}`}>{title}</div>
            <p className="break-words font-mono text-[11px] leading-relaxed">{text}</p>
        </div>
    );
}
