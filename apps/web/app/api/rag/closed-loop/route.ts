import { NextResponse } from 'next/server';
import { evaluateRagReadiness } from '@/lib/agenticRag/automation';
import { buildRagClosedLoopLearningSystem } from '@/lib/agenticRag/closedLoop';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { writeSelfProtectionEvent } from '@/lib/protection/securityEventLog';
import { assessVetiosSelfProtectionRequest, buildVetiosSelfProtectionPosture } from '@/lib/protection/selfProtection';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const protection = assessVetiosSelfProtectionRequest(req);
    if (protection.blocked) {
        writeSelfProtectionEvent({
            req,
            requestId,
            assessment: protection,
            eventType: 'self_protection_blocked',
        });
        return withHeaders(NextResponse.json({
            error: 'Forbidden',
            code: 'VETIOS_SELF_PROTECTION_BLOCKED',
            risk_level: protection.risk_level,
            request_id: requestId,
        }, { status: 403 }), requestId, startTime, protection.protection_headers);
    }

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['rag:read'] });
    if (auth.error || !auth.actor) {
        return withHeaders(NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }), requestId, startTime, protection.protection_headers);
    }

    if (shouldPersistProtectionEvent(protection)) {
        writeSelfProtectionEvent({
            req,
            requestId,
            tenantId: auth.actor.tenantId,
            assessment: protection,
        });
    }

    const readiness = await evaluateRagReadiness(supabase, auth.actor.tenantId);
    const closedLoop = buildRagClosedLoopLearningSystem(readiness);
    const selfProtection = buildVetiosSelfProtectionPosture();

    return withHeaders(NextResponse.json({
        closed_loop: closedLoop,
        self_protection: selfProtection,
        request_assessment: protection,
        request_id: requestId,
    }), requestId, startTime, protection.protection_headers);
}

function shouldPersistProtectionEvent(protection: { blocked: boolean; clone_suspected: boolean; risk_score: number }): boolean {
    return protection.blocked || protection.clone_suspected || protection.risk_score >= 20;
}

function withHeaders(
    response: NextResponse,
    requestId: string,
    startTime: number,
    protectionHeaders: Record<string, string>,
): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    for (const [name, value] of Object.entries(protectionHeaders)) {
        response.headers.set(name, value);
    }
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
