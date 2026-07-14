import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'crypto';
import type { JsonWebKey } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashTrustSurfaceValue } from '@/lib/auth/authTrustFabric';
import {
    OAUTH_ACCESS_TOKENS,
    OAUTH_CLIENT_EVENTS,
    OAUTH_CLIENTS,
    OAUTH_DPOP_PROOF_EVENTS,
    OAUTH_TOKEN_EVENTS,
} from '@/lib/db/schemaContracts';

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const OAUTH_ACCESS_TOKEN_PREFIX = 'vetios_at_';
export const OAUTH_CLIENT_ID_PREFIX = 'vetios_oauth_';
export const OAUTH_CLIENT_SECRET_PREFIX = 'vetios_cs_';
export const OAUTH_CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

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
export type OAuthClientAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'private_key_jwt';
export type OAuthClientAssertionAlgorithm = 'RS256';
export type OAuthTokenBindingMethod = 'bearer' | 'dpop';

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
    client_auth_methods: OAuthClientAuthMethod[];
    assertion_algorithms: OAuthClientAssertionAlgorithm[];
    assertion_audiences: string[];
    assertion_max_ttl_seconds: number;
    mtls_required: boolean;
    mtls_cert_thumbprints: string[];
    mtls_last_thumbprint: string | null;
    mtls_last_seen_at: string | null;
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
    token_binding_method: OAuthTokenBindingMethod;
    dpop_jwk_thumbprint: string | null;
    dpop_public_jwk: Record<string, unknown>;
    dpop_bound_at: string | null;
    dpop_last_seen_at: string | null;
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

interface JwtClientAssertionParts {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    signingInput: string;
    signature: Buffer;
}

interface DpopProofVerification {
    jwkThumbprint: string;
    publicJwk: Record<string, unknown>;
    proofJti: string;
    proofIat: string | null;
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
    jwks?: Record<string, unknown> | null;
    clientAuthMethods?: readonly string[] | null;
    assertionAlgorithms?: readonly string[] | null;
    assertionAudiences?: readonly string[] | null;
    assertionMaxTtlSeconds?: number | null;
    mtlsRequired?: boolean | null;
    mtlsCertThumbprints?: readonly string[] | null;
    metadata?: Record<string, unknown>;
}): Promise<{ oauthClient: OAuthClientRecord; clientSecret: string }> {
    const clientId = `${OAUTH_CLIENT_ID_PREFIX}${randomBytes(12).toString('hex')}`;
    const clientSecret = `${OAUTH_CLIENT_SECRET_PREFIX}${randomBytes(32).toString('hex')}`;
    const scopes = normalizeOAuthScopes(input.allowedScopes);
    if (scopes.length === 0) {
        throw new Error('At least one valid OAuth scope is required.');
    }
    const clientAuthMethods = normalizeOAuthClientAuthMethods(input.clientAuthMethods);
    const assertionAlgorithms = normalizeOAuthClientAssertionAlgorithms(input.assertionAlgorithms);
    const assertionAudiences = normalizeTextArray(input.assertionAudiences);
    const assertionMaxTtlSeconds = normalizeAssertionMaxTtl(input.assertionMaxTtlSeconds);
    const jwks = normalizeJwks(input.jwks);
    const mtlsCertThumbprints = normalizeSha256Thumbprints(input.mtlsCertThumbprints);
    const mtlsRequired = input.mtlsRequired === true;
    if (clientAuthMethods.includes('private_key_jwt') && getJwksKeys(jwks).length === 0) {
        throw new Error('private_key_jwt clients require at least one public JWK.');
    }
    if (mtlsRequired && mtlsCertThumbprints.length === 0) {
        throw new Error('mTLS-required OAuth clients require at least one certificate SHA-256 thumbprint.');
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
            [C.jwks]: jwks,
            [C.client_auth_methods]: clientAuthMethods,
            [C.assertion_algorithms]: assertionAlgorithms,
            [C.assertion_audiences]: assertionAudiences,
            [C.assertion_max_ttl_seconds]: assertionMaxTtlSeconds,
            [C.mtls_required]: mtlsRequired,
            [C.mtls_cert_thumbprints]: mtlsCertThumbprints,
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
            client_auth_methods: oauthClient.client_auth_methods,
            assertion_algorithms: oauthClient.assertion_algorithms,
            assertion_audiences_count: oauthClient.assertion_audiences.length,
            jwks_key_count: getJwksKeys(oauthClient.jwks).length,
            mtls_required: oauthClient.mtls_required,
            mtls_cert_thumbprints_count: oauthClient.mtls_cert_thumbprints.length,
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
    req?: Request | null;
}): Promise<OAuthClientRecord> {
    const oauthClient = await getOAuthClientByClientId(input.client, input.clientId);
    if (!oauthClient) {
        throw new Error('OAuth client was not found.');
    }
    if (oauthClient.status !== 'active') {
        throw new Error('OAuth client is not active.');
    }
    if (!oauthClient.client_auth_methods.some((method) =>
        method === 'client_secret_basic' || method === 'client_secret_post')) {
        throw new Error('OAuth client does not allow shared-secret authentication.');
    }
    if (!verifySecret(input.clientSecret, oauthClient.client_secret_hash)) {
        throw new Error('OAuth client credentials are invalid.');
    }
    await enforceOAuthClientMtlsBinding(input.client, oauthClient, input.req ?? null);
    return oauthClient;
}

