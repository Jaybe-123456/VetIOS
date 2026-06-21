import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FEDERATED_MODEL_PROMOTION_EVENTS } from '@/lib/db/schemaContracts';
import {
    buildExternalValidationAssessment,
    type ExternalValidationAssessment,
    type ExternalValidationAttestationStatus,
    type ExternalValidationAttestorKind,
    type ExternalValidationVerificationStatus,
} from '@/lib/platform/externalValidation';

export interface FederatedCandidateValidationEvidence {
    id?: string | null;
    tenant_id: string;
    federation_round_id: string;
    model_registry_entry_id?: string | null;
    federation_key: string;
    round_key: string;
    task_type: string;
    candidate_model_version: string;
    candidate_dataset_version?: string | null;
    promotion_status: string;
    participant_count: number;
    accepted_update_submissions: number;
    eligible_outcome_snapshots: number;
    outcome_confirmed_rows: number;
    provenance_verified_rows: number;
    trust_scored_rows: number;
    average_trust_score: number;
    secure_aggregation_status: string;
    source_artifact_hash?: string | null;
    aggregate_payload_hash?: string | null;
    blockers: string[];
    warnings: string[];
    evidence: Record<string, unknown>;
    observed_at?: string | null;
}

export interface FederatedExternalValidationOptions {
    requestId?: string | null;
    validationTargetId?: string | null;
    attestorKind?: ExternalValidationAttestorKind | null;
    attestorRef?: string | null;
    attestationStatus?: ExternalValidationAttestationStatus | null;
    verificationStatus?: ExternalValidationVerificationStatus | null;
    signatureAlgorithm?: string | null;
    signatureHash?: string | null;
    signingKeyFingerprint?: string | null;
    sourceSystem?: string | null;
    sourceRef?: string | null;
    operatorEvidence?: Record<string, unknown>;
    actor?: string | null;
    observedAt?: string | null;
}

export interface FederatedExternalValidationPacket {
    request_id: string;
    tenant_id: string;
    validation_target_type: 'federation_activation';
    validation_target_id: string | null;
    validation_target_ref: string;
    moat_key: 'federation_activation';
    attestor_kind: ExternalValidationAttestorKind;
    attestor_ref: string;
    validation_scope: 'federation_readiness';
    attestation_status: ExternalValidationAttestationStatus;
    verification_status: ExternalValidationVerificationStatus;
    evidence_grade: ExternalValidationAssessment['evidence_grade'];
    validation_score: number;
    source_system: string | null;
    source_ref: string | null;
    signed_payload_hash: string;
    signature_algorithm: string | null;
    signature_hash: string | null;
    signing_key_fingerprint: string | null;
    evidence: Record<string, unknown>;
    limitations: string | null;
    validation_summary: string;
    observed_at: string;
    assessment: ExternalValidationAssessment;
}

export interface FederatedExternalValidationGenerationResult {
    packets: FederatedExternalValidationPacket[];
    external_validation_events: Record<string, unknown>[];
}

const DEFENSIBLE_ROW_TARGET = 50;
const DEFAULT_ATTESTOR_REF = 'federation_validation_queue';

