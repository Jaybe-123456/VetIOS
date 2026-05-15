import { describe, expect, it } from 'vitest';
import { enforceAskVetiosTokenBudget, estimateTokens } from '../usageBudget';

function makeRequest(clientId: string) {
    return new Request('https://vetios.test/api/ask-vetios', {
        headers: {
            'x-vetios-client-id': clientId,
            'x-forwarded-for': '203.0.113.10',
        },
    });
}

describe('Ask Vetios token budget', () => {
    it('estimates prompt tokens conservatively', () => {
        expect(estimateTokens('abcd')).toBe(1);
        expect(estimateTokens('a'.repeat(401))).toBe(101);
    });

    it('allows normal chat requests and returns remaining budget', () => {
        const result = enforceAskVetiosTokenBudget({
            req: makeRequest('client_budget_normal_12345'),
            kind: 'chat',
            message: 'Discuss canine pancreatitis diagnostics.',
        });

        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(120_000);
        expect(result.remaining).toBeLessThan(120_000);
    });

    it('blocks an oversized request before provider execution', () => {
        const result = enforceAskVetiosTokenBudget({
            req: makeRequest('client_budget_oversized_12345'),
            kind: 'chat',
            message: 'x'.repeat(80_000),
        });

        expect(result.allowed).toBe(false);
        expect(result.requestedTokens).toBeGreaterThan(18_000);
    });
});
