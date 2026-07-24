import type { Metadata } from 'next';
import { SearchLandingPage } from '@/components/seo/SearchLandingPage';

export const metadata: Metadata = {
    title: 'Veterinary Diagnostic AI',
    description: 'AI-assisted veterinary differential diagnosis with graph priors, CIRE runtime signals, structured inputs, and outcome feedback.',
    alternates: { canonical: '/veterinary-diagnostic-ai' },
    keywords: ['veterinary diagnostic AI', 'AI differential diagnosis', 'veterinary diagnosis software', 'VetIOS'],
    openGraph: {
        title: 'Veterinary Diagnostic AI | VetIOS',
        description: 'AI-assisted veterinary differential diagnosis with graph priors, CIRE runtime signals, structured inputs, and outcome feedback.',
        url: '/veterinary-diagnostic-ai',
        type: 'website',
        images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'VetIOS veterinary diagnostic AI' }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Veterinary Diagnostic AI | VetIOS',
        description: 'Veterinary differential diagnosis with graph priors, CIRE runtime signals, structured inputs, and outcome feedback.',
        images: ['/opengraph-image'],
    },
};

export default function VeterinaryDiagnosticAIPage() {
    return (
        <SearchLandingPage
            eyebrow="Diagnostic AI"
            title="Veterinary diagnostic AI with governed runtime signals."
            description="VetIOS supports veterinary differential diagnosis by combining structured clinical input, graph priors, deterministic inference, CIRE publication signals, and confirmed outcome feedback."
            canonicalPath="/veterinary-diagnostic-ai"
            keywords={['veterinary diagnostic AI', 'differential diagnosis', 'veterinary diagnosis software', 'CIRE']}
            sections={[
                {
                    title: 'Differential ranking',
                    body: 'Clinical cases are transformed into ranked hypotheses rather than a single opaque answer.',
                    points: ['Species-specific context', 'Symptom-driven graph priors', 'Confidence scores for every result'],
                },
                {
                    title: 'Runtime publication controls',
                    body: 'CIRE signals show differential concentration, perturbation pressure, and publication state alongside inference output.',
                    points: ['phi_hat concentration signal', 'Runtime perturbation score', 'Safety state in the response'],
                },
                {
                    title: 'Closed-loop validation',
                    body: 'Outcome events link confirmed diagnoses back to the original inference so diagnostic quality can be measured over time.',
                    points: ['Confirmed outcome capture', 'No duplicate outcome events', 'Append-only audit trail'],
                },
            ]}
            faqs={[
                {
                    question: 'How does VetIOS rank veterinary differentials?',
                    answer: 'VetIOS combines structured clinical inputs with graph priors and deterministic inference, then returns ranked differential labels with confidence and runtime publication metadata.',
                },
                {
                    question: 'What species does VetIOS support?',
                    answer: 'The platform accepts species-typed inputs and has public content for common veterinary workflows, with graph work focused first on canine and feline disease-symptom relationships.',
                },
                {
                    question: 'Can diagnostic AI be used without outcome feedback?',
                    answer: 'It is decision support only. Confirmed outcomes are required to measure calibration and clinical performance.',
                },
            ]}
        />
    );
}