export function buildFederatedCandidateExternalValidationPacket(
    source: FederatedCandidateValidationEvidence,
    options: FederatedExternalValidationOptions = {},
): FederatedExternalValidationPacket {
    const attestorKind = options.attestorKind ?? 'internal_reviewer';
    const attestorRef = options.attestorRef ?? DEFAULT_ATTESTOR_REF;
    const attestationStatus = options.attestationStatus ?? 'submitted';
    const verificationStatus = options.verificationStatus ?? 'unsigned';
    const validationScore = scoreFederatedCandidateExternalValidation(source);
    const targetRef = buildValidationTargetRef(source);
    const evidence = buildValidationEvidence(source, options);
    const assessment = buildExternalValidationAssessment({
        validation_target_type: 'federation_activation',
        validation_target_ref: targetRef,
        moat_key: 'federation_activation',
        attestor_kind: attestorKind,
        attestor_ref: attestorRef,
        validation_scope: 'federation_readiness',
        attestation_status: attestationStatus,
        verification_status: verificationStatus,
        validation_score: validationScore,
        signed_payload_hash: normalizeHash(source.aggregate_payload_hash) ?? normalizeHash(source.source_artifact_hash),
        signature_hash: options.signatureHash,
        signing_key_fingerprint: options.signingKeyFingerprint,
        evidence,
    });

    return {
        request_id: normalizeUuid(options.requestId) ?? randomUUID(),
        tenant_id: source.tenant_id,
        validation_target_type: 'federation_activation',
        validation_target_id: normalizeUuid(options.validationTargetId) ?? normalizeUuid(source.model_registry_entry_id),
        validation_target_ref: assessment.normalized_target_ref,
        moat_key: 'federation_activation',
        attestor_kind: attestorKind,
        attestor_ref: assessment.normalized_attestor_ref,
        validation_scope: 'federation_readiness',
        attestation_status: attestationStatus,
        verification_status: verificationStatus,
        evidence_grade: assessment.evidence_grade,
        validation_score: assessment.validation_score,
        source_system: normalizeOptionalText(options.sourceSystem) ?? 'vetios_federation',
        source_ref: normalizeOptionalText(options.sourceRef) ?? source.id ?? source.federation_round_id,
        signed_payload_hash: assessment.signed_payload_hash,
        signature_algorithm: normalizeOptionalText(options.signatureAlgorithm),
        signature_hash: normalizeHash(options.signatureHash),
        signing_key_fingerprint: normalizeOptionalText(options.signingKeyFingerprint),
        evidence: {
            ...evidence,
            next_required_action: assessment.next_required_action,
            defensibility_signal: assessment.defensibility_signal,
        },
        limitations: buildValidationLimitations(source, assessment),
        validation_summary: buildValidationSummary(source, assessment),
        observed_at: normalizeIso(options.observedAt) ?? normalizeIso(source.observed_at) ?? new Date().toISOString(),
        assessment,
    };
}

export async function generateFederatedExternalValidationPackets(
    client: SupabaseClient,
    input: {
        tenantId: string;
        federationRoundId: string;
        candidateModelVersion?: string | null;
        options?: FederatedExternalValidationOptions;
    },
): Promise<FederatedExternalValidationGenerationResult> {
    const rows = await loadFederatedPromotionEvents(client, input);
    if (rows.length === 0) {
        throw new Error('No federated model promotion events are available for external validation.');
    }

    const packets = rows.map((row) => buildFederatedCandidateExternalValidationPacket(row, input.options));
    const externalValidationEvents = await insertExternalValidationPackets(client, packets);

    return {
        packets,
        external_validation_events: externalValidationEvents,
    };
}

function buildValidationTargetRef(source: FederatedCandidateValidationEvidence): string {
    return [
        'federation',
        source.federation_key,
        source.round_key,
        source.task_type,
        source.candidate_model_version,
    ].filter((part) => part.length > 0).join(':');
}

function buildValidationEvidence(
    source: FederatedCandidateValidationEvidence,
    options: FederatedExternalValidationOptions,
): Record<string, unknown> {
    return {
        source_tables: [
            'federated_model_promotion_events',
            'federated_update_submissions',
            'federated_outcome_eligibility_snapshots',
            'model_registry_entries',
        ],
        promotion_event_id: source.id ?? null,
        federation_round_id: source.federation_round_id,
        model_registry_entry_id: source.model_registry_entry_id ?? null,
        federation_key: source.federation_key,
        round_key: source.round_key,
        task_type: source.task_type,
        candidate_model_version: source.candidate_model_version,
        candidate_dataset_version: source.candidate_dataset_version ?? null,
        promotion_status: source.promotion_status,
        metrics: {
            participant_count: source.participant_count,
            accepted_update_submissions: source.accepted_update_submissions,
            eligible_outcome_snapshots: source.eligible_outcome_snapshots,
            outcome_confirmed_rows: source.outcome_confirmed_rows,
            provenance_verified_rows: source.provenance_verified_rows,
            trust_scored_rows: source.trust_scored_rows,
            average_trust_score: source.average_trust_score,
            secure_aggregation_status: source.secure_aggregation_status,
        },
        source_hashes: {
            source_artifact_hash: normalizeHash(source.source_artifact_hash),
            aggregate_payload_hash: normalizeHash(source.aggregate_payload_hash),
        },
        blockers: source.blockers,
        warnings: source.warnings,
        promotion_evidence: source.evidence,
        operator_evidence: options.operatorEvidence ?? {},
        validation_standard_basis: [
            'tripod_ai_transparent_prediction_model_reporting',
            'decide_ai_early_stage_clinical_ai_evaluation',
            'nist_ai_rmf_measure_manage',
            'fda_gmlp_total_product_lifecycle',
        ],
        raw_clinical_records_included: false,
        raw_model_deltas_included: false,
        deidentified_only: true,
        actor: options.actor ?? null,
    };
}

