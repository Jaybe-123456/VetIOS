import type { MetadataRoute } from 'next';
import { shouldIndexSite } from '@/lib/site';

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
            disallow: [
                '/login',
                '/signup',
                '/forgot-password',
                '/reset-password',
                '/auth/callback',
                '/api/',
            ],
        },
    };
}
