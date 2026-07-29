import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { enforceVetiosClinicalActorGate } from '@/lib/auth/authTrustRouteGate';
import {
    loadOutcomeCalibrationMaterializationSnapshot,
    runOutcomeCalibrationMaterialization,
} from '@/lib/evaluation/outcomeCalibrationMaterializer';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
    mode: z.enum(['dry_run', 'commit']).default('dry_run'),
    minimum_required_outcomes: z.number().int().min(5).max(10_000).optional(),
    source_limit: z.number().int().min(1).max(20_000).optional(),
});

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 12, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const client = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client,
        requiredScopes: ['evaluation:read'],
    });

    if (auth.error || !auth.actor) {
        const response = NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    try {
        const url = new URL(req.url);
        const minimumRequiredOutcomes = parseOptionalInteger(
            url.searchParams.get('minimum_required_outcomes'),
        );
        const sourceLimit = parseOptionalInteger(url.searchParams.get('source_limit'));
        const snapshot = await loadOutcomeCalibrationMaterializationSnapshot(client, {
            tenantId: auth.actor.tenantId,
            requestId,
            minimumRequiredOutcomes,
            sourceLimit,
        });
        const response = NextResponse.json({
            data: snapshot,
            meta: {
                tenant_id: auth.actor.tenantId,
                request_id: requestId,
                generated_at: new Date().toISOString(),
                version: snapshot.execution.algorithm_version,
            },
            error: null,
        });
        response.headers.set('Cache-Control', 'private, no-store');
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json({
            error: 'outcome_calibration_snapshot_unavailable',
            detail: error instanceof Error ? error.message : 'Unknown materialization error.',
            request_id: requestId,
        }, { status: 503 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 8, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const client = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client,
        requiredScopes: ['evaluation:write'],
    });

    if (auth.error || !auth.actor) {
        const response = NextResponse.json(
            { error: 'Unauthorized', request_id: requestId },
            { status: 401 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
        const response = NextResponse.json({
            error: 'invalid_input',
            detail: parsed.error.flatten(),
            request_id: requestId,
        }, { status: 400 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    if (parsed.data.mode === 'commit') {
        const trustGate = await enforceVetiosClinicalActorGate({
            client: client as unknown as Parameters<
                typeof enforceVetiosClinicalActorGate
            >[0]['client'],
            requestId,
            actor: auth.actor,
            actionKey: 'outcome.calibration.materialize',
            resource: {
                type: 'outcome_calibration_evidence',
                tenantId: auth.actor.tenantId,
            },
            evidence: {
                materialization_mode: parsed.data.mode,
                source_limit: parsed.data.source_limit ?? null,
            },
        });
        if (!trustGate.ok) return trustGate.response;
    }

    try {
        const execution = await runOutcomeCalibrationMaterialization(client, {
            tenantId: auth.actor.tenantId,
            requestId,
            mode: parsed.data.mode,
            runKind: 'manual_recompute',
            minimumRequiredOutcomes: parsed.data.minimum_required_outcomes,
            sourceLimit: parsed.data.source_limit,
        });
        const response = NextResponse.json({
            data: execution,
            meta: {
                tenant_id: auth.actor.tenantId,
                request_id: requestId,
                completed_at: new Date().toISOString(),
                version: execution.algorithm_version,
            },
            error: null,
        }, { status: parsed.data.mode === 'commit' ? 201 : 200 });
        response.headers.set('Cache-Control', 'private, no-store');
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json({
            error: 'outcome_calibration_materialization_failed',
            detail: error instanceof Error ? error.message : 'Unknown materialization error.',
            request_id: requestId,
        }, { status: 503 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

function parseOptionalInteger(value: string | null): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}
