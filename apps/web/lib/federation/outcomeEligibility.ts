export const FEDERATED_OUTCOME_ELIGIBILITY_STATUSES = [
    'eligible',
    'insufficient_evidence',
    'blocked',
    'expired',
] as const;

export type FederatedOutcomeEligibilityStatus = typeof FEDERATED_OUTCOME_ELIGIBILITY_STATUSES[number];

export interface FederatedOutcomeEligibilityMinimums {
    minimum_required_rows: number;
    minimum_provenance_rows: number;
    minimum_trust_scored_rows: number;
    minimum_external_validations: number;
    minimum_trust_score: number;
}

export interface FederatedOutcomeEligibilityInput extends Partial<FederatedOutcomeEligibilityMinimums> {
    outcome_confirmed_rows?: number | string | null;
    lab_confirmed_rows?: number | string | null;
    expert_reviewed_rows?: number | string | null;
    synthetic_rows_excluded?: number | string | null;
    consented_network_learning_rows?: number | string | null;
    provenance_verified_rows?: number | string | null;
    trust_scored_rows?: number | string | null;
    amr_outcome_linked_rows?: number | string | null;
    external_validation_events?: number | string | null;
    average_trust_score?: number | string | null;
    eligibility_status?: string | null;
    blockers?: string[] | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface FederatedOutcomeEligibilityAssessment {
    eligibility_status: FederatedOutcomeEligibilityStatus;
    eligibility_score: number;
    blockers: string[];
    counts: {
        outcome_confirmed_rows: number;
        lab_confirmed_rows: number;
        expert_reviewed_rows: number;
        synthetic_rows_excluded: number;
        consented_network_learning_rows: number;
        provenance_verified_rows: number;
        trust_scored_rows: number;
        amr_outcome_linked_rows: number;
        external_validation_events: number;
        average_trust_score: number;
    };
    minimums: FederatedOutcomeEligibilityMinimums;
    latest_signal_at: string | null;
}

export interface FederatedOutcomeEligibilityDigest extends FederatedOutcomeEligibilityAssessment {
    present: boolean;
}

export interface FederatedOutcomeEligibilityAggregate {
    total_snapshots: number;
    eligible_snapshots: number;
    blocked_snapshots: number;
    insufficient_snapshots: number;
    expired_snapshots: number;
    total_outcome_confirmed_rows: number;
    total_consented_rows: number;
    total_provenance_verified_rows: number;
    total_trust_scored_rows: number;
    total_external_validations: number;
    latest_signal_at: string | null;
    top_blockers: Array<{ blocker: string; count: number }>;
}

export const DEFAULT_FEDERATED_OUTCOME_ELIGIBILITY_MINIMUMS: FederatedOutcomeEligibilityMinimums = {
    minimum_required_rows: 20,
    minimum_provenance_rows: 20,
    minimum_trust_scored_rows: 20,
    minimum_external_validations: 0,
    minimum_trust_score: 0.7,
};

export function buildFederatedOutcomeEligibilityAssessment(
    input: FederatedOutcomeEligibilityInput,
): FederatedOutcomeEligibilityAssessment {
    const minimums = normalizeMinimums(input);
    const counts = {
        outcome_confirmed_rows: readCount(input.outcome_confirmed_rows),
        lab_confirmed_rows: readCount(input.lab_confirmed_rows),
        expert_reviewed_rows: readCount(input.expert_reviewed_rows),
        synthetic_rows_excluded: readCount(input.synthetic_rows_excluded),
        consented_network_learning_rows: readCount(input.consented_network_learning_rows),
        provenance_verified_rows: readCount(input.provenance_verified_rows),
        trust_scored_rows: readCount(input.trust_scored_rows),
        amr_outcome_linked_rows: readCount(input.amr_outcome_linked_rows),
        external_validation_events: readCount(input.external_validation_events),
        average_trust_score: readScore(input.average_trust_score),
    };

    const blockers = new Set(normalizeBlockers(input.blockers));
    if (counts.outcome_confirmed_rows < minimums.minimum_required_rows) {
        blockers.add('outcome_confirmed_rows_below_minimum');
    }
    if (counts.consented_network_learning_rows < minimums.minimum_required_rows) {
        blockers.add('network_learning_consent_rows_below_minimum');
    }
    if (counts.provenance_verified_rows < minimums.minimum_provenance_rows) {
        blockers.add('provenance_verified_rows_below_minimum');
    }
    if (counts.trust_scored_rows < minimums.minimum_trust_scored_rows) {
        blockers.add('trust_scored_rows_below_minimum');
    }
    if (counts.external_validation_events < minimums.minimum_external_validations) {
        blockers.add('external_validation_events_below_minimum');
    }
    if (counts.trust_scored_rows > 0 && counts.average_trust_score < minimums.minimum_trust_score) {
        blockers.add('average_trust_score_below_minimum');
    }
    if (input.eligibility_status === 'blocked') blockers.add('eligibility_snapshot_blocked');
    if (input.eligibility_status === 'expired') blockers.add('eligibility_snapshot_expired');

    const eligibilityStatus = resolveEligibilityStatus(input.eligibility_status, blockers);

    return {
        eligibility_status: eligibilityStatus,
        eligibility_score: scoreEligibility(counts, minimums, blockers.size),
        blockers: Array.from(blockers).sort(),
        counts,
        minimums,
        latest_signal_at: latestIso([input.observed_at, input.created_at]),
    };
}

export function buildFederatedOutcomeEligibilityDigest(
    input: FederatedOutcomeEligibilityInput | null | undefined,
): FederatedOutcomeEligibilityDigest {
    if (!input) {
        return {
            present: false,
            ...buildFederatedOutcomeEligibilityAssessment({
                blockers: ['federated_outcome_eligibility_snapshot_missing'],
                eligibility_status: 'insufficient_evidence',
            }),
        };
    }

    return {
        present: true,
        ...buildFederatedOutcomeEligibilityAssessment(input),
    };
}

export function evaluateFederatedOutcomeEligibilityForRound(
    input: FederatedOutcomeEligibilityInput | null | undefined,
): string[] {
    const digest = buildFederatedOutcomeEligibilityDigest(input);
    if (!digest.present) return ['federated outcome eligibility snapshot missing'];
    if (digest.eligibility_status !== 'eligible') {
        return digest.blockers.length > 0
            ? digest.blockers.map((blocker) => `federated outcome eligibility: ${blocker.replaceAll('_', ' ')}`)
            : ['federated outcome eligibility is not eligible'];
    }
    return [];
}

export function aggregateFederatedOutcomeEligibilitySnapshots(
    rows: FederatedOutcomeEligibilityInput[],
): FederatedOutcomeEligibilityAggregate {
    const digests = rows.map(buildFederatedOutcomeEligibilityDigest);
    const blockerCounts = new Map<string, number>();
    for (const digest of digests) {
        for (const blocker of digest.blockers) {
            blockerCounts.set(blocker, (blockerCounts.get(blocker) ?? 0) + 1);
        }
    }

    return {
        total_snapshots: digests.length,
        eligible_snapshots: digests.filter((digest) => digest.eligibility_status === 'eligible').length,
        blocked_snapshots: digests.filter((digest) => digest.eligibility_status === 'blocked').length,
        insufficient_snapshots: digests.filter((digest) => digest.eligibility_status === 'insufficient_evidence').length,
        expired_snapshots: digests.filter((digest) => digest.eligibility_status === 'expired').length,
        total_outcome_confirmed_rows: sum(digests.map((digest) => digest.counts.outcome_confirmed_rows)),
        total_consented_rows: sum(digests.map((digest) => digest.counts.consented_network_learning_rows)),
        total_provenance_verified_rows: sum(digests.map((digest) => digest.counts.provenance_verified_rows)),
        total_trust_scored_rows: sum(digests.map((digest) => digest.counts.trust_scored_rows)),
        total_external_validations: sum(digests.map((digest) => digest.counts.external_validation_events)),
        latest_signal_at: latestIso(digests.map((digest) => digest.latest_signal_at)),
        top_blockers: Array.from(blockerCounts.entries())
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 10)
            .map(([blocker, count]) => ({ blocker, count })),
    };
}

