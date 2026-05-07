import {
    type DrugFormularyRecord,
    type DrugInteractionRecord,
    type OrganAdjustments,
    type SpeciesDosingEntry,
    findSpeciesDosing,
    normalizeDrugName,
    recordMatchesIndication,
} from '../db/drug-formulary';
import {
    type WeightValidationResult,
    validateSpeciesWeight,
} from '../validators/species-weight-guard';

export interface PharmacOSPatientContext {
    renal_disease?: 'mild' | 'moderate' | 'severe' | boolean;
    hepatic_disease?: 'mild' | 'moderate' | 'severe' | boolean;
    age?: 'neonatal' | 'pediatric' | 'adult' | 'geriatric';
    competition_animal?: boolean;
    jurisdiction?: string;
    concurrent_medications?: string[];
    concurrent_conditions?: string[];
}

export interface PharmacOSReasoningInput {
    query?: string;
    species?: string;
    weight_kg?: number;
    indication?: string;
    concurrent_medications?: string[];
    patient_context?: PharmacOSPatientContext;
    max_candidates?: number;
}

export interface DrugCard {
    drug_name: string;
    brand_names: string[];
    drug_class: string;
    regulatory_status: 'fda_approved' | 'ema_approved' | 'extra_label' | 'compounding_only';
    extrapolation?: {
        source_species: string;
        method: string;
        confidence_band_pct: number;
        evidence_gaps: string;
    };
    dose: { min: string; max: string; unit: string };
    dose_with_weight: { min: string; max: string; unit: string; derivation: string };
    adjusted_dose?: { min: string; max: string; unit: string; adjustment_reason: string };
    route: string;
    frequency: string;
    duration: string;
    withdrawal?: { days: number | null; jurisdiction: string; route: string; competition_rules?: string };
    pk: { bioavailability: string; metabolism: string; excretion: string; half_life_hours: number };
    interactions: Array<{
        drug_b: string;
        severity: string;
        mechanism: string;
        management: string;
        evidence_level: string;
    }>;
    n_drug_risk?: string;
    contraindications: Array<{ condition: string; severity: 'absolute' | 'relative' }>;
    monitoring: string[];
    adverse_effects: Array<{ effect: string; frequency: string; severity: string }>;
    organ_adjustments: { renal: object; hepatic: object };
    compounding: { available: boolean; notes: string; xylitol_warning?: boolean };
    clinical_commentary: string;
    alternative_if_unavailable: string;
    reference: string[];
    formulary_version: number;
    weight_warning?: string;
}

export interface PharmacOSReasoningResponse {
    parsed_query: Required<Pick<PharmacOSReasoningInput, 'species' | 'weight_kg' | 'indication'>> & {
        concurrent_medications: string[];
        patient_context: PharmacOSPatientContext;
    };
    validation: WeightValidationResult;
    blocked: boolean;
    correction_prompt?: string;
    cards: DrugCard[];
    warnings: string[];
}

export interface PharmacOSReasoningDeps {
    fetchFormularyRecords?: () => Promise<DrugFormularyRecord[]>;
    fetchInteractions?: () => Promise<DrugInteractionRecord[]>;
    generateCommentary?: (input: ClinicalCommentaryInput) => Promise<string>;
    logValidationEvent?: (event: {
        species: string;
        weight_kg: number;
        validation_result: 'valid' | 'impossible' | 'extreme_outlier';
        message?: string;
        blocked: boolean;
    }) => Promise<void>;
}

export interface ClinicalCommentaryInput {
    record: DrugFormularyRecord;
    dosing: SpeciesDosingEntry;
    species: string;
    weightKg: number;
    indication: string;
    regulatoryStatus: DrugCard['regulatory_status'];
    extrapolation?: DrugCard['extrapolation'];
    expectedResponse: string;
}

const TYPICAL_SPECIES_WEIGHT_KG: Record<string, number> = {
    canine: 20,
    feline: 4.5,
    equine: 500,
    bovine: 600,
    avian: 0.5,
    porcine: 90,
    ovine: 70,
    reptile: 1,
    rabbit: 2.5,
    ferret: 1,
};

const FOOD_OR_COMPETITION_SPECIES = new Set(['equine', 'bovine', 'porcine', 'ovine']);

export async function buildPharmacOSReasoningResponse(
    input: PharmacOSReasoningInput,
    deps: PharmacOSReasoningDeps = {},
): Promise<PharmacOSReasoningResponse> {
    const parsed = parseClinicalQuery(input);
    const validation = validateSpeciesWeight(parsed.species, parsed.weight_kg);
    const invalidValidation = validation.valid ? null : validation;
    const blocked = invalidValidation?.severity === 'impossible';

    await deps.logValidationEvent?.({
        species: parsed.species,
        weight_kg: parsed.weight_kg,
        validation_result: invalidValidation ? invalidValidation.severity : 'valid',
        message: invalidValidation?.message,
        blocked,
    });

    if (blocked) {
        return {
            parsed_query: parsed,
            validation,
            blocked: true,
            correction_prompt: `Correct the ${parsed.species} weight to a physiologic kg value before requesting dose calculations.`,
            cards: [],
            warnings: invalidValidation ? [invalidValidation.message] : [],
        };
    }

    const [records, interactions] = await Promise.all([
        loadRecords(deps.fetchFormularyRecords),
        loadInteractions(deps.fetchInteractions),
    ]);
    const candidates = selectDrugCandidates(records, parsed.indication, parsed.species, parsed.max_candidates);
    const concurrentMeds = parsed.concurrent_medications;
    const activeDrugNames = [...candidates.map((record) => record.drug_name), ...concurrentMeds];
    const nDrugRisk = detectNDrugRisk(activeDrugNames, candidates);
    const cards = await Promise.all(candidates.map(async (record) => {
        const dosing = resolveDosing(record, parsed.species);
        if (!dosing) return null;
        return buildDrugCard(record, dosing, parsed, interactions, nDrugRisk, deps.generateCommentary);
    }));

    const warnings = invalidValidation ? [invalidValidation.message] : [];
    if (nDrugRisk) warnings.push(nDrugRisk);

    return {
        parsed_query: parsed,
        validation,
        blocked: false,
        cards: cards.filter((card): card is DrugCard => card != null),
        warnings,
    };
}

