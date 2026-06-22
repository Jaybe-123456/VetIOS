import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FEDERATION_NODE_ATTESTATION_EVENTS as FEDERATION_NODE_ATTESTATION_TABLE } from '@/lib/db/schemaContracts';
import type { FederationRoundNodeTaskType } from '@/lib/federation/nodeProtocol';

export const FEDERATION_NODE_ATTESTATION_EVENT_KINDS = [
    'registration',
    'provenance',
    'key_rotation',
    'renewal',
    'revocation',
    'incident_response',
] as const;

export const FEDERATION_NODE_ATTESTATION_STATUSES = [
    'submitted',
    'accepted',
    'rejected',
    'revoked',
    'expired',
] as const;

export const FEDERATION_NODE_ATTESTATION_VERIFICATION_STATUSES = [
    'unsigned',
    'signature_pending',
    'signature_verified',
    'reviewer_verified',
    'failed',
] as const;

export const FEDERATION_NODE_ATTESTATION_ENVIRONMENTS = ['sandbox', 'staging', 'production'] as const;

export type FederationNodeAttestationEventKind = typeof FEDERATION_NODE_ATTESTATION_EVENT_KINDS[number];
export type FederationNodeAttestationStatus = typeof FEDERATION_NODE_ATTESTATION_STATUSES[number];
export type FederationNodeAttestationVerificationStatus = typeof FEDERATION_NODE_ATTESTATION_VERIFICATION_STATUSES[number];
export type FederationNodeAttestationEnvironment = typeof FEDERATION_NODE_ATTESTATION_ENVIRONMENTS[number];

export interface FederationNodeIdentityRef {
    tenantId: string;
    federationKey: string;
    nodeRef: string;
    partnerRef: string;
}

export interface FederationNodeAttestationInput {
    tenantId: string;
    federationKey: string;
    nodeRef: string;
    partnerRef?: string | null;
    requestId?: string | null;
    membershipId?: string | null;
    attestationEvent?: FederationNodeAttestationEventKind | string | null;
    attestationStatus?: FederationNodeAttestationStatus | string | null;
    verificationStatus?: FederationNodeAttestationVerificationStatus | string | null;
    deploymentEnvironment?: FederationNodeAttestationEnvironment | string | null;
    softwareVersion?: string | null;
    softwareArtifactHash?: string | null;
    buildProvenanceHash?: string | null;
    sbomHash?: string | null;
    signedPayloadHash?: string | null;
    signatureAlgorithm?: string | null;
    signatureHash?: string | null;
    signingKeyFingerprint?: string | null;
    transparencyLogRef?: string | null;
    allowedTaskTypes?: string[] | null;
    expiresAt?: string | null;
    blockers?: string[] | null;
    evidence?: Record<string, unknown> | null;
    observedAt?: string | null;
}

export interface FederationNodeAttestationRow {
    id: string;
    tenant_id: string;
    request_id: string;
    federation_key: string;
    partner_ref: string;
    node_ref: string;
    membership_id: string | null;
    attestation_event: FederationNodeAttestationEventKind;
    attestation_status: FederationNodeAttestationStatus;
    verification_status: FederationNodeAttestationVerificationStatus;
    deployment_environment: FederationNodeAttestationEnvironment;
    software_version: string | null;
    software_artifact_hash: string | null;
    build_provenance_hash: string | null;
    sbom_hash: string | null;
    signed_payload_hash: string | null;
    signature_algorithm: string | null;
    signature_hash: string | null;
    signing_key_fingerprint: string | null;
    transparency_log_ref: string | null;
    attestation_score: number;
    allowed_task_types: string[];
    expires_at: string | null;
    blockers: string[];
    evidence: Record<string, unknown>;
    observed_at: string | null;
    created_at: string | null;
}

export interface FederationNodeAttestationAssessmentInput {
    attestation_status?: FederationNodeAttestationStatus | string | null;
    verification_status?: FederationNodeAttestationVerificationStatus | string | null;
    deployment_environment?: FederationNodeAttestationEnvironment | string | null;
    software_version?: string | null;
    software_artifact_hash?: string | null;
    build_provenance_hash?: string | null;
    sbom_hash?: string | null;
    signed_payload_hash?: string | null;
    signature_hash?: string | null;
    signing_key_fingerprint?: string | null;
    allowed_task_types?: string[] | null;
    expires_at?: string | null;
    blockers?: string[] | null;
    task_type?: FederationRoundNodeTaskType | string | null;
    now?: Date;
}

