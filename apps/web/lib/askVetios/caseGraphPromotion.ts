import { createHash } from 'crypto';
import type { AskVetiosCaseGraphStatus } from '@/lib/askVetios/caseGraph';

export const ASK_VETIOS_CASE_GRAPH_PROMOTION_STATUSES = [
    'draft_not_ready',
    'needs_more_information',
    'review_required',
    'promoted_to_case',
    'linked_to_outcome',
    'rejected',
] as const;

export const ASK_VETIOS_CLINICIAN_CONFIRMATION_STATUSES = [
    'not_reviewed',
    'reviewed',
    'confirmed',
    'modified',
    'rejected',
] as const;

export const ASK_VETIOS_OUTCOME_LINKAGE_STATUSES = [
    'not_linked',
    'pending',
    'linked',
    'not_required',
] as const;

export const ASK_VETIOS_VALUE_CAPTURE_STATUSES = [
    'foundation',
    'operating',
    'defensible_candidate',
] as const;

export type AskVetiosCaseGraphPromotionStatus = typeof ASK_VETIOS_CASE_GRAPH_PROMOTION_STATUSES[number];
export type AskVetiosClinicianConfirmationStatus = typeof ASK_VETIOS_CLINICIAN_CONFIRMATION_STATUSES[number];
export type AskVetiosOutcomeLinkageStatus = typeof ASK_VETIOS_OUTCOME_LINKAGE_STATUSES[number];
export type AskVetiosValueCaptureStatus = typeof ASK_VETIOS_VALUE_CAPTURE_STATUSES[number];

export interface AskVetiosCaseGraphPromotionInput {
    ask_vetios_query_id?: string | null;
    clinical_case_id?: string | null;
    clinical_outcome_id?: string | null;
    specialist_review_event_id?: string | null;
    draft_key?: string | null;
    case_graph_status: AskVetiosCaseGraphStatus;
    clinician_confirmation_status: AskVetiosClinicianConfirmationStatus;
    readiness_score?: number | null;
    field_coverage?: Record<string, unknown> | null;
    promoted_fields?: string[] | null;
    missing_fields?: string[] | null;
    deidentified_case_graph_snapshot?: Record<string, unknown> | null;
    review_evidence?: Record<string, unknown> | null;
}

export interface AskVetiosCaseGraphPromotionAssessment {
    promotion_status: AskVetiosCaseGraphPromotionStatus;
    outcome_linkage_status: AskVetiosOutcomeLinkageStatus;
    value_capture_status: AskVetiosValueCaptureStatus;
    readiness_score: number;
    promoted_fields: string[];
    missing_fields: string[];
    provenance_hash: string;
    next_required_action: string | null;
}

export interface AskVetiosCaseGraphPromotionEventRow {
    promotion_status?: string | null;
    clinician_confirmation_status?: string | null;
    outcome_linkage_status?: string | null;
    value_capture_status?: string | null;
    readiness_score?: number | string | null;
    missing_fields?: string[] | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface AskVetiosCaseGraphPromotionAggregate {
    total_events: number;
    promoted_to_case: number;
    linked_to_outcome: number;
    rejected: number;
    review_required: number;
    defensible_candidates: number;
    average_readiness_score: number;
    latest_observed_at: string | null;
    top_missing_fields: Array<{ field: string; count: number }>;
}

const REVIEWED_CONFIRMATIONS = new Set<AskVetiosClinicianConfirmationStatus>([
    'reviewed',
    'confirmed',
    'modified',
]);

export function buildAskVetiosCaseGraphPromotionAssessment(
    input: AskVetiosCaseGraphPromotionInput,
): AskVetiosCaseGraphPromotionAssessment {
    const readinessScore = clampReadiness(input.readiness_score);
    const promotedFields = normalizeLabels(input.promoted_fields);
    const missingFields = normalizeLabels(input.missing_fields);
    const reviewed = REVIEWED_CONFIRMATIONS.has(input.clinician_confirmation_status);

    const promotionStatus = resolvePromotionStatus({
        caseGraphStatus: input.case_graph_status,
        clinicianConfirmationStatus: input.clinician_confirmation_status,
        readinessScore,
        missingFields,
        reviewed,
        clinicalCaseId: input.clinical_case_id,
        clinicalOutcomeId: input.clinical_outcome_id,
    });
    const outcomeLinkageStatus = resolveOutcomeLinkageStatus(
        input.case_graph_status,
        input.clinical_case_id,
        input.clinical_outcome_id,
    );
    const provenanceHash = buildPromotionProvenanceHash({
        ask_vetios_query_id: input.ask_vetios_query_id ?? null,
        clinical_case_id: input.clinical_case_id ?? null,
        clinical_outcome_id: input.clinical_outcome_id ?? null,
        specialist_review_event_id: input.specialist_review_event_id ?? null,
        draft_key: input.draft_key ?? null,
        case_graph_status: input.case_graph_status,
        clinician_confirmation_status: input.clinician_confirmation_status,
        readiness_score: readinessScore,
        promoted_fields: promotedFields,
        missing_fields: missingFields,
        field_coverage: input.field_coverage ?? {},
        deidentified_case_graph_snapshot: input.deidentified_case_graph_snapshot ?? {},
        review_evidence: input.review_evidence ?? {},
    });

    return {
        promotion_status: promotionStatus,
        outcome_linkage_status: outcomeLinkageStatus,
        value_capture_status: resolveValueCaptureStatus(promotionStatus, outcomeLinkageStatus, provenanceHash),
        readiness_score: readinessScore,
        promoted_fields: promotedFields,
        missing_fields: missingFields,
        provenance_hash: provenanceHash,
        next_required_action: resolveNextRequiredAction(promotionStatus, outcomeLinkageStatus),
    };
}

export function aggregateAskVetiosCaseGraphPromotionEvents(
    rows: AskVetiosCaseGraphPromotionEventRow[],
): AskVetiosCaseGraphPromotionAggregate {
    const missingCounts = new Map<string, number>();
    const readinessScores: number[] = [];
    for (const row of rows) {
        const score = readNumber(row.readiness_score);
        if (score != null) readinessScores.push(score);
        for (const field of normalizeLabels(row.missing_fields)) {
            missingCounts.set(field, (missingCounts.get(field) ?? 0) + 1);
        }
    }

    return {
        total_events: rows.length,
        promoted_to_case: rows.filter((row) => row.promotion_status === 'promoted_to_case').length,
        linked_to_outcome: rows.filter((row) => row.promotion_status === 'linked_to_outcome').length,
        rejected: rows.filter((row) => row.promotion_status === 'rejected').length,
        review_required: rows.filter((row) => row.promotion_status === 'review_required').length,
        defensible_candidates: rows.filter((row) => row.value_capture_status === 'defensible_candidate').length,
        average_readiness_score: readinessScores.length > 0
            ? Math.round((readinessScores.reduce((sum, value) => sum + value, 0) / readinessScores.length) * 100) / 100
            : 0,
        latest_observed_at: latestTimestamp(rows),
        top_missing_fields: Array.from(missingCounts.entries())
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 10)
            .map(([field, count]) => ({ field, count })),
    };
}