export async function authenticateOAuthClientRequest(input: {
    client: SupabaseClient;
    clientId?: string | null;
    clientSecret?: string | null;
    clientAssertionType?: string | null;
    clientAssertion?: string | null;
    expectedAssertionAudiences?: readonly string[] | null;
    req?: Request | null;
}): Promise<{
    oauthClient: OAuthClientRecord;
    authMethod: 'client_secret' | 'private_key_jwt';
    assertionKid?: string | null;
}> {
    if (input.clientAssertion) {
        if (input.clientAssertionType !== OAUTH_CLIENT_ASSERTION_TYPE) {
            throw new Error('Unsupported OAuth client assertion type.');
        }
        return authenticateOAuthClientAssertion({
            client: input.client,
            clientId: input.clientId ?? null,
            clientAssertion: input.clientAssertion,
            expectedAudiences: input.expectedAssertionAudiences ?? [],
            req: input.req ?? null,
        });
    }

    if (!input.clientId || !input.clientSecret) {
        throw new Error('client_id and client_secret are required.');
    }
    const oauthClient = await authenticateOAuthClient({
        client: input.client,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        req: input.req ?? null,
    });
    return { oauthClient, authMethod: 'client_secret' };
}

export async function authenticateOAuthClientAssertion(input: {
    client: SupabaseClient;
    clientId?: string | null;
    clientAssertion: string;
    expectedAudiences: readonly string[];
    req?: Request | null;
}): Promise<{
    oauthClient: OAuthClientRecord;
    authMethod: 'private_key_jwt';
    assertionKid: string | null;
}> {
    const decoded = decodeJwtClientAssertion(input.clientAssertion);
    const assertionClientId = readString(decoded.payload.iss);
    const assertionSubject = readString(decoded.payload.sub);
    const requestedClientId = normalizeOptionalText(input.clientId);
    if (!assertionClientId || !assertionSubject || assertionClientId !== assertionSubject) {
        throw new Error('OAuth client assertion must use matching iss and sub client identifiers.');
    }
    if (requestedClientId && requestedClientId !== assertionClientId) {
        throw new Error('OAuth client assertion does not match client_id.');
    }

    const oauthClient = await getOAuthClientByClientId(input.client, assertionClientId);
    if (!oauthClient) {
        throw new Error('OAuth client was not found.');
    }
    if (oauthClient.status !== 'active') {
        throw new Error('OAuth client is not active.');
    }
    if (!oauthClient.client_auth_methods.includes('private_key_jwt')) {
        throw new Error('OAuth client does not allow private_key_jwt authentication.');
    }

    validateJwtClientAssertionClaims({
        oauthClient,
        payload: decoded.payload,
        expectedAudiences: input.expectedAudiences,
    });
    verifyJwtClientAssertionSignature(oauthClient, decoded);
    await enforceOAuthClientMtlsBinding(input.client, oauthClient, input.req ?? null);

    return {
        oauthClient,
        authMethod: 'private_key_jwt',
        assertionKid: readString(decoded.header.kid),
    };
}