export interface FederationNodeAttestationAssessment {
    contribution_allowed: boolean;
    attestation_score: number;
    blockers: string[];
    next_required_action: string | null;
    signals: {
        accepted: boolean;
        verified: boolean;
        signature_verified: boolean;
        signature_material_present: boolean;
        artifact_pinned: boolean;
        build_provenance_present: boolean;
        sbom_present: boolean;
        software_version_present: boolean;
        signing_key_present: boolean;
        not_expired: boolean;
        task_allowed: boolean;
        production_signature_ready: boolean;
    };
}

const VERIFIED_STATUSES = new Set<FederationNodeAttestationVerificationStatus>([
    'signature_verified',
    'reviewer_verified',
]);
const CONTRIBUTION_SCORE_THRESHOLD = 0.8;

export function buildFederationNodeAttestationAssessment(
    input: FederationNodeAttestationAssessmentInput,
): FederationNodeAttestationAssessment {
    const attestationStatus = normalizeAttestationStatus(input.attestation_status);
    const verificationStatus = normalizeVerificationStatus(input.verification_status);
    const deploymentEnvironment = normalizeEnvironment(input.deployment_environment);
    const expiresAt = normalizeIso(input.expires_at);
    const now = input.now ?? new Date();
    const notExpired = !expiresAt || Date.parse(expiresAt) > now.getTime();
    const signatureMaterialPresent = Boolean(normalizeHash(input.signed_payload_hash)
        && normalizeHash(input.signature_hash)
        && normalizeOptionalText(input.signing_key_fingerprint, 160));
    const signatureVerified = verificationStatus === 'signature_verified' && signatureMaterialPresent;
    const verified = VERIFIED_STATUSES.has(verificationStatus) && (verificationStatus === 'reviewer_verified' || signatureMaterialPresent);
    const taskAllowed = isTaskAllowed(input.allowed_task_types, input.task_type);
    const productionSignatureReady = deploymentEnvironment !== 'production' || signatureVerified;

    const blockers = new Set(normalizeBlockers(input.blockers));
    if (attestationStatus !== 'accepted') blockers.add(`attestation_${attestationStatus}`);
    if (attestationStatus === 'rejected' || attestationStatus === 'revoked' || attestationStatus === 'expired') {
        blockers.add('node_attestation_not_active');
    }
    if (verificationStatus === 'failed') blockers.add('attestation_verification_failed');
    if (!verified) blockers.add('attestation_not_verified');
    if (!notExpired) blockers.add('attestation_expired');
    if (!normalizeHash(input.software_artifact_hash)) blockers.add('software_artifact_hash_missing');
    if (!normalizeOptionalText(input.software_version, 80)) blockers.add('software_version_missing');
    if (!normalizeOptionalText(input.signing_key_fingerprint, 160)) blockers.add('signing_key_fingerprint_missing');
    if (!taskAllowed) blockers.add('task_type_not_allowed_by_node_attestation');
    if (!productionSignatureReady) blockers.add('production_node_signature_verification_required');

    const score = scoreAttestation({
        accepted: attestationStatus === 'accepted',
        verified,
        notExpired,
        artifactPinned: Boolean(normalizeHash(input.software_artifact_hash)),
        buildProvenancePresent: Boolean(normalizeHash(input.build_provenance_hash)),
        sbomPresent: Boolean(normalizeHash(input.sbom_hash)),
        signatureMaterialPresent,
        softwareVersionPresent: Boolean(normalizeOptionalText(input.software_version, 80)),
        signingKeyPresent: Boolean(normalizeOptionalText(input.signing_key_fingerprint, 160)),
        taskAllowed,
        hardBlocked: attestationStatus === 'rejected'
            || attestationStatus === 'revoked'
            || attestationStatus === 'expired'
            || verificationStatus === 'failed',
        blockerCount: blockers.size,
    });

    return {
        contribution_allowed: blockers.size === 0 && score >= CONTRIBUTION_SCORE_THRESHOLD,
        attestation_score: score,
        blockers: Array.from(blockers).sort(),
        next_required_action: resolveNextRequiredAction({
            attestationStatus,
            verificationStatus,
            verified,
            signatureMaterialPresent,
            notExpired,
            taskAllowed,
            productionSignatureReady,
            artifactPinned: Boolean(normalizeHash(input.software_artifact_hash)),
            softwareVersionPresent: Boolean(normalizeOptionalText(input.software_version, 80)),
            signingKeyPresent: Boolean(normalizeOptionalText(input.signing_key_fingerprint, 160)),
            score,
        }),
        signals: {
            accepted: attestationStatus === 'accepted',
            verified,
            signature_verified: signatureVerified,
            signature_material_present: signatureMaterialPresent,
            artifact_pinned: Boolean(normalizeHash(input.software_artifact_hash)),
            build_provenance_present: Boolean(normalizeHash(input.build_provenance_hash)),
            sbom_present: Boolean(normalizeHash(input.sbom_hash)),
            software_version_present: Boolean(normalizeOptionalText(input.software_version, 80)),
            signing_key_present: Boolean(normalizeOptionalText(input.signing_key_fingerprint, 160)),
            not_expired: notExpired,
            task_allowed: taskAllowed,
            production_signature_ready: productionSignatureReady,
        },
    };
}

