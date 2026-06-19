export const FEDERATION_ACTIVATION_STAGES = [
    'invited',
    'data_policy_review',
    'sandbox_connected',
    'secure_aggregation_ready',
    'active_node',
    'paused',
    'revoked',
] as const;

export const FEDERATION_ACTIVATION_STATUSES = [
    'pending',
    'ready',
    'active',
    'blocked',
    'revoked',
] as const;

export const FEDERATION_NODE_KINDS = [
    'clinic',
    'reference_lab',
    'university',
    'ngo',
    'government',
    'public_health',
    'research_network',
    'sandbox',
] as const;

export const FEDERATION_DEPLOYMENT_ENVIRONMENTS = [
    'sandbox',
    'staging',
    'production',
] as const;

export const FEDERATION_DATA_POLICY_STATUSES = [
    'not_reviewed',
    'approved',
    'needs_review',
    'rejected',
] as const;

export const FEDERATION_ATTESTATION_STATUSES = [
    'not_attested',
    'self_attested',
    'verified',
    'rejected',
] as const;

export const FEDERATION_SECURE_AGGREGATION_STATUSES = [
    'not_ready',
    'keys_registered',
    'masking_ready',
    'ready',
] as const;

export const FEDERATION_HEARTBEAT_STATUSES = [
    'not_seen',
    'healthy',
    'stale',
    'failed',
] as const;

export type FederationActivationStage = typeof FEDERATION_ACTIVATION_STAGES[number];
export type FederationActivationStatus = typeof FEDERATION_ACTIVATION_STATUSES[number];
export type FederationNodeKind = typeof FEDERATION_NODE_KINDS[number];
export type FederationDeploymentEnvironment = typeof FEDERATION_DEPLOYMENT_ENVIRONMENTS[number];
export type FederationDataPolicyStatus = typeof FEDERATION_DATA_POLICY_STATUSES[number];
export type FederationAttestationStatus = typeof FEDERATION_ATTESTATION_STATUSES[number];
export type FederationSecureAggregationStatus = typeof FEDERATION_SECURE_AGGREGATION_STATUSES[number];
export type FederationHeartbeatStatus = typeof FEDERATION_HEARTBEAT_STATUSES[number];

export interface FederationActivationAssessmentInput {
    activation_stage?: FederationActivationStage | null;
    deployment_environment?: FederationDeploymentEnvironment | null;
    data_policy_status?: FederationDataPolicyStatus | null;
    attestation_status?: FederationAttestationStatus | null;
    secure_aggregation_status?: FederationSecureAggregationStatus | null;
    heartbeat_status?: FederationHeartbeatStatus | null;
    last_heartbeat_at?: string | null;
    blockers?: string[] | null;
    now?: Date;
}

export interface FederationActivationAssessment {
    activation_status: FederationActivationStatus;
    readiness_score: number;
    blockers: string[];
    next_required_step: string | null;
    readiness: {
        data_policy_approved: boolean;
        attestation_verified: boolean;
        secure_aggregation_ready: boolean;
        heartbeat_fresh: boolean;
        production_ready: boolean;
    };
}

