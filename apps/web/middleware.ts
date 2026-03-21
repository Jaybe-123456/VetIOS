/**
 * Next.js Middleware: lightweight page auth gate.
 *
 * Keep middleware local-only. API routes still perform authoritative
 * server-side auth checks, so page routing should not depend on a remote
 * Supabase round-trip that can time out on the edge runtime.
 */

import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/signup', '/auth/callback'];

function hasSupabaseAuthCookie(request: NextRequest): boolean {
    return request.cookies.getAll().some(({ name }) =>
        name === 'supabase-auth-token'
        || name.startsWith('supabase-auth-token.')
        || (name.startsWith('sb-') && name.includes('-auth-token')),
    );
}

export async function middleware(request: NextRequest) {
    const response = NextResponse.next({ request });

    if (process.env.VETIOS_DEV_BYPASS === 'true') {
        return response;
    }

    const pathname = request.nextUrl.pathname;
    const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
    const hasAuthCookie = hasSupabaseAuthCookie(request);

    if (!hasAuthCookie && !isPublicRoute) {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/login';
        return NextResponse.redirect(loginUrl);
    }

    if (hasAuthCookie && (pathname === '/login' || pathname === '/signup')) {
        const appUrl = request.nextUrl.clone();
        appUrl.pathname = '/inference';
        return NextResponse.redirect(appUrl);
    }

    return response;
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
