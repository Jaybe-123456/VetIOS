export type PharmacOSSpecies =
    | 'canine'
    | 'feline'
    | 'equine'
    | 'bovine'
    | 'avian'
    | 'porcine'
    | 'ovine'
    | 'reptile'
    | 'rabbit'
    | 'ferret';

export type JsonRecord = Record<string, unknown>;

export type EvidenceLevel = 'established' | 'probable' | 'suspected' | 'theoretical' | string;

export interface SpeciesDosingEntry {
    species: PharmacOSSpecies | string;
    dose_min_mg_kg?: number | null;
    dose_max_mg_kg?: number | null;
    dose_display?: string | null;
    route: string;
    frequency: string;
    duration: string;
    evidence_level: EvidenceLevel;
    source: string;
    is_fda_approved?: boolean;
    is_ema_approved?: boolean;
    is_apvma_approved?: boolean;
    is_extra_label?: boolean;
    extrapolated_from_species?: string | null;
    allometric_method?: string | null;
    source_weight_kg?: number | null;
    onset_minutes_min?: number | null;
    onset_minutes_max?: number | null;
    half_life_hours?: number | null;
    bioavailability_pct?: number | null;
}

export interface WithdrawalPeriod {
    species: PharmacOSSpecies | string;
    jurisdiction: string;
    route: string;
    withdrawal_days: number | null;
    authority: string;
    regulatory_ref: string;
    competition_rules?: string | null;
}

export interface OrganAdjustmentStage {
    dose_pct?: number | null;
    interval_multiplier?: number | null;
    monitoring_frequency?: string | null;
    rationale?: string | null;
}

export interface OrganAdjustments {
    renal?: {
        mild?: OrganAdjustmentStage;
        moderate?: OrganAdjustmentStage;
        severe?: OrganAdjustmentStage;
    };
    hepatic?: {
        mild?: OrganAdjustmentStage;
        moderate?: OrganAdjustmentStage;
        severe?: OrganAdjustmentStage;
    };
}

export interface DrugFormularyRecord {
    id?: string;
    drug_name: string;
    brand_names: string[];
    drug_class: string;
    drug_class_code: string;
    who_inn?: string | null;
    primary_indication: string;
    indication_codes: string[];
    species_dosing: SpeciesDosingEntry[];
    withdrawal_periods: WithdrawalPeriod[];
    organ_adjustments: OrganAdjustments;
    contraindications: Array<{
        condition: string;
        severity: 'absolute' | 'relative';
        species_scope?: string[] | null;
        rationale?: string | null;
    }>;
    pk_profiles: JsonRecord;
    monitoring: string[];
    adverse_effects: Array<{
        effect: string;
        frequency: 'common' | 'uncommon' | 'rare' | string;
        species_scope?: string[] | null;
        severity: string;
    }>;
    compounding: {
        available_formulations?: string[];
        xylitol_risk_species?: string[];
        concentration_notes?: string;
        available?: boolean;
        notes?: string;
    };
    fda_cvm_approved_species?: string[] | null;
    ema_cvmp_approved_species?: string[] | null;
    apvma_approved_species?: string[] | null;
    controlled_substance?: boolean | null;
    dea_schedule?: string | null;
    primary_reference: string;
    secondary_references?: string[] | null;
    formulary_version: number;
    last_updated_at?: string | null;
    update_source?: string | null;
    active?: boolean | null;
    created_at?: string | null;
}

export interface DrugInteractionRecord {
    id?: string;
    drug_a_name: string;
    drug_b_name: string;
    interaction_type: 'pharmacokinetic' | 'pharmacodynamic' | 'additive' | 'synergistic' | 'antagonistic' | string;
    severity: 'minor' | 'moderate' | 'major' | 'contraindicated' | string;
    mechanism: string;
    species_scope?: string[] | null;
    route_specific?: JsonRecord | null;
    management: string;
    monitoring_required?: string[] | null;
    evidence_level: EvidenceLevel;
    reference: string;
    created_at?: string | null;
}

export interface ValidationIssue {
    path: string;
    message: string;
}

export interface ValidationErrorLike {
    issues: ValidationIssue[];
    flatten: () => { fieldErrors: Record<string, string[]>; formErrors: string[] };
}

export interface SchemaLike<T> {
    parse: (value: unknown) => T;
    safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: ValidationErrorLike };
}

export interface FormularyUpdateRequest {
    update_type: 'new_drug' | 'label_update' | 'dose_revision' | 'new_species' | 'withdrawal_update';
    drug_record: DrugFormularyRecord;
    regulatory_reference: string;
    effective_date: string;
    submitted_by: string;
}

export const drugFormularyRecordSchema: SchemaLike<DrugFormularyRecord> = {
    parse(value) {
        const result = validateDrugFormularyRecord(value);
        if (!result.success) throw createValidationError(result.issues);
        return result.data;
    },
    safeParse(value) {
        const result = validateDrugFormularyRecord(value);
        return result.success ? { success: true, data: result.data } : { success: false, error: createValidationError(result.issues) };
    },
};

export const formularyUpdateRequestSchema: SchemaLike<FormularyUpdateRequest> = {
    parse(value) {
        const result = validateFormularyUpdateRequest(value);
        if (!result.success) throw createValidationError(result.issues);
        return result.data;
    },
    safeParse(value) {
        const result = validateFormularyUpdateRequest(value);
        return result.success ? { success: true, data: result.data } : { success: false, error: createValidationError(result.issues) };
    },
};

