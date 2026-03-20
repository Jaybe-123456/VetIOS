import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    buildInferenceLearningPatch,
    buildOutcomeLearningPatch,
    buildSimulationLearningPatch,
    deriveTelemetryStatus,
    type ClinicalCalibrationStatus,
    type ClinicalCaseIngestionStatus,
    type ClinicalCaseLabelType,
    type ClinicalEmergencyLevel,
    type ClinicalTriagePriority,
    type ClinicalLearningPatch,
    type ClinicalCaseValidationResult,
    validateClinicalCaseDraft,
} from '@/lib/clinicalCases/clinicalCaseIntelligence';
import { isPlaceholderValue, normalizeSymptomSet } from '@/lib/clinicalCases/symptomOntology';
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

const SPECIES_DISPLAY_LABELS: Record<string, string> = {
    'Canis lupus familiaris': 'Dog',
    'Felis catus': 'Cat',
    'Equus ferus caballus': 'Horse',
    'Bos taurus': 'Cow',
};

const BREED_PLACEHOLDERS = new Set(['-', '--', 'unknown', 'n/a', 'na', 'none', 'null']);
const CORE_SIGNATURE_KEYS = new Set(['species', 'breed', 'symptoms', 'metadata', 'diagnostic_images', 'lab_results']);

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
    symptom_text_raw: string | null;
    symptoms_raw: string | null;
    symptoms_normalized: string[];
    symptom_vector: string[];
    symptom_vector_normalized: Record<string, boolean>;
    symptom_summary: string | null;
    patient_metadata: Record<string, unknown>;
    metadata: Record<string, unknown>;
    latest_input_signature: Record<string, unknown>;
    ingestion_status: ClinicalCaseIngestionStatus;
    invalid_case: boolean;
    validation_error_code: string | null;
    primary_condition_class: string | null;
    top_diagnosis: string | null;
    predicted_diagnosis: string | null;
    confirmed_diagnosis: string | null;
    label_type: ClinicalCaseLabelType;
    diagnosis_confidence: number | null;
    severity_score: number | null;
    emergency_level: ClinicalEmergencyLevel | null;
    triage_priority: ClinicalTriagePriority | null;
    contradiction_score: number | null;
    contradiction_flags: string[];
    adversarial_case: boolean;
    adversarial_case_type: string | null;
    uncertainty_notes: string[];
    case_cluster: string | null;
    model_version: string | null;
    telemetry_status: string | null;
    calibration_status: ClinicalCalibrationStatus | null;
    prediction_correct: boolean | null;
    confidence_error: number | null;
    calibration_bucket: string | null;
    degraded_confidence: number | null;
    differential_spread: Record<string, unknown> | null;
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
    updateById(tenantId: string, caseId: string, patch: Partial<ClinicalCaseUpsertRecord>): Promise<ClinicalCaseRecord>;
}

export interface ClinicalCaseUpsertRecord extends Omit<ClinicalCaseRecord, 'id' | 'created_at' | 'updated_at'> {
    id?: string;
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

export interface ClinicalCaseInferenceContext extends ClinicalCaseEventContext {
    outputPayload?: Record<string, unknown>;
    confidenceScore?: number | null;
    modelVersion?: string | null;
    syncMode?: 'live' | 'backfill';
    inferenceHistoryCount?: number;
    firstObservedAt?: string;
}

export interface ClinicalCaseOutcomeContext extends ClinicalCaseEventContext {
    outcomePayload?: Record<string, unknown>;
    outcomeType?: string;
}

export interface ClinicalCaseSimulationContext extends ClinicalCaseEventContext {
    simulationType?: string;
    stressMetrics?: Record<string, unknown> | null;
}

interface ClinicalCaseSnapshot {
    preferredCaseId: string | null;
    caseKey: string;
    sourceCaseReference: string | null;
    speciesCanonical: string | null;
    speciesDisplay: string | null;
    speciesRaw: string | null;
    breed: string | null;
    symptomTextRaw: string | null;
    symptomsNormalized: string[];
    symptomVectorNormalized: Record<string, boolean>;
    symptomSummary: string | null;
    patientMetadata: Record<string, unknown>;
    latestInputSignature: Record<string, unknown>;
    validation: ClinicalCaseValidationResult;
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
    if (!normalized || BREED_PLACEHOLDERS.has(normalized.toLowerCase())) return null;

