import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getModelRegistryControlPlaneSnapshot } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { runPartnerV1Route } from '@/lib/api/v1-route';
import { resolvePartnerOwnerTenantId } from '@/lib/api/partner-service';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    return runPartnerV1Route(request, {
        endpoint: '/v1/models/card',
        aggregateType: 'model_card',
        handler: async (auth) => {
            const tenantId = resolvePartnerOwnerTenantId(auth.partner);
            if (!tenantId) {
                return NextResponse.json({ error: 'Partner is missing an owner tenant mapping.' }, { status: 400 });
            }

            const snapshot = await getModelRegistryControlPlaneSnapshot(
                createSupabaseExperimentTrackingStore(getSupabaseServer()),
                tenantId,
                { readOnly: true },
            );

            const cards = snapshot.families.flatMap((family) => family.entries.map((entry) => ({
                model_family: family.model_family,
                registry_id: entry.registry.registry_id,
                model_name: entry.registry.model_name,
                model_version: entry.registry.model_version,
                lifecycle_status: entry.registry.lifecycle_status,
                registry_role: entry.registry.registry_role,
                deployment_decision: entry.decision_panel.deployment_decision,
                promotion_eligibility: entry.decision_panel.promotion_eligibility,
                scorecard: entry.clinical_scorecard,
                gates: entry.promotion_gating.gates,
                dataset_version: entry.registry.dataset_version,
                feature_schema_version: entry.registry.feature_schema_version,
                label_policy_version: entry.registry.label_policy_version,
                updated_at: entry.registry.updated_at,
            })));

            return NextResponse.json({
                tenant_id: tenantId,
                refreshed_at: snapshot.refreshed_at,
                cards,
            });
        },
    });
}
