import { describe, expect, it } from 'vitest';
import {
    buildReferenceCireCertificationAssessment,
    buildReferenceCireCertificationRequestId,
} from '../referenceCertification';

describe('reference CIRE certification', () => {
    it('creates a deterministic UUID request id per tenant and standard version', () => {
        const left = buildReferenceCireCertificationRequestId('tenant-a');
        const right = buildReferenceCireCertificationRequestId('tenant-a');
        const other = buildReferenceCireCertificationRequestId('tenant-b');

        expect(left).toBe(right);
        expect(left).not.toBe(other);
        expect(left).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
    });

    it('passes the bundled CIRE conformance report for the reference engine', () => {
        const assessment = buildReferenceCireCertificationAssessment();

        expect(assessment.certification_status).toBe('passed');
        expect(assessment.conformance_result).toBe('passed');
        expect(assessment.total_checks).toBe(10);
        expect(assessment.passed_checks).toBe(10);
        expect(assessment.conformance_score).toBe(1);
        expect(assessment.public_listing_eligible).toBe(true);
        expect(assessment.public_listing_label).toBe('VetIOS reference CIRE engine');
        expect(assessment.signed_payload_hash).toMatch(/^[a-f0-9]{64}$/);
    });
});
