import { generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    createOAuthClient,
    issueOAuthClientCredentialsToken,
    normalizeOAuthScopes,
    OAUTH_CLIENT_ASSERTION_TYPE,
    resolveOAuthClientCredentialsPrincipal,
    revokeOAuthAccessToken,
    sanitizeOAuthClient,
} from '../oauthClientCredentials';

describe('oauth client credentials foundation', () => {
    it('normalizes only VetIOS-supported OAuth scopes', () => {
        expect(normalizeOAuthScopes('inference:write rag:write unsupported:scope')).toEqual([
            'inference:write',
            'rag:write',
        ]);
    });

    it('registers a client, issues a short-lived token, resolves it, and revokes it', async () => {
        const memory = createMemorySupabase();
        const created = await createOAuthClient({
            client: memory.client,
            tenantId: 'tenant_1',
            actor: '00000000-0000-4000-8000-000000000001',
            clientName: 'Partner lab gateway',
            allowedScopes: ['rag:write', 'inference:write'],
            tokenTtlSeconds: 300,
        });

        expect(created.clientSecret).toMatch(/^vetios_cs_/);
        expect(sanitizeOAuthClient(created.oauthClient)).not.toHaveProperty('client_secret_hash');
        expect(memory.rows.oauth_client_events).toHaveLength(1);

        const issued = await issueOAuthClientCredentialsToken({
            client: memory.client,
            clientId: created.oauthClient.client_id,
            clientSecret: created.clientSecret,
            requestedScopes: 'rag:write',
            audience: 'global-ontology-ingestion',
            req: new Request('https://vetios.test/api/oauth/token', {
                method: 'POST',
                headers: {
                    'user-agent': 'vitest',
                    'x-forwarded-for': '203.0.113.10',
                },
            }),
        });

        expect(issued.accessToken).toMatch(/^vetios_at_/);
        expect(issued.token.scopes).toEqual(['rag:write']);
        expect(memory.rows.oauth_access_tokens).toHaveLength(1);
        expect(memory.rows.oauth_token_events[0].lifecycle_event).toBe('issued');

        const resolved = await resolveOAuthClientCredentialsPrincipal(
            memory.client,
            new Request('https://vetios.test/api/ontology/global-one-health/populate', {
                headers: { authorization: `Bearer ${issued.accessToken}` },
            }),
            { requiredScopes: ['rag:write'] },
        );

        expect(resolved.error).toBeNull();
        expect(resolved.principal).toMatchObject({
            tenantId: 'tenant_1',
            clientName: 'Partner lab gateway',
            scopes: ['rag:write'],
        });

        const revoked = await revokeOAuthAccessToken({
            client: memory.client,
            token: issued.accessToken,
            authenticatedClientId: created.oauthClient.client_id,
        });
        expect(revoked).toEqual({ revoked: true });

        const resolvedAfterRevocation = await resolveOAuthClientCredentialsPrincipal(
            memory.client,
            new Request('https://vetios.test/api/ontology/global-one-health/populate', {
                headers: { authorization: `Bearer ${issued.accessToken}` },
            }),
            { requiredScopes: ['rag:write'] },
        );

        expect(resolvedAfterRevocation.error).toMatchObject({ status: 401 });
    });

    it('rejects tokens missing required scopes', async () => {
        const memory = createMemorySupabase();
        const created = await createOAuthClient({
            client: memory.client,
            tenantId: 'tenant_1',
            actor: null,
            clientName: 'Read-only client',
            allowedScopes: ['rag:read'],
        });
        const issued = await issueOAuthClientCredentialsToken({
            client: memory.client,
            clientId: created.oauthClient.client_id,
            clientSecret: created.clientSecret,
            requestedScopes: 'rag:read',
        });

        const resolved = await resolveOAuthClientCredentialsPrincipal(
            memory.client,
            new Request('https://vetios.test/api/ontology/global-one-health/populate', {
                headers: { authorization: `Bearer ${issued.accessToken}` },
            }),
            { requiredScopes: ['rag:write'] },
        );

        expect(resolved.error).toMatchObject({ status: 403 });
        expect(resolved.principal).toBeNull();
    });

    it('issues tokens using signed private_key_jwt client assertions', async () => {
        const memory = createMemorySupabase();
        const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
        const audience = 'https://vetios.test/api/oauth/token';

        const created = await createOAuthClient({
            client: memory.client,
            tenantId: 'tenant_1',
            actor: null,
            clientName: 'Federation node signer',
            allowedScopes: ['federation:node', 'secure_aggregation:write'],
            clientAuthMethods: ['private_key_jwt'],
            assertionAudiences: [audience],
            jwks: {
                keys: [{
                    ...publicJwk,
                    kid: 'node-key-1',
                    alg: 'RS256',
                    use: 'sig',
                }],
            },
        });

        const clientAssertion = signClientAssertion({
            clientId: created.oauthClient.client_id,
            audience,
            kid: 'node-key-1',
            privateKey,
        });
        const issued = await issueOAuthClientCredentialsToken({
            client: memory.client,
            clientAssertionType: OAUTH_CLIENT_ASSERTION_TYPE,
            clientAssertion,
            expectedAssertionAudiences: [audience],
            requestedScopes: 'federation:node',
        });

        expect(issued.accessToken).toMatch(/^vetios_at_/);
        expect(issued.oauthClient.client_auth_methods).toEqual(['private_key_jwt']);
        expect(issued.token.scopes).toEqual(['federation:node']);
        expect(issued.token.evidence).toMatchObject({
            client_auth_method: 'private_key_jwt',
            client_assertion_kid: 'node-key-1',
        });

        await expect(issueOAuthClientCredentialsToken({
            client: memory.client,
            clientAssertionType: OAUTH_CLIENT_ASSERTION_TYPE,
            clientAssertion: signClientAssertion({
                clientId: created.oauthClient.client_id,
                audience: 'https://attacker.test/api/oauth/token',
                kid: 'node-key-1',
                privateKey,
            }),
            expectedAssertionAudiences: [audience],
            requestedScopes: 'federation:node',
        })).rejects.toThrow(/audience/i);
    });
});

