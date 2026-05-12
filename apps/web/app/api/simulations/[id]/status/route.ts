import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';
import { assertSimulationTenantAccess, getSimulationStatusPayload } from '@/lib/platform/simulations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required for simulation status.');
        }

        await assertSimulationTenantAccess(supabase, {
            tenantId: resolvedTenantId,
            simulationId: params.id,
        });

        const status = await getSimulationStatusPayload(supabase, {
            tenantId: resolvedTenantId,
            simulationId: params.id,
        });

        if (!status) {
            return NextResponse.json({
                data: null,
                meta: {
                    tenant_id: resolvedTenantId,
                    timestamp: new Date().toISOString(),
                    simulation_id: params.id,
                },
                error: { code: 'simulation_not_found', message: 'Simulation not found.' },
            }, { status: 404 });
        }

        return NextResponse.json({
            data: status,
            meta: {
                tenant_id: resolvedTenantId,
                timestamp: new Date().toISOString(),
                simulation_id: params.id,
            },
            error: null,
        });
    } catch (error) {
        return NextResponse.json({
            data: null,
            meta: {
                tenant_id: null,
                timestamp: new Date().toISOString(),
                simulation_id: params.id,
            },
            error: {
                code: error instanceof PlatformAuthError ? error.code : 'simulation_status_failed',
                message: error instanceof Error ? error.message : 'Failed to load simulation status.',
            },
        }, { status: error instanceof PlatformAuthError ? error.status : 500 });
    }
}
