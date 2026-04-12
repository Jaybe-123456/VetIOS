import { createHash } from 'crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabaseServer';

const LOGIN_BODY_MAX_BYTES = 8 * 1024;

export const AUTH_MAX_FAILURES = readIntegerEnv('AUTH_MAX_FAILURES', 5);
export const AUTH_CAPTCHA_AFTER_FAILURES = Math.min(
    AUTH_MAX_FAILURES,
    readIntegerEnv('AUTH_CAPTCHA_AFTER_FAILURES', 3),
);
export const AUTH_FAILURE_LOOKBACK_MS = readIntegerEnv('AUTH_FAILURE_LOOKBACK_MINUTES', 1_440) * 60_000;
export const AUTH_LOCKOUT_MS = readIntegerEnv('AUTH_LOCKOUT_MINUTES', 30) * 60_000;
export const AUTH_IP_BLOCK_AFTER_FAILURES = Math.max(
    AUTH_MAX_FAILURES,
    readIntegerEnv('AUTH_IP_BLOCK_AFTER_FAILURES', 10),
);
export const AUTH_IP_BLOCK_LOOKBACK_MS = readIntegerEnv('AUTH_IP_BLOCK_LOOKBACK_MINUTES', 60) * 60_000;
export const AUTH_IP_BLOCK_MS = readIntegerEnv('AUTH_IP_BLOCK_MINUTES', 60) * 60_000;

const LoginRequestSchema = z.object({
    email: z.string()
        .trim()
        .min(3)
        .max(320)
        .refine((value) => !containsNullByte(value), 'Invalid email or password.')
        .refine((value) => isPlausibleEmail(value), 'Invalid email or password.')
        .transform((value) => value.toLowerCase()),
    password: z.string()
        .min(1)
        .max(1_024)
        .refine((value) => !containsNullByte(value), 'Invalid email or password.'),
    captchaToken: z.string()
        .trim()
        .min(1)
        .max(2_048)
        .nullable()
        .optional(),
    rememberMe: z.boolean().optional().default(false),
}).strict();

const PRIMARY_IP_HEADER_NAMES = [
    'cf-connecting-ip',
    'x-vercel-forwarded-for',
    'x-real-ip',
    'x-forwarded-for',
] as const;

const SECONDARY_IP_HEADER_NAMES = [
    'true-client-ip',
    'x-client-ip',
    'client-ip',
    'x-originating-ip',
    'x-remote-ip',
    'x-remote-addr',
    'x-original-forwarded-for',
] as const;

type AuthLoginEventOutcome = 'success' | 'failure' | 'blocked' | 'rejected';

interface AuthLoginEventRow {
    created_at: string;
}

export interface ParsedPasswordLoginRequest {
    email: string;
    password: string;
    captchaToken: string | null;
    rememberMe: boolean;
}

export interface PasswordLoginHeaderContext {
    clientIp: string;
    userAgentHash: string | null;
}

export interface PasswordLoginProtectionState {
    emailHash: string;
    ipHash: string;
    ipEmailHash: string;
    emailFailureCount: number;
    ipFailureCount: number;
    captchaRequired: boolean;
    accountLockedUntil: string | null;
    ipBlockedUntil: string | null;
}

export interface PasswordLoginEventInput {
    emailHash: string;
    ipHash: string;
    ipEmailHash: string;
    outcome: AuthLoginEventOutcome;
    reason: string;
    requestId: string;
    userAgentHash?: string | null;
    metadata?: Record<string, unknown>;
}

