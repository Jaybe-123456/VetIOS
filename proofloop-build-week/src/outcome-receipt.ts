import type { KeyObject } from 'node:crypto';
import { canonicalJson, exportPublicKeyPem, sha256, signCanonical, verifyCanonical } from './integrity.js';
import type { ClosedCase, OutcomeReceipt, OutcomeReceiptContent } from './types.js';

export function createOutcomeReceipt(
    closedCase: ClosedCase,
    signingKeys: { privateKey: KeyObject; publicKey: KeyObject },
    createdAt = new Date().toISOString(),
): OutcomeReceipt {
    if (closedCase.review.status !== 'confirmed') {
        throw new Error('Only human-confirmed outcomes can produce an Outcome Receipt.');
    }
    if (closedCase.outcome.evidence.length === 0) {
        throw new Error('At least one outcome evidence item is required.');
    }

    const evidence = closedCase.outcome.evidence.map(({ payload, ...manifest }) => ({
        ...manifest,
        payload_sha256: sha256(payload),
    }));
    const receiptSeed = {
        case_id: closedCase.case_id,
        outcome_id: closedCase.outcome.outcome_id,
        confirmed_at: closedCase.review.confirmed_at,
    };
    const content: OutcomeReceiptContent = {
        version: 'proofloop.outcome-receipt.v1',
        receipt_id: `plr_${sha256(receiptSeed).slice(0, 20)}`,
        created_at: createdAt,
        case_id: closedCase.case_id,
        inference: closedCase.inference,
        outcome: {
            outcome_id: closedCase.outcome.outcome_id,
            observed_at: closedCase.outcome.observed_at,
            label: closedCase.outcome.label,
            evidence,
            evidence_set_sha256: sha256(evidence),
        },
        review: closedCase.review,
    };

    return {
        ...content,
        integrity: {
            algorithm: 'ed25519',
            content_sha256: sha256(content),
            public_key_pem: exportPublicKeyPem(signingKeys.publicKey),
            signature_base64: signCanonical(content, signingKeys.privateKey),
        },
    };
}

export function verifyOutcomeReceipt(receipt: OutcomeReceipt): {
    valid: boolean;
    content_digest_valid: boolean;
    evidence_digest_valid: boolean;
    signature_valid: boolean;
} {
    const { integrity, ...content } = receipt;
    const evidenceDigestValid = sha256(receipt.outcome.evidence) === receipt.outcome.evidence_set_sha256;
    const contentDigestValid = sha256(content) === integrity.content_sha256;
    const signatureValid = verifyCanonical(content, integrity.signature_base64, integrity.public_key_pem);
    return {
        valid: evidenceDigestValid && contentDigestValid && signatureValid,
        content_digest_valid: contentDigestValid,
        evidence_digest_valid: evidenceDigestValid,
        signature_valid: signatureValid,
    };
}

export function serializeOutcomeReceipt(receipt: OutcomeReceipt): string {
    return `${canonicalJson(receipt)}\n`;
}
