import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapClinicalCaseRow, type ClinicalCaseRecord } from '@/lib/clinicalCases/clinicalCaseManager';
import {
    CLINICAL_CASES,
    CLINICAL_OUTCOME_EVENTS,
    EVIDENCE_CARDS,
    EPISODE_EVENT_LINKS,
    OUTCOME_INFERENCES,
    PASSIVE_SIGNAL_EVENTS,
    PATIENT_EPISODES,
    PROTOCOL_EXECUTIONS,
    SIGNAL_SOURCES,
} from '@/lib/db/schemaContracts';

type JsonObject = Record<string, unknown>;

export interface PassiveSignalEventRecord {
    id: string;
    tenant_id: string;
    clinic_id: string | null;
    patient_id: string | null;
    encounter_id: string | null;
    case_id: string | null;
    episode_id: string | null;
    source_id: string | null;
    signal_type: string;
    signal_subtype: string | null;
    observed_at: string;
    payload: JsonObject;
    normalized_facts: JsonObject;
    confidence: number | null;
    dedupe_key: string | null;
    ingestion_status: string;
    created_at: string;
}

export interface PatientEpisodeRecord {
    id: string;
    tenant_id: string;
    clinic_id: string | null;
    patient_id: string;
    primary_condition_class: string | null;
    episode_key: string;
    status: string;
    started_at: string;
    ended_at: string | null;
    resolved_at: string | null;
    latest_case_id: string | null;
    latest_encounter_id: string | null;
    outcome_state: string;
    outcome_confidence: number | null;
    severity_peak: number | null;
    recurrence_count: number;
    summary: JsonObject;
    created_at: string;
    updated_at: string;
}

export interface EpisodeDetail {
    episode: PatientEpisodeRecord;
    signals: PassiveSignalEventRecord[];
    cases: ClinicalCaseRecord[];
    outcome_inferences: JsonObject[];
    outcome_events: JsonObject[];
    protocol_executions: JsonObject[];
    evidence_cards: JsonObject[];
    timeline: JsonObject[];
}

const OPEN_EPISODE_STATUSES = ['open', 'monitoring'];