export async function loadFormularyRecordsFromSupabase(client: {
    from: (table: string) => {
        select: (columns: string) => {
            eq: (column: string, value: unknown) => {
                limit: (count: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
            };
        };
    };
}): Promise<DrugFormularyRecord[]> {
    const { data, error } = await client
        .from('drug_formulary')
        .select('*')
        .eq('active', true)
        .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as DrugFormularyRecord[];
}

export async function loadInteractionRecordsFromSupabase(client: {
    from: (table: string) => {
        select: (columns: string) => {
            limit: (count: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
    };
}): Promise<DrugInteractionRecord[]> {
    const { data, error } = await client
        .from('drug_interactions')
        .select('*')
        .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as DrugInteractionRecord[];
}

async function loadRecords(fetchRecords?: () => Promise<DrugFormularyRecord[]>): Promise<DrugFormularyRecord[]> {
    try {
        const records = await fetchRecords?.();
        if (records?.length) return records;
    } catch {
        return FALLBACK_FORMULARY;
    }
    return FALLBACK_FORMULARY;
}

async function loadInteractions(fetchInteractions?: () => Promise<DrugInteractionRecord[]>): Promise<DrugInteractionRecord[]> {
    try {
        const interactions = await fetchInteractions?.();
        if (interactions?.length) return [...FALLBACK_INTERACTIONS, ...interactions];
    } catch {
        return FALLBACK_INTERACTIONS;
    }
    return FALLBACK_INTERACTIONS;
}

function parseClinicalQuery(input: PharmacOSReasoningInput): PharmacOSReasoningResponse['parsed_query'] & { max_candidates: number } {
    const query = input.query ?? '';
    const species = normalizeSpecies(input.species ?? detectSpecies(query) ?? 'canine');
    const weight_kg = normalizeWeight(input.weight_kg) ?? extractWeightKg(query) ?? TYPICAL_SPECIES_WEIGHT_KG[species] ?? 10;
    const indication = input.indication?.trim() || inferIndication(query);
    const patientContext = input.patient_context ?? {};
    const concurrent_medications = Array.from(new Set([
        ...(input.concurrent_medications ?? []),
        ...(patientContext.concurrent_medications ?? []),
        ...extractConcurrentMeds(query),
    ].map((med) => med.trim()).filter(Boolean)));

    return {
        species,
        weight_kg,
        indication,
        concurrent_medications,
        patient_context: patientContext,
        max_candidates: Math.max(1, Math.min(input.max_candidates ?? 6, 12)),
    };
}

function normalizeSpecies(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'horse' || normalized === 'foal' || normalized === 'mare') return 'equine';
    if (normalized === 'dog' || normalized === 'puppy') return 'canine';
    if (normalized === 'cat' || normalized === 'kitten') return 'feline';
    if (normalized === 'cow' || normalized === 'cattle' || normalized === 'calf') return 'bovine';
    if (normalized === 'pig' || normalized === 'swine') return 'porcine';
    if (normalized === 'sheep' || normalized === 'lamb') return 'ovine';
    if (normalized === 'bird' || normalized === 'parrot') return 'avian';
    return normalized;
}

function detectSpecies(text: string): string | null {
    const lower = text.toLowerCase();
    if (/\b(equine|horse|foal|mare|stallion)\b/.test(lower)) return 'equine';
    if (/\b(canine|dog|puppy)\b/.test(lower)) return 'canine';
    if (/\b(feline|cat|kitten)\b/.test(lower)) return 'feline';
    if (/\b(bovine|cow|cattle|calf)\b/.test(lower)) return 'bovine';
    if (/\b(porcine|pig|swine)\b/.test(lower)) return 'porcine';
    if (/\b(ovine|sheep|lamb)\b/.test(lower)) return 'ovine';
    if (/\b(avian|bird|parrot|chicken)\b/.test(lower)) return 'avian';
    if (/\b(reptile|snake|lizard|turtle)\b/.test(lower)) return 'reptile';
    return null;
}

function extractWeightKg(text: string) {
    const explicit = text.match(/\b(?:weight|wt|patient weight)\D{0,24}(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i);
    const generic = explicit ?? text.match(/\b(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i);
    return generic?.[1] ? normalizeWeight(Number(generic[1])) : null;
}

function normalizeWeight(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, 2500) : null;
}

function inferIndication(query: string) {
    const lower = query.toLowerCase();
    if (/\b(colic|pain|analges|lameness|arthritis|inflammation)\b/.test(lower)) return 'pain inflammation analgesia';
    if (/\b(parvo|panleuk|enteritis|diarrhea|gastro)\b/.test(lower)) return 'enteritis supportive care';
    if (/\b(respiratory|pneumonia|brd|shipping fever)\b/.test(lower)) return 'respiratory bacterial infection';
    if (/\bmastitis\b/.test(lower)) return 'mastitis';
    return query.trim().slice(0, 120) || 'current clinical indication';
}

function extractConcurrentMeds(query: string) {
    const medBlock = query.match(/\b(?:with|on|taking|concurrent(?:ly)?(?: with)?|medications?:)\s+([^.;]+)/i)?.[1] ?? '';
    return medBlock
        .split(/,|\+|\band\b/i)
        .map((part) => part.trim())
        .filter((part) => part.length > 2 && !/\b\d/.test(part))
        .slice(0, 8);
}

function selectDrugCandidates(
    records: DrugFormularyRecord[],
    indication: string,
    species: string,
    maxCandidates: number,
) {
    return records
        .filter((record) => record.active !== false)
        .filter((record) => recordMatchesIndication(record, indication))
        .filter((record) => resolveDosing(record, species) != null)
        .sort((left, right) => candidateRank(left, species) - candidateRank(right, species))
        .slice(0, maxCandidates);
}

function candidateRank(record: DrugFormularyRecord, species: string) {
    const dosing = resolveDosing(record, species);
    if (!dosing) return 99;
    if (dosing.is_fda_approved || record.fda_cvm_approved_species?.includes(species)) return 0;
    if (dosing.is_ema_approved || record.ema_cvmp_approved_species?.includes(species)) return 1;
    if (dosing.is_apvma_approved || record.apvma_approved_species?.includes(species)) return 2;
    if (dosing.is_extra_label || dosing.extrapolated_from_species) return 3;
    return 4;
}

function resolveDosing(record: DrugFormularyRecord, species: string) {
    const exact = findSpeciesDosing(record, species);
    if (exact) return exact;
    const source = record.species_dosing.find((entry) => !entry.extrapolated_from_species && hasNumericDose(entry));
    if (!source) return null;
    return {
        ...source,
        species,
        is_fda_approved: false,
        is_ema_approved: false,
        is_apvma_approved: false,
        is_extra_label: true,
        extrapolated_from_species: source.species,
        allometric_method: 'BW^0.75',
    };
}

function hasNumericDose(dosing: SpeciesDosingEntry) {
    return typeof dosing.dose_min_mg_kg === 'number' && typeof dosing.dose_max_mg_kg === 'number';
}

async function buildDrugCard(
    record: DrugFormularyRecord,
    dosing: SpeciesDosingEntry,
    parsed: PharmacOSReasoningResponse['parsed_query'],
    interactions: DrugInteractionRecord[],
    nDrugRisk: string | undefined,
    generateCommentary?: (input: ClinicalCommentaryInput) => Promise<string>,
): Promise<DrugCard> {
    const regulatoryStatus = resolveRegulatoryStatus(record, dosing, parsed.species);
    const dose = calculateDose(record, dosing, parsed.weight_kg);
    const adjustedDose = applyOrganAdjustment(dose, record.organ_adjustments, parsed.patient_context);
    const withdrawal = resolveWithdrawal(record, dosing, parsed.species, parsed.patient_context);
    const cardInteractions = resolveInteractionMatrix(record.drug_name, parsed.species, parsed.concurrent_medications, interactions);
    const pk = resolvePk(record, dosing, parsed.species);
    const extrapolation = buildExtrapolation(record, dosing);
    const commentaryInput: ClinicalCommentaryInput = {
        record,
        dosing,
        species: parsed.species,
        weightKg: parsed.weight_kg,
        indication: parsed.indication,
        regulatoryStatus,
        extrapolation,
        expectedResponse: expectedResponseWindow(dosing),
    };

    return {
        drug_name: record.drug_name,
        brand_names: record.brand_names,
        drug_class: record.drug_class,
        regulatory_status: regulatoryStatus,
        extrapolation,
        dose: { min: dose.minMgKg, max: dose.maxMgKg, unit: 'mg/kg' },
        dose_with_weight: {
            min: dose.minTotalMg,
            max: dose.maxTotalMg,
            unit: 'mg',
            derivation: dose.derivation,
        },
        adjusted_dose: adjustedDose,
        route: dosing.route,
        frequency: dosing.frequency,
        duration: dosing.duration,
        withdrawal,
        pk,
        interactions: cardInteractions,
        n_drug_risk: nDrugRisk,
        contraindications: record.contraindications.map(({ condition, severity }) => ({ condition, severity })),
        monitoring: record.monitoring,
        adverse_effects: record.adverse_effects.map(({ effect, frequency, severity }) => ({ effect, frequency, severity })),
        organ_adjustments: {
            renal: record.organ_adjustments.renal ?? {},
            hepatic: record.organ_adjustments.hepatic ?? {},
        },
        compounding: {
            available: record.compounding.available ?? Boolean(record.compounding.available_formulations?.length),
            notes: record.compounding.notes
                ?? record.compounding.concentration_notes
                ?? 'Use an approved commercial veterinary product when available; compounding requires legal and stability review.',
            xylitol_warning: record.compounding.xylitol_risk_species?.includes(parsed.species) || undefined,
        },
        clinical_commentary: await resolveClinicalCommentary(commentaryInput, generateCommentary),
        alternative_if_unavailable: buildAlternative(record),
        reference: [record.primary_reference, ...(record.secondary_references ?? []), dosing.source].filter(Boolean),
        formulary_version: record.formulary_version,
        weight_warning: parsedWeightWarning(parsed),
    };
}

function resolveRegulatoryStatus(record: DrugFormularyRecord, dosing: SpeciesDosingEntry, species: string): DrugCard['regulatory_status'] {
    if (dosing.is_fda_approved || record.fda_cvm_approved_species?.includes(species)) return 'fda_approved';
    if (dosing.is_ema_approved || record.ema_cvmp_approved_species?.includes(species)) return 'ema_approved';
    if (!hasNumericDose(dosing) && record.compounding.available) return 'compounding_only';
    return 'extra_label';
}

function calculateDose(record: DrugFormularyRecord, dosing: SpeciesDosingEntry, weightKg: number) {
    const minSource = dosing.dose_min_mg_kg ?? 0;
    const maxSource = dosing.dose_max_mg_kg ?? minSource;
    const sourceSpecies = dosing.extrapolated_from_species;
    const sourceWeight = dosing.source_weight_kg
        ?? (sourceSpecies ? TYPICAL_SPECIES_WEIGHT_KG[sourceSpecies] : TYPICAL_SPECIES_WEIGHT_KG[dosing.species])
        ?? weightKg;
    const factor = sourceSpecies ? (weightKg / sourceWeight) ** 0.75 : 1;
    const minMgKg = minSource * factor;
    const maxMgKg = maxSource * factor;
    const minTotal = minMgKg * weightKg;
    const maxTotal = maxMgKg * weightKg;
    const derivation = sourceSpecies
        ? `Extra-label derivation: ${record.drug_name} source ${sourceSpecies} dose ${formatNumber(minSource)}-${formatNumber(maxSource)} mg/kg x (${formatNumber(weightKg)}/${formatNumber(sourceWeight)})^0.75 = ${formatNumber(minMgKg)}-${formatNumber(maxMgKg)} mg/kg; total ${formatNumber(minTotal)}-${formatNumber(maxTotal)} mg. Confidence band +/-30%; primary-reference verification required.`
        : `Direct species dose: ${formatNumber(minSource)}-${formatNumber(maxSource)} mg/kg x ${formatNumber(weightKg)} kg = ${formatNumber(minTotal)}-${formatNumber(maxTotal)} mg.`;
    return {
        minMgKg: formatNumber(minMgKg),
        maxMgKg: formatNumber(maxMgKg),
        minTotalMg: formatNumber(minTotal),
        maxTotalMg: formatNumber(maxTotal),
        minTotal,
        maxTotal,
        derivation,
    };
}

function buildExtrapolation(record: DrugFormularyRecord, dosing: SpeciesDosingEntry): DrugCard['extrapolation'] | undefined {
    if (!dosing.extrapolated_from_species) return undefined;
    return {
        source_species: dosing.extrapolated_from_species,
        method: dosing.allometric_method ?? 'Allometric scaling using BW^0.75',
        confidence_band_pct: 30,
        evidence_gaps: `${record.drug_name} lacks a validated species-specific dosing record for ${dosing.species}; verify against a primary veterinary formulary before dispensing.`,
    };
}

function applyOrganAdjustment(
    dose: ReturnType<typeof calculateDose>,
    adjustments: OrganAdjustments,
    context: PharmacOSPatientContext,
): DrugCard['adjusted_dose'] | undefined {
    const renalStage = normalizeImpairmentStage(context.renal_disease);
    const hepaticStage = normalizeImpairmentStage(context.hepatic_disease);
    const renal = renalStage ? adjustments.renal?.[renalStage] : undefined;
    const hepatic = hepaticStage ? adjustments.hepatic?.[hepaticStage] : undefined;
    const selected = renal ?? hepatic;
    if (!selected?.dose_pct && !selected?.interval_multiplier) return undefined;
    const dosePct = selected.dose_pct ?? 100;
    const min = dose.minTotal * (dosePct / 100);
    const max = dose.maxTotal * (dosePct / 100);
    const organ = renal ? `renal ${renalStage}` : `hepatic ${hepaticStage}`;
    const interval = selected.interval_multiplier ? `; extend interval x${selected.interval_multiplier}` : '';
    return {
        min: formatNumber(min),
        max: formatNumber(max),
        unit: 'mg',
        adjustment_reason: `${organ} adjustment: ${dosePct}% of base dose${interval}. ${selected.monitoring_frequency ?? 'Increase monitoring frequency.'} ${selected.rationale ?? ''}`.trim(),
    };
}

function normalizeImpairmentStage(value: PharmacOSPatientContext['renal_disease']) {
    if (value === true) return 'moderate';
    return value === 'mild' || value === 'moderate' || value === 'severe' ? value : null;
}

function resolveWithdrawal(
    record: DrugFormularyRecord,
    dosing: SpeciesDosingEntry,
    species: string,
    context: PharmacOSPatientContext,
): DrugCard['withdrawal'] | undefined {
    if (!FOOD_OR_COMPETITION_SPECIES.has(species) && !context.competition_animal) return undefined;
    const jurisdiction = context.jurisdiction ?? 'USA';
    const exact = record.withdrawal_periods.find((period) =>
        period.species.toLowerCase() === species
        && period.jurisdiction.toLowerCase() === jurisdiction.toLowerCase()
        && routeMatches(period.route, dosing.route)
    ) ?? record.withdrawal_periods.find((period) =>
        period.species.toLowerCase() === species
        && period.jurisdiction.toLowerCase() === jurisdiction.toLowerCase()
    ) ?? record.withdrawal_periods.find((period) => period.species.toLowerCase() === species);
    if (!exact) {
        return {
            days: null,
            jurisdiction,
            route: dosing.route,
            competition_rules: context.competition_animal
                ? 'Competition animal: no local FEI/USEF interval found; verify rulebook and treating-veterinarian documentation before administration.'
                : 'Food/regulated species: no local withdrawal record found; verify FARAD/product label before administration.',
        };
    }
    return {
        days: exact.withdrawal_days,
        jurisdiction: exact.jurisdiction,
        route: exact.route,
        competition_rules: context.competition_animal ? (exact.competition_rules ?? 'Verify FEI/USEF status before competition.') : exact.regulatory_ref,
    };
}

function routeMatches(left: string, right: string) {
    const normalizedRight = right.toLowerCase();
    return left.toLowerCase().split('/').some((route) => normalizedRight.includes(route.trim().toLowerCase()));
}

function resolvePk(record: DrugFormularyRecord, dosing: SpeciesDosingEntry, species: string): DrugCard['pk'] {
    const speciesPk = asRecord(record.pk_profiles[species]);
    return {
        bioavailability: readString(speciesPk.bioavailability) ?? formatPct(dosing.bioavailability_pct) ?? 'Species/formulation dependent',
        metabolism: readString(speciesPk.metabolism) ?? 'Verify species-specific hepatic metabolism before prescribing.',
        excretion: readString(speciesPk.excretion) ?? 'Verify renal/biliary clearance before prescribing.',
        half_life_hours: readNumber(speciesPk.half_life_hours) ?? dosing.half_life_hours ?? 0,
    };
}

function resolveInteractionMatrix(
    drugName: string,
    species: string,
    concurrentMeds: string[],
    interactions: DrugInteractionRecord[],
): DrugCard['interactions'] {
    const normalizedDrug = normalizeDrugName(drugName);
    return interactions
        .filter((interaction) => interactionApplies(interaction, normalizedDrug, concurrentMeds, species))
        .map((interaction) => {
            const drugB = normalizeDrugName(interaction.drug_a_name) === normalizedDrug
                ? interaction.drug_b_name
                : interaction.drug_a_name;
            return {
                drug_b: drugB,
                severity: interaction.severity,
                mechanism: interaction.mechanism,
                management: interaction.management,
                evidence_level: interaction.evidence_level,
            };
        });
}

function interactionApplies(
    interaction: DrugInteractionRecord,
    normalizedDrug: string,
    concurrentMeds: string[],
    species: string,
) {
    const speciesOk = !interaction.species_scope?.length || interaction.species_scope.includes(species);
    if (!speciesOk) return false;
    const drugA = normalizeDrugName(interaction.drug_a_name);
    const drugB = normalizeDrugName(interaction.drug_b_name);
    const medNames = concurrentMeds.map(normalizeDrugName);
    return (drugA === normalizedDrug && medNames.includes(drugB))
        || (drugB === normalizedDrug && medNames.includes(drugA));
}

function detectNDrugRisk(activeDrugNames: string[], records: DrugFormularyRecord[]) {
    const normalized = activeDrugNames.map((name) => name.toLowerCase());
    const cnsDepressants = ['buprenorphine', 'butorphanol', 'methadone', 'morphine', 'hydromorphone', 'fentanyl', 'gabapentin', 'pregabalin', 'midazolam', 'alfaxalone'];
    const nsaids = ['flunixin', 'meloxicam', 'carprofen', 'ketoprofen', 'phenylbutazone', 'robenacoxib', 'deracoxib', 'grapiprant'];
    const cnsCount = normalized.filter((name) => cnsDepressants.some((drug) => name.includes(drug))).length;
    const nsaidCount = normalized.filter((name) => nsaids.some((drug) => name.includes(drug))).length;
    const recordClassHaystack = records.map((record) => `${record.drug_name} ${record.drug_class}`.toLowerCase()).join(' ');
    if (cnsCount >= 3 || (cnsCount >= 2 && recordClassHaystack.includes('opioid'))) {
        return 'N-drug risk: multiple CNS-active analgesics are present; monitor sedation score, respiratory rate/effort, gut motility, and recumbency risk across overlapping dosing windows.';
    }
    if (nsaidCount >= 2) {
        return 'N-drug risk: multiple NSAID-class agents are present; avoid overlapping therapy because GI ulceration and renal ischemic injury risks are additive.';
    }
    return undefined;
}

function expectedResponseWindow(dosing: SpeciesDosingEntry) {
    const min = dosing.onset_minutes_min;
    const max = dosing.onset_minutes_max;
    if (typeof min === 'number' && typeof max === 'number') return `${formatNumber(min / 60)}-${formatNumber(max / 60)} hours`;
    return '12-72 hours depending on indication, route, and clinical endpoint';
}

async function resolveClinicalCommentary(
    input: ClinicalCommentaryInput,
    generateCommentary?: (input: ClinicalCommentaryInput) => Promise<string>,
) {
    try {
        const generated = await generateCommentary?.(input);
        if (generated && generated.length <= 900) return generated;
    } catch {
        return deterministicClinicalCommentary(input);
    }
    return deterministicClinicalCommentary(input);
}

export async function generateAnthropicDrugCommentary(
    input: ClinicalCommentaryInput,
    apiKey: string,
    model = 'claude-sonnet-4-20250514',
): Promise<string> {
    const prompt = [
        'You are a board-certified veterinary clinical pharmacologist generating the Clinical Commentary section only.',
        'Maximum 120 words. No bullets. No boilerplate. Start with this exact clinical situation, not the drug name.',
        `Species: ${input.species}`,
        `Weight: ${input.weightKg} kg`,
        `Indication: ${input.indication}`,
        `Drug: ${input.record.drug_name}`,
        `Class: ${input.record.drug_class}`,
        `Route/frequency: ${input.dosing.route} ${input.dosing.frequency}`,
        `Expected response: ${input.expectedResponse}`,
        `Regulatory status: ${input.regulatoryStatus}`,
        `Extrapolation: ${input.extrapolation ? `${input.extrapolation.source_species}; ${input.extrapolation.method}; ${input.extrapolation.evidence_gaps}` : 'none'}`,
        `Monitoring: ${input.record.monitoring.join('; ')}`,
        `Adverse effects: ${input.record.adverse_effects.map((effect) => `${effect.effect} (${effect.severity})`).join('; ')}`,
        'Close with: Choose [drug] when... Avoid [drug] when...',
    ].join('\n');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            max_tokens: 220,
            temperature: 0.2,
            messages: [{ role: 'user', content: prompt }],
        }),
    });
    if (!response.ok) throw new Error(`Anthropic commentary failed: ${response.status}`);
    const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
    const text = data.content?.find((item) => item.type === 'text')?.text?.trim();
    if (!text) throw new Error('Anthropic commentary was empty.');
    return text.replace(/\s+/g, ' ');
}

