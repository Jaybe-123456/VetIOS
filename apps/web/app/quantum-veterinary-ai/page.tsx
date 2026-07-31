import type { Metadata } from 'next';
import { SearchLandingPage } from '@/components/seo/SearchLandingPage';

export const metadata: Metadata = {
    title: 'Quantum Computing Research',
    description: 'A benchmarked, non-clinical VetIOS research track for quantum optimization, molecular methods, and post-quantum readiness.',
    alternates: { canonical: '/quantum-veterinary-ai' },
    keywords: ['quantum computing research', 'post-quantum security', 'AMR molecular research', 'classical quantum benchmarking'],
    openGraph: {
        title: 'Quantum Computing Research | VetIOS',
        description: 'Non-clinical quantum research with mandatory classical baselines and no influence on clinical decisions.',
        url: '/quantum-veterinary-ai',
        type: 'website',
        images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'VetIOS quantum computing research' }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Quantum Computing Research | VetIOS',
        description: 'Benchmarked quantum research separated from clinical decision support.',
        images: ['/opengraph-image'],
    },
};

export default function QuantumVeterinaryAIPage() {
    return (
        <SearchLandingPage
            eyebrow="Research Track"
            title="Quantum computing research, outside the clinical path."
            description="VetIOS evaluates quantum and hybrid methods only as reproducible research experiments. The deterministic clinical engine remains authoritative, every experiment requires a classical baseline, and quantum output has no clinical decision influence."
            canonicalPath="/quantum-veterinary-ai"
            keywords={['quantum computing research', 'classical baseline', 'post-quantum security', 'AMR research']}
            sections={[
                {
                    title: 'Shadow optimization experiments',
                    body: 'Graph optimization experiments run beside the deterministic engine and are retained as research telemetry only.',
                    points: ['No change to clinical differential order', 'Anonymized graph inputs', 'Classical baseline required'],
                },
                {
                    title: 'Molecular research boundary',
                    body: 'Molecular simulation and optimization may be evaluated on public or synthetic workloads without making treatment or discovery claims.',
                    points: ['Reproducible benchmark metadata', 'No patient-level clinical action', 'External validation required'],
                },
                {
                    title: 'Post-quantum readiness',
                    body: 'The production priority is cryptographic agility for long-lived clinical, genomic, and partner evidence.',
                    points: ['Algorithm inventory', 'Versioned signatures', 'Standards-led migration'],
                },
            ]}
            faqs={[
                {
                    question: 'Does quantum computing influence VetIOS diagnoses?',
                    answer: 'No. Quantum and hybrid outputs are shadow research telemetry. The deterministic classical clinical engine produces the diagnostic result.',
                },
                {
                    question: 'Does VetIOS claim quantum advantage?',
                    answer: 'No. An experiment must outperform a strong classical baseline on reproducible cost, accuracy, and runtime measures before any advantage can be considered.',
                },
                {
                    question: 'What is production-ready today?',
                    answer: 'Classical clinical infrastructure and the post-quantum migration boundary are production concerns. Quantum molecular and optimization work remains a separate research track.',
                },
            ]}
        />
    );
}
