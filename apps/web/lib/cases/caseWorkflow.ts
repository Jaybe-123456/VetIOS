import type { SupabaseClient } from '@supabase/supabase-js';
import type { InputSignature } from '@/lib/vetios-inference';

export type CaseStatus = 'open' | 'closed' | 'referred';
export type DiagnosisMethod = 'clinical' | 'lab_confirmed' | 'imaging_confirmed' | 'pathology' | 'response_to_treatment';

export interface CasePatientInput {
    species: string;
    breed?: string | null;
    name?: string | null;
    age_years?: number | null;
    weight_kg?: number | null;
    sex?: string | null;
    owner_name?: string | null;
    owner_contact?: Record<string, unknown> | null;
    microchip_id?: string | null;
}

export interface CaseIntakeInput {
    patient: CasePatientInput;
    presenting_complaint: string;
    history?: string | null;
    duration_text?: string | null;
    symptoms: string[];
    vitals?: Record<string, unknown>;
    physical_exam?: Record<string, unknown>;
    labs?: Record<string, unknown>;
    images?: unknown[];
}

export interface CaseSummary {
    id: string;
    tenant_id: string;
    user_id: string | null;
    clinic_id: string | null;
    created_at: string;
    updated_at: string;
    case_status: CaseStatus;
    patient_name: string | null;
    species_display: string | null;
    species_canonical: string | null;
    breed: string | null;
    presenting_complaint: string | null;
    symptom_summary: string | null;
    symptoms_normalized: string[];
    top_diagnosis: string | null;
    confirmed_diagnosis: string | null;
    diagnosis_confidence: number | null;
    latest_inference_event_id: string | null;
    latest_outcome_event_id: string | null;
    closed_at: string | null;
    patient_metadata: Record<string, unknown>;
    latest_input_signature: Record<string, unknown>;
}

export interface CaseDetail extends CaseSummary {
    history: string | null;
    duration_text: string | null;
    sex: string | null;
    age_years: number | null;
    weight_kg: number | null;
    owner_name: string | null;
    owner_contact: Record<string, unknown>;
    microchip_id: string | null;
    vitals: Record<string, unknown>;
    physical_exam: Record<string, unknown>;
    labs: Record<string, unknown>;
    images: unknown[];
    treatments: unknown[];
    latest_inference: Record<string, unknown> | null;
    outcomes: Record<string, unknown>[];
    diagnosis_records: Record<string, unknown>[];
}

export function buildCaseInputSignature(input: CaseIntakeInput): InputSignature {
    const symptoms = uniqueStrings([
        input.presenting_complaint,
        ...input.symptoms,
    ]);
    const metadata = stripUndefined({
        source: 'case_entry',
        patient_name: normalizeText(input.patient.name),
        owner_name: normalizeText(input.patient.owner_name),
        owner_contact: asRecord(input.patient.owner_contact),
        microchip_id: normalizeText(input.patient.microchip_id),
        age_years: normalizeNumber(input.patient.age_years),
        weight_kg: normalizeNumber(input.patient.weight_kg),
        sex: normalizeText(input.patient.sex),
        presenting_complaint: input.presenting_complaint.trim(),
        history: normalizeText(input.history),
        duration_text: normalizeText(input.duration_text),
        vitals: asRecord(input.vitals),
        physical_exam: asRecord(input.physical_exam),
        labs: asRecord(input.labs),
        images: Array.isArray(input.images) ? input.images : [],
        encounter_payload_v2: {
            presenting_complaint: input.presenting_complaint.trim(),
            symptoms,
            vitals: asRecord(input.vitals),
            physical_exam: asRecord(input.physical_exam),
            labs: asRecord(input.labs),
        },
    });

    return stripUndefined({
        species: input.patient.species.trim(),
        breed: normalizeText(input.patient.breed) ?? undefined,
        symptoms,
        metadata,
        patient_name: normalizeText(input.patient.name) ?? undefined,
        presenting_complaint: input.presenting_complaint.trim(),
        history: normalizeText(input.history) ?? undefined,
        vitals: asRecord(input.vitals),
        physical_exam: asRecord(input.physical_exam),
        lab_results: asRecord(input.labs),
        diagnostic_images: Array.isArray(input.images) ? input.images : [],
    }) as InputSignature;
}

