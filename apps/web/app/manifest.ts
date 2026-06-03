import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'VetIOS',
        short_name: 'VetIOS',
        description: 'Veterinary AI infrastructure for clinical inference, outcome learning, simulation, and quantum-ready AMR research.',
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
