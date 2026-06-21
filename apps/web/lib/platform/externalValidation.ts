import { createHash } from 'crypto';

export const EXTERNAL_VALIDATION_TARGET_TYPES = [
    'moat_completion',
    'case_graph_promotion',
    'amr_stewardship',
    'specialist_review',
    'federation_activation',
    'clinical_outcome',
    'retrieval_corpus',
    'model_trust',
    'partner_dataset',
    'other',
] as const;

export const EXTERNAL_VALIDATION_ATTESTOR_KINDS = [
    'clinic',
    'specialist',
    'reference_lab',
    'university',
    'public_health',
    'ngo',
    'government',
    'research_partner',
    'auditor',
    'internal_reviewer',
] as const;

export const EXTERNAL_VALIDATION_SCOPES = [
    'outcome_provenance',
    'data_quality',
    'clinical_accuracy',
    'amr_signal',
    'federation_readiness',
    'security_control',
    'regulatory_claims',
    'retrieval_grounding',
    'workflow_integration',
    'general',
] as const;

export const EXTERNAL_VALIDATION_ATTESTATION_STATUSES = [
    'submitted',
    'accepted',
    'rejected',
    'expired',
    'revoked',
] as const;

export const EXTERNAL_VALIDATION_VERIFICATION_STATUSES = [
    'unsigned',
    'signature_pending',
    'signature_verified',
    'reviewer_verified',
    'failed',
] as const;

export const EXTERNAL_VALIDATION_EVIDENCE_GRADES = [
    'none',
    'source_attested',
    'reviewer_verified',
    'externally_verified',
] as const;

export type ExternalValidationTargetType = typeof EXTERNAL_VALIDATION_TARGET_TYPES[number];
export type ExternalValidationAttestorKind = typeof EXTERNAL_VALIDATION_ATTESTOR_KINDS[number];
export type ExternalValidationScope = typeof EXTERNAL_VALIDATION_SCOPES[number];
export type ExternalValidationAttestationStatus = typeof EXTERNAL_VALIDATION_ATTESTATION_STATUSES[number];
export type ExternalValidationVerificationStatus = typeof EXTERNAL_VALIDATION_VERIFICATION_STATUSES[number];
export type ExternalValidationEvidenceGrade = typeof EXTERNAL_VALIDATION_EVIDENCE_GRADES[number];

export interface ExternalValidationAssessmentInput {
    validation_target_type: ExternalValidationTargetType;
    validation_target_ref: string;
    moat_key?: string | null;
    attestor_kind: ExternalValidationAttestorKind;
    attestor_ref: string;
    validation_scope: ExternalValidationScope;
    attestation_status: ExternalValidationAttestationStatus;
    verification_status: ExternalValidationVerificationStatus;
    validation_score?: number | null;
    signed_payload_hash?: string | null;
    signature_hash?: string | null;
    signing_key_fingerprint?: string | null;
    evidence?: Record<string, unknown> | null;
}

export interface ExternalValidationAssessment {
    evidence_grade: ExternalValidationEvidenceGrade;
    validation_score: number;
    normalized_target_ref: string;
    normalized_attestor_ref: string;
    normalized_moat_key: string | null;
    signed_payload_hash: string;
    signature_material_present: boolean;
    defensibility_signal: boolean;
    next_required_action: string | null;
}

