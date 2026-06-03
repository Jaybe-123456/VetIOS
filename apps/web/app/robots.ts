import type { MetadataRoute } from 'next';
import { getConfiguredSiteOrigin, shouldIndexSite } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
    if (!shouldIndexSite()) {
        return {
            rules: {
                userAgent: '*',
                disallow: '/',
            },
        };
    }

    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/api/'],
        },
        sitemap: getConfiguredSiteOrigin()
            ? new URL('/sitemap.xml', getConfiguredSiteOrigin()!).toString()
            : undefined,
    };
}
