import { createHash } from 'crypto';

type MappingReviewSupabaseClient = {
    from: (table: string) => {
        insert: (payload: Record<string, unknown>) => {
            select: (columns: string) => {
                single: () => Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
            };
        };
    };
};

export type MappingReviewAction = 'queued' | 'approve' | 'reject' | 'request_external_validation' | 'deprecate';
export type MappingReviewStatus =
    | 'queued'
    | 'needs_review'
    | 'reviewer_verified'
    | 'needs_external_validation'
    | 'rejected'
    | 'deprecated';

export interface MappingReviewEventInput {
    tenantId?: string | null;
    requestId: string;
    sourceMappingEventId?: string | null;
    conditionKey: string;
    sourceKey: string;
    externalCodeSystem?: string | null;
    externalCode?: string | null;
    priorMappingStatus?: string | null;
    reviewAction: MappingReviewAction;
    reviewerRole?: string | null;
    reviewerRef?: string | null;
    reviewConfidence?: number | null;
    evidence?: Record<string, unknown>;
    observedAt?: string | null;
}

export interface ExternalValidationEventInput {
    tenantId?: string | null;
    requestId: string;
    sourceMappingEventId?: string | null;
    reviewEventId?: string | null;
    conditionKey: string;
    sourceKey: string;
    externalCodeSystem?: string | null;
    externalCode?: string | null;
    validationProvider: string;
    validationMethod:
        | 'external_review'
        | 'source_owner_confirmation'
        | 'licensed_terminology_audit'
        | 'public_health_authority_review'
        | 'third_party_conformance';
    validationStatus: 'pending' | 'externally_verified' | 'rejected' | 'insufficient_evidence' | 'expired';
    validationConfidence?: number | null;
    validationArtifactHash?: string | null;
    evidence?: Record<string, unknown>;
    observedAt?: string | null;
}

export function buildMappingReviewEventRow(input: MappingReviewEventInput): Record<string, unknown> {
    const status = reviewStatusForAction(input.reviewAction);
    const promoted = promotedStatusForReviewStatus(status);
    const packet = {
        action: input.reviewAction,
        evidence: input.evidence ?? {},
        clinical_boundary: 'Reviewer verification promotes a source mapping for ontology use only; it is not patient-level outcome truth.',
    };

    return {
        tenant_id: input.tenantId ?? null,
        request_id: input.requestId,
        source_mapping_event_id: input.sourceMappingEventId ?? null,
        condition_key: input.conditionKey,
        source_key: input.sourceKey,
        external_code_system: input.externalCodeSystem ?? null,
        external_code: input.externalCode ?? null,
        prior_mapping_status: input.priorMappingStatus ?? 'source_attested',
        review_status: status,
        review_action: input.reviewAction,
        reviewer_role: input.reviewerRole ?? null,
        reviewer_ref: input.reviewerRef ?? null,
        review_confidence: clamp01(input.reviewConfidence ?? defaultReviewConfidence(status)),
        promoted_mapping_status: promoted,
        review_packet: packet,
        blockers: buildReviewBlockers(status),
        warnings: [
            'Reviewer-verified mappings may support candidate expansion, but scoring remains gated by clinical validation and outcomes.',
        ],
        observed_at: input.observedAt ?? null,
    };
}

export function buildExternalValidationEventRow(input: ExternalValidationEventInput): Record<string, unknown> {
    const promoted = input.validationStatus === 'externally_verified'
        ? 'externally_verified'
        : input.validationStatus === 'rejected'
            ? 'rejected'
            : null;
    const packet = {
        validation_provider: input.validationProvider,
        validation_method: input.validationMethod,
        evidence: input.evidence ?? {},
        clinical_boundary: 'External validation verifies source mapping quality only; clinical inference still requires case evidence and outcomes.',
    };

    return {
        tenant_id: input.tenantId ?? null,
        request_id: input.requestId,
        source_mapping_event_id: input.sourceMappingEventId ?? null,
        review_event_id: input.reviewEventId ?? null,
        condition_key: input.conditionKey,
        source_key: input.sourceKey,
        external_code_system: input.externalCodeSystem ?? null,
        external_code: input.externalCode ?? null,
        validation_provider: input.validationProvider,
        validation_method: input.validationMethod,
        validation_status: input.validationStatus,
        validation_confidence: clamp01(input.validationConfidence ?? (input.validationStatus === 'externally_verified' ? 0.95 : 0)),
        promoted_mapping_status: promoted,
        validation_artifact_hash: input.validationArtifactHash ?? sha256(packet),
        validation_packet: packet,
        blockers: input.validationStatus === 'externally_verified' ? [] : ['external_validation_not_verified'],
        warnings: [
            'Externally verified ontology mappings still do not replace diagnostics, clinician judgment, or outcome-confirmed calibration.',
        ],
        observed_at: input.observedAt ?? null,
    };
}

export async function recordMappingReviewEvent(
    client: MappingReviewSupabaseClient,
    input: MappingReviewEventInput,
): Promise<{ id: string | null; error: string | null }> {
    const { data, error } = await client
        .from('global_condition_source_mapping_review_events')
        .insert(buildMappingReviewEventRow(input))
        .select('id')
        .single();

    if (error) return { id: null, error: error.message ?? 'mapping_review_insert_failed' };
    return { id: typeof data?.id === 'string' ? data.id : null, error: null };
}

export async function recordExternalValidationEvent(
    client: MappingReviewSupabaseClient,
    input: ExternalValidationEventInput,
): Promise<{ id: string | null; error: string | null }> {
    const { data, error } = await client
        .from('global_ontology_external_validation_events')
        .insert(buildExternalValidationEventRow(input))
        .select('id')
        .single();

    if (error) return { id: null, error: error.message ?? 'external_validation_insert_failed' };
    return { id: typeof data?.id === 'string' ? data.id : null, error: null };
}

function reviewStatusForAction(action: MappingReviewAction): MappingReviewStatus {
    if (action === 'approve') return 'reviewer_verified';
    if (action === 'reject') return 'rejected';
    if (action === 'request_external_validation') return 'needs_external_validation';
    if (action === 'deprecate') return 'deprecated';
    return 'queued';
}

function promotedStatusForReviewStatus(status: MappingReviewStatus) {
    if (status === 'reviewer_verified') return 'reviewer_verified';
    if (status === 'rejected') return 'rejected';
    if (status === 'deprecated') return 'deprecated';
    return null;
}

function defaultReviewConfidence(status: MappingReviewStatus) {
    if (status === 'reviewer_verified') return 0.9;
    if (status === 'needs_external_validation') return 0.7;
    return 0;
}

function buildReviewBlockers(status: MappingReviewStatus) {
    if (status === 'reviewer_verified') return ['external_validation_required_before_externally_verified'];
    if (status === 'needs_external_validation') return ['external_validation_required'];
    if (status === 'queued') return ['reviewer_verification_pending'];
    if (status === 'rejected') return ['mapping_rejected'];
    if (status === 'deprecated') return ['mapping_deprecated'];
    return [];
}

function clamp01(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function sha256(value: unknown) {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
