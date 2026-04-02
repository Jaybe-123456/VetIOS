import { NextResponse } from 'next/server';
import { buildForbiddenRouteResponse, buildRouteAuthorizationContext } from '@/lib/auth/authorization';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import {
    createModelAttestation,
    createModelCertification,
    getModelTrustSnapshot,
    publishModelCard,
} from '@/lib/modelTrust/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ModelTrustAction =
    | {
        action: 'publish_model_card';
        registry_id?: string;
        public_slug?: string;
        publication_status?: 'draft' | 'published' | 'retired';
        summary_override?: string | null;
        intended_use?: string | null;
        limitations?: string | null;
        review_notes?: string | null;
    }
    | {
        action: 'create_certification';
        registry_id?: string;
        publication_id?: string | null;
        certification_name?: string;
        issuer_name?: string;
        status?: 'pending' | 'active' | 'expired' | 'revoked';
        certificate_ref?: string | null;
        valid_from?: string | null;
        valid_until?: string | null;
    }
    | {
        action: 'create_attestation';
        registry_id?: string;
        publication_id?: string | null;
        attestation_type?: string;
        attestor_name?: string;
        status?: 'pending' | 'accepted' | 'rejected';
        evidence_uri?: string | null;
        summary?: string;
        attested_at?: string | null;
    };

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const client = getSupabaseServer();
    const context = await resolveAdminContext(session);
    if (context.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: 'api/platform/model-trust:GET',
            requirement: 'admin',
        });
    }

    const snapshot = await getModelTrustSnapshot(client, context.tenantId);
    const response = NextResponse.json({ snapshot, request_id: requestId });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const parsed = await safeJson<ModelTrustAction>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const client = getSupabaseServer();
    const context = await resolveAdminContext(session);
    if (context.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client,
            requestId,
            context,
            route: `api/platform/model-trust:${parsed.data.action ?? 'unknown'}`,
            requirement: 'admin',
        });
    }

    try {
        let result: Record<string, unknown> = {};
        if (parsed.data.action === 'publish_model_card') {
            result.publication = await publishModelCard(client, {
                tenantId: context.tenantId,
                actor: context.userId,
                registryId: parsed.data.registry_id ?? '',
                publicSlug: parsed.data.public_slug ?? '',
                publicationStatus: parsed.data.publication_status ?? 'published',
                summaryOverride: parsed.data.summary_override ?? null,
                intendedUse: parsed.data.intended_use ?? null,
                limitations: parsed.data.limitations ?? null,
                reviewNotes: parsed.data.review_notes ?? null,
            });
        } else if (parsed.data.action === 'create_certification') {
            result.certification = await createModelCertification(client, {
                tenantId: context.tenantId,
                actor: context.userId,
                registryId: parsed.data.registry_id ?? '',
                publicationId: parsed.data.publication_id ?? null,
                certificationName: parsed.data.certification_name ?? '',
                issuerName: parsed.data.issuer_name ?? '',
                status: parsed.data.status ?? 'pending',
                certificateRef: parsed.data.certificate_ref ?? null,
                validFrom: parsed.data.valid_from ?? null,
                validUntil: parsed.data.valid_until ?? null,
            });
        } else if (parsed.data.action === 'create_attestation') {
            result.attestation = await createModelAttestation(client, {
                tenantId: context.tenantId,
                actor: context.userId,
                registryId: parsed.data.registry_id ?? '',
                publicationId: parsed.data.publication_id ?? null,
                attestationType: parsed.data.attestation_type ?? '',
                attestorName: parsed.data.attestor_name ?? '',
                status: parsed.data.status ?? 'pending',
                evidenceUri: parsed.data.evidence_uri ?? null,
                summary: parsed.data.summary ?? '',
                attestedAt: parsed.data.attested_at ?? null,
            });
        } else {
            return NextResponse.json({ error: 'Unsupported model-trust action.', request_id: requestId }, { status: 400 });
        }

        const snapshot = await getModelTrustSnapshot(client, context.tenantId);
        const response = NextResponse.json({ ...result, snapshot, request_id: requestId });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Model-trust action failed.', request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function resolveAdminContext(session: Awaited<ReturnType<typeof resolveSessionTenant>>) {
    if (session) {
        const actor = resolveRequestActor(session);
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        return buildRouteAuthorizationContext({
            tenantId: actor.tenantId,
            userId: actor.userId,
            authMode: 'session',
            user,
        });
    }

    return buildRouteAuthorizationContext({
        tenantId: process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        userId: process.env.VETIOS_DEV_USER_ID ?? null,
        authMode: process.env.VETIOS_DEV_BYPASS === 'true' ? 'dev_bypass' : 'session',
        user: null,
    });
}
