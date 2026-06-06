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
    voice_context?: Record<string, unknown> | null;
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
    top_differentials: CaseDifferentialSummary[];
    recommended_tests: string[];
    reliability_score: number | null;
    reliability_label: string;
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

export interface CaseDifferentialSummary {
    label: string;
    probability: number;
    urgency: 'high' | 'medium' | 'low';
}

export function buildCaseInputSignature(input: CaseIntakeInput): InputSignature {
    const symptoms = uniqueStrings([
        input.presenting_complaint,
        ...input.symptoms,
    ]);
    const voiceContext = normalizeVoiceContext(input.voice_context);
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
        voice_context: voiceContext,
        raw_voice_transcript: readText(voiceContext?.raw_transcript),
        voice_extraction_confidence: readNumber(voiceContext?.extraction_confidence),
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
        .limit(Math.min(Math.max(filters.limit ?? 25, 1), 100));
    if (error) {
        throw new Error(`Failed to list clinical cases: ${error.message}`);
    }

    const summaries = (data ?? []).map((row) => mapCaseSummary(row as Record<string, unknown>));
    return hydrateCaseSummaries(client, tenantId, summaries);
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

export async function getClinicalCaseDetailByRouteId(
    client: SupabaseClient,
    tenantId: string,
    routeId: string,
): Promise<CaseDetail | null> {
    const inference = await loadInferenceById(client, tenantId, routeId);
    if (!inference) return getClinicalCaseDetail(client, tenantId, routeId);

    const inferenceId = readText(inference.id) ?? routeId;
    const caseId = readText(inference.case_id);
    const outcomeRows = await loadOutcomesForInference(client, tenantId, inferenceId, caseId);

    if (caseId) {
        const existing = await getClinicalCaseDetail(client, tenantId, caseId);
        if (existing) {
            const confirmed = readConfirmedDiagnosisFromInference(inference)
                ?? readConfirmedDiagnosisFromOutcomes(outcomeRows)
                ?? existing.confirmed_diagnosis;
            return {
                ...existing,
                case_status: confirmed ? 'closed' : existing.case_status,
                confirmed_diagnosis: confirmed,
                latest_inference_event_id: inferenceId,
                latest_inference: inference,
                outcomes: outcomeRows.length > 0 ? outcomeRows : existing.outcomes,
            };
        }
    }

    return mapInferenceOnlyCaseDetail(inference, outcomeRows, tenantId, routeId);
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
        top_differentials: [],
        recommended_tests: [],
        reliability_score: null,
        reliability_label: 'Needs review',
    };
}

async function hydrateCaseSummaries(
    client: SupabaseClient,
    tenantId: string,
    summaries: CaseSummary[],
): Promise<CaseSummary[]> {
    if (summaries.length === 0) return [];

    let inferencesByCaseId = new Map<string, Record<string, unknown>>();
    try {
        inferencesByCaseId = await loadLatestInferencesForCaseSummaries(client, tenantId, summaries);
    } catch (error) {
        console.warn('[cases] list inference hydration degraded:', error);
    }

    return summaries.map((summary) => applyCaseSummaryInference(summary, inferencesByCaseId.get(summary.id) ?? null));
}

function applyCaseSummaryInference(
    summary: CaseSummary,
    inference: Record<string, unknown> | null,
): CaseSummary {
    if (!inference) {
        return {
            ...summary,
            top_differentials: summary.top_diagnosis
                ? [{
                    label: summary.top_diagnosis,
                    probability: summary.diagnosis_confidence ?? 0,
                    urgency: 'low',
                }]
                : [],
        };
    }

    const result = deriveCaseResultSummary(inference);
    return {
        ...summary,
        top_diagnosis: summary.top_diagnosis ?? result.topDiagnosis,
        diagnosis_confidence: summary.diagnosis_confidence ?? result.confidence,
        top_differentials: result.differentials,
        recommended_tests: result.recommendedTests,
        reliability_score: result.reliabilityScore,
        reliability_label: result.reliabilityLabel,
    };
}

