import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CLINICAL_CASES } from '@/lib/db/schemaContracts';

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SPECIES_ALIASES: Record<string, string> = {
    dog: 'Canis lupus familiaris',
    canine: 'Canis lupus familiaris',
    puppy: 'Canis lupus familiaris',
    'canis lupus': 'Canis lupus familiaris',
    'canis lupus familiaris': 'Canis lupus familiaris',
    cat: 'Felis catus',
    feline: 'Felis catus',
    kitten: 'Felis catus',
    'felis catus': 'Felis catus',
    horse: 'Equus ferus caballus',
    equine: 'Equus ferus caballus',
    'equus ferus caballus': 'Equus ferus caballus',
    cow: 'Bos taurus',
    bovine: 'Bos taurus',
    'bos taurus': 'Bos taurus',
};

const CORE_SIGNATURE_KEYS = new Set([
    'species',
    'breed',
    'symptoms',
    'metadata',
    'diagnostic_images',
    'lab_results',
]);

export interface ClinicalCaseRecord {
    id: string;
    tenant_id: string;
    user_id: string | null;
    clinic_id: string | null;
    source_module: string | null;
    case_key: string;
    source_case_reference: string | null;
    species: string | null;
    species_canonical: string | null;
    species_display: string | null;
    species_raw: string | null;
    breed: string | null;
    symptoms_raw: string | null;
    symptoms_normalized: string[];
    symptom_vector: string[];
    symptom_summary: string | null;
    patient_metadata: Record<string, unknown>;
    metadata: Record<string, unknown>;
    latest_input_signature: Record<string, unknown>;
    latest_inference_event_id: string | null;
    latest_outcome_event_id: string | null;
    latest_simulation_event_id: string | null;
    inference_event_count: number;
    first_inference_at: string;
    last_inference_at: string;
    created_at: string;
    updated_at: string;
}

export interface ClinicalCaseStore {
    findById(tenantId: string, caseId: string): Promise<ClinicalCaseRecord | null>;
    findByCaseKey(tenantId: string, caseKey: string): Promise<ClinicalCaseRecord | null>;
    upsert(record: ClinicalCaseUpsertRecord): Promise<ClinicalCaseRecord>;
    updateById(
        tenantId: string,
        caseId: string,
        patch: Partial<ClinicalCaseUpsertRecord>,
    ): Promise<ClinicalCaseRecord>;
}

export interface ClinicalCaseUpsertRecord {
    id?: string;
    tenant_id: string;
    user_id: string | null;
    clinic_id: string | null;
    source_module: string | null;
    case_key: string;
    source_case_reference: string | null;
    species: string | null;
    species_canonical: string | null;
    species_display: string | null;
    species_raw: string | null;
    breed: string | null;
    symptoms_raw: string | null;
    symptoms_normalized: string[];
    symptom_vector: string[];
    symptom_summary: string | null;
    patient_metadata: Record<string, unknown>;
    metadata: Record<string, unknown>;
    latest_input_signature: Record<string, unknown>;
    latest_inference_event_id: string | null;
    latest_outcome_event_id: string | null;
    latest_simulation_event_id: string | null;
    inference_event_count: number;
    first_inference_at: string;
    last_inference_at: string;
}

export interface EnsureCanonicalClinicalCaseInput {
    tenantId: string;
    userId?: string | null;
    clinicId?: string | null;
    requestedCaseId?: string | null;
    sourceModule?: string | null;
    inputSignature: Record<string, unknown>;
    observedAt: string;
}

export interface ClinicalCaseEventContext {
    observedAt: string;
    userId?: string | null;
    sourceModule?: string | null;
    metadataPatch?: Record<string, unknown>;
}

interface ClinicalCaseSnapshot {
    preferredCaseId: string | null;
    caseKey: string;
    sourceCaseReference: string | null;
    speciesCanonical: string | null;
    speciesDisplay: string | null;
    speciesRaw: string | null;
    breed: string | null;
    symptomsRaw: string | null;
    symptomsNormalized: string[];
    symptomSummary: string | null;
    patientMetadata: Record<string, unknown>;
    latestInputSignature: Record<string, unknown>;
}

export function normalizeSpeciesValue(value: unknown): string | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;

    const compact = normalized
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return SPECIES_ALIASES[compact] ?? scientificNameCase(compact);
}

export function normalizeBreedValue(value: unknown): string | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;

    return normalized
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
        .join(' ');
}

export function normalizeSymptomVector(value: unknown): string[] {
    const source = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(/[,;|]/)
            : [];

    const deduped = new Set<string>();
    for (const entry of source) {
        if (typeof entry !== 'string') continue;
        const normalized = entry.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized) deduped.add(normalized);
    }

    return Array.from(deduped);
}