export function normalizeFederatedOutcomeEligibilityStatus(value: unknown): FederatedOutcomeEligibilityStatus {
    return FEDERATED_OUTCOME_ELIGIBILITY_STATUSES.includes(value as FederatedOutcomeEligibilityStatus)
        ? value as FederatedOutcomeEligibilityStatus
        : 'insufficient_evidence';
}

function resolveEligibilityStatus(
    inputStatus: string | null | undefined,
    blockers: Set<string>,
): FederatedOutcomeEligibilityStatus {
    const normalized = normalizeFederatedOutcomeEligibilityStatus(inputStatus);
    if (normalized === 'blocked' || normalized === 'expired') return normalized;
    return blockers.size === 0 ? 'eligible' : 'insufficient_evidence';
}

function normalizeMinimums(input: Partial<FederatedOutcomeEligibilityMinimums>): FederatedOutcomeEligibilityMinimums {
    return {
        minimum_required_rows: readCount(input.minimum_required_rows, DEFAULT_FEDERATED_OUTCOME_ELIGIBILITY_MINIMUMS.minimum_required_rows),
        minimum_provenance_rows: readCount(input.minimum_provenance_rows, DEFAULT_FEDERATED_OUTCOME_ELIGIBILITY_MINIMUMS.minimum_provenance_rows),
        minimum_trust_scored_rows: readCount(input.minimum_trust_scored_rows, DEFAULT_FEDERATED_OUTCOME_ELIGIBILITY_MINIMUMS.minimum_trust_scored_rows),
        minimum_external_validations: readCount(input.minimum_external_validations, DEFAULT_FEDERATED_OUTCOME_ELIGIBILITY_MINIMUMS.minimum_external_validations),
        minimum_trust_score: readScore(input.minimum_trust_score, DEFAULT_FEDERATED_OUTCOME_ELIGIBILITY_MINIMUMS.minimum_trust_score),
    };
}