async function loadLatestInferencesForCaseSummaries(
    client: SupabaseClient,
    tenantId: string,
    summaries: CaseSummary[],
): Promise<Map<string, Record<string, unknown>>> {
    const result = new Map<string, Record<string, unknown>>();
    const latestInferenceIds = Array.from(new Set(
        summaries
            .map((summary) => summary.latest_inference_event_id)
            .filter((value): value is string => Boolean(value)),
    ));

    if (latestInferenceIds.length > 0) {
        for (const row of await loadInferenceRowsByIds(client, tenantId, latestInferenceIds)) {
            const caseId = readText(row.case_id);
            if (caseId && !result.has(caseId)) {
                result.set(caseId, row);
            }
        }
    }

    const missingCaseIds = summaries
        .map((summary) => summary.id)
        .filter((caseId) => !result.has(caseId));
    if (missingCaseIds.length > 0) {
        for (const row of await loadInferenceRowsByCaseIds(client, tenantId, missingCaseIds)) {
            const caseId = readText(row.case_id);
            if (caseId && !result.has(caseId)) {
                result.set(caseId, row);
            }
        }
    }

    return result;
}

async function loadInferenceRowsByIds(
    client: SupabaseClient,
    tenantId: string,
    inferenceIds: string[],
): Promise<Record<string, unknown>[]> {
    const withUncertainty = await queryInferenceRowsByIds(client, tenantId, inferenceIds, CASE_LIST_INFERENCE_COLUMNS);
    if (!withUncertainty.error) {
        return (withUncertainty.data ?? []) as unknown as Record<string, unknown>[];
    }

    if (isMissingRelationError(withUncertainty.error.message ?? '')) return [];

    if (!isMissingColumnError(withUncertainty.error.message ?? '')) {
        throw new Error(`Failed to batch load inference events: ${withUncertainty.error.message}`);
    }

    const stableColumns = await queryInferenceRowsByIds(client, tenantId, inferenceIds, CASE_LIST_INFERENCE_STABLE_COLUMNS);
    if (stableColumns.error) {
        if (isMissingRelationError(stableColumns.error.message ?? '') || isMissingColumnError(stableColumns.error.message ?? '')) return [];
        throw new Error(`Failed to batch load inference events: ${stableColumns.error.message}`);
    }

    return (stableColumns.data ?? []) as unknown as Record<string, unknown>[];
}

async function loadInferenceRowsByCaseIds(
    client: SupabaseClient,
    tenantId: string,
    caseIds: string[],
): Promise<Record<string, unknown>[]> {
    const withUncertainty = await queryInferenceRowsByCaseIds(client, tenantId, caseIds, CASE_LIST_INFERENCE_COLUMNS);
    if (!withUncertainty.error) {
        return (withUncertainty.data ?? []) as unknown as Record<string, unknown>[];
    }

    if (isMissingRelationError(withUncertainty.error.message ?? '')) return [];

    if (!isMissingColumnError(withUncertainty.error.message ?? '')) {
        throw new Error(`Failed to batch load latest inference events: ${withUncertainty.error.message}`);
    }

    const stableColumns = await queryInferenceRowsByCaseIds(client, tenantId, caseIds, CASE_LIST_INFERENCE_STABLE_COLUMNS);
    if (stableColumns.error) {
        if (isMissingRelationError(stableColumns.error.message ?? '') || isMissingColumnError(stableColumns.error.message ?? '')) return [];
        throw new Error(`Failed to batch load latest inference events: ${stableColumns.error.message}`);
    }

    return (stableColumns.data ?? []) as unknown as Record<string, unknown>[];
}

const CASE_LIST_INFERENCE_COLUMNS = [
    'id',
    'case_id',
    'model_name',
    'model_version',
    'prompt_template_hash',
    'prompt_template_version',
    'schema_version',
    'confidence_score',
    'phi_hat',
    'output_payload',
    'cire',
    'uncertainty_metrics',
    'inference_latency_ms',
    'latency_ms',
    'compute_profile',
    'outcome_confirmed',
    'confirmed_diagnosis',
    'created_at',
];

const CASE_LIST_INFERENCE_STABLE_COLUMNS = [
    'id',
    'case_id',
    'model_name',
    'model_version',
    'confidence_score',
    'output_payload',
    'created_at',
];

