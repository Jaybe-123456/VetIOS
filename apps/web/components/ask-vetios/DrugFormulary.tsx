'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pill, Printer } from 'lucide-react';
import { detectSpeciesFromTexts, isVetiosSpecies, type DetectedVetiosSpecies, type VetiosSpecies, VETIOS_SPECIES } from '@/lib/askVetios/context';

type Species = VetiosSpecies;

interface DrugFormularyProps {
    messageContent: string;
    topic?: string;
    queryText?: string;
    messageId?: string;
}

interface DrugSource {
    type: string;
    label: string;
    url: string;
    evidence: string;
    verified: boolean;
}

interface DrugDose {
    species: Species;
    doseMgPerKgMin: number | null;
    doseMgPerKgMax: number | null;
    route: string;
    frequency: string;
    notes: string;
    withdrawalPeriod: string | null;
    contraindications: string[];
    sourceText?: string;
    sourceBacked?: boolean;
    sources?: DrugSource[];
}

interface DrugEntry {
    name: string;
    drugClass: string;
    indication: string;
    speciesDoses: DrugDose[];
    interactions: string[];
    globalContraindications: string[];
    sources?: DrugSource[];
}

interface FormularyPayload {
    species: DetectedVetiosSpecies;
    drugs: DrugEntry[];
    summary: string;
}

const SPECIES_ORDER: Species[] = [...VETIOS_SPECIES];
const FOOD_ANIMALS = new Set<Species>(['bovine', 'avian', 'porcine', 'ovine']);

const FALLBACK_DRUG_PATTERNS: Array<{ name: string; drugClass: string; patterns: RegExp[] }> = [
    { name: 'Amoxicillin', drugClass: 'Antibiotic', patterns: [/\bamoxicillin\b/i] },
    { name: 'Doxycycline', drugClass: 'Antibiotic', patterns: [/\bdoxycycline\b/i] },
    { name: 'Enrofloxacin', drugClass: 'Antibiotic', patterns: [/\benrofloxacin\b/i] },
    { name: 'Prednisone', drugClass: 'Glucocorticoid', patterns: [/\bpredni(?:sone|solone)\b/i] },
    { name: 'Meloxicam', drugClass: 'NSAID', patterns: [/\bmeloxicam\b/i] },
    { name: 'Maropitant', drugClass: 'Antiemetic', patterns: [/\bmaropitant\b/i, /\bcerenia\b/i] },
    { name: 'Fenbendazole', drugClass: 'Anthelmintic', patterns: [/\bfenbendazole\b/i] },
    { name: 'Gabapentin', drugClass: 'Analgesic', patterns: [/\bgabapentin\b/i] },
];

function buildFallbackPayload(messageContent: string, topic?: string, queryText?: string): FormularyPayload {
    const species = detectSpeciesFromTexts([queryText, topic, messageContent]);
    const searchText = [queryText, topic, messageContent].filter(Boolean).join(' ');
    const detected = FALLBACK_DRUG_PATTERNS.filter((drug) => drug.patterns.some((pattern) => pattern.test(searchText)));
    const drugs: DrugEntry[] = detected.map((drug) => ({
        name: drug.name,
        drugClass: drug.drugClass,
        indication: topic?.trim() || 'Current case context',
        speciesDoses: SPECIES_ORDER.map((currentSpecies) => ({
            species: currentSpecies,
            doseMgPerKgMin: null,
            doseMgPerKgMax: null,
            route: 'See formulary source',
            frequency: 'See formulary source',
            notes: 'Source-backed public label dosing is unavailable in fallback mode.',
            withdrawalPeriod: FOOD_ANIMALS.has(currentSpecies) ? 'Check labeled withdrawal period before use.' : null,
            contraindications: ['Verify species-specific dose before administration.'],
            sourceText: 'No source-backed public label was resolved in fallback mode.',
            sourceBacked: false,
            sources: [],
        })),
        interactions: detected.length > 1 ? [`Review ${drug.name} against the other extracted agents before dispensing.`] : [],
        globalContraindications: ['Fallback mode active: confirm published dose ranges manually.'],
        sources: [],
    }));

    return {
        species,
        drugs,
        summary: drugs.length > 0
            ? 'Fallback extraction found drug mentions, but structured dose ranges are unavailable.'
            : 'No medication candidates were extracted from the current response.',
    };
}

function formatDoseRange(dose: DrugDose) {
    if (dose.doseMgPerKgMin == null && dose.doseMgPerKgMax == null) return 'Source-backed mg/kg unavailable';
    if (dose.doseMgPerKgMin != null && dose.doseMgPerKgMax != null) {
        return `${dose.doseMgPerKgMin.toFixed(2)}-${dose.doseMgPerKgMax.toFixed(2)} mg/kg`;
    }
    const value = dose.doseMgPerKgMin ?? dose.doseMgPerKgMax ?? 0;
    return `${value.toFixed(2)} mg/kg`;
}