function scoreEligibility(
    counts: FederatedOutcomeEligibilityAssessment['counts'],
    minimums: FederatedOutcomeEligibilityMinimums,
    blockerCount: number,
): number {
    let score = 0;
    score += ratio(counts.outcome_confirmed_rows, minimums.minimum_required_rows) * 0.25;
    score += ratio(counts.consented_network_learning_rows, minimums.minimum_required_rows) * 0.2;
    score += ratio(counts.provenance_verified_rows, minimums.minimum_provenance_rows) * 0.2;
    score += ratio(counts.trust_scored_rows, minimums.minimum_trust_scored_rows) * 0.2;
    score += ratio(counts.average_trust_score, minimums.minimum_trust_score) * 0.1;
    score += minimums.minimum_external_validations > 0
        ? ratio(counts.external_validation_events, minimums.minimum_external_validations) * 0.05
        : 0.05;
    if (blockerCount > 0) score = Math.min(score, 0.74);
    return roundScore(score);
}

function ratio(value: number, minimum: number): number {
    if (minimum <= 0) return 1;
    return Math.max(0, Math.min(1, value / minimum));
}

function readCount(value: unknown, fallback = 0): number {
    const numeric = readNumber(value);
    return numeric == null ? fallback : Math.max(0, Math.floor(numeric));
}

function readScore(value: unknown, fallback = 0): number {
    const numeric = readNumber(value);
    return numeric == null ? fallback : Math.max(0, Math.min(1, numeric));
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeBlockers(value: string[] | null | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((entry) => typeof entry === 'string' ? entry.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_') : '')
        .filter(Boolean)));
}

function latestIso(values: Array<string | null | undefined>): string | null {
    return values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function roundScore(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}