    return normalized
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
        .join(' ');
}

export function normalizeSymptomVector(value: unknown): string[] {
    return normalizeSymptomSet(value).normalizedKeys;
}

export function buildClinicalCaseSnapshot(input: EnsureCanonicalClinicalCaseInput): ClinicalCaseSnapshot {
    const preferredCaseId = normalizeUuid(input.requestedCaseId);
    const sourceCaseReference = preferredCaseId ? null : normalizeText(input.requestedCaseId);
    const speciesRaw = normalizeText(input.inputSignature.species);
    const speciesCanonical = normalizeSpeciesValue(speciesRaw);
    const symptoms = normalizeSymptomSet(input.inputSignature.symptoms);
    const patientMetadata = extractCaseMetadata(input.inputSignature);
    const latestInputSignature = sanitizeSignatureForCase(input.inputSignature);

    return {
        preferredCaseId,
        caseKey: buildClinicalCaseKey({
            clinicId: input.clinicId ?? null,
            preferredCaseId,
            sourceCaseReference,
            speciesCanonical,
            breed: normalizeBreedValue(input.inputSignature.breed),
            symptomsNormalized: symptoms.normalizedKeys,
            patientMetadata,
            latestInputSignature,
        }),
        sourceCaseReference,
        speciesCanonical,
        speciesDisplay: resolveSpeciesDisplay(speciesRaw, speciesCanonical),
        speciesRaw,
        breed: normalizeBreedValue(input.inputSignature.breed),
        symptomTextRaw: symptoms.rawText,
        symptomsNormalized: symptoms.normalizedKeys,
        symptomVectorNormalized: symptoms.vector,
        symptomSummary: symptoms.normalizedKeys.length > 0
            ? symptoms.normalizedKeys.slice(0, 8).join(', ')
            : normalizeText(symptoms.rawText),
        patientMetadata,
        latestInputSignature,
        validation: validateClinicalCaseDraft({
            speciesCanonical,
            speciesRaw,
            symptomsRaw: symptoms.rawText,
            symptomKeys: symptoms.normalizedKeys,
            unresolvedSymptoms: symptoms.unresolvedTokens,
        }),
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

    const symptomsNormalized = snapshot.symptomsNormalized.length > 0
        ? snapshot.symptomsNormalized
        : existingCase?.symptoms_normalized ?? [];
    const validation = chooseValidationState(existingCase, snapshot.validation);
    const learning = pickExistingLearningState(existingCase);
    const patientMetadata = mergeJsonRecords(
        existingCase?.patient_metadata ?? existingCase?.metadata ?? {},
        snapshot.patientMetadata,
    );
    const telemetryStatus = validation.invalid_case
        ? validation.ingestion_status
        : learning.telemetry_status ?? deriveTelemetryStatus({
            hasDiagnosis: Boolean(
                learning.top_diagnosis ||
                learning.confirmed_diagnosis ||
                learning.primary_condition_class,
            ),
            hasSeverity: Boolean(learning.emergency_level || learning.severity_score !== null),
            isInvalid: false,
            adversarialCase: learning.adversarial_case,
        });

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
        species_display: snapshot.speciesDisplay ??
            existingCase?.species_display ??
            resolveSpeciesDisplay(existingCase?.species_raw ?? null, existingCase?.species_canonical ?? existingCase?.species ?? null),
        species_raw: snapshot.speciesRaw ?? existingCase?.species_raw ?? null,
        breed: snapshot.breed ?? existingCase?.breed ?? null,
        symptom_text_raw: snapshot.symptomTextRaw ?? existingCase?.symptom_text_raw ?? existingCase?.symptoms_raw ?? null,
        symptoms_raw: snapshot.symptomTextRaw ?? existingCase?.symptoms_raw ?? null,
        symptoms_normalized: symptomsNormalized,
        symptom_vector: symptomsNormalized,
        symptom_vector_normalized: Object.keys(snapshot.symptomVectorNormalized).length > 0
            ? snapshot.symptomVectorNormalized
            : existingCase?.symptom_vector_normalized ?? vectorFromKeys(symptomsNormalized),
        symptom_summary: snapshot.symptomSummary ??
            existingCase?.symptom_summary ??
            (symptomsNormalized.length > 0 ? symptomsNormalized.slice(0, 8).join(', ') : null),
        patient_metadata: patientMetadata,
        metadata: patientMetadata,
        latest_input_signature: snapshot.latestInputSignature,
        ingestion_status: validation.ingestion_status,
        invalid_case: validation.invalid_case,
        validation_error_code: validation.validation_error_code,
        primary_condition_class: learning.primary_condition_class,
        top_diagnosis: learning.top_diagnosis,
        predicted_diagnosis: learning.predicted_diagnosis,
        confirmed_diagnosis: learning.confirmed_diagnosis,
        label_type: learning.label_type,
        diagnosis_confidence: learning.diagnosis_confidence,
        severity_score: learning.severity_score,
        emergency_level: learning.emergency_level,
        triage_priority: learning.triage_priority,
        contradiction_score: learning.contradiction_score,
        contradiction_flags: learning.contradiction_flags,
        adversarial_case: learning.adversarial_case,
        adversarial_case_type: learning.adversarial_case_type,
        uncertainty_notes: learning.uncertainty_notes,
        case_cluster: learning.case_cluster,
        model_version: learning.model_version,
        telemetry_status: telemetryStatus,
        calibration_status: learning.calibration_status,
        prediction_correct: learning.prediction_correct,
        confidence_error: learning.confidence_error,
        calibration_bucket: learning.calibration_bucket,
        degraded_confidence: learning.degraded_confidence,
        differential_spread: learning.differential_spread,
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
    context: ClinicalCaseInferenceContext,
): Promise<ClinicalCaseRecord> {
    const shouldPromoteInference =
        !clinicalCase.latest_inference_event_id ||
        context.syncMode === 'backfill' ||
        context.observedAt >= clinicalCase.last_inference_at;
    const learningPatch = context.outputPayload
        ? buildInferenceLearningPatch({
            outputPayload: context.outputPayload,
            confidenceScore: context.confidenceScore ?? null,
            modelVersion: context.modelVersion ?? null,
            sourceModule: context.sourceModule ?? clinicalCase.source_module ?? null,
            symptomKeys: clinicalCase.symptoms_normalized,
            existing: pickExistingLearningState(clinicalCase),
            preferIncoming: shouldPromoteInference,
        })
        : null;

    return updateClinicalCaseActivity(store, clinicalCase, {
        latest_inference_event_id: shouldPromoteInference
            ? inferenceEventId
            : clinicalCase.latest_inference_event_id,
        inference_event_count: context.syncMode === 'backfill'
            ? Math.max(context.inferenceHistoryCount ?? clinicalCase.inference_event_count, clinicalCase.inference_event_count)
            : clinicalCase.inference_event_count + 1,
        first_inference_at: context.syncMode === 'backfill'
            ? (context.firstObservedAt ?? clinicalCase.first_inference_at)
            : clinicalCase.first_inference_at,
        last_inference_at: shouldPromoteInference
            ? context.observedAt
            : clinicalCase.last_inference_at,
    }, context, learningPatch);
}

export async function finalizeClinicalCaseAfterOutcome(
    store: ClinicalCaseStore,
    clinicalCase: ClinicalCaseRecord,
    outcomeEventId: string,
    context: ClinicalCaseOutcomeContext,
): Promise<ClinicalCaseRecord> {
    const learningPatch = context.outcomePayload
        ? buildOutcomeLearningPatch({
            outcomePayload: context.outcomePayload,
            outcomeType: context.outcomeType ?? 'outcome_learning',
            existing: pickExistingLearningState(clinicalCase),
        })
        : null;

    return updateClinicalCaseActivity(store, clinicalCase, {
        latest_outcome_event_id: outcomeEventId,
    }, context, learningPatch);
}

export async function finalizeClinicalCaseAfterSimulation(
    store: ClinicalCaseStore,
    clinicalCase: ClinicalCaseRecord,
    simulationEventId: string,
    context: ClinicalCaseSimulationContext,
): Promise<ClinicalCaseRecord> {
    const learningPatch = buildSimulationLearningPatch({
        simulationType: context.simulationType ?? 'adversarial_simulation',
        stressMetrics: context.stressMetrics ?? null,
        existing: pickExistingLearningState(clinicalCase),
    });

    return updateClinicalCaseActivity(store, clinicalCase, {
        latest_simulation_event_id: simulationEventId,
    }, context, learningPatch);
}

export async function applyClinicalCaseLearningSync(
    store: ClinicalCaseStore,
    clinicalCase: ClinicalCaseRecord,
    context: ClinicalCaseEventContext,
    patch: Partial<ClinicalCaseUpsertRecord>,
    learningPatch: Partial<ClinicalLearningPatch> | null,
): Promise<ClinicalCaseRecord> {
    return updateClinicalCaseActivity(store, clinicalCase, patch, context, learningPatch);
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

    return `fingerprint:${sha256(stableStringify({
        clinic_id: input.clinicId,
        species: input.speciesCanonical,
        breed: input.breed?.toLowerCase() ?? null,
        symptoms: [...input.symptomsNormalized].sort(),
        metadata: normalizeFingerprintMetadata(input.patientMetadata),
        signature: input.latestInputSignature,
    }))}`;
}

function extractCaseMetadata(signature: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = isRecord(signature.metadata)
        ? { ...signature.metadata }
        : {};

    for (const [key, value] of Object.entries(signature)) {
        if (!CORE_SIGNATURE_KEYS.has(key)) {
            merged[key] = value;
        }
    }

    return sanitizeJsonRecord(merged);
}

function sanitizeSignatureForCase(signature: Record<string, unknown>): Record<string, unknown> {
    const symptoms = normalizeSymptomSet(signature.symptoms);

    return sanitizeJsonRecord({
        species_canonical: normalizeSpeciesValue(signature.species) ?? normalizeText(signature.species),
        species_display: resolveSpeciesDisplay(
            normalizeText(signature.species),
            normalizeSpeciesValue(signature.species),
        ),
        breed: normalizeBreedValue(signature.breed),
        symptom_text_raw: symptoms.rawText,
        symptoms_raw: symptoms.rawText,
        symptoms_normalized: symptoms.normalizedKeys,
        symptom_vector_normalized: symptoms.vector,
        metadata: extractCaseMetadata(signature),
    });
}

function normalizeFingerprintMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    return sanitizeJsonRecord({
        ...metadata,
        raw_note: typeof metadata.raw_note === 'string'
            ? metadata.raw_note.replace(/\s+/g, ' ').trim().slice(0, 500)
            : undefined,
    });
}

export function mapClinicalCaseRow(row: Record<string, unknown>): ClinicalCaseRecord {
    const symptomsNormalized = readStringArray(row.symptoms_normalized, row.symptom_vector);
    const symptomVectorNormalized = isRecord(row.symptom_vector_normalized)
        ? booleanRecord(row.symptom_vector_normalized)
        : vectorFromKeys(symptomsNormalized);
    const patientMetadata = isRecord(row.patient_metadata)
        ? row.patient_metadata
        : isRecord(row.metadata)
            ? row.metadata
            : {};

    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        user_id: normalizeUuid(row.user_id) ?? normalizeText(row.user_id),
        clinic_id: normalizeText(row.clinic_id),
        source_module: normalizeText(row.source_module),
        case_key: String(row.case_key),
        source_case_reference: normalizeText(row.source_case_reference),
        species: normalizeText(row.species_canonical) ?? normalizeText(row.species),
        species_canonical: normalizeText(row.species_canonical) ?? normalizeText(row.species),
        species_display: normalizeText(row.species_display) ??
            resolveSpeciesDisplay(
                normalizeText(row.species_raw),
                normalizeText(row.species_canonical) ?? normalizeText(row.species),
            ),
        species_raw: normalizeText(row.species_raw),
        breed: normalizeBreedValue(row.breed) ?? normalizeText(row.breed),
        symptom_text_raw: normalizeText(row.symptom_text_raw) ?? normalizeText(row.symptoms_raw),
        symptoms_raw: normalizeText(row.symptoms_raw),
        symptoms_normalized: symptomsNormalized,
        symptom_vector: symptomsNormalized,
        symptom_vector_normalized: symptomVectorNormalized,
        symptom_summary: normalizeText(row.symptom_summary),
        patient_metadata: patientMetadata,
        metadata: patientMetadata,
        latest_input_signature: isRecord(row.latest_input_signature) ? row.latest_input_signature : {},
        ingestion_status: normalizeIngestionStatus(row.ingestion_status),
        invalid_case: row.invalid_case === true,
        validation_error_code: normalizeText(row.validation_error_code),
        primary_condition_class: normalizeText(row.primary_condition_class),
        top_diagnosis: normalizeText(row.top_diagnosis),
        confirmed_diagnosis: normalizeText(row.confirmed_diagnosis),
        predicted_diagnosis: normalizeText(row.predicted_diagnosis) ?? normalizeText(row.top_diagnosis),
        label_type: normalizeLabelType(row.label_type),
        diagnosis_confidence: normalizeNumber(row.diagnosis_confidence),
        severity_score: normalizeNumber(row.severity_score),
        emergency_level: normalizeEmergencyLevel(row.emergency_level),
        triage_priority: normalizeTriagePriority(row.triage_priority),
        contradiction_score: normalizeNumber(row.contradiction_score),
        contradiction_flags: readStringArray(row.contradiction_flags),
        adversarial_case: row.adversarial_case === true,
        adversarial_case_type: normalizeText(row.adversarial_case_type),
        uncertainty_notes: readStringArray(row.uncertainty_notes),
        case_cluster: normalizeText(row.case_cluster),
        model_version: normalizeText(row.model_version),
        telemetry_status: normalizeText(row.telemetry_status),
        calibration_status: normalizeCalibrationStatus(row.calibration_status),
        prediction_correct: typeof row.prediction_correct === 'boolean' ? row.prediction_correct : null,
        confidence_error: normalizeNumber(row.confidence_error),
        calibration_bucket: normalizeText(row.calibration_bucket),
        degraded_confidence: normalizeNumber(row.degraded_confidence),
        differential_spread: isRecord(row.differential_spread) ? row.differential_spread : null,
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
    learningPatch: Partial<ClinicalLearningPatch> | null,
): Promise<ClinicalCaseRecord> {
    const metadata = mergeJsonRecords(clinicalCase.patient_metadata, context.metadataPatch ?? {});
    const currentLearning = pickExistingLearningState(clinicalCase);
    const nextLearning = { ...currentLearning, ...(learningPatch ?? {}) };
    const telemetryStatus = clinicalCase.invalid_case
        ? clinicalCase.ingestion_status
        : nextLearning.telemetry_status ?? deriveTelemetryStatus({
            hasDiagnosis: Boolean(
                nextLearning.top_diagnosis ||
                nextLearning.confirmed_diagnosis ||
                nextLearning.primary_condition_class,
            ),
            hasSeverity: Boolean(nextLearning.emergency_level || nextLearning.severity_score !== null),
            isInvalid: false,
            adversarialCase: nextLearning.adversarial_case,
        });

    return store.updateById(clinicalCase.tenant_id, clinicalCase.id, {
        ...patch,
        user_id: context.userId ?? clinicalCase.user_id ?? null,
        source_module: context.sourceModule ?? clinicalCase.source_module ?? null,
        patient_metadata: metadata,
        metadata,
        primary_condition_class: nextLearning.primary_condition_class,
        top_diagnosis: nextLearning.top_diagnosis,
        predicted_diagnosis: nextLearning.predicted_diagnosis,
        confirmed_diagnosis: nextLearning.confirmed_diagnosis,
        label_type: nextLearning.label_type,
        diagnosis_confidence: nextLearning.diagnosis_confidence,
        severity_score: nextLearning.severity_score,
        emergency_level: nextLearning.emergency_level,
        triage_priority: nextLearning.triage_priority,
        contradiction_score: nextLearning.contradiction_score,
        contradiction_flags: nextLearning.contradiction_flags,
        adversarial_case: nextLearning.adversarial_case,
        adversarial_case_type: nextLearning.adversarial_case_type,
        uncertainty_notes: nextLearning.uncertainty_notes,
        case_cluster: nextLearning.case_cluster,
        model_version: nextLearning.model_version,
        telemetry_status: telemetryStatus,
        calibration_status: nextLearning.calibration_status,
        prediction_correct: nextLearning.prediction_correct,
        confidence_error: nextLearning.confidence_error,
        calibration_bucket: nextLearning.calibration_bucket,
        degraded_confidence: nextLearning.degraded_confidence,
        differential_spread: nextLearning.differential_spread,
    });
}

function pickExistingLearningState(clinicalCase: ClinicalCaseRecord | null): ClinicalLearningPatch {
    return {
        primary_condition_class: clinicalCase?.primary_condition_class ?? null,
        top_diagnosis: clinicalCase?.top_diagnosis ?? null,
        predicted_diagnosis: clinicalCase?.predicted_diagnosis ?? clinicalCase?.top_diagnosis ?? null,
        confirmed_diagnosis: clinicalCase?.confirmed_diagnosis ?? null,
        label_type: clinicalCase?.label_type ?? 'inferred_only',
        diagnosis_confidence: clinicalCase?.diagnosis_confidence ?? null,
        severity_score: clinicalCase?.severity_score ?? null,
        emergency_level: clinicalCase?.emergency_level ?? null,
        triage_priority: clinicalCase?.triage_priority ?? null,
        contradiction_score: clinicalCase?.contradiction_score ?? null,
        contradiction_flags: clinicalCase?.contradiction_flags ?? [],
        adversarial_case: clinicalCase?.adversarial_case ?? false,
        adversarial_case_type: clinicalCase?.adversarial_case_type ?? null,
        uncertainty_notes: clinicalCase?.uncertainty_notes ?? [],
        case_cluster: clinicalCase?.case_cluster ?? null,
        model_version: clinicalCase?.model_version ?? null,
        telemetry_status: clinicalCase?.telemetry_status ?? clinicalCase?.ingestion_status ?? 'pending',
        calibration_status: clinicalCase?.calibration_status ?? null,
        prediction_correct: clinicalCase?.prediction_correct ?? null,
        confidence_error: clinicalCase?.confidence_error ?? null,
        calibration_bucket: clinicalCase?.calibration_bucket ?? null,
        degraded_confidence: clinicalCase?.degraded_confidence ?? null,
        differential_spread: clinicalCase?.differential_spread ?? null,
    };
}

function chooseValidationState(
    existingCase: ClinicalCaseRecord | null,
    incoming: ClinicalCaseValidationResult,
): ClinicalCaseValidationResult {
    if (!existingCase) return incoming;
    if (!existingCase.invalid_case) {
        return {
            ingestion_status: existingCase.ingestion_status,
            invalid_case: false,
            validation_error_code: existingCase.validation_error_code,
        };
    }
    return incoming;
}

function resolveSpeciesDisplay(speciesRaw: string | null, speciesCanonical: string | null): string | null {
    if (speciesCanonical) {
        return SPECIES_DISPLAY_LABELS[speciesCanonical] ?? speciesCanonical;
    }

    const normalizedRaw = normalizeText(speciesRaw);
    return normalizedRaw;
}

function vectorFromKeys(keys: string[]): Record<string, boolean> {
    return Object.fromEntries(keys.map((key) => [key, true]));
}

function booleanRecord(value: Record<string, unknown>): Record<string, boolean> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry === true),
    ) as Record<string, boolean>;
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
    return Object.fromEntries(
        Object.entries(record)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, sanitizeJsonValue(value)]),
    );
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