function createMemorySupabase(): {
    client: SupabaseClient;
    rows: Record<string, Array<Record<string, unknown>>>;
} {
    const rows: Record<string, Array<Record<string, unknown>>> = {
        oauth_clients: [],
        oauth_access_tokens: [],
        oauth_client_events: [],
        oauth_token_events: [],
    };

    const client = {
        from(table: string) {
            return new MemoryQuery(rows, table);
        },
    } as unknown as SupabaseClient;

    return { client, rows };
}

class MemoryQuery {
    private filters: Array<{ key: string; value: unknown }> = [];
    private pendingInsert: Record<string, unknown> | null = null;
    private pendingUpdate: Record<string, unknown> | null = null;
    private resultRows: Array<Record<string, unknown>> | null = null;

    constructor(
        private readonly rows: Record<string, Array<Record<string, unknown>>>,
        private readonly table: string,
    ) {}

    select() {
        return this;
    }

    order() {
        return this;
    }

    limit() {
        return this;
    }

    eq(key: string, value: unknown) {
        this.filters.push({ key, value });
        return this;
    }

    insert(payload: Record<string, unknown>) {
        const row = {
            id: randomUuid(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...payload,
        };
        this.rows[this.table] ??= [];
        this.rows[this.table].push(row);
        this.pendingInsert = row;
        this.resultRows = [row];
        return this;
    }

    update(payload: Record<string, unknown>) {
        this.pendingUpdate = payload;
        return this;
    }

    async single() {
        const data = this.execute()[0] ?? null;
        return data
            ? { data, error: null }
            : { data: null, error: { message: 'No rows found' } };
    }

    async maybeSingle() {
        return { data: this.execute()[0] ?? null, error: null };
    }

    then<TResult1 = { error: null }, TResult2 = never>(
        onfulfilled?: ((value: { error: null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
        try {
            this.execute();
            return Promise.resolve({ error: null }).then(onfulfilled, onrejected);
        } catch (error) {
            return Promise.reject(error).then(onfulfilled, onrejected);
        }
    }

    private execute(): Array<Record<string, unknown>> {
        this.rows[this.table] ??= [];
        if (this.pendingInsert) {
            return [this.pendingInsert];
        }
        if (this.pendingUpdate) {
            const targets = this.filteredRows();
            for (const row of targets) {
                Object.assign(row, this.pendingUpdate);
            }
            this.resultRows = targets;
            return targets;
        }
        return this.resultRows ?? this.filteredRows();
    }

    private filteredRows(): Array<Record<string, unknown>> {
        return this.rows[this.table].filter((row) =>
            this.filters.every((filter) => row[filter.key] === filter.value));
    }
}

function randomUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const value = Math.floor(Math.random() * 16);
        const nibble = char === 'x' ? value : (value & 0x3) | 0x8;
        return nibble.toString(16);
    });
}

function signClientAssertion(input: {
    clientId: string;
    audience: string;
    kid: string;
    privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
}): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlJson({ alg: 'RS256', typ: 'JWT', kid: input.kid });
    const payload = base64UrlJson({
        iss: input.clientId,
        sub: input.clientId,
        aud: input.audience,
        iat: now,
        exp: now + 240,
        jti: randomUuid(),
    });
    const signature = sign(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        input.privateKey,
    ).toString('base64url');
    return `${header}.${payload}.${signature}`;
}

function base64UrlJson(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}
