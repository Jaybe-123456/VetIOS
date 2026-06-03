import type { MetadataRoute } from 'next';
import { getConfiguredSiteOrigin } from '@/lib/site';
import { PUBLIC_SEO_PAGES } from '@/lib/seo/publicPages';

export default function sitemap(): MetadataRoute.Sitemap {
    const siteOrigin = getConfiguredSiteOrigin();
    if (!siteOrigin) {
        return [];
    }

    return PUBLIC_SEO_PAGES.map((page) => ({
        url: new URL(page.path, siteOrigin).toString(),
        lastModified: new Date('2026-06-03T00:00:00.000Z'),
        changeFrequency: page.path === '/' ? 'weekly' : 'monthly',
        priority: page.priority,
    }));
}
