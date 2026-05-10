import { describe, expect, it } from 'vitest';
import { buildHeuristicResponse } from '../heuristicResponse';

describe('Ask VetIOS heuristic response routing', () => {
    it('routes feline nasal discharge and sneezing to upper-respiratory diagnostics', () => {
        const response = buildHeuristicResponse('List diagnostic steps for a cat with nasal discharge and sneezing, with citations.');

        expect(response.mode).toBe('clinical');
        expect(response.content).toContain('upper-respiratory');
        expect(response.metadata?.species).toBe('feline');
        expect(response.metadata?.heuristic_domain).toBe('respiratory');
        expect(response.metadata?.diagnosis_ranked?.[0]?.name).toMatch(/Feline|Respiratory|Herpesvirus|Calicivirus/i);
        expect(response.metadata?.diagnosis_ranked?.[0]?.name).not.toBe('Acute Gastroenteritis');
        expect(response.metadata?.diagnosis_ranked?.every((entry) => Number.isFinite(entry.confidence))).toBe(true);
        expect(response.metadata?.recommended_tests?.join(' ')).toMatch(/PCR|respiratory|rhinoscopy|nasal/i);
        expect(response.metadata?.recommended_tests?.join(' ')).not.toContain('Abdominal Radiographs');
        expect(response.metadata?.source_references?.map((source) => source.label).join(' ')).toMatch(/Merck|Cornell|ABCD/);
    });

    it('keeps gastrointestinal cases on the GI diagnostic path', () => {
        const response = buildHeuristicResponse('What diagnostics should I follow for a dog with acute vomiting and diarrhea?');

        expect(response.mode).toBe('clinical');
        expect(response.metadata?.species).toBe('canine');
        expect(response.metadata?.heuristic_domain).toBe('gastrointestinal');
        expect(response.metadata?.recommended_tests?.join(' ')).toMatch(/fecal|abdominal|hydration/i);
    });
});
