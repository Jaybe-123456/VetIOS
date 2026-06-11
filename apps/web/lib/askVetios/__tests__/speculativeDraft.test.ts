import { describe, expect, it } from 'vitest';
import {
    buildAskVetiosSpeculativeDraft,
    shouldEmitAskVetiosSpeculativeDraft,
} from '../speculativeDraft';

describe('Ask VetIOS speculative draft', () => {
    it('builds a clinical draft with provisional differentials and diagnostics', () => {
        const draft = buildAskVetiosSpeculativeDraft({
            mode: 'clinical',
            topic: 'GI case',
            content: 'Clinical signals detected.',
            metadata: {
                diagnosis_ranked: [
                    { name: 'Canine Parvovirus', confidence: 0.82, reasoning: 'Vomiting and diarrhea in a puppy.' },
                    { name: 'Hemorrhagic gastroenteritis', confidence: 0.41, reasoning: 'Acute GI presentation.' },
                ],
                recommended_tests: ['Parvovirus ELISA', 'CBC with differential'],
                red_flags: ['Dehydration increases urgency.'],
            },
        }, 12);

        expect(draft.mode).toBe('clinical');
        expect(draft.content).toContain('Speculative clinical draft');
        expect(draft.content).toContain('01. Canine Parvovirus (82%)');
        expect(draft.content).toContain('Parvovirus ELISA');
        expect(draft.metadata.speculative_draft).toBe(true);
        expect(draft.metadata.speculative_status).toBe('draft');
        expect(draft.metadata.draft_latency_ms).toBe(12);
    });

    it('does not expose unavailable fallback text as a useful educational answer', () => {
        const draft = buildAskVetiosSpeculativeDraft({
            mode: 'educational',
            topic: 'Veterinary Knowledge Query',
            content: '## Temporarily Unavailable\n\nThe gateway has a transient issue.',
            metadata: null,
        }, 4);

        expect(draft.content).toContain('retrieving indexed evidence');
        expect(draft.content).not.toContain('Temporarily Unavailable');
    });

    it('is enabled by default and can be disabled by environment', () => {
        expect(shouldEmitAskVetiosSpeculativeDraft({} as NodeJS.ProcessEnv)).toBe(true);
        expect(shouldEmitAskVetiosSpeculativeDraft({ VETIOS_ASK_SPECULATIVE_DRAFT_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
        expect(shouldEmitAskVetiosSpeculativeDraft({ VETIOS_ASK_SPECULATIVE_DRAFT_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(false);
    });
});