export interface FederationActivationEventRow {
    tenant_id?: string | null;
    request_id?: string | null;
    federation_key: string;
    partner_ref: string;
    membership_id?: string | null;
    node_kind?: FederationNodeKind | string | null;
    deployment_environment?: FederationDeploymentEnvironment | string | null;
    data_residency_region?: string | null;
    activation_stage: FederationActivationStage | string;
    activation_status: FederationActivationStatus | string;
    data_policy_status: FederationDataPolicyStatus | string;
    attestation_status: FederationAttestationStatus | string;
    secure_aggregation_status: FederationSecureAggregationStatus | string;
    heartbeat_status: FederationHeartbeatStatus | string;
    last_heartbeat_at?: string | null;
    readiness_score?: number | string | null;
    blockers?: string[] | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface FederationActivationSummary {
    total_nodes: number;
    active_nodes: number;
    ready_nodes: number;
    blocked_nodes: number;
    pending_nodes: number;
    revoked_nodes: number;
    policy_approved_nodes: number;
    attested_nodes: number;
    secure_ready_nodes: number;
    heartbeat_healthy_nodes: number;
    production_nodes: number;
    average_readiness_score: number;
    latest_observed_at: string | null;
    federation_keys: string[];
    top_blockers: Array<{ blocker: string; count: number }>;
}

const HEARTBEAT_FRESH_HOURS = 48;

export function buildFederationActivationAssessment(
    input: FederationActivationAssessmentInput,
): FederationActivationAssessment {
    const stage = input.activation_stage ?? 'invited';
    const environment = input.deployment_environment ?? 'sandbox';
    const dataPolicy = input.data_policy_status ?? 'not_reviewed';
    const attestation = input.attestation_status ?? 'not_attested';
    const secureAggregation = input.secure_aggregation_status ?? 'not_ready';
    const heartbeat = input.heartbeat_status ?? 'not_seen';
    const now = input.now ?? new Date();

    const heartbeatFresh = isFreshHeartbeat(heartbeat, input.last_heartbeat_at, now);
    const dataPolicyApproved = dataPolicy === 'approved';
    const attestationVerified = attestation === 'verified';
    const secureAggregationReady = secureAggregation === 'ready';
    const productionReady = environment === 'production' || stage === 'active_node';

    const blockers = normalizeBlockers(input.blockers);
    if (!dataPolicyApproved) blockers.push(`data_policy_${dataPolicy}`);
    if (!attestationVerified) blockers.push(`attestation_${attestation}`);
    if (!secureAggregationReady) blockers.push(`secure_aggregation_${secureAggregation}`);
    if (!heartbeatFresh) blockers.push(`heartbeat_${heartbeat}`);
    if (stage === 'paused') blockers.push('activation_paused');
    if (stage === 'revoked') blockers.push('activation_revoked');

    const uniqueBlockers = uniqueStrings(blockers);
    const rejected = dataPolicy === 'rejected' || attestation === 'rejected';
    const failed = heartbeat === 'failed';
    const revoked = stage === 'revoked';

    let score = 0;
    score += dataPolicyScore(dataPolicy);
    score += attestationScore(attestation);
    score += secureAggregationScore(secureAggregation);
    score += heartbeatScore(heartbeat, heartbeatFresh);
    score += stageScore(stage);
    score += environmentScore(environment);
    if (uniqueBlockers.length === 0) score += 0.05;
    if (stage === 'paused') score = Math.min(score, 0.45);
    if (rejected || failed) score = Math.min(score, 0.35);
    if (revoked) score = 0;

    const readinessScore = roundScore(score);
    const activationStatus = resolveActivationStatus({
        revoked,
        rejected,
        failed,
        blockers: uniqueBlockers,
        readinessScore,
        stage,
        dataPolicyApproved,
        attestationVerified,
        secureAggregationReady,
        heartbeatFresh,
    });

    return {
        activation_status: activationStatus,
        readiness_score: readinessScore,
        blockers: uniqueBlockers,
        next_required_step: resolveNextRequiredStep({
            activationStatus,
            dataPolicyApproved,
            attestationVerified,
            secureAggregationReady,
            heartbeatFresh,
            productionReady,
        }),
        readiness: {
            data_policy_approved: dataPolicyApproved,
            attestation_verified: attestationVerified,
            secure_aggregation_ready: secureAggregationReady,
            heartbeat_fresh: heartbeatFresh,
            production_ready: productionReady,
        },
    };
}

export function summarizeFederationActivation(rows: FederationActivationEventRow[]): FederationActivationSummary {
    const latestRows = latestFederationActivationRows(rows);
    const readinessScores = latestRows
        .map((row) => readNumber(row.readiness_score))
        .filter((value): value is number => value != null);
    const blockerCounts = new Map<string, number>();

    for (const row of latestRows) {
        for (const blocker of normalizeBlockers(row.blockers)) {
            blockerCounts.set(blocker, (blockerCounts.get(blocker) ?? 0) + 1);
        }
    }

    return {
        total_nodes: latestRows.length,
        active_nodes: latestRows.filter((row) => row.activation_status === 'active').length,
        ready_nodes: latestRows.filter((row) => row.activation_status === 'ready').length,
        blocked_nodes: latestRows.filter((row) => row.activation_status === 'blocked').length,
        pending_nodes: latestRows.filter((row) => row.activation_status === 'pending').length,
        revoked_nodes: latestRows.filter((row) => row.activation_status === 'revoked').length,
        policy_approved_nodes: latestRows.filter((row) => row.data_policy_status === 'approved').length,
        attested_nodes: latestRows.filter((row) => row.attestation_status === 'verified').length,
        secure_ready_nodes: latestRows.filter((row) => row.secure_aggregation_status === 'ready').length,
        heartbeat_healthy_nodes: latestRows.filter((row) => row.heartbeat_status === 'healthy').length,
        production_nodes: latestRows.filter((row) => row.deployment_environment === 'production').length,
        average_readiness_score: readinessScores.length > 0
            ? roundScore(readinessScores.reduce((sum, value) => sum + value, 0) / readinessScores.length)
            : 0,
        latest_observed_at: latestTimestamp(latestRows),
        federation_keys: uniqueStrings(latestRows.map((row) => row.federation_key)),
        top_blockers: Array.from(blockerCounts.entries())
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 10)
            .map(([blocker, count]) => ({ blocker, count })),
    };
}