export async function listClinicalCases(
    client: SupabaseClient,
    tenantId: string,
    filters: {
        status?: string | null;
        species?: string | null;
        limit?: number;
    } = {},
): Promise<CaseSummary[]> {
    let query = client
        .from('clinical_cases')
        .select('*')
        .eq('tenant_id', tenantId);

    if (filters.status && filters.status !== 'all') {
        query = query.eq('case_status', filters.status);
    }
    if (filters.species && filters.species !== 'all') {
        query = query.ilike('species_display', `%${filters.species}%`);
    }

    const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(Math.min(Math.max(filters.limit ?? 100, 1), 250));
    if (error) {
        throw new Error(`Failed to list clinical cases: ${error.message}`);
    }

    return (data ?? []).map((row) => mapCaseSummary(row as Record<string, unknown>));
}

export async function getClinicalCaseDetail(
    client: SupabaseClient,
    tenantId: string,
    caseId: string,
): Promise<CaseDetail | null> {
    const { data, error } = await client
        .from('clinical_cases')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', caseId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load clinical case: ${error.message}`);
    }
    if (!data) return null;

    const summary = mapCaseSummary(data as Record<string, unknown>);
    const row = data as Record<string, unknown>;
    const latestInference = await loadLatestInference(client, tenantId, summary.id, summary.latest_inference_event_id);
    const outcomes = await loadOutcomes(client, tenantId, summary.id);
    const diagnosisRecords = await loadDiagnosisRecords(client, tenantId, summary.id);

    return {
        ...summary,
        history: readText(row.history) ?? readText(summary.patient_metadata.history),
        duration_text: readText(row.duration_text) ?? readText(summary.patient_metadata.duration_text),
        sex: readText(row.sex) ?? readText(summary.patient_metadata.sex),
        age_years: readNumber(row.age_years) ?? readNumber(summary.patient_metadata.age_years),
        weight_kg: readNumber(row.weight_kg) ?? readNumber(summary.patient_metadata.weight_kg),
        owner_name: readText(row.owner_name) ?? readText(summary.patient_metadata.owner_name),
        owner_contact: asRecord(row.owner_contact) ?? asRecord(summary.patient_metadata.owner_contact),
        microchip_id: readText(row.microchip_id) ?? readText(summary.patient_metadata.microchip_id),
        vitals: asRecord(row.vitals) ?? asRecord(summary.patient_metadata.vitals),
        physical_exam: asRecord(row.physical_exam) ?? asRecord(summary.patient_metadata.physical_exam),
        labs: asRecord(row.labs) ?? asRecord(summary.patient_metadata.labs),
        images: Array.isArray(row.images) ? row.images : [],
        treatments: Array.isArray(row.treatments) ? row.treatments : [],
        latest_inference: latestInference,
        outcomes,
        diagnosis_records: diagnosisRecords,
    };
}

export async function updateCaseIntakeSnapshot(
    client: SupabaseClient,
    input: {
        tenantId: string;
        caseId: string;
        intake: CaseIntakeInput;
    },
): Promise<void> {
    let patch: Record<string, unknown> = {
        case_status: 'open',
        presenting_complaint: input.intake.presenting_complaint.trim(),
        history: normalizeText(input.intake.history),
        duration_text: normalizeText(input.intake.duration_text),
        patient_name: normalizeText(input.intake.patient.name),
        owner_name: normalizeText(input.intake.patient.owner_name),
        owner_contact: asRecord(input.intake.patient.owner_contact),
        microchip_id: normalizeText(input.intake.patient.microchip_id),
        sex: normalizeText(input.intake.patient.sex),
        age_years: normalizeNumber(input.intake.patient.age_years),
        weight_kg: normalizeNumber(input.intake.patient.weight_kg),
        vitals: asRecord(input.intake.vitals),
        physical_exam: asRecord(input.intake.physical_exam),
        labs: asRecord(input.intake.labs),
        images: Array.isArray(input.intake.images) ? input.intake.images : [],
    };
    patch = stripUndefined(patch);

    for (;;) {
        const { error } = await client
            .from('clinical_cases')
            .update(patch)
            .eq('tenant_id', input.tenantId)
            .eq('id', input.caseId);

        if (!error) return;

        const missingColumn = resolveMissingColumn(error.message ?? '', patch);
        if (!missingColumn) {
            throw new Error(`Failed to persist case intake: ${error.message}`);
        }

        patch = { ...patch };
        delete patch[missingColumn];
    }
}

