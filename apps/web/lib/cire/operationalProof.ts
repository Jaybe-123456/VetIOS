import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const CIRE_OPERATIONAL_PROOF_KINDS = [
    'cron_execution',
    'migration_application',
    'registry_population',
    'calibration_execution',
] as const;

export const CIRE_OPERATIONAL_PROOF_STATUSES = [
    'observed',
    'succeeded',
    'failed',
    'degraded',
    'missing',
] as const;

export const CIRE_OPERATIONAL_SCHEMA_TARGETS = [
    'public.cire_snapshots',
    'public.cire_incidents',
    'public.cire_collapse_profiles',
    'public.cire_rolling_state',
    'public.cire_conformance_certification_events',
    'public.cire_operational_proof_events',
    'public.inference_reliability_packets',
    'public.gate_decision_events',
] as const;

export type CireOperationalProofKind = typeof CIRE_OPERATIONAL_PROOF_KINDS[number];
export type CireOperationalProofStatus = typeof CIRE_OPERATIONAL_PROOF_STATUSES[number];

export interface CireOperationalProofInput {
    tenantId: string;
    requestId: string;
    proofKind: CireOperationalProofKind;
    proofTarget: string;
    proofStatus?: CireOperationalProofStatus;
    runtimeEnvironment?: CireOperationalProofRecord['runtime_environment'];
    deploymentRef?: string | null;
    gitSha?: string | null;
    cronJobName?: string | null;
    cronSchedule?: string | null;
    cronAuthorizedBy?: string | null;
    startedAt?: string | Date | null;
    completedAt?: string | Date | null;
    latencyMs?: number;
    recordsProcessed?: number;
    schemaTargets?: readonly string[];
    blockers?: readonly string[];
    warnings?: readonly string[];
    proofPacket?: Record<string, unknown>;
    observedAt?: string | Date | null;
}

export interface CireOperationalProofRecord {
    tenant_id: string;
    request_id: string;
    proof_kind: CireOperationalProofKind;
    proof_target: string;
    proof_status: CireOperationalProofStatus;
    runtime_environment: 'unknown' | 'local' | 'preview' | 'production' | 'test';
    deployment_ref: string | null;
    git_sha: string | null;
    cron_job_name: string | null;
    cron_schedule: string | null;
    cron_authorized_by: string | null;
    started_at: string | null;
    completed_at: string | null;
    latency_ms: number;
    records_processed: number;
    schema_targets: string[];
    blockers: string[];
    warnings: string[];
    proof_digest: string;
    proof_packet: Record<string, unknown>;
    observed_at: string;
}

export interface CireOperationalProofResult {
    proof_id: string | null;
    proof_digest: string;
    proof_status: CireOperationalProofStatus;
    cached: boolean;
    unavailable?: boolean;
}

export interface CireOperationalProofRow {
    id?: string | null;
    proof_kind: CireOperationalProofKind;
    proof_target: string;
    proof_status: CireOperationalProofStatus;
    runtime_environment?: CireOperationalProofRecord['runtime_environment'] | null;
    deployment_ref?: string | null;
    git_sha?: string | null;
    cron_job_name?: string | null;
    cron_schedule?: string | null;
    latency_ms?: number | null;
    records_processed?: number | null;
    schema_targets?: string[] | null;
    blockers?: string[] | null;
    warnings?: string[] | null;
    proof_digest?: string | null;
    observed_at: string;
    created_at?: string | null;
}

export interface PublicCireOperationalProofSnapshot {
    generated_at: string;
    summary: {
        total_proofs: number;
        succeeded_proofs: number;
        failed_proofs: number;
        degraded_proofs: number;
        latest_observed_at: string | null;
    };
    cron_jobs: Array<{
        cron_job_name: string;
        proof_status: CireOperationalProofStatus;
        cron_schedule: string | null;
        latency_ms: number;
        records_processed: number;
        observed_at: string;
    }>;
    schema_targets: Array<{
        schema_target: string;
        proof_count: number;
        latest_observed_at: string;
    }>;
    latest_proofs: Array<{
        proof_kind: CireOperationalProofKind;
        proof_target: string;
        proof_status: CireOperationalProofStatus;
        runtime_environment: string | null;
        latency_ms: number;
        records_processed: number;
        blocker_count: number;
        warning_count: number;
        proof_digest: string | null;
        observed_at: string;
    }>;
}

const SECRET_KEY_PATTERN = /token|secret|password|authorization|owner|patient_name|microchip|email|phone/i;

