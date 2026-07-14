import { describe, expect, it } from 'vitest';
import { buildHighRiskRouteAuditSnapshot } from '../highRiskRouteAudit';

describe('high-risk route audit', () => {
    it('covers dataset export, billing ownership, cross-tenant surveillance, and identifiable research data', () => {
        const snapshot = buildHighRiskRouteAuditSnapshot(new Date('2026-07-12T12:00:00.000Z'));

        expect(snapshot.missingSurfaces).toEqual([]);
        expect(snapshot.coveredSurfaces.sort()).toEqual([
            'billing_org_ownership',
            'cross_tenant_surveillance',
            'dataset_export',
            'identifiable_research_data',
        ]);
        expect(snapshot.items.every((item) => item.productionPosture === 'fail_closed')).toBe(true);
        expect(snapshot.items.map((item) => item.actionKey)).toEqual(expect.arrayContaining([
            'dataset.simulation.export',
            'billing.owner.update',
            'surveillance.cross_tenant.export',
            'research.identifiable_data.write',
        ]));
    });
});
