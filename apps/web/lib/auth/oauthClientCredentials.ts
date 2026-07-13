import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashTrustSurfaceValue } from '@/lib/auth/authTrustFabric';
import {
    OAUTH_ACCESS_TOKENS,
    OAUTH_CLIENT_EVENTS,
    OAUTH_CLIENTS,
    OAUTH_TOKEN_EVENTS,
} from '@/lib/db/schemaContracts';

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const OAUTH_ACCESS_TOKEN_PREFIX = 'vetios_at_';
export const OAUTH_CLIENT_ID_PREFIX = 'vetios_oauth_';
export const OAUTH_CLIENT_SECRET_PREFIX = 'vetios_cs_';

export const OAUTH_CLIENT_CREDENTIAL_SCOPES = [
    'inference:write',
    'outcome:write',
    'simulation:write',
    'evaluation:write',
    'evaluation:read',
    'rag:read',
    'rag:write',
    'signals:ingest',
    'signals:connect',
    'signals:read',
    'federation:read',
    'federation:write',
    'federation:node',
    'federation:admin',
    'secure_aggregation:write',
    'machine:manage',
] as const;

export type OAuthClientCredentialScope = typeof OAUTH_CLIENT_CREDENTIAL_SCOPES[number];
export type OAuthClientStatus = 'active' | 'disabled' | 'revoked';
export type OAuthTokenStatus = 'active' | 'revoked' | 'expired';

export interface OAuthClientRecord {
    id: string;
    tenant_id: string;
    client_id: string;
    client_secret_hash: string;
    client_name: string;
    status: OAuthClientStatus;
    allowed_scopes: OAuthClientCredentialScope[];
    token_ttl_seconds: number;
    allowed_origins: string[];
    allowed_ip_cidrs: string[];
    jwks: Record<string, unknown>;
    metadata: Record<string, unknown>;
    created_by: string | null;
    revoked_by: string | null;
    last_used_at: string | null;
    rotated_at: string | null;
    revoked_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface OAuthAccessTokenRecord {
    id: string;
    tenant_id: string;
    oauth_client_id: string;
    token_hash: string;
    token_prefix: string;
    scopes: OAuthClientCredentialScope[];
    audience: string | null;
    status: OAuthTokenStatus;
    issued_at: string;
    expires_at: string;
    revoked_at: string | null;
    last_introspected_at: string | null;
    ip_hash: string | null;
    user_agent_hash: string | null;
    evidence: Record<string, unknown>;
    created_at: string;
}

export interface OAuthResolvedPrincipal {
    tenantId: string;
    oauthClientId: string;
    clientId: string;
    clientName: string;
    scopes: OAuthClientCredentialScope[];
    tokenId: string;
}

export function normalizeOAuthScopes(scopes: readonly string[] | string | null | undefined): OAuthClientCredentialScope[] {
    const input = typeof scopes === 'string'
        ? scopes.split(/\s+/)
        : Array.isArray(scopes)
            ? scopes
            : [];
    const allowed = new Set<string>(OAUTH_CLIENT_CREDENTIAL_SCOPES);
    return [...new Set(input
        .map((scope) => typeof scope === 'string' ? scope.trim() : '')
        .filter((scope): scope is OAuthClientCredentialScope => allowed.has(scope)))];
}

export async function listOAuthClients(
    client: SupabaseClient,
    tenantId: string,
): Promise<OAuthClientRecord[]> {
    const C = OAUTH_CLIENTS.COLUMNS;
    const { data, error } = await client
        .from(OAUTH_CLIENTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(100);

    if (error) {
        throw new Error(`Failed to list OAuth clients: ${error.message}`);
    }

    return (data ?? []).map((row) => mapOAuthClient(row as Record<string, unknown>));
}

export async function createOAuthClient(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    clientName: string;
    allowedScopes: readonly string[];
    tokenTtlSeconds?: number | null;
    allowedOrigins?: readonly string[] | null;
    allowedIpCidrs?: readonly string[] | null;
    metadata?: Record<string, unknown>;
}): Promise<{ oauthClient: OAuthClientRecord; clientSecret: string }> {
    const clientId = `${OAUTH_CLIENT_ID_PREFIX}${randomBytes(12).toString('hex')}`;
    const clientSecret = `${OAUTH_CLIENT_SECRET_PREFIX}${randomBytes(32).toString('hex')}`;
    const scopes = normalizeOAuthScopes(input.allowedScopes);
    if (scopes.length === 0) {
        throw new Error('At least one valid OAuth scope is required.');
    }

    const C = OAUTH_CLIENTS.COLUMNS;
    const { data, error } = await input.client
        .from(OAUTH_CLIENTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.client_id]: clientId,
            [C.client_secret_hash]: sha256Hex(clientSecret),
            [C.client_name]: normalizeRequiredText(input.clientName, 'client_name'),
            [C.status]: 'active',
            [C.allowed_scopes]: scopes,
            [C.token_ttl_seconds]: normalizeTokenTtl(input.tokenTtlSeconds),
            [C.allowed_origins]: normalizeTextArray(input.allowedOrigins),
            [C.allowed_ip_cidrs]: normalizeTextArray(input.allowedIpCidrs),
            [C.metadata]: input.metadata ?? {},
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create OAuth client: ${error?.message ?? 'Unknown error'}`);
    }

    const oauthClient = mapOAuthClient(data as Record<string, unknown>);
    await writeOAuthClientEvent(input.client, {
        tenantId: input.tenantId,
        requestId: `oauth_client_registered:${oauthClient.id}:${Date.now()}`,
        oauthClient,
        actor: input.actor,
        lifecycleEvent: 'registered',
        riskLevel: 'high',
        evidence: {
            allowed_origins_count: oauthClient.allowed_origins.length,
            allowed_ip_cidrs_count: oauthClient.allowed_ip_cidrs.length,
        },
    });

    return { oauthClient, clientSecret };
}

export async function rotateOAuthClientSecret(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    oauthClientId: string;
}): Promise<{ oauthClient: OAuthClientRecord; clientSecret: string }> {
    const clientSecret = `${OAUTH_CLIENT_SECRET_PREFIX}${randomBytes(32).toString('hex')}`;
    const C = OAUTH_CLIENTS.COLUMNS;
    const { data, error } = await input.client
        .from(OAUTH_CLIENTS.TABLE)
        .update({
            [C.client_secret_hash]: sha256Hex(clientSecret),
            [C.rotated_at]: new Date().toISOString(),
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, input.oauthClientId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to rotate OAuth client secret: ${error?.message ?? 'Unknown error'}`);
    }

    const oauthClient = mapOAuthClient(data as Record<string, unknown>);
    await writeOAuthClientEvent(input.client, {
        tenantId: input.tenantId,
        requestId: `oauth_client_secret_rotated:${oauthClient.id}:${Date.now()}`,
        oauthClient,
        actor: input.actor,
        lifecycleEvent: 'secret_rotated',
        riskLevel: 'high',
    });

    return { oauthClient, clientSecret };
}

