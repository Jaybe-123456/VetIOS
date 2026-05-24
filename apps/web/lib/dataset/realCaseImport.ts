import type { SupabaseClient } from '@supabase/supabase-js';
import {
    buildClinicalCaseSnapshot,
    createSupabaseClinicalCaseStore,
    ensureCanonicalClinicalCase,
    type ClinicalCaseRecord,
} from '@/lib/clinicalCases/clinicalCaseManager';
import { CLINICAL_OUTCOME_EVENTS } from '@/lib/db/schemaContracts';

export type DiagnosisMethod = 'clinical' | 'lab_confirmed' | 'imaging_confirmed' | 'pathology' | 'response_to_treatment';

export type RealCaseUsageClass =
    | 'credentialed_deidentified'
    | 'internal_deidentified'
    | 'consented_research';

export interface RealCaseImportPatient {
    species: string;
    breed?: string | null;
    age_years?: number | null;
    weight_kg?: number | null;
    sex?: string | null;
    deidentified_patient_ref?: string | null;
    name?: string | null;
    owner_name?: string | null;
    owner_contact?: Record<string, unknown> | null;
    microchip_id?: string | null;
}

export interface RealCaseImportRow {
    source_case_reference: string;
    usage_class: RealCaseUsageClass;
    deidentified: boolean;
    patient: RealCaseImportPatient;
    presenting_complaint: string;
    symptoms: string[];
    history?: string | null;
    physical_exam?: Record<string, unknown> | null;
    diagnostics?: Record<string, unknown> | null;
    labs?: Record<string, unknown> | null;
    confirmed_diagnosis: string;
    diagnosis_method?: DiagnosisMethod | null;
    diagnosis_confidence?: number | null;
    primary_condition_class?: string | null;
    outcome_at_followup?: string | null;
    observed_at?: string | null;
    learning_consent?: {
        deidentified_training?: boolean;
        consent_version?: string | null;
    } | null;
    metadata?: Record<string, unknown> | null;
}

export interface RealCaseImportRejectedRow {
    source_case_reference: string | null;
    status: 'rejected';
    error_codes: string[];
    error_messages: string[];
}

export interface RealCaseImportAcceptedRow {
    source_case_reference: string;
    status: 'accepted' | 'validated';
    clinical_case_id: string | null;
    outcome_event_id: string | null;
    case_key: string;
    learning_ready: boolean;
}

export interface RealCaseImportReport {
    dry_run: boolean;
    imported: RealCaseImportAcceptedRow[];
    rejected: RealCaseImportRejectedRow[];
    summary: {
        total: number;
        accepted: number;
        rejected: number;
        learning_ready: number;
        consent_required_rejections: number;
        phi_rejections: number;
    };
}

