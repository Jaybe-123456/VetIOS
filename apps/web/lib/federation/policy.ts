export type FederationEnrollmentMode = 'coordinator_only' | 'allow_list' | 'open';

export interface FederationGovernancePolicy {
    enrollment_mode: FederationEnrollmentMode;
    auto_enroll_enabled: boolean;
    approved_tenant_ids: string[];
    auto_publish_snapshots: boolean;
    auto_run_rounds: boolean;
    round_interval_hours: number;
    snapshot_max_age_hours: number;
    minimum_participants: number;
    minimum_benchmark_pass_rate: number | null;
    maximum_calibration_avg_ece: number | null;
    allow_shadow_participants: boolean;
}

export interface FederationAutomationState {
    last_automation_run_at: string | null;
    last_automation_error: string | null;
    last_round_started_at: string | null;
    next_round_due_at: string | null;
}

export interface FederationGovernanceState {
    policy: FederationGovernancePolicy;
    automation: FederationAutomationState;
}

export const DEFAULT_FEDERATION_GOVERNANCE_POLICY: FederationGovernancePolicy = {
    enrollment_mode: 'coordinator_only',
    auto_enroll_enabled: false,
    approved_tenant_ids: [],
    auto_publish_snapshots: true,
    auto_run_rounds: false,
    round_interval_hours: 24,
    snapshot_max_age_hours: 24,
    minimum_participants: 2,
    minimum_benchmark_pass_rate: null,
    maximum_calibration_avg_ece: null,
    allow_shadow_participants: false,
};

export const DEFAULT_FEDERATION_AUTOMATION_STATE: FederationAutomationState = {
    last_automation_run_at: null,
    last_automation_error: null,
    last_round_started_at: null,
    next_round_due_at: null,
};

export function readFederationGovernanceState(metadata: Record<string, unknown> | null | undefined): FederationGovernanceState {
    const source = asRecord(metadata);
    const policy = asRecord(source.federation_policy);
    const automation = asRecord(source.federation_automation);

    return {
        policy: {
            enrollment_mode: normalizeEnrollmentMode(policy.enrollment_mode),
            auto_enroll_enabled: readBoolean(policy.auto_enroll_enabled, DEFAULT_FEDERATION_GOVERNANCE_POLICY.auto_enroll_enabled),
            approved_tenant_ids: normalizeTenantIdList(policy.approved_tenant_ids),
            auto_publish_snapshots: readBoolean(policy.auto_publish_snapshots, DEFAULT_FEDERATION_GOVERNANCE_POLICY.auto_publish_snapshots),
            auto_run_rounds: readBoolean(policy.auto_run_rounds, DEFAULT_FEDERATION_GOVERNANCE_POLICY.auto_run_rounds),
            round_interval_hours: readPositiveInteger(policy.round_interval_hours, DEFAULT_FEDERATION_GOVERNANCE_POLICY.round_interval_hours),
            snapshot_max_age_hours: readPositiveInteger(policy.snapshot_max_age_hours, DEFAULT_FEDERATION_GOVERNANCE_POLICY.snapshot_max_age_hours),
            minimum_participants: readPositiveInteger(policy.minimum_participants, DEFAULT_FEDERATION_GOVERNANCE_POLICY.minimum_participants),
            minimum_benchmark_pass_rate: normalizeFraction(policy.minimum_benchmark_pass_rate),
            maximum_calibration_avg_ece: normalizeFraction(policy.maximum_calibration_avg_ece),
            allow_shadow_participants: readBoolean(policy.allow_shadow_participants, DEFAULT_FEDERATION_GOVERNANCE_POLICY.allow_shadow_participants),
        },
        automation: {
            last_automation_run_at: readTimestamp(automation.last_automation_run_at),
            last_automation_error: readString(automation.last_automation_error),
            last_round_started_at: readTimestamp(automation.last_round_started_at),
            next_round_due_at: readTimestamp(automation.next_round_due_at),
        },
    };
}

