import { NextResponse } from 'next/server';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { upsertCalibrationEvaluation } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';

export async function GET(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const actor = await resolveExperimentApiActor(req);
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const calibration = await store.getCalibrationMetrics(tenantId, runId);

    const response = NextResponse.json({ calibration, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(
    req: Request,
    context: { params: Promise<{ runId: string }> },
) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<{
        tenant_id?: string;
        ece?: number | null;
        brier_score?: number | null;
        reliability_bins?: Array<{ confidence: number; accuracy: number; count?: number }>;
        confidence_histogram?: Array<{ confidence: number; count?: number }>;
        calibration_pass?: boolean | null;
        calibration_notes?: string | null;
    }>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
        tenantIdHint: body.data.tenant_id ?? null,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const tenantId = actor?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const { runId } = await context.params;
    const store = createSupabaseExperimentTrackingStore(getSupabaseServer());
    const calibration = await upsertCalibrationEvaluation(store, tenantId, runId, {
        ece: body.data.ece ?? null,
        brierScore: body.data.brier_score ?? null,
        reliabilityBins: body.data.reliability_bins,
        confidenceHistogram: body.data.confidence_histogram,
        calibrationPass: body.data.calibration_pass ?? null,
        calibrationNotes: body.data.calibration_notes ?? null,
    }, actor?.userId ?? null);

    const response = NextResponse.json({
        calibration,
        authenticated_user_id: actor?.userId ?? null,
        auth_mode: actor?.authMode ?? 'dev_bypass',
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