export function createOutcomeNetworkRepository(client: SupabaseClient) {
    return {
        async findCaseById(tenantId: string, caseId: string): Promise<ClinicalCaseRecord | null> {
            const C = CLINICAL_CASES.COLUMNS;
            const { data, error } = await client
                .from(CLINICAL_CASES.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.id, caseId)
                .maybeSingle();
            if (error) throw new Error(`Failed to fetch clinical case: ${error.message}`);
            return data ? mapClinicalCaseRow(asRecord(data)) : null;
        },

        async listCasesForEpisode(tenantId: string, episodeId: string, limit = 50): Promise<ClinicalCaseRecord[]> {
            const C = CLINICAL_CASES.COLUMNS;
            const { data, error } = await client
                .from(CLINICAL_CASES.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.episode_id, episodeId)
                .order(C.updated_at, { ascending: false })
                .limit(limit);
            if (error) throw new Error(`Failed to list episode cases: ${error.message}`);
            return (data ?? []).map((row) => mapClinicalCaseRow(asRecord(row)));
        },

        async updateCaseLink(
            tenantId: string,
            caseId: string,
            patch: Partial<{
                patient_id: string | null;
                encounter_id: string | null;
                episode_id: string | null;
                episode_status: string | null;
                resolved_at: string | null;
            }>,
        ): Promise<ClinicalCaseRecord> {
            const C = CLINICAL_CASES.COLUMNS;
            const { data, error } = await client
                .from(CLINICAL_CASES.TABLE)
                .update(patch)
                .eq(C.tenant_id, tenantId)
                .eq(C.id, caseId)
                .select('*')
                .single();
            if (error || !data) {
                throw new Error(`Failed to update clinical case link: ${error?.message ?? 'Unknown error'}`);
            }
            return mapClinicalCaseRow(asRecord(data));
        },

        async findSignalSource(tenantId: string, sourceType: string, vendorName?: string | null, vendorAccountRef?: string | null) {
            const C = SIGNAL_SOURCES.COLUMNS;
            let query = client
                .from(SIGNAL_SOURCES.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.source_type, sourceType);
            query = vendorName == null ? query.is(C.vendor_name, null) : query.eq(C.vendor_name, vendorName);
            query = vendorAccountRef == null ? query.is(C.vendor_account_ref, null) : query.eq(C.vendor_account_ref, vendorAccountRef);
            const { data, error } = await query.maybeSingle();
            if (error) throw new Error(`Failed to fetch signal source: ${error.message}`);
            return data ? asRecord(data) : null;
        },

        async createSignalSource(input: {
            tenant_id: string;
            clinic_id?: string | null;
            source_type: string;
            vendor_name?: string | null;
            vendor_account_ref?: string | null;
        }) {
            const C = SIGNAL_SOURCES.COLUMNS;
            const { data, error } = await client
                .from(SIGNAL_SOURCES.TABLE)
                .insert({
                    [C.tenant_id]: input.tenant_id,
                    [C.clinic_id]: input.clinic_id ?? null,
                    [C.source_type]: input.source_type,
                    [C.vendor_name]: input.vendor_name ?? null,
                    [C.vendor_account_ref]: input.vendor_account_ref ?? null,
                })
                .select('*')
                .single();
            if (error || !data) {
                throw new Error(`Failed to create signal source: ${error?.message ?? 'Unknown error'}`);
            }
            return asRecord(data);
        },

        async findSignalById(tenantId: string, signalEventId: string): Promise<PassiveSignalEventRecord | null> {
            const C = PASSIVE_SIGNAL_EVENTS.COLUMNS;
            const { data, error } = await client
                .from(PASSIVE_SIGNAL_EVENTS.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.id, signalEventId)
                .maybeSingle();
            if (error) throw new Error(`Failed to fetch passive signal: ${error.message}`);
            return data ? mapPassiveSignalRow(asRecord(data)) : null;
        },

        async findSignalByDedupeKey(tenantId: string, dedupeKey: string): Promise<PassiveSignalEventRecord | null> {
            const C = PASSIVE_SIGNAL_EVENTS.COLUMNS;
            const { data, error } = await client
                .from(PASSIVE_SIGNAL_EVENTS.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.dedupe_key, dedupeKey)
                .maybeSingle();
            if (error) throw new Error(`Failed to fetch passive signal by dedupe key: ${error.message}`);
            return data ? mapPassiveSignalRow(asRecord(data)) : null;
        },

        async createSignal(input: {
            tenant_id: string;
            clinic_id?: string | null;
            patient_id?: string | null;
            encounter_id?: string | null;
            case_id?: string | null;
            episode_id?: string | null;
            source_id?: string | null;
            signal_type: string;
            signal_subtype?: string | null;
            observed_at: string;
            payload?: JsonObject;
            normalized_facts?: JsonObject;
            confidence?: number | null;
            dedupe_key?: string | null;
            ingestion_status?: string;
        }): Promise<PassiveSignalEventRecord> {
            const C = PASSIVE_SIGNAL_EVENTS.COLUMNS;
            const { data, error } = await client
                .from(PASSIVE_SIGNAL_EVENTS.TABLE)
                .insert({
                    [C.tenant_id]: input.tenant_id,
                    [C.clinic_id]: input.clinic_id ?? null,
                    [C.patient_id]: input.patient_id ?? null,
                    [C.encounter_id]: input.encounter_id ?? null,
                    [C.case_id]: input.case_id ?? null,
                    [C.episode_id]: input.episode_id ?? null,
                    [C.source_id]: input.source_id ?? null,
                    [C.signal_type]: input.signal_type,
                    [C.signal_subtype]: input.signal_subtype ?? null,
                    [C.observed_at]: input.observed_at,
                    [C.payload]: input.payload ?? {},
                    [C.normalized_facts]: input.normalized_facts ?? {},
                    [C.confidence]: input.confidence ?? null,
                    [C.dedupe_key]: input.dedupe_key ?? null,
                    [C.ingestion_status]: input.ingestion_status ?? 'pending',
                })
                .select('*')
                .single();
            if (error || !data) {
                throw new Error(`Failed to create passive signal: ${error?.message ?? 'Unknown error'}`);
            }
            return mapPassiveSignalRow(asRecord(data));
        },

        async updateSignal(
            tenantId: string,
            signalEventId: string,
            patch: Partial<{
                clinic_id: string | null;
                patient_id: string | null;
                encounter_id: string | null;
                case_id: string | null;
                episode_id: string | null;
                ingestion_status: string;
                normalized_facts: JsonObject;
            }>,
        ): Promise<PassiveSignalEventRecord> {
            const C = PASSIVE_SIGNAL_EVENTS.COLUMNS;
            const { data, error } = await client
                .from(PASSIVE_SIGNAL_EVENTS.TABLE)
                .update(patch)
                .eq(C.tenant_id, tenantId)
                .eq(C.id, signalEventId)
                .select('*')
                .single();
            if (error || !data) {
                throw new Error(`Failed to update passive signal: ${error?.message ?? 'Unknown error'}`);
            }
            return mapPassiveSignalRow(asRecord(data));
        },

        async findEpisodeById(tenantId: string, episodeId: string): Promise<PatientEpisodeRecord | null> {
            const C = PATIENT_EPISODES.COLUMNS;
            const { data, error } = await client
                .from(PATIENT_EPISODES.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.id, episodeId)
                .maybeSingle();
            if (error) throw new Error(`Failed to fetch patient episode: ${error.message}`);
            return data ? mapEpisodeRow(asRecord(data)) : null;
        },

        async findOpenEpisodeForPatient(tenantId: string, patientId: string, primaryConditionClass?: string | null) {
            const C = PATIENT_EPISODES.COLUMNS;
            const { data, error } = await client
                .from(PATIENT_EPISODES.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.patient_id, patientId)
                .in(C.status, OPEN_EPISODE_STATUSES)
                .order(C.updated_at, { ascending: false })
                .limit(20);
            if (error) throw new Error(`Failed to find open patient episode: ${error.message}`);
            const episodes = (data ?? []).map((row) => mapEpisodeRow(asRecord(row)));
            const desired = normalizeText(primaryConditionClass);
            if (!desired) return episodes[0] ?? null;
            return episodes.find((item) => normalizeText(item.primary_condition_class) === desired)
                ?? episodes.find((item) => item.primary_condition_class == null)
                ?? episodes[0]
                ?? null;
        },

        async createEpisode(input: {
            tenant_id: string;
            clinic_id?: string | null;
            patient_id: string;
            primary_condition_class?: string | null;
            episode_key: string;
            started_at: string;
            latest_case_id?: string | null;
            latest_encounter_id?: string | null;
            status?: string;
            outcome_state?: string;
            resolved_at?: string | null;
            summary?: JsonObject;
        }): Promise<PatientEpisodeRecord> {
            const C = PATIENT_EPISODES.COLUMNS;
            const { data, error } = await client
                .from(PATIENT_EPISODES.TABLE)
                .insert({
                    [C.tenant_id]: input.tenant_id,
                    [C.clinic_id]: input.clinic_id ?? null,
                    [C.patient_id]: input.patient_id,
                    [C.primary_condition_class]: input.primary_condition_class ?? null,
                    [C.episode_key]: input.episode_key,
                    [C.started_at]: input.started_at,
                    [C.latest_case_id]: input.latest_case_id ?? null,
                    [C.latest_encounter_id]: input.latest_encounter_id ?? null,
                    [C.status]: input.status ?? 'open',
                    [C.outcome_state]: input.outcome_state ?? 'unknown',
                    [C.resolved_at]: input.resolved_at ?? null,
                    [C.summary]: input.summary ?? {},
                })
                .select('*')
                .single();
            if (error || !data) {
                throw new Error(`Failed to create patient episode: ${error?.message ?? 'Unknown error'}`);
            }
            return mapEpisodeRow(asRecord(data));
        },

        async updateEpisode(
            tenantId: string,
            episodeId: string,
            patch: Partial<{
                clinic_id: string | null;
                primary_condition_class: string | null;
                latest_case_id: string | null;
                latest_encounter_id: string | null;
                status: string;
                outcome_state: string;
                resolved_at: string | null;
                summary: JsonObject;
            }>,
        ): Promise<PatientEpisodeRecord> {
            const C = PATIENT_EPISODES.COLUMNS;
            const { data, error } = await client
                .from(PATIENT_EPISODES.TABLE)
                .update({
                    ...patch,
                    [C.updated_at]: new Date().toISOString(),
                })
                .eq(C.tenant_id, tenantId)
                .eq(C.id, episodeId)
                .select('*')
                .single();
            if (error || !data) {
                throw new Error(`Failed to update patient episode: ${error?.message ?? 'Unknown error'}`);
            }
            return mapEpisodeRow(asRecord(data));
        },

        async linkEpisodeEventIfMissing(input: {
            tenant_id: string;
            episode_id: string;
            event_table: string;
            event_id: string;
            event_kind: string;
            observed_at: string;
            state_transition?: string | null;
            metadata?: JsonObject;
        }) {
            const C = EPISODE_EVENT_LINKS.COLUMNS;
            const { data: existing, error: lookupError } = await client
                .from(EPISODE_EVENT_LINKS.TABLE)
                .select('*')
                .eq(C.tenant_id, input.tenant_id)
                .eq(C.episode_id, input.episode_id)
                .eq(C.event_table, input.event_table)
                .eq(C.event_id, input.event_id)
                .eq(C.event_kind, input.event_kind)
                .maybeSingle();
            if (lookupError) throw new Error(`Failed to look up episode event link: ${lookupError.message}`);
            if (existing) return asRecord(existing);

            const { data, error } = await client
                .from(EPISODE_EVENT_LINKS.TABLE)
                .insert({
                    [C.tenant_id]: input.tenant_id,
                    [C.episode_id]: input.episode_id,
                    [C.event_table]: input.event_table,
                    [C.event_id]: input.event_id,
                    [C.event_kind]: input.event_kind,
                    [C.observed_at]: input.observed_at,
                    [C.sequence_no]: buildSequenceNo(input.observed_at),
                    [C.state_transition]: input.state_transition ?? null,
                    [C.metadata]: input.metadata ?? {},
                })
                .select('*')
                .single();
            if (error || !data) {
                throw new Error(`Failed to create episode event link: ${error?.message ?? 'Unknown error'}`);
            }
            return asRecord(data);
        },

        async listSignalsForEpisode(tenantId: string, episodeId: string, limit = 50): Promise<PassiveSignalEventRecord[]> {
            const C = PASSIVE_SIGNAL_EVENTS.COLUMNS;
            const { data, error } = await client
                .from(PASSIVE_SIGNAL_EVENTS.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.episode_id, episodeId)
                .order(C.observed_at, { ascending: false })
                .limit(limit);
            if (error) throw new Error(`Failed to list episode signals: ${error.message}`);
            return (data ?? []).map((row) => mapPassiveSignalRow(asRecord(row)));
        },

        async listOutcomeInferencesForEpisode(tenantId: string, episodeId: string, limit = 50) {
            const C = OUTCOME_INFERENCES.COLUMNS;
            const { data, error } = await client
                .from(OUTCOME_INFERENCES.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.episode_id, episodeId)
                .order(C.created_at, { ascending: false })
                .limit(limit);
            if (error) throw new Error(`Failed to list outcome inferences: ${error.message}`);
            return (data ?? []).map((row) => asRecord(row));
        },

        async listOutcomeEventsForCases(tenantId: string, caseIds: string[], limit = 50) {
            if (caseIds.length === 0) return [];
            const C = CLINICAL_OUTCOME_EVENTS.COLUMNS;
            const { data, error } = await client
                .from(CLINICAL_OUTCOME_EVENTS.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .in(C.case_id, caseIds)
                .order(C.outcome_timestamp, { ascending: false })
                .limit(limit);
            if (error) throw new Error(`Failed to list outcome events: ${error.message}`);
            return (data ?? []).map((row) => asRecord(row));
        },

        async listProtocolExecutionsForEpisode(tenantId: string, episodeId: string, limit = 50) {
            const C = PROTOCOL_EXECUTIONS.COLUMNS;
            const { data, error } = await client
                .from(PROTOCOL_EXECUTIONS.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.episode_id, episodeId)
                .order(C.started_at, { ascending: false })
                .limit(limit);
            if (error) throw new Error(`Failed to list protocol executions: ${error.message}`);
            return (data ?? []).map((row) => asRecord(row));
        },

        async listEvidenceCardsForEpisode(tenantId: string, episodeId: string, limit = 50) {
            const C = EVIDENCE_CARDS.COLUMNS;
            const { data, error } = await client
                .from(EVIDENCE_CARDS.TABLE)
                .select('*')
                .eq(C.tenant_id, tenantId)
                .eq(C.subject_type, 'episode')
                .eq(C.subject_id, episodeId)
                .order(C.created_at, { ascending: false })
                .limit(limit);
            if (error) throw new Error(`Failed to list evidence cards: ${error.message}`);
            return (data ?? []).map((row) => asRecord(row));
        },
    };
}

export async function reconcileEpisodeMembership(
    repo: ReturnType<typeof createOutcomeNetworkRepository>,
    input: {
        tenantId: string;
        clinicId?: string | null;
        patientId?: string | null;
        encounterId?: string | null;
        caseId?: string | null;
        signalEventId?: string | null;
        episodeId?: string | null;
        primaryConditionClass?: string | null;
        observedAt?: string | null;
        status?: string | null;
        outcomeState?: string | null;
        resolvedAt?: string | null;
        summaryPatch?: JsonObject;
    },
) {
    const observedAt = input.observedAt ?? new Date().toISOString();
    const clinicalCase = input.caseId ? await repo.findCaseById(input.tenantId, input.caseId) : null;
    const signalEvent = input.signalEventId ? await repo.findSignalById(input.tenantId, input.signalEventId) : null;
    const patientId = firstUuid(
        input.patientId,
        clinicalCase?.patient_id,
        readUuidFromObject(clinicalCase?.patient_metadata, ['patient_id', 'patientId']),
        signalEvent?.patient_id,
    );
    if (!patientId) {
        throw new Error('Episode reconciliation requires a patient_id or a case already linked to a patient.');
    }

    const encounterId = firstUuid(
        input.encounterId,
        clinicalCase?.encounter_id,
        readUuidFromObject(clinicalCase?.patient_metadata, ['encounter_id', 'encounterId']),
        signalEvent?.encounter_id,
    );
    const clinicId = normalizeText(input.clinicId) ?? clinicalCase?.clinic_id ?? signalEvent?.clinic_id ?? null;
    const primaryConditionClass = normalizeText(input.primaryConditionClass)
        ?? clinicalCase?.primary_condition_class
        ?? readTextFromObject(signalEvent?.normalized_facts, ['primary_condition_class', 'condition_class'])
        ?? null;

    let episode = input.episodeId
        ? await repo.findEpisodeById(input.tenantId, input.episodeId)
        : clinicalCase?.episode_id
            ? await repo.findEpisodeById(input.tenantId, clinicalCase.episode_id)
            : signalEvent?.episode_id
                ? await repo.findEpisodeById(input.tenantId, signalEvent.episode_id)
                : await repo.findOpenEpisodeForPatient(input.tenantId, patientId, primaryConditionClass);

    if (!episode) {
        episode = await repo.createEpisode({
            tenant_id: input.tenantId,
            clinic_id: clinicId,
            patient_id: patientId,
            primary_condition_class: primaryConditionClass,
            episode_key: buildEpisodeKey(patientId, primaryConditionClass, observedAt, clinicalCase?.id ?? signalEvent?.id ?? null),
            started_at: observedAt,
            latest_case_id: clinicalCase?.id ?? null,
            latest_encounter_id: encounterId,
            status: input.status ?? 'open',
            outcome_state: input.outcomeState ?? 'unknown',
            resolved_at: input.resolvedAt ?? null,
            summary: input.summaryPatch ?? {},
        });
    }

    if (clinicalCase) {
        await repo.updateCaseLink(input.tenantId, clinicalCase.id, {
            patient_id: patientId,
            encounter_id: encounterId,
            episode_id: episode.id,
            episode_status: input.status ?? episode.status,
            resolved_at: input.resolvedAt ?? episode.resolved_at,
        });
        await repo.linkEpisodeEventIfMissing({
            tenant_id: input.tenantId,
            episode_id: episode.id,
            event_table: CLINICAL_CASES.TABLE,
            event_id: clinicalCase.id,
            event_kind: 'clinical_case',
            observed_at: observedAt,
            metadata: {
                case_key: clinicalCase.case_key,
                primary_condition_class: clinicalCase.primary_condition_class,
            },
        });
    }

    let linkedSignal = signalEvent;
    if (linkedSignal) {
        linkedSignal = await repo.updateSignal(input.tenantId, linkedSignal.id, {
            clinic_id: clinicId,
            patient_id: patientId,
            encounter_id: encounterId,
            case_id: clinicalCase?.id ?? linkedSignal.case_id,
            episode_id: episode.id,
            ingestion_status: 'attached',
        });
        await repo.linkEpisodeEventIfMissing({
            tenant_id: input.tenantId,
            episode_id: episode.id,
            event_table: PASSIVE_SIGNAL_EVENTS.TABLE,
            event_id: linkedSignal.id,
            event_kind: 'passive_signal',
            observed_at: linkedSignal.observed_at,
            metadata: {
                signal_type: linkedSignal.signal_type,
                signal_subtype: linkedSignal.signal_subtype,
            },
        });
    }

    const signals = await repo.listSignalsForEpisode(input.tenantId, episode.id, 200);
    const cases = await repo.listCasesForEpisode(input.tenantId, episode.id, 200);
    const status = normalizeText(input.status) ?? deriveEpisodeStatus(input.outcomeState, episode.status);
    const outcomeState = normalizeText(input.outcomeState) ?? episode.outcome_state;
    const resolvedAt = status === 'resolved'
        ? (input.resolvedAt ?? episode.resolved_at ?? observedAt)
        : (input.resolvedAt ?? episode.resolved_at ?? null);

    episode = await repo.updateEpisode(input.tenantId, episode.id, {
        clinic_id: clinicId,
        primary_condition_class: primaryConditionClass,
        latest_case_id: clinicalCase?.id ?? episode.latest_case_id,
        latest_encounter_id: encounterId ?? episode.latest_encounter_id,
        status,
        outcome_state: outcomeState,
        resolved_at: resolvedAt,
        summary: {
            ...(episode.summary ?? {}),
            ...(input.summaryPatch ?? {}),
            signal_count: signals.length,
            case_count: cases.length,
            latest_signal_at: signals[0]?.observed_at ?? null,
            latest_case_id: cases[0]?.id ?? null,
            signal_types: [...new Set(signals.map((item) => item.signal_type))],
        },
    });

    return {
        episode,
        signal_event: linkedSignal,
        clinical_case: clinicalCase,
    };
}

export async function getEpisodeDetail(
    repo: ReturnType<typeof createOutcomeNetworkRepository>,
    tenantId: string,
    episodeId: string,
    limit = 50,
): Promise<EpisodeDetail | null> {
    const episode = await repo.findEpisodeById(tenantId, episodeId);
    if (!episode) return null;

    const [signals, cases, outcomeInferences, protocolExecutions, evidenceCards] = await Promise.all([
        repo.listSignalsForEpisode(tenantId, episodeId, limit),
        repo.listCasesForEpisode(tenantId, episodeId, limit),
        repo.listOutcomeInferencesForEpisode(tenantId, episodeId, limit),
        repo.listProtocolExecutionsForEpisode(tenantId, episodeId, limit),
        repo.listEvidenceCardsForEpisode(tenantId, episodeId, limit),
    ]);
    const outcomeEvents = await repo.listOutcomeEventsForCases(tenantId, cases.map((item) => item.id), limit);

    return {
        episode,
        signals,
        cases,
        outcome_inferences: outcomeInferences,
        outcome_events: outcomeEvents,
        protocol_executions: protocolExecutions,
        evidence_cards: evidenceCards,
        timeline: buildTimeline(signals, cases, outcomeInferences, outcomeEvents, protocolExecutions, evidenceCards),
    };
}

function mapPassiveSignalRow(row: JsonObject): PassiveSignalEventRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        clinic_id: firstUuid(row.clinic_id) ?? normalizeText(row.clinic_id),
        patient_id: firstUuid(row.patient_id) ?? normalizeText(row.patient_id),
        encounter_id: firstUuid(row.encounter_id) ?? normalizeText(row.encounter_id),
        case_id: firstUuid(row.case_id) ?? normalizeText(row.case_id),
        episode_id: firstUuid(row.episode_id) ?? normalizeText(row.episode_id),
        source_id: firstUuid(row.source_id) ?? normalizeText(row.source_id),
        signal_type: normalizeText(row.signal_type) ?? 'unknown',
        signal_subtype: normalizeText(row.signal_subtype),
        observed_at: String(row.observed_at),
        payload: asObject(row.payload),
        normalized_facts: asObject(row.normalized_facts),
        confidence: normalizeNumber(row.confidence),
        dedupe_key: normalizeText(row.dedupe_key),
        ingestion_status: normalizeText(row.ingestion_status) ?? 'pending',
        created_at: String(row.created_at),
    };
}

