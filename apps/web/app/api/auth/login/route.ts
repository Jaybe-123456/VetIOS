import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
    AUTH_MAX_FAILURES,
    evaluatePasswordLoginProtection,
    isCaptchaProtectionEnabled,
    logPasswordLoginEvent,
    parsePasswordLoginRequest,
    validatePasswordLoginHeaders,
    verifyPasswordLoginCaptcha,
} from '@/lib/auth/passwordLoginSecurity';
import { getRequestId, withRequestHeaders } from '@/lib/http/requestId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const requestId = getRequestId(req);
    const startTime = Date.now();

    const headerValidation = validatePasswordLoginHeaders(req);
    if (!headerValidation.ok) {
        return createLoginResponse({
            status: headerValidation.status,
            requestId,
            startTime,
            body: {
                error: headerValidation.error,
                code: 'invalid_request_headers',
                captcha_required: false,
            },
        });
    }

    const bodyValidation = await parsePasswordLoginRequest(req);
    if (!bodyValidation.ok) {
        return createLoginResponse({
            status: bodyValidation.status,
            requestId,
            startTime,
            body: {
                error: bodyValidation.error,
                code: 'invalid_authentication_request',
                captcha_required: false,
            },
        });
    }

    const { clientIp, userAgentHash } = headerValidation.data;
    const { email, password, captchaToken } = bodyValidation.data;

    try {
        let protection = await evaluatePasswordLoginProtection(email, clientIp);

        if (protection.ipBlockedUntil) {
            await safeLogLoginEvent({
                emailHash: protection.emailHash,
                ipHash: protection.ipHash,
                ipEmailHash: protection.ipEmailHash,
                outcome: 'blocked',
                reason: 'ip_blocked',
                requestId,
                userAgentHash,
            });

            return createTemporaryBlockResponse({
                status: 429,
                requestId,
                startTime,
                error: 'Too many failed sign-in attempts from this network. Try again later.',
                code: 'ip_blocked',
                retryUntil: protection.ipBlockedUntil,
                remainingAttempts: 0,
                captchaRequired: true,
            });
        }

        if (protection.accountLockedUntil) {
            await safeLogLoginEvent({
                emailHash: protection.emailHash,
                ipHash: protection.ipHash,
                ipEmailHash: protection.ipEmailHash,
                outcome: 'blocked',
                reason: 'account_locked',
                requestId,
                userAgentHash,
            });

            return createTemporaryBlockResponse({
                status: 429,
                requestId,
                startTime,
                error: 'Too many failed sign-in attempts. This account is temporarily locked.',
                code: 'account_locked',
                retryUntil: protection.accountLockedUntil,
                remainingAttempts: 0,
                captchaRequired: true,
            });
        }

        if (protection.captchaRequired) {
            if (!isCaptchaProtectionEnabled()) {
                return createLoginResponse({
                    status: 503,
                    requestId,
                    startTime,
                    remainingAttempts: Math.max(0, AUTH_MAX_FAILURES - protection.emailFailureCount),
                    body: {
                        error: 'Security challenge is required, but CAPTCHA is not configured.',
                        code: 'captcha_unavailable',
                        captcha_required: true,
                    },
                });
            }

            if (!captchaToken) {
                return createLoginResponse({
                    status: 400,
                    requestId,
                    startTime,
                    remainingAttempts: Math.max(0, AUTH_MAX_FAILURES - protection.emailFailureCount),
                    body: {
                        error: 'Complete the CAPTCHA challenge to continue.',
                        code: 'captcha_required',
                        captcha_required: true,
                    },
                });
            }

            const captchaVerified = await verifyPasswordLoginCaptcha(captchaToken, clientIp);
            if (!captchaVerified) {
                await safeLogLoginEvent({
                    emailHash: protection.emailHash,
                    ipHash: protection.ipHash,
                    ipEmailHash: protection.ipEmailHash,
                    outcome: 'rejected',
                    reason: 'captcha_failed',
                    requestId,
                    userAgentHash,
                });

                return createLoginResponse({
                    status: 400,
                    requestId,
                    startTime,
                    remainingAttempts: Math.max(0, AUTH_MAX_FAILURES - protection.emailFailureCount),
                    body: {
                        error: 'CAPTCHA verification failed. Try the challenge again.',
                        code: 'captcha_failed',
                        captcha_required: true,
                    },
                });
            }
        }

        const supabase = await createPasswordLoginClient();
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            await logPasswordLoginEvent({
                emailHash: protection.emailHash,
                ipHash: protection.ipHash,
                ipEmailHash: protection.ipEmailHash,
                outcome: 'failure',
                reason: 'invalid_credentials',
                requestId,
                userAgentHash,
                metadata: {
                    provider: 'password',
                },
            });

            protection = await evaluatePasswordLoginProtection(email, clientIp);

            if (protection.ipBlockedUntil) {
                return createTemporaryBlockResponse({
                    status: 429,
                    requestId,
                    startTime,
                    error: 'Too many failed sign-in attempts from this network. Try again later.',
                    code: 'ip_blocked',
                    retryUntil: protection.ipBlockedUntil,
                    remainingAttempts: 0,
                    captchaRequired: true,
                });
            }

            if (protection.accountLockedUntil) {
                return createTemporaryBlockResponse({
                    status: 429,
                    requestId,
                    startTime,
                    error: 'Too many failed sign-in attempts. This account is temporarily locked.',
                    code: 'account_locked',
                    retryUntil: protection.accountLockedUntil,
                    remainingAttempts: 0,
                    captchaRequired: true,
                });
            }

            return createLoginResponse({
                status: 401,
                requestId,
                startTime,
                remainingAttempts: Math.max(0, AUTH_MAX_FAILURES - protection.emailFailureCount),
                body: {
                    error: 'Invalid email or password.',
                    code: 'invalid_credentials',
                    captcha_required: protection.captchaRequired,
                },
            });
        }

        await safeLogLoginEvent({
            emailHash: protection.emailHash,
            ipHash: protection.ipHash,
            ipEmailHash: protection.ipEmailHash,
            outcome: 'success',
            reason: 'password_authenticated',
            requestId,
            userAgentHash,
            metadata: {
                provider: 'password',
            },
        });

        return createLoginResponse({
            status: 200,
            requestId,
            startTime,
            remainingAttempts: AUTH_MAX_FAILURES,
            body: {
                ok: true,
                code: 'authenticated',
                captcha_required: false,
            },
        });
    } catch (error) {
        console.error(`[${requestId}] POST /api/auth/login Error:`, error);

        return createLoginResponse({
            status: 500,
            requestId,
            startTime,
            body: {
                error: 'Unable to complete sign in right now.',
                code: 'auth_unavailable',
                captcha_required: false,
            },
        });
    }
}