function queryInferenceRowsByIds(
    client: SupabaseClient,
    tenantId: string,
    inferenceIds: string[],
    columns: string[],
) {
    return client
        .from('ai_inference_events')
        .select(columns.join(', '))
        .eq('tenant_id', tenantId)
        .in('id', inferenceIds)
        .order('created_at', { ascending: false });
}

function queryInferenceRowsByCaseIds(
    client: SupabaseClient,
    tenantId: string,
    caseIds: string[],
    columns: string[],
) {
    return client
        .from('ai_inference_events')
        .select(columns.join(', '))
        .eq('tenant_id', tenantId)
        .in('case_id', caseIds)
        .order('created_at', { ascending: false })
        .limit(Math.min(caseIds.length * 3, 150));
}

async function loadInferenceById(
    client: SupabaseClient,
    tenantId: string,
    inferenceId: string,
): Promise<Record<string, unknown> | null> {
    const withCase = await queryInferenceById(client, tenantId, inferenceId, [
        'id',
        'tenant_id',
        'user_id',
        'clinic_id',
        'case_id',
        'model_name',
        'model_version',
        'prompt_template_hash',
        'prompt_template_version',
        'schema_version',
        'confidence_score',
        'phi_hat',
        'input_signature',
        'output_payload',
        'differentials',
        'cire',
        'uncertainty_metrics',
        'inference_latency_ms',
        'latency_ms',
        'compute_profile',
        'outcome_confirmed',
        'confirmed_diagnosis',
        'created_at',
    ]);

    if (!withCase.error) {
        return withCase.data ? withCase.data as unknown as Record<string, unknown> : null;
    }

    if (isMissingRelationError(withCase.error.message ?? '')) return null;

    if (!isMissingColumnError(withCase.error.message ?? '')) {
        throw new Error(`Failed to load inference event: ${withCase.error.message}`);
    }

    const stable = await queryInferenceById(client, tenantId, inferenceId, [
        'id',
        'tenant_id',
        'user_id',
        'clinic_id',
        'case_id',
        'model_name',
        'model_version',
        'confidence_score',
        'input_signature',
        'output_payload',
        'created_at',
    ]);

    if (stable.error) {
        if (isMissingColumnError(stable.error.message ?? '') || isMissingRelationError(stable.error.message ?? '')) return null;
        throw new Error(`Failed to load inference event: ${stable.error.message}`);
    }

    return stable.data ? stable.data as unknown as Record<string, unknown> : null;
}

function queryInferenceById(
    client: SupabaseClient,
    tenantId: string,
    inferenceId: string,
    columns: string[],
) {
    return client
        .from('ai_inference_events')
        .select(columns.join(', '))
        .eq('tenant_id', tenantId)
        .eq('id', inferenceId)
        .maybeSingle();
}

async function loadOutcomesForInference(
    client: SupabaseClient,
    tenantId: string,
    inferenceEventId: string,
    caseId: string | null,
): Promise<Record<string, unknown>[]> {
    const withLearningColumns = await queryOutcomesForInference(client, tenantId, inferenceEventId, caseId, [
        'id',
        'outcome_type',
        'outcome_payload',
        'actual_label',
        'actual_confidence',
        'calibration_delta',
        'inference_event_id',
        'case_id',
        'created_at',
    ]);

    if (!withLearningColumns.error) {
        return (withLearningColumns.data ?? []) as unknown as Record<string, unknown>[];
    }

    if (isMissingRelationError(withLearningColumns.error.message ?? '')) return [];

    if (!isMissingColumnError(withLearningColumns.error.message ?? '')) {
        throw new Error(`Failed to load outcomes: ${withLearningColumns.error.message}`);
    }

    const stableColumns = await queryOutcomesForInference(client, tenantId, inferenceEventId, caseId, [
        'id',
        'outcome_type',
        'outcome_payload',
        'inference_event_id',
        'case_id',
        'created_at',
    ]);

    if (stableColumns.error) {
        if (isMissingColumnError(stableColumns.error.message ?? '') || isMissingRelationError(stableColumns.error.message ?? '')) return [];
        throw new Error(`Failed to load outcomes: ${stableColumns.error.message}`);
    }

    return (stableColumns.data ?? []) as unknown as Record<string, unknown>[];
}

