import { describe, expect, it } from 'vitest';
import {
    buildAssistantProviderUserContext,
    sanitizeAssistantProviderText,
    sanitizeGuideSynapseForProvider,
} from '../service';
import type { GuideSynapseState } from '../types';

describe('GUIDE_OS assistant provider security', () => {
    it('redacts tenant and user identity before external provider calls', () => {
        const context = buildAssistantProviderUserContext({
            tenantId: '11111111-2222-4333-8444-555555555555',
            userEmail: 'operator@example.invalid',
        });

        expect(context).toEqual({
            tenant_scope: 'authenticated_tenant',
            user_present: true,
        });
        expect(JSON.stringify(context)).not.toContain('operator@example.invalid');
        expect(JSON.stringify(context)).not.toContain('11111111');
    });

    it('redacts secret-like values from synapse context', () => {
        const synapse = sanitizeGuideSynapseForProvider({
            status: 'active',
            route_key: 'settings',
            title: 'Settings Synapse',
            summary: 'Generated key vetios_cp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa must not leak.',
            signals: [
                { label: 'Tenant', value: '11111111-2222-4333-8444-555555555555', tone: 'warning' },
                { label: 'Authorization', value: 'Bearer eyJhbGciOi.fake.signature', tone: 'danger' },
            ],
            warnings: ['Never show Bearer eyJhbGciOi.fake.signature to a guide model.'],
            next_actions: ['Rotate vetios_cp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa only through Settings.'],
            generated_at: new Date(0).toISOString(),
        } satisfies GuideSynapseState);

        const serialized = JSON.stringify(synapse);
        expect(serialized).toContain('[redacted-api-key]');
        expect(serialized).toContain('[redacted-id]');
        expect(serialized).toContain('Bearer [redacted]');
        expect(serialized).not.toContain('aaaaaaaa');
        expect(serialized).not.toContain('11111111');
    });

    it('redacts secret-like values from provider-bound user text', () => {
        const sanitized = sanitizeAssistantProviderText(
            'Please inspect tenant 11111111-2222-4333-8444-555555555555 with Bearer eyJhbGciOi.fake.signature and vetios_cp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        );

        expect(sanitized).toContain('[redacted-id]');
        expect(sanitized).toContain('Bearer [redacted]');
        expect(sanitized).toContain('[redacted-api-key]');
        expect(sanitized).not.toContain('11111111');
        expect(sanitized).not.toContain('aaaaaaaa');
    });
});