export function mapCaseSummary(row: Record<string, unknown>): CaseSummary {
    const metadata = asRecord(row.patient_metadata) ?? asRecord(row.metadata);
    const latestSignature = asRecord(row.latest_input_signature);
    const statusText = readText(row.case_status);
    const inferredClosed = Boolean(readText(row.confirmed_diagnosis) || readText(row.resolved_at));

    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        user_id: readText(row.user_id),
        clinic_id: readText(row.clinic_id),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        case_status: statusText === 'closed' || statusText === 'referred'
            ? statusText
            : inferredClosed ? 'closed' : 'open',
        patient_name: readText(row.patient_name) ?? readText(metadata.patient_name),
        species_display: readText(row.species_display) ?? readText(latestSignature.species_display) ?? readText(row.species),
        species_canonical: readText(row.species_canonical) ?? readText(row.species),
        breed: readText(row.breed),
        presenting_complaint: readText(row.presenting_complaint)
            ?? readText(metadata.presenting_complaint)
            ?? readText(row.symptom_summary),
        symptom_summary: readText(row.symptom_summary),
        symptoms_normalized: readStringArray(row.symptoms_normalized, row.symptom_vector),
        top_diagnosis: readText(row.top_diagnosis) ?? readText(row.predicted_diagnosis),
        confirmed_diagnosis: readText(row.confirmed_diagnosis),
        diagnosis_confidence: readNumber(row.diagnosis_confidence),
        latest_inference_event_id: readText(row.latest_inference_event_id),
        latest_outcome_event_id: readText(row.latest_outcome_event_id),
        closed_at: readText(row.closed_at) ?? readText(row.resolved_at),
        patient_metadata: metadata,
        latest_input_signature: latestSignature,
    };
}

async function loadLatestInference(
    client: SupabaseClient,
    tenantId: string,
    caseId: string,
    latestInferenceId: string | null,
): Promise<Record<string, unknown> | null> {
    const baseSelect = 'id, model_name, model_version, confidence_score, output_payload, uncertainty_metrics, created_at';
    const query = latestInferenceId
        ? client
            .from('ai_inference_events')
            .select(baseSelect)
            .eq('tenant_id', tenantId)
            .eq('id', latestInferenceId)
            .maybeSingle()
        : client
            .from('ai_inference_events')
            .select(baseSelect)
            .eq('tenant_id', tenantId)
            .eq('case_id', caseId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to load latest inference: ${error.message}`);
    }
    return data ? data as Record<string, unknown> : null;
}

async function loadOutcomes(
    client: SupabaseClient,
    tenantId: string,
    caseId: string,
): Promise<Record<string, unknown>[]> {
    const { data, error } = await client
        .from('clinical_outcome_events')
        .select('id, outcome_type, outcome_payload, actual_label, actual_confidence, calibration_delta, created_at')
        .eq('tenant_id', tenantId)
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        throw new Error(`Failed to load outcomes: ${error.message}`);
    }
    return (data ?? []) as Record<string, unknown>[];
}

async function loadDiagnosisRecords(
    client: SupabaseClient,
    tenantId: string,
    caseId: string,
): Promise<Record<string, unknown>[]> {
    const { data, error } = await client
        .from('diagnosis_records')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('clinical_case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        if (isMissingRelationError(error.message ?? '')) {
            return [];
        }
        throw new Error(`Failed to load diagnosis records: ${error.message}`);
    }
    return (data ?? []) as Record<string, unknown>[];
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
    ) as T;
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map((value) => normalizeText(value)).filter((value): value is string => Boolean(value))));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeText(value: unknown): string | null {
    return readText(value)?.replace(/\s+/g, ' ').trim() ?? null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeNumber(value: unknown): number | null {
    const number = readNumber(value);
    return number == null ? null : number;
}

function readStringArray(...values: unknown[]): string[] {
    const entries: string[] = [];
    for (const value of values) {
        if (!Array.isArray(value)) continue;
        for (const entry of value) {
            const normalized = normalizeText(entry);
            if (normalized) entries.push(normalized);
        }
    }
    return Array.from(new Set(entries));
}

function resolveMissingColumn(message: string, payload: Record<string, unknown>): string | null {
    if (!isMissingColumnError(message)) return null;
    for (const column of Object.keys(payload)) {
        if (
            message.includes(`'${column}'`) ||
            message.includes(`"${column}"`) ||
            message.includes(`.${column}`) ||
            message.includes(` ${column} `)
        ) {
            return column;
        }
    }
    return null;
}

function isMissingColumnError(message: string): boolean {
    return message.includes('schema cache')
        || message.includes('column')
        || message.includes('Could not find the');
}

function isMissingRelationError(message: string): boolean {
    return message.includes('relation')
        && (message.includes('does not exist') || message.includes('schema cache'));
}