async function createPasswordLoginClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
        throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }

    const cookieStore = await cookies();

    return createServerClient(url, anonKey, {
        cookies: {
            getAll() {
                return cookieStore.getAll();
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value, options }) => {
                    cookieStore.set(name, value, options);
                });
            },
        },
    });
}

async function safeLogLoginEvent(
    input: Parameters<typeof logPasswordLoginEvent>[0],
): Promise<void> {
    try {
        await logPasswordLoginEvent(input);
    } catch (error) {
        console.error(`[${input.requestId}] Failed to write auth login event:`, error);
    }
}

function createTemporaryBlockResponse(input: {
    status: number;
    requestId: string;
    startTime: number;
    error: string;
    code: string;
    retryUntil: string;
    remainingAttempts: number;
    captchaRequired: boolean;
}) {
    return createLoginResponse({
        status: input.status,
        requestId: input.requestId,
        startTime: input.startTime,
        remainingAttempts: input.remainingAttempts,
        retryUntil: input.retryUntil,
        body: {
            error: input.error,
            code: input.code,
            captcha_required: input.captchaRequired,
            retry_until: input.retryUntil,
            locked_until: input.retryUntil,
            blocked_until: input.retryUntil,
        },
    });
}

function createLoginResponse(input: {
    status: number;
    requestId: string;
    startTime: number;
    body: Record<string, unknown>;
    remainingAttempts?: number;
    retryUntil?: string;
}) {
    const response = NextResponse.json(
        {
            ...input.body,
            request_id: input.requestId,
        },
        { status: input.status },
    );

    withRequestHeaders(response.headers, input.requestId, input.startTime);
    response.headers.set('cache-control', 'no-store, max-age=0');
    response.headers.set('pragma', 'no-cache');
    response.headers.set('x-ratelimit-limit', String(AUTH_MAX_FAILURES));

    if (typeof input.remainingAttempts === 'number') {
        response.headers.set('x-ratelimit-remaining', String(Math.max(0, input.remainingAttempts)));
    }

    if (input.retryUntil) {
        const retryAfterSeconds = Math.max(
            1,
            Math.ceil((Date.parse(input.retryUntil) - Date.now()) / 1000),
        );
        response.headers.set('retry-after', String(retryAfterSeconds));
    }

    return response;
}
