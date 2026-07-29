import type { Metadata } from 'next';
import { DemoCase } from '@/components/clinical/DemoCase';
import { JsonLd } from '@/components/seo/JsonLd';
import { getConfiguredSiteOrigin } from '@/lib/site';

export const metadata: Metadata = {
    title: 'Clinical Intelligence Control Plane Demo',
    description: 'Explore a browser-only VetIOS control-plane fixture connecting clinical inference, CIRE telemetry, outcome evidence, privacy boundaries, and AMR context.',
    alternates: { canonical: '/demo' },
    keywords: [
        'VetIOS demo',
        'veterinary clinical intelligence',
        'veterinary outcome learning',
        'veterinary secure aggregation',
        'veterinary AMR surveillance',
    ],
    openGraph: {
        title: 'VetIOS Clinical Intelligence Control Plane Demo',
        description: 'Trace one synthetic veterinary case across CIRE, outcome evidence, node sovereignty, and AMR context.',
        url: '/demo',
        type: 'website',
        images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'VetIOS clinical intelligence control plane' }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'VetIOS Clinical Intelligence Control Plane Demo',
        description: 'A truth-labeled public fixture for clinical inference, outcomes, sovereignty, and AMR.',
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
                    description: 'Browser-only VetIOS control-plane fixture connecting clinical inference, CIRE telemetry, outcome evidence, privacy boundaries, and AMR context.',
                }}
            />
            <DemoCase />
        </>
    );
}