export async function issueOAuthClientCredentialsToken(input: {
    client: SupabaseClient;
    clientId?: string | null;
    clientSecret?: string | null;
    clientAssertionType?: string | null;
    clientAssertion?: string | null;
    expectedAssertionAudiences?: readonly string[] | null;
    requestedScopes?: readonly string[] | string | null;
    audience?: string | null;
    req?: Request | null;
}): Promise<{
    oauthClient: OAuthClientRecord;
    token: OAuthAccessTokenRecord;
    accessToken: string;
    expiresIn: number;
    tokenType: 'Bearer' | 'DPoP';
}> {
    const authentication = await authenticateOAuthClientRequest(input);
    const oauthClient = authentication.oauthClient;
    const scopes = resolveGrantedScopes(oauthClient, input.requestedScopes);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + oauthClient.token_ttl_seconds * 1000);
    const accessToken = `${OAUTH_ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
    const tokenHash = sha256Hex(accessToken);
    const C = OAUTH_ACCESS_TOKENS.COLUMNS;
    const dpopProof = input.req?.headers.get('dpop')
        ? await verifyDpopProof({
            client: input.client,
            tenantId: oauthClient.tenant_id,
            oauthClientId: oauthClient.id,
            req: input.req,
            proofUse: 'token_request',
            expectedAccessToken: null,
        })
        : null;

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
            [C.token_binding_method]: dpopProof ? 'dpop' : 'bearer',
            [C.dpop_jwk_thumbprint]: dpopProof?.jwkThumbprint ?? null,
            [C.dpop_public_jwk]: dpopProof?.publicJwk ?? {},
            [C.dpop_bound_at]: dpopProof ? now.toISOString() : null,
            [C.evidence]: {
                grant_type: 'client_credentials',
                client_auth_method: authentication.authMethod,
                client_assertion_kid: authentication.assertionKid ?? null,
                token_binding_method: dpopProof ? 'dpop' : 'bearer',
                dpop_jwk_thumbprint: dpopProof?.jwkThumbprint ?? null,
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
            evidence: {
                client_auth_method: authentication.authMethod,
                client_assertion_kid: authentication.assertionKid ?? null,
                token_binding_method: token.token_binding_method,
                dpop_jwk_thumbprint: token.dpop_jwk_thumbprint,
            },
        }),
    ]).catch(() => {
        // Token issuance should not fail on best-effort last-used/event telemetry.
    });

    return {
        oauthClient,
        token,
        accessToken,
        expiresIn: oauthClient.token_ttl_seconds,
        tokenType: token.token_binding_method === 'dpop' ? 'DPoP' : 'Bearer',
    };
}

export async function introspectOAuthAccessToken(input: {
    client: SupabaseClient;
    token: string;
    authenticatedClientId?: string | null;
    enforceDpopProof?: boolean;
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
    let active = oauthClient.status === 'active' && tokenRecord.status === 'active' && !expired;
    let inactiveReason = expired ? 'token_expired' : 'token_or_client_inactive';
    if (active && input.enforceDpopProof && tokenRecord.token_binding_method === 'dpop') {
        try {
            await verifyDpopProof({
                client: input.client,
                tenantId: tokenRecord.tenant_id,
                oauthClientId: oauthClient.id,
                oauthAccessTokenId: tokenRecord.id,
                req: input.req ?? null,
                proofUse: 'resource_request',
                expectedAccessToken: input.token,
                expectedJwkThumbprint: tokenRecord.dpop_jwk_thumbprint,
            });
            await input.client
                .from(OAUTH_ACCESS_TOKENS.TABLE)
                .update({ [OAUTH_ACCESS_TOKENS.COLUMNS.dpop_last_seen_at]: new Date().toISOString() })
                .eq(OAUTH_ACCESS_TOKENS.COLUMNS.id, tokenRecord.id);
        } catch (error) {
            active = false;
            inactiveReason = error instanceof Error ? error.message : 'dpop_proof_invalid';
        }
    }
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
                reason: active ? null : inactiveReason,
                token_binding_method: tokenRecord.token_binding_method,
                dpop_jwk_thumbprint: tokenRecord.dpop_jwk_thumbprint,
            },
        }),
    ]).catch(() => {
        // Best-effort introspection telemetry only.
    });

    return {
        active,
        oauthClient,
        tokenRecord: expired ? { ...tokenRecord, status: 'expired' } : tokenRecord,
        reason: active ? undefined : inactiveReason,
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

    const introspection = await introspectOAuthAccessToken({ client, token, req, enforceDpopProof: true });
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
    const token = authorization?.match(/^(?:Bearer|DPoP)\s+(.+)$/i)?.[1]?.trim() ?? null;
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

async function writeDpopProofEvent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        oauthClientId: string;
        oauthAccessTokenId: string | null;
        proofUse: 'token_request' | 'resource_request';
        proofJti: string;
        jwkThumbprint: string;
        req: Request;
        accessToken: string | null;
        proofIat: string | null;
    },
): Promise<void> {
    const { error } = await client.from(OAUTH_DPOP_PROOF_EVENTS.TABLE).insert({
        tenant_id: input.tenantId,
        request_id: `oauth_dpop_proof:${input.proofUse}:${input.jwkThumbprint}:${input.proofJti}`,
        oauth_client_id: input.oauthClientId,
        oauth_access_token_id: input.oauthAccessTokenId,
        proof_use: input.proofUse,
        proof_jti: input.proofJti,
        jwk_thumbprint: input.jwkThumbprint,
        http_method: input.req.method.toUpperCase(),
        http_uri_hash: sha256Hex(resolveDpopHttpUri(input.req)),
        access_token_hash: input.accessToken ? sha256Hex(input.accessToken) : null,
        proof_iat: input.proofIat,
        risk_level: 'low',
        evidence: {
            route: resolveRequestPath(input.req),
            origin_hash: hashTrustSurfaceValue(input.req.headers.get('origin')),
            telemetry_source: 'oauthClientCredentials',
        },
    });
    if (error) {
        throw new Error('DPoP proof replay detected or proof event could not be recorded.');
    }
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

function decodeJwtClientAssertion(jwt: string): JwtClientAssertionParts {
    const parts = jwt.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
        throw new Error('OAuth client assertion must be a compact JWT.');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = parseBase64UrlJson(encodedHeader, 'JWT header');
    const payload = parseBase64UrlJson(encodedPayload, 'JWT payload');
    const alg = readString(header.alg);
    if (!alg || alg === 'none') {
        throw new Error('OAuth client assertion must be signed.');
    }

    return {
        header,
        payload,
        signingInput: `${encodedHeader}.${encodedPayload}`,
        signature: base64UrlDecode(encodedSignature),
    };
}

function validateJwtClientAssertionClaims(input: {
    oauthClient: OAuthClientRecord;
    payload: Record<string, unknown>;
    expectedAudiences: readonly string[];
}): void {
    const now = Math.floor(Date.now() / 1000);
    const exp = readNumber(input.payload.exp);
    const iat = readNumber(input.payload.iat);
    const nbf = readNumber(input.payload.nbf);
    if (!exp || exp <= now) {
        throw new Error('OAuth client assertion is expired.');
    }
    if (nbf && nbf > now + 60) {
        throw new Error('OAuth client assertion is not valid yet.');
    }
    if (iat && iat > now + 60) {
        throw new Error('OAuth client assertion was issued in the future.');
    }
    if (exp - (iat ?? now) > input.oauthClient.assertion_max_ttl_seconds) {
        throw new Error('OAuth client assertion lifetime exceeds client policy.');
    }

    const assertionAudiences = readAudienceValues(input.payload.aud);
    const acceptedAudiences = input.oauthClient.assertion_audiences.length > 0
        ? input.oauthClient.assertion_audiences
        : [...input.expectedAudiences];
    if (acceptedAudiences.length === 0) {
        throw new Error('OAuth client assertion audience policy is not configured.');
    }
    if (!assertionAudiences.some((audience) => acceptedAudiences.includes(audience))) {
        throw new Error('OAuth client assertion audience is not accepted.');
    }
}

function verifyJwtClientAssertionSignature(oauthClient: OAuthClientRecord, jwt: JwtClientAssertionParts): void {
    const alg = readString(jwt.header.alg);
    if (alg !== 'RS256' || !oauthClient.assertion_algorithms.includes('RS256')) {
        throw new Error('OAuth client assertion algorithm is not accepted.');
    }

    const key = selectJwkForAssertion(oauthClient.jwks, readString(jwt.header.kid));
    if (!key) {
        throw new Error('OAuth client assertion signing key was not found.');
    }

    const publicKey = createPublicKey({
        key: key as JsonWebKey,
        format: 'jwk',
    });
    const ok = verify(
        'RSA-SHA256',
        Buffer.from(jwt.signingInput),
        publicKey,
        jwt.signature,
    );
    if (!ok) {
        throw new Error('OAuth client assertion signature is invalid.');
    }
}

async function verifyDpopProof(input: {
    client: SupabaseClient;
    tenantId: string;
    oauthClientId: string;
    oauthAccessTokenId?: string | null;
    req: Request | null;
    proofUse: 'token_request' | 'resource_request';
    expectedAccessToken: string | null;
    expectedJwkThumbprint?: string | null;
}): Promise<DpopProofVerification> {
    if (!input.req) {
        throw new Error('DPoP proof requires request context.');
    }
    const proof = input.req.headers.get('dpop');
    if (!proof) {
        throw new Error('DPoP proof is required for this access token.');
    }

    const decoded = decodeJwtClientAssertion(proof);
    const headerTyp = readString(decoded.header.typ)?.toLowerCase() ?? null;
    if (headerTyp !== 'dpop+jwt') {
        throw new Error('DPoP proof typ must be dpop+jwt.');
    }
    const publicJwk = normalizeDpopPublicJwk(decoded.header.jwk);
    const jwkThumbprint = computeJwkThumbprint(publicJwk);
    if (input.expectedJwkThumbprint && input.expectedJwkThumbprint !== jwkThumbprint) {
        throw new Error('DPoP proof key does not match the bound access token.');
    }
    verifyDpopProofSignature(publicJwk, decoded);
    validateDpopProofClaims({
        payload: decoded.payload,
        req: input.req,
        expectedAccessToken: input.expectedAccessToken,
    });

    const proofJti = readString(decoded.payload.jti);
    if (!proofJti) {
        throw new Error('DPoP proof jti is required.');
    }
    const proofIat = readNumber(decoded.payload.iat);
    await writeDpopProofEvent(input.client, {
        tenantId: input.tenantId,
        oauthClientId: input.oauthClientId,
        oauthAccessTokenId: input.oauthAccessTokenId ?? null,
        proofUse: input.proofUse,
        proofJti,
        jwkThumbprint,
        req: input.req,
        accessToken: input.expectedAccessToken,
        proofIat: proofIat ? new Date(proofIat * 1000).toISOString() : null,
    });

    return {
        jwkThumbprint,
        publicJwk,
        proofJti,
        proofIat: proofIat ? new Date(proofIat * 1000).toISOString() : null,
    };
}

async function enforceOAuthClientMtlsBinding(
    client: SupabaseClient,
    oauthClient: OAuthClientRecord,
    req: Request | null,
): Promise<void> {
    if (!oauthClient.mtls_required) {
        return;
    }
    assertTrustedMtlsProxy(req);
    const observedThumbprint = resolveMtlsClientCertThumbprint(req);
    if (!observedThumbprint) {
        throw new Error('OAuth client requires mTLS certificate binding.');
    }
    if (!oauthClient.mtls_cert_thumbprints.includes(observedThumbprint)) {
        throw new Error('OAuth client certificate fingerprint is not allowed.');
    }

    await client
        .from(OAUTH_CLIENTS.TABLE)
        .update({
            [OAUTH_CLIENTS.COLUMNS.mtls_last_thumbprint]: observedThumbprint,
            [OAUTH_CLIENTS.COLUMNS.mtls_last_seen_at]: new Date().toISOString(),
        })
        .eq(OAUTH_CLIENTS.COLUMNS.id, oauthClient.id);
}

function assertTrustedMtlsProxy(req: Request | null): void {
    if (!req) {
        throw new Error('OAuth mTLS requires trusted edge proxy context.');
    }

    const expected = normalizeOptionalText(process.env.VETIOS_MTLS_PROXY_SECRET)
        ?? normalizeOptionalText(process.env.VETIOS_TRUSTED_MTLS_PROXY_SECRET);
    if (!expected) {
        if (process.env.VETIOS_ALLOW_UNTRUSTED_MTLS_PROXY === 'true') {
            return;
        }
        throw new Error('OAuth mTLS trusted proxy secret is not configured.');
    }

    const presented = normalizeOptionalText(req.headers.get('x-vetios-mtls-proxy-secret'))
        ?? normalizeOptionalText(req.headers.get('x-mtls-proxy-secret'));
    if (!presented || !safeEqualText(presented, expected)) {
        throw new Error('OAuth mTLS certificate header was not forwarded by a trusted proxy.');
    }
}

function safeEqualText(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function selectJwkForAssertion(jwks: Record<string, unknown>, kid: string | null): Record<string, unknown> | null {
    const keys = getJwksKeys(jwks).filter((key) => readString(key.kty) === 'RSA');
    if (keys.length === 0) return null;
    if (kid) {
        return keys.find((key) => readString(key.kid) === kid) ?? null;
    }
    return keys.length === 1 ? keys[0] : null;
}

function normalizeDpopPublicJwk(value: unknown): Record<string, unknown> {
    const jwk = asRecord(value);
    if (readString(jwk.kty) !== 'RSA') {
        throw new Error('DPoP proof JWK must be an RSA public key for VetIOS DPoP v1.');
    }
    const n = readString(jwk.n);
    const e = readString(jwk.e);
    if (!n || !e) {
        throw new Error('DPoP proof RSA JWK is missing modulus or exponent.');
    }
    return {
        kty: 'RSA',
        n,
        e,
        ...(readString(jwk.kid) ? { kid: readString(jwk.kid) } : {}),
        ...(readString(jwk.alg) ? { alg: readString(jwk.alg) } : {}),
        ...(readString(jwk.use) ? { use: readString(jwk.use) } : {}),
    };
}

function computeJwkThumbprint(jwk: Record<string, unknown>): string {
    const kty = readString(jwk.kty);
    if (kty !== 'RSA') {
        throw new Error('Only RSA DPoP JWK thumbprints are supported in VetIOS DPoP v1.');
    }
    const canonical = JSON.stringify({
        e: readString(jwk.e),
        kty,
        n: readString(jwk.n),
    });
    return createHash('sha256').update(canonical).digest('base64url');
}

function verifyDpopProofSignature(publicJwk: Record<string, unknown>, jwt: JwtClientAssertionParts): void {
    const alg = readString(jwt.header.alg);
    if (alg !== 'RS256') {
        throw new Error('DPoP proof algorithm is not accepted.');
    }
    const publicKey = createPublicKey({
        key: publicJwk as JsonWebKey,
        format: 'jwk',
    });
    const ok = verify(
        'RSA-SHA256',
        Buffer.from(jwt.signingInput),
        publicKey,
        jwt.signature,
    );
    if (!ok) {
        throw new Error('DPoP proof signature is invalid.');
    }
}

function validateDpopProofClaims(input: {
    payload: Record<string, unknown>;
    req: Request;
    expectedAccessToken: string | null;
}): void {
    const htm = readString(input.payload.htm);
    const htu = readString(input.payload.htu);
    const iat = readNumber(input.payload.iat);
    const jti = readString(input.payload.jti);
    if (!htm || htm.toUpperCase() !== input.req.method.toUpperCase()) {
        throw new Error('DPoP proof htm does not match the request method.');
    }
    if (!htu || htu !== resolveDpopHttpUri(input.req)) {
        throw new Error('DPoP proof htu does not match the request URI.');
    }
    if (!jti) {
        throw new Error('DPoP proof jti is required.');
    }
    const now = Math.floor(Date.now() / 1000);
    if (!iat || Math.abs(now - iat) > 300) {
        throw new Error('DPoP proof iat is outside the accepted clock window.');
    }
    if (input.expectedAccessToken) {
        const ath = readString(input.payload.ath);
        if (!ath || ath !== hashAccessTokenForDpop(input.expectedAccessToken)) {
            throw new Error('DPoP proof ath does not match the access token.');
        }
    }
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function hashAccessTokenForDpop(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
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
        client_auth_methods: normalizeOAuthClientAuthMethods(asStringArray(row.client_auth_methods)),
        assertion_algorithms: normalizeOAuthClientAssertionAlgorithms(asStringArray(row.assertion_algorithms)),
        assertion_audiences: asStringArray(row.assertion_audiences),
        assertion_max_ttl_seconds: normalizeAssertionMaxTtl(Number(row.assertion_max_ttl_seconds)),
        mtls_required: row.mtls_required === true,
        mtls_cert_thumbprints: normalizeSha256Thumbprints(asStringArray(row.mtls_cert_thumbprints)),
        mtls_last_thumbprint: normalizeSha256Thumbprint(row.mtls_last_thumbprint),
        mtls_last_seen_at: normalizeOptionalText(row.mtls_last_seen_at),
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
        token_binding_method: normalizeOAuthTokenBindingMethod(row.token_binding_method),
        dpop_jwk_thumbprint: normalizeOptionalText(row.dpop_jwk_thumbprint),
        dpop_public_jwk: asRecord(row.dpop_public_jwk),
        dpop_bound_at: normalizeOptionalText(row.dpop_bound_at),
        dpop_last_seen_at: normalizeOptionalText(row.dpop_last_seen_at),
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

function normalizeOAuthTokenBindingMethod(value: unknown): OAuthTokenBindingMethod {
    return value === 'dpop' ? 'dpop' : 'bearer';
}

function normalizeOAuthClientAuthMethods(value: readonly string[] | null | undefined): OAuthClientAuthMethod[] {
    const supported = new Set<OAuthClientAuthMethod>([
        'client_secret_basic',
        'client_secret_post',
        'private_key_jwt',
    ]);
    const normalized = Array.isArray(value)
        ? [...new Set(value.filter((entry): entry is OAuthClientAuthMethod => supported.has(entry as OAuthClientAuthMethod)))]
        : [];
    return normalized.length > 0
        ? normalized
        : ['client_secret_basic', 'client_secret_post'];
}

function normalizeOAuthClientAssertionAlgorithms(
    value: readonly string[] | null | undefined,
): OAuthClientAssertionAlgorithm[] {
    const supported = new Set<OAuthClientAssertionAlgorithm>(['RS256']);
    const normalized = Array.isArray(value)
        ? [...new Set(value.filter((entry): entry is OAuthClientAssertionAlgorithm =>
            supported.has(entry as OAuthClientAssertionAlgorithm)))]
        : [];
    return normalized.length > 0 ? normalized : ['RS256'];
}

function normalizeTokenTtl(value: number | null | undefined): number {
    const numeric = Number.isFinite(value) ? Number(value) : 900;
    return Math.min(3600, Math.max(60, Math.floor(numeric)));
}

function normalizeAssertionMaxTtl(value: number | null | undefined): number {
    const numeric = Number.isFinite(value) ? Number(value) : 300;
    return Math.min(600, Math.max(60, Math.floor(numeric)));
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

function normalizeSha256Thumbprints(value: readonly string[] | null | undefined): string[] {
    return Array.isArray(value)
        ? [...new Set(value
            .map(normalizeSha256Thumbprint)
            .filter((entry): entry is string => Boolean(entry)))]
        : [];
}

function normalizeSha256Thumbprint(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[^a-f0-9]/g, '');
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeJwks(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const record = asRecord(value);
    const keys = getJwksKeys(record);
    return keys.length > 0 ? { ...record, keys } : {};
}

function getJwksKeys(jwks: Record<string, unknown>): Record<string, unknown>[] {
    return Array.isArray(jwks.keys)
        ? jwks.keys.filter((entry): entry is Record<string, unknown> =>
            typeof entry === 'object' && entry !== null && !Array.isArray(entry))
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

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readAudienceValues(value: unknown): string[] {
    if (typeof value === 'string' && value.trim().length > 0) {
        return [value.trim()];
    }
    if (Array.isArray(value)) {
        return normalizeTextArray(value.filter((entry): entry is string => typeof entry === 'string'));
    }
    return [];
}

function parseBase64UrlJson(value: string, label: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(base64UrlDecode(value).toString('utf8'));
        return asRecord(parsed);
    } catch {
        throw new Error(`OAuth client assertion ${label} is invalid.`);
    }
}

function base64UrlDecode(value: string): Buffer {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    return Buffer.from(padded, 'base64');
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

function resolveMtlsClientCertThumbprint(req: Request | null): string | null {
    if (!req) return null;
    return normalizeSha256Thumbprint(req.headers.get('x-vetios-client-cert-sha256'))
        ?? normalizeSha256Thumbprint(req.headers.get('x-client-cert-sha256'))
        ?? normalizeSha256Thumbprint(req.headers.get('x-forwarded-client-cert-sha256'))
        ?? normalizeSha256Thumbprint(req.headers.get('ssl-client-fingerprint-sha256'));
}

function resolveRequestPath(req: Request | null): string | null {
    if (!req) return null;
    try {
        return new URL(req.url).pathname;
    } catch {
        return null;
    }
}

function resolveDpopHttpUri(req: Request): string {
    const url = new URL(req.url);
    return `${url.origin}${url.pathname}`;
}