function scoreFederatedCandidateExternalValidation(source: FederatedCandidateValidationEvidence): number {
    const participantTarget = Math.max(2, source.participant_count);
    const participantScore = ratio(source.participant_count, 2) * 0.1;
    const acceptedUpdateScore = ratio(source.accepted_update_submissions, participantTarget) * 0.15;
    const eligibleSnapshotScore = ratio(source.eligible_outcome_snapshots, participantTarget) * 0.15;
    const outcomeScore = ratio(source.outcome_confirmed_rows, DEFENSIBLE_ROW_TARGET) * 0.12;
    const provenanceScore = ratio(source.provenance_verified_rows, DEFENSIBLE_ROW_TARGET) * 0.12;
    const trustRowsScore = ratio(source.trust_scored_rows, DEFENSIBLE_ROW_TARGET) * 0.12;
    const trustQualityScore = ratio(source.average_trust_score, 0.8) * 0.12;
    const secureAggregationScore = source.secure_aggregation_status === 'secure_aggregation_ready'
        || source.secure_aggregation_status === 'live_node_commitments_ready'
        ? 0.08
        : 0;
    const hashScore = normalizeHash(source.aggregate_payload_hash) || normalizeHash(source.source_artifact_hash) ? 0.07 : 0;
    const promotionScore = ['candidate_registered', 'already_registered', 'promotion_gate_required'].includes(source.promotion_status)
        ? 0.07
        : 0;
    let score = participantScore
        + acceptedUpdateScore
        + eligibleSnapshotScore
        + outcomeScore
        + provenanceScore
        + trustRowsScore
        + trustQualityScore
        + secureAggregationScore
        + hashScore
        + promotionScore;

    if (source.blockers.length > 0 || source.promotion_status === 'blocked' || source.promotion_status === 'rejected') {
        score = Math.min(score, 0.49);
    }
    if (source.warnings.length > 0) {
        score = Math.min(score, 0.92);
    }
    return roundScore(score);
}

function buildValidationLimitations(
    source: FederatedCandidateValidationEvidence,
    assessment: ExternalValidationAssessment,
): string | null {
    const limitations: string[] = [];
    if (source.blockers.length > 0) limitations.push(`Blocked promotion evidence: ${source.blockers.join(', ')}.`);
    if (source.warnings.length > 0) limitations.push(`Warnings: ${source.warnings.join(', ')}.`);
    if (source.outcome_confirmed_rows < DEFENSIBLE_ROW_TARGET) limitations.push(`Outcome-confirmed rows below ${DEFENSIBLE_ROW_TARGET}.`);
    if (source.provenance_verified_rows < DEFENSIBLE_ROW_TARGET) limitations.push(`Provenance-verified rows below ${DEFENSIBLE_ROW_TARGET}.`);
    if (source.trust_scored_rows < DEFENSIBLE_ROW_TARGET) limitations.push(`Trust-scored rows below ${DEFENSIBLE_ROW_TARGET}.`);
    if (!assessment.signature_material_present) limitations.push('No verified external signature material is attached yet.');
    return limitations.length > 0 ? limitations.join(' ') : null;
}

function buildValidationSummary(
    source: FederatedCandidateValidationEvidence,
    assessment: ExternalValidationAssessment,
): string {
    return [
        `Federated ${source.task_type} candidate ${source.candidate_model_version} validation packet.`,
        `Evidence grade: ${assessment.evidence_grade}.`,
        `Outcome rows: ${source.outcome_confirmed_rows}; provenance rows: ${source.provenance_verified_rows}; trust-scored rows: ${source.trust_scored_rows}.`,
    ].join(' ');
}

