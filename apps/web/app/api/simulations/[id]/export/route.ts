import { getSupabaseServer } from '@/lib/supabaseServer';
import { enforceVetiosPlatformActorGate } from '@/lib/auth/authTrustRouteGate';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';
import { assertSimulationTenantAccess, exportSimulationEventsCsv } from '@/lib/platform/simulations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    req: Request,
    context: { params: Promise<{ id: string }> },
) {
    const params = await context.params;
    const supabase = getSupabaseServer();
    const requestId = crypto.randomUUID();

    try {
        const requestedTenantId = new URL(req.url).searchParams.get('tenant_id');
        const { actor, tenantId } = await requirePlatformRequestContext(req, supabase, {
            requiredScopes: ['simulation:write'],
            requestedTenantId: requestedTenantId ?? undefined,
        });
        const resolvedTenantId = tenantId ?? actor.tenantId;
        if (!resolvedTenantId) {
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required.');
        }

        const trustGate = await enforceVetiosPlatformActorGate({
            client: supabase as unknown as Parameters<typeof enforceVetiosPlatformActorGate>[0]['client'],
            requestId,
            actor,
            tenantId: resolvedTenantId,
            actionKey: 'dataset.simulation.export',
            resource: {
                type: 'simulation_export',
                id: params.id,
                tenantId: resolvedTenantId,
            },
            evidence: {
                route: 'api/simulations/[id]/export',
                requested_tenant_id: requestedTenantId,
                content_type: 'text/csv',
            },
        });
        if (!trustGate.ok) {
            return trustGate.response;
        }

        await assertSimulationTenantAccess(supabase, {
            tenantId: resolvedTenantId,
            simulationId: params.id,
        });

        const csv = await exportSimulationEventsCsv(supabase, {
            tenantId: resolvedTenantId,
            simulationId: params.id,
        });

        return new Response(csv, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="simulation-${params.id}.csv"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Failed to export simulation.', {
            status: error instanceof PlatformAuthError ? error.status : 500,
        });
    }
}