export function selectLatestFederationNodeAttestation(
    rows: FederationNodeAttestationRow[],
): FederationNodeAttestationRow | null {
    return rows
        .slice()
        .sort((left, right) => compareIso(right.observed_at ?? right.created_at, left.observed_at ?? left.created_at))[0] ?? null;
}

export async function loadLatestFederationNodeAttestation(
    client: SupabaseClient,
    identity: FederationNodeIdentityRef,
): Promise<FederationNodeAttestationRow | null> {
    const C = FEDERATION_NODE_ATTESTATION_TABLE.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_NODE_ATTESTATION_TABLE.TABLE)
        .select('*')
        .eq(C.tenant_id, identity.tenantId)
        .eq(C.federation_key, identity.federationKey)
        .eq(C.node_ref, identity.nodeRef)
        .order(C.observed_at, { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load federation node attestation: ${error.message}`);
    }
    return data ? mapAttestation(asRecord(data)) : null;
}

export async function recordFederationNodeAttestationEvent(
    client: SupabaseClient,
    input: FederationNodeAttestationInput,
): Promise<{
    attestation: FederationNodeAttestationRow;
    assessment: FederationNodeAttestationAssessment;
    cached: boolean;
}> {
    const C = FEDERATION_NODE_ATTESTATION_TABLE.COLUMNS;
    const normalizedInput = normalizeAttestationInput(input);
    const assessment = buildFederationNodeAttestationAssessment(toAssessmentInput(normalizedInput));
    const blockers = Array.from(new Set([
        ...normalizeBlockers(input.blockers),
        ...assessment.blockers,
    ])).sort();

    const payload = {
        [C.tenant_id]: normalizedInput.tenantId,
        [C.request_id]: normalizedInput.requestId ?? randomUUID(),
        [C.federation_key]: normalizedInput.federationKey,
        [C.partner_ref]: normalizedInput.partnerRef ?? `tenant:${normalizedInput.tenantId}`,
        [C.node_ref]: normalizedInput.nodeRef,
        [C.membership_id]: normalizedInput.membershipId,
        [C.attestation_event]: normalizedInput.attestationEvent,
        [C.attestation_status]: normalizedInput.attestationStatus,
        [C.verification_status]: normalizedInput.verificationStatus,
        [C.deployment_environment]: normalizedInput.deploymentEnvironment,
        [C.software_version]: normalizedInput.softwareVersion,
        [C.software_artifact_hash]: normalizedInput.softwareArtifactHash,
        [C.build_provenance_hash]: normalizedInput.buildProvenanceHash,
        [C.sbom_hash]: normalizedInput.sbomHash,
        [C.signed_payload_hash]: normalizedInput.signedPayloadHash,
        [C.signature_algorithm]: normalizedInput.signatureAlgorithm,
        [C.signature_hash]: normalizedInput.signatureHash,
        [C.signing_key_fingerprint]: normalizedInput.signingKeyFingerprint,
        [C.transparency_log_ref]: normalizedInput.transparencyLogRef,
        [C.attestation_score]: assessment.attestation_score,
        [C.allowed_task_types]: normalizedInput.allowedTaskTypes,
        [C.expires_at]: normalizedInput.expiresAt,
        [C.blockers]: blockers,
        [C.evidence]: {
            ...(normalizedInput.evidence ?? {}),
            assessment_signals: assessment.signals,
            next_required_action: assessment.next_required_action,
            contribution_allowed: assessment.contribution_allowed,
            standard_basis: [
                'nist_ssdf_sp_800_218',
                'slsa_provenance_v1_2',
                'in_toto_statement_v1',
                'sigstore_style_signature_verification',
            ],
        },
        [C.observed_at]: normalizedInput.observedAt ?? new Date().toISOString(),
    };

    const { data, error } = await client
        .from(FEDERATION_NODE_ATTESTATION_TABLE.TABLE)
        .insert(payload)
        .select('*')
        .single();

    if (!error && data) {
        return {
            attestation: mapAttestation(asRecord(data)),
            assessment,
            cached: false,
        };
    }

    if (error?.code === '23505' && normalizedInput.requestId) {
        const cached = await loadAttestationByRequestId(client, normalizedInput.tenantId, normalizedInput.requestId);
        if (cached) {
            return {
                attestation: cached,
                assessment: buildFederationNodeAttestationAssessment(cached),
                cached: true,
            };
        }
    }

    throw new Error(`Failed to record federation node attestation: ${error?.message ?? 'unknown error'}`);
}

async function loadAttestationByRequestId(
    client: SupabaseClient,
    tenantId: string,
    requestId: string,
): Promise<FederationNodeAttestationRow | null> {
    const C = FEDERATION_NODE_ATTESTATION_TABLE.COLUMNS;
    const { data, error } = await client
        .from(FEDERATION_NODE_ATTESTATION_TABLE.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.request_id, requestId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load cached federation node attestation: ${error.message}`);
    }
    return data ? mapAttestation(asRecord(data)) : null;
}