export function buildClinicalCaseSnapshot(input: EnsureCanonicalClinicalCaseInput): ClinicalCaseSnapshot {
    const preferredCaseId = normalizeUuid(input.requestedCaseId);
    const sourceCaseReference = preferredCaseId ? null : normalizeText(input.requestedCaseId);
    const speciesRaw = normalizeText(input.inputSignature.species);
    const speciesCanonical = normalizeSpeciesValue(speciesRaw);
    const speciesDisplay = speciesRaw ?? speciesCanonical;
    const breed = normalizeBreedValue(input.inputSignature.breed);
    const symptomsNormalized = normalizeSymptomVector(input.inputSignature.symptoms);
    const symptomsRaw = normalizeSymptomsRaw(input.inputSignature.symptoms);
    const patientMetadata = extractCaseMetadata(input.inputSignature);
    const latestInputSignature = sanitizeSignatureForCase(input.inputSignature);
    const symptomSummary = symptomsNormalized.length > 0
        ? symptomsNormalized.slice(0, 8).join(', ')
        : normalizeText(symptomsRaw);

    return {
        preferredCaseId,
        caseKey: buildClinicalCaseKey({
            clinicId: input.clinicId ?? null,
            preferredCaseId,
            sourceCaseReference,
            speciesCanonical,
            breed,
            symptomsNormalized,
            patientMetadata,
            latestInputSignature,
        }),
        sourceCaseReference,
        speciesCanonical,
        speciesDisplay,
        speciesRaw,
        breed,
        symptomsRaw,
        symptomsNormalized,
        symptomSummary,
        patientMetadata,
        latestInputSignature,
    };
}

export async function ensureCanonicalClinicalCase(
    store: ClinicalCaseStore,
    input: EnsureCanonicalClinicalCaseInput,
): Promise<ClinicalCaseRecord> {
    const snapshot = buildClinicalCaseSnapshot(input);
    const existingCase = snapshot.preferredCaseId
        ? await store.findById(input.tenantId, snapshot.preferredCaseId)
        : await store.findByCaseKey(input.tenantId, snapshot.caseKey);

    const patientMetadata = mergeJsonRecords(
        existingCase?.patient_metadata ?? existingCase?.metadata ?? {},
        snapshot.patientMetadata,
    );
    const symptomsNormalized = snapshot.symptomsNormalized.length > 0
        ? snapshot.symptomsNormalized
        : existingCase?.symptoms_normalized ??
            existingCase?.symptom_vector ??
            [];
    const symptomSummary = snapshot.symptomSummary ??
        (symptomsNormalized.length > 0 ? symptomsNormalized.slice(0, 8).join(', ') : null) ??
        existingCase?.symptom_summary ??
        null;

    return store.upsert({
        id: existingCase?.id ?? snapshot.preferredCaseId ?? undefined,
        tenant_id: input.tenantId,
        user_id: input.userId ?? existingCase?.user_id ?? null,
        clinic_id: input.clinicId ?? existingCase?.clinic_id ?? null,
        source_module: input.sourceModule ?? existingCase?.source_module ?? null,
        case_key: existingCase?.case_key ?? snapshot.caseKey,
        source_case_reference: existingCase?.source_case_reference ?? snapshot.sourceCaseReference,
        species: snapshot.speciesCanonical ?? existingCase?.species ?? null,
        species_canonical: snapshot.speciesCanonical ?? existingCase?.species_canonical ?? existingCase?.species ?? null,
        species_display: snapshot.speciesDisplay ?? existingCase?.species_display ?? existingCase?.species_raw ?? existingCase?.species ?? null,
        species_raw: snapshot.speciesRaw ?? existingCase?.species_raw ?? null,
        breed: snapshot.breed ?? existingCase?.breed ?? null,
        symptoms_raw: snapshot.symptomsRaw ?? existingCase?.symptoms_raw ?? null,
        symptoms_normalized: symptomsNormalized,
        symptom_vector: symptomsNormalized,
        symptom_summary: symptomSummary,
        patient_metadata: patientMetadata,
        metadata: patientMetadata,
        latest_input_signature: snapshot.latestInputSignature,
        latest_inference_event_id: existingCase?.latest_inference_event_id ?? null,
        latest_outcome_event_id: existingCase?.latest_outcome_event_id ?? null,
        latest_simulation_event_id: existingCase?.latest_simulation_event_id ?? null,
        inference_event_count: existingCase?.inference_event_count ?? 0,
        first_inference_at: existingCase?.first_inference_at ?? input.observedAt,
        last_inference_at: existingCase?.last_inference_at ?? input.observedAt,
    });
}

