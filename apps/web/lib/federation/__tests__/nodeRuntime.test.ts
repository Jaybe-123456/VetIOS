import { createHash, generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it } from 'vitest';
import type { ClinicalApiActor } from '@/lib/auth/machineAuth';
import {
    contributionRoleForTaskType,
    resolveFederationNodeIdentity,
    verifyFederatedUpdateSignature,
} from '@/lib/federation/nodeRuntime';

describe('federation node runtime', () => {
    it('normalizes explicit node and partner references for live node calls', () => {
        const identity = resolveFederationNodeIdentity({
            actor: actor(),
            federationKey: 'One_Health_AMR',
            nodeRef: ' Clinic Node / A ',
            partnerRef: ' Partner@Clinic ',
        });

        expect(identity).toEqual({
            tenantId: '11111111-1111-4111-8111-111111111111',
            federationKey: 'one_health_amr',
            nodeRef: 'clinic_node_a',
            partnerRef: 'partner@clinic',
        });
    });

    it('falls back to service-account identity when node_ref is omitted', () => {
        const identity = resolveFederationNodeIdentity({
            actor: actor({
                serviceAccountId: 'fed-node-service-account',
                principalLabel: 'Federation Node API',
            }),
            federationKey: 'one_health_amr',
        });

        expect(identity.nodeRef).toBe('fed-node-service-account');
        expect(identity.partnerRef).toBe('federation_node_api');
    });

    it('maps node task types to update contribution roles', () => {
        expect(contributionRoleForTaskType('diagnosis_delta')).toBe('diagnosis');
        expect(contributionRoleForTaskType('severity_delta')).toBe('severity');
        expect(contributionRoleForTaskType('support_summary')).toBe('support');
        expect(contributionRoleForTaskType('secure_aggregation_key')).toBe('support');
        expect(contributionRoleForTaskType('unmask_share')).toBe('unmask_share');
    });

    it('verifies Ed25519 update signatures against the attested node signing key', () => {
        const signedPayloadHash = 'a'.repeat(64);
        const keys = generateKeyPairSync('ed25519');
        const publicDer = keys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
        const signature = sign(null, Buffer.from(signedPayloadHash, 'utf8'), keys.privateKey);
        const signatureHash = createHash('sha256').update(signature).digest('hex');
        const signingKeyFingerprint = createHash('sha256').update(publicDer).digest('hex').slice(0, 32);

        const result = verifyFederatedUpdateSignature({
            body: {
                nodeRef: 'clinic-node-a',
                payloadCommitmentHash: 'b'.repeat(64),
                signedPayloadHash,
                signatureAlgorithm: 'ed25519-node-signing-key-v1',
                signatureHash,
                signingKeyFingerprint,
                evidence: {
                    update_signature: {
                        signature_payload_hash: signedPayloadHash,
                        signature_value_base64: signature.toString('base64'),
                        signature_hash: signatureHash,
                        signing_public_key_der_base64: publicDer.toString('base64'),
                        signing_key_fingerprint: signingKeyFingerprint,
                    },
                },
            },
            attestation: {
                signing_key_fingerprint: signingKeyFingerprint,
                verification_status: 'signature_verified',
            },
        });

        expect(result.status).toBe('verified');
        expect(result.accepted).toBe(true);
        expect(result.blockers).toEqual([]);
        expect(result.evidence.signature_valid).toBe(true);
    });

    it('quarantines Ed25519 updates when the payload signature does not verify', () => {
        const signedPayloadHash = 'a'.repeat(64);
        const keys = generateKeyPairSync('ed25519');
        const publicDer = keys.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
        const signature = sign(null, Buffer.from(signedPayloadHash, 'utf8'), keys.privateKey);
        const signatureHash = createHash('sha256').update(signature).digest('hex');
        const signingKeyFingerprint = createHash('sha256').update(publicDer).digest('hex').slice(0, 32);

        const result = verifyFederatedUpdateSignature({
            body: {
                nodeRef: 'clinic-node-a',
                payloadCommitmentHash: 'b'.repeat(64),
                signedPayloadHash: 'c'.repeat(64),
                signatureAlgorithm: 'ed25519-node-signing-key-v1',
                signatureHash,
                signingKeyFingerprint,
                evidence: {
                    update_signature: {
                        signature_payload_hash: 'c'.repeat(64),
                        signature_value_base64: signature.toString('base64'),
                        signature_hash: signatureHash,
                        signing_public_key_der_base64: publicDer.toString('base64'),
                        signing_key_fingerprint: signingKeyFingerprint,
                    },
                },
            },
            attestation: {
                signing_key_fingerprint: signingKeyFingerprint,
                verification_status: 'signature_verified',
            },
        });

        expect(result.status).toBe('failed');
        expect(result.accepted).toBe(false);
        expect(result.blockers).toContain('signature_verification_failed');
    });
});

function actor(overrides: Partial<ClinicalApiActor> = {}): ClinicalApiActor {
    return {
        tenantId: '11111111-1111-4111-8111-111111111111',
        userId: null,
        authMode: 'service_account',
        scopes: ['federation:node', 'secure_aggregation:write'],
        credentialId: 'credential-001',
        principalLabel: 'Default Federation Node',
        serviceAccountId: null,
        connectorInstallation: null,
        ...overrides,
        role: overrides.role ?? null,
        assuranceLevel: overrides.assuranceLevel ?? 'workload_identity',
    };
}