export function patchFederationGovernanceMetadata(
    metadata: Record<string, unknown> | null | undefined,
    patch: {
        policy?: Partial<FederationGovernancePolicy>;
        automation?: Partial<FederationAutomationState>;
    },
): Record<string, unknown> {
    const current = readFederationGovernanceState(metadata);
    const nextPolicy = {
        ...current.policy,
        ...(patch.policy ?? {}),
        approved_tenant_ids: normalizeTenantIdList(patch.policy?.approved_tenant_ids ?? current.policy.approved_tenant_ids),
    };
    const nextAutomation = {
        ...current.automation,
        ...(patch.automation ?? {}),
    };

    return {
        ...asRecord(metadata),
        federation_policy: {
            enrollment_mode: normalizeEnrollmentMode(nextPolicy.enrollment_mode),
            auto_enroll_enabled: Boolean(nextPolicy.auto_enroll_enabled),
            approved_tenant_ids: normalizeTenantIdList(nextPolicy.approved_tenant_ids),
            auto_publish_snapshots: Boolean(nextPolicy.auto_publish_snapshots),
            auto_run_rounds: Boolean(nextPolicy.auto_run_rounds),
            round_interval_hours: readPositiveInteger(nextPolicy.round_interval_hours, DEFAULT_FEDERATION_GOVERNANCE_POLICY.round_interval_hours),
            snapshot_max_age_hours: readPositiveInteger(nextPolicy.snapshot_max_age_hours, DEFAULT_FEDERATION_GOVERNANCE_POLICY.snapshot_max_age_hours),
            minimum_participants: readPositiveInteger(nextPolicy.minimum_participants, DEFAULT_FEDERATION_GOVERNANCE_POLICY.minimum_participants),
            minimum_benchmark_pass_rate: normalizeFraction(nextPolicy.minimum_benchmark_pass_rate),
            maximum_calibration_avg_ece: normalizeFraction(nextPolicy.maximum_calibration_avg_ece),
            allow_shadow_participants: Boolean(nextPolicy.allow_shadow_participants),
        },
        federation_automation: {
            last_automation_run_at: readTimestamp(nextAutomation.last_automation_run_at),
            last_automation_error: readString(nextAutomation.last_automation_error),
            last_round_started_at: readTimestamp(nextAutomation.last_round_started_at),
            next_round_due_at: readTimestamp(nextAutomation.next_round_due_at),
        },
    };
}

export function computeNextFederationRoundDueAt(
    lastRoundStartedAt: string | null,
    policy: FederationGovernancePolicy,
    now = new Date(),
): string {
    const anchor = lastRoundStartedAt ? new Date(lastRoundStartedAt) : now;
    if (Number.isNaN(anchor.getTime())) {
        return new Date(now.getTime() + (policy.round_interval_hours * 60 * 60 * 1000)).toISOString();
    }

    return new Date(anchor.getTime() + (policy.round_interval_hours * 60 * 60 * 1000)).toISOString();
}

export function isFederationRoundDue(
    automation: FederationAutomationState,
    now = new Date(),
): boolean {
    if (!automation.next_round_due_at) {
        return true;
    }

    const dueAt = new Date(automation.next_round_due_at);
    return !Number.isNaN(dueAt.getTime()) && dueAt.getTime() <= now.getTime();
}

export function normalizeTenantIdList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return Array.from(new Set(value
            .map((entry) => readString(entry))
            .filter((entry): entry is string => entry != null)));
    }

    if (typeof value === 'string') {
        return Array.from(new Set(value
            .split(/[\s,]+/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)));
    }

    return [];
}

function normalizeEnrollmentMode(value: unknown): FederationEnrollmentMode {
    if (value === 'allow_list' || value === 'open') {
        return value;
    }
    return DEFAULT_FEDERATION_GOVERNANCE_POLICY.enrollment_mode;
}

function normalizeFraction(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value < 0) return null;
        if (value > 1 && value <= 100) return value / 100;
        return value <= 1 ? value : null;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return null;
        }
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return null;
        }
        if (parsed > 1 && parsed <= 100) {
            return parsed / 100;
        }
        return parsed <= 1 ? parsed : null;
    }

    return null;
}

function readPositiveInteger(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }

    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed);
        }
    }

    return fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return fallback;
}

function readTimestamp(value: unknown): string | null {
    const text = readString(value);
    if (!text) {
        return null;
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
