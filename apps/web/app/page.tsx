import type { Metadata } from 'next';
import LandingPage from '@/components/landing/LandingPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { getPublicEvidenceSnapshot } from '@/lib/platform/publicEvidenceSnapshot';
import { getConfiguredSiteOrigin } from '@/lib/site';

export const metadata: Metadata = {
    title: 'VetIOS - AI Infrastructure for Veterinary Intelligence',
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
        title: 'VetIOS - AI Infrastructure for Veterinary Intelligence',
        description: 'Closed-loop veterinary AI infrastructure for inference, outcome learning, simulation, graph intelligence, and quantum-ready AMR research.',
        url: '/',
        siteName: 'VetIOS',
        type: 'website',
    },
};

export default async function Page() {
    const evidenceSnapshot = await getPublicEvidenceSnapshot();
    const siteOrigin = getConfiguredSiteOrigin();

    return (
        <>
            <JsonLd
                data={[
                    {
                        '@context': 'https://schema.org',
                        '@type': 'Organization',
                        name: 'VetIOS',
                        url: siteOrigin ?? 'https://www.vetios.tech',
                        description: 'Veterinary AI infrastructure for clinical inference, outcome learning, simulation, and quantum-ready research.',
                    },
                    {
                        '@context': 'https://schema.org',
                        '@type': 'WebSite',
                        name: 'VetIOS',
                        url: siteOrigin ?? 'https://www.vetios.tech',
                    },
                    {
                        '@context': 'https://schema.org',
                        '@type': 'SoftwareApplication',
                        name: 'VetIOS',
                        applicationCategory: 'Veterinary AI Software',
                        operatingSystem: 'Web',
                        url: siteOrigin ?? 'https://www.vetios.tech',
                        description: 'Closed-loop veterinary AI infrastructure for inference, outcome learning, simulation, graph intelligence, and AMR research.',
                    },
                ]}
            />
            <LandingPage evidenceSnapshot={evidenceSnapshot} />
        </>
    );
}
