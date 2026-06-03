import type { Metadata } from 'next';
import { SearchLandingPage } from '@/components/seo/SearchLandingPage';

export const metadata: Metadata = {
    title: 'Veterinary AI Platform',
    description: 'VetIOS is veterinary AI infrastructure for clinical inference, outcome learning, simulation, observability, and auditable decision support.',
    alternates: { canonical: '/veterinary-ai' },
    keywords: ['veterinary AI', 'AI veterinary platform', 'veterinary clinical intelligence', 'VetIOS'],
    openGraph: {
        title: 'Veterinary AI Platform | VetIOS',
        description: 'VetIOS is veterinary AI infrastructure for clinical inference, outcome learning, simulation, observability, and auditable decision support.',
        url: '/veterinary-ai',
        type: 'website',
        images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'VetIOS veterinary AI platform' }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Veterinary AI Platform | VetIOS',
        description: 'Veterinary AI infrastructure for clinical inference, outcome learning, simulation, and auditable decision support.',
        images: ['/opengraph-image'],
    },
};

export default function VeterinaryAIPage() {
    return (
        <SearchLandingPage
            eyebrow="Veterinary AI"
            title="Veterinary AI infrastructure for clinical intelligence."
            description="VetIOS connects structured veterinary cases, model inference, reliability signals, confirmed outcomes, and simulation into a closed-loop platform."
            canonicalPath="/veterinary-ai"
            keywords={['veterinary AI', 'AI veterinary platform', 'clinical intelligence', 'outcome learning']}
            sections={[
                {
                    title: 'Clinical inference',
                    body: 'VetIOS accepts structured species, symptom, history, and lab context to produce ranked differential hypotheses with confidence and traceability.',
                    points: ['Typed clinical inputs', 'Ranked differential output', 'Auditable inference event IDs'],
                },
                {
                    title: 'Outcome learning',
                    body: 'Confirmed diagnoses and outcome events close the loop, giving teams a path to measure and calibrate future veterinary AI results.',
                    points: ['Idempotent outcome capture', 'Tenant-scoped calibration', 'Append-only event history'],
                },
                {
                    title: 'Operational control',
                    body: 'The platform is designed for operators who need rate limits, telemetry, simulation, and observability rather than a black-box assistant.',
                    points: ['Simulation before rollout', 'Runtime health checks', 'Traceable model lineage'],
                },
            ]}
            faqs={[
                {
                    question: 'What is veterinary AI?',
                    answer: 'Veterinary AI applies machine learning, structured data, and clinical reasoning systems to support veterinary workflows such as triage, differential diagnosis, documentation, and population surveillance.',
                },
                {
                    question: 'Is VetIOS a veterinary chatbot?',
                    answer: 'No. VetIOS is infrastructure for veterinary intelligence. It exposes APIs, event stores, reliability signals, outcome learning, simulation, and public surveillance surfaces.',
                },
                {
                    question: 'Does VetIOS replace veterinarians?',
                    answer: 'No. VetIOS is decision-support infrastructure. Outputs require professional review and must be interpreted by licensed veterinary professionals.',
                },
            ]}
        />
    );
}