export async function revokeOAuthClient(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    oauthClientId: string;
}): Promise<OAuthClientRecord> {
    const C = OAUTH_CLIENTS.COLUMNS;
    const { data, error } = await input.client
        .from(OAUTH_CLIENTS.TABLE)
        .update({
            [C.status]: 'revoked',
            [C.revoked_at]: new Date().toISOString(),
            [C.revoked_by]: input.actor,
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, input.oauthClientId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to revoke OAuth client: ${error?.message ?? 'Unknown error'}`);
    }

    const oauthClient = mapOAuthClient(data as Record<string, unknown>);
    await writeOAuthClientEvent(input.client, {
        tenantId: input.tenantId,
        requestId: `oauth_client_revoked:${oauthClient.id}:${Date.now()}`,
        oauthClient,
        actor: input.actor,
        lifecycleEvent: 'revoked',
        riskLevel: 'critical',
    });

    return oauthClient;
}

export async function authenticateOAuthClient(input: {
    client: SupabaseClient;
    clientId: string;
    clientSecret: string;
}): Promise<OAuthClientRecord> {
    const oauthClient = await getOAuthClientByClientId(input.client, input.clientId);
    if (!oauthClient) {
        throw new Error('OAuth client was not found.');
    }
    if (oauthClient.status !== 'active') {
        throw new Error('OAuth client is not active.');
    }
    if (!verifySecret(input.clientSecret, oauthClient.client_secret_hash)) {
        throw new Error('OAuth client credentials are invalid.');
    }
    return oauthClient;
}

export async function issueOAuthClientCredentialsToken(input: {
    client: SupabaseClient;
    clientId: string;
    clientSecret: string;
    requestedScopes?: readonly string[] | string | null;
    audience?: string | null;
    req?: Request | null;
}): Promise<{
    oauthClient: OAuthClientRecord;
    token: OAuthAccessTokenRecord;
    accessToken: string;
    expiresIn: number;
}> {
    const oauthClient = await authenticateOAuthClient(input);
    const scopes = resolveGrantedScopes(oauthClient, input.requestedScopes);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + oauthClient.token_ttl_seconds * 1000);
    const accessToken = `${OAUTH_ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
    const tokenHash = sha256Hex(accessToken);
    const C = OAUTH_ACCESS_TOKENS.COLUMNS;

    const { data, error } = await input.client
        .from(OAUTH_ACCESS_TOKENS.TABLE)
        .insert({
            [C.tenant_id]: oauthClient.tenant_id,
            [C.oauth_client_id]: oauthClient.id,
            [C.token_hash]: tokenHash,
            [C.token_prefix]: accessToken.slice(0, 18),
            [C.scopes]: scopes,
            [C.audience]: normalizeOptionalText(input.audience),
            [C.status]: 'active',
            [C.issued_at]: now.toISOString(),
            [C.expires_at]: expiresAt.toISOString(),
            [C.ip_hash]: hashTrustSurfaceValue(resolveRequestIp(input.req ?? null)),
            [C.user_agent_hash]: hashTrustSurfaceValue(input.req?.headers.get('user-agent') ?? null),
            [C.evidence]: {
                grant_type: 'client_credentials',
                route: resolveRequestPath(input.req ?? null),
                origin_hash: hashTrustSurfaceValue(input.req?.headers.get('origin') ?? null),
            },
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to issue OAuth access token: ${error?.message ?? 'Unknown error'}`);
    }

    const token = mapOAuthToken(data as Record<string, unknown>);
    await Promise.all([
        input.client
            .from(OAUTH_CLIENTS.TABLE)
            .update({ [OAUTH_CLIENTS.COLUMNS.last_used_at]: now.toISOString() })
            .eq(OAUTH_CLIENTS.COLUMNS.id, oauthClient.id),
        writeOAuthTokenEvent(input.client, {
            tenantId: oauthClient.tenant_id,
            requestId: `oauth_token_issued:${token.id}:${Date.now()}`,
            oauthClient,
            token,
            lifecycleEvent: 'issued',
            riskLevel: 'low',
            req: input.req ?? null,
        }),
    ]).catch(() => {
        // Token issuance should not fail on best-effort last-used/event telemetry.
    });

    return {
        oauthClient,
        token,
        accessToken,
        expiresIn: oauthClient.token_ttl_seconds,
    };
}

export async function introspectOAuthAccessToken(input: {
    client: SupabaseClient;
    token: string;
    authenticatedClientId?: string | null;
    req?: Request | null;
}): Promise<{
    active: boolean;
    oauthClient: OAuthClientRecord | null;
    tokenRecord: OAuthAccessTokenRecord | null;
    reason?: string;
}> {
    const tokenRecord = await getOAuthTokenByPresentedToken(input.client, input.token);
    if (!tokenRecord) {
        return { active: false, oauthClient: null, tokenRecord: null, reason: 'token_not_found' };
    }

    const oauthClient = await getOAuthClientById(input.client, tokenRecord.tenant_id, tokenRecord.oauth_client_id);
    if (!oauthClient) {
        return { active: false, oauthClient: null, tokenRecord, reason: 'client_not_found' };
    }
    if (input.authenticatedClientId && oauthClient.client_id !== input.authenticatedClientId) {
        return { active: false, oauthClient, tokenRecord, reason: 'client_mismatch' };
    }

    const expired = Date.parse(tokenRecord.expires_at) <= Date.now();
    const active = oauthClient.status === 'active' && tokenRecord.status === 'active' && !expired;
    const status: OAuthTokenStatus = active ? tokenRecord.status : expired ? 'expired' : tokenRecord.status;

    await Promise.all([
        input.client
            .from(OAUTH_ACCESS_TOKENS.TABLE)
            .update({
                [OAUTH_ACCESS_TOKENS.COLUMNS.last_introspected_at]: new Date().toISOString(),
                ...(expired ? { [OAUTH_ACCESS_TOKENS.COLUMNS.status]: 'expired' } : {}),
            })
            .eq(OAUTH_ACCESS_TOKENS.COLUMNS.id, tokenRecord.id),
        writeOAuthTokenEvent(input.client, {
            tenantId: tokenRecord.tenant_id,
            requestId: `oauth_token_introspected:${tokenRecord.id}:${Date.now()}`,
            oauthClient,
            token: {
                ...tokenRecord,
                status,
            },
            lifecycleEvent: active ? 'introspected' : 'rejected',
            riskLevel: active ? 'low' : 'medium',
            req: input.req ?? null,
            evidence: {
                active,
                reason: active ? null : expired ? 'token_expired' : 'token_or_client_inactive',
            },
        }),
    ]).catch(() => {
        // Best-effort introspection telemetry only.
    });

    return {
        active,
        oauthClient,
        tokenRecord: expired ? { ...tokenRecord, status: 'expired' } : tokenRecord,
        reason: active ? undefined : expired ? 'token_expired' : 'token_or_client_inactive',
    };
}

export async function revokeOAuthAccessToken(input: {
    client: SupabaseClient;
    token: string;
    authenticatedClientId?: string | null;
    req?: Request | null;
}): Promise<{ revoked: boolean; reason?: string }> {
    const introspection = await introspectOAuthAccessToken({
        client: input.client,
        token: input.token,
        authenticatedClientId: input.authenticatedClientId,
        req: input.req ?? null,
    });
    if (!introspection.tokenRecord || !introspection.oauthClient) {
        return { revoked: false, reason: introspection.reason ?? 'token_not_found' };
    }
    if (input.authenticatedClientId && introspection.oauthClient.client_id !== input.authenticatedClientId) {
        return { revoked: false, reason: 'client_mismatch' };
    }

    await input.client
        .from(OAUTH_ACCESS_TOKENS.TABLE)
        .update({
            [OAUTH_ACCESS_TOKENS.COLUMNS.status]: 'revoked',
            [OAUTH_ACCESS_TOKENS.COLUMNS.revoked_at]: new Date().toISOString(),
        })
        .eq(OAUTH_ACCESS_TOKENS.COLUMNS.id, introspection.tokenRecord.id);

    await writeOAuthTokenEvent(input.client, {
        tenantId: introspection.tokenRecord.tenant_id,
        requestId: `oauth_token_revoked:${introspection.tokenRecord.id}:${Date.now()}`,
        oauthClient: introspection.oauthClient,
        token: { ...introspection.tokenRecord, status: 'revoked' },
        lifecycleEvent: 'revoked',
        riskLevel: 'medium',
        req: input.req ?? null,
    });

    return { revoked: true };
}

export async function resolveOAuthClientCredentialsPrincipal(
    client: SupabaseClient,
    req: Request,
    options: {
        requiredScopes?: readonly string[];
    } = {},
): Promise<{
    principal: OAuthResolvedPrincipal | null;
    error: { status: number; message: string } | null;
}> {
    const token = extractOAuthBearerToken(req);
    if (!token) {
        return { principal: null, error: null };
    }

    const introspection = await introspectOAuthAccessToken({ client, token, req });
    if (!introspection.active || !introspection.oauthClient || !introspection.tokenRecord) {
        return {
            principal: null,
            error: { status: 401, message: 'OAuth access token is not active.' },
        };
    }

    const missingScopes = missingRequiredScopes(introspection.tokenRecord.scopes, options.requiredScopes ?? []);
    if (missingScopes.length > 0) {
        return {
            principal: null,
            error: { status: 403, message: 'OAuth access token does not grant the required scope.' },
        };
    }

    return {
        principal: {
            tenantId: introspection.oauthClient.tenant_id,
            oauthClientId: introspection.oauthClient.id,
            clientId: introspection.oauthClient.client_id,
            clientName: introspection.oauthClient.client_name,
            scopes: introspection.tokenRecord.scopes,
            tokenId: introspection.tokenRecord.id,
        },
        error: null,
    };
}

export function extractOAuthBearerToken(req: Request): string | null {
    const authorization = req.headers.get('authorization');
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
    return token?.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) ? token : null;
}

export function sanitizeOAuthClient(record: OAuthClientRecord): Omit<OAuthClientRecord, 'client_secret_hash'> {
    const { client_secret_hash: _clientSecretHash, ...safe } = record;
    return safe;
}

async function getOAuthClientByClientId(client: SupabaseClient, clientId: string): Promise<OAuthClientRecord | null> {
    const C = OAUTH_CLIENTS.COLUMNS;
    const { data, error } = await client
        .from(OAUTH_CLIENTS.TABLE)
        .select('*')
        .eq(C.client_id, clientId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to resolve OAuth client: ${error.message}`);
    }
    return data ? mapOAuthClient(data as Record<string, unknown>) : null;
}

async function getOAuthClientById(
    client: SupabaseClient,
    tenantId: string,
    id: string,
): Promise<OAuthClientRecord | null> {
    const C = OAUTH_CLIENTS.COLUMNS;
    const { data, error } = await client
        .from(OAUTH_CLIENTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.id, id)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load OAuth client: ${error.message}`);
    }
    return data ? mapOAuthClient(data as Record<string, unknown>) : null;
}

async function getOAuthTokenByPresentedToken(client: SupabaseClient, token: string): Promise<OAuthAccessTokenRecord | null> {
    const C = OAUTH_ACCESS_TOKENS.COLUMNS;
    const { data, error } = await client
        .from(OAUTH_ACCESS_TOKENS.TABLE)
        .select('*')
        .eq(C.token_hash, sha256Hex(token))
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to resolve OAuth access token: ${error.message}`);
    }
    return data ? mapOAuthToken(data as Record<string, unknown>) : null;
}

async function writeOAuthClientEvent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        requestId: string;
        oauthClient: OAuthClientRecord;
        actor: string | null;
        lifecycleEvent: 'registered' | 'secret_rotated' | 'disabled' | 'revoked' | 'scope_changed' | 'anomaly_detected';
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
        evidence?: Record<string, unknown>;
    },
): Promise<void> {
    await client.from(OAUTH_CLIENT_EVENTS.TABLE).insert({
        tenant_id: input.tenantId,
        request_id: input.requestId,
        oauth_client_id: input.oauthClient.id,
        client_id: input.oauthClient.client_id,
        actor_user_id: coerceUuidOrNull(input.actor),
        lifecycle_event: input.lifecycleEvent,
        status: input.oauthClient.status,
        allowed_scopes: input.oauthClient.allowed_scopes,
        token_ttl_seconds: input.oauthClient.token_ttl_seconds,
        risk_level: input.riskLevel,
        evidence: {
            client_name: input.oauthClient.client_name,
            telemetry_source: 'oauthClientCredentials',
            ...input.evidence,
        },
    });
}

