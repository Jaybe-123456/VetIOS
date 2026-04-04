import { NextResponse } from 'next/server';

export const VETIOS_API_VERSION = '1.0.0';
export const VETIOS_API_SUPPORTED_VERSIONS = '1.0.0';
export const VETIOS_API_DEPRECATION_POLICY = 'https://www.vetios.tech/developer/versioning';

export interface VersionHeaderOptions {
    quotaHeaders?: Record<string, string>;
    deprecated?: boolean;
    sunset?: string | null;
    successorUrl?: string | null;
}

export function applyVersionHeaders(headers: Headers, options: VersionHeaderOptions = {}) {
    headers.set('API-Version', VETIOS_API_VERSION);
    headers.set('API-Supported-Versions', VETIOS_API_SUPPORTED_VERSIONS);
    headers.set('API-Deprecation-Policy', VETIOS_API_DEPRECATION_POLICY);

    if (options.quotaHeaders) {
        for (const [key, value] of Object.entries(options.quotaHeaders)) {
            headers.set(key, value);
        }
    }

    if (options.deprecated) {
        headers.set('Deprecation', 'true');
        if (options.sunset) {
            headers.set('Sunset', options.sunset);
        }
        if (options.successorUrl) {
            headers.set('Link', `<${options.successorUrl}>; rel="successor-version"`);
        }
    }
}

export function jsonWithVersionHeaders(
    body: unknown,
    init: ResponseInit = {},
    options: VersionHeaderOptions = {},
) {
    const response = NextResponse.json(body, init);
    applyVersionHeaders(response.headers, options);
    return response;
}