function normalizeAttestationInput(input: FederationNodeAttestationInput): Required<Pick<
    FederationNodeAttestationInput,
    'tenantId' | 'federationKey' | 'nodeRef'
>> & FederationNodeAttestationInput {
    return {
        ...input,
        tenantId: input.tenantId,
        federationKey: normalizeFederationKey(input.federationKey) ?? input.federationKey,
        nodeRef: normalizeNodeRef(input.nodeRef) ?? input.nodeRef,
        partnerRef: normalizePartnerRef(input.partnerRef),
        requestId: normalizeUuid(input.requestId),
        membershipId: normalizeUuid(input.membershipId),
        attestationEvent: normalizeAttestationEventKind(input.attestationEvent),
        attestationStatus: normalizeAttestationStatus(input.attestationStatus),
        verificationStatus: normalizeVerificationStatus(input.verificationStatus),
        deploymentEnvironment: normalizeEnvironment(input.deploymentEnvironment),
        softwareVersion: normalizeOptionalText(input.softwareVersion, 80),
        softwareArtifactHash: normalizeHash(input.softwareArtifactHash),
        buildProvenanceHash: normalizeHash(input.buildProvenanceHash),
        sbomHash: normalizeHash(input.sbomHash),
        signedPayloadHash: normalizeHash(input.signedPayloadHash),
        signatureAlgorithm: normalizeOptionalText(input.signatureAlgorithm, 80),
        signatureHash: normalizeHash(input.signatureHash),
        signingKeyFingerprint: normalizeOptionalText(input.signingKeyFingerprint, 160),
        transparencyLogRef: normalizeOptionalText(input.transparencyLogRef, 240),
        allowedTaskTypes: normalizeAllowedTaskTypes(input.allowedTaskTypes),
        expiresAt: normalizeIso(input.expiresAt),
        blockers: normalizeBlockers(input.blockers),
        evidence: input.evidence ?? {},
        observedAt: normalizeIso(input.observedAt),
    };
}