export async function finalizeClinicalCaseAfterInference(
    store: ClinicalCaseStore,
    clinicalCase: ClinicalCaseRecord,
    inferenceEventId: string,
    context: ClinicalCaseEventContext,
): Promise<ClinicalCaseRecord> {
    return updateClinicalCaseActivity(store, clinicalCase, {
        latest_inference_event_id: inferenceEventId,
        inference_event_count: clinicalCase.inference_event_count + 1,
        last_inference_at: context.observedAt,
    }, context);
}

export async function finalizeClinicalCaseAfterOutcome(
    store: ClinicalCaseStore,
    clinicalCase: ClinicalCaseRecord,
    outcomeEventId: string,
    context: ClinicalCaseEventContext,
): Promise<ClinicalCaseRecord> {
    return updateClinicalCaseActivity(store, clinicalCase, {
        latest_outcome_event_id: outcomeEventId,
    }, context);
}

export async function finalizeClinicalCaseAfterSimulation(
    store: ClinicalCaseStore,
    clinicalCase: ClinicalCaseRecord,
    simulationEventId: string,
    context: ClinicalCaseEventContext,
): Promise<ClinicalCaseRecord> {
    return updateClinicalCaseActivity(store, clinicalCase, {
        latest_simulation_event_id: simulationEventId,
    }, context);
}

