import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PatientTimelineEventType =
    | 'case_created'
    | 'inference_recorded'
    | 'confirmed_diagnosis'
    | 'lab_result'
    | 'imaging_result'
    | 'treatment_started'
    | 'follow_up'
    | 'petpass_update'
    | 'external_record';

export interface PatientTimelineEvent {
    id: string;
    tenant_id: string;
    patient_key: string;
    patient_id: string | null;
    case_id: string | null;
    inference_event_id: string | null;
    outcome_event_id: string | null;
    event_key: string;
    event_type: PatientTimelineEventType;
    event_title: string;
    event_summary: string;
    event_payload: Record<string, unknown>;
    source_module: string;
    occurred_at: string;
    created_at: string;
    persisted: boolean;
}

export interface PatientTimelineSummary {
    patient_key: string;
    patient_id: string | null;
    total_events: number;
    confirmed_diagnoses: number;
    longitudinal_visits: number;
    last_event_at: string | null;
    active_conditions: string[];
    timeline_summary: string;
    events: PatientTimelineEvent[];
}

export interface PatientTimelineCaseInput {
    tenantId: string;
    caseId: string;
    patientId?: string | null;
    patientName?: string | null;
    microchipId?: string | null;
    species?: string | null;
    breed?: string | null;
    createdAt?: string | null;
    presentingComplaint?: string | null;
    confirmedDiagnosis?: string | null;
    topDiagnosis?: string | null;
    diagnosisConfidence?: number | null;
    latestInferenceEventId?: string | null;
    latestOutcomeEventId?: string | null;
}

export interface PersistPatientTimelineEventInput extends PatientTimelineCaseInput {
    outcomeEventId: string;
    inferenceEventId: string;
    eventType?: PatientTimelineEventType;
    eventTitle?: string;
    eventSummary?: string;
    eventPayload?: Record<string, unknown>;
    occurredAt: string;
    sourceModule?: string;
}

export interface PatientTimelineWriteSummary {
    attempted: number;
    inserted: number;
    warning: string | null;
}

export async function loadPatientTimelineForCase(
    client: SupabaseClient,
    input: PatientTimelineCaseInput,
): Promise<PatientTimelineSummary> {
    const patientKey = buildPatientTimelineKey(input);
    const [persistedEvents, longitudinalEvents] = await Promise.all([
        loadPersistedTimelineEvents(client, input.tenantId, patientKey),
        input.patientId
            ? loadLongitudinalVisitEvents(client, input, patientKey)
            : Promise.resolve([]),
    ]);

    const events = mergeTimelineEvents([
        ...persistedEvents,
        ...longitudinalEvents,
        buildCurrentCaseEvent(input, patientKey),
    ]);

    const confirmedDiagnoses = events.filter((event) => event.event_type === 'confirmed_diagnosis').length;
    const activeConditions = Array.from(new Set(
        events
            .map((event) => normalizeText(event.event_payload.confirmed_diagnosis)
                ?? normalizeText(event.event_payload.primary_diagnosis))
            .filter((entry): entry is string => Boolean(entry)),
    )).slice(0, 6);

    return {
        patient_key: patientKey,
        patient_id: normalizeText(input.patientId),
        total_events: events.length,
        confirmed_diagnoses: confirmedDiagnoses,
        longitudinal_visits: longitudinalEvents.length,
        last_event_at: events[0]?.occurred_at ?? null,
        active_conditions: activeConditions,
        timeline_summary: buildTimelineSummary(events, confirmedDiagnoses, longitudinalEvents.length, activeConditions),
        events,
    };
}