function mapEpisodeRow(row: JsonObject): PatientEpisodeRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        clinic_id: firstUuid(row.clinic_id) ?? normalizeText(row.clinic_id),
        patient_id: firstUuid(row.patient_id) ?? String(row.patient_id),
        primary_condition_class: normalizeText(row.primary_condition_class),
        episode_key: String(row.episode_key),
        status: normalizeText(row.status) ?? 'open',
        started_at: String(row.started_at),
        ended_at: normalizeText(row.ended_at),
        resolved_at: normalizeText(row.resolved_at),
        latest_case_id: firstUuid(row.latest_case_id) ?? normalizeText(row.latest_case_id),
        latest_encounter_id: firstUuid(row.latest_encounter_id) ?? normalizeText(row.latest_encounter_id),
        outcome_state: normalizeText(row.outcome_state) ?? 'unknown',
        outcome_confidence: normalizeNumber(row.outcome_confidence),
        severity_peak: normalizeNumber(row.severity_peak),
        recurrence_count: typeof row.recurrence_count === 'number' ? row.recurrence_count : 0,
        summary: asObject(row.summary),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function buildTimeline(
    signals: PassiveSignalEventRecord[],
    cases: ClinicalCaseRecord[],
    outcomeInferences: JsonObject[],
    outcomeEvents: JsonObject[],
    protocolExecutions: JsonObject[],
    evidenceCards: JsonObject[] = [],
): JsonObject[] {
    return [
        ...signals.map((item) => ({
            id: item.id,
            kind: 'signal',
            at: item.observed_at,
            title: item.signal_subtype ? `${item.signal_type}:${item.signal_subtype}` : item.signal_type,
        })),
        ...cases.map((item) => ({
            id: item.id,
            kind: 'case',
            at: item.updated_at,
            title: item.primary_condition_class ?? item.case_key,
        })),
        ...outcomeInferences.map((item) => ({
            id: String(item.id ?? ''),
            kind: 'outcome_inference',
            at: String(item.created_at ?? ''),
            title: normalizeText(item.inferred_state) ?? 'outcome_inference',
        })),
        ...outcomeEvents.map((item) => ({
            id: String(item.id ?? ''),
            kind: 'outcome_event',
            at: String(item.outcome_timestamp ?? item.created_at ?? ''),
            title: normalizeText(item.outcome_type) ?? 'outcome_event',
        })),
        ...protocolExecutions.map((item) => ({
            id: String(item.id ?? ''),
            kind: 'protocol_execution',
            at: String(item.started_at ?? item.created_at ?? ''),
            title: normalizeText(item.status) ?? 'protocol_execution',
        })),
        ...evidenceCards.map((item) => ({
            id: String(item.id ?? ''),
            kind: 'evidence_card',
            at: String(item.created_at ?? ''),
            title: normalizeText(item.headline) ?? 'evidence_card',
        })),
    ].sort((left, right) => String(right.at).localeCompare(String(left.at)));
}