function calculateTotalDose(weightKg: number, dose: DrugDose) {
    if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
    if (dose.doseMgPerKgMin == null && dose.doseMgPerKgMax == null) return null;
    const min = dose.doseMgPerKgMin != null ? weightKg * dose.doseMgPerKgMin : null;
    const max = dose.doseMgPerKgMax != null ? weightKg * dose.doseMgPerKgMax : null;

    if (min != null && max != null) return `${min.toFixed(1)}-${max.toFixed(1)} mg total`;
    const value = min ?? max ?? 0;
    return `${value.toFixed(1)} mg total`;
}

export default function DrugFormulary({ messageContent, topic, queryText, messageId }: DrugFormularyProps) {
    const fallback = useMemo(() => buildFallbackPayload(messageContent, topic, queryText), [messageContent, queryText, topic]);
    const [payload, setPayload] = useState<FormularyPayload>(fallback);
    const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [selectedSpecies, setSelectedSpecies] = useState<Species>(isVetiosSpecies(fallback.species) ? fallback.species : 'canine');
    const [weightKg, setWeightKg] = useState('10');

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setPayload(fallback);
            setSelectedSpecies(isVetiosSpecies(fallback.species) ? fallback.species : 'canine');
            setStatus('loading');

            try {
                const response = await fetch('/api/ask-vetios/drug-formulary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic, messageContent, queryText }),
                });

                if (!response.ok) {
                    throw new Error(`Request failed with ${response.status}`);
                }

                const data = (await response.json()) as FormularyPayload;
                if (!cancelled) {
                    const next = {
                        species: data.species || fallback.species,
                        drugs: Array.isArray(data.drugs) ? data.drugs : fallback.drugs,
                        summary: data.summary || fallback.summary,
                    };
                    setPayload(next);
                    setSelectedSpecies(isVetiosSpecies(next.species) ? next.species : 'canine');
                    setStatus('ready');
                }
            } catch {
                if (!cancelled) {
                    setPayload(fallback);
                    setSelectedSpecies(isVetiosSpecies(fallback.species) ? fallback.species : 'canine');
                    setStatus('error');
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [fallback, messageContent, messageId, queryText, topic]);

    const weightValue = Number.parseFloat(weightKg);
    const crossDrugWarnings = useMemo(
        () => Array.from(new Set(payload.drugs.flatMap((drug) => drug.interactions).filter(Boolean))),
        [payload.drugs],
    );

    const handleExportPdf = () => {
        const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
        if (!win) return;

        const rows = payload.drugs.map((drug) => {
            const dose = drug.speciesDoses.find((item) => item.species === selectedSpecies);

            return `
                <tr>
                    <td>${drug.name}</td>
                    <td>${drug.drugClass}</td>
                    <td>${dose ? formatDoseRange(dose) : 'source-backed dose unavailable'}</td>
                    <td>${dose ? calculateTotalDose(weightValue, dose) ?? 'n/a' : 'n/a'}</td>
                    <td>${dose?.route ?? 'n/a'}</td>
                    <td>${dose?.frequency ?? 'n/a'}</td>
                    <td>${dose?.withdrawalPeriod ?? 'n/a'}</td>
                </tr>
            `;
        }).join('');

        win.document.write(`
            <html>
                <head>
                    <title>VetIOS Formulary Export</title>
                    <style>
                        body { font-family: "JetBrains Mono", monospace; background: #ffffff; color: #111111; padding: 24px; }
                        h1 { font-size: 18px; text-transform: uppercase; letter-spacing: 0.2em; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #d1d5db; padding: 10px; font-size: 12px; text-align: left; vertical-align: top; }
                        th { background: #f3f4f6; text-transform: uppercase; letter-spacing: 0.14em; font-size: 10px; }
                        .meta { margin-top: 12px; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <h1>VetIOS Prescription Template</h1>
                    <div class="meta">Species: ${selectedSpecies}</div>
                    <div class="meta">Weight: ${Number.isFinite(weightValue) ? `${weightValue.toFixed(1)} kg` : 'n/a'}</div>
                    <div class="meta">Context: ${payload.summary}</div>
                    <table>
                        <thead>
                            <tr>
                                <th>Drug</th>
                                <th>Class</th>
                                <th>Dose Range</th>
                                <th>Total Dose</th>
                                <th>Route</th>
                                <th>Frequency</th>
                                <th>Withdrawal</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
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
                            Species-Aware Drug Formulary
                        </h3>
                    </div>
                    <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-white/58">
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
                    Extracting drug mentions and building species-specific dose tables...
                </div>
            )}

            {status === 'error' && (
                <div className="border border-amber-500/20 bg-amber-500/6 px-4 py-3 font-mono text-[11px] leading-relaxed text-amber-200/80">
                    Source-backed formulary enrichment is unavailable right now. The panel is showing local extraction only.
                </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(240px,0.8fr)]">
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
                        {payload.drugs.length > 0 ? payload.drugs.map((drug) => {
                            const dose = drug.speciesDoses.find((item) => item.species === selectedSpecies);
                            const sourceList = dose?.sources?.length ? dose.sources : drug.sources ?? [];
                            const warnings = Array.from(new Set([...drug.globalContraindications, ...(dose?.contraindications ?? [])])).slice(0, 4);

                            return (
                                <div key={drug.name} className="space-y-3 border border-white/10 bg-white/[0.02] p-3">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">
                                                {drug.drugClass}
                                            </div>
                                            <div className="mt-1 font-mono text-[12px] uppercase tracking-[0.14em] text-[#00ff88]">
                                                {drug.name}
                                            </div>
                                            <p className="mt-2 font-mono text-[11px] leading-relaxed text-white/66">
                                                {drug.indication}
                                            </p>
                                        </div>
                                        <div className="border border-white/10 bg-black/30 px-3 py-2">
                                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Dose</div>
                                            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/76">
                                                {dose ? formatDoseRange(dose) : 'Source-backed dose unavailable'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                        <div className="border border-white/8 bg-black/25 px-3 py-2">
                                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Total Dose</div>
                                            <div className="mt-1 font-mono text-[11px] text-white/76">
                                                {dose ? calculateTotalDose(weightValue, dose) ?? 'Source-backed mg/kg unavailable' : 'No source for species'}
                                            </div>
                                        </div>
                                        <div className="border border-white/8 bg-black/25 px-3 py-2">
                                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Route</div>
                                            <div className="mt-1 font-mono text-[11px] text-white/76">{dose?.route ?? 'n/a'}</div>
                                        </div>
                                        <div className="border border-white/8 bg-black/25 px-3 py-2">
                                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Frequency</div>
                                            <div className="mt-1 font-mono text-[11px] text-white/76">{dose?.frequency ?? 'n/a'}</div>
                                        </div>
                                        <div className="border border-white/8 bg-black/25 px-3 py-2">
                                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Withdrawal</div>
                                            <div className="mt-1 max-h-24 overflow-y-auto font-mono text-[11px] leading-relaxed text-white/76">
                                                {dose?.withdrawalPeriod ?? (FOOD_ANIMALS.has(selectedSpecies) ? 'Check FARAD/VetGRAM and product label' : 'n/a')}
                                            </div>
                                        </div>
                                    </div>

                                    {dose?.notes && (
                                        <p className="max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed text-white/58">
                                            {dose.notes}
                                        </p>
                                    )}

                                    {sourceList.length > 0 && (
                                        <div className="space-y-2 border border-white/10 bg-black/25 p-3">
                                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">Verified Sources</div>
                                            <div className="flex flex-wrap gap-2">
                                                {sourceList.map((source) => (
                                                    <a
                                                        key={`${drug.name}-${source.type}-${source.url}`}
                                                        href={source.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors ${
                                                            source.verified
                                                                ? 'border-[#00ff88]/22 bg-[#00ff88]/8 text-[#00ff88] hover:bg-[#00ff88]/12'
                                                                : 'border-white/10 bg-white/[0.02] text-white/50 hover:text-white'
                                                        }`}
                                                    >
                                                        {source.type}
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {warnings.length > 0 && (
                                        <div className="space-y-2 border border-red-500/20 bg-red-500/6 p-3">
                                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-red-300">Contraindications</div>
                                            {warnings.map((warning) => (
                                                <div key={`${drug.name}-${warning}`} className="font-mono text-[11px] leading-relaxed text-red-200/84">
                                                    {warning}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        }) : (
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
                            {crossDrugWarnings.length > 0 ? crossDrugWarnings.map((warning) => (
                                <div key={warning} className="border border-amber-500/20 bg-amber-500/6 px-3 py-2 font-mono text-[11px] leading-relaxed text-amber-100/84">
                                    {warning}
                                </div>
                            )) : (
                                <p className="font-mono text-[11px] text-white/48">
                                    No cross-drug interaction warnings were returned for the current extraction.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="border border-white/10 bg-white/[0.02] p-3">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Formulary Status</div>
                        <div className="mt-3 space-y-2 font-mono text-[11px] text-white/64">
                            <div>Mode: {status === 'loading' ? 'loading' : status === 'error' ? 'fallback' : 'live'}</div>
                            <div>Detected species: {payload.species}</div>
                            <div>Drugs extracted: {payload.drugs.length}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
