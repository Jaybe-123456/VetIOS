/**
 * Next.js Middleware: Auth Guard + Session Refresh
 *
 * - Refreshes Supabase auth tokens on every request
 * - Redirects unauthenticated users to /login
 * - Allows public routes: /login, /signup, /auth/callback
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/signup', '/auth/callback'];

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request });

    // ── DEV BYPASS: require explicit opt-in via env var ──
    if (process.env.VETIOS_DEV_BYPASS === 'true') {
        return supabaseResponse;
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    if (!url || !anonKey) {
        // If env vars are missing, let the request through (dev safety)
        return supabaseResponse;
    }

    const supabase = createServerClient(url, anonKey, {
        cookies: {
            getAll() {
                return request.cookies.getAll();
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value }) =>
                    request.cookies.set(name, value)
                );
                supabaseResponse = NextResponse.next({ request });
                cookiesToSet.forEach(({ name, value, options }) =>
                    supabaseResponse.cookies.set(name, value, options)
                );
            },
        },
    });

    // Refresh session (important: do NOT use getSession — use getUser for security)
    const { data: { user } } = await supabase.auth.getUser();

    const pathname = request.nextUrl.pathname;

    // Allow public routes without auth
    const isPublicRoute = PUBLIC_ROUTES.some(route =>
        pathname.startsWith(route)
    );

    if (!user && !isPublicRoute) {
        // Redirect to login
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/login';
        return NextResponse.redirect(loginUrl);
    }

    // If user is logged in and hitting /login or /signup, redirect to app
    if (user && (pathname === '/login' || pathname === '/signup')) {
        const appUrl = request.nextUrl.clone();
        appUrl.pathname = '/inference';
        return NextResponse.redirect(appUrl);
    }

    return supabaseResponse;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization)
         * - favicon.ico (browser icon)
         * - API routes (they handle their own auth)
         */
        '/((?!_next/static|_next/image|favicon.ico|api/).*)',
    ],
};
