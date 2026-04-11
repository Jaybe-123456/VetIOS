import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildVerifyEmailPath } from '@/lib/auth/emailVerification';
import { beginUserEmailVerification } from '@/lib/auth/emailVerificationServer';
import { isGoogleMailAddress } from '@/lib/auth/emailProviderHints';
import { validatePasswordPolicy } from '@/lib/auth/passwordPolicy';
import {
    isCaptchaProtectionEnabled,
    validatePasswordLoginHeaders,
    verifyPasswordLoginCaptcha,
} from '@/lib/auth/passwordLoginSecurity';
import { getRequestId, withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

const SIGNUP_BODY_MAX_BYTES = 8 * 1024;

const SignupRequestSchema = z.object({
    email: z.string()
        .trim()
        .min(3)
        .max(320)
        .refine((value) => !containsNullByte(value), 'Invalid email address.')
        .refine((value) => isPlausibleEmail(value), 'Invalid email address.')
        .transform((value) => value.toLowerCase()),
    password: z.string()
        .min(1)
        .max(1_024)
        .refine((value) => !containsNullByte(value), 'Invalid password.'),
    captchaToken: z.string()
        .trim()
        .min(1)
        .max(2_048)
        .nullable()
        .optional(),
    allowSeparatePassword: z.boolean().optional().default(false),
}).strict();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const requestId = getRequestId(req);
    const startTime = Date.now();

    const headerValidation = validatePasswordLoginHeaders(req);
    if (!headerValidation.ok) {
        return createSignupResponse({
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

    const bodyValidation = await parseSignupRequest(req);
    if (!bodyValidation.ok) {
        return createSignupResponse({
            status: bodyValidation.status,
            requestId,
            startTime,
            body: {
                error: bodyValidation.error,
                code: 'invalid_signup_request',
                captcha_required: false,
            },
        });
    }

    const { email, password, captchaToken, allowSeparatePassword } = bodyValidation.data;
    const isGoogleEmail = isGoogleMailAddress(email);

    if (isGoogleEmail && !allowSeparatePassword) {
        return createSignupResponse({
            status: 409,
            requestId,
            startTime,
            body: {
                error: 'Gmail accounts should use Continue with Google unless you explicitly want a separate VetIOS password.',
                code: 'google_auth_recommended',
                oauth_provider: 'google',
                captcha_required: false,
            },
        });
    }

    const passwordValidation = validatePasswordPolicy(email, password);
    if (!passwordValidation.valid) {
        return createSignupResponse({
            status: 400,
            requestId,
            startTime,
            body: {
                error: passwordValidation.issues.join(' '),
                code: 'invalid_password',
                captcha_required: false,
            },
        });
    }

    if (isCaptchaProtectionEnabled()) {
        if (!captchaToken) {
            return createSignupResponse({
                status: 400,
                requestId,
                startTime,
                body: {
                    error: 'Complete the CAPTCHA challenge to continue.',
                    code: 'captcha_required',
                    captcha_required: true,
                },
            });
        }

        const captchaVerification = await verifyPasswordLoginCaptcha(captchaToken);
        if (!captchaVerification.ok) {
            return createSignupResponse({
                status: 400,
                requestId,
                startTime,
                body: {
                    error: mapCaptchaSignupError(captchaVerification.errorCodes),
                    code: 'captcha_failed',
                    captcha_required: true,
                    error_codes: captchaVerification.errorCodes,
                },
            });
        }
    }

    try {
        const adminClient = getSupabaseServer();
        const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                signup_method: 'password',
                signup_source: 'vetios_web_signup',
                preferred_oauth_provider: isGoogleEmail ? 'google' : null,
            },
        });

        if (createUserError) {
            const normalizedSignupError = normalizeSignupError(createUserError.message, isGoogleEmail);
            return createSignupResponse({
                status: normalizedSignupError.status,
                requestId,
                startTime,
                body: {
                    error: normalizedSignupError.message,
                    code: normalizedSignupError.code,
                    captcha_required: false,
                },
            });
        }

        const createdUserId = createdUser.user?.id ?? null;
        if (!createdUserId) {
            throw new Error('Supabase did not return a user ID for the new account.');
        }

        let verificationSetupFailed = false;
        try {
            await beginUserEmailVerification({
                userId: createdUserId,
                email,
                currentMetadata: createdUser.user?.user_metadata ?? {},
                nextPath: '/inference',
                fallbackOrigin: new URL(req.url).origin,
                source: 'password_signup',
            });
        } catch (verificationError) {
            verificationSetupFailed = true;
            console.error(`[${requestId}] Failed to send initial verification email:`, verificationError);
        }

        const signupClient = await createPasswordSignupClient();
        const { error: signInError } = await signupClient.auth.signInWithPassword({
            email,
            password,
        });

        if (signInError) {
            console.warn(`[${requestId}] Account created but automatic sign-in failed:`, signInError.message);
            return createSignupResponse({
                status: 201,
                requestId,
                startTime,
                body: {
                    ok: true,
                    code: 'account_created',
                    captcha_required: false,
                    next: verificationSetupFailed
                        ? '/login?signup=success&verification=required&error=verification_setup_failed'
                        : '/login?signup=success&verification=required',
                    user_id: createdUserId,
                },
            });
        }

        const verifyPath = verificationSetupFailed
            ? `${buildVerifyEmailPath('/inference')}&error=verification_setup_failed`
            : buildVerifyEmailPath('/inference');

        return createSignupResponse({
            status: 200,
            requestId,
            startTime,
            body: {
                ok: true,
                code: 'verification_email_sent',
                captcha_required: false,
                next: verifyPath,
                user_id: createdUserId,
            },
        });
    } catch (error) {
        console.error(`[${requestId}] POST /api/auth/signup Error:`, error);
        return createSignupResponse({
            status: 500,
            requestId,
            startTime,
            body: {
                error: 'Unable to create your account right now.',
                code: 'signup_unavailable',
                captcha_required: false,
            },
        });
    }
}

