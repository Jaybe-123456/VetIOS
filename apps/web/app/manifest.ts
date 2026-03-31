import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'VetIOS',
        short_name: 'VetIOS',
        description: 'VetIOS clinical intelligence console for veterinary teams.',
        start_url: '/dashboard',
        display: 'standalone',
        background_color: '#050816',
        theme_color: '#18ff6d',
        icons: [
            {
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
            },
        ],
    };
}