function normalizeUuid(value: unknown): string | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    return UUID_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized && !isPlaceholderValue(normalized) ? normalized : null;
}

function normalizeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized) return null;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeIngestionStatus(value: unknown): ClinicalCaseIngestionStatus {
    return value === 'accepted' || value === 'rejected' || value === 'quarantined'
        ? value
        : 'accepted';
}

function normalizeLabelType(value: unknown): ClinicalCaseLabelType {
    return value === 'inferred_only' || value === 'synthetic' || value === 'expert_reviewed' || value === 'lab_confirmed'
        ? value
        : 'inferred_only';
}

function normalizeCalibrationStatus(value: unknown): ClinicalCalibrationStatus | null {
    return value === 'pending_outcome' || value === 'calibrated_match' || value === 'calibrated_mismatch' || value === 'no_prediction_anchor'
        ? value
        : null;
}

function normalizeEmergencyLevel(value: unknown): ClinicalEmergencyLevel | null {
    const normalized = typeof value === 'string' ? value.toUpperCase() : value;
    return normalized === 'CRITICAL' || normalized === 'HIGH' || normalized === 'MODERATE' || normalized === 'LOW'
        ? normalized
        : null;
}

function normalizeTriagePriority(value: unknown): ClinicalTriagePriority | null {
    return value === 'immediate' || value === 'urgent' || value === 'standard' || value === 'low'
        ? value
        : null;
}

function readStringArray(...values: unknown[]): string[] {
    const entries: string[] = [];

    for (const value of values) {
        if (!Array.isArray(value)) continue;
        for (const entry of value) {
            const normalized = normalizeText(entry);
            if (normalized) {
                entries.push(normalized);
            }
        }
    }

    return Array.from(new Set(entries));
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