async function loadFederatedPromotionEvents(
    client: SupabaseClient,
    input: {
        tenantId: string;
        federationRoundId: string;
        candidateModelVersion?: string | null;
    },
): Promise<FederatedCandidateValidationEvidence[]> {
    const C = FEDERATED_MODEL_PROMOTION_EVENTS.COLUMNS;
    let query = client
        .from(FEDERATED_MODEL_PROMOTION_EVENTS.TABLE)
        .select('*')
        .eq(C.tenant_id, input.tenantId)
        .eq(C.federation_round_id, input.federationRoundId)
        .order(C.created_at, { ascending: false });

    const candidateModelVersion = normalizeOptionalText(input.candidateModelVersion);
    if (candidateModelVersion) {
        query = query.eq(C.candidate_model_version, candidateModelVersion);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to load federated promotion events for validation: ${error.message}`);
    }
    return (data ?? []).map((row) => mapPromotionEvent(asRecord(row)));
}

async function insertExternalValidationPackets(
    client: SupabaseClient,
    packets: FederatedExternalValidationPacket[],
): Promise<Record<string, unknown>[]> {
    const payload = packets.map((packet) => ({
        tenant_id: packet.tenant_id,
        request_id: packet.request_id,
        validation_target_type: packet.validation_target_type,
        validation_target_id: packet.validation_target_id,
        validation_target_ref: packet.validation_target_ref,
        moat_key: packet.moat_key,
        attestor_kind: packet.attestor_kind,
        attestor_ref: packet.attestor_ref,
        validation_scope: packet.validation_scope,
        attestation_status: packet.attestation_status,
        verification_status: packet.verification_status,
        evidence_grade: packet.evidence_grade,
        validation_score: packet.validation_score,
        source_system: packet.source_system,
        source_ref: packet.source_ref,
        signed_payload_hash: packet.signed_payload_hash,
        signature_algorithm: packet.signature_algorithm,
        signature_hash: packet.signature_hash,
        signing_key_fingerprint: packet.signing_key_fingerprint,
        evidence: packet.evidence,
        limitations: packet.limitations,
        validation_summary: packet.validation_summary,
        observed_at: packet.observed_at,
    }));

    const { data, error } = await client
        .from('external_validation_events')
        .insert(payload)
        .select('id, validation_target_ref, evidence_grade, validation_score');

    if (error) {
        throw new Error(`Failed to insert federated external validation packet: ${error.message}`);
    }
    return (data ?? []).map((row) => asRecord(row));
}

function mapPromotionEvent(row: Record<string, unknown>): FederatedCandidateValidationEvidence {
    return {
        id: readText(row.id),
        tenant_id: readText(row.tenant_id) ?? '',
        federation_round_id: readText(row.federation_round_id) ?? '',
        model_registry_entry_id: readText(row.model_registry_entry_id),
        federation_key: readText(row.federation_key) ?? '',
        round_key: readText(row.round_key) ?? '',
        task_type: readText(row.task_type) ?? 'hybrid',
        candidate_model_version: readText(row.candidate_model_version) ?? 'unknown_candidate',
        candidate_dataset_version: readText(row.candidate_dataset_version),
        promotion_status: readText(row.promotion_status) ?? 'blocked',
        participant_count: readNumber(row.participant_count) ?? 0,
        accepted_update_submissions: readNumber(row.accepted_update_submissions) ?? 0,
        eligible_outcome_snapshots: readNumber(row.eligible_outcome_snapshots) ?? 0,
        outcome_confirmed_rows: readNumber(row.outcome_confirmed_rows) ?? 0,
        provenance_verified_rows: readNumber(row.provenance_verified_rows) ?? 0,
        trust_scored_rows: readNumber(row.trust_scored_rows) ?? 0,
        average_trust_score: readNumber(row.average_trust_score) ?? 0,
        secure_aggregation_status: readText(row.secure_aggregation_status) ?? 'missing',
        source_artifact_hash: readText(row.source_artifact_hash),
        aggregate_payload_hash: readText(row.aggregate_payload_hash),
        blockers: readTextArray(row.blockers),
        warnings: readTextArray(row.warnings),
        evidence: asRecord(row.evidence),
        observed_at: readText(row.observed_at),
    };
}

function ratio(value: number, target: number): number {
    if (target <= 0) return 1;
    return Math.max(0, Math.min(1, value / target));
}

function roundScore(value: number): number {
    return Math.max(0, Math.min(1, Math.round(value * 10_000) / 10_000));
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

function readTextArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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
