import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';
import { assertSimulationTenantAccess, cancelSimulationRun, getSimulationDetail, resolveSimulationProgress } from '@/lib/platform/simulations';

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
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required for simulation status.');
        }
        await assertSimulationTenantAccess(supabase, {
            tenantId: resolvedTenantId,
            simulationId: params.id,
        });

        const detail = await getSimulationDetail(supabase, {
            tenantId: resolvedTenantId,
            simulationId: params.id,
            eventLimit: Number(new URL(req.url).searchParams.get('limit') ?? '100'),
        });
        const progress = await resolveSimulationProgress(supabase, {
            tenantId: resolvedTenantId,
            simulationId: params.id,
        });

        return NextResponse.json({
            data: detail
                ? {
                    ...detail,
                    progress,
                }
                : null,
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

export async function DELETE(
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
            throw new PlatformAuthError(400, 'tenant_missing', 'tenant_id is required for simulation cancellation.');
        }
        await assertSimulationTenantAccess(supabase, {
            tenantId: resolvedTenantId,
            simulationId: params.id,
        });

        const simulation = await cancelSimulationRun(supabase, {
            actor,
            tenantId: resolvedTenantId,
            simulationId: params.id,
        });

        return NextResponse.json({
            data: simulation,
            meta: {
                tenant_id: resolvedTenantId,
                timestamp: new Date().toISOString(),
                simulation_id: params.id,
            },
            error: null,
        });
    } catch (error) {
        const status = typeof (error as { status?: number })?.status === 'number'
            ? (error as { status: number }).status
            : error instanceof PlatformAuthError
                ? error.status
                : 500;
        return NextResponse.json({
            data: null,
            meta: {
                tenant_id: null,
                timestamp: new Date().toISOString(),
                simulation_id: params.id,
            },
            error: {
                code: error instanceof PlatformAuthError ? error.code : status === 409 ? 'simulation_cancel_conflict' : 'simulation_cancel_failed',
                message: error instanceof Error ? error.message : 'Failed to cancel simulation.',
            },
        }, { status });
    }
}