function deterministicClinicalCommentary(input: ClinicalCommentaryInput) {
    const response = input.expectedResponse;
    const speciesRisk = input.species === 'equine'
        ? 'Equine patients warrant explicit GI motility, hydration, and manure monitoring because analgesic adverse effects can hide worsening colic.'
        : input.species === 'feline'
            ? 'Cats warrant close appetite, hydration, and renal marker review because clearance and formulation tolerance can diverge from canine expectations.'
            : 'Track the organ system most likely to limit clearance and reassess if the clinical endpoint is not moving in the expected window.';
    const extrapolation = input.extrapolation
        ? ` The dose is extrapolated from ${input.extrapolation.source_species} with ${input.extrapolation.method}; the remaining gap is absence of a validated ${input.species} label-level PK record.`
        : '';
    return `In a ${formatNumber(input.weightKg)}kg ${input.species} with ${input.indication}, ${input.record.drug_name} is most defensible when its ${input.record.drug_class.toLowerCase()} profile matches the primary clinical endpoint. Expected response should be reassessed over ${response}. ${speciesRisk}${extrapolation} Choose ${input.record.drug_name} when the patient profile matches the labeled or best-supported route and monitoring capacity. Avoid ${input.record.drug_name} when contraindications, withdrawal rules, or organ impairment make the exposure hard to control.`;
}

