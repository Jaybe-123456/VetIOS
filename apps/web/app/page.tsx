import type { Metadata } from 'next';
import LandingPage from '@/components/landing/LandingPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { getPublicEvidenceSnapshot } from '@/lib/platform/publicEvidenceSnapshot';
import { getConfiguredSiteOrigin } from '@/lib/site';

export const metadata: Metadata = {
    title: 'VetIOS | AI-Native Veterinary Intelligence Infrastructure',
    description: 'A closed-loop veterinary AI platform for inference, outcome learning, simulation, observability, graph intelligence, and quantum-ready AMR research.',
    alternates: { canonical: '/' },
    keywords: [
        'VetIOS',
        'veterinary AI',
        'veterinary diagnostic AI',
        'AI veterinary platform',
        'quantum veterinary AI',
        'AMR veterinary surveillance',
    ],
    openGraph: {
        title: 'VetIOS | AI-Native Veterinary Intelligence Infrastructure',
        description: 'Closed-loop veterinary AI infrastructure for inference, outcome learning, simulation, graph intelligence, and quantum-ready AMR research.',
        url: '/',
        siteName: 'VetIOS',
        type: 'website',
        images: [
            {
                url: '/opengraph-image',
                width: 1200,
                height: 630,
                alt: 'VetIOS veterinary AI infrastructure',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'VetIOS | AI-Native Veterinary Intelligence Infrastructure',
        description: 'Closed-loop veterinary AI infrastructure for inference, outcome learning, simulation, graph intelligence, and quantum-ready AMR research.',
        images: ['/opengraph-image'],
    },
};

export default async function Page() {
    const evidenceSnapshot = await getPublicEvidenceSnapshot();
    const siteOrigin = getConfiguredSiteOrigin();
    const siteUrl = siteOrigin ?? 'https://www.vetios.tech';

    return (
        <>
            <JsonLd
                data={[
                    {
                        '@context': 'https://schema.org',
                        '@type': 'Organization',
                        '@id': `${siteUrl}/#organization`,
                        name: 'VetIOS',
                        alternateName: 'AI-Native Veterinary Intelligence Infrastructure',
                        url: siteUrl,
                        logo: `${siteUrl}/icon.svg`,
                        image: `${siteUrl}/opengraph-image`,
                        sameAs: ['https://github.com/Jaybe-123456/VetIOS'],
                        description: 'VetIOS is AI-native veterinary intelligence infrastructure for clinical inference, outcome learning, simulation, graph intelligence, and quantum-ready AMR research.',
                    },
                    {
                        '@context': 'https://schema.org',
                        '@type': 'WebSite',
                        '@id': `${siteUrl}/#website`,
                        name: 'VetIOS',
                        url: siteUrl,
                        publisher: { '@id': `${siteUrl}/#organization` },
                        about: { '@id': `${siteUrl}/about#about` },
                    },
                    {
                        '@context': 'https://schema.org',
                        '@type': 'SoftwareApplication',
                        '@id': `${siteUrl}/#software`,
                        name: 'VetIOS',
                        applicationCategory: 'Veterinary AI Software',
                        operatingSystem: 'Web',
                        url: siteUrl,
                        brand: { '@id': `${siteUrl}/#organization` },
                        publisher: { '@id': `${siteUrl}/#organization` },
                        description: 'Closed-loop veterinary AI infrastructure for inference, outcome learning, simulation, graph intelligence, and AMR research.',
                    },
                ]}
            />
            <LandingPage evidenceSnapshot={evidenceSnapshot} />
        </>
    );
}
