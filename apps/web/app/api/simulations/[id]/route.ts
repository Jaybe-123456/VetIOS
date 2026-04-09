import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { requirePlatformRequestContext } from '@/lib/platform/route';
import { PlatformAuthError } from '@/lib/platform/tenantContext';

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
            return NextResponse.json({
                data: null,
                meta: {
                    tenant_id: null,
                    timestamp: new Date().toISOString(),
                    version: '2026-04-08',
                },
                error: {
                    code: 'tenant_missing',
                    message: 'tenant_id is required for simulation status.',
                },
            }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('simulations')
            .select('id,status,completed,total,summary,error_message')
            .eq('tenant_id', resolvedTenantId)
            .eq('id', params.id)
            .maybeSingle();

        if (error) {
            throw error;
        }

        return NextResponse.json({
            data: data ?? null,
            meta: {
                tenant_id: resolvedTenantId,
                timestamp: new Date().toISOString(),
                version: '2026-04-08',
            },
            error: null,
        });
    } catch (error) {
        return NextResponse.json({
            data: null,
            meta: {
                tenant_id: null,
                timestamp: new Date().toISOString(),
                version: '2026-04-08',
            },
            error: {
                code: error instanceof PlatformAuthError ? error.code : 'simulation_status_failed',
                message: error instanceof Error ? error.message : 'Failed to load simulation status.',
            },
        }, { status: error instanceof PlatformAuthError ? error.status : 500 });
    }
}