function buildAlternative(record: DrugFormularyRecord) {
    const className = record.drug_class.toLowerCase();
    if (className.includes('nsaid')) return 'Consider an opioid, local/regional analgesia, or another labeled NSAID only after washout and risk review.';
    if (className.includes('opioid')) return 'Consider multimodal non-opioid analgesia, local/regional anesthesia, or a different monitored opioid protocol.';
    if (className.includes('antibiotic')) return 'Use culture, susceptibility, and species label constraints to select an antimicrobial alternative.';
    return 'Use a same-indication alternative with stronger species-specific evidence.';
}

function parsedWeightWarning(parsed: PharmacOSReasoningResponse['parsed_query']) {
    const result = validateSpeciesWeight(parsed.species, parsed.weight_kg);
    if (result.valid) return undefined;
    return result.message;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatPct(value: number | null | undefined) {
    return typeof value === 'number' ? `${formatNumber(value)}%` : null;
}

function formatNumber(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

const BASE_ORGAN_ADJUSTMENTS: OrganAdjustments = {
    renal: {
        mild: { dose_pct: 100, interval_multiplier: 1, monitoring_frequency: 'Baseline renal markers, then recheck if course exceeds 72 hours.' },
        moderate: { dose_pct: 75, interval_multiplier: 1.5, monitoring_frequency: 'Recheck creatinine/BUN or SDMA within 24-48 hours.' },
        severe: { dose_pct: 50, interval_multiplier: 2, monitoring_frequency: 'Avoid unless benefit is compelling; monitor renal markers and hydration at least daily.' },
    },
    hepatic: {
        mild: { dose_pct: 100, interval_multiplier: 1, monitoring_frequency: 'Baseline ALT/AST/ALP and bilirubin if course is repeated.' },
        moderate: { dose_pct: 75, interval_multiplier: 1.5, monitoring_frequency: 'Recheck liver enzymes/bilirubin within 48-72 hours.' },
        severe: { dose_pct: 50, interval_multiplier: 2, monitoring_frequency: 'Avoid or use specialist-guided dosing with daily neurologic and hepatic monitoring.' },
    },
};

const FALLBACK_FORMULARY: DrugFormularyRecord[] = [
    {
        drug_name: 'Flunixin meglumine',
        brand_names: ['Banamine'],
        drug_class: 'Non-selective NSAID',
        drug_class_code: 'NSAID_NONSELECTIVE',
        who_inn: 'flunixin',
        primary_indication: 'visceral pain inflammation colic fever',
        indication_codes: ['pain', 'inflammation', 'colic', 'analgesia'],
        species_dosing: [
            {
                species: 'equine',
                dose_min_mg_kg: 1.1,
                dose_max_mg_kg: 1.1,
                route: 'IV/PO',
                frequency: 'q12-24h',
                duration: 'Short course; clinician verified',
                evidence_level: 'established',
                source: "Plumb's Veterinary Drug Handbook / product label hierarchy",
                is_fda_approved: true,
                onset_minutes_min: 30,
                onset_minutes_max: 120,
                half_life_hours: 1.6,
            },
        ],
        withdrawal_periods: [
            {
                species: 'equine',
                jurisdiction: 'USA',
                route: 'IV/PO',
                withdrawal_days: null,
                authority: 'FARAD / product-label verification required',
                regulatory_ref: 'Do not mark n/a. Verify food-horse legality and residue guidance by exact formulation and jurisdiction.',
                competition_rules: 'Competition animal: verify current FEI/USEF prohibited substance and detection guidance before administration.',
            },
        ],
        organ_adjustments: BASE_ORGAN_ADJUSTMENTS,
        contraindications: [
            { condition: 'dehydration, shock, renal hypoperfusion, active GI ulceration, concurrent NSAID or corticosteroid', severity: 'relative', rationale: 'NSAID prostaglandin blockade can worsen renal and GI injury.' },
        ],
        pk_profiles: { equine: { bioavailability: 'High PO/IV exposure; formulation dependent', metabolism: 'Hepatic metabolism', excretion: 'Renal and biliary metabolites', half_life_hours: 1.6 } },
        monitoring: ['Hydration/perfusion before dosing', 'Creatinine/BUN within 24-48h for at-risk horses', 'Manure output and colic pain score'],
        adverse_effects: [
            { effect: 'right dorsal colitis/GI ulceration', frequency: 'uncommon', severity: 'major', species_scope: ['equine'] },
            { effect: 'renal papillary injury under hypovolemia', frequency: 'uncommon', severity: 'major', species_scope: ['equine'] },
        ],
        compounding: { available: false, notes: 'Use approved commercial formulations where available.' },
        fda_cvm_approved_species: ['equine', 'bovine'],
        ema_cvmp_approved_species: [],
        apvma_approved_species: [],
        controlled_substance: false,
        primary_reference: "Plumb's Veterinary Drug Handbook; FDA Animal Drugs label hierarchy",
        secondary_references: ['FARAD for residue guidance', 'FEI/USEF for competition status'],
        formulary_version: 1,
        update_source: 'local_bootstrap',
        active: true,
    },
    {
        drug_name: 'Buprenorphine',
        brand_names: ['Buprenex', 'Simbadol'],
        drug_class: 'Partial mu-opioid agonist analgesic',
        drug_class_code: 'OPIOID_PARTIAL_MU',
        who_inn: 'buprenorphine',
        primary_indication: 'moderate pain analgesia multimodal pain',
        indication_codes: ['pain', 'analgesia', 'colic'],
        species_dosing: [
            {
                species: 'canine',
                dose_min_mg_kg: 0.02,
                dose_max_mg_kg: 0.04,
                route: 'IV/IM/SC',
                frequency: 'q6-8h',
                duration: 'Pain-dependent',
                evidence_level: 'probable',
                source: "Plumb's Veterinary Drug Handbook / BSAVA formulary",
                is_extra_label: true,
                onset_minutes_min: 15,
                onset_minutes_max: 60,
                half_life_hours: 6,
                bioavailability_pct: null,
            },
            {
                species: 'equine',
                dose_min_mg_kg: 0.02,
                dose_max_mg_kg: 0.04,
                route: 'IV/IM/SC',
                frequency: 'q6-8h',
                duration: 'Pain-dependent; specialist verification',
                evidence_level: 'theoretical',
                source: 'Extra-label allometric bootstrap; primary equine reference required',
                is_extra_label: true,
                extrapolated_from_species: 'canine',
                allometric_method: 'BW^0.75',
                source_weight_kg: 20,
                onset_minutes_min: 15,
                onset_minutes_max: 60,
                half_life_hours: 6,
            },
        ],
        withdrawal_periods: [
            {
                species: 'equine',
                jurisdiction: 'USA',
                route: 'IV/IM/SC',
                withdrawal_days: null,
                authority: 'FARAD / FEI-USEF verification required',
                regulatory_ref: 'Extra-label use in regulated horses requires jurisdiction-specific withdrawal consultation.',
                competition_rules: 'Competition animal: opioid class status requires current FEI/USEF rule verification and documented withholding plan.',
            },
        ],
        organ_adjustments: BASE_ORGAN_ADJUSTMENTS,
        contraindications: [
            { condition: 'severe respiratory depression or uncontrolled neurologic depression', severity: 'relative', rationale: 'Opioid CNS effects can compound sedation and respiratory compromise.' },
        ],
        pk_profiles: { canine: { bioavailability: 'Poor swallowed oral; injectable exposure route-dependent', metabolism: 'Hepatic N-dealkylation/glucuronidation', excretion: 'Biliary/fecal and urinary metabolites', half_life_hours: 6 } },
        monitoring: ['Pain score and sedation score every dosing interval', 'Respiratory rate/effort after administration', 'Gut motility and manure output in horses'],
        adverse_effects: [
            { effect: 'sedation/dysphoria', frequency: 'common', severity: 'moderate' },
            { effect: 'respiratory depression', frequency: 'rare', severity: 'major' },
        ],
        compounding: { available: true, notes: 'Controlled substance handling applies; verify concentration and legal route.' },
        controlled_substance: true,
        dea_schedule: 'Schedule III (USA)',
        primary_reference: "Plumb's Veterinary Drug Handbook; controlled substance regulations",
        secondary_references: ['Primary equine PK verification required for extra-label equine use'],
        formulary_version: 1,
        update_source: 'local_bootstrap',
        active: true,
    },
    {
        drug_name: 'Gabapentin',
        brand_names: ['Neurontin', 'generic'],
        drug_class: 'Alpha-2-delta calcium channel ligand',
        drug_class_code: 'NEUROPATHIC_ALPHA2DELTA',
        primary_indication: 'neuropathic pain chronic pain analgesia',
        indication_codes: ['pain', 'analgesia', 'neuropathic_pain'],
        species_dosing: [
            {
                species: 'canine',
                dose_min_mg_kg: 10,
                dose_max_mg_kg: 20,
                route: 'PO',
                frequency: 'q8-12h',
                duration: 'Condition-dependent',
                evidence_level: 'probable',
                source: "Plumb's Veterinary Drug Handbook / pain-management formularies",
                is_extra_label: true,
                onset_minutes_min: 60,
                onset_minutes_max: 180,
                half_life_hours: 3,
            },
            {
                species: 'equine',
                dose_min_mg_kg: 10,
                dose_max_mg_kg: 20,
                route: 'PO',
                frequency: 'q8-12h',
                duration: 'Condition-dependent; specialist verification',
                evidence_level: 'theoretical',
                source: 'Extra-label allometric bootstrap; primary equine reference required',
                is_extra_label: true,
                extrapolated_from_species: 'canine',
                allometric_method: 'BW^0.75',
                source_weight_kg: 20,
                onset_minutes_min: 60,
                onset_minutes_max: 180,
                half_life_hours: 3,
            },
        ],
        withdrawal_periods: [
            {
                species: 'equine',
                jurisdiction: 'USA',
                route: 'PO',
                withdrawal_days: null,
                authority: 'FARAD / competition authority verification required',
                regulatory_ref: 'Extra-label regulated-horse use requires withdrawal consultation.',
                competition_rules: 'Competition animal: verify current FEI/USEF gabapentin status before use.',
            },
        ],
        organ_adjustments: {
            renal: {
                mild: { dose_pct: 100, interval_multiplier: 1, monitoring_frequency: 'Monitor sedation and ataxia.' },
                moderate: { dose_pct: 50, interval_multiplier: 1.5, monitoring_frequency: 'Monitor sedation/ataxia each dosing interval; renal values within 48h.' },
                severe: { dose_pct: 25, interval_multiplier: 2, monitoring_frequency: 'Avoid or use specialist-guided dosing; monitor mentation and renal markers daily.' },
            },
            hepatic: BASE_ORGAN_ADJUSTMENTS.hepatic,
        },
        contraindications: [
            { condition: 'marked sedation/ataxia or severe renal impairment without dose reduction', severity: 'relative' },
        ],
        pk_profiles: { canine: { bioavailability: 'Variable oral absorption', metabolism: 'Limited metabolism in many species', excretion: 'Primarily renal elimination', half_life_hours: 3 } },
        monitoring: ['Sedation/ataxia score', 'Renal markers when repeated dosing is used', 'Pain/function score over 24-72h'],
        adverse_effects: [
            { effect: 'sedation/ataxia', frequency: 'common', severity: 'moderate' },
            { effect: 'GI upset', frequency: 'uncommon', severity: 'minor' },
        ],
        compounding: { available: true, notes: 'Avoid xylitol-containing human liquids in dogs; verify concentration and excipients.', xylitol_risk_species: ['canine'] },
        controlled_substance: false,
        primary_reference: "Plumb's Veterinary Drug Handbook; pain-management formulary references",
        secondary_references: ['Primary species-specific PK verification required for extrapolated species'],
        formulary_version: 1,
        update_source: 'local_bootstrap',
        active: true,
    },
];

const FALLBACK_INTERACTIONS: DrugInteractionRecord[] = [
    {
        drug_a_name: 'Flunixin meglumine',
        drug_b_name: 'Buprenorphine',
        interaction_type: 'additive',
        severity: 'moderate',
        mechanism: 'In horses, NSAID visceral analgesia plus opioid CNS effects can mask worsening colic while increasing sedation, reduced gut motility, and respiratory-depression monitoring burden.',
        species_scope: ['equine'],
        route_specific: { route_a: 'IV/PO', route_b: 'IV/IM/SC', timing_relevance: 'overlapping analgesic windows' },
        management: 'Use only with serial colic exams, hydration/perfusion checks, respiratory monitoring, and a documented reassessment interval; avoid using analgesia to delay surgical referral.',
        monitoring_required: ['sedation score', 'respiratory rate/effort', 'gut motility', 'manure output', 'pain score'],
        evidence_level: 'probable',
        reference: 'VetIOS local safety rule pending primary-reference review',
    },
    {
        drug_a_name: 'Gabapentin',
        drug_b_name: 'Buprenorphine',
        interaction_type: 'additive',
        severity: 'moderate',
        mechanism: 'Concurrent CNS-active analgesics can produce additive sedation, ataxia, and respiratory monitoring requirements.',
        species_scope: null,
        route_specific: { timing_relevance: 'overlapping peak sedation' },
        management: 'Start conservatively, separate peak-effect checks, and monitor sedation/respiration before repeat dosing.',
        monitoring_required: ['sedation score', 'ataxia score', 'respiratory rate'],
        evidence_level: 'probable',
        reference: 'VetIOS local safety rule pending primary-reference review',
    },
];
