import { getSupabaseServer } from '@/lib/supabaseServer';
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
