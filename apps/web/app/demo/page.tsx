import type { Metadata } from 'next';
import { DemoCase } from '@/components/clinical/DemoCase';
import { JsonLd } from '@/components/seo/JsonLd';
import { getConfiguredSiteOrigin } from '@/lib/site';

export const metadata: Metadata = {
    title: 'Demo Case | VetIOS',
    description: 'Try a public VetIOS veterinary AI demo case with ranked diagnoses, graph priors, CIRE runtime integrity signals, and outcome learning.',
    alternates: { canonical: '/demo' },
    keywords: ['VetIOS demo', 'veterinary AI demo', 'veterinary diagnosis demo', 'AI veterinary platform demo'],
    openGraph: {
        title: 'Try the VetIOS Demo Case',
        description: 'Run a public VetIOS demo case with ranked diagnoses, graph priors, runtime integrity signals, and outcome learning.',
        url: '/demo',
        type: 'website',
        images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'VetIOS demo case' }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Try the VetIOS Demo Case',
        description: 'Run a public veterinary AI demo case with ranked diagnoses, graph priors, and runtime integrity signals.',
        images: ['/opengraph-image'],
    },
};

export default function DemoPage() {
    const siteUrl = getConfiguredSiteOrigin() ?? 'https://www.vetios.tech';

    return (
        <>
            <JsonLd
                data={{
                    '@context': 'https://schema.org',
                    '@type': 'SoftwareApplication',
                    '@id': `${siteUrl}/demo#demo`,
                    name: 'VetIOS Demo Case',
                    applicationCategory: 'Veterinary AI Software',
                    operatingSystem: 'Web',
                    url: `${siteUrl}/demo`,
                    isPartOf: { '@id': `${siteUrl}/#software` },
                    description: 'Public VetIOS demo case for veterinary AI differential ranking, graph priors, runtime integrity signals, and outcome learning.',
                }}
            />
            <DemoCase />
        </>
    );
}
