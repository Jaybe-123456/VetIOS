import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { EvidenceNodeSubmissionDraft } from './index.js';

export interface EvidenceNodeTlsMaterial {
    pfx?: Buffer;
    passphrase?: string;
    cert?: Buffer;
    key?: Buffer;
    ca?: Buffer;
    servername?: string;
}

export interface VetiosEvidenceNodeClientOptions {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    scopes?: string[];
    tokenPath?: string;
    operationsPath?: string;
    timeoutMs?: number;
    tls: EvidenceNodeTlsMaterial;
}

export interface EvidenceNodeRemoteResponse {
    status: number;
    body: Record<string, unknown>;
    request_id: string | null;
}

interface CachedToken {
    accessToken: string;
    expiresAtMs: number;
}

export class EvidenceNodeRemoteError extends Error {
    readonly status: number;
    readonly response: Record<string, unknown>;
    readonly retryable: boolean;

    constructor(message: string, status: number, response: Record<string, unknown>) {
        super(message);
        this.name = 'EvidenceNodeRemoteError';
        this.status = status;
        this.response = response;
        this.retryable = status === 408 || status === 425 || status === 429 || status >= 500;
    }
}

export class VetiosEvidenceNodeClient {
    private readonly options: Required<Pick<
        VetiosEvidenceNodeClientOptions,
        'tokenPath' | 'operationsPath' | 'timeoutMs'
    >> & VetiosEvidenceNodeClientOptions;
    private cachedToken: CachedToken | null = null;

    constructor(options: VetiosEvidenceNodeClientOptions) {
        const baseUrl = new URL(options.baseUrl);
        if (baseUrl.protocol !== 'https:') {
            throw new Error('VetIOS Evidence Node requires an HTTPS control-plane URL.');
        }
        if (!options.clientId.trim() || !options.clientSecret.trim()) {
            throw new Error('VetIOS Evidence Node OAuth client credentials are required.');
        }
        if (!options.tls.pfx && !(options.tls.cert && options.tls.key)) {
            throw new Error('VetIOS Evidence Node requires a client PFX or certificate/key pair.');
        }
        this.options = {
            ...options,
            baseUrl: baseUrl.toString().replace(/\/$/, ''),
            tokenPath: options.tokenPath ?? '/api/oauth/token',
            operationsPath: options.operationsPath ?? '/api/amr/network-operations',
            timeoutMs: options.timeoutMs ?? 30_000,
        };
    }

    async ingest(submission: EvidenceNodeSubmissionDraft): Promise<EvidenceNodeRemoteResponse> {
        return this.authorizedJson('POST', this.options.operationsPath, submission);
    }

    async operationsSnapshot(): Promise<EvidenceNodeRemoteResponse> {
        return this.authorizedJson('GET', this.options.operationsPath);
    }

    async recordProbe(payload: Record<string, unknown>): Promise<EvidenceNodeRemoteResponse> {
        return this.authorizedJson('POST', this.options.operationsPath, payload);
    }

    async authorizedJson(
        method: 'GET' | 'POST',
        path: string,
        body?: unknown,
    ): Promise<EvidenceNodeRemoteResponse> {
        const token = await this.getAccessToken();
        let response = await this.request({
            method,
            path,
            body,
            headers: { authorization: `Bearer ${token}` },
        });
        if (response.status === 401) {
            this.cachedToken = null;
            response = await this.request({
                method,
                path,
                body,
                headers: { authorization: `Bearer ${await this.getAccessToken()}` },
            });
        }
        return requireSuccess(response);
    }

    private async getAccessToken(): Promise<string> {
        if (this.cachedToken && this.cachedToken.expiresAtMs > Date.now() + 15_000) {
            return this.cachedToken.accessToken;
        }
        const form = new URLSearchParams({
            grant_type: 'client_credentials',
            scope: (this.options.scopes ?? ['amr:read', 'amr:ingest']).join(' '),
        }).toString();
        const response = await this.request({
            method: 'POST',
            path: this.options.tokenPath,
            rawBody: form,
            headers: {
                authorization: `Basic ${Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64')}`,
                'content-type': 'application/x-www-form-urlencoded',
            },
        });
        const success = requireSuccess(response);
        const accessToken = readText(success.body.access_token);
        if (!accessToken) throw new Error('VetIOS OAuth token response did not include access_token.');
        const expiresIn = readPositiveNumber(success.body.expires_in) ?? 300;
        this.cachedToken = {
            accessToken,
            expiresAtMs: Date.now() + Math.min(expiresIn, 3600) * 1000,
        };
        return accessToken;
    }

    private async request(input: {
        method: 'GET' | 'POST';
        path: string;
        body?: unknown;
        rawBody?: string;
        headers?: Record<string, string>;
    }): Promise<EvidenceNodeRemoteResponse> {
        const base = new URL(this.options.baseUrl);
        const target = new URL(input.path, base);
        if (target.origin !== base.origin) {
            throw new Error('Evidence Node request path cannot change the configured control-plane origin.');
        }
        const serialized = input.rawBody ?? (input.body ? JSON.stringify(input.body) : null);
        const tls = this.options.tls;
        const requestOptions: RequestOptions = {
            protocol: 'https:',
            hostname: target.hostname,
            port: target.port ? Number(target.port) : 443,
            method: input.method,
            path: `${target.pathname}${target.search}`,
            timeout: this.options.timeoutMs,
            rejectUnauthorized: true,
            servername: tls.servername ?? target.hostname,
            pfx: tls.pfx,
            passphrase: tls.passphrase,
            cert: tls.cert,
            key: tls.key,
            ca: tls.ca,
            headers: {
                accept: 'application/json',
                ...(serialized && !input.rawBody ? { 'content-type': 'application/json' } : {}),
                ...(serialized ? { 'content-length': Buffer.byteLength(serialized).toString() } : {}),
                ...input.headers,
            },
        };
        return new Promise((resolve, reject) => {
            const request = httpsRequest(requestOptions, (response) => {
                const chunks: Buffer[] = [];
                let total = 0;
                response.on('data', (chunk: Buffer) => {
                    total += chunk.length;
                    if (total > 5 * 1024 * 1024) {
                        request.destroy(new Error('VetIOS response exceeded 5 MB.'));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let body: Record<string, unknown> = {};
                    if (text.trim()) {
                        try {
                            const parsed = JSON.parse(text) as unknown;
                            body = isRecord(parsed) ? parsed : { value: parsed };
                        } catch {
                            body = { error: 'non_json_response', detail: text.slice(0, 1000) };
                        }
                    }
                    resolve({
                        status: response.statusCode ?? 500,
                        body,
                        request_id: readText(body.request_id),
                    });
                });
            });
            request.on('timeout', () => request.destroy(new Error('VetIOS Evidence Node request timed out.')));
            request.on('error', reject);
            if (serialized) request.write(serialized);
            request.end();
        });
    }
}

function requireSuccess(response: EvidenceNodeRemoteResponse): EvidenceNodeRemoteResponse {
    if (response.status >= 200 && response.status < 300) return response;
    throw new EvidenceNodeRemoteError(
        readText(response.body.error) ?? `VetIOS request failed with status ${response.status}.`,
        response.status,
        response.body,
    );
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPositiveNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