async function writeOAuthTokenEvent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        requestId: string;
        oauthClient: OAuthClientRecord;
        token: OAuthAccessTokenRecord;
        lifecycleEvent: 'issued' | 'introspected' | 'revoked' | 'expired' | 'rejected' | 'anomaly_detected';
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
        req?: Request | null;
        evidence?: Record<string, unknown>;
    },
): Promise<void> {
    await client.from(OAUTH_TOKEN_EVENTS.TABLE).insert({
        tenant_id: input.tenantId,
        request_id: input.requestId,
        oauth_client_id: input.oauthClient.id,
        oauth_access_token_id: input.token.id,
        token_prefix: input.token.token_prefix,
        lifecycle_event: input.lifecycleEvent,
        token_status: input.lifecycleEvent === 'rejected' ? 'rejected' : input.token.status,
        scopes: input.token.scopes,
        audience: input.token.audience,
        expires_at: input.token.expires_at,
        ip_hash: hashTrustSurfaceValue(resolveRequestIp(input.req ?? null)),
        user_agent_hash: hashTrustSurfaceValue(input.req?.headers.get('user-agent') ?? null),
        risk_level: input.riskLevel,
        evidence: {
            client_id: input.oauthClient.client_id,
            route: resolveRequestPath(input.req ?? null),
            origin_hash: hashTrustSurfaceValue(input.req?.headers.get('origin') ?? null),
            telemetry_source: 'oauthClientCredentials',
            ...input.evidence,
        },
    });
}