export function isCaptchaProtectionEnabled(): boolean {
    if (process.env.VETIOS_DEV_BYPASS === 'true') {
        return false;
    }
    return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

export async function parsePasswordLoginRequest(req: Request): Promise<{
    ok: true;
    data: ParsedPasswordLoginRequest;
} | {
    ok: false;
    status: number;
    error: string;
}> {
    const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
        return {
            ok: false,
            status: 415,
            error: 'Content-Type must be application/json.',
        };
    }

    const contentLength = req.headers.get('content-length');
    if (contentLength) {
        const parsedContentLength = Number.parseInt(contentLength, 10);
        if (Number.isFinite(parsedContentLength) && parsedContentLength > LOGIN_BODY_MAX_BYTES) {
            return {
                ok: false,
                status: 413,
                error: 'Authentication request body is too large.',
            };
        }
    }

    let rawBody = '';

    try {
        rawBody = await req.text();
    } catch {
        return {
            ok: false,
            status: 400,
            error: 'Unable to read authentication request body.',
        };
    }

    if (!rawBody.trim()) {
        return {
            ok: false,
            status: 400,
            error: 'Missing authentication payload.',
        };
    }

    if (rawBody.length > LOGIN_BODY_MAX_BYTES) {
        return {
            ok: false,
            status: 413,
            error: 'Authentication request body is too large.',
        };
    }

    if (rawBody.includes('\0')) {
        return {
            ok: false,
            status: 400,
            error: 'Null bytes are not allowed in authentication requests.',
        };
    }

    let parsedBody: unknown;

    try {
        parsedBody = JSON.parse(rawBody);
    } catch {
        return {
            ok: false,
            status: 400,
            error: 'Invalid authentication payload.',
        };
    }

    const result = LoginRequestSchema.safeParse(parsedBody);
    if (!result.success) {
        return {
            ok: false,
            status: 400,
            error: 'Invalid email or password.',
        };
    }

    return {
        ok: true,
        data: {
            email: result.data.email,
            password: result.data.password,
            captchaToken: result.data.captchaToken ?? null,
            rememberMe: result.data.rememberMe,
        },
    };
}

export function validatePasswordLoginHeaders(req: Request): {
    ok: true;
    data: PasswordLoginHeaderContext;
} | {
    ok: false;
    status: number;
    error: string;
} {
    const expectedOrigin = new URL(req.url).origin;
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    const secFetchSite = req.headers.get('sec-fetch-site');

    if (origin && origin !== expectedOrigin) {
        return {
            ok: false,
            status: 403,
            error: 'Cross-origin authentication requests are not allowed.',
        };
    }

    if (referer) {
        try {
            if (new URL(referer).origin !== expectedOrigin) {
                return {
                    ok: false,
                    status: 403,
                    error: 'Authentication referer validation failed.',
                };
            }
        } catch {
            return {
                ok: false,
                status: 403,
                error: 'Authentication referer validation failed.',
            };
        }
    }

    if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
        return {
            ok: false,
            status: 403,
            error: 'Cross-site authentication requests are not allowed.',
        };
    }

    const clientIp = resolveClientIp(req.headers);
    if ('error' in clientIp) {
        return {
            ok: false,
            status: 403,
            error: clientIp.error,
        };
    }

    return {
        ok: true,
        data: {
            clientIp: clientIp.ip,
            userAgentHash: req.headers.get('user-agent')
                ? hashValue(`ua:${req.headers.get('user-agent')}`)
                : null,
        },
    };
}