export function createSupabaseClinicalCaseStore(client: SupabaseClient): ClinicalCaseStore {
    const C = CLINICAL_CASES.COLUMNS;

    return {
        async findById(tenantId, caseId) {
            const { data, error } = await client
                .from(CLINICAL_CASES.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.id, caseId)
                .maybeSingle();

            if (error) {
                throw new Error(`Failed to fetch canonical clinical case: ${error.message}`);
            }

            return data ? mapClinicalCaseRow(data as Record<string, unknown>) : null;
        },

        async findByCaseKey(tenantId, caseKey) {
            const { data, error } = await client
                .from(CLINICAL_CASES.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.case_key, caseKey)
                .maybeSingle();

            if (error) {
                throw new Error(`Failed to fetch canonical clinical case by key: ${error.message}`);
            }

            return data ? mapClinicalCaseRow(data as Record<string, unknown>) : null;
        },

        async upsert(record) {
            const { data, error } = await client
                .from(CLINICAL_CASES.TABLE)
                .upsert(record, {
                    onConflict: `${C.tenant_id},${C.case_key}`,
                })
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to upsert canonical clinical case: ${error?.message ?? 'Unknown error'}`);
            }

            return mapClinicalCaseRow(data as Record<string, unknown>);
        },

        async updateById(tenantId, caseId, patch) {
            const { data, error } = await client
                .from(CLINICAL_CASES.TABLE)
                .update(patch)
                .eq(C.tenant_id, tenantId)
                .eq(C.id, caseId)
                .select('*')
                .single();

            if (error || !data) {
                throw new Error(`Failed to update canonical clinical case: ${error?.message ?? 'Unknown error'}`);
            }

            return mapClinicalCaseRow(data as Record<string, unknown>);
        },
    };
}

function buildClinicalCaseKey(input: {
    clinicId: string | null;
    preferredCaseId: string | null;
    sourceCaseReference: string | null;
    speciesCanonical: string | null;
    breed: string | null;
    symptomsNormalized: string[];
    patientMetadata: Record<string, unknown>;
    latestInputSignature: Record<string, unknown>;
}): string {
    if (input.preferredCaseId) {
        return `case:${input.preferredCaseId.toLowerCase()}`;
    }

    if (input.sourceCaseReference) {
        return `source:${sha256(input.sourceCaseReference.toLowerCase())}`;
    }

    const fingerprint = {
        clinic_id: input.clinicId,
        species: input.speciesCanonical,
        breed: input.breed?.toLowerCase() ?? null,
        symptoms: [...input.symptomsNormalized].sort(),
        metadata: normalizeFingerprintMetadata(input.patientMetadata),
        signature: input.latestInputSignature,
    };

    return `fingerprint:${sha256(stableStringify(fingerprint))}`;
}

function extractCaseMetadata(signature: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = {};

    if (isRecord(signature.metadata)) {
        Object.assign(merged, signature.metadata);
    }

    for (const [key, value] of Object.entries(signature)) {
        if (CORE_SIGNATURE_KEYS.has(key)) continue;
        merged[key] = value;
    }

    return sanitizeJsonRecord(merged);
}

function sanitizeSignatureForCase(signature: Record<string, unknown>): Record<string, unknown> {
    const symptoms = normalizeSymptomVector(signature.symptoms).sort();

    const base: Record<string, unknown> = {
        species_canonical: normalizeSpeciesValue(signature.species) ?? normalizeText(signature.species),
        species_display: normalizeText(signature.species) ?? normalizeSpeciesValue(signature.species),
        breed: normalizeBreedValue(signature.breed),
        symptoms_raw: normalizeSymptomsRaw(signature.symptoms),
        symptoms_normalized: symptoms,
        metadata: extractCaseMetadata(signature),
    };

    return sanitizeJsonRecord(base);
}

function normalizeFingerprintMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const rawNote = typeof metadata.raw_note === 'string'
        ? metadata.raw_note.replace(/\s+/g, ' ').trim().slice(0, 500)
        : undefined;

    return sanitizeJsonRecord({
        ...metadata,
        raw_note: rawNote,
    });
}

function mapClinicalCaseRow(row: Record<string, unknown>): ClinicalCaseRecord {
    const patientMetadata = isRecord(row.patient_metadata)
        ? row.patient_metadata
        : isRecord(row.metadata)
            ? row.metadata
            : {};
    const symptomsNormalized = Array.isArray(row.symptoms_normalized)
        ? row.symptoms_normalized.filter((value): value is string => typeof value === 'string')
        : Array.isArray(row.symptom_vector)
            ? row.symptom_vector.filter((value): value is string => typeof value === 'string')
            : [];
    const speciesCanonical = normalizeText(row.species_canonical) ?? normalizeText(row.species);
    const speciesDisplay = normalizeText(row.species_display)
        ?? normalizeText(row.species_raw)
        ?? speciesCanonical;

    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        user_id: normalizeUuid(row.user_id) ?? normalizeText(row.user_id),
        clinic_id: normalizeText(row.clinic_id),
        source_module: normalizeText(row.source_module),
        case_key: String(row.case_key),
        source_case_reference: normalizeText(row.source_case_reference),
        species: speciesCanonical,
        species_canonical: speciesCanonical,
        species_display: speciesDisplay,
        species_raw: normalizeText(row.species_raw),
        breed: normalizeText(row.breed),
        symptoms_raw: normalizeText(row.symptoms_raw),
        symptoms_normalized: symptomsNormalized,
        symptom_vector: symptomsNormalized,
        symptom_summary: normalizeText(row.symptom_summary),
        patient_metadata: patientMetadata,
        metadata: patientMetadata,
        latest_input_signature: isRecord(row.latest_input_signature) ? row.latest_input_signature : {},
        latest_inference_event_id: normalizeText(row.latest_inference_event_id),
        latest_outcome_event_id: normalizeText(row.latest_outcome_event_id),
        latest_simulation_event_id: normalizeText(row.latest_simulation_event_id),
        inference_event_count: typeof row.inference_event_count === 'number' ? row.inference_event_count : 0,
        first_inference_at: String(row.first_inference_at),
        last_inference_at: String(row.last_inference_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

async function updateClinicalCaseActivity(
    store: ClinicalCaseStore,
    clinicalCase: ClinicalCaseRecord,
    patch: Partial<ClinicalCaseUpsertRecord>,
    context: ClinicalCaseEventContext,
): Promise<ClinicalCaseRecord> {
    const metadata = mergeJsonRecords(
        clinicalCase.patient_metadata,
        context.metadataPatch ?? {},
    );

    return store.updateById(clinicalCase.tenant_id, clinicalCase.id, {
        ...patch,
        user_id: context.userId ?? clinicalCase.user_id ?? null,
        source_module: context.sourceModule ?? clinicalCase.source_module ?? null,
        patient_metadata: metadata,
        metadata,
    });
}

function mergeJsonRecords(
    base: Record<string, unknown>,
    patch: Record<string, unknown>,
): Record<string, unknown> {
    return sanitizeJsonRecord({
        ...base,
        ...patch,
    });
}

function sanitizeJsonRecord(record: Record<string, unknown>): Record<string, unknown> {
    const sanitizedEntries = Object.entries(record)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, sanitizeJsonValue(value)]);

    return Object.fromEntries(sanitizedEntries);
}

function sanitizeJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeJsonValue(entry));
    }

    if (isRecord(value)) {
        return sanitizeJsonRecord(value);
    }

    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
    ) {
        return value;
    }

    return String(value);
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }

    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function scientificNameCase(value: string): string {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .map((token, index) =>
            index === 0
                ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
                : token.toLowerCase(),
        )
        .join(' ');
}

function normalizeSymptomsRaw(value: unknown): string | null {
    if (typeof value === 'string') {
        return normalizeText(value);
    }

    if (!Array.isArray(value)) {
        return null;
    }

    const normalized = value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    return normalized.length > 0 ? normalized.join(', ') : null;
}

function normalizeUuid(value: unknown): string | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    return UUID_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized ? normalized : null;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
