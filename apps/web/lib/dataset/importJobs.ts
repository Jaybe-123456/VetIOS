import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ClinicalCaseImportJobStatus =
    | 'queued'
    | 'validating'
    | 'validated'
    | 'importing'
    | 'completed'
    | 'failed';

export interface ClinicalCaseImportJobRecord {
    id: string;
    tenant_id: string;
    user_id: string | null;
    clinic_id: string | null;
    source_name: string | null;
    dry_run: boolean;
    status: ClinicalCaseImportJobStatus;
    payload_hash: string;
    requested_cases: number;
    accepted_count: number;
    rejected_count: number;
    learning_ready_count: number;
    consent_required_rejections: number;
    phi_rejections: number;
    report: Record<string, unknown>;
    error_message: string | null;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
    updated_at: string;
}

export interface ClinicalCaseImportReportSummary {
    accepted: number;
    rejected: number;
    learning_ready: number;
    consent_required_rejections: number;
    phi_rejections: number;
}

export function hashImportPayload(payload: unknown): string {
    return createHash('sha256')
        .update(stableStringify(payload))
        .digest('hex');
}

export async function createClinicalCaseImportJob(
    client: SupabaseClient,
    input: {
        tenantId: string;
        userId?: string | null;
        clinicId?: string | null;
        sourceName?: string | null;
        dryRun: boolean;
        status: ClinicalCaseImportJobStatus;
        requestedCases: number;
        payloadHash: string;
    },
): Promise<ClinicalCaseImportJobRecord> {
    const now = new Date().toISOString();
    const { data, error } = await client
        .from('clinical_case_import_jobs')
        .insert({
            tenant_id: input.tenantId,
            user_id: input.userId ?? null,
            clinic_id: input.clinicId ?? null,
            source_name: input.sourceName ?? null,
            dry_run: input.dryRun,
            status: input.status,
            payload_hash: input.payloadHash,
            requested_cases: input.requestedCases,
            started_at: now,
        })
        .select('*')
        .single();

    if (error || !data) {
        if (error && isMissingImportJobStorage(error)) {
            throw new Error(missingImportJobStorageMessage());
        }
        throw new Error(`Failed to create clinical case import job: ${error?.message ?? 'Unknown error'}`);
    }

    const job = mapImportJob(data as Record<string, unknown>);
    await appendClinicalCaseImportJobEvent(client, {
        tenantId: input.tenantId,
        importJobId: job.id,
        eventType: input.status,
        eventPayload: {
            dry_run: input.dryRun,
            source_name: input.sourceName ?? null,
            requested_cases: input.requestedCases,
        },
    });
    return job;
}

export async function completeClinicalCaseImportJob(
    client: SupabaseClient,
    input: {
        tenantId: string;
        jobId: string;
        status: 'validated' | 'completed' | 'failed';
        report?: Record<string, unknown> | null;
        summary?: ClinicalCaseImportReportSummary | null;
        errorMessage?: string | null;
    },
): Promise<ClinicalCaseImportJobRecord> {
    const summary = input.summary ?? null;
    const patch: Record<string, unknown> = {
        status: input.status,
        completed_at: new Date().toISOString(),
        report: input.report ?? {},
        error_message: input.errorMessage ?? null,
    };

    if (summary) {
        patch.accepted_count = summary.accepted;
        patch.rejected_count = summary.rejected;
        patch.learning_ready_count = summary.learning_ready;
        patch.consent_required_rejections = summary.consent_required_rejections;
        patch.phi_rejections = summary.phi_rejections;
    }

    const { data, error } = await client
        .from('clinical_case_import_jobs')
        .update(patch)
        .eq('tenant_id', input.tenantId)
        .eq('id', input.jobId)
        .select('*')
        .single();

    if (error || !data) {
        if (error && isMissingImportJobStorage(error)) {
            throw new Error(missingImportJobStorageMessage());
        }
        throw new Error(`Failed to update clinical case import job: ${error?.message ?? 'Unknown error'}`);
    }

    const job = mapImportJob(data as Record<string, unknown>);
    await appendClinicalCaseImportJobEvent(client, {
        tenantId: input.tenantId,
        importJobId: input.jobId,
        eventType: input.status,
        eventPayload: {
            summary,
            error_message: input.errorMessage ?? null,
        },
    });
    return job;
}

export async function appendClinicalCaseImportJobEvent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        importJobId: string;
        eventType: string;
        eventPayload?: Record<string, unknown> | null;
    },
): Promise<void> {
    const { error } = await client
        .from('clinical_case_import_job_events')
        .insert({
            tenant_id: input.tenantId,
            import_job_id: input.importJobId,
            event_type: input.eventType,
            event_payload: input.eventPayload ?? {},
        });

    if (error) {
        if (isMissingImportJobStorage(error)) {
            throw new Error(missingImportJobStorageMessage());
        }
        throw new Error(`Failed to append clinical case import job event: ${error.message}`);
    }
}

export async function listClinicalCaseImportJobs(
    client: SupabaseClient,
    tenantId: string,
    limit = 10,
): Promise<ClinicalCaseImportJobRecord[]> {
    const { data, error } = await client
        .from('clinical_case_import_jobs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        if (isMissingImportJobStorage(error)) {
            throw new Error(missingImportJobStorageMessage());
        }
        throw new Error(`Failed to list clinical case import jobs: ${error.message}`);
    }

    return (data ?? []).map((row) => mapImportJob(row as Record<string, unknown>));
}

export function isMissingImportJobStorage(error: { code?: string; message?: string }): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return error.code === '42P01'
        || error.code === 'PGRST116'
        || message.includes('clinical_case_import_jobs')
        || message.includes('clinical_case_import_job_events')
        || message.includes('schema cache');
}

export function missingImportJobStorageMessage(): string {
    return 'Clinical case import job storage is not installed. Apply supabase/migrations/20260611011000_dataset_consent_and_import_ledgers.sql in Supabase, then reload the schema.';
}

function mapImportJob(row: Record<string, unknown>): ClinicalCaseImportJobRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        user_id: readString(row.user_id),
        clinic_id: readString(row.clinic_id),
        source_name: readString(row.source_name),
        dry_run: row.dry_run === true,
        status: readString(row.status) as ClinicalCaseImportJobStatus,
        payload_hash: String(row.payload_hash),
        requested_cases: readNumber(row.requested_cases) ?? 0,
        accepted_count: readNumber(row.accepted_count) ?? 0,
        rejected_count: readNumber(row.rejected_count) ?? 0,
        learning_ready_count: readNumber(row.learning_ready_count) ?? 0,
        consent_required_rejections: readNumber(row.consent_required_rejections) ?? 0,
        phi_rejections: readNumber(row.phi_rejections) ?? 0,
        report: asRecord(row.report),
        error_message: readString(row.error_message),
        created_at: String(row.created_at),
        started_at: readString(row.started_at),
        completed_at: readString(row.completed_at),
        updated_at: String(row.updated_at),
    };
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
