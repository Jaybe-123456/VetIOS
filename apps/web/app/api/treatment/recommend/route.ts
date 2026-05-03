import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { formatZodErrors, TreatmentRecommendRequestSchema } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { recommendTreatmentPathways } from '@/lib/treatmentIntelligence/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const tenantId = session?.tenantId ?? process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001';
    const parsed = await safeJson(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const result = TreatmentRecommendRequestSchema.safeParse(parsed.data);
    if (!result.success) {
        return NextResponse.json({ error: formatZodErrors(result.error), request_id: requestId }, { status: 400 });
    }

    try {
        const recommendation = await recommendTreatmentPathways(getSupabaseServer(), {
            tenantId,
            inferenceEventId: result.data.inference_event_id,
            context: {
                resource_profile: result.data.context.resource_profile,
                regulatory_region: result.data.context.regulatory_region ?? null,
                care_environment: result.data.context.care_environment ?? null,
                comorbidities: result.data.context.comorbidities,
                lab_flags: result.data.context.lab_flags,
            },
        });

        if (recommendation.bundle.contraindication_flags.length > 0) {
            void getSupabaseServer()
                .from('ai_inference_events')
                .update({
                    compute_profile: {
                        treatment_contraindication_feedback: {
                            flags: recommendation.bundle.contraindication_flags,
                            management_mode: recommendation.bundle.management_mode,
                            flagged_at: new Date().toISOString(),
                        },
                    },
                })
                .eq('id', result.data.inference_event_id)
                .then(({ error }) => {
                    if (error) {
                        console.error(`[${requestId}] Treatment->inference feedback failed:`, error);
                    }
                });
        }

        const response = NextResponse.json({
            request_id: requestId,
            case_id: recommendation.caseId,
            episode_id: recommendation.episodeId,
            treatment_inference_tension: recommendation.bundle.contraindication_flags.length > 0
                ? {
                    flags: recommendation.bundle.contraindication_flags,
                    management_mode: recommendation.bundle.management_mode,
                }
                : null,
            ...recommendation.bundle,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] POST /api/treatment/recommend error:`, error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to build treatment recommendations.', request_id: requestId },
            { status: 500 },
        );
    }
}