const DIRECT_IDENTIFIER_PATTERNS: Array<{ code: string; pattern: RegExp; message: string }> = [
    { code: 'possible_email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, message: 'Free text contains a possible email address.' },
    { code: 'possible_phone', pattern: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/, message: 'Free text contains a possible phone number.' },
    { code: 'possible_microchip', pattern: /\b(?:microchip|chip id|chip number)\s*[:#]?\s*[a-z0-9-]{6,}\b/i, message: 'Free text contains a possible microchip or raw patient identifier.' },
];

export function validateRealCaseImportRow(
    row: RealCaseImportRow,
    options: { tenantConsentGranted: boolean },
): { ok: true; observedAt: string; inputSignature: Record<string, unknown>; caseKey: string } | { ok: false; rejection: RealCaseImportRejectedRow } {
    const errors: Array<{ code: string; message: string }> = [];
    const sourceCaseReference = normalizeText(row.source_case_reference);

    if (!sourceCaseReference) {
        errors.push({ code: 'missing_source_case_reference', message: 'source_case_reference is required for idempotent real-case import.' });
    }
    if (row.deidentified !== true) {
        errors.push({ code: 'not_marked_deidentified', message: 'Real case imports must be explicitly marked deidentified.' });
    }
    if (!isAllowedUsageClass(row.usage_class)) {
        errors.push({ code: 'unsupported_usage_class', message: 'usage_class must be credentialed_deidentified, internal_deidentified, or consented_research.' });
    }
    if (!options.tenantConsentGranted && row.learning_consent?.deidentified_training !== true) {
        errors.push({ code: 'learning_consent_missing', message: 'Tenant or case-level deidentified training consent is required before importing real cases.' });
    }
    if (!normalizeText(row.patient?.species)) {
        errors.push({ code: 'missing_species', message: 'patient.species is required.' });
    }
    if (!normalizeText(row.presenting_complaint)) {
        errors.push({ code: 'missing_presenting_complaint', message: 'presenting_complaint is required.' });
    }
    if (!Array.isArray(row.symptoms) || row.symptoms.filter((entry) => normalizeText(entry)).length === 0) {
        errors.push({ code: 'missing_symptoms', message: 'At least one symptom is required.' });
    }
    if (!normalizeText(row.confirmed_diagnosis)) {
        errors.push({ code: 'missing_confirmed_diagnosis', message: 'confirmed_diagnosis is required for learning-ready real-case import.' });
    }

    if (normalizeText(row.patient?.name)) {
        errors.push({ code: 'patient_name_present', message: 'patient.name must be removed before de-identified import.' });
    }
    if (normalizeText(row.patient?.owner_name)) {
        errors.push({ code: 'owner_name_present', message: 'patient.owner_name must be removed before de-identified import.' });
    }
    if (row.patient?.owner_contact && Object.keys(row.patient.owner_contact).length > 0) {
        errors.push({ code: 'owner_contact_present', message: 'patient.owner_contact must be removed before de-identified import.' });
    }
    if (normalizeText(row.patient?.microchip_id)) {
        errors.push({ code: 'microchip_present', message: 'patient.microchip_id must be removed before de-identified import.' });
    }

    const identifierHits = scanForDirectIdentifiers(row);
    errors.push(...identifierHits);

    const observedAt = normalizeTimestamp(row.observed_at) ?? new Date().toISOString();
    const inputSignature = buildRealCaseInputSignature(row, observedAt);
    const snapshot = buildClinicalCaseSnapshot({
        tenantId: '00000000-0000-4000-8000-000000000000',
        requestedCaseId: sourceCaseReference,
        inputSignature,
        observedAt,
    });

    if (errors.length > 0) {
        return {
            ok: false,
            rejection: {
                source_case_reference: sourceCaseReference,
                status: 'rejected',
                error_codes: errors.map((error) => error.code),
                error_messages: errors.map((error) => error.message),
            },
        };
    }

    return {
        ok: true,
        observedAt,
        inputSignature,
        caseKey: snapshot.caseKey,
    };
}

export async function importRealClinicalCases(
    client: SupabaseClient,
    input: {
        tenantId: string;
        userId?: string | null;
        clinicId?: string | null;
        sourceName?: string | null;
        cases: RealCaseImportRow[];
        dryRun?: boolean;
        tenantConsentGranted: boolean;
    },
): Promise<RealCaseImportReport> {
    const store = createSupabaseClinicalCaseStore(client);
    const imported: RealCaseImportAcceptedRow[] = [];
    const rejected: RealCaseImportRejectedRow[] = [];
    const dryRun = input.dryRun === true;

    for (const row of input.cases) {
        const validation = validateRealCaseImportRow(row, {
            tenantConsentGranted: input.tenantConsentGranted,
        });
        if (!validation.ok) {
            rejected.push(validation.rejection);
            continue;
        }

        if (dryRun) {
            imported.push({
                source_case_reference: row.source_case_reference,
                status: 'validated',
                clinical_case_id: null,
                outcome_event_id: null,
                case_key: validation.caseKey,
                learning_ready: true,
            });
            continue;
        }

        const clinicalCase = await ensureCanonicalClinicalCase(store, {
            tenantId: input.tenantId,
            userId: input.userId ?? null,
            clinicId: input.clinicId ?? null,
            requestedCaseId: row.source_case_reference,
            sourceModule: 'real_case_import',
            inputSignature: validation.inputSignature,
            observedAt: validation.observedAt,
        });
        const updatedCase = await markCaseLearningReady(store, clinicalCase, row, validation.observedAt, input.sourceName);
        const outcomeEventId = await insertImportedOutcomeEvent(client, {
            tenantId: input.tenantId,
            userId: input.userId ?? null,
            clinicId: input.clinicId ?? null,
            clinicalCaseId: updatedCase.id,
            row,
            observedAt: validation.observedAt,
            sourceName: input.sourceName ?? null,
        });

        imported.push({
            source_case_reference: row.source_case_reference,
            status: 'accepted',
            clinical_case_id: updatedCase.id,
            outcome_event_id: outcomeEventId,
            case_key: updatedCase.case_key,
            learning_ready: true,
        });
    }

    return buildReport({
        dryRun,
        imported,
        rejected,
        total: input.cases.length,
    });
}

export function buildRealCaseInputSignature(row: RealCaseImportRow, observedAt: string): Record<string, unknown> {
    const metadata = stripEmpty({
        source: 'real_case_import',
        source_case_reference: normalizeText(row.source_case_reference),
        usage_class: row.usage_class,
        deidentified: row.deidentified,
        consent_version: normalizeText(row.learning_consent?.consent_version) ?? 'vetios_learning_consent_v1',
        deidentified_patient_ref: normalizeText(row.patient?.deidentified_patient_ref),
        age_years: normalizeNumber(row.patient?.age_years),
        weight_kg: normalizeNumber(row.patient?.weight_kg),
        sex: normalizeText(row.patient?.sex),
        presenting_complaint: normalizeText(row.presenting_complaint),
        history: normalizeText(row.history),
        physical_exam: asRecord(row.physical_exam),
        diagnostics: asRecord(row.diagnostics),
        labs: asRecord(row.labs),
        confirmed_diagnosis: normalizeText(row.confirmed_diagnosis),
        diagnosis_method: normalizeDiagnosisMethod(row.diagnosis_method),
        diagnosis_confidence: normalizeConfidence(row.diagnosis_confidence),
        primary_condition_class: normalizeText(row.primary_condition_class),
        outcome_at_followup: normalizeText(row.outcome_at_followup),
        observed_at: observedAt,
        import_metadata: asRecord(row.metadata),
    });

    return stripEmpty({
        species: normalizeText(row.patient?.species),
        breed: normalizeText(row.patient?.breed),
        symptoms: uniqueStrings([row.presenting_complaint, ...(Array.isArray(row.symptoms) ? row.symptoms : [])]),
        metadata,
        presenting_complaint: normalizeText(row.presenting_complaint),
        history: normalizeText(row.history),
        physical_exam: asRecord(row.physical_exam),
        lab_results: asRecord(row.labs),
        diagnostics: asRecord(row.diagnostics),
    });
}

async function markCaseLearningReady(
    store: ReturnType<typeof createSupabaseClinicalCaseStore>,
    clinicalCase: ClinicalCaseRecord,
    row: RealCaseImportRow,
    observedAt: string,
    sourceName: string | null | undefined,
): Promise<ClinicalCaseRecord> {
    const diagnosis = normalizeText(row.confirmed_diagnosis);
    const diagnosisConfidence = normalizeConfidence(row.diagnosis_confidence) ?? 0.95;
    const metadata = {
        ...clinicalCase.metadata,
        real_case_import: {
            source_name: normalizeText(sourceName),
            source_case_reference: normalizeText(row.source_case_reference),
            usage_class: row.usage_class,
            deidentified: row.deidentified,
            imported_at: new Date().toISOString(),
        },
    };

    return store.updateById(clinicalCase.tenant_id, clinicalCase.id, {
        source_module: 'real_case_import',
        ingestion_status: 'accepted',
        invalid_case: false,
        validation_error_code: null,
        metadata,
        patient_metadata: {
            ...clinicalCase.patient_metadata,
            deidentified_patient_ref: normalizeText(row.patient?.deidentified_patient_ref),
            age_years: normalizeNumber(row.patient?.age_years),
            weight_kg: normalizeNumber(row.patient?.weight_kg),
            sex: normalizeText(row.patient?.sex),
        },
        resolved_at: observedAt,
        primary_condition_class: normalizeText(row.primary_condition_class),
        top_diagnosis: diagnosis,
        predicted_diagnosis: diagnosis,
        confirmed_diagnosis: diagnosis,
        label_type: normalizeDiagnosisMethod(row.diagnosis_method) === 'lab_confirmed' || normalizeDiagnosisMethod(row.diagnosis_method) === 'pathology'
            ? 'lab_confirmed'
            : 'expert_reviewed',
        diagnosis_confidence: diagnosisConfidence,
        model_version: 'real_case_import_v1',
        telemetry_status: 'learning_ready',
        calibration_status: 'no_prediction_anchor',
        prediction_correct: null,
        confidence_error: null,
    });
}

async function insertImportedOutcomeEvent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        userId: string | null;
        clinicId: string | null;
        clinicalCaseId: string;
        row: RealCaseImportRow;
        observedAt: string;
        sourceName: string | null;
    },
): Promise<string | null> {
    const C = CLINICAL_OUTCOME_EVENTS.COLUMNS;
    const payload = {
        [C.tenant_id]: input.tenantId,
        [C.user_id]: input.userId,
        [C.clinic_id]: input.clinicId,
        [C.case_id]: input.clinicalCaseId,
        [C.source_module]: 'real_case_import',
        [C.inference_event_id]: null,
        [C.outcome_type]: 'confirmed_diagnosis_import',
        [C.outcome_payload]: {
            source_name: input.sourceName,
            source_case_reference: input.row.source_case_reference,
            usage_class: input.row.usage_class,
            deidentified: input.row.deidentified,
            confirmed_diagnosis: input.row.confirmed_diagnosis,
            diagnosis_method: normalizeDiagnosisMethod(input.row.diagnosis_method),
            diagnosis_confidence: normalizeConfidence(input.row.diagnosis_confidence) ?? 0.95,
            primary_condition_class: normalizeText(input.row.primary_condition_class),
            outcome_at_followup: normalizeText(input.row.outcome_at_followup),
            label_type: 'real_case_import',
        },
        [C.outcome_timestamp]: input.observedAt,
        [C.label_type]: normalizeDiagnosisMethod(input.row.diagnosis_method) === 'lab_confirmed' || normalizeDiagnosisMethod(input.row.diagnosis_method) === 'pathology'
            ? 'lab_confirmed'
            : 'expert_reviewed',
        [C.is_synthetic]: false,
    };

    const { data, error } = await client
        .from(CLINICAL_OUTCOME_EVENTS.TABLE)
        .insert(payload)
        .select(C.id)
        .single();

    if (error) {
        throw new Error(`Failed to insert real-case outcome label: ${error.message}`);
    }

    return data?.id ? String(data.id) : null;
}

function scanForDirectIdentifiers(row: RealCaseImportRow): Array<{ code: string; message: string }> {
    const freeText = [
        row.presenting_complaint,
        row.history,
        row.outcome_at_followup,
        ...Object.values(asRecord(row.physical_exam)),
        ...Object.values(asRecord(row.diagnostics)),
        ...Object.values(asRecord(row.labs)),
        ...Object.values(asRecord(row.metadata)),
    ]
        .flatMap(flattenText)
        .join('\n');

    return DIRECT_IDENTIFIER_PATTERNS
        .filter((entry) => entry.pattern.test(freeText))
        .map((entry) => ({ code: entry.code, message: entry.message }));
}

function buildReport(input: {
    dryRun: boolean;
    imported: RealCaseImportAcceptedRow[];
    rejected: RealCaseImportRejectedRow[];
    total: number;
}): RealCaseImportReport {
    return {
        dry_run: input.dryRun,
        imported: input.imported,
        rejected: input.rejected,
        summary: {
            total: input.total,
            accepted: input.imported.length,
            rejected: input.rejected.length,
            learning_ready: input.imported.filter((entry) => entry.learning_ready).length,
            consent_required_rejections: input.rejected.filter((entry) => entry.error_codes.includes('learning_consent_missing')).length,
            phi_rejections: input.rejected.filter((entry) => entry.error_codes.some((code) => code.includes('possible_') || code.endsWith('_present'))).length,
        },
    };
}

function flattenText(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
    if (Array.isArray(value)) return value.flatMap(flattenText);
    if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(flattenText);
    return [];
}

function isAllowedUsageClass(value: unknown): value is RealCaseUsageClass {
    return value === 'credentialed_deidentified'
        || value === 'internal_deidentified'
        || value === 'consented_research';
}

function normalizeDiagnosisMethod(value: unknown): DiagnosisMethod {
    return value === 'lab_confirmed'
        || value === 'imaging_confirmed'
        || value === 'pathology'
        || value === 'response_to_treatment'
        ? value
        : 'clinical';
}

function normalizeConfidence(value: unknown): number | null {
    const number = normalizeNumber(value);
    if (number == null) return null;
    return Math.min(1, Math.max(0, number));
}

function normalizeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.replace(/\s+/g, ' ').trim()
        : null;
}

function normalizeTimestamp(value: unknown): string | null {
    const text = normalizeText(value);
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function uniqueStrings(values: unknown[]): string[] {
    return [...new Set(values.map((value) => normalizeText(value)).filter((value): value is string => value != null))];
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function stripEmpty(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => {
            if (entry === undefined || entry === null) return false;
            if (Array.isArray(entry)) return entry.length > 0;
            if (typeof entry === 'object') return Object.keys(entry as Record<string, unknown>).length > 0;
            return true;
        }),
    );
}
