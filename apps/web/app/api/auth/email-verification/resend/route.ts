import { createApiSupabaseClient } from '@/lib/auth';
import { getEmailVerificationState } from '@/lib/auth/emailVerification';
import { resendUserEmailVerification } from '@/lib/auth/emailVerificationServer';
import { validatePasswordLoginHeaders } from '@/lib/auth/passwordLoginSecurity';
import { getRequestId, withRequestHeaders } from '@/lib/http/requestId';
import { NextResponse } from 'next/server';
import { sanitizeInternalPath } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const requestId = getRequestId(req);
    const startTime = Date.now();

    const headerValidation = validatePasswordLoginHeaders(req);
    if (!headerValidation.ok) {
        return createResponse({
            status: headerValidation.status,
            requestId,
            startTime,
            body: {
                error: headerValidation.error,
                code: 'invalid_request_headers',
            },
        });
    }

    let nextPath = '/inference';
    try {
        const rawBody = await req.text();
        if (rawBody.trim()) {
            const parsedBody = JSON.parse(rawBody) as { nextPath?: string };
            nextPath = sanitizeInternalPath(parsedBody.nextPath, '/inference');
        }
    } catch {
        return createResponse({
            status: 400,
            requestId,
            startTime,
            body: {
                error: 'Invalid resend request.',
                code: 'invalid_resend_request',
            },
        });
    }

    try {
        const supabase = await createApiSupabaseClient();
        const { data: { user }, error } = await supabase.auth.getUser();

        if (error || !user) {
            return createResponse({
                status: 401,
                requestId,
                startTime,
                body: {
                    error: 'Sign in to resend your verification email.',
                    code: 'unauthorized',
                },
            });
        }

        const verificationState = getEmailVerificationState(user);
        if (!verificationState.requiresVerification) {
            return createResponse({
                status: 200,
                requestId,
                startTime,
                body: {
                    ok: true,
                    code: 'already_verified',
                    verified: true,
                },
            });
        }

        const resendResult = await resendUserEmailVerification({
            user,
            nextPath,
            fallbackOrigin: new URL(req.url).origin,
        });

        if (resendResult.retryAfterMs > 0) {
            return createResponse({
                status: 429,
                requestId,
                startTime,
                retryAfterSeconds: Math.max(1, Math.ceil(resendResult.retryAfterMs / 1000)),
                body: {
                    error: 'A verification email was sent very recently. Please wait a moment before trying again.',
                    code: 'verification_email_throttled',
                    sent_at: resendResult.sentAt,
                },
            });
        }

        return createResponse({
            status: 200,
            requestId,
            startTime,
            body: {
                ok: true,
                code: 'verification_email_sent',
                sent_at: resendResult.sentAt,
            },
        });
    } catch (error) {
        console.error(`[${requestId}] POST /api/auth/email-verification/resend Error:`, error);
        return createResponse({
            status: 500,
            requestId,
            startTime,
            body: {
                error: 'Unable to resend the verification email right now.',
                code: 'verification_email_unavailable',
            },
        });
    }
}

function createResponse(input: {
    status: number;
    requestId: string;
    startTime: number;
    body: Record<string, unknown>;
    retryAfterSeconds?: number;
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

    if (typeof input.retryAfterSeconds === 'number') {
        response.headers.set('retry-after', String(input.retryAfterSeconds));
    }

    return response;
}
