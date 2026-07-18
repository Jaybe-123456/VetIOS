import type { Metadata } from 'next';
import { ProofLoopDemo } from '@/components/proofloop/ProofLoopDemo';

export const metadata: Metadata = {
    title: 'ProofLoop | Outcome-Verified AI Release Gates',
    description: 'VetIOS ProofLoop turns verified clinical outcomes into executable AI evaluations, regression tests, and release gates.',
    alternates: { canonical: '/proofloop' },
    openGraph: {
        title: 'VetIOS ProofLoop | Reality becomes a release gate',
        description: 'An outcome-verified ground-truth layer for executable AI evals, regression tests, and release gates.',
        url: '/proofloop',
        siteName: 'VetIOS',
        type: 'website',
        images: [
            {
                url: '/opengraph-image',
                width: 1200,
                height: 630,
                alt: 'VetIOS ProofLoop outcome-to-release-gate workflow',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'VetIOS ProofLoop | Reality becomes a release gate',
        description: 'Verified outcomes become executable AI evals, regression tests, and release gates.',
        images: ['/opengraph-image'],
    },
};

export default function ProofLoopPage() {
    return <ProofLoopDemo />;
}
