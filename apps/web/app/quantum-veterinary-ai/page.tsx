import type { Metadata } from 'next';
import { SearchLandingPage } from '@/components/seo/SearchLandingPage';

export const metadata: Metadata = {
    title: 'Quantum Veterinary AI',
    description: 'Quantum-ready veterinary AI using Gaussian boson sampling for graph ranking, QIVS screening, and AMR RNA folding research.',
    alternates: { canonical: '/quantum-veterinary-ai' },
    keywords: ['quantum veterinary AI', 'Gaussian boson sampling veterinary', 'QIVS veterinary drug discovery', 'AMR RNA folding'],
    openGraph: {
        title: 'Quantum Veterinary AI | VetIOS',
        description: 'Quantum-ready veterinary AI using Gaussian boson sampling for graph ranking, QIVS screening, and AMR RNA folding research.',
        url: '/quantum-veterinary-ai',
        type: 'website',
        images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'VetIOS quantum veterinary AI' }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Quantum Veterinary AI | VetIOS',
        description: 'Quantum-ready veterinary AI for graph ranking, QIVS screening, and AMR RNA folding research.',
        images: ['/opengraph-image'],
    },
};

export default function QuantumVeterinaryAIPage() {
    return (
        <SearchLandingPage
            eyebrow="Quantum Veterinary AI"
            title="Quantum-ready veterinary AI for graph and AMR research."
            description="VetIOS includes a Gaussian boson sampling service for graph ranking, quantum inverse virtual screening, and AMR RNA folding experiments grounded in published photonic quantum methods."
            canonicalPath="/quantum-veterinary-ai"
            keywords={['quantum veterinary AI', 'Gaussian boson sampling', 'QIVS', 'AMR surveillance']}
            sections={[
                {
                    title: 'GBS graph ranking',
                    body: 'The veterinary knowledge graph can be anonymized into node IDs and weights for Gaussian boson sampling clique search.',
                    points: ['No patient text sent to the quantum service', 'Weighted clique ranking', 'Classical fallback when unavailable'],
                },
                {
                    title: 'QIVS screening',
                    body: 'Quantum inverse virtual screening stores hashed drug inputs and derived binding-pose outputs for veterinary AMR pathogen research.',
                    points: ['SMILES hashed before storage', 'Target pathogen seed set', 'Quantum advantage tracked per run'],
                },
                {
                    title: 'AMR RNA folding',
                    body: 'RNA sequences are hashed, transformed into weighted full stem graphs, and evaluated for secondary-structure predictions.',
                    points: ['Raw sequence never persisted', 'WFSG node and edge counts stored', 'MCC computed when references exist'],
                },
            ]}
            faqs={[
                {
                    question: 'Does VetIOS use Jiuzhang directly?',
                    answer: 'No. Jiuzhang hardware is not publicly accessible. VetIOS uses accessible Gaussian boson sampling methods through a service layer designed to support Strawberry Fields and future photonic backends.',
                },
                {
                    question: 'What quantum method does VetIOS use?',
                    answer: 'The current implementation focuses on Gaussian boson sampling for maximum weighted clique search, QIVS-style binding interaction graphs, and weighted full stem graphs for RNA folding.',
                },
                {
                    question: 'Is patient data sent to the quantum service?',
                    answer: 'No. Clinical graph ranking sends anonymized node IDs and weights only. QIVS stores hashed SMILES strings, and RNA folding stores sequence hashes rather than raw sequences.',
                },
            ]}
        />
    );
}
