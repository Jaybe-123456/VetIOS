import type { Metadata } from 'next';
import LandingPage from '@/components/landing/LandingPage';
import { getPublicEvidenceSnapshot } from '@/lib/platform/publicEvidenceSnapshot';

export const metadata: Metadata = {
    title: 'VetIOS - AI Infrastructure for Veterinary Intelligence',
    description: 'A closed-loop platform for veterinary inference, outcome learning, simulation, and observability.',
};

export default async function Page() {
    const evidenceSnapshot = await getPublicEvidenceSnapshot();
    return <LandingPage evidenceSnapshot={evidenceSnapshot} />;
}
