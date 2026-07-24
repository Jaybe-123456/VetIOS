import { describe, expect, it } from 'vitest';
import {
    buildFederationNodeAttestationAssessment,
    recordFederationNodeAttestationEvent,
    selectLatestFederationNodeAttestation,
    type FederationNodeAttestationRow,
} from '@/lib/federation/nodeAttestation';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);

describe('federation node attestation', () => {
    it('allows a signed, accepted, unexpired production node for an allowed task', () => {
        const assessment = buildFederationNodeAttestationAssessment({
            ...strongAttestation(),
            task_type: 'diagnosis_delta',
        });

        expect(assessment.contribution_allowed).toBe(true);
        expect(assessment.attestation_score).toBeGreaterThanOrEqual(0.8);
        expect(assessment.blockers).toEqual([]);
        expect(assessment.signals.signature_verified).toBe(true);
        expect(assessment.signals.production_signature_ready).toBe(true);
        expect(assessment.next_required_action).toBeNull();
    });

    it('blocks production contribution when attestation is reviewer verified but not signature verified', () => {
        const assessment = buildFederationNodeAttestationAssessment({
            ...strongAttestation(),
            verification_status: 'reviewer_verified',
            task_type: 'diagnosis_delta',
        });

        expect(assessment.contribution_allowed).toBe(false);
        expect(assessment.blockers).toContain('production_node_signature_verification_required');
        expect(assessment.next_required_action).toBe('require_signature_verified_attestation_for_production_node');
    });

    it('keeps revoked node attestations below contribution threshold', () => {
        const assessment = buildFederationNodeAttestationAssessment({
            ...strongAttestation(),
            attestation_status: 'revoked',
            task_type: 'diagnosis_delta',
        });

        expect(assessment.contribution_allowed).toBe(false);
        expect(assessment.attestation_score).toBeLessThan(0.4);
        expect(assessment.blockers).toContain('attestation_revoked');
        expect(assessment.blockers).toContain('node_attestation_not_active');
        expect(assessment.next_required_action).toBe('rotate_or_reinstate_node_attestation');
    });

    it('blocks tasks outside the attested task policy', () => {
        const assessment = buildFederationNodeAttestationAssessment({
            ...strongAttestation(),
            allowed_task_types: ['support_summary'],
            task_type: 'diagnosis_delta',
        });

        expect(assessment.contribution_allowed).toBe(false);
        expect(assessment.blockers).toContain('task_type_not_allowed_by_node_attestation');
        expect(assessment.next_required_action).toBe('expand_or_correct_attested_task_policy');
    });

    it('selects the newest attestation event for a node', () => {
        const latest = selectLatestFederationNodeAttestation([
            attestationRow({ id: 'old', observed_at: '2026-06-21T10:00:00.000Z' }),
            attestationRow({ id: 'new', observed_at: '2026-06-21T12:00:00.000Z' }),
        ]);

        expect(latest?.id).toBe('new');
    });

    it('records accepted signed attestations using API camelCase input', async () => {
        const client = fakeInsertClient();
        const result = await recordFederationNodeAttestationEvent(client, {
            tenantId: '11111111-1111-4111-8111-111111111111',
            requestId: '22222222-2222-4222-8222-222222222222',
            federationKey: 'one_health_amr',
            nodeRef: 'clinic-node-a',
            partnerRef: 'clinic-a',
            attestationStatus: 'accepted',
            verificationStatus: 'signature_verified',
            deploymentEnvironment: 'production',
            softwareVersion: 'federation-node@2026.06.21',
            softwareArtifactHash: HASH_A,
            buildProvenanceHash: HASH_B,
            sbomHash: HASH_C,
            signedPayloadHash: HASH_D,
            signatureHash: HASH_E,
            signingKeyFingerprint: 'sigstore:node-key:2026',
            allowedTaskTypes: ['diagnosis_delta', 'support_summary'],
            expiresAt: '2099-07-21T00:00:00.000Z',
            observedAt: '2026-06-21T12:00:00.000Z',
        });

        expect(result.cached).toBe(false);
        expect(result.assessment.contribution_allowed).toBe(true);
        expect(result.attestation.attestation_score).toBeGreaterThanOrEqual(0.8);
        expect(result.attestation.blockers).toEqual([]);
    });
});

function strongAttestation() {
    return {
        attestation_status: 'accepted',
        verification_status: 'signature_verified',
        deployment_environment: 'production',
        software_version: 'federation-node@2026.06.21',
        software_artifact_hash: HASH_A,
        build_provenance_hash: HASH_B,
        sbom_hash: HASH_C,
        signed_payload_hash: HASH_D,
        signature_hash: HASH_E,
        signing_key_fingerprint: 'sigstore:node-key:2026',
        allowed_task_types: ['diagnosis_delta', 'severity_delta', 'support_summary'],
        expires_at: '2026-07-21T00:00:00.000Z',
        now: new Date('2026-06-21T12:00:00.000Z'),
    } as const;
}

function attestationRow(overrides: Partial<FederationNodeAttestationRow>): FederationNodeAttestationRow {
    return {
        id: 'row',
        tenant_id: '11111111-1111-4111-8111-111111111111',
        request_id: '22222222-2222-4222-8222-222222222222',
        federation_key: 'one_health_amr',
        partner_ref: 'clinic-a',
        node_ref: 'clinic_node_a',
        membership_id: null,
        attestation_event: 'registration',
        attestation_status: 'accepted',
        verification_status: 'signature_verified',
        deployment_environment: 'production',
        software_version: 'federation-node@2026.06.21',
        software_artifact_hash: HASH_A,
        build_provenance_hash: HASH_B,
        sbom_hash: HASH_C,
        signed_payload_hash: HASH_D,
        signature_algorithm: 'ed25519',
        signature_hash: HASH_E,
        signing_key_fingerprint: 'sigstore:node-key:2026',
        transparency_log_ref: null,
        attestation_score: 1,
        allowed_task_types: ['diagnosis_delta'],
        expires_at: '2026-07-21T00:00:00.000Z',
        blockers: [],
        evidence: {},
        observed_at: '2026-06-21T12:00:00.000Z',
        created_at: '2026-06-21T12:00:00.000Z',
        ...overrides,
    };
}

function fakeInsertClient() {
    return {
        from: () => ({
            insert: (payload: Record<string, unknown>) => ({
                select: () => ({
                    single: async () => ({
                        data: {
                            id: 'attestation-row',
                            created_at: '2026-06-21T12:00:00.000Z',
                            ...payload,
                        },
                        error: null,
                    }),
                }),
            }),
        }),
    } as never;
}
