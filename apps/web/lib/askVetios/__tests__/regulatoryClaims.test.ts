import { describe, expect, it } from 'vitest';
import { buildAskVetiosIntake } from '@/lib/askVetios/intake';
import { buildAskVetiosRegulatoryClaimsSnapshot } from '@/lib/askVetios/regulatoryClaims';

describe('Ask VetIOS regulatory claims moat', () => {
    it('restricts ungrounded treatment language for clinical cases', () => {
        const intake = buildAskVetiosIntake({
            message: 'Dog, vomiting for 2 days. Prescribe antibiotics and give a dose.',
        });

        const snapshot = buildAskVetiosRegulatoryClaimsSnapshot({
            mode: 'clinical',
            content: 'Treat with antibiotics.',
            metadata: {
                diagnosis_ranked: [
                    { name: 'gastroenteritis', confidence: 0.6, reasoning: 'Vomiting duration.' },
                ],
            },
            intake,
        });

        expect(snapshot.status).toBe('restricted_claims');
        expect(snapshot.claims_policy.device_claim_risk).toBe('high');
        expect(snapshot.blocked_claims).toContain('autonomous_treatment_or_prescription_instruction');
        expect(snapshot.next_actions).toContain('remove_autonomous_treatment_language');
    });

    it('marks sourced differential support as reviewable CDS draft', () => {
        const intake = buildAskVetiosIntake({
            message: 'Canine, 5 years old, female, vomiting for 2 days with CBC done.',
        });

        const snapshot = buildAskVetiosRegulatoryClaimsSnapshot({
            mode: 'clinical',
            content: 'Ranked differentials are provided for clinician review.',
            metadata: {
                diagnosis_ranked: [
                    { name: 'pancreatitis', confidence: 0.7, reasoning: 'Vomiting with compatible signalment.' },
                    { name: 'dietary indiscretion', confidence: 0.4, reasoning: 'Common alternative.' },
                ],
                recommended_tests: ['Spec cPL', 'abdominal ultrasound'],
                rag_citations: [
                    {
                        title: 'Canine pancreatitis reference',
                        source_name: 'VetIOS guideline',
                    },
                ],
            },
            intake,
        });

        expect(snapshot.status).toBe('cds_reviewable');
        expect(snapshot.claims_policy.independent_review_basis_available).toBe(true);
        expect(snapshot.fda_cds_alignment.output_is_not_final_diagnosis).toBe(true);
    });
});
