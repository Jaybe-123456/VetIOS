/**
 * GET /auth/callback
 *
 * Handles the redirect from Supabase Auth after:
 * - Magic link click
 * - Google OAuth login
 *
 * Exchanges the auth code for a session, then redirects to the app.
 */

import { createServerClient } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCompletedEmailVerificationMetadata, buildVerifyEmailPath, getEmailVerificationState, isLikelyFirstGoogleSignIn } from '@/lib/auth/emailVerification';
import { completeUserEmailVerification } from '@/lib/auth/emailVerificationServer';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { buildConfiguredAbsoluteUrl, sanitizeInternalPath, shouldRedirectPreviewAuthHost } from '@/lib/site';

export async function GET(request: NextRequest) {
    const requestUrl = new URL(request.url);
    const { searchParams, origin } = requestUrl;
    const code = searchParams.get('code');
    const mode = searchParams.get('mode');
    const next = sanitizeInternalPath(searchParams.get('next'), '/inference');
    const tokenHash = searchParams.get('token_hash');
    const emailOtpType = normalizeEmailOtpType(searchParams.get('type'));

    if (shouldRedirectPreviewAuthHost(requestUrl.host, requestUrl.pathname)) {
        const redirectTarget = buildConfiguredAbsoluteUrl(requestUrl.pathname, requestUrl.search);
        if (redirectTarget) {
            return NextResponse.redirect(redirectTarget, 307);
        }
    }

    if (code || (tokenHash && emailOtpType)) {
        const cookieStore = await cookies();

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll();
                    },
                    setAll(cookiesToSet) {
                        try {
                            cookiesToSet.forEach(({ name, value, options }) =>
                                cookieStore.set(name, value, options)
                            );
                        } catch {
                            // Ignored in read-only contexts
                        }
                    },
                },
            }
        );

        const { error } = code
            ? await supabase.auth.exchangeCodeForSession(code)
            : await supabase.auth.verifyOtp({
                token_hash: tokenHash!,
                type: emailOtpType!,
            });

        if (!error) {
            const { data: { user } } = await supabase.auth.getUser();

            if (user) {
                try {
                    if (mode === 'email-verification') {
                        await completeUserEmailVerification({
                            userId: user.id,
                            currentMetadata: user.user_metadata,
                        });
                        return NextResponse.redirect(buildAbsoluteRedirectTarget(next, origin));
                    }

                    if (isLikelyFirstGoogleSignIn(user)) {
                        // Google has already verified this email address — no need to
                        // send a verification email. Mark the account as verified in
                        // the background (fire-and-forget) so we can redirect immediately
                        // without blocking the user on an admin API round-trip.
                        const verifiedMetadata = buildCompletedEmailVerificationMetadata(
                            user.user_metadata,
                        );
                        getSupabaseServer()
                            .auth.admin.updateUserById(user.id, { user_metadata: verifiedMetadata })
                            .catch((err: unknown) => {
                                console.error('Failed to auto-verify Google OAuth user metadata:', err);
                            });

                        return NextResponse.redirect(buildAbsoluteRedirectTarget(next, origin));
                    }

                    const verificationState = getEmailVerificationState(user);
                    if (verificationState.requiresVerification) {
                        const verifyPath = buildVerifyEmailPath(next);
                        return NextResponse.redirect(buildAbsoluteRedirectTarget(verifyPath, origin));
                    }
                } catch (verificationError) {
                    console.error('Auth callback email verification handling failed:', verificationError);
                    const verifyUrl = new URL(buildAbsoluteRedirectTarget(buildVerifyEmailPath(next), origin));
                    verifyUrl.searchParams.set('error', 'verification_setup_failed');
                    return NextResponse.redirect(verifyUrl.toString());
                }
            }

            return NextResponse.redirect(buildAbsoluteRedirectTarget(next, origin));
        }
    }

    // Auth failed: redirect to login with error
    return NextResponse.redirect(
        buildConfiguredAbsoluteUrl('/login', '?error=auth_failed', origin) ?? `${origin}/login?error=auth_failed`,
    );
}

function buildAbsoluteRedirectTarget(pathWithSearch: string, fallbackOrigin: string): string {
    const configuredBase = buildConfiguredAbsoluteUrl('/', '', fallbackOrigin) ?? `${fallbackOrigin}/`;
    return new URL(pathWithSearch, configuredBase).toString();
}

function normalizeEmailOtpType(value: string | null): EmailOtpType | null {
    if (value === 'email' || value === 'recovery' || value === 'invite' || value === 'email_change') {
        return value;
    }

    if (value === 'signup' || value === 'magiclink') {
        return 'email';
    }

    return null;
}
