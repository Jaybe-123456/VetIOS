import { describe, expect, it } from 'vitest';
import { CIRE_CONFORMANCE_REPORT } from '../conformance';
import {
    buildCireCertificationAssessment,
    buildPublicCireCertificationRegistry,
} from '../certification';

describe('CIRE certification registry', () => {
    it('passes a compatible implementation and makes it publicly listable only by opt in', () => {
        const assessment = buildCireCertificationAssessment({
            implementationName: 'Reference CIRE Engine',
            implementationVersion: '1.0.0',
            packageName: '@vetios/cire-engine',
            report: CIRE_CONFORMANCE_REPORT,
            verificationStatus: 'signature_verified',
            publicListingEligible: true,
            publicListingLabel: 'VetIOS reference engine',
        });

        expect(assessment.certification_status).toBe('passed');
        expect(assessment.conformance_result).toBe('passed');
        expect(assessment.conformance_score).toBe(1);
        expect(assessment.total_checks).toBe(10);
        expect(assessment.public_listing_eligible).toBe(true);
        expect(assessment.public_listing_label).toBe('VetIOS reference engine');
        expect(assessment.signed_payload_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('fails version-mismatched reports without publishing them', () => {
        const assessment = buildCireCertificationAssessment({
            standardVersion: '2.0.0',
            implementationName: 'Future incompatible engine',
            report: {
                ...CIRE_CONFORMANCE_REPORT,
                standard_version: '2.0.0',
            },
            publicListingEligible: true,
        });

        expect(assessment.certification_status).toBe('failed');
        expect(assessment.conformance_result).toBe('failed');
        expect(assessment.blockers).toContain('standard_version_mismatch');
        expect(assessment.public_listing_eligible).toBe(false);
    });

    it('builds a public de-identified registry from eligible passed rows', () => {
        const registry = buildPublicCireCertificationRegistry([
            {
                id: 'cert-1',
                standard_version: '1.0.0',
                public_listing_eligible: true,
                public_listing_label: 'Audited implementation',
                implementation_name: 'Private raw name',
                implementation_version: '1.0.0',
                package_name: '@partner/cire',
                certification_status: 'passed',
                verification_status: 'third_party_verified',
                conformance_result: 'passed',
                conformance_score: 1,
                total_checks: 10,
                passed_checks: 10,
                signed_payload_hash: 'a'.repeat(64),
                observed_at: '2026-07-02T10:00:00.000Z',
            },
            {
                id: 'cert-2',
                public_listing_eligible: true,
                implementation_name: 'Failed implementation',
                certification_status: 'failed',
                conformance_result: 'failed',
                conformance_score: 0.6,
            },
        ], '2026-07-02T12:00:00.000Z');

        expect(registry.summary).toEqual({
            listed_implementations: 1,
            passed_certifications: 1,
            verified_certifications: 1,
            third_party_verified_certifications: 1,
            average_conformance_score: 1,
        });
        expect(registry.listings[0]?.implementation_name).toBe('Audited implementation');
    });
});