async function parseSignupRequest(req: Request): Promise<{
    ok: true;
    data: z.infer<typeof SignupRequestSchema>;
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
        if (Number.isFinite(parsedContentLength) && parsedContentLength > SIGNUP_BODY_MAX_BYTES) {
            return {
                ok: false,
                status: 413,
                error: 'Signup request body is too large.',
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
            error: 'Unable to read signup request body.',
        };
    }

    if (!rawBody.trim()) {
        return {
            ok: false,
            status: 400,
            error: 'Missing signup payload.',
        };
    }

    if (rawBody.length > SIGNUP_BODY_MAX_BYTES) {
        return {
            ok: false,
            status: 413,
            error: 'Signup request body is too large.',
        };
    }

    if (rawBody.includes('\0')) {
        return {
            ok: false,
            status: 400,
            error: 'Null bytes are not allowed in signup requests.',
        };
    }

    let parsedBody: unknown;

    try {
        parsedBody = JSON.parse(rawBody);
    } catch {
        return {
            ok: false,
            status: 400,
            error: 'Invalid signup payload.',
        };
    }

    const result = SignupRequestSchema.safeParse(parsedBody);
    if (!result.success) {
        return {
            ok: false,
            status: 400,
            error: 'Invalid email or password.',
        };
    }

    return {
        ok: true,
        data: result.data,
    };
}

async function createPasswordSignupClient() {
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

function mapCaptchaSignupError(errorCodes: string[]): string {
    if (errorCodes.includes('timeout-or-duplicate')) {
        return 'CAPTCHA expired. Complete the challenge again and resubmit.';
    }
    if (errorCodes.includes('invalid-input-response')) {
        return 'CAPTCHA verification failed. Please retry the challenge.';
    }
    if (
        errorCodes.includes('invalid-input-secret')
        || errorCodes.includes('missing-input-secret')
    ) {
        return 'Security challenge is misconfigured. Please contact support.';
    }
    if (errorCodes.includes('request_failed')) {
        return 'Security challenge could not be verified right now. Please retry.';
    }
    return 'CAPTCHA verification failed. Try the challenge again.';
}

function normalizeSignupError(
    message: string,
    isGoogleEmail: boolean,
): {
    status: number;
    code: string;
    message: string;
} {
    const normalizedMessage = message.toLowerCase();

    if (
        normalizedMessage.includes('already')
        && normalizedMessage.includes('registered')
    ) {
        return {
            status: 409,
            code: isGoogleEmail ? 'account_exists_google' : 'account_exists',
            message: isGoogleEmail
                ? 'This Gmail address already has a VetIOS account. Continue with Google or sign in instead.'
                : 'This email already has a VetIOS account. Sign in instead.',
        };
    }

    if (normalizedMessage.includes('password')) {
        return {
            status: 400,
            code: 'invalid_password',
            message,
        };
    }

    if (normalizedMessage.includes('email')) {
        return {
            status: 400,
            code: 'invalid_email',
            message,
        };
    }

    return {
        status: 400,
        code: 'signup_failed',
        message,
    };
}

function createSignupResponse(input: {
    status: number;
    requestId: string;
    startTime: number;
    body: Record<string, unknown>;
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
    return response;
}

function containsNullByte(value: string): boolean {
    return value.includes('\0');
}

function isPlausibleEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