export function normalizePromotionReviewerRef(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9:_@.-]+/g, '_');
    return normalized.length > 0 ? normalized.slice(0, 160) : null;
}

function resolvePromotionStatus(input: {
    caseGraphStatus: AskVetiosCaseGraphStatus;
    clinicianConfirmationStatus: AskVetiosClinicianConfirmationStatus;
    readinessScore: number;
    missingFields: string[];
    reviewed: boolean;
    clinicalCaseId?: string | null;
    clinicalOutcomeId?: string | null;
}): AskVetiosCaseGraphPromotionStatus {
    if (input.clinicianConfirmationStatus === 'rejected') return 'rejected';
    if (input.caseGraphStatus === 'non_clinical') return 'draft_not_ready';
    if (input.caseGraphStatus !== 'ready_for_case_graph' || input.readinessScore < 55) {
        return input.missingFields.length > 0 ? 'needs_more_information' : 'draft_not_ready';
    }
    if (!input.reviewed) return 'review_required';
    if (input.clinicalOutcomeId) return 'linked_to_outcome';
    if (input.clinicalCaseId) return 'promoted_to_case';
    return 'review_required';
}

function resolveOutcomeLinkageStatus(
    caseGraphStatus: AskVetiosCaseGraphStatus,
    clinicalCaseId?: string | null,
    clinicalOutcomeId?: string | null,
): AskVetiosOutcomeLinkageStatus {
    if (caseGraphStatus === 'non_clinical') return 'not_required';
    if (clinicalOutcomeId) return 'linked';
    if (clinicalCaseId) return 'pending';
    return 'not_linked';
}

function resolveValueCaptureStatus(
    promotionStatus: AskVetiosCaseGraphPromotionStatus,
    outcomeLinkageStatus: AskVetiosOutcomeLinkageStatus,
    provenanceHash: string | null,
): AskVetiosValueCaptureStatus {
    if (promotionStatus === 'linked_to_outcome' && outcomeLinkageStatus === 'linked' && provenanceHash) {
        return 'defensible_candidate';
    }
    if (promotionStatus === 'promoted_to_case' || promotionStatus === 'linked_to_outcome') {
        return 'operating';
    }
    return 'foundation';
}

function resolveNextRequiredAction(
    promotionStatus: AskVetiosCaseGraphPromotionStatus,
    outcomeLinkageStatus: AskVetiosOutcomeLinkageStatus,
): string | null {
    if (promotionStatus === 'draft_not_ready' || promotionStatus === 'needs_more_information') {
        return 'complete_case_graph_fields';
    }
    if (promotionStatus === 'review_required') return 'clinician_review_and_confirmation';
    if (promotionStatus === 'promoted_to_case' && outcomeLinkageStatus === 'pending') {
        return 'capture_clinician_confirmed_outcome';
    }
    if (promotionStatus === 'linked_to_outcome') return null;
    if (promotionStatus === 'rejected') return 'retain_rejection_reason_and_do_not_train';
    return null;
}

function buildPromotionProvenanceHash(value: Record<string, unknown>): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function normalizeLabels(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const normalized = entry.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').slice(0, 96);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        labels.push(normalized);
    }
    return labels;
}

function clampReadiness(value: unknown): number {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100));
}

function latestTimestamp(rows: AskVetiosCaseGraphPromotionEventRow[]): string | null {
    return rows
        .map((row) => row.observed_at ?? row.created_at ?? null)
        .filter((value): value is string => typeof value === 'string')
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
