const PREVIEW_HOST_SUFFIXES = ['.vercel.app'];
const PUBLIC_AUTH_PATH_PREFIXES = ['/login', '/signup', '/forgot-password', '/reset-password', '/auth/callback'];
const PUBLIC_MARKETING_PATH_PREFIXES = ['/platform', '/'];
const PUBLIC_METADATA_PATHS = ['/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/icon.svg'];

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
    return normalizeConfiguredOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? null);
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
    return PUBLIC_MARKETING_PATH_PREFIXES.some((prefix) =>
        pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

export function isPublicMetadataPath(pathname: string): boolean {
    return PUBLIC_METADATA_PATHS.includes(pathname);
}

export function isPublicRoutePath(pathname: string): boolean {
    return isPublicAuthPath(pathname) || isPublicMarketingPath(pathname) || isPublicMetadataPath(pathname);
}

export function isShelllessPublicPath(pathname: string): boolean {
    return isPublicRoutePath(pathname);
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

export function shouldIndexSite(): boolean {
    return process.env.VERCEL_ENV === 'production' && Boolean(getConfiguredSiteOrigin());
}