export function buildCireOperationalProofRecord(input: CireOperationalProofInput): CireOperationalProofRecord {
    const startedAt = normalizeIso(input.startedAt);
    const completedAt = normalizeIso(input.completedAt);
    const observedAt = normalizeIso(input.observedAt) ?? completedAt ?? new Date().toISOString();
    const latencyMs = Math.max(0, Math.round(input.latencyMs ?? deriveLatencyMs(startedAt, completedAt)));
    const recordsProcessed = Math.max(0, Math.round(input.recordsProcessed ?? 0));
    const schemaTargets = uniqueStrings(input.schemaTargets ?? []);
    const blockers = uniqueStrings(input.blockers ?? []);
    const warnings = uniqueStrings(input.warnings ?? []);
    const proofPacket = sanitizePacket({
        ...input.proofPacket,
        proof_target: input.proofTarget,
        schema_targets: schemaTargets,
        blockers,
        warnings,
    });
    const stablePayload = {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        proof_kind: input.proofKind,
        proof_target: input.proofTarget,
        proof_status: input.proofStatus ?? 'observed',
        cron_job_name: normalizeNullable(input.cronJobName),
        cron_schedule: normalizeNullable(input.cronSchedule),
        started_at: startedAt,
        completed_at: completedAt,
        latency_ms: latencyMs,
        records_processed: recordsProcessed,
        schema_targets: schemaTargets,
        blockers,
        warnings,
        proof_packet: proofPacket,
    };

    return {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        proof_kind: input.proofKind,
        proof_target: input.proofTarget,
        proof_status: input.proofStatus ?? 'observed',
        runtime_environment: input.runtimeEnvironment ?? detectRuntimeEnvironment(),
        deployment_ref: normalizeNullable(input.deploymentRef) ?? detectDeploymentRef(),
        git_sha: normalizeNullable(input.gitSha) ?? detectGitSha(),
        cron_job_name: normalizeNullable(input.cronJobName),
        cron_schedule: normalizeNullable(input.cronSchedule),
        cron_authorized_by: normalizeNullable(input.cronAuthorizedBy),
        started_at: startedAt,
        completed_at: completedAt,
        latency_ms: latencyMs,
        records_processed: recordsProcessed,
        schema_targets: schemaTargets,
        blockers,
        warnings,
        proof_digest: hashStable(stablePayload),
        proof_packet: proofPacket,
        observed_at: observedAt,
    };
}

export async function recordCireOperationalProof(
    client: SupabaseClient,
    input: CireOperationalProofInput,
): Promise<CireOperationalProofResult> {
    const record = buildCireOperationalProofRecord(input);
    const { data, error } = await client
        .from('cire_operational_proof_events')
        .insert(record)
        .select('id, proof_digest, proof_status')
        .maybeSingle();

    if (!error) {
        return {
            proof_id: typeof data?.id === 'string' ? data.id : null,
            proof_digest: typeof data?.proof_digest === 'string' ? data.proof_digest : record.proof_digest,
            proof_status: normalizeProofStatus(data?.proof_status) ?? record.proof_status,
            cached: false,
        };
    }

    if (isDuplicateError(error)) {
        const cached = await client
            .from('cire_operational_proof_events')
            .select('id, proof_digest, proof_status')
            .eq('tenant_id', record.tenant_id)
            .eq('request_id', record.request_id)
            .eq('proof_kind', record.proof_kind)
            .eq('proof_target', record.proof_target)
            .maybeSingle();

        if (!cached.error) {
            return {
                proof_id: typeof cached.data?.id === 'string' ? cached.data.id : null,
                proof_digest: typeof cached.data?.proof_digest === 'string' ? cached.data.proof_digest : record.proof_digest,
                proof_status: normalizeProofStatus(cached.data?.proof_status) ?? record.proof_status,
                cached: true,
            };
        }
    }

    if (isMissingStorageError(error)) {
        return {
            proof_id: null,
            proof_digest: record.proof_digest,
            proof_status: record.proof_status,
            cached: false,
            unavailable: true,
        };
    }

    throw error;
}