export async function evaluatePasswordLoginProtection(
    email: string,
    clientIp: string,
): Promise<PasswordLoginProtectionState> {
    if (process.env.VETIOS_DEV_BYPASS === 'true') {
        return {
            emailHash: 'dev',
            ipHash: 'dev',
            ipEmailHash: 'dev',
            emailFailureCount: 0,
            ipFailureCount: 0,
            captchaRequired: false,
            accountLockedUntil: null,
            ipBlockedUntil: null,
        };
    }

    const now = Date.now();
    const accountCutoff = new Date(now - AUTH_FAILURE_LOOKBACK_MS).toISOString();
    const ipCutoff = new Date(now - AUTH_IP_BLOCK_LOOKBACK_MS).toISOString();
    const emailHash = hashValue(`email:${email}`);
    const ipHash = hashValue(`ip:${clientIp}`);
    const ipEmailHash = hashValue(`ip-email:${clientIp}:${email}`);
    const supabase = getSupabaseServer();

    const latestSuccessQuery = supabase
        .from('auth_login_events')
        .select('created_at')
        .eq('email_hash', emailHash)
        .eq('outcome', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const emailFailuresQuery = supabase
        .from('auth_login_events')
        .select('created_at')
        .eq('email_hash', emailHash)
        .eq('outcome', 'failure')
        .gte('created_at', accountCutoff)
        .order('created_at', { ascending: false })
        .limit(Math.max(AUTH_MAX_FAILURES, AUTH_CAPTCHA_AFTER_FAILURES) + 5);

    const ipFailuresQuery = supabase
        .from('auth_login_events')
        .select('created_at')
        .eq('ip_hash', ipHash)
        .eq('outcome', 'failure')
        .gte('created_at', ipCutoff)
        .order('created_at', { ascending: false })
        .limit(Math.max(AUTH_IP_BLOCK_AFTER_FAILURES, AUTH_CAPTCHA_AFTER_FAILURES));

    const [latestSuccessResult, emailFailuresResult, ipFailuresResult] = await Promise.all([
        latestSuccessQuery,
        emailFailuresQuery,
        ipFailuresQuery,
    ]);

    if (latestSuccessResult.error) {
        throw new Error(`Failed to load latest login success event: ${latestSuccessResult.error.message}`);
    }
    if (emailFailuresResult.error) {
        throw new Error(`Failed to load email login failures: ${emailFailuresResult.error.message}`);
    }
    if (ipFailuresResult.error) {
        throw new Error(`Failed to load IP login failures: ${ipFailuresResult.error.message}`);
    }

    const latestSuccessMs = latestSuccessResult.data?.created_at
        ? Date.parse(latestSuccessResult.data.created_at)
        : 0;

    const emailFailures = ((emailFailuresResult.data ?? []) as AuthLoginEventRow[])
        .filter((row) => Date.parse(row.created_at) > latestSuccessMs);
    const ipFailures = (ipFailuresResult.data ?? []) as AuthLoginEventRow[];

    return {
        emailHash,
        ipHash,
        ipEmailHash,
        emailFailureCount: emailFailures.length,
        ipFailureCount: ipFailures.length,
        captchaRequired:
            emailFailures.length >= AUTH_CAPTCHA_AFTER_FAILURES
            || ipFailures.length >= AUTH_CAPTCHA_AFTER_FAILURES,
        accountLockedUntil: resolveSlidingBlockUntil(emailFailures, AUTH_MAX_FAILURES, AUTH_LOCKOUT_MS),
        ipBlockedUntil: resolveSlidingBlockUntil(ipFailures, AUTH_IP_BLOCK_AFTER_FAILURES, AUTH_IP_BLOCK_MS),
    };
}

export async function logPasswordLoginEvent(input: PasswordLoginEventInput): Promise<void> {
    const { error } = await getSupabaseServer().from('auth_login_events').insert({
        email_hash: input.emailHash,
        ip_hash: input.ipHash,
        ip_email_hash: input.ipEmailHash,
        outcome: input.outcome,
        reason: input.reason,
        request_id: input.requestId,
        user_agent_hash: input.userAgentHash ?? null,
        metadata: input.metadata ?? {},
    });

    if (error) {
        throw new Error(`Failed to persist auth login event: ${error.message}`);
    }
}

export async function verifyPasswordLoginCaptcha(
    token: string,
): Promise<{
    ok: boolean;
    errorCodes: string[];
}> {
    if (!isCaptchaProtectionEnabled()) {
        return {
            ok: true,
            errorCodes: [],
        };
    }

    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
        console.error('TURNSTILE_SECRET_KEY is missing from environment variables.');
        return {
            ok: false,
            errorCodes: ['missing-input-secret'],
        };
    }

    const body = new URLSearchParams({
        secret,
        response: token,
    });

    try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
            cache: 'no-store',
        });

        if (!response.ok) {
            console.error(`Turnstile verification HTTP error: ${response.status}`);
            return {
                ok: false,
                errorCodes: [`http_${response.status}`],
            };
        }

        const payload = await response.json() as {
            success?: boolean;
            ['error-codes']?: string[];
            hostname?: string;
        };

        if (payload.success !== true) {
            console.warn('[AUTH_SECURITY] Turnstile verification failed for token. Error codes:', payload['error-codes']);
            
            // If the error is 'invalid-input-secret', it's a critical configuration issue.
            if (payload['error-codes']?.includes('invalid-input-secret')) {
                console.error('[CRITICAL] TURNSTILE_SECRET_KEY is invalid according to Cloudflare.');
            }
        }

        return {
            ok: payload.success === true,
            errorCodes: Array.isArray(payload['error-codes']) ? payload['error-codes'] : [],
        };
    } catch (error: any) {
        console.error('[AUTH_SECURITY] Turnstile verification request failed:', error?.message || error);
        return {
            ok: false,
            errorCodes: ['request_failed'],
        };
    }
}