function toAssessmentInput(
    input: ReturnType<typeof normalizeAttestationInput>,
): FederationNodeAttestationAssessmentInput {
    return {
        attestation_status: input.attestationStatus,
        verification_status: input.verificationStatus,
        deployment_environment: input.deploymentEnvironment,
        software_version: input.softwareVersion,
        software_artifact_hash: input.softwareArtifactHash,
        build_provenance_hash: input.buildProvenanceHash,
        sbom_hash: input.sbomHash,
        signed_payload_hash: input.signedPayloadHash,
        signature_hash: input.signatureHash,
        signing_key_fingerprint: input.signingKeyFingerprint,
        allowed_task_types: input.allowedTaskTypes,
        expires_at: input.expiresAt,
        blockers: input.blockers,
    };
}

function scoreAttestation(input: {
    accepted: boolean;
    verified: boolean;
    notExpired: boolean;
    artifactPinned: boolean;
    buildProvenancePresent: boolean;
    sbomPresent: boolean;
    signatureMaterialPresent: boolean;
    softwareVersionPresent: boolean;
    signingKeyPresent: boolean;
    taskAllowed: boolean;
    hardBlocked: boolean;
    blockerCount: number;
}): number {
    let score = 0;
    if (input.accepted) score += 0.2;
    if (input.verified) score += 0.2;
    if (input.notExpired) score += 0.12;
    if (input.artifactPinned) score += 0.12;
    if (input.softwareVersionPresent) score += 0.08;
    if (input.signingKeyPresent) score += 0.08;
    if (input.signatureMaterialPresent) score += 0.08;
    if (input.buildProvenancePresent) score += 0.06;
    if (input.sbomPresent) score += 0.03;
    if (input.taskAllowed) score += 0.03;
    if (input.hardBlocked) score = Math.min(score, 0.39);
    if (input.blockerCount > 0) score = Math.min(score, 0.69);
    return Math.round(Math.max(0, Math.min(1, score)) * 10_000) / 10_000;
}

function resolveNextRequiredAction(input: {
    attestationStatus: FederationNodeAttestationStatus;
    verificationStatus: FederationNodeAttestationVerificationStatus;
    verified: boolean;
    signatureMaterialPresent: boolean;
    notExpired: boolean;
    taskAllowed: boolean;
    productionSignatureReady: boolean;
    artifactPinned: boolean;
    softwareVersionPresent: boolean;
    signingKeyPresent: boolean;
    score: number;
}): string | null {
    if (input.attestationStatus === 'revoked') return 'rotate_or_reinstate_node_attestation';
    if (input.attestationStatus === 'rejected') return 'submit_corrected_node_attestation';
    if (input.attestationStatus !== 'accepted') return 'accept_or_reject_node_attestation';
    if (!input.verified || input.verificationStatus === 'failed') return 'verify_node_attestation_signature_or_reviewer';
    if (!input.signatureMaterialPresent) return 'attach_signed_payload_signature_and_key_fingerprint';
    if (!input.artifactPinned) return 'pin_node_software_artifact_hash';
    if (!input.softwareVersionPresent) return 'declare_node_software_version';
    if (!input.signingKeyPresent) return 'attach_node_signing_key_fingerprint';
    if (!input.notExpired) return 'renew_node_attestation';
    if (!input.taskAllowed) return 'expand_or_correct_attested_task_policy';
    if (!input.productionSignatureReady) return 'require_signature_verified_attestation_for_production_node';
    if (input.score < CONTRIBUTION_SCORE_THRESHOLD) return 'raise_node_attestation_score_before_contribution';
    return null;
}

function isTaskAllowed(allowedTaskTypes: string[] | null | undefined, taskType: unknown): boolean {
    const allowed = normalizeAllowedTaskTypes(allowedTaskTypes);
    const requested = normalizeTaskType(taskType);
    if (!requested) return allowed.length > 0;
    return allowed.includes(requested);
}

