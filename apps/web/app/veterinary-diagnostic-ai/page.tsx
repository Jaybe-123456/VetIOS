import type { Metadata } from 'next';
import { SearchLandingPage } from '@/components/seo/SearchLandingPage';

export const metadata: Metadata = {
    title: 'Veterinary Diagnostic AI',
    description: 'AI-assisted veterinary differential diagnosis with graph priors, CIRE reliability signals, structured inputs, and outcome feedback.',
    alternates: { canonical: '/veterinary-diagnostic-ai' },
    keywords: ['veterinary diagnostic AI', 'AI differential diagnosis', 'veterinary diagnosis software', 'VetIOS'],
};

export default function VeterinaryDiagnosticAIPage() {
    return (
        <SearchLandingPage
            eyebrow="Diagnostic AI"
            title="Veterinary diagnostic AI with reliability signals."
            description="VetIOS supports veterinary differential diagnosis by combining structured clinical input, graph priors, model output, CIRE reliability signals, and confirmed outcome feedback."
            canonicalPath="/veterinary-diagnostic-ai"
            keywords={['veterinary diagnostic AI', 'differential diagnosis', 'veterinary diagnosis software', 'CIRE']}
            sections={[
                {
                    title: 'Differential ranking',
                    body: 'Clinical cases are transformed into ranked hypotheses rather than a single opaque answer.',
                    points: ['Species-specific context', 'Symptom-driven graph priors', 'Confidence scores for every result'],
                },
                {
                    title: 'Reliability estimation',
                    body: 'CIRE signals give operators a structured way to see reliability pressure and safety state alongside model output.',
                    points: ['phi_hat reliability signal', 'Calibration pressure score', 'Safety state in the response'],
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
                    answer: 'VetIOS combines structured clinical inputs with graph priors and model output, then returns ranked differential labels with confidence and reliability metadata.',
                },
                {
                    question: 'What species does VetIOS support?',
                    answer: 'The platform accepts species-typed inputs and has public content for common veterinary workflows, with graph work focused first on canine and feline disease-symptom relationships.',
                },
                {
                    question: 'Can diagnostic AI be used without outcome feedback?',
                    answer: 'It can be used for decision support, but the strongest reliability gains come when confirmed outcomes are linked back to inference events.',
                },
            ]}
        />
    );
}
