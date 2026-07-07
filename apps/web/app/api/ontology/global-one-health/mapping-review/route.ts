import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    recordExternalValidationEvent,
    recordMappingReviewEvent,
} from '@/lib/inference/globalOntologyMappingReview';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MappingReviewSchema = z.discriminatedUnion('event_type', [
    z.object({
        event_type: z.literal('mapping_review'),
        request_id: z.string().trim().min(1).max(160),
        source_mapping_event_id: z.string().uuid().optional(),
        condition_key: z.string().trim().min(1).max(160),
        source_key: z.string().trim().min(1).max(160),
        external_code_system: z.string().trim().max(80).optional(),
        external_code: z.string().trim().max(160).optional(),
        prior_mapping_status: z.string().trim().max(80).optional(),
        review_action: z.enum(['queued', 'approve', 'reject', 'request_external_validation', 'deprecate']),
        reviewer_role: z.string().trim().max(120).optional(),
        reviewer_ref: z.string().trim().max(160).optional(),
        review_confidence: z.number().min(0).max(1).optional(),
        evidence: z.record(z.string(), z.unknown()).optional(),
        observed_at: z.string().datetime().optional(),
    }),
    z.object({
        event_type: z.literal('external_validation'),
        request_id: z.string().trim().min(1).max(160),
        source_mapping_event_id: z.string().uuid().optional(),
        review_event_id: z.string().uuid().optional(),
        condition_key: z.string().trim().min(1).max(160),
        source_key: z.string().trim().min(1).max(160),
        external_code_system: z.string().trim().max(80).optional(),
        external_code: z.string().trim().max(160).optional(),
        validation_provider: z.string().trim().min(1).max(180),
        validation_method: z.enum([
            'external_review',
            'source_owner_confirmation',
            'licensed_terminology_audit',
            'public_health_authority_review',
            'third_party_conformance',
        ]),
        validation_status: z.enum(['pending', 'externally_verified', 'rejected', 'insufficient_evidence', 'expired']),
        validation_confidence: z.number().min(0).max(1).optional(),
        validation_artifact_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        evidence: z.record(z.string(), z.unknown()).optional(),
        observed_at: z.string().datetime().optional(),
    }),
]);

export async function POST(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 10,
        windowMs: 60_000,
        maxBodySize: 128 * 1024,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['rag:write'],
    });
    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }),
            requestId,
            startTime,
        );
    }

    const json = await safeJson(req);
    if (!json.ok) {
        return withHeaders(
            NextResponse.json({ error: json.error, request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const parsed = MappingReviewSchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(
            NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    if (parsed.data.event_type === 'mapping_review') {
        const result = await recordMappingReviewEvent(
            supabase as unknown as Parameters<typeof recordMappingReviewEvent>[0],
            {
                tenantId: auth.actor.tenantId,
                requestId: parsed.data.request_id,
                sourceMappingEventId: parsed.data.source_mapping_event_id ?? null,
                conditionKey: parsed.data.condition_key,
                sourceKey: parsed.data.source_key,
                externalCodeSystem: parsed.data.external_code_system ?? null,
                externalCode: parsed.data.external_code ?? null,
                priorMappingStatus: parsed.data.prior_mapping_status ?? null,
                reviewAction: parsed.data.review_action,
                reviewerRole: parsed.data.reviewer_role ?? null,
                reviewerRef: parsed.data.reviewer_ref ?? null,
                reviewConfidence: parsed.data.review_confidence ?? null,
                evidence: parsed.data.evidence,
                observedAt: parsed.data.observed_at ?? null,
            },
        );

        return withHeaders(
            NextResponse.json({
                status: result.error ? 'failed' : 'recorded',
                request_id: requestId,
                review_event_id: result.id,
                error: result.error,
            }, { status: result.error ? 500 : 201 }),
            requestId,
            startTime,
        );
    }

    const result = await recordExternalValidationEvent(
        supabase as unknown as Parameters<typeof recordExternalValidationEvent>[0],
        {
            tenantId: auth.actor.tenantId,
            requestId: parsed.data.request_id,
            sourceMappingEventId: parsed.data.source_mapping_event_id ?? null,
            reviewEventId: parsed.data.review_event_id ?? null,
            conditionKey: parsed.data.condition_key,
            sourceKey: parsed.data.source_key,
            externalCodeSystem: parsed.data.external_code_system ?? null,
            externalCode: parsed.data.external_code ?? null,
            validationProvider: parsed.data.validation_provider,
            validationMethod: parsed.data.validation_method,
            validationStatus: parsed.data.validation_status,
            validationConfidence: parsed.data.validation_confidence ?? null,
            validationArtifactHash: parsed.data.validation_artifact_hash ?? null,
            evidence: parsed.data.evidence,
            observedAt: parsed.data.observed_at ?? null,
        },
    );

    return withHeaders(
        NextResponse.json({
            status: result.error ? 'failed' : 'recorded',
            request_id: requestId,
            external_validation_event_id: result.id,
            error: result.error,
        }, { status: result.error ? 500 : 201 }),
        requestId,
        startTime,
    );
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