function queryOutcomesForInference(
    client: SupabaseClient,
    tenantId: string,
    inferenceEventId: string,
    caseId: string | null,
    columns: string[],
) {
    let query = client
        .from('clinical_outcome_events')
        .select(columns.join(', '))
        .eq('tenant_id', tenantId);

    if (caseId) {
        query = query.or(`inference_event_id.eq.${inferenceEventId},case_id.eq.${caseId}`);
    } else {
        query = query.eq('inference_event_id', inferenceEventId);
    }

    return query.order('created_at', { ascending: false }).limit(20);
}

function mapInferenceOnlyCaseDetail(
    inference: Record<string, unknown>,
    outcomes: Record<string, unknown>[],
    tenantId: string,
    routeId: string,
): CaseDetail {
    const input = asRecord(inference.input_signature);
    const metadata = asRecord(input.metadata);
    const output = asRecord(inference.output_payload);
    const confirmed = readConfirmedDiagnosisFromInference(inference) ?? readConfirmedDiagnosisFromOutcomes(outcomes);
    const createdAt = readText(inference.created_at) ?? new Date().toISOString();
    const inferenceId = readText(inference.id) ?? routeId;
    const species = readText(input.species) ?? readText(metadata.species);
    const symptoms = readStringArray(input.symptoms, metadata.symptoms);
    const topSummary = deriveCaseResultSummary(inference);

    return {
        id: readText(inference.case_id) ?? inferenceId,
        tenant_id: tenantId,
        user_id: readText(inference.user_id),
        clinic_id: readText(inference.clinic_id),
        created_at: createdAt,
        updated_at: createdAt,
        case_status: confirmed ? 'closed' : 'open',
        patient_name: readText(input.patient_name) ?? readText(metadata.patient_name),
        species_display: species,
        species_canonical: species,
        breed: readText(input.breed) ?? readText(metadata.breed),
        presenting_complaint: readText(input.presenting_complaint) ?? readText(metadata.presenting_complaint) ?? symptoms[0] ?? null,
        symptom_summary: symptoms.join(', ') || null,
        symptoms_normalized: symptoms,
        top_diagnosis: topSummary.topDiagnosis,
        confirmed_diagnosis: confirmed,
        diagnosis_confidence: topSummary.confidence,
        latest_inference_event_id: inferenceId,
        latest_outcome_event_id: readText(outcomes[0]?.id),
        closed_at: confirmed ? readText(outcomes[0]?.created_at) ?? readText(inference.created_at) : null,
        patient_metadata: metadata,
        latest_input_signature: input,
        top_differentials: topSummary.differentials,
        recommended_tests: topSummary.recommendedTests,
        reliability_score: topSummary.reliabilityScore,
        reliability_label: topSummary.reliabilityLabel,
        history: readText(input.history) ?? readText(metadata.history),
        duration_text: readText(input.duration_text) ?? readText(metadata.duration_text),
        sex: readText(input.sex) ?? readText(metadata.sex),
        age_years: readNumber(input.age_years) ?? readNumber(metadata.age_years),
        weight_kg: readNumber(input.weight_kg) ?? readNumber(metadata.weight_kg),
        owner_name: readText(metadata.owner_name),
        owner_contact: asRecord(metadata.owner_contact),
        microchip_id: readText(metadata.microchip_id),
        vitals: asRecord(input.vitals) ?? asRecord(metadata.vitals),
        physical_exam: asRecord(input.physical_exam) ?? asRecord(metadata.physical_exam),
        labs: asRecord(input.lab_results) ?? asRecord(metadata.labs),
        images: Array.isArray(input.diagnostic_images) ? input.diagnostic_images : [],
        treatments: [],
        latest_inference: inference,
        outcomes,
        diagnosis_records: [],
    };
}

function readConfirmedDiagnosisFromInference(inference: Record<string, unknown>): string | null {
    if (inference.outcome_confirmed !== true) return null;
    return readText(inference.confirmed_diagnosis);
}

function readConfirmedDiagnosisFromOutcomes(outcomes: Record<string, unknown>[]): string | null {
    for (const outcome of outcomes) {
        const payload = asRecord(outcome.outcome_payload);
        const label = readText(outcome.actual_label)
            ?? readText(payload.confirmed_diagnosis)
            ?? readText(payload.actual_diagnosis)
            ?? readText(payload.label)
            ?? readText(payload.diagnosis);
        if (label) return label;
    }
    return null;
}

