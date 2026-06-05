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

type PageRole = 'admin' | 'developer' | 'researcher' | 'clinician';

const CLINICIAN_CONSOLE_PATHS = [
    '/admin',
    '/console',
    '/dashboard',
    '/dataset',
    '/developer',
    '/experiments',
    '/guide',
    '/inference',
    '/intelligence',
    '/models',
    '/outbox',
    '/outcome',
    '/rag',
    '/settings',
    '/simulate',
    '/telemetry',
];

function hasSupabaseAuthCookie(request: NextRequest): boolean {
    return request.cookies.getAll().some(({ name }) =>
        name === 'supabase-auth-token'
        || name.startsWith('supabase-auth-token.')
        || (name.startsWith('sb-') && name.includes('-auth-token')),
    );
}

function isClinicianRestrictedPath(pathname: string): boolean {
    return CLINICIAN_CONSOLE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function resolveRoleFromRequest(request: NextRequest): PageRole {
    const claims = readSupabaseJwtClaims(request);
    const adminEmail = process.env.VETIOS_ADMIN_EMAIL;
    if (adminEmail && claims?.email === adminEmail) {
        return 'admin';
    }

    const userMetadata = asRecord(claims?.user_metadata);
    const appMetadata = asRecord(claims?.app_metadata);
    const planRole = readRoleFromPlan(userMetadata.vetios_plan_key) ?? readRoleFromPlan(appMetadata.vetios_plan_key);
    if (planRole) {
        return planRole;
    }

    const candidate = readRole(userMetadata.role) ?? readRole(appMetadata.role) ?? readRole(claims?.role);
    return candidate ?? 'clinician';
}

function readSupabaseJwtClaims(request: NextRequest): Record<string, unknown> | null {
    const token = extractAccessTokenFromCookies(request);
    if (!token) return null;
    const [, payload] = token.split('.');
    if (!payload) return null;
    try {
        return JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function extractAccessTokenFromCookies(request: NextRequest): string | null {
    const authCookies = request.cookies
        .getAll()
        .filter(({ name }) => name === 'supabase-auth-token' || name.startsWith('supabase-auth-token') || (name.startsWith('sb-') && name.includes('-auth-token')))
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const cookie of authCookies) {
        const token = parseAuthCookieValue(cookie.value);
        if (token) return token;
    }

    const chunked = authCookies.map((cookie) => cookie.value).join('');
    return parseAuthCookieValue(chunked);
}

function parseAuthCookieValue(value: string): string | null {
    const decoded = safeDecodeURIComponent(value);
    if (looksLikeJwt(decoded)) return decoded;

    const rawJson = decoded.startsWith('base64-') ? safeAtob(decoded.slice('base64-'.length)) : decoded;
    if (!rawJson) return null;
    if (looksLikeJwt(rawJson)) return rawJson;

    try {
        const parsed = JSON.parse(rawJson) as unknown;
        if (Array.isArray(parsed) && typeof parsed[0] === 'string' && looksLikeJwt(parsed[0])) return parsed[0];
        if (typeof parsed === 'object' && parsed !== null) {
            const token = (parsed as { access_token?: unknown }).access_token;
            return typeof token === 'string' && looksLikeJwt(token) ? token : null;
        }
    } catch {
        return null;
    }
    return null;
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
        loginUrl.search = '';
        loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
        return NextResponse.redirect(loginUrl);
    }

    if (hasAuthCookie && isClinicianRestrictedPath(pathname) && resolveRoleFromRequest(request) === 'clinician') {
        const casesUrl = request.nextUrl.clone();
        casesUrl.pathname = '/cases';
        casesUrl.search = '?console_access=admin_required';
        return NextResponse.redirect(casesUrl);
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

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function safeAtob(value: string): string | null {
    try {
        return atob(value);
    } catch {
        return null;
    }
}

function base64UrlDecode(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return atob(padded);
}

function looksLikeJwt(value: string): boolean {
    return value.split('.').length === 3;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readRole(value: unknown): PageRole | null {
    return value === 'admin' || value === 'developer' || value === 'researcher' || value === 'clinician' ? value : null;
}

function readRoleFromPlan(value: unknown): PageRole | null {
    if (value === 'developer') return 'developer';
    if (value === 'research' || value === 'federation' || value === 'enterprise') return 'researcher';
    return null;
}
