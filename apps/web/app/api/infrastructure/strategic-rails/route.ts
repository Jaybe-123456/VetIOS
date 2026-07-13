import { NextResponse } from 'next/server';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { buildStrategicRailsPacket } from '@/lib/infrastructure/strategicRails';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 60,
        windowMs: 60_000,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['evaluation:read'],
    });
    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 }),
            requestId,
            startTime,
        );
    }

    const packet = buildStrategicRailsPacket();
    return withHeaders(
        NextResponse.json({
            packet,
            actor: {
                tenant_id: auth.actor.tenantId,
                auth_mode: auth.actor.authMode,
                principal_label: auth.actor.principalLabel,
            },
            request_id: requestId,
            error: null,
        }),
        requestId,
        startTime,
    );
}

function withHeaders(response: NextResponse, requestId: string, startTime: number) {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