function buildEpisodeKey(patientId: string, primaryConditionClass: string | null, observedAt: string, anchorId: string | null): string {
    const digest = createHash('sha256')
        .update([patientId, primaryConditionClass ?? 'unknown', observedAt, anchorId ?? 'none'].join('|'))
        .digest('hex')
        .slice(0, 24);
    return `episode:${digest}`;
}

function buildSequenceNo(observedAt: string): number {
    const ts = Date.parse(observedAt);
    return Number.isFinite(ts) ? Math.floor(ts / 1000) : 0;
}

function deriveEpisodeStatus(outcomeState: string | null | undefined, fallback: string): string {
    const normalized = normalizeText(outcomeState);
    if (normalized === 'resolved') return 'resolved';
    if (normalized === 'failed' || normalized === 'recurred') return 'monitoring';
    return fallback;
}

function readUuidFromObject(value: unknown, keys: string[]): string | null {
    const record = asObject(value);
    for (const key of keys) {
        const candidate = firstUuid(record[key]);
        if (candidate) return candidate;
    }
    return null;
}

function readTextFromObject(value: unknown, keys: string[]): string | null {
    const record = asObject(value);
    for (const key of keys) {
        const candidate = normalizeText(record[key]);
        if (candidate) return candidate;
    }
    return null;
}

function firstUuid(...values: unknown[]): string | null {
    for (const value of values) {
        const candidate = normalizeUuid(value);
        if (candidate) return candidate;
    }
    return null;
}

function normalizeUuid(value: unknown): string | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
        ? normalized.toLowerCase()
        : null;
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized ? normalized : null;
}

function normalizeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asObject(value: unknown): JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as JsonObject
        : {};
}

function asRecord(value: unknown): JsonObject {
    return typeof value === 'object' && value !== null
        ? value as JsonObject
        : {};
}