function resolveGrantedScopes(
    oauthClient: OAuthClientRecord,
    requestedScopes: readonly string[] | string | null | undefined,
): OAuthClientCredentialScope[] {
    const requested = normalizeOAuthScopes(requestedScopes);
    if (requested.length === 0) {
        return oauthClient.allowed_scopes;
    }
    const allowed = new Set(oauthClient.allowed_scopes);
    const denied = requested.filter((scope) => !allowed.has(scope));
    if (denied.length > 0) {
        throw new Error(`OAuth client is not allowed to request scope(s): ${denied.join(', ')}`);
    }
    return requested;
}

function missingRequiredScopes(grantedScopes: readonly string[], requiredScopes: readonly string[]): string[] {
    if (requiredScopes.length === 0) return [];
    const granted = new Set(grantedScopes);
    return requiredScopes.filter((scope) => !granted.has(scope));
}

function verifySecret(candidate: string, expectedHash: string): boolean {
    const candidateHash = Buffer.from(sha256Hex(candidate), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return candidateHash.length === expected.length && timingSafeEqual(candidateHash, expected);
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function mapOAuthClient(row: Record<string, unknown>): OAuthClientRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        client_id: String(row.client_id),
        client_secret_hash: String(row.client_secret_hash),
        client_name: String(row.client_name),
        status: normalizeOAuthClientStatus(row.status),
        allowed_scopes: normalizeOAuthScopes(asStringArray(row.allowed_scopes)),
        token_ttl_seconds: normalizeTokenTtl(Number(row.token_ttl_seconds)),
        allowed_origins: asStringArray(row.allowed_origins),
        allowed_ip_cidrs: asStringArray(row.allowed_ip_cidrs),
        jwks: asRecord(row.jwks),
        metadata: asRecord(row.metadata),
        created_by: normalizeOptionalText(row.created_by),
        revoked_by: normalizeOptionalText(row.revoked_by),
        last_used_at: normalizeOptionalText(row.last_used_at),
        rotated_at: normalizeOptionalText(row.rotated_at),
        revoked_at: normalizeOptionalText(row.revoked_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    };
}

function mapOAuthToken(row: Record<string, unknown>): OAuthAccessTokenRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        oauth_client_id: String(row.oauth_client_id),
        token_hash: String(row.token_hash),
        token_prefix: String(row.token_prefix),
        scopes: normalizeOAuthScopes(asStringArray(row.scopes)),
        audience: normalizeOptionalText(row.audience),
        status: normalizeOAuthTokenStatus(row.status),
        issued_at: String(row.issued_at),
        expires_at: String(row.expires_at),
        revoked_at: normalizeOptionalText(row.revoked_at),
        last_introspected_at: normalizeOptionalText(row.last_introspected_at),
        ip_hash: normalizeOptionalText(row.ip_hash),
        user_agent_hash: normalizeOptionalText(row.user_agent_hash),
        evidence: asRecord(row.evidence),
        created_at: String(row.created_at),
    };
}

