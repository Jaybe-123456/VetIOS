import { describe, expect, it } from 'vitest';
import {
    compareInferenceOutputs,
    sanitizeReplayInputSignature,
} from '../replayDrift';

describe('inference replay drift', () => {
    it('removes diagnostic image blobs before deterministic replay', () => {
        const sanitized = sanitizeReplayInputSignature({
            species: 'canine',
            symptoms: ['vomiting'],
            diagnostic_images: [{ content_base64: 'base64-image', mime_type: 'image/png' }],
            metadata: { schema_version: 'v2' },
        });

        expect(sanitized.diagnostic_images).toBeUndefined();
        expect(sanitized.species).toBe('canine');
        expect(sanitized.symptoms).toEqual(['vomiting']);
        expect(sanitized.metadata).toMatchObject({
            schema_version: 'v2',
            replay_mode: 'deterministic_core',
            replay_external_media_skipped: true,
        });
    });

    it('compares top-label changes and distribution drift', () => {
        const comparison = compareInferenceOutputs(
            {
                differentials: [
                    { label: 'parvovirus', p: 0.72 },
                    { label: 'hge', p: 0.18 },
                ],
            },
            {
                differentials: [
                    { label: 'hge', p: 0.52 },
                    { label: 'parvovirus', p: 0.32 },
                ],
            },
        );

        expect(comparison.originalTopLabel).toBe('parvovirus');
        expect(comparison.replayTopLabel).toBe('hge');
        expect(comparison.topLabelChanged).toBe(true);
        expect(comparison.confidenceDelta).toBe(0.2);
        expect(comparison.distributionDrift).toBeGreaterThan(0.3);
    });

    it('keeps stable replay output at zero drift', () => {
        const original = {
            diagnosis: {
                top_differentials: [
                    { name: 'Canine Parvovirus', probability: 0.82 },
                    { name: 'HGE', probability: 0.12 },
                ],
            },
        };
        const comparison = compareInferenceOutputs(original, original);

        expect(comparison.topLabelChanged).toBe(false);
        expect(comparison.confidenceDelta).toBe(0);
        expect(comparison.distributionDrift).toBe(0);
    });
});
