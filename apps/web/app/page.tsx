import type { Metadata } from 'next';
import LandingPage from '@/components/landing/LandingPage';

export const metadata: Metadata = {
    title: 'VetIOS - AI Infrastructure for Veterinary Intelligence',
    description: 'A closed-loop platform for veterinary inference, outcome learning, simulation, and observability.',
};

export default function Page() {
    return <LandingPage />;
}
