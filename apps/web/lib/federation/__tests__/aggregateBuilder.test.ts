import { describe, expect, it } from 'vitest';
import {
    createCipheriv,
    createHash,
    createHmac,
    diffieHellman,
    generateKeyPairSync,
    type KeyObject,
} from 'node:crypto';
import {
    buildFederatedAggregateArtifactDraft,
    type FederatedAggregateUpdateEvidence,
} from '@/lib/federation/aggregateBuilder';
import type { FederationRoundRow } from '@/lib/federation/nodeRuntime';

type X25519KeyPair = { publicKey: KeyObject; privateKey: KeyObject };

const coordinatorKeys = generateKeyPairSync('x25519') as X25519KeyPair;
const nodeAKeys = generateKeyPairSync('x25519') as X25519KeyPair;
const nodeBKeys = generateKeyPairSync('x25519') as X25519KeyPair;
const coordinatorPrivateKeyDerBase64 = coordinatorKeys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const dimensions = ['feature:a', 'feature:b'];
const dimensionOrderDigest = stableHash(dimensions);

describe('federated aggregate artifact builder', () => {
    it('builds a diagnosis aggregate candidate from accepted outcome-linked commitments', () => {
        const draft = buildFederatedAggregateArtifactDraft({
            round: round(),
            taskType: 'diagnosis',
            acceptedUpdates: [
                update({ id: 'accepted-a', node_ref: 'node-a', participant_ref: 'participant-a', outcome_eligibility_snapshot_id: 'elig-a' }, {
                    senderKeys: nodeAKeys,
                    peerNodeRef: 'node-b',
                    direction: 'add',
                    maskedVector: { 'feature:a': 120, 'feature:b': 40 },
                }),
                update({ id: 'accepted-b', node_ref: 'node-b', participant_ref: 'participant-b', outcome_eligibility_snapshot_id: 'elig-b' }, {
                    senderKeys: nodeBKeys,
                    peerNodeRef: 'node-a',
                    direction: 'subtract',
                    maskedVector: { 'feature:a': 80, 'feature:b': 20 },
                }),
            ],
            minimumAcceptedUpdates: 2,
            coordinatorRecoveryKeyMaterial: { privateKeyDerBase64: coordinatorPrivateKeyDerBase64 },
            builtAt: '2026-06-21T15:00:00.000Z',
        });

        expect(draft.blockers).toEqual([]);
        expect(draft.task_type).toBe('diagnosis');
        expect(draft.model_version).toContain('fed-one_health_amr-one_health_amr:20260621-diagnosis');
        expect(draft.dataset_version).toMatch(/^federated:one_health_amr:20260621:[a-f0-9]{64}$/);
        expect(draft.artifact_payload.accepted_update_count).toBe(2);
        expect(draft.artifact_payload.raw_site_delta_artifacts_stored).toBe(false);
        expect(draft.artifact_payload.raw_clinical_rows_shared).toBe(false);
        expect((draft.artifact_payload.secure_aggregate_materialization as Record<string, unknown>).decrypted_unmask_share_count).toBe(2);
        expect((draft.artifact_payload.secure_aggregate_materialization as Record<string, unknown>).dropout_recovery_evidence_status).toBe('decrypted_no_dropout_correction_needed');
        expect(draft.summary.status).toBe('aggregate_candidate_ready');
    });

    it('blocks candidates that lack secure aggregation mask commitments', () => {
        const draft = buildFederatedAggregateArtifactDraft({
            round: round(),
            taskType: 'severity',
            acceptedUpdates: [
                update({
                    contribution_role: 'severity',
                    mask_commitment_hash: null,
                    outcome_eligibility_snapshot_id: 'elig-a',
                }),
                update({
                    id: 'accepted-b',
                    contribution_role: 'severity',
                    node_ref: 'node-b',
                    participant_ref: 'participant-b',
                    outcome_eligibility_snapshot_id: 'elig-b',
                }),
            ],
            minimumAcceptedUpdates: 2,
        });

        expect(draft.blockers).toContain('accepted_update_missing_mask_commitment');
        expect(draft.summary.status).toBe('aggregate_candidate_blocked');
    });

    it('keeps raw masked update summaries out of the aggregate payload', () => {
        const draft = buildFederatedAggregateArtifactDraft({
            round: round(),
            taskType: 'diagnosis',
            acceptedUpdates: [
                update({ id: 'accepted-a', node_ref: 'node-a', participant_ref: 'participant-a' }, {
                    senderKeys: nodeAKeys,
                    peerNodeRef: 'node-b',
                    direction: 'add',
                    maskedVector: { 'feature:a': 120, 'feature:b': 40 },
                }),
                update({ id: 'accepted-b', node_ref: 'node-b', participant_ref: 'participant-b' }, {
                    senderKeys: nodeBKeys,
                    peerNodeRef: 'node-a',
                    direction: 'subtract',
                    maskedVector: { 'feature:a': 80, 'feature:b': 20 },
                }),
            ],
            minimumAcceptedUpdates: 2,
            coordinatorRecoveryKeyMaterial: { privateKeyDerBase64: coordinatorPrivateKeyDerBase64 },
        });

        const serialized = JSON.stringify(draft.artifact_payload);
        expect(serialized).not.toContain('raw_gradient_vector');
        expect(serialized).not.toContain('unmasked_delta');
        expect(serialized).not.toContain('mask_seed');
        expect(serialized).toContain('public_update_summaries');
    });

    it('decrypts unmask shares and removes masks from a dropped peer', () => {
        const seed = '1'.repeat(64);
        const maskVector = buildPairwiseMaskVector(seed, 1000);
        const unmaskedVector = { 'feature:a': 3000, 'feature:b': 2000 };
        const maskedVector = {
            'feature:a': unmaskedVector['feature:a'] + maskVector['feature:a']!,
            'feature:b': unmaskedVector['feature:b'] + maskVector['feature:b']!,
        };
        const draft = buildFederatedAggregateArtifactDraft({
            round: round({ participant_count: 1 }),
            taskType: 'diagnosis',
            acceptedUpdates: [
                update({ id: 'accepted-a', node_ref: 'node-a', participant_ref: 'participant-a' }, {
                    senderKeys: nodeAKeys,
                    peerNodeRef: 'node-b',
                    direction: 'add',
                    seed,
                    maskedVector,
                }),
            ],
            minimumAcceptedUpdates: 1,
            coordinatorRecoveryKeyMaterial: { privateKeyDerBase64: coordinatorPrivateKeyDerBase64 },
        });

        const materialization = draft.artifact_payload.secure_aggregate_materialization as Record<string, unknown>;
        expect(draft.blockers).toEqual([]);
        expect(materialization.dropout_recovery_evidence_status).toBe('decrypted_and_applied');
        expect(materialization.applied_dropout_unmask_share_count).toBe(1);
        expect(materialization.dropout_recovered_peer_refs).toEqual(['node-b']);
        expect(materialization.aggregate_integer_vector).toEqual(unmaskedVector);
    });
});

