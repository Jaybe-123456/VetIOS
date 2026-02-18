/**
 * @vetios/domain — Patient Module
 *
 * Patient data access and query helpers.
 */

import type { TypedSupabaseClient } from '@vetios/db';
import type { Patient } from '@vetios/db';

export interface CreatePatientInput {
    tenant_id: string;
    client_id: string;
    name: string;
    species: string;
    breed?: string;
    weight_kg?: number;
    date_of_birth?: string;
}

export async function createPatient(
    client: TypedSupabaseClient,
    input: CreatePatientInput,
): Promise<Patient> {
    const { data, error } = await client
        .from('patients')
        .insert({
            tenant_id: input.tenant_id,
            client_id: input.client_id,
            name: input.name,
            species: input.species,
            breed: input.breed ?? null,
            weight_kg: input.weight_kg ?? null,
            date_of_birth: input.date_of_birth ?? null,
        })
        .select()
        .single();

    if (error || !data) {
        throw new Error(`Failed to create patient: ${error?.message ?? 'Unknown error'}`);
    }

    return data as Patient;
}

export async function getPatientById(
    client: TypedSupabaseClient,
    patientId: string,
): Promise<Patient | null> {
    const { data, error } = await client
        .from('patients')
        .select()
        .eq('id', patientId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw new Error(`Failed to fetch patient: ${error.message}`);
    }

    return data as Patient;
}

export async function listPatientsByTenant(
    client: TypedSupabaseClient,
    tenantId: string,
    options?: { limit?: number; offset?: number },
): Promise<Patient[]> {
    let query = client
        .from('patients')
        .select()
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true });

    if (options?.limit) {
        query = query.limit(options.limit);
    }
    if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1);
    }

    const { data, error } = await query;

    if (error) {
        throw new Error(`Failed to list patients: ${error.message}`);
    }

    return (data ?? []) as Patient[];
}

export async function listPatientsByClient(
    client: TypedSupabaseClient,
    clientId: string,
): Promise<Patient[]> {
    const { data, error } = await client
        .from('patients')
        .select()
        .eq('client_id', clientId)
        .order('name', { ascending: true });

    if (error) {
        throw new Error(`Failed to list patients by client: ${error.message}`);
    }

    return (data ?? []) as Patient[];
}

export async function updatePatient(
    client: TypedSupabaseClient,
    patientId: string,
    updates: Partial<Pick<Patient, 'name' | 'species' | 'breed' | 'weight_kg'>>,
): Promise<Patient> {
    const { data, error } = await client
        .from('patients')
        .update(updates)
        .eq('id', patientId)
        .select()
        .single();

    if (error || !data) {
        throw new Error(`Failed to update patient: ${error?.message ?? 'Unknown error'}`);
    }

    return data as Patient;
}
