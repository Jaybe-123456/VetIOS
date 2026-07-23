import { lookup } from 'dns/promises';
import { request as httpsRequest } from 'https';
import { isIP } from 'net';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024;

const BLOCKED_HOST_SUFFIXES = [
    '.localhost',
    '.local',
    '.internal',
    '.home',
    '.lan',
    '.corp',
    '.test',
    '.invalid',
    '.example',
];

const BLOCKED_HOSTS = new Set([
    'localhost',
    'metadata.google.internal',
    'metadata.aws.internal',
    'instance-data',
    'instance-data.ec2.internal',
    '169.254.169.254',
]);

export interface SafeOutboundRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
    headers?: Record<string, string>;
    body?: string | Buffer;
    timeoutMs?: number;
    maxResponseBytes?: number;
    maxRequestBytes?: number;
    allowedContentTypes?: RegExp;
}

export interface SafeOutboundResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: Buffer;
    text(): string;
}

export async function validateSafeOutboundUrl(value: string): Promise<URL> {
    const parsed = validateOutboundUrlSyntax(value);
    await resolvePublicAddress(parsed.hostname);
    return parsed;
}

export async function safeOutboundRequest(
    value: string,
    options: SafeOutboundRequestOptions = {},
): Promise<SafeOutboundResponse> {
    const parsed = validateOutboundUrlSyntax(value);
    const resolved = await resolvePublicAddress(parsed.hostname);
    const body = options.body == null
        ? null
        : Buffer.isBuffer(options.body)
            ? options.body
            : Buffer.from(options.body, 'utf8');
    const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    if (body && body.byteLength > maxRequestBytes) {
        throw new Error(`Outbound request body exceeds ${maxRequestBytes} bytes.`);
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    const headers = sanitizeHeaders(options.headers ?? {});
    headers.host = parsed.host;
    if (body && !headers['content-length']) {
        headers['content-length'] = String(body.byteLength);
    }

    return new Promise<SafeOutboundResponse>((resolve, reject) => {
        let settled = false;
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };

        const request = httpsRequest({
            protocol: 'https:',
            hostname: resolved.address,
            port: 443,
            servername: isIP(parsed.hostname) === 0 ? parsed.hostname : undefined,
            method: options.method ?? 'GET',
            path: `${parsed.pathname}${parsed.search}`,
            headers,
            rejectUnauthorized: true,
        }, (response) => {
            const contentLength = Number(response.headers['content-length'] ?? '0');
            if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
                response.destroy();
                fail(new Error(`Outbound response exceeds ${maxResponseBytes} bytes.`));
                return;
            }

            const responseHeaders = normalizeResponseHeaders(response.headers);
            const contentType = responseHeaders['content-type'] ?? '';
            if (options.allowedContentTypes && contentType && !options.allowedContentTypes.test(contentType)) {
                response.destroy();
                fail(new Error(`Outbound response content type is not allowed: ${contentType}.`));
                return;
            }

            const chunks: Buffer[] = [];
            let bytesRead = 0;
            response.on('data', (chunk: Buffer | string) => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                bytesRead += buffer.byteLength;
                if (bytesRead > maxResponseBytes) {
                    response.destroy(new Error(`Outbound response exceeds ${maxResponseBytes} bytes.`));
                    return;
                }
                chunks.push(buffer);
            });
            response.on('error', (error) => fail(error));
            response.on('end', () => {
                if (settled) return;
                settled = true;
                const responseBody = Buffer.concat(chunks);
                const status = response.statusCode ?? 0;
                resolve({
                    ok: status >= 200 && status < 300,
                    status,
                    statusText: response.statusMessage ?? '',
                    headers: responseHeaders,
                    body: responseBody,
                    text: () => responseBody.toString('utf8'),
                });
            });
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Outbound request timed out after ${timeoutMs}ms.`));
        });
        request.on('error', (error) => fail(error));
        if (body) request.write(body);
        request.end();
    });
}

export function validateOutboundUrlSyntax(value: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(value.trim());
    } catch {
        throw new Error('Outbound URL must be a valid URL.');
    }

    if (parsed.protocol !== 'https:') {
        throw new Error('Outbound URL must use HTTPS.');
    }
    if (parsed.username || parsed.password) {
        throw new Error('Outbound URL credentials are not allowed.');
    }
    if (parsed.port && parsed.port !== '443') {
        throw new Error('Outbound URL must use the standard HTTPS port.');
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
        BLOCKED_HOSTS.has(hostname)
        || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
        || hostname.endsWith('.metadata.google.internal')
    ) {
        throw new Error('Local, private, metadata, and reserved outbound hosts are not allowed.');
    }
    if (isIP(hostname) > 0 && !isPublicInternetAddress(hostname)) {
        throw new Error('Local, private, metadata, and reserved outbound addresses are not allowed.');
    }

    parsed.hash = '';
    return parsed;
}

export function isPublicInternetAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) return isPublicIpv4(address);
    if (family === 6) return isPublicIpv6(address);
    return false;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: number }> {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (isIP(normalized) > 0) {
        if (!isPublicInternetAddress(normalized)) {
            throw new Error('Outbound address is not publicly routable.');
        }
        return { address: normalized, family: isIP(normalized) };
    }

    const addresses = await lookup(normalized, { all: true, verbatim: true });
    if (addresses.length === 0) {
        throw new Error('Outbound host did not resolve.');
    }
    if (addresses.some((entry) => !isPublicInternetAddress(entry.address))) {
        throw new Error('Outbound host resolves to a non-public address.');
    }
    return addresses[0];
}

function isPublicIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }
    const [a, b, c] = octets;
    return !(a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 0 && c === 0)
        || (a === 192 && b === 0 && c === 2)
        || (a === 192 && b === 88 && c === 99)
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19))
        || (a === 198 && b === 51 && c === 100)
        || (a === 203 && b === 0 && c === 113)
        || a >= 224);
}

function isPublicIpv6(address: string): boolean {
    const bytes = parseIpv6Bytes(address);
    if (!bytes) return false;

    const allZero = bytes.every((byte) => byte === 0);
    const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
    if (allZero || loopback) return false;

    const ipv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0)
        && bytes[10] === 0xff
        && bytes[11] === 0xff;
    const ipv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0);
    if (ipv4Mapped || ipv4Compatible) {
        return isPublicIpv4(bytes.slice(12).join('.'));
    }

    const uniqueLocal = (bytes[0] & 0xfe) === 0xfc;
    const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
    const siteLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0;
    const multicast = bytes[0] === 0xff;
    const documentation = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
    const teredo = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0 && bytes[3] === 0;
    const sixToFour = bytes[0] === 0x20 && bytes[1] === 0x02;
    const nat64 = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b;
    const discardOnly = bytes[0] === 0x01
        && bytes.slice(1, 8).every((byte) => byte === 0);

    return !(uniqueLocal || linkLocal || siteLocal || multicast || documentation || teredo || sixToFour || nat64 || discardOnly);
}

function parseIpv6Bytes(address: string): number[] | null {
    let normalized = address.toLowerCase().split('%', 1)[0];
    const dottedTail = normalized.match(/(^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[2];
    if (dottedTail) {
        const octets = dottedTail.split('.').map(Number);
        if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
        const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
        normalized = `${normalized.slice(0, -dottedTail.length)}${replacement}`;
    }

    const halves = normalized.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    if ([...left, ...right].some((part) => !/^[a-f0-9]{1,4}$/.test(part))) return null;

    const missing = 8 - left.length - right.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
    const words = [
        ...left.map((part) => Number.parseInt(part, 16)),
        ...Array.from({ length: Math.max(0, missing) }, () => 0),
        ...right.map((part) => Number.parseInt(part, 16)),
    ];
    if (words.length !== 8) return null;
    return words.flatMap((word) => [word >>> 8, word & 0xff]);
}

function sanitizeHeaders(input: Record<string, string>): Record<string, string> {
    const output: Record<string, string> = {};
    for (const [name, value] of Object.entries(input)) {
        const normalized = name.trim().toLowerCase();
        if (!normalized || normalized === 'host' || normalized === 'connection' || normalized === 'transfer-encoding') {
            continue;
        }
        output[normalized] = value;
    }
    return output;
}

function normalizeResponseHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value)) normalized[name.toLowerCase()] = value.join(', ');
        else if (typeof value === 'string') normalized[name.toLowerCase()] = value;
    }
    return normalized;
}
