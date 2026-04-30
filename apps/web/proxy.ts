import { NextResponse, type NextRequest } from 'next/server';
import { buildConfiguredAbsoluteUrl, isPublicRoutePath, shouldRedirectPreviewAuthHost } from '@/lib/site';

// ── Strict CORS Allowlist ──────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const CORS_HEADERS = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID, x-ratelimit-limit, retry-after',
    'Access-Control-Allow-Credentials': 'true',
};

function hasSupabaseAuthCookie(request: NextRequest): boolean {
    return request.cookies.getAll().some(({ name }) =>
        name === 'supabase-auth-token'
        || name.startsWith('supabase-auth-token.')
        || (name.startsWith('sb-') && name.includes('-auth-token')),
    );
}

export async function proxy(request: NextRequest) {
    const origin = request.headers.get('origin');
    const pathname = request.nextUrl.pathname;
    const isApiRoute = pathname.startsWith('/api/');

    let corsResponseHeaders = new Headers();
    let isAllowedOrigin = false;

    // 1. Validate Origin securely
    if (isApiRoute && origin && ALLOWED_ORIGINS.includes(origin)) {
        isAllowedOrigin = true;
        corsResponseHeaders.set('Access-Control-Allow-Origin', origin);
        Object.entries(CORS_HEADERS).forEach(([key, value]) => {
            corsResponseHeaders.set(key, value);
        });
    }

    // 2. Preflight Response Fast-path
    if (isApiRoute && request.method === 'OPTIONS') {
        if (isAllowedOrigin) {
            return new NextResponse(null, { status: 204, headers: corsResponseHeaders });
        }
        // Block unapproved origins preflights
        return new NextResponse(null, { status: 403 });
    }

    // 3. Let normal requests pass through
    const response = NextResponse.next({ request });

    // 4. Inject CORS explicitly on the outgoing valid response
    if (isApiRoute && isAllowedOrigin) {
        corsResponseHeaders.forEach((value, key) => response.headers.set(key, value));
    }

    // 5. Bypass the page routing / login logic if this is an API route (since apiGuard handles auth stateless)
    if (isApiRoute) {
        return response;
    }

    // --- Page Routing Auth ---
    if (process.env.VETIOS_DEV_BYPASS === 'true') {
        return response;
    }

    const isPublicRoute = isPublicRoutePath(pathname);
    const hasAuthCookie = hasSupabaseAuthCookie(request);

    if (shouldRedirectPreviewAuthHost(request.nextUrl.host, pathname)) {
        const redirectTarget = buildConfiguredAbsoluteUrl(pathname, request.nextUrl.search);
        if (redirectTarget) {
            return NextResponse.redirect(redirectTarget, 307);
        }
    }

    if (!hasAuthCookie && !isPublicRoute) {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/login';
        return NextResponse.redirect(loginUrl);
    }

    // Removed hasAuthCookie redirection to prevent infinite loop on invalid sessions.
    // The actual /login route will rely on its client/server auth guards to verify session validity.

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization)
         * - favicon.ico (browser icon)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