function round(overrides: Partial<FederationRoundRow> = {}): FederationRoundRow {
    return {
        id: 'round-001',
        federation_key: 'one_health_amr',
        coordinator_tenant_id: 'coordinator-tenant',
        round_key: 'one_health_amr:20260621',
        status: 'aggregating',
        aggregation_strategy: 'secure_aggregation_v1',
        participant_count: 2,
        aggregate_payload: {
            secure_aggregation: {
                status: 'secure_aggregation_ready',
            },
        },
        candidate_artifact_payload: {},
        started_at: '2026-06-21T10:00:00.000Z',
        completed_at: null,
        ...overrides,
    };
}

function update(
    overrides: Partial<FederatedAggregateUpdateEvidence> = {},
    options: {
        senderKeys?: X25519KeyPair;
        peerNodeRef?: string;
        direction?: 'add' | 'subtract';
        seed?: string;
        maskedVector?: Record<string, number>;
    } = {},
): FederatedAggregateUpdateEvidence {
    const nodeRef = overrides.node_ref ?? 'node-a';
    const senderKeys = options.senderKeys ?? nodeAKeys;
    const seed = options.seed ?? stableHash(`${nodeRef}:${options.peerNodeRef ?? 'node-b'}`);
    const maskVector = buildPairwiseMaskVector(seed, 1000);
    const encryptedEnvelope = buildEncryptedEnvelope({
        senderKeys,
        senderNodeRef: nodeRef,
        peerNodeRef: options.peerNodeRef ?? 'node-b',
        direction: options.direction ?? 'add',
        seed,
        maskVectorDigest: stableHash(maskVector),
    });
    const maskedVector = options.maskedVector ?? { 'feature:a': 100, 'feature:b': 25 };

    return {
        id: 'accepted-update',
        tenant_id: 'tenant-a',
        federation_round_id: 'round-001',
        outcome_eligibility_snapshot_id: 'eligibility-a',
        federation_key: 'one_health_amr',
        round_key: 'one_health_amr:20260621',
        node_ref: nodeRef,
        partner_ref: 'partner-a',
        participant_ref: 'participant-a',
        contribution_role: 'diagnosis',
        submission_status: 'accepted',
        masking_protocol: 'x25519_hkdf_pairwise_masked_v1',
        payload_commitment_hash: 'a'.repeat(64),
        mask_commitment_hash: 'b'.repeat(64),
        signed_payload_hash: 'c'.repeat(64),
        signature_algorithm: 'ed25519',
        signature_hash: 'd'.repeat(64),
        signing_key_fingerprint: 'key-fingerprint-a',
        public_summary: {
            rows: 24,
            label_family: 'outcome_confirmed',
        },
        evidence: {
            raw_gradient_vector: [0.12, -0.01],
            unmasked_delta: 'must-not-propagate',
        },
        masked_update_summary: {
            secure_aggregation: {
                masking_protocol: 'x25519_hkdf_pairwise_masked_v1',
                quantization_scale: 1000,
                mask_range: 1000,
                dimension_order_digest: dimensionOrderDigest,
                masked_vector_digest: stableHash(maskedVector),
                masked_integer_vector: maskedVector,
                encrypted_unmask_share_envelopes: [encryptedEnvelope],
            },
        },
        observed_at: '2026-06-21T14:00:00.000Z',
        created_at: '2026-06-21T14:00:00.000Z',
        ...overrides,
    };
}

