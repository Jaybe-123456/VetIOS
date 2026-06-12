import { describe, expect, it } from 'vitest';
import {
    buildInferenceRequestFromInputSignature,
    summarizeChallengerResult,
} from '../counterfactualStability';
import type { ChallengerResult } from '@/lib/counterfactual/evidenceChallenger';

describe('counterfactual stability moat', () => {
    it('maps stored inference input signatures into challenger requests', () => {
        const request = buildInferenceRequestFromInputSignature({
            species: 'canine',
            breed: 'mixed',
            symptoms: ['vomiting', 'lethargy'],
            presenting_signs: ['bloody_diarrhea'],
            diagnostic_tests: {
                serology: { parvo_elisa: 'positive' },
            },
            physical_exam: {
                dehydration: 'present',
            },
            metadata: {
                age_years: 1.5,
            },
        });

        expect(request.species).toBe('canine');
        expect(request.breed).toBe('mixed');
        expect(request.age_years).toBe(1.5);
        expect(request.presenting_signs).toEqual(['bloody_diarrhea', 'vomiting', 'lethargy']);
        expect(request.symptom_vector).toEqual(['bloody_diarrhea', 'vomiting', 'lethargy']);
        expect(request.diagnostic_tests).toEqual({ serology: { parvo_elisa: 'positive' } });
        expect(request.physical_exam).toEqual({ dehydration: 'present' });
    });

    it('returns compact stability summaries without raw request payloads', () => {
        const result: ChallengerResult = {
            sessionId: 'cf-test',
            baselinePrimary: 'Canine Parvovirus',
            baselineConfidence: 0.81234,
            baselineDifferentials: [],
            findingschallenged: 3,
            diagnosesTested: 2,
            stabilityVerdict: 'fragile',
            stabilityScore: 0.45123,
            topLoadBearingFinding: 'serology.parvo_elisa',
            cpgScores: [
                {
                    finding: 'serology.parvo_elisa',
                    findingType: 'diagnostic_test',
                    diagnosis: 'Canine Parvovirus',
                    diagnosisRankBaseline: 1,
                    probabilityBaseline: 0.8,
                    probabilityCounterfactual: 0.3,
                    cpg: 0.5,
                    rankAfterRemoval: 2,
                    rankDelta: 1,
                    diagnosisDroppedOut: false,
                },
            ],
            reasoningTrace: ['baseline:start'],
            latencyMs: 12,
            clinicalSummary: 'Diagnostic stability: FRAGILE.',
        };

        const summary = summarizeChallengerResult('inference-1', result);

        expect(summary).toMatchObject({
            session_id: 'cf-test',
            source_inference_event_id: 'inference-1',
            stability_verdict: 'fragile',
            stability_score: 0.4512,
            baseline_confidence: 0.8123,
            top_load_bearing_finding: 'serology.parvo_elisa',
            latency_ms: 12,
        });
        expect(summary.top_cpg_scores).toEqual([{
            finding: 'serology.parvo_elisa',
            finding_type: 'diagnostic_test',
            diagnosis: 'Canine Parvovirus',
            cpg: 0.5,
            probability_baseline: 0.8,
            probability_counterfactual: 0.3,
            diagnosis_dropped_out: false,
        }]);
        expect(summary).not.toHaveProperty('reasoningTrace');
        expect(summary).not.toHaveProperty('baselineDifferentials');
    });
});