export async function persistPatientTimelineEvent(
    client: SupabaseClient,
    input: PersistPatientTimelineEventInput,
): Promise<PatientTimelineWriteSummary> {
    const patientKey = buildPatientTimelineKey(input);
    const eventType = input.eventType ?? 'confirmed_diagnosis';
    const eventPayload = sanitizeClinicalPayload({
        confirmed_diagnosis: input.confirmedDiagnosis,
        top_diagnosis: input.topDiagnosis,
        diagnosis_confidence: input.diagnosisConfidence,
        ...(input.eventPayload ?? {}),
    });
    const eventKey = sha256(stableStringify({
        tenant_id: input.tenantId,
        patient_key: patientKey,
        case_id: input.caseId,
        inference_event_id: input.inferenceEventId,
        outcome_event_id: input.outcomeEventId,
        event_type: eventType,
    }));

    const row = {
        tenant_id: input.tenantId,
        patient_key: patientKey,
        patient_id: normalizeText(input.patientId),
        case_id: normalizeText(input.caseId),
        inference_event_id: normalizeText(input.inferenceEventId),
        outcome_event_id: normalizeText(input.outcomeEventId),
        event_key: eventKey,
        event_type: eventType,
        event_title: normalizeText(input.eventTitle) ?? defaultEventTitle(eventType),
        event_summary: normalizeText(input.eventSummary)
            ?? buildOutcomeSummary(input.confirmedDiagnosis, input.topDiagnosis, input.diagnosisConfidence),
        event_payload: eventPayload,
        source_module: normalizeText(input.sourceModule) ?? 'clinical_workspace',
        occurred_at: input.occurredAt,
    };

    const { data, error } = await client
        .from('clinic_patient_timeline_events')
        .upsert(row, {
            onConflict: 'event_key',
            ignoreDuplicates: true,
        })
        .select('id');

    if (error) {
        if (isMissingRelationOrColumn(error.message ?? '')) {
            return {
                attempted: 1,
                inserted: 0,
                warning: 'clinic_patient_timeline_events table is not available; apply switching-cost timeline migration',
            };
        }

        return {
            attempted: 1,
            inserted: 0,
            warning: `clinic_patient_timeline_events: ${error.message}`,
        };
    }

    return {
        attempted: 1,
        inserted: Array.isArray(data) ? data.length : 0,
        warning: null,
    };
}

export function buildPatientTimelineKey(input: Pick<PatientTimelineCaseInput, 'tenantId' | 'patientId' | 'patientName' | 'microchipId' | 'species' | 'breed' | 'caseId'>): string {
    const anchor = normalizeText(input.patientId)
        ? `patient:${normalizeText(input.patientId)}`
        : normalizeText(input.microchipId)
            ? `microchip:${normalizeText(input.microchipId)}`
            : normalizeText(input.patientName)
                ? `patient_name:${normalizeText(input.patientName)}|species:${normalizeText(input.species)}|breed:${normalizeText(input.breed)}`
                : `case:${input.caseId}`;

    return sha256(`${input.tenantId}|${anchor.toLowerCase()}`);
}

async function loadPersistedTimelineEvents(
    client: SupabaseClient,
    tenantId: string,
    patientKey: string,
): Promise<PatientTimelineEvent[]> {
    const { data, error } = await client
        .from('clinic_patient_timeline_events')
        .select([
            'id',
            'tenant_id',
            'patient_key',
            'patient_id',
            'case_id',
            'inference_event_id',
            'outcome_event_id',
            'event_key',
            'event_type',
            'event_title',
            'event_summary',
            'event_payload',
            'source_module',
            'occurred_at',
            'created_at',
        ].join(', '))
        .eq('tenant_id', tenantId)
        .eq('patient_key', patientKey)
        .order('occurred_at', { ascending: false })
        .limit(50);

    if (error) {
        if (isMissingRelationOrColumn(error.message ?? '')) return [];
        throw new Error(`Failed to load patient timeline: ${error.message}`);
    }

    return (data ?? []).map((row) => normalizeTimelineRow(row as unknown as Record<string, unknown>, true));
}

async function loadLongitudinalVisitEvents(
    client: SupabaseClient,
    input: PatientTimelineCaseInput,
    patientKey: string,
): Promise<PatientTimelineEvent[]> {
    const patientId = normalizeText(input.patientId);
    if (!patientId) return [];

    const { data, error } = await client
        .from('patient_longitudinal_records')
        .select('id, patient_id, tenant_id, visit_date, symptoms, biomarkers, inference_event_id, primary_diagnosis, diagnosis_confidence, treatment_prescribed, outcome_confirmed, confirmed_diagnosis, created_at')
        .eq('tenant_id', input.tenantId)
        .eq('patient_id', patientId)
        .order('visit_date', { ascending: false })
        .limit(25);

    if (error) {
        if (isMissingRelationOrColumn(error.message ?? '')) return [];
        throw new Error(`Failed to load longitudinal visits: ${error.message}`);
    }

    return (data ?? []).map((row) => mapLongitudinalVisit(row as unknown as Record<string, unknown>, patientKey));
}

