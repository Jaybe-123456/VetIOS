import { NextResponse } from 'next/server';
import { buildForbiddenRouteResponse, buildRouteAuthorizationContext } from '@/lib/auth/authorization';
import {
    createConnectorInstallationWithCredential,
    createServiceAccountWithCredential,
    issueConnectorInstallationCredential,
    issueServiceAccountCredential,
    listApiCredentials,
    listConnectorInstallations,
    listServiceAccounts,
    revokeApiCredential,
    type MachineCredentialScope,
} from '@/lib/auth/machineAuth';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MachineAuthAction =
    | {
        action: 'create_service_account';
        name?: string;
        description?: string | null;
        label?: string | null;
        scopes?: string[];
        metadata?: Record<string, unknown>;
        expires_at?: string | null;
    }
    | {
        action: 'issue_service_account_credential';
        service_account_id?: string;
        label?: string;
        scopes?: string[];
        metadata?: Record<string, unknown>;
        expires_at?: string | null;
    }
    | {
        action: 'create_connector_installation';
        installation_name?: string;
        connector_type?: string;
        vendor_name?: string | null;
        vendor_account_ref?: string | null;
        label?: string | null;
        scopes?: string[];
        metadata?: Record<string, unknown>;
        expires_at?: string | null;
    }
    | {
        action: 'issue_connector_installation_credential';
        connector_installation_id?: string;
        label?: string;
        scopes?: string[];
        metadata?: Record<string, unknown>;
        expires_at?: string | null;
    }
    | {
        action: 'revoke_api_credential';
        credential_id?: string;
    };

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authorizationContext = await resolveMachineAuthRouteContext(session);
    if (authorizationContext.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authorizationContext,
            route: 'api/platform/machine-auth:GET',
            requirement: 'admin',
        });
    }
    const auth = buildMachineAuthAdminActor(authorizationContext);

    const [serviceAccounts, connectorInstallations, apiCredentials] = await Promise.all([
        listServiceAccounts(adminClient, auth.actor.tenantId),
        listConnectorInstallations(adminClient, auth.actor.tenantId),
        listApiCredentials(adminClient, auth.actor.tenantId),
    ]);

    const response = NextResponse.json({
        service_accounts: serviceAccounts,
        connector_installations: connectorInstallations,
        api_credentials: apiCredentials.map((credential) => sanitizeCredentialRecord(credential)),
        request_id: requestId,
    });
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

    const parsed = await safeJson<MachineAuthAction>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const adminClient = getSupabaseServer();
    const authorizationContext = await resolveMachineAuthRouteContext(session);
    if (authorizationContext.role !== 'admin') {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authorizationContext,
            route: `api/platform/machine-auth:${parsed.data.action ?? 'unknown'}`,
            requirement: 'admin',
        });
    }
    const auth = buildMachineAuthAdminActor(authorizationContext);

    const payload = parsed.data;

    try {
        let actionResult: Record<string, unknown>;
        if (payload.action === 'create_service_account') {
            const generated = await createServiceAccountWithCredential({
                client: adminClient,
                tenantId: auth.actor.tenantId,
                actor: auth.actor.userId,
                name: payload.name ?? '',
                description: payload.description ?? null,
                label: payload.label ?? null,
                scopes: normalizeScopes(payload.scopes, ['inference:write']),
                metadata: asRecord(payload.metadata),
                expiresAt: payload.expires_at ?? null,
            });

            actionResult = {
                service_account: generated.serviceAccount,
                api_credential: sanitizeCredentialRecord(generated.credential),
                generated_api_key: generated.apiKey,
            };
        } else if (payload.action === 'issue_service_account_credential') {
            const issued = await issueServiceAccountCredential({
                client: adminClient,
                tenantId: auth.actor.tenantId,
                actor: auth.actor.userId,
                serviceAccountId: requireText(payload.service_account_id, 'service_account_id'),
                label: requireText(payload.label, 'label'),
                scopes: normalizeScopes(payload.scopes, ['inference:write']),
                metadata: asRecord(payload.metadata),
                expiresAt: payload.expires_at ?? null,
            });

            actionResult = {
                api_credential: sanitizeCredentialRecord(issued.credential),
                generated_api_key: issued.apiKey,
            };
        } else if (payload.action === 'create_connector_installation') {
            const created = await createConnectorInstallationWithCredential({
                client: adminClient,
                tenantId: auth.actor.tenantId,
                actor: auth.actor.userId,
                installationName: payload.installation_name ?? '',
                connectorType: payload.connector_type ?? '',
                vendorName: payload.vendor_name ?? null,
                vendorAccountRef: payload.vendor_account_ref ?? null,
                label: payload.label ?? null,
                scopes: normalizeScopes(payload.scopes, ['signals:connect', 'signals:ingest']),
                metadata: asRecord(payload.metadata),
                expiresAt: payload.expires_at ?? null,
            });

            actionResult = {
                connector_installation: created.installation,
                api_credential: sanitizeCredentialRecord(created.credential),
                generated_api_key: created.apiKey,
            };
        } else if (payload.action === 'issue_connector_installation_credential') {
            const issued = await issueConnectorInstallationCredential({
                client: adminClient,
                tenantId: auth.actor.tenantId,
                actor: auth.actor.userId,
                connectorInstallationId: requireText(payload.connector_installation_id, 'connector_installation_id'),
                label: requireText(payload.label, 'label'),
                scopes: normalizeScopes(payload.scopes, ['signals:connect', 'signals:ingest']),
                metadata: asRecord(payload.metadata),
                expiresAt: payload.expires_at ?? null,
            });

            actionResult = {
                api_credential: sanitizeCredentialRecord(issued.credential),
                generated_api_key: issued.apiKey,
            };
        } else if (payload.action === 'revoke_api_credential') {
            const credential = await revokeApiCredential({
                client: adminClient,
                tenantId: auth.actor.tenantId,
                actor: auth.actor.userId,
                credentialId: requireText(payload.credential_id, 'credential_id'),
            });
            actionResult = {
                api_credential: sanitizeCredentialRecord(credential),
            };
        } else {
            return NextResponse.json({ error: 'Unsupported machine-auth action.', request_id: requestId }, { status: 400 });
        }

        const response = NextResponse.json({
            ...actionResult,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Machine-auth action failed.', request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function resolveMachineAuthRouteContext(session: Awaited<ReturnType<typeof resolveSessionTenant>>) {
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

function buildMachineAuthAdminActor(context: ReturnType<typeof buildRouteAuthorizationContext>) {
    return {
        actor: {
            tenantId: context.tenantId,
            userId: context.userId,
        },
        user: context.user,
    };
}

function sanitizeCredentialRecord(record: {
    id: string;
    tenant_id: string;
    principal_type: string;
    service_account_id: string | null;
    connector_installation_id: string | null;
    label: string;
    key_prefix: string;
    scopes: readonly string[];
    status: string;
    expires_at: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    revoked_by: string | null;
    last_used_at: string | null;
    created_at: string;
    revoked_at: string | null;
}) {
    return {
        id: record.id,
        tenant_id: record.tenant_id,
        principal_type: record.principal_type,
        service_account_id: record.service_account_id,
        connector_installation_id: record.connector_installation_id,
        label: record.label,
        key_prefix: record.key_prefix,
        scopes: record.scopes,
        status: record.status,
        expires_at: record.expires_at,
        metadata: record.metadata,
        created_by: record.created_by,
        revoked_by: record.revoked_by,
        last_used_at: record.last_used_at,
        created_at: record.created_at,
        revoked_at: record.revoked_at,
    };
}

function normalizeScopes(input: string[] | undefined, fallback: MachineCredentialScope[]): MachineCredentialScope[] {
    const candidate = Array.isArray(input) ? input.filter((scope): scope is string => typeof scope === 'string') : [];
    return candidate.length > 0 ? candidate as MachineCredentialScope[] : fallback;
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
