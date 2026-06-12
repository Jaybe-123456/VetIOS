import type { InferenceActionabilityGateResult } from './actionabilityGate';

type ReviewQueueSupabaseClient = {
    from: (table: string) => unknown;
};

type QueryResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;

export type InferenceReviewStatus = 'queued' | 'acknowledged' | 'resolved' | 'dismissed';
export type InferenceReviewSeverity = 'routine' | 'review' | 'urgent' | 'critical';

export interface InferenceReviewQueueEvent {
    id?: string;
    tenant_id?: string;
    inference_event_id: string;
    actionability_gate_event_id: string | null;
    request_id: string | null;
    case_id: string | null;
    review_status: InferenceReviewStatus;
    severity: InferenceReviewSeverity;
    review_reason: string;
    source: string;
    top_label: string | null;
    top_confidence: number;
    phi_hat: number;
    actionability_score: number;
    blockers: string[];
    warnings: string[];
    recommended_next_step: string | null;
    reviewer_note: string | null;
    created_by: string | null;
    metadata: Record<string, unknown>;
    created_at?: string;
}

export interface InferenceReviewQueueInput {
    tenantId: string;
    inferenceEventId: string;
    requestId?: string | null;
    caseId?: string | null;
    actionabilityGate?: InferenceActionabilityGateResult | null;
    actionabilityGateEventId?: string | null;
    reviewStatus: InferenceReviewStatus;
    severity?: InferenceReviewSeverity | null;
    reviewReason?: string | null;
    source?: string | null;
    reviewerNote?: string | null;
    createdBy?: string | null;
    metadata?: Record<string, unknown> | null;
}

const SELECT_COLUMNS = [
    'id',
    'tenant_id',
    'inference_event_id',
    'actionability_gate_event_id',
    'request_id',
    'case_id',
    'review_status',
    'severity',
    'review_reason',
    'source',
    'top_label',
    'top_confidence',
    'phi_hat',
    'actionability_score',
    'blockers',
    'warnings',
    'recommended_next_step',
    'reviewer_note',
    'created_by',
    'metadata',
    'created_at',
].join(', ');

export function shouldQueueActionabilityGate(gate: InferenceActionabilityGateResult | null | undefined): boolean {
    if (!gate) return false;
    return gate.decision !== 'actionable_with_confirmation'
        || gate.reliability_badge === 'SUPPRESSED'
        || gate.abstain_recommendation
        || gate.blockers.length > 0;
}

export function reviewSeverityFromActionabilityGate(
    gate: InferenceActionabilityGateResult | null | undefined,
): InferenceReviewSeverity {
    if (!gate) return 'review';
    if (gate.decision === 'suppressed' || gate.reliability_badge === 'SUPPRESSED') return 'critical';
    if (gate.decision === 'hold_for_evidence' || gate.abstain_recommendation || gate.contradiction_score >= 0.75) return 'urgent';
    if (gate.decision === 'review_before_action' || gate.blockers.length > 0 || gate.warnings.length > 0) return 'review';
    return 'routine';
}

export function reviewReasonFromActionabilityGate(
    gate: InferenceActionabilityGateResult | null | undefined,
): string {
    if (!gate) return 'Clinical review requested for this inference event.';
    if (gate.decision === 'suppressed') return 'Actionability gate suppressed automated use.';
    if (gate.decision === 'hold_for_evidence') return 'Actionability gate requires additional evidence before clinical action.';
    if (gate.decision === 'review_before_action') return 'Actionability gate requires clinician review before action.';
    if (gate.abstain_recommendation) return 'Inference engine recommended abstention.';
    if (gate.blockers.length > 0) return gate.blockers[0] ?? 'Actionability blockers require review.';
    return 'Actionable decision support still requires routine clinician confirmation.';
}

