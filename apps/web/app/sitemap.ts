import type { MetadataRoute } from 'next';
import { getConfiguredSiteOrigin } from '@/lib/site';

const PUBLIC_PLATFORM_PATHS = [
    '/platform',
    '/platform/developers',
    '/platform/edge-box',
    '/platform/model-cards',
    '/platform/network-learning',
    '/platform/passive-signals',
    '/platform/petpass',
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
    const siteOrigin = getConfiguredSiteOrigin();
    if (!siteOrigin) {
        return [];
    }

    return PUBLIC_PLATFORM_PATHS.map((pathname) => ({
        url: new URL(pathname, siteOrigin).toString(),
        lastModified: new Date(),
    }));
}