function mapAttestation(row: Record<string, unknown>): FederationNodeAttestationRow {
    return {
        id: String(row.id),
        tenant_id: readText(row.tenant_id) ?? '',
        request_id: readText(row.request_id) ?? '',
        federation_key: readText(row.federation_key) ?? '',
        partner_ref: readText(row.partner_ref) ?? '',
        node_ref: readText(row.node_ref) ?? '',
        membership_id: readText(row.membership_id),
        attestation_event: normalizeAttestationEventKind(row.attestation_event),
        attestation_status: normalizeAttestationStatus(row.attestation_status),
        verification_status: normalizeVerificationStatus(row.verification_status),
        deployment_environment: normalizeEnvironment(row.deployment_environment),
        software_version: readText(row.software_version),
        software_artifact_hash: normalizeHash(row.software_artifact_hash),
        build_provenance_hash: normalizeHash(row.build_provenance_hash),
        sbom_hash: normalizeHash(row.sbom_hash),
        signed_payload_hash: normalizeHash(row.signed_payload_hash),
        signature_algorithm: readText(row.signature_algorithm),
        signature_hash: normalizeHash(row.signature_hash),
        signing_key_fingerprint: readText(row.signing_key_fingerprint),
        transparency_log_ref: readText(row.transparency_log_ref),
        attestation_score: readNumber(row.attestation_score) ?? 0,
        allowed_task_types: normalizeAllowedTaskTypes(row.allowed_task_types),
        expires_at: readText(row.expires_at),
        blockers: normalizeBlockers(row.blockers),
        evidence: asRecord(row.evidence),
        observed_at: readText(row.observed_at),
        created_at: readText(row.created_at),
    };
}

function normalizeAttestationEventKind(value: unknown): FederationNodeAttestationEventKind {
    return FEDERATION_NODE_ATTESTATION_EVENT_KINDS.includes(value as FederationNodeAttestationEventKind)
        ? value as FederationNodeAttestationEventKind
        : 'registration';
}

function normalizeAttestationStatus(value: unknown): FederationNodeAttestationStatus {
    return FEDERATION_NODE_ATTESTATION_STATUSES.includes(value as FederationNodeAttestationStatus)
        ? value as FederationNodeAttestationStatus
        : 'submitted';
}

function normalizeVerificationStatus(value: unknown): FederationNodeAttestationVerificationStatus {
    return FEDERATION_NODE_ATTESTATION_VERIFICATION_STATUSES.includes(value as FederationNodeAttestationVerificationStatus)
        ? value as FederationNodeAttestationVerificationStatus
        : 'unsigned';
}

function normalizeEnvironment(value: unknown): FederationNodeAttestationEnvironment {
    return FEDERATION_NODE_ATTESTATION_ENVIRONMENTS.includes(value as FederationNodeAttestationEnvironment)
        ? value as FederationNodeAttestationEnvironment
        : 'sandbox';
}

function normalizeAllowedTaskTypes(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : [];
    return Array.from(new Set(raw
        .map((entry) => normalizeTaskType(entry))
        .filter((entry): entry is string => entry != null)));
}

function normalizeTaskType(value: unknown): string | null {
    if (
        value === 'diagnosis_delta'
        || value === 'severity_delta'
        || value === 'support_summary'
        || value === 'secure_aggregation_key'
        || value === 'unmask_share'
    ) {
        return value;
    }
    return null;
}

function normalizeFederationKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9:_-]{2,63}$/.test(normalized) ? normalized : null;
}

function normalizeNodeRef(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized.length >= 3 && normalized.length <= 96 ? normalized : null;
}

function normalizePartnerRef(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9:_@.-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized.length >= 3 && normalized.length <= 160 ? normalized : null;
}

function normalizeOptionalText(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized.slice(0, max) : null;
}

function normalizeHash(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeUuid(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
        ? normalized
        : null;
}

function normalizeIso(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeBlockers(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : [];
    return Array.from(new Set(raw
        .map((entry) => typeof entry === 'string' ? entry.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_') : '')
        .filter(Boolean)));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function compareIso(left: string | null | undefined, right: string | null | undefined): number {
    const leftMs = left ? Date.parse(left) : 0;
    const rightMs = right ? Date.parse(right) : 0;
    return (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
}
