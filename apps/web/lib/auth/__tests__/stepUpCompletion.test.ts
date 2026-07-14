import { describe, expect, it } from 'vitest';
import { normalizeAssuranceText } from '../stepUpCompletion';

describe('step-up completion helpers', () => {
    it('normalizes provider assurance levels for MFA and passkey completion', () => {
        expect(normalizeAssuranceText('aal2')).toBe('mfa');
        expect(normalizeAssuranceText('multi_factor')).toBe('mfa');
        expect(normalizeAssuranceText('aal3')).toBe('passkey');
        expect(normalizeAssuranceText('webauthn')).toBe('passkey');
        expect(normalizeAssuranceText('recent_auth')).toBe('recent_auth');
        expect(normalizeAssuranceText('unknown')).toBeNull();
    });
});
