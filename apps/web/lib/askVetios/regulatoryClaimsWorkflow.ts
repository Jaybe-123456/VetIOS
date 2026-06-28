import { createHash } from 'crypto';
import type {
    AskVetiosRegulatoryClaimsStatus,
    AskVetiosRegulatoryReviewQueue,
} from '@/lib/askVetios/regulatoryClaims';

export type RegulatoryClaimApprovalAction =
    | 'cds_evidence_pack_review'
    | 'model_card_review'
    | 'ifu_review'
    | 'clinical_signoff'
    | 'legal_signoff'
    | 'external_attestation'
    | 'claim_rejection';

export type RegulatoryClaimApprovalStatus =
    | 'drafted'
    | 'approved'
    | 'rejected'
    | 'changes_requested'
    | 'attested'
    | 'superseded';

export type RegulatoryClaimReviewerRole =
    | 'clinician'
    | 'legal'
    | 'regulatory'
    | 'model_risk'
    | 'external_attestor'
    | 'admin';

export interface RegulatoryClaimReviewEventRow {
    id?: string | null;
    tenant_id?: string | null;
    request_id: string;
    ask_vetios_query_id?: string | null;
    review_queue: AskVetiosRegulatoryReviewQueue;
    claim_review_status: 'not_required' | 'ready_for_review' | 'pending' | 'blocked' | 'approved' | 'rejected';
    approval_status:
        | 'not_reviewed'
        | 'clinical_review_required'
        | 'legal_review_required'
        | 'external_attestation_required'
        | 'approved'
        | 'rejected';
    cds_evidence_pack_status: 'not_required' | 'incomplete' | 'complete';
    model_card_status: 'not_required' | 'draft_required' | 'drafted' | 'approved';
    ifu_status: 'not_required' | 'draft_required' | 'drafted' | 'approved';
    clinical_signoff_status: 'not_required' | 'pending' | 'approved' | 'rejected';
    legal_signoff_status: 'not_required' | 'pending' | 'approved' | 'rejected';
    regulatory_claims_status: AskVetiosRegulatoryClaimsStatus;
    regulatory_risk_level: 'low' | 'medium' | 'high';
    evidence_pack_hash: string;
    model_card_hash?: string | null;
    ifu_hash?: string | null;
    approval_packet_hash: string;
    blockers?: string[] | null;
    warnings?: string[] | null;
    next_actions?: string[] | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface RegulatoryClaimApprovalEventRow {
    id?: string | null;
    tenant_id?: string | null;
    request_id: string;
    claim_request_id: string;
    claim_review_event_id?: string | null;
    ask_vetios_query_id?: string | null;
    action_type: RegulatoryClaimApprovalAction;
    action_status: RegulatoryClaimApprovalStatus;
    reviewer_role: RegulatoryClaimReviewerRole;
    reviewer_ref_hash?: string | null;
    artifact_type?: 'cds_evidence_pack' | 'model_card' | 'ifu' | 'approval_packet' | 'external_attestation' | null;
    artifact_hash?: string | null;
    approval_packet_hash: string;
    review_note_hash?: string | null;
    blockers?: string[] | null;
    warnings?: string[] | null;
    next_actions?: string[] | null;
    evidence?: Record<string, unknown> | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface RegulatoryClaimApprovalEventDraft {
    tenant_id: string | null;
    request_id: string;
    claim_request_id: string;
    claim_review_event_id: string | null;
    ask_vetios_query_id: string | null;
    action_type: RegulatoryClaimApprovalAction;
    action_status: RegulatoryClaimApprovalStatus;
    reviewer_role: RegulatoryClaimReviewerRole;
    reviewer_ref_hash: string | null;
    artifact_type: RegulatoryClaimApprovalEventRow['artifact_type'];
    artifact_hash: string | null;
    approval_packet_hash: string;
    review_note_hash: string | null;
    blockers: string[];
    warnings: string[];
    next_actions: string[];
    evidence: Record<string, unknown>;
    observed_at: string;
}

export interface RegulatoryClaimOperationsSnapshot {
    schema_version: 'ask-vetios-regulatory-operations-v1';
    generated_at: string;
    tenant_id: string | null;
    window_days: number;
    totals: {
        total_claim_reviews: number;
        active_queue_items: number;
        ready_for_review: number;
        pending: number;
        blocked: number;
        high_risk: number;
        restricted_claims: number;
        clinical_signoff_pending: number;
        legal_signoff_pending: number;
        model_card_drafts_required: number;
        ifu_drafts_required: number;
        external_attestation_required: number;
        approval_events: number;
    };
    review_queue_counts: Record<string, number>;
    claim_status_counts: Record<string, number>;
    approval_status_counts: Record<string, number>;
    artifact_work: {
        cds_evidence_pack_incomplete: number;
        model_card_draft_required: number;
        ifu_draft_required: number;
        model_card_approved: number;
        ifu_approved: number;
    };
    blocker_counts: Record<string, number>;
    next_actions: string[];
    items: RegulatoryClaimQueueItem[];
    evidence: {
        raw_prompt_stored: false;
        raw_output_stored: false;
        legal_advice_stored: false;
        source_event_count: number;
        approval_event_count: number;
        source_digest: string;
    };
}

export interface RegulatoryClaimQueueItem {
    claim_review_event_id: string | null;
    claim_request_id: string;
    ask_vetios_query_id: string | null;
    review_queue: AskVetiosRegulatoryReviewQueue;
    claim_review_status: RegulatoryClaimReviewEventRow['claim_review_status'];
    approval_status: RegulatoryClaimReviewEventRow['approval_status'];
    regulatory_claims_status: AskVetiosRegulatoryClaimsStatus;
    regulatory_risk_level: RegulatoryClaimReviewEventRow['regulatory_risk_level'];
    cds_evidence_pack_status: RegulatoryClaimReviewEventRow['cds_evidence_pack_status'];
    model_card_status: RegulatoryClaimReviewEventRow['model_card_status'];
    ifu_status: RegulatoryClaimReviewEventRow['ifu_status'];
    clinical_signoff_status: RegulatoryClaimReviewEventRow['clinical_signoff_status'];
    legal_signoff_status: RegulatoryClaimReviewEventRow['legal_signoff_status'];
    latest_approvals: Partial<Record<RegulatoryClaimApprovalAction, {
        action_status: RegulatoryClaimApprovalStatus;
        reviewer_role: RegulatoryClaimReviewerRole;
        artifact_hash: string | null;
        approval_packet_hash: string;
        observed_at: string | null;
    }>>;
    required_actions: string[];
    blockers: string[];
    warnings: string[];
    next_actions: string[];
    hashes: {
        evidence_pack_hash: string;
        model_card_hash: string | null;
        ifu_hash: string | null;
        approval_packet_hash: string;
    };
    observed_at: string | null;
}

export function buildRegulatoryClaimApprovalEventDraft(input: {
    tenantId?: string | null;
    eventRequestId: string;
    claimRequestId: string;
    claimReviewEventId?: string | null;
    askVetiosQueryId?: string | null;
    actionType: RegulatoryClaimApprovalAction;
    actionStatus: RegulatoryClaimApprovalStatus;
    reviewerRole: RegulatoryClaimReviewerRole;
    reviewerRef?: string | null;
    artifactType?: RegulatoryClaimApprovalEventRow['artifact_type'];
    artifactHash?: string | null;
    reviewNote?: string | null;
    blockers?: string[];
    warnings?: string[];
    nextActions?: string[];
    evidence?: Record<string, unknown>;
    observedAt?: Date;
}): RegulatoryClaimApprovalEventDraft {
    const reviewerRefHash = input.reviewerRef ? hashString(input.reviewerRef) : null;
    const reviewNoteHash = input.reviewNote ? hashString(input.reviewNote) : null;
    const observedAt = (input.observedAt ?? new Date()).toISOString();
    const approvalPacket = {
        claim_request_id: input.claimRequestId,
        claim_review_event_id: input.claimReviewEventId ?? null,
        ask_vetios_query_id: input.askVetiosQueryId ?? null,
        action_type: input.actionType,
        action_status: input.actionStatus,
        reviewer_role: input.reviewerRole,
        reviewer_ref_hash: reviewerRefHash,
        artifact_type: input.artifactType ?? null,
        artifact_hash: input.artifactHash ?? null,
        review_note_hash: reviewNoteHash,
        observed_at: observedAt,
    };

    return {
        tenant_id: input.tenantId ?? null,
        request_id: input.eventRequestId,
        claim_request_id: input.claimRequestId,
        claim_review_event_id: input.claimReviewEventId ?? null,
        ask_vetios_query_id: input.askVetiosQueryId ?? null,
        action_type: input.actionType,
        action_status: input.actionStatus,
        reviewer_role: input.reviewerRole,
        reviewer_ref_hash: reviewerRefHash,
        artifact_type: input.artifactType ?? null,
        artifact_hash: input.artifactHash ?? null,
        approval_packet_hash: hashJson(approvalPacket),
        review_note_hash: reviewNoteHash,
        blockers: unique(input.blockers ?? []),
        warnings: unique(input.warnings ?? []),
        next_actions: unique(input.nextActions ?? buildApprovalNextActions(input.actionType, input.actionStatus)),
        evidence: {
            raw_prompt_stored: false,
            raw_output_stored: false,
            legal_advice_stored: false,
            raw_review_note_stored: false,
            approval_packet_hash: hashJson(approvalPacket),
            ...(input.evidence ?? {}),
        },
        observed_at: observedAt,
    };
}

export function buildRegulatoryClaimOperationsSnapshot(input: {
    tenantId?: string | null;
    reviews: RegulatoryClaimReviewEventRow[];
    approvals?: RegulatoryClaimApprovalEventRow[];
    windowDays?: number;
    generatedAt?: Date;
    limit?: number;
}): RegulatoryClaimOperationsSnapshot {
    const reviews = [...input.reviews]
        .sort((left, right) => timestamp(right.observed_at ?? right.created_at) - timestamp(left.observed_at ?? left.created_at));
    const approvals = [...(input.approvals ?? [])]
        .sort((left, right) => timestamp(right.observed_at ?? right.created_at) - timestamp(left.observed_at ?? left.created_at));
    const approvalsByClaim = groupApprovalsByClaim(approvals);
    const items = reviews
        .filter((row) => row.review_queue !== 'none')
        .slice(0, input.limit ?? 100)
        .map((row) => buildQueueItem(row, approvalsByClaim.get(row.request_id) ?? []));

    const totals = {
        total_claim_reviews: reviews.length,
        active_queue_items: items.length,
        ready_for_review: items.filter((item) => item.claim_review_status === 'ready_for_review').length,
        pending: items.filter((item) => item.claim_review_status === 'pending').length,
        blocked: items.filter((item) => item.claim_review_status === 'blocked').length,
        high_risk: items.filter((item) => item.regulatory_risk_level === 'high').length,
        restricted_claims: items.filter((item) => item.regulatory_claims_status === 'restricted_claims').length,
        clinical_signoff_pending: items.filter((item) => item.clinical_signoff_status === 'pending').length,
        legal_signoff_pending: items.filter((item) => item.legal_signoff_status === 'pending').length,
        model_card_drafts_required: items.filter((item) => item.model_card_status === 'draft_required').length,
        ifu_drafts_required: items.filter((item) => item.ifu_status === 'draft_required').length,
        external_attestation_required: items.filter((item) => item.approval_status === 'external_attestation_required').length,
        approval_events: approvals.length,
    };

    return {
        schema_version: 'ask-vetios-regulatory-operations-v1',
        generated_at: (input.generatedAt ?? new Date()).toISOString(),
        tenant_id: input.tenantId ?? null,
        window_days: input.windowDays ?? 30,
        totals,
        review_queue_counts: countBy(items, (item) => item.review_queue),
        claim_status_counts: countBy(items, (item) => item.claim_review_status),
        approval_status_counts: countBy(items, (item) => item.approval_status),
        artifact_work: {
            cds_evidence_pack_incomplete: items.filter((item) => item.cds_evidence_pack_status === 'incomplete').length,
            model_card_draft_required: totals.model_card_drafts_required,
            ifu_draft_required: totals.ifu_drafts_required,
            model_card_approved: items.filter((item) => item.latest_approvals.model_card_review?.action_status === 'approved').length,
            ifu_approved: items.filter((item) => item.latest_approvals.ifu_review?.action_status === 'approved').length,
        },
        blocker_counts: countStrings(items.flatMap((item) => item.blockers)),
        next_actions: buildOperationsNextActions(items, totals),
        items,
        evidence: {
            raw_prompt_stored: false,
            raw_output_stored: false,
            legal_advice_stored: false,
            source_event_count: reviews.length,
            approval_event_count: approvals.length,
            source_digest: hashJson({
                reviews: reviews.map((row) => [
                    row.id ?? null,
                    row.request_id,
                    row.approval_packet_hash,
                    row.observed_at ?? row.created_at ?? null,
                ]),
                approvals: approvals.map((row) => [
                    row.id ?? null,
                    row.request_id,
                    row.claim_request_id,
                    row.approval_packet_hash,
                    row.observed_at ?? row.created_at ?? null,
                ]),
            }),
        },
    };
}

function buildQueueItem(
    row: RegulatoryClaimReviewEventRow,
    approvals: RegulatoryClaimApprovalEventRow[],
): RegulatoryClaimQueueItem {
    const latestApprovals = latestApprovalByAction(approvals);
    const requiredActions = unique([
        ...(row.cds_evidence_pack_status === 'incomplete' ? ['complete_cds_evidence_pack'] : []),
        ...(row.model_card_status === 'draft_required' && latestApprovals.model_card_review?.action_status !== 'approved'
            ? ['draft_or_approve_model_card']
            : []),
        ...(row.ifu_status === 'draft_required' && latestApprovals.ifu_review?.action_status !== 'approved'
            ? ['draft_or_approve_ifu']
            : []),
        ...(row.clinical_signoff_status === 'pending' && latestApprovals.clinical_signoff?.action_status !== 'approved'
            ? ['clinical_signoff']
            : []),
        ...(row.legal_signoff_status === 'pending' && latestApprovals.legal_signoff?.action_status !== 'approved'
            ? ['legal_signoff']
            : []),
        ...(row.approval_status === 'external_attestation_required'
            && latestApprovals.external_attestation?.action_status !== 'attested'
            ? ['external_attestation']
            : []),
    ]);

    return {
        claim_review_event_id: row.id ?? null,
        claim_request_id: row.request_id,
        ask_vetios_query_id: row.ask_vetios_query_id ?? null,
        review_queue: row.review_queue,
        claim_review_status: row.claim_review_status,
        approval_status: row.approval_status,
        regulatory_claims_status: row.regulatory_claims_status,
        regulatory_risk_level: row.regulatory_risk_level,
        cds_evidence_pack_status: row.cds_evidence_pack_status,
        model_card_status: row.model_card_status,
        ifu_status: row.ifu_status,
        clinical_signoff_status: row.clinical_signoff_status,
        legal_signoff_status: row.legal_signoff_status,
        latest_approvals: latestApprovals,
        required_actions: requiredActions,
        blockers: unique(row.blockers ?? []),
        warnings: unique(row.warnings ?? []),
        next_actions: unique([...(row.next_actions ?? []), ...requiredActions]),
        hashes: {
            evidence_pack_hash: row.evidence_pack_hash,
            model_card_hash: row.model_card_hash ?? null,
            ifu_hash: row.ifu_hash ?? null,
            approval_packet_hash: row.approval_packet_hash,
        },
        observed_at: row.observed_at ?? row.created_at ?? null,
    };
}

function groupApprovalsByClaim(
    approvals: RegulatoryClaimApprovalEventRow[],
): Map<string, RegulatoryClaimApprovalEventRow[]> {
    const map = new Map<string, RegulatoryClaimApprovalEventRow[]>();
    for (const approval of approvals) {
        const group = map.get(approval.claim_request_id) ?? [];
        group.push(approval);
        map.set(approval.claim_request_id, group);
    }
    return map;
}

function latestApprovalByAction(
    approvals: RegulatoryClaimApprovalEventRow[],
): RegulatoryClaimQueueItem['latest_approvals'] {
    const latest: RegulatoryClaimQueueItem['latest_approvals'] = {};
    for (const approval of approvals) {
        if (latest[approval.action_type]) continue;
        latest[approval.action_type] = {
            action_status: approval.action_status,
            reviewer_role: approval.reviewer_role,
            artifact_hash: approval.artifact_hash ?? null,
            approval_packet_hash: approval.approval_packet_hash,
            observed_at: approval.observed_at ?? approval.created_at ?? null,
        };
    }
    return latest;
}

function buildApprovalNextActions(
    actionType: RegulatoryClaimApprovalAction,
    actionStatus: RegulatoryClaimApprovalStatus,
): string[] {
    if (actionStatus === 'rejected') return ['keep_claim_blocked', 'revise_claim_language'];
    if (actionStatus === 'changes_requested') return ['revise_evidence_pack', 'resubmit_for_review'];
    if (actionType === 'model_card_review' && actionStatus === 'drafted') return ['route_model_card_for_approval'];
    if (actionType === 'ifu_review' && actionStatus === 'drafted') return ['route_ifu_for_approval'];
    if (actionStatus === 'approved' || actionStatus === 'attested') return ['refresh_regulatory_claim_queue'];
    return ['continue_regulatory_review'];
}

function buildOperationsNextActions(
    items: RegulatoryClaimQueueItem[],
    totals: RegulatoryClaimOperationsSnapshot['totals'],
): string[] {
    return unique([
        ...(totals.blocked > 0 ? ['resolve_blocked_claims'] : []),
        ...(totals.clinical_signoff_pending > 0 ? ['assign_clinical_reviewers'] : []),
        ...(totals.legal_signoff_pending > 0 ? ['assign_legal_reviewers'] : []),
        ...(totals.model_card_drafts_required > 0 ? ['generate_model_card_drafts'] : []),
        ...(totals.ifu_drafts_required > 0 ? ['generate_ifu_drafts'] : []),
        ...(totals.external_attestation_required > 0 ? ['request_external_attestation'] : []),
        ...(items.some((item) => item.required_actions.includes('complete_cds_evidence_pack'))
            ? ['complete_cds_reviewability_evidence']
            : []),
    ]);
}

function countBy<T>(items: T[], read: (item: T) => string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of items) {
        const key = read(item);
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}

function countStrings(values: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const value of values) {
        counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
}

function timestamp(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 20);
}

function hashString(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
        .join(',')}}`;
}