function deriveCaseResultSummary(inference: Record<string, unknown>): {
    topDiagnosis: string | null;
    confidence: number | null;
    differentials: CaseDifferentialSummary[];
    recommendedTests: string[];
    reliabilityScore: number | null;
    reliabilityLabel: string;
} {
    const output = asRecord(inference.output_payload);
    const diagnosis = asRecord(output.diagnosis);
    const rows = Array.isArray(diagnosis.top_differentials)
        ? diagnosis.top_differentials
        : Array.isArray(output.differentials) ? output.differentials : [];
    const differentials = rows
        .map((entry) => mapCaseDifferential(asRecord(entry)))
        .filter((entry): entry is CaseDifferentialSummary => Boolean(entry))
        .slice(0, 8);
    const confidence = readNumber(output.confidence_score)
        ?? readNumber(inference.confidence_score)
        ?? differentials[0]?.probability
        ?? null;
    const reliabilityScore = readReliabilityScore(output);
    return {
        topDiagnosis: differentials[0]?.label ?? null,
        confidence,
        differentials,
        recommendedTests: collectRecommendedTests(rows, output),
        reliabilityScore,
        reliabilityLabel: reliabilityLabel(reliabilityScore ?? confidence),
    };
}

function mapCaseDifferential(entry: Record<string, unknown>): CaseDifferentialSummary | null {
    const label = readText(entry.condition) ?? readText(entry.name) ?? readText(entry.label);
    if (!label) return null;
    return {
        label,
        probability: readNumber(entry.probability) ?? readNumber(entry.p) ?? readNumber(entry.confidence) ?? 0,
        urgency: mapCaseUrgency(readText(entry.clinical_urgency)),
    };
}

function collectRecommendedTests(rows: unknown[], output: Record<string, unknown>): string[] {
    const tests = new Set<string>();
    for (const row of rows) {
        const record = asRecord(row);
        for (const value of readStringArray(record.recommended_confirmatory_tests)) tests.add(value);
        for (const value of readEvidenceArray(record.missing_evidence)) tests.add(value.replace(/^Test:\s*/i, ''));
        const groundTruth = asRecord(record.ground_truth_explanation);
        for (const value of readStringArray(groundTruth.missing_criteria)) tests.add(value);
    }
    const summary = asRecord(output.ground_truth_summary);
    for (const value of readStringArray(summary.missing_confirmatory_tests)) tests.add(value);
    for (const value of readStringArray(output.recommended_tests)) tests.add(value);
    return Array.from(tests).slice(0, 6);
}

function readReliabilityScore(output: Record<string, unknown>): number | null {
    const reliability = asRecord(output.reliability_breakdown);
    const cire = asRecord(output.cire);
    return readNumber(reliability.composite_reliability_score)
        ?? readNumber(cire.phi_hat);
}

function reliabilityLabel(value: number | null): string {
    if (value == null) return 'Needs review';
    if (value >= 0.75) return 'High reliability';
    if (value >= 0.5) return 'Moderate reliability';
    return 'Low reliability';
}

function mapCaseUrgency(value: string | null): CaseDifferentialSummary['urgency'] {
    if (value === 'immediate' || value === 'urgent' || value === 'high') return 'high';
    if (value === 'review' || value === 'medium') return 'medium';
    return 'low';
}