export async function recordInferenceReviewQueueEvent(
    client: ReviewQueueSupabaseClient,
    input: InferenceReviewQueueInput,
): Promise<{ data: InferenceReviewQueueEvent | null; error: string | null }> {
    const gate = input.actionabilityGate ?? null;
    const row = {
        tenant_id: input.tenantId,
        inference_event_id: input.inferenceEventId,
        actionability_gate_event_id: input.actionabilityGateEventId ?? gate?.id ?? null,
        request_id: input.requestId ?? null,
        case_id: input.caseId ?? null,
        review_status: input.reviewStatus,
        severity: input.severity ?? reviewSeverityFromActionabilityGate(gate),
        review_reason: normalizeText(input.reviewReason) ?? reviewReasonFromActionabilityGate(gate),
        source: normalizeText(input.source) ?? 'actionability_gate',
        top_label: gate?.top_label ?? null,
        top_confidence: roundMetric(gate?.top_confidence ?? 0),
        phi_hat: roundMetric(gate?.phi_hat ?? 0),
        actionability_score: roundMetric(gate?.actionability_score ?? 0),
        blockers: gate?.blockers ?? [],
        warnings: gate?.warnings ?? [],
        recommended_next_step: gate?.recommended_next_step ?? null,
        reviewer_note: normalizeText(input.reviewerNote),
        created_by: normalizeText(input.createdBy),
        metadata: {
            review_queue_version: 'vetios_inference_review_queue_v1',
            actionability_decision: gate?.decision ?? null,
            reliability_badge: gate?.reliability_badge ?? null,
            calibration_status: gate?.calibration_status ?? null,
            privacy_boundary: 'no raw clinical narrative, patient names, owner identifiers, contacts, or microchip IDs stored',
            ...(input.metadata ?? {}),
        },
    };

    const table = client.from('inference_review_queue_events') as {
        insert: (payload: Record<string, unknown>) => {
            select: (columns: string) => {
                single: () => QueryResult<Record<string, unknown>>;
            };
        };
    };

    const { data, error } = await table
        .insert(row)
        .select(SELECT_COLUMNS)
        .single();

    if (error) {
        console.warn(JSON.stringify({
            event: 'inference_review_queue_insert_failed',
            inference_event_id: input.inferenceEventId,
            error: error.message ?? 'unknown',
        }));
        return { data: null, error: error.message ?? 'inference_review_queue_insert_failed' };
    }

    if (!data) return { data: null, error: 'inference_review_queue_insert_returned_no_row' };
    return { data: normalizeReviewQueueRow(data), error: null };
}

export async function loadInferenceReviewQueueEvents(
    client: ReviewQueueSupabaseClient,
    tenantId: string,
    inferenceEventId: string,
    limit = 20,
): Promise<{ data: InferenceReviewQueueEvent[]; error: string | null }> {
    const table = client.from('inference_review_queue_events') as {
        select: (columns: string) => {
            eq: (column: string, value: string) => {
                eq: (column: string, value: string) => {
                    order: (column: string, options: { ascending: boolean }) => {
                        limit: (count: number) => QueryResult<Record<string, unknown>[]>;
                    };
                };
            };
        };
    };

    const { data, error } = await table
        .select(SELECT_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('inference_event_id', inferenceEventId)
        .order('created_at', { ascending: false })
        .limit(Math.max(1, Math.min(50, Math.trunc(limit))));

    if (error) return { data: [], error: error.message ?? 'inference_review_queue_lookup_failed' };
    return { data: Array.isArray(data) ? data.map(normalizeReviewQueueRow) : [], error: null };
}

export async function loadLatestInferenceReviewQueueEvent(
    client: ReviewQueueSupabaseClient,
    tenantId: string,
    inferenceEventId: string,
): Promise<{ data: InferenceReviewQueueEvent | null; error: string | null }> {
    const events = await loadInferenceReviewQueueEvents(client, tenantId, inferenceEventId, 1);
    if (events.error) return { data: null, error: events.error };
    return { data: events.data[0] ?? null, error: null };
}

function normalizeReviewQueueRow(row: Record<string, unknown>): InferenceReviewQueueEvent {
    return {
        id: readString(row.id) ?? undefined,
        tenant_id: readString(row.tenant_id) ?? undefined,
        inference_event_id: readString(row.inference_event_id) ?? '',
        actionability_gate_event_id: readString(row.actionability_gate_event_id),
        request_id: readString(row.request_id),
        case_id: readString(row.case_id),
        review_status: readReviewStatus(row.review_status),
        severity: readReviewSeverity(row.severity),
        review_reason: readString(row.review_reason) ?? 'Clinical review requested.',
        source: readString(row.source) ?? 'actionability_gate',
        top_label: readString(row.top_label),
        top_confidence: readNumber(row.top_confidence) ?? 0,
        phi_hat: readNumber(row.phi_hat) ?? 0,
        actionability_score: readNumber(row.actionability_score) ?? 0,
        blockers: readStringArray(row.blockers),
        warnings: readStringArray(row.warnings),
        recommended_next_step: readString(row.recommended_next_step),
        reviewer_note: readString(row.reviewer_note),
        created_by: readString(row.created_by),
        metadata: asRecord(row.metadata),
        created_at: readString(row.created_at) ?? undefined,
    };
}

function readReviewStatus(value: unknown): InferenceReviewStatus {
    return value === 'acknowledged' || value === 'resolved' || value === 'dismissed' ? value : 'queued';
}

function readReviewSeverity(value: unknown): InferenceReviewSeverity {
    return value === 'routine' || value === 'urgent' || value === 'critical' ? value : 'review';
}

function normalizeText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) ? number : null;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(readString).filter((entry): entry is string => Boolean(entry))
        : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function roundMetric(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}