function buildCurrentCaseEvent(input: PatientTimelineCaseInput, patientKey: string): PatientTimelineEvent {
    const occurredAt = normalizeText(input.createdAt) ?? new Date().toISOString();
    const diagnosis = normalizeText(input.confirmedDiagnosis) ?? normalizeText(input.topDiagnosis);
    const eventType: PatientTimelineEventType = input.confirmedDiagnosis ? 'confirmed_diagnosis' : input.latestInferenceEventId ? 'inference_recorded' : 'case_created';
    return {
        id: `current:${input.caseId}`,
        tenant_id: input.tenantId,
        patient_key: patientKey,
        patient_id: normalizeText(input.patientId),
        case_id: input.caseId,
        inference_event_id: normalizeText(input.latestInferenceEventId),
        outcome_event_id: normalizeText(input.latestOutcomeEventId),
        event_key: `current:${input.caseId}`,
        event_type: eventType,
        event_title: defaultEventTitle(eventType),
        event_summary: diagnosis
            ? buildOutcomeSummary(input.confirmedDiagnosis, input.topDiagnosis, input.diagnosisConfidence)
            : normalizeText(input.presentingComplaint) ?? 'Clinical case opened in VetIOS.',
        event_payload: sanitizeClinicalPayload({
            confirmed_diagnosis: input.confirmedDiagnosis,
            primary_diagnosis: input.topDiagnosis,
            diagnosis_confidence: input.diagnosisConfidence,
            presenting_complaint: input.presentingComplaint,
        }),
        source_module: 'current_case_snapshot',
        occurred_at: occurredAt,
        created_at: occurredAt,
        persisted: false,
    };
}

function mapLongitudinalVisit(row: Record<string, unknown>, patientKey: string): PatientTimelineEvent {
    const confirmed = row.outcome_confirmed === true;
    const diagnosis = normalizeText(row.confirmed_diagnosis) ?? normalizeText(row.primary_diagnosis);
    const occurredAt = normalizeText(row.visit_date) ?? normalizeText(row.created_at) ?? new Date().toISOString();
    const eventType: PatientTimelineEventType = confirmed ? 'confirmed_diagnosis' : 'external_record';
    const rowId = String(row.id);
    return {
        id: `longitudinal:${rowId}`,
        tenant_id: String(row.tenant_id),
        patient_key: patientKey,
        patient_id: normalizeText(row.patient_id),
        case_id: null,
        inference_event_id: normalizeText(row.inference_event_id),
        outcome_event_id: null,
        event_key: `longitudinal:${rowId}`,
        event_type: eventType,
        event_title: confirmed ? 'Confirmed visit outcome' : 'Longitudinal visit',
        event_summary: diagnosis
            ? `Visit recorded with ${confirmed ? 'confirmed' : 'primary'} diagnosis: ${diagnosis}.`
            : 'Visit recorded in the longitudinal patient history.',
        event_payload: sanitizeClinicalPayload({
            confirmed_diagnosis: row.confirmed_diagnosis,
            primary_diagnosis: row.primary_diagnosis,
            diagnosis_confidence: row.diagnosis_confidence,
            symptom_count: Array.isArray(row.symptoms) ? row.symptoms.length : 0,
            biomarker_keys: Object.keys(asRecord(row.biomarkers)).slice(0, 12),
            treatment_count: Array.isArray(row.treatment_prescribed) ? row.treatment_prescribed.length : 0,
        }),
        source_module: 'patient_longitudinal_records',
        occurred_at: occurredAt,
        created_at: normalizeText(row.created_at) ?? occurredAt,
        persisted: false,
    };
}

