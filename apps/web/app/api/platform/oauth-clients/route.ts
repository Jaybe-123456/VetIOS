import { NextResponse } from 'next/server';
import { buildForbiddenRouteResponse, buildRouteAuthorizationContext } from '@/lib/auth/authorization';
import { enforceVetiosHighRiskRouteGate } from '@/lib/auth/authTrustRouteGate';
import {
    bindOAuthClientMtlsCertificate,
    createOAuthClient,
    listOAuthClients,
    retireOAuthClientMtlsCertificate,
    revokeOAuthClient,
    rotateOAuthClientSecret,
    sanitizeOAuthClient,
} from '@/lib/auth/oauthClientCredentials';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type OAuthClientAction =
    | {
        action: 'create_oauth_client';
        client_name?: string;
        allowed_scopes?: string[];
        token_ttl_seconds?: number | null;
        allowed_origins?: string[];
        allowed_ip_cidrs?: string[];
        jwks?: Record<string, unknown>;
        client_auth_methods?: string[];
        assertion_algorithms?: string[];
        assertion_audiences?: string[];
        assertion_max_ttl_seconds?: number | null;
        mtls_required?: boolean | null;
        mtls_cert_thumbprints?: string[];
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'rotate_oauth_client_secret';
        oauth_client_id?: string;
    }
    | {
        action: 'revoke_oauth_client';
        oauth_client_id?: string;
    }
    | {
        action: 'bind_oauth_client_mtls_certificate';
        oauth_client_id?: string;
        certificate_thumbprint?: string;
    }
    | {
        action: 'retire_oauth_client_mtls_certificate';
        oauth_client_id?: string;
        certificate_thumbprint?: string;
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
            route: 'api/platform/oauth-clients:GET',
            requirement: 'admin',
        });
    }

    const clients = await listOAuthClients(client, context.tenantId);
    const response = NextResponse.json({
        oauth_clients: clients.map(sanitizeOAuthClient),
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 8, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const parsed = await safeJson<OAuthClientAction>(req);
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
            route: `api/platform/oauth-clients:${parsed.data.action ?? 'unknown'}`,
            requirement: 'admin',
        });
    }

    const trustAction = parsed.data.action === 'revoke_oauth_client'
        || parsed.data.action === 'retire_oauth_client_mtls_certificate'
        ? 'api_credential.revoke'
        : 'api_credential.create';
    const trustGate = await enforceVetiosHighRiskRouteGate({
        client,
        requestId,
        context,
        actionKey: trustAction,
        resource: {
            type: 'oauth_client',
            id: 'oauth_client_id' in parsed.data ? parsed.data.oauth_client_id ?? null : null,
            tenantId: context.tenantId,
        },
        evidence: {
            route: 'api/platform/oauth-clients',
            requested_action: parsed.data.action,
        },
    });
    if (!trustGate.ok) {
        withRequestHeaders(trustGate.response.headers, requestId, startTime);
        return trustGate.response;
    }

    try {
        let result: Record<string, unknown>;
        if (parsed.data.action === 'create_oauth_client') {
            const created = await createOAuthClient({
                client,
                tenantId: context.tenantId,
                actor: context.userId,
                clientName: parsed.data.client_name ?? '',
                allowedScopes: parsed.data.allowed_scopes ?? [],
                tokenTtlSeconds: parsed.data.token_ttl_seconds ?? null,
                allowedOrigins: parsed.data.allowed_origins ?? [],
                allowedIpCidrs: parsed.data.allowed_ip_cidrs ?? [],
                jwks: asRecord(parsed.data.jwks),
                clientAuthMethods: parsed.data.client_auth_methods ?? null,
                assertionAlgorithms: parsed.data.assertion_algorithms ?? null,
                assertionAudiences: parsed.data.assertion_audiences ?? null,
                assertionMaxTtlSeconds: parsed.data.assertion_max_ttl_seconds ?? null,
                mtlsRequired: parsed.data.mtls_required ?? null,
                mtlsCertThumbprints: parsed.data.mtls_cert_thumbprints ?? null,
                metadata: asRecord(parsed.data.metadata),
            });
            result = {
                oauth_client: sanitizeOAuthClient(created.oauthClient),
                generated_client_secret: created.clientSecret,
            };
        } else if (parsed.data.action === 'rotate_oauth_client_secret') {
            const rotated = await rotateOAuthClientSecret({
                client,
                tenantId: context.tenantId,
                actor: context.userId,
                oauthClientId: requireText(parsed.data.oauth_client_id, 'oauth_client_id'),
            });
            result = {
                oauth_client: sanitizeOAuthClient(rotated.oauthClient),
                generated_client_secret: rotated.clientSecret,
            };
        } else if (parsed.data.action === 'revoke_oauth_client') {
            const revoked = await revokeOAuthClient({
                client,
                tenantId: context.tenantId,
                actor: context.userId,
                oauthClientId: requireText(parsed.data.oauth_client_id, 'oauth_client_id'),
            });
            result = {
                oauth_client: sanitizeOAuthClient(revoked),
            };
        } else if (parsed.data.action === 'bind_oauth_client_mtls_certificate') {
            const bound = await bindOAuthClientMtlsCertificate({
                client,
                tenantId: context.tenantId,
                actor: context.userId,
                oauthClientId: requireText(parsed.data.oauth_client_id, 'oauth_client_id'),
                certificateThumbprint: requireText(
                    parsed.data.certificate_thumbprint,
                    'certificate_thumbprint',
                ),
            });
            result = {
                oauth_client: sanitizeOAuthClient(bound),
            };
        } else if (parsed.data.action === 'retire_oauth_client_mtls_certificate') {
            const retired = await retireOAuthClientMtlsCertificate({
                client,
                tenantId: context.tenantId,
                actor: context.userId,
                oauthClientId: requireText(parsed.data.oauth_client_id, 'oauth_client_id'),
                certificateThumbprint: requireText(
                    parsed.data.certificate_thumbprint,
                    'certificate_thumbprint',
                ),
            });
            result = {
                oauth_client: sanitizeOAuthClient(retired),
            };
        } else {
            return NextResponse.json({ error: 'Unsupported OAuth client action.', request_id: requestId }, { status: 400 });
        }

        const response = NextResponse.json({ ...result, request_id: requestId });
        withRequestHeaders(response.headers, requestId, startTime);
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'OAuth client action failed.', request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        response.headers.set('Cache-Control', 'no-store');
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

function requireText(value: string | undefined, field: string): string {
    if (!value || value.trim().length === 0) {
        throw new Error(`${field} is required.`);
    }
    return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