function readIntegerEnv(name: string, fallback: number): number {
    const rawValue = process.env[name];
    if (!rawValue) return fallback;

    const parsed = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function containsNullByte(value: string): boolean {
    return value.includes('\0');
}

function isPlausibleEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function resolveClientIp(headers: Headers): {
    ip: string;
} | {
    error: string;
} {
    const primaryCandidates: string[] = [];

    for (const headerName of PRIMARY_IP_HEADER_NAMES) {
        const result = readIpHeader(headers.get(headerName), headerName === 'x-forwarded-for');
        if (result === 'invalid') {
            return { error: `Rejected malformed ${headerName} header.` };
        }

        if (result) {
            primaryCandidates.push(result);
        }
    }

    const uniquePrimaryCandidates = [...new Set(primaryCandidates)];
    const canonicalIp = uniquePrimaryCandidates[0] ?? 'unknown';

    if (uniquePrimaryCandidates.length > 1) {
        return { error: 'Rejected conflicting client IP headers.' };
    }

    for (const headerName of SECONDARY_IP_HEADER_NAMES) {
        const result = readIpHeader(headers.get(headerName), headerName.includes('forwarded'));
        if (result === 'invalid') {
            return { error: `Rejected malformed ${headerName} header.` };
        }

        if (result && canonicalIp !== 'unknown' && result !== canonicalIp) {
            return { error: `Rejected spoofed ${headerName} header.` };
        }
    }

    return { ip: canonicalIp };
}

function readIpHeader(value: string | null, allowMultiple: boolean): string | null | 'invalid' {
    if (!value) return null;
    if (value.includes('\0')) return 'invalid';

    const parts = allowMultiple ? value.split(',') : [value];
    const normalizedParts = parts
        .map((part) => normalizeIp(part.trim()))
        .filter(Boolean);

    if (normalizedParts.length === 0) {
        return null;
    }

    if (normalizedParts.some((part) => isIP(part) === 0)) {
        return 'invalid';
    }

    return normalizedParts[0] ?? null;
}

function normalizeIp(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return '';

    if (trimmed.startsWith('::ffff:')) {
        const ipv4Candidate = trimmed.slice(7);
        if (isIP(ipv4Candidate) === 4) {
            return ipv4Candidate;
        }
    }

    return trimmed;
}

function resolveSlidingBlockUntil(
    failures: AuthLoginEventRow[],
    threshold: number,
    durationMs: number,
): string | null {
    if (failures.length < threshold) {
        return null;
    }

    const latestFailure = failures[0];
    if (!latestFailure) {
        return null;
    }

    const blockedUntilMs = Date.parse(latestFailure.created_at) + durationMs;
    if (!Number.isFinite(blockedUntilMs) || blockedUntilMs <= Date.now()) {
        return null;
    }

    return new Date(blockedUntilMs).toISOString();
}