function normalizeTimelineRow(row: Record<string, unknown>, persisted: boolean): PatientTimelineEvent {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        patient_key: String(row.patient_key),
        patient_id: normalizeText(row.patient_id),
        case_id: normalizeText(row.case_id),
        inference_event_id: normalizeText(row.inference_event_id),
        outcome_event_id: normalizeText(row.outcome_event_id),
        event_key: String(row.event_key),
        event_type: normalizeEventType(row.event_type),
        event_title: normalizeText(row.event_title) ?? 'Timeline event',
        event_summary: normalizeText(row.event_summary) ?? 'Clinical event recorded.',
        event_payload: asRecord(row.event_payload),
        source_module: normalizeText(row.source_module) ?? 'clinical_workspace',
        occurred_at: String(row.occurred_at),
        created_at: String(row.created_at),
        persisted,
    };
}

function mergeTimelineEvents(events: PatientTimelineEvent[]): PatientTimelineEvent[] {
    const seen = new Set<string>();
    return events
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
        .filter((event) => {
            const key = event.event_key;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 50);
}

function buildTimelineSummary(
    events: PatientTimelineEvent[],
    confirmedDiagnoses: number,
    longitudinalVisits: number,
    activeConditions: string[],
): string {
    const pieces = [`${events.length} timeline event${events.length === 1 ? '' : 's'}`];
    if (confirmedDiagnoses > 0) pieces.push(`${confirmedDiagnoses} confirmed diagnosis ${confirmedDiagnoses === 1 ? 'signal' : 'signals'}`);
    if (longitudinalVisits > 0) pieces.push(`${longitudinalVisits} longitudinal visit${longitudinalVisits === 1 ? '' : 's'}`);
    if (activeConditions.length > 0) pieces.push(`active conditions: ${activeConditions.join(', ')}`);
    return `${pieces.join(' - ')}.`;
}

function defaultEventTitle(value: PatientTimelineEventType): string {
    switch (value) {
        case 'confirmed_diagnosis':
            return 'Confirmed diagnosis';
        case 'inference_recorded':
            return 'Inference recorded';
        case 'case_created':
            return 'Case opened';
        case 'lab_result':
            return 'Lab result';
        case 'imaging_result':
            return 'Imaging result';
        case 'treatment_started':
            return 'Treatment started';
        case 'follow_up':
            return 'Follow-up';
        case 'petpass_update':
            return 'PetPass update';
        case 'external_record':
        default:
            return 'External record';
    }
}

function buildOutcomeSummary(
    confirmedDiagnosis: unknown,
    topDiagnosis: unknown,
    confidence: unknown,
): string {
    const confirmed = normalizeText(confirmedDiagnosis);
    const top = normalizeText(topDiagnosis);
    const probability = readNumber(confidence);
    if (confirmed) return `Confirmed diagnosis recorded: ${confirmed}.`;
    if (top && probability != null) return `Inference recorded: ${top} at ${Math.round(probability * 100)}%.`;
    if (top) return `Inference recorded: ${top}.`;
    return 'Clinical timeline event recorded.';
}

function sanitizeClinicalPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(payload)
            .filter(([key, value]) => value !== undefined && value !== null && !isSensitiveKey(key))
            .map(([key, value]) => [key, sanitizeClinicalValue(value)]),
    );
}

function sanitizeClinicalValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => sanitizeClinicalValue(entry));
    if (isRecord(value)) return sanitizeClinicalPayload(value);
    if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, 400);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    return String(value).slice(0, 200);
}

function isSensitiveKey(key: string): boolean {
    return /(owner|contact|phone|email|address|microchip|chip|patient_name|name|raw_transcript|transcript|url|uri|file_path)/i.test(key);
}

function normalizeEventType(value: unknown): PatientTimelineEventType {
    return value === 'case_created'
        || value === 'inference_recorded'
        || value === 'confirmed_diagnosis'
        || value === 'lab_result'
        || value === 'imaging_result'
        || value === 'treatment_started'
        || value === 'follow_up'
        || value === 'petpass_update'
        || value === 'external_record'
        ? value
        : 'external_record';
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
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

function isMissingRelationOrColumn(message: string): boolean {
    return message.includes('schema cache')
        || message.includes('Could not find the')
        || (message.includes('relation') && message.includes('does not exist'))
        || (message.includes('column') && message.includes('does not exist'));
}