async function loadLatestInference(
    client: SupabaseClient,
    tenantId: string,
    caseId: string,
    latestInferenceId: string | null,
): Promise<Record<string, unknown> | null> {
    const withUncertainty = await queryLatestInference(client, tenantId, caseId, latestInferenceId, [
        'id',
        'model_name',
        'model_version',
        'prompt_template_hash',
        'prompt_template_version',
        'schema_version',
        'confidence_score',
        'phi_hat',
        'output_payload',
        'cire',
        'uncertainty_metrics',
        'inference_latency_ms',
        'latency_ms',
        'compute_profile',
        'outcome_confirmed',
        'confirmed_diagnosis',
        'created_at',
    ]);

    if (!withUncertainty.error) {
        return withUncertainty.data ? withUncertainty.data as unknown as Record<string, unknown> : null;
    }

    if (isMissingRelationError(withUncertainty.error.message ?? '')) {
        return null;
    }

    if (!isMissingColumnError(withUncertainty.error.message ?? '')) {
        throw new Error(`Failed to load latest inference: ${withUncertainty.error.message}`);
    }

    const stableColumns = await queryLatestInference(client, tenantId, caseId, latestInferenceId, [
        'id',
        'model_name',
        'model_version',
        'confidence_score',
        'output_payload',
        'created_at',
    ]);

    if (stableColumns.error) {
        if (
            isMissingColumnError(stableColumns.error.message ?? '') ||
            isMissingRelationError(stableColumns.error.message ?? '')
        ) return null;
        throw new Error(`Failed to load latest inference: ${stableColumns.error.message}`);
    }

    return stableColumns.data ? stableColumns.data as unknown as Record<string, unknown> : null;
}

function queryLatestInference(
    client: SupabaseClient,
    tenantId: string,
    caseId: string,
    latestInferenceId: string | null,
    columns: string[],
) {
    const select = columns.join(', ');
    return latestInferenceId
        ? client
            .from('ai_inference_events')
            .select(select)
            .eq('tenant_id', tenantId)
            .eq('id', latestInferenceId)
            .maybeSingle()
        : client
            .from('ai_inference_events')
            .select(select)
            .eq('tenant_id', tenantId)
            .eq('case_id', caseId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
}

async function loadOutcomes(
    client: SupabaseClient,
    tenantId: string,
    caseId: string,
): Promise<Record<string, unknown>[]> {
    const withLearningColumns = await queryOutcomes(client, tenantId, caseId, [
        'id',
        'outcome_type',
        'outcome_payload',
        'actual_label',
        'actual_confidence',
        'calibration_delta',
        'created_at',
    ]);

    if (!withLearningColumns.error) {
        return (withLearningColumns.data ?? []) as unknown as Record<string, unknown>[];
    }

    if (isMissingRelationError(withLearningColumns.error.message ?? '')) {
        return [];
    }

    if (!isMissingColumnError(withLearningColumns.error.message ?? '')) {
        throw new Error(`Failed to load outcomes: ${withLearningColumns.error.message}`);
    }

    const stableColumns = await queryOutcomes(client, tenantId, caseId, [
        'id',
        'outcome_type',
        'outcome_payload',
        'created_at',
    ]);

    if (stableColumns.error) {
        if (
            isMissingRelationError(stableColumns.error.message ?? '') ||
            isMissingColumnError(stableColumns.error.message ?? '')
        ) return [];
        throw new Error(`Failed to load outcomes: ${stableColumns.error.message}`);
    }

    return (stableColumns.data ?? []) as unknown as Record<string, unknown>[];
}

function queryOutcomes(
    client: SupabaseClient,
    tenantId: string,
    caseId: string,
    columns: string[],
) {
    return client
        .from('clinical_outcome_events')
        .select(columns.join(', '))
        .eq('tenant_id', tenantId)
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(20);
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
        if (isMissingRelationError(error.message ?? '') || isMissingColumnError(error.message ?? '')) {
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

function normalizeVoiceContext(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    const record = asRecord(value);
    if (!record) return null;
    const notes = readStringArray(record.extraction_notes);
    const normalized = stripUndefined({
        raw_transcript: normalizeText(record.raw_transcript),
        extraction_confidence: normalizeNumber(record.extraction_confidence),
        extraction_notes: notes.length > 0 ? notes : undefined,
        source: normalizeText(record.source),
        captured_at: normalizeText(record.captured_at),
        fallback_used: typeof record.fallback_used === 'boolean' ? record.fallback_used : undefined,
    });
    return Object.keys(normalized).length > 0 ? normalized : null;
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

function readEvidenceArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const entries = value
        .map((entry) => {
            if (typeof entry === 'string') return normalizeText(entry);
            const record = asRecord(entry);
            return normalizeText(record.finding)
                ?? normalizeText(record.label)
                ?? normalizeText(record.test)
                ?? normalizeText(record.reason);
        })
        .filter((entry): entry is string => Boolean(entry));
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
