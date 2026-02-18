/**
 * @vetios/domain — Encounter Module
 *
 * Manages the lifecycle of a patient visit.
 * Provides types, status transition validation, and clinical event creation.
 */

import type { TypedSupabaseClient } from '@vetios/db';
import type { Encounter, EncounterStatus, ClinicalEvent, ClinicalEventType, Json } from '@vetios/db';
import { createLogger } from '@vetios/logger';

const logger = createLogger({ module: 'domain.encounter' });

// ─── Status Transition Rules ─────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<EncounterStatus, EncounterStatus[]> = {
    checked_in: ['in_progress'],
    in_progress: ['diagnosed', 'discharged'],
    diagnosed: ['discharged', 'in_progress'], // Allow returning to in_progress for re-examination
    discharged: [], // Terminal state
};

export class InvalidStatusTransitionError extends Error {
    constructor(from: EncounterStatus, to: EncounterStatus) {
        super(`Invalid encounter status transition: ${from} → ${to}`);
        this.name = 'InvalidStatusTransitionError';
    }
}

/**
 * Validates that a status transition is allowed.
 * Throws InvalidStatusTransitionError if the transition is not permitted.
 */
export function validateStatusTransition(
    currentStatus: EncounterStatus,
    newStatus: EncounterStatus,
): void {
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
        throw new InvalidStatusTransitionError(currentStatus, newStatus);
    }
}

// ─── Encounter Operations ────────────────────────────────────────────────────

export interface CreateEncounterInput {
    tenant_id: string;
    patient_id: string;
    user_id: string;
    chief_complaint?: string;
}

export async function createEncounter(
    client: TypedSupabaseClient,
    input: CreateEncounterInput,
): Promise<Encounter> {
    const { data, error } = await client
        .from('encounters')
        .insert({
            tenant_id: input.tenant_id,
            patient_id: input.patient_id,
            user_id: input.user_id,
            status: 'checked_in' as EncounterStatus,
            chief_complaint: input.chief_complaint ?? null,
            started_at: new Date().toISOString(),
            ended_at: null,
        })
        .select()
        .single();

    if (error || !data) {
        logger.error('Failed to create encounter', { error, input });
        throw new Error(`Failed to create encounter: ${error?.message ?? 'Unknown error'}`);
    }

    const result = data as Encounter;
    logger.info('Encounter created', { encounter_id: result.id, patient_id: input.patient_id });
    return result;
}

export async function transitionEncounterStatus(
    client: TypedSupabaseClient,
    encounterId: string,
    currentStatus: EncounterStatus,
    newStatus: EncounterStatus,
): Promise<Encounter> {
    validateStatusTransition(currentStatus, newStatus);

    const updatePayload: Partial<Encounter> = { status: newStatus };
    if (newStatus === 'discharged') {
        updatePayload.ended_at = new Date().toISOString();
    }

    const { data, error } = await client
        .from('encounters')
        .update(updatePayload)
        .eq('id', encounterId)
        .eq('status', currentStatus) // Optimistic concurrency: only update if status hasn't changed
        .select()
        .single();

    if (error || !data) {
        logger.error('Failed to transition encounter status', { error, encounterId, currentStatus, newStatus });
        throw new Error(`Failed to transition encounter: ${error?.message ?? 'Concurrent modification detected'}`);
    }

    const result = data as Encounter;
    logger.info('Encounter status transitioned', { encounter_id: encounterId, from: currentStatus, to: newStatus });
    return result;
}

export async function getEncounterById(
    client: TypedSupabaseClient,
    encounterId: string,
): Promise<Encounter | null> {
    const { data, error } = await client
        .from('encounters')
        .select()
        .eq('id', encounterId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw new Error(`Failed to fetch encounter: ${error.message}`);
    }

    return data as Encounter;
}

export async function listEncountersByTenant(
    client: TypedSupabaseClient,
    tenantId: string,
    options?: { status?: EncounterStatus; limit?: number; offset?: number },
): Promise<Encounter[]> {
    let query = client
        .from('encounters')
        .select()
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false });

    if (options?.status) {
        query = query.eq('status', options.status);
    }
    if (options?.limit) {
        query = query.limit(options.limit);
    }
    if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit ?? 20) - 1);
    }

    const { data, error } = await query;

    if (error) {
        throw new Error(`Failed to list encounters: ${error.message}`);
    }

    return (data ?? []) as Encounter[];
}

// ─── Clinical Event Operations ───────────────────────────────────────────────

export interface CreateClinicalEventInput {
    tenant_id: string;
    encounter_id: string;
    event_type: ClinicalEventType;
    payload: Json;
    created_by: string;
}

export async function appendClinicalEvent(
    client: TypedSupabaseClient,
    input: CreateClinicalEventInput,
): Promise<ClinicalEvent> {
    const { data, error } = await client
        .from('clinical_events')
        .insert({
            tenant_id: input.tenant_id,
            encounter_id: input.encounter_id,
            event_type: input.event_type,
            payload: input.payload,
            created_by: input.created_by,
        })
        .select()
        .single();

    if (error || !data) {
        logger.error('Failed to append clinical event', { error, input });
        throw new Error(`Failed to append clinical event: ${error?.message ?? 'Unknown error'}`);
    }

    const result = data as ClinicalEvent;
    logger.info('Clinical event appended', {
        event_id: result.id,
        encounter_id: input.encounter_id,
        event_type: input.event_type,
    });

    return result;
}

export async function listClinicalEvents(
    client: TypedSupabaseClient,
    encounterId: string,
): Promise<ClinicalEvent[]> {
    const { data, error } = await client
        .from('clinical_events')
        .select()
        .eq('encounter_id', encounterId)
        .order('created_at', { ascending: true });

    if (error) {
        throw new Error(`Failed to list clinical events: ${error.message}`);
    }

    return (data ?? []) as ClinicalEvent[];
}