export function latestFederationActivationRows(rows: FederationActivationEventRow[]): FederationActivationEventRow[] {
    const latest = new Map<string, FederationActivationEventRow>();
    for (const row of rows) {
        const key = `${row.federation_key}:${row.partner_ref}`;
        const current = latest.get(key);
        if (!current || timestampMs(row) >= timestampMs(current)) {
            latest.set(key, row);
        }
    }
    return Array.from(latest.values()).sort((left, right) => timestampMs(right) - timestampMs(left));
}

export function normalizeFederationKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9:_-]{2,63}$/.test(normalized) ? normalized : null;
}

export function normalizeFederationRef(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9:_.@-]{2,127}$/.test(normalized) ? normalized : null;
}

export function normalizeBlockers(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return uniqueStrings(value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_'))
        .filter((entry) => entry.length > 0)
        .map((entry) => entry.slice(0, 96)));
}

function resolveActivationStatus(input: {
    revoked: boolean;
    rejected: boolean;
    failed: boolean;
    blockers: string[];
    readinessScore: number;
    stage: FederationActivationStage;
    dataPolicyApproved: boolean;
    attestationVerified: boolean;
    secureAggregationReady: boolean;
    heartbeatFresh: boolean;
}): FederationActivationStatus {
    if (input.revoked) return 'revoked';
    if (input.rejected || input.failed) return 'blocked';
    if (
        input.stage === 'active_node' &&
        input.readinessScore >= 0.9 &&
        input.dataPolicyApproved &&
        input.attestationVerified &&
        input.secureAggregationReady &&
        input.heartbeatFresh &&
        input.blockers.length === 0
    ) {
        return 'active';
    }
    if (
        input.readinessScore >= 0.72 &&
        input.dataPolicyApproved &&
        input.attestationVerified &&
        input.secureAggregationReady &&
        input.heartbeatFresh &&
        input.blockers.length === 0
    ) {
        return 'ready';
    }
    if (input.blockers.some((blocker) => blocker.includes('rejected') || blocker.includes('failed'))) {
        return 'blocked';
    }
    return 'pending';
}

function resolveNextRequiredStep(input: {
    activationStatus: FederationActivationStatus;
    dataPolicyApproved: boolean;
    attestationVerified: boolean;
    secureAggregationReady: boolean;
    heartbeatFresh: boolean;
    productionReady: boolean;
}): string | null {
    if (input.activationStatus === 'active' || input.activationStatus === 'revoked') return null;
    if (!input.dataPolicyApproved) return 'approve_data_policy';
    if (!input.attestationVerified) return 'verify_node_attestation';
    if (!input.secureAggregationReady) return 'register_secure_aggregation_keys';
    if (!input.heartbeatFresh) return 'restore_fresh_heartbeat';
    if (!input.productionReady) return 'promote_or_mark_active_node';
    return null;
}

function isFreshHeartbeat(status: FederationHeartbeatStatus, value: string | null | undefined, now: Date): boolean {
    if (status !== 'healthy' || !value) return false;
    const heartbeatMs = Date.parse(value);
    if (!Number.isFinite(heartbeatMs)) return false;
    const ageHours = (now.getTime() - heartbeatMs) / (60 * 60 * 1000);
    return ageHours >= 0 && ageHours <= HEARTBEAT_FRESH_HOURS;
}

function dataPolicyScore(status: FederationDataPolicyStatus): number {
    if (status === 'approved') return 0.22;
    if (status === 'needs_review') return 0.08;
    return 0;
}

function attestationScore(status: FederationAttestationStatus): number {
    if (status === 'verified') return 0.18;
    if (status === 'self_attested') return 0.1;
    return 0;
}

function secureAggregationScore(status: FederationSecureAggregationStatus): number {
    if (status === 'ready') return 0.22;
    if (status === 'masking_ready') return 0.16;
    if (status === 'keys_registered') return 0.1;
    return 0;
}

function heartbeatScore(status: FederationHeartbeatStatus, fresh: boolean): number {
    if (fresh) return 0.18;
    if (status === 'healthy') return 0.08;
    if (status === 'stale') return 0.04;
    return 0;
}

function stageScore(stage: FederationActivationStage): number {
    if (stage === 'active_node') return 0.1;
    if (stage === 'secure_aggregation_ready') return 0.07;
    if (stage === 'sandbox_connected') return 0.04;
    if (stage === 'data_policy_review') return 0.02;
    return 0;
}

function environmentScore(environment: FederationDeploymentEnvironment): number {
    if (environment === 'production') return 0.05;
    if (environment === 'staging') return 0.03;
    return 0.01;
}

function latestTimestamp(rows: FederationActivationEventRow[]): string | null {
    const latest = rows
        .map((row) => row.observed_at ?? row.created_at ?? null)
        .filter((value): value is string => value != null)
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    return latest ?? null;
}

function timestampMs(row: FederationActivationEventRow): number {
    const value = row.observed_at ?? row.created_at ?? null;
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function roundScore(value: number): number {
    return Math.max(0, Math.min(1, Math.round(value * 10_000) / 10_000));
}