function validateFormularyUpdateRequest(value: unknown): { success: true; data: FormularyUpdateRequest } | { success: false; issues: ValidationIssue[] } {
    const record = asRecord(value);
    const issues: ValidationIssue[] = [];
    const updateType = readString(record.update_type);
    if (!updateType || !['new_drug', 'label_update', 'dose_revision', 'new_species', 'withdrawal_update'].includes(updateType)) {
        issues.push({ path: 'update_type', message: 'update_type must be a supported formulary update type.' });
    }
    const drug = validateDrugFormularyRecord(record.drug_record);
    if (!drug.success) issues.push(...drug.issues.map((issue) => ({ ...issue, path: `drug_record.${issue.path}` })));
    const regulatoryReference = readString(record.regulatory_reference);
    const effectiveDate = readString(record.effective_date);
    const submittedBy = readString(record.submitted_by);
    if (!regulatoryReference) issues.push({ path: 'regulatory_reference', message: 'regulatory_reference is required.' });
    if (!effectiveDate) issues.push({ path: 'effective_date', message: 'effective_date is required.' });
    if (!submittedBy) issues.push({ path: 'submitted_by', message: 'submitted_by is required.' });
    if (issues.length > 0 || !drug.success || !updateType || !regulatoryReference || !effectiveDate || !submittedBy) {
        return { success: false, issues };
    }
    return {
        success: true,
        data: {
            update_type: updateType as FormularyUpdateRequest['update_type'],
            drug_record: drug.data,
            regulatory_reference: regulatoryReference,
            effective_date: effectiveDate,
            submitted_by: submittedBy,
        },
    };
}

function validateDrugFormularyRecord(value: unknown): { success: true; data: DrugFormularyRecord } | { success: false; issues: ValidationIssue[] } {
    const record = asRecord(value);
    const issues: ValidationIssue[] = [];
    for (const field of ['drug_name', 'drug_class', 'drug_class_code', 'primary_indication', 'primary_reference']) {
        if (!readString(record[field])) issues.push({ path: field, message: `${field} is required.` });
    }
    const speciesDosing = readArray(record.species_dosing);
    const withdrawalPeriods = readArray(record.withdrawal_periods);
    if (issues.length > 0) return { success: false, issues };
    return {
        success: true,
        data: {
            id: readString(record.id) ?? undefined,
            drug_name: readString(record.drug_name) ?? '',
            brand_names: readStringArray(record.brand_names),
            drug_class: readString(record.drug_class) ?? '',
            drug_class_code: readString(record.drug_class_code) ?? '',
            who_inn: readString(record.who_inn),
            primary_indication: readString(record.primary_indication) ?? '',
            indication_codes: readStringArray(record.indication_codes),
            species_dosing: speciesDosing as SpeciesDosingEntry[],
            withdrawal_periods: withdrawalPeriods as WithdrawalPeriod[],
            organ_adjustments: asRecord(record.organ_adjustments) as OrganAdjustments,
            contraindications: readArray(record.contraindications) as DrugFormularyRecord['contraindications'],
            pk_profiles: asRecord(record.pk_profiles),
            monitoring: readStringArray(record.monitoring),
            adverse_effects: readArray(record.adverse_effects) as DrugFormularyRecord['adverse_effects'],
            compounding: asRecord(record.compounding) as DrugFormularyRecord['compounding'],
            fda_cvm_approved_species: readOptionalStringArray(record.fda_cvm_approved_species),
            ema_cvmp_approved_species: readOptionalStringArray(record.ema_cvmp_approved_species),
            apvma_approved_species: readOptionalStringArray(record.apvma_approved_species),
            controlled_substance: typeof record.controlled_substance === 'boolean' ? record.controlled_substance : null,
            dea_schedule: readString(record.dea_schedule),
            primary_reference: readString(record.primary_reference) ?? '',
            secondary_references: readOptionalStringArray(record.secondary_references),
            formulary_version: readPositiveInt(record.formulary_version) ?? 1,
            last_updated_at: readString(record.last_updated_at),
            update_source: readString(record.update_source),
            active: typeof record.active === 'boolean' ? record.active : true,
            created_at: readString(record.created_at),
        },
    };
}

function createValidationError(issues: ValidationIssue[]): ValidationErrorLike {
    return {
        issues,
        flatten() {
            const fieldErrors: Record<string, string[]> = {};
            for (const issue of issues) {
                fieldErrors[issue.path] = [...(fieldErrors[issue.path] ?? []), issue.message];
            }
            return { fieldErrors, formErrors: [] };
        },
    };
}

function asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
    return readArray(value).map(readString).filter((item): item is string => item != null);
}

function readOptionalStringArray(value: unknown): string[] | null {
    return Array.isArray(value) ? readStringArray(value) : null;
}

function readPositiveInt(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function normalizeDrugName(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function findSpeciesDosing(record: DrugFormularyRecord, species: string): SpeciesDosingEntry | null {
    const normalizedSpecies = species.trim().toLowerCase();
    return record.species_dosing.find((entry) => entry.species.toLowerCase() === normalizedSpecies) ?? null;
}

export function recordMatchesIndication(record: DrugFormularyRecord, indication: string): boolean {
    const normalized = indication.trim().toLowerCase();
    if (!normalized) return true;
    const haystack = [
        record.primary_indication,
        ...record.indication_codes,
        record.drug_class,
        record.drug_name,
    ].join(' ').toLowerCase();
    return normalized
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4)
        .some((token) => haystack.includes(token));
}