export function buildPublicCireOperationalProofSnapshot(
    rows: CireOperationalProofRow[],
    generatedAt = new Date().toISOString(),
): PublicCireOperationalProofSnapshot {
    const sortedRows = [...rows].sort((a, b) => compareIsoDesc(a.observed_at, b.observed_at));
    const latestObservedAt = sortedRows[0]?.observed_at ?? null;
    const latestByCronJob = new Map<string, CireOperationalProofRow>();
    const schemaTargetMap = new Map<string, { proof_count: number; latest_observed_at: string }>();

    for (const row of sortedRows) {
        if (row.cron_job_name && !latestByCronJob.has(row.cron_job_name)) {
            latestByCronJob.set(row.cron_job_name, row);
        }
        for (const target of row.schema_targets ?? []) {
            const current = schemaTargetMap.get(target);
            if (!current) {
                schemaTargetMap.set(target, { proof_count: 1, latest_observed_at: row.observed_at });
            } else {
                current.proof_count += 1;
                if (compareIsoDesc(row.observed_at, current.latest_observed_at) < 0) {
                    current.latest_observed_at = row.observed_at;
                }
            }
        }
    }

    return {
        generated_at: generatedAt,
        summary: {
            total_proofs: rows.length,
            succeeded_proofs: rows.filter((row) => row.proof_status === 'succeeded').length,
            failed_proofs: rows.filter((row) => row.proof_status === 'failed').length,
            degraded_proofs: rows.filter((row) => row.proof_status === 'degraded').length,
            latest_observed_at: latestObservedAt,
        },
        cron_jobs: Array.from(latestByCronJob.values()).map((row) => ({
            cron_job_name: row.cron_job_name ?? 'unknown',
            proof_status: row.proof_status,
            cron_schedule: row.cron_schedule ?? null,
            latency_ms: Math.max(0, Math.round(row.latency_ms ?? 0)),
            records_processed: Math.max(0, Math.round(row.records_processed ?? 0)),
            observed_at: row.observed_at,
        })),
        schema_targets: Array.from(schemaTargetMap.entries())
            .map(([schema_target, proof]) => ({ schema_target, ...proof }))
            .sort((a, b) => a.schema_target.localeCompare(b.schema_target)),
        latest_proofs: sortedRows.slice(0, 25).map((row) => ({
            proof_kind: row.proof_kind,
            proof_target: row.proof_target,
            proof_status: row.proof_status,
            runtime_environment: row.runtime_environment ?? null,
            latency_ms: Math.max(0, Math.round(row.latency_ms ?? 0)),
            records_processed: Math.max(0, Math.round(row.records_processed ?? 0)),
            blocker_count: row.blockers?.length ?? 0,
            warning_count: row.warnings?.length ?? 0,
            proof_digest: row.proof_digest ?? null,
            observed_at: row.observed_at,
        })),
    };
}

function detectRuntimeEnvironment(): CireOperationalProofRecord['runtime_environment'] {
    if (process.env.NODE_ENV === 'test') return 'test';
    if (process.env.VERCEL_ENV === 'production') return 'production';
    if (process.env.VERCEL_ENV === 'preview') return 'preview';
    if (process.env.NODE_ENV === 'development') return 'local';
    return 'unknown';
}

function detectDeploymentRef(): string | null {
    return normalizeNullable(process.env.VERCEL_URL)
        ?? normalizeNullable(process.env.NEXT_PUBLIC_SITE_URL)
        ?? null;
}

function detectGitSha(): string | null {
    return normalizeNullable(process.env.VERCEL_GIT_COMMIT_SHA)
        ?? normalizeNullable(process.env.GITHUB_SHA)
        ?? null;
}

function normalizeIso(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeNullable(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function deriveLatencyMs(startedAt: string | null, completedAt: string | null): number {
    if (!startedAt || !completedAt) return 0;
    return Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
}

function uniqueStrings(values: readonly string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function sanitizePacket(value: unknown): Record<string, unknown> {
    const sanitized = sanitizeValue(value);
    return isPlainObject(sanitized) ? sanitized : {};
}

function sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !SECRET_KEY_PATTERN.test(key))
            .map(([key, nested]) => [key, sanitizeValue(nested)]),
    );
}

function hashStable(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (isPlainObject(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProofStatus(value: unknown): CireOperationalProofStatus | null {
    return typeof value === 'string' && CIRE_OPERATIONAL_PROOF_STATUSES.includes(value as CireOperationalProofStatus)
        ? value as CireOperationalProofStatus
        : null;
}

function isDuplicateError(error: { code?: string; message?: string }): boolean {
    return error.code === '23505' || /duplicate key/i.test(error.message ?? '');
}

function isMissingStorageError(error: { code?: string; message?: string }): boolean {
    return error.code === '42P01'
        || /schema cache/i.test(error.message ?? '')
        || /does not exist/i.test(error.message ?? '');
}

function compareIsoDesc(a: string, b: string): number {
    return new Date(b).getTime() - new Date(a).getTime();
}
