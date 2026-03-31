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
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { buildConfiguredAbsoluteUrl, sanitizeInternalPath, shouldRedirectPreviewAuthHost } from '@/lib/site';

export async function GET(request: NextRequest) {
    const requestUrl = new URL(request.url);
    const { searchParams, origin } = requestUrl;
    const code = searchParams.get('code');
    const next = sanitizeInternalPath(searchParams.get('next'), '/inference');

    if (shouldRedirectPreviewAuthHost(requestUrl.host, requestUrl.pathname)) {
        const redirectTarget = buildConfiguredAbsoluteUrl(requestUrl.pathname, requestUrl.search);
        if (redirectTarget) {
            return NextResponse.redirect(redirectTarget, 307);
        }
    }

    if (code) {
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

        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (!error) {
            return NextResponse.redirect(
                buildConfiguredAbsoluteUrl(next, '', origin) ?? `${origin}${next}`,
            );
        }
    }

    // Auth failed: redirect to login with error
    return NextResponse.redirect(
        buildConfiguredAbsoluteUrl('/login', '?error=auth_failed', origin) ?? `${origin}/login?error=auth_failed`,
    );
}