export interface ExternalValidationEventRow {
    validation_target_type?: string | null;
    moat_key?: string | null;
    attestor_kind?: string | null;
    validation_scope?: string | null;
    attestation_status?: string | null;
    verification_status?: string | null;
    evidence_grade?: string | null;
    validation_score?: number | string | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface ExternalValidationAggregate {
    total_events: number;
    accepted_events: number;
    rejected_events: number;
    verified_events: number;
    externally_verified_events: number;
    defensibility_signals: number;
    average_validation_score: number;
    latest_observed_at: string | null;
    by_moat: Array<{ moat_key: string; count: number; externally_verified: number }>;
    by_scope: Array<{ validation_scope: string; count: number }>;
}

const VERIFIED_STATUSES = new Set<ExternalValidationVerificationStatus>([
    'signature_verified',
    'reviewer_verified',
]);

export function buildExternalValidationAssessment(
    input: ExternalValidationAssessmentInput,
): ExternalValidationAssessment {
    const validationScore = clampScore(input.validation_score);
    const normalizedTargetRef = normalizeRef(input.validation_target_ref);
    const normalizedAttestorRef = normalizeRef(input.attestor_ref);
    const normalizedMoatKey = normalizeMoatKey(input.moat_key);
    const signedPayloadHash = normalizeHash(input.signed_payload_hash)
        ?? hashStablePayload({
            validation_target_type: input.validation_target_type,
            validation_target_ref: normalizedTargetRef,
            moat_key: normalizedMoatKey,
            attestor_kind: input.attestor_kind,
            attestor_ref: normalizedAttestorRef,
            validation_scope: input.validation_scope,
            evidence: input.evidence ?? {},
        });
    const signatureMaterialPresent = Boolean(
        normalizeHash(input.signature_hash)
        && normalizeOptionalText(input.signing_key_fingerprint),
    );
    const evidenceGrade = resolveEvidenceGrade({
        attestationStatus: input.attestation_status,
        verificationStatus: input.verification_status,
        validationScore,
        signatureMaterialPresent,
    });

    return {
        evidence_grade: evidenceGrade,
        validation_score: validationScore,
        normalized_target_ref: normalizedTargetRef,
        normalized_attestor_ref: normalizedAttestorRef,
        normalized_moat_key: normalizedMoatKey,
        signed_payload_hash: signedPayloadHash,
        signature_material_present: signatureMaterialPresent,
        defensibility_signal: evidenceGrade === 'externally_verified',
        next_required_action: resolveNextRequiredAction({
            attestationStatus: input.attestation_status,
            verificationStatus: input.verification_status,
            validationScore,
            signatureMaterialPresent,
            evidenceGrade,
        }),
    };
}

export function aggregateExternalValidationEvents(
    rows: ExternalValidationEventRow[],
): ExternalValidationAggregate {
    const scoreValues = rows
        .map((row) => readNumber(row.validation_score))
        .filter((value): value is number => value != null);
    const moatCounts = new Map<string, { count: number; externally_verified: number }>();
    const scopeCounts = new Map<string, number>();

    for (const row of rows) {
        const moatKey = normalizeMoatKey(row.moat_key) ?? 'unscoped';
        const moat = moatCounts.get(moatKey) ?? { count: 0, externally_verified: 0 };
        moat.count += 1;
        if (row.evidence_grade === 'externally_verified') moat.externally_verified += 1;
        moatCounts.set(moatKey, moat);

        const scope = typeof row.validation_scope === 'string' ? row.validation_scope : 'general';
        scopeCounts.set(scope, (scopeCounts.get(scope) ?? 0) + 1);
    }

    return {
        total_events: rows.length,
        accepted_events: rows.filter((row) => row.attestation_status === 'accepted').length,
        rejected_events: rows.filter((row) => row.attestation_status === 'rejected').length,
        verified_events: rows.filter((row) => row.verification_status === 'signature_verified' || row.verification_status === 'reviewer_verified').length,
        externally_verified_events: rows.filter((row) => row.evidence_grade === 'externally_verified').length,
        defensibility_signals: rows.filter((row) => row.evidence_grade === 'externally_verified' && row.attestation_status === 'accepted').length,
        average_validation_score: scoreValues.length > 0
            ? Math.round((scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length) * 10_000) / 10_000
            : 0,
        latest_observed_at: latestTimestamp(rows),
        by_moat: Array.from(moatCounts.entries())
            .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
            .slice(0, 20)
            .map(([moat_key, counts]) => ({ moat_key, ...counts })),
        by_scope: Array.from(scopeCounts.entries())
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 20)
            .map(([validation_scope, count]) => ({ validation_scope, count })),
    };
}

function resolveEvidenceGrade(input: {
    attestationStatus: ExternalValidationAttestationStatus;
    verificationStatus: ExternalValidationVerificationStatus;
    validationScore: number;
    signatureMaterialPresent: boolean;
}): ExternalValidationEvidenceGrade {
    if (input.attestationStatus === 'rejected' || input.attestationStatus === 'revoked' || input.verificationStatus === 'failed') {
        return 'none';
    }
    if (
        input.attestationStatus === 'accepted'
        && VERIFIED_STATUSES.has(input.verificationStatus)
        && input.signatureMaterialPresent
        && input.validationScore >= 0.8
    ) {
        return 'externally_verified';
    }
    if (input.attestationStatus === 'accepted' && VERIFIED_STATUSES.has(input.verificationStatus)) {
        return 'reviewer_verified';
    }
    if (input.attestationStatus === 'submitted' || input.attestationStatus === 'accepted') {
        return 'source_attested';
    }
    return 'none';
}

function resolveNextRequiredAction(input: {
    attestationStatus: ExternalValidationAttestationStatus;
    verificationStatus: ExternalValidationVerificationStatus;
    validationScore: number;
    signatureMaterialPresent: boolean;
    evidenceGrade: ExternalValidationEvidenceGrade;
}): string | null {
    if (input.evidenceGrade === 'externally_verified') return null;
    if (input.attestationStatus !== 'accepted') return 'accept_or_reject_external_validation';
    if (!VERIFIED_STATUSES.has(input.verificationStatus)) return 'verify_attestation_signature_or_reviewer';
    if (!input.signatureMaterialPresent) return 'attach_signature_hash_and_key_fingerprint';
    if (input.validationScore < 0.8) return 'raise_validation_score_or_keep_as_reviewer_verified';
    return null;
}

function normalizeRef(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9:_@./-]+/g, '_').slice(0, 180);
    if (!normalized) {
        throw new Error('validation_target_ref and attestor_ref must be non-empty after normalization.');
    }
    return normalized;
}

function normalizeMoatKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').slice(0, 96);
    return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeHash(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function clampScore(value: unknown): number {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return Math.max(0, Math.min(1, Math.round(numeric * 10_000) / 10_000));
}

function hashStablePayload(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function latestTimestamp(rows: ExternalValidationEventRow[]): string | null {
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
