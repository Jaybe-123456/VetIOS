import { PUBLIC_SEO_PATHS } from '@/lib/seo/publicPages';

const DEFAULT_SITE_ORIGIN = 'https://www.vetios.tech';
const PREVIEW_HOST_SUFFIXES = ['.vercel.app'];
const PUBLIC_AUTH_PATH_PREFIXES = ['/login', '/signup', '/forgot-password', '/reset-password', '/verify-email', '/auth/callback'];
const PUBLIC_MARKETING_PATHS = [...PUBLIC_SEO_PATHS];
const PUBLIC_PLATFORM_PATHS = [
    '/platform/model-cards',
    '/platform/population-intelligence',
];
const PUBLIC_METADATA_PATHS = [
    '/robots.txt',
    '/sitemap.xml',
    '/manifest.webmanifest',
    '/icon.svg',
    '/opengraph-image',
    '/google7e9947396223c1b9.html',
];
const PUBLIC_MARKETING_PATH_SET = new Set<string>(PUBLIC_MARKETING_PATHS);

function normalizeConfiguredOrigin(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }

    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
        return new URL(candidate).origin;
    } catch {
        return null;
    }
}

function normalizeHostname(hostname: string): string {
    return hostname.trim().toLowerCase().split(':')[0] ?? '';
}

export function getConfiguredPublicSiteOrigin(): string | null {
    return normalizeConfiguredOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? null);
}

export function getConfiguredSiteOrigin(): string | null {
    return normalizeConfiguredOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? DEFAULT_SITE_ORIGIN);
}

export function getConfiguredPublicSiteHost(): string | null {
    const origin = getConfiguredPublicSiteOrigin();
    if (!origin) {
        return null;
    }

    return new URL(origin).host;
}

export function isPreviewHostname(hostname: string): boolean {
    const normalized = normalizeHostname(hostname);
    return PREVIEW_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function isPublicAuthPath(pathname: string): boolean {
    return PUBLIC_AUTH_PATH_PREFIXES.some((prefix) =>
        pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

export function isPublicMarketingPath(pathname: string): boolean {
    return PUBLIC_MARKETING_PATH_SET.has(pathname);
}

export function isPublicPlatformPath(pathname: string): boolean {
    return PUBLIC_PLATFORM_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isPublicMetadataPath(pathname: string): boolean {
    return PUBLIC_METADATA_PATHS.includes(pathname);
}

export function isPublicRoutePath(pathname: string): boolean {
    return isPublicAuthPath(pathname)
        || isPublicMarketingPath(pathname)
        || isPublicPlatformPath(pathname)
        || isPublicMetadataPath(pathname);
}

export function isShelllessPublicPath(pathname: string): boolean {
    return isPublicAuthPath(pathname)
        || PUBLIC_SEO_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
        || isPublicPlatformPath(pathname);
}

export function shouldRedirectPreviewAuthHost(hostname: string, pathname: string): boolean {
    const siteOrigin = getConfiguredSiteOrigin();
    if (!siteOrigin || !isPublicAuthPath(pathname)) {
        return false;
    }

    const currentHost = normalizeHostname(hostname);
    const configuredHost = normalizeHostname(new URL(siteOrigin).host);
    return currentHost !== configuredHost && isPreviewHostname(currentHost);
}

export function buildConfiguredAbsoluteUrl(pathname: string, search = '', fallbackOrigin?: string): string | null {
    const origin = getConfiguredSiteOrigin() ?? fallbackOrigin ?? null;
    if (!origin) {
        return null;
    }

    const url = new URL(pathname, origin);
    url.search = search.startsWith('?') ? search.slice(1) : search;
    return url.toString();
}

export function sanitizeInternalPath(pathname: string | null | undefined, fallback = '/'): string {
    if (!pathname || !pathname.startsWith('/') || pathname.startsWith('//')) {
        return fallback;
    }

    return pathname;
}

export function resolveClientAuthOrigin(fallbackOrigin: string): string {
    return getConfiguredPublicSiteOrigin() ?? fallbackOrigin;
}

export function buildClientAuthCallbackUrl(fallbackOrigin: string, nextPath?: string | null): string {
    const url = new URL('/auth/callback', resolveClientAuthOrigin(fallbackOrigin));
    if (nextPath) {
        url.searchParams.set('next', sanitizeInternalPath(nextPath));
    }
    return url.toString();
}

export function buildConfiguredEmailVerificationCallbackUrl(
    nextPath?: string | null,
    fallbackOrigin?: string,
): string | null {
    const params = new URLSearchParams();
    params.set('mode', 'email-verification');
    params.set('next', sanitizeInternalPath(nextPath, '/cases'));
    return buildConfiguredAbsoluteUrl('/auth/callback', `?${params.toString()}`, fallbackOrigin);
}

export function buildClientEmailVerificationCallbackUrl(
    fallbackOrigin: string,
    nextPath?: string | null,
): string {
    const url = new URL('/auth/callback', resolveClientAuthOrigin(fallbackOrigin));
    url.searchParams.set('mode', 'email-verification');
    url.searchParams.set('next', sanitizeInternalPath(nextPath, '/cases'));
    return url.toString();
}

export function shouldIndexSite(): boolean {
    return process.env.VERCEL_ENV === 'production' && Boolean(getConfiguredSiteOrigin());
}

export function shouldExposePublicPlatformDetails(): boolean {
    return process.env.VETIOS_PUBLIC_PLATFORM_DETAILS === 'true';
}
