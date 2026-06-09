import type { SupabaseClient } from '@supabase/supabase-js';
import { TENANT_LEARNING_CONSENTS } from '@/lib/db/schemaContracts';

export type LearningConsentScope = 'deidentified_training' | 'network_learning' | 'population_signal';
export type LearningConsentStatus = 'granted' | 'revoked';

export interface TenantLearningConsentRecord {
    id: string | null;
    tenant_id: string;
    consent_scope: LearningConsentScope;
    status: LearningConsentStatus;
    consent_version: string;
    granted_by: string | null;
    revoked_by: string | null;
    policy_snapshot: Record<string, unknown>;
    granted_at: string | null;
    revoked_at: string | null;
    created_at: string | null;
    updated_at: string | null;
}

export async function listTenantLearningConsents(
    client: SupabaseClient,
    tenantId: string,
    scope?: LearningConsentScope | null,
): Promise<TenantLearningConsentRecord[]> {
    const C = TENANT_LEARNING_CONSENTS.COLUMNS;
    let query = client
        .from(TENANT_LEARNING_CONSENTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.updated_at, { ascending: false });

    if (scope) {
        query = query.eq(C.consent_scope, scope);
    }

    const { data, error } = await query;
    if (error) {
        if (isMissingTenantLearningConsentsTable(error)) {
            throw new Error(missingConsentMigrationMessage());
        }
        throw new Error(`Failed to list tenant learning consents: ${error.message}`);
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map(mapConsentRow);
}

export async function upsertTenantLearningConsent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actorUserId?: string | null;
        consentScope: LearningConsentScope;
        status: LearningConsentStatus;
        consentVersion?: string | null;
        policySnapshot?: Record<string, unknown> | null;
    },
): Promise<TenantLearningConsentRecord> {
    const C = TENANT_LEARNING_CONSENTS.COLUMNS;
    const now = new Date().toISOString();
    const consentVersion = normalizeText(input.consentVersion) ?? 'vetios_learning_consent_v1';
    const payload: Record<string, unknown> = {
        [C.tenant_id]: input.tenantId,
        [C.consent_scope]: input.consentScope,
        [C.status]: input.status,
        [C.consent_version]: consentVersion,
        [C.policy_snapshot]: input.policySnapshot ?? {},
        [C.updated_at]: now,
    };

    if (input.status === 'granted') {
        payload[C.granted_by] = input.actorUserId ?? null;
        payload[C.granted_at] = now;
        payload[C.revoked_by] = null;
        payload[C.revoked_at] = null;
    } else {
        payload[C.revoked_by] = input.actorUserId ?? null;
        payload[C.revoked_at] = now;
    }

    const { data, error } = await client
        .from(TENANT_LEARNING_CONSENTS.TABLE)
        .upsert(payload, { onConflict: `${C.tenant_id},${C.consent_scope},${C.consent_version}` })
        .select('*')
        .single();

    if (error || !data) {
        if (error && isMissingTenantLearningConsentsTable(error)) {
            throw new Error(missingConsentMigrationMessage());
        }
        throw new Error(`Failed to update tenant learning consent: ${error?.message ?? 'Unknown error'}`);
    }

    return mapConsentRow(data as Record<string, unknown>);
}

function mapConsentRow(row: Record<string, unknown>): TenantLearningConsentRecord {
    return {
        id: normalizeText(row.id),
        tenant_id: normalizeText(row.tenant_id) ?? '',
        consent_scope: (normalizeText(row.consent_scope) ?? 'deidentified_training') as LearningConsentScope,
        status: (normalizeText(row.status) ?? 'revoked') as LearningConsentStatus,
        consent_version: normalizeText(row.consent_version) ?? 'vetios_learning_consent_v1',
        granted_by: normalizeText(row.granted_by),
        revoked_by: normalizeText(row.revoked_by),
        policy_snapshot: asRecord(row.policy_snapshot),
        granted_at: normalizeText(row.granted_at),
        revoked_at: normalizeText(row.revoked_at),
        created_at: normalizeText(row.created_at),
        updated_at: normalizeText(row.updated_at),
    };
}

function normalizeText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function isMissingTenantLearningConsentsTable(error: { code?: string; message?: string }): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return error.code === '42P01'
        || error.code === 'PGRST116'
        || message.includes('tenant_learning_consents')
        || message.includes('schema cache');
}

function missingConsentMigrationMessage(): string {
    return 'Network learning consent storage is not installed. Apply supabase/migrations/20260609010000_tenant_learning_consents_repair.sql in Supabase, then reload the schema.';
}