function buildEncryptedEnvelope(input: {
    senderKeys: X25519KeyPair;
    senderNodeRef: string;
    peerNodeRef: string;
    direction: 'add' | 'subtract';
    seed: string;
    maskVectorDigest: string;
}) {
    const senderPublicKeyDer = input.senderKeys.publicKey.export({ format: 'der', type: 'spki' });
    const aad = {
        schema: 'vetios_unmask_share_envelope_aad_v1',
        federation_round_id: 'round-001',
        round_node_task_id: 'task-001',
        round_key: 'one_health_amr:20260621',
        node_ref: input.senderNodeRef,
        peer_node_ref: input.peerNodeRef,
        direction: input.direction,
        key_agreement_protocol: 'x25519_hkdf_sha256_v1',
    };
    const sharedSecret = diffieHellman({
        privateKey: input.senderKeys.privateKey,
        publicKey: coordinatorKeys.publicKey,
    });
    const salt = Buffer.from(stableHash({
        ...aad,
        envelope_scope: 'coordinator_dropout_recovery_unmask_share',
    }), 'hex');
    const info = Buffer.from(`vetios-secagg-unmask-share:${aad.round_key}:${aad.round_node_task_id}:${aad.peer_node_ref}`, 'utf8');
    const encryptionKey = hkdfSha256(sharedSecret, salt, info, 32);
    const iv = Buffer.alloc(12, 7);
    const plaintext = stableStringify({
        schema: 'vetios_unmask_share_seed_v1',
        federation_round_id: aad.federation_round_id,
        round_node_task_id: aad.round_node_task_id,
        node_ref: aad.node_ref,
        peer_node_ref: aad.peer_node_ref,
        direction: aad.direction,
        key_agreement_protocol: 'x25519_hkdf_sha256_v1',
        reveal_policy: 'dropout_or_threshold_unmask_only',
        mask_seed: input.seed,
        mask_range: 1000,
        seed_digest: stableHash(input.seed),
        mask_vector_digest: input.maskVectorDigest,
    });
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(Buffer.from(stableStringify(aad), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const envelopeWithoutHash = {
        schema: 'vetios_encrypted_unmask_share_envelope_v1',
        federation_round_id: aad.federation_round_id,
        round_node_task_id: aad.round_node_task_id,
        round_key: aad.round_key,
        sender_node_ref: input.senderNodeRef,
        sender_public_key_der_base64: senderPublicKeyDer.toString('base64'),
        sender_public_key_fingerprint: createHash('sha256').update(senderPublicKeyDer).digest('hex').slice(0, 32),
        peer_node_ref: input.peerNodeRef,
        direction: input.direction,
        recipient: 'coordinator',
        encryption_protocol: 'x25519_aes_256_gcm_v1',
        key_agreement_protocol: 'x25519_hkdf_sha256_v1',
        aad_hash: stableHash(aad),
        iv_base64: iv.toString('base64'),
        ciphertext_base64: ciphertext.toString('base64'),
        auth_tag_base64: cipher.getAuthTag().toString('base64'),
    };
    return {
        ...envelopeWithoutHash,
        envelope_hash: stableHash(envelopeWithoutHash),
    };
}

function buildPairwiseMaskVector(seed: string, maskRange: number): Record<string, number> {
    return Object.fromEntries(dimensions.map((dimension, index) => [
        dimension,
        pairwiseMaskValue(seed, dimension, index, maskRange),
    ]));
}

function pairwiseMaskValue(seed: string, dimension: string, index: number, maskRange: number): number {
    const digest = createHmac('sha256', seed).update(`${index}:${dimension}`).digest('hex');
    const parsed = Number.parseInt(digest.slice(0, 12), 16);
    const bounded = Number.isFinite(parsed) ? parsed % (maskRange * 2 + 1) : 0;
    return bounded - maskRange;
}

function hkdfSha256(inputKeyMaterial: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
    const pseudoRandomKey = createHmac('sha256', salt).update(inputKeyMaterial).digest();
    const blocks: Buffer[] = [];
    let previous = Buffer.alloc(0);
    let counter = 1;
    while (Buffer.concat(blocks).length < length) {
        previous = createHmac('sha256', pseudoRandomKey)
            .update(Buffer.concat([previous, info, Buffer.from([counter])]))
            .digest();
        blocks.push(previous);
        counter += 1;
    }
    return Buffer.concat(blocks).subarray(0, length);
}

function stableHash(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        return `{${Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}
