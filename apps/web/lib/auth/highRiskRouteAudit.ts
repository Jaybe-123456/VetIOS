export type HighRiskRouteAuditSurface =
    | 'dataset_export'
    | 'billing_org_ownership'
    | 'cross_tenant_surveillance'
    | 'identifiable_research_data';

export interface HighRiskRouteAuditItem {
    surface: HighRiskRouteAuditSurface;
    route: string;
    method: 'GET' | 'POST';
    actionKey: string;
    enforcement: 'auth_trust_route_gate' | 'auth_trust_clinical_actor_gate' | 'auth_trust_platform_actor_gate';
    status: 'covered';
    productionPosture: 'fail_closed';
    notes: string;
}

export interface HighRiskRouteAuditSnapshot {
    schemaVersion: 'auth-trust-route-audit-v1';
    generatedAt: string;
    requiredSurfaces: HighRiskRouteAuditSurface[];
    coveredSurfaces: HighRiskRouteAuditSurface[];
    missingSurfaces: HighRiskRouteAuditSurface[];
    items: HighRiskRouteAuditItem[];
}

export const HIGH_RISK_ROUTE_AUDIT_ITEMS: HighRiskRouteAuditItem[] = [
    {
        surface: 'dataset_export',
        method: 'GET',
        route: '/api/simulations/[id]/export',
        actionKey: 'dataset.simulation.export',
        enforcement: 'auth_trust_platform_actor_gate',
        status: 'covered',
        productionPosture: 'fail_closed',
        notes: 'Simulation event CSV export requires simulation-scoped workload identity or an admin MFA/passkey session.',
    },
    {
        surface: 'billing_org_ownership',
        method: 'POST',
        route: '/api/billing/checkout',
        actionKey: 'billing.owner.update',
        enforcement: 'auth_trust_route_gate',
        status: 'covered',
        productionPosture: 'fail_closed',
        notes: 'Product checkout and plan changes are treated as organization ownership/billing mutations.',
    },
    {
        surface: 'billing_org_ownership',
        method: 'POST',
        route: '/api/developer/billing/portal',
        actionKey: 'billing.owner.update',
        enforcement: 'auth_trust_route_gate',
        status: 'covered',
        productionPosture: 'fail_closed',
        notes: 'Billing portal session creation requires admin MFA/passkey before Stripe portal access is issued.',
    },
    {
        surface: 'billing_org_ownership',
        method: 'POST',
        route: '/api/developer/billing/upgrade',
        actionKey: 'billing.owner.update',
        enforcement: 'auth_trust_route_gate',
        status: 'covered',
        productionPosture: 'fail_closed',
        notes: 'Developer partner plan upgrades require admin MFA/passkey.',
    },
    {
        surface: 'billing_org_ownership',
        method: 'POST',
        route: '/api/admin/partners/[id]/change-plan',
        actionKey: 'billing.owner.update',
        enforcement: 'auth_trust_route_gate',
        status: 'covered',
        productionPosture: 'fail_closed',
        notes: 'Admin partner plan changes require admin MFA/passkey and append-only authorization evidence.',
    },
    {
        surface: 'cross_tenant_surveillance',
        method: 'GET',
        route: '/api/amr/one-health/export',
        actionKey: 'surveillance.cross_tenant.export',
        enforcement: 'auth_trust_clinical_actor_gate',
        status: 'covered',
        productionPosture: 'fail_closed',
        notes: 'One Health AMR export requires evaluation-read workload identity or admin MFA/passkey session.',
    },
    {
        surface: 'identifiable_research_data',
        method: 'POST',
        route: '/api/dataset/case-import',
        actionKey: 'research.identifiable_data.write',
        enforcement: 'auth_trust_clinical_actor_gate',
        status: 'covered',
        productionPosture: 'fail_closed',
        notes: 'Triggered when import rows carry owner/patient identifiers or consented-research usage class.',
    },
];

export function buildHighRiskRouteAuditSnapshot(now = new Date()): HighRiskRouteAuditSnapshot {
    const requiredSurfaces: HighRiskRouteAuditSurface[] = [
        'dataset_export',
        'billing_org_ownership',
        'cross_tenant_surveillance',
        'identifiable_research_data',
    ];
    const coveredSurfaces = requiredSurfaces.filter((surface) =>
        HIGH_RISK_ROUTE_AUDIT_ITEMS.some((item) => item.surface === surface && item.status === 'covered'));
    return {
        schemaVersion: 'auth-trust-route-audit-v1',
        generatedAt: now.toISOString(),
        requiredSurfaces,
        coveredSurfaces,
        missingSurfaces: requiredSurfaces.filter((surface) => !coveredSurfaces.includes(surface)),
        items: HIGH_RISK_ROUTE_AUDIT_ITEMS,
    };
}