function normalizeOAuthClientStatus(value: unknown): OAuthClientStatus {
    return value === 'disabled' || value === 'revoked' ? value : 'active';
}

function normalizeOAuthTokenStatus(value: unknown): OAuthTokenStatus {
    return value === 'revoked' || value === 'expired' ? value : 'active';
}

function normalizeTokenTtl(value: number | null | undefined): number {
    const numeric = Number.isFinite(value) ? Number(value) : 900;
    return Math.min(3600, Math.max(60, Math.floor(numeric)));
}

function normalizeRequiredText(value: unknown, field: string): string {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        throw new Error(`${field} is required.`);
    }
    return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeTextArray(value: readonly string[] | null | undefined): string[] {
    return Array.isArray(value)
        ? [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]
        : [];
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function coerceUuidOrNull(value: string | null): string | null {
    const normalized = normalizeOptionalText(value);
    return normalized && UUID_PATTERN.test(normalized) ? normalized : null;
}

function resolveRequestIp(req: Request | null): string | null {
    if (!req) return null;
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        ?? req.headers.get('cf-connecting-ip')?.trim()
        ?? req.headers.get('x-real-ip')?.trim()
        ?? null;
}

function resolveRequestPath(req: Request | null): string | null {
    if (!req) return null;
    try {
        return new URL(req.url).pathname;
    } catch {
        return null;
    }
}
