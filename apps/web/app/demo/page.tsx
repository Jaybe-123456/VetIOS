import type { Metadata } from 'next';
import { DemoCase } from '@/components/clinical/DemoCase';

export const metadata: Metadata = {
    title: 'Demo Case | VetIOS',
    description: 'Try a pre-filled VetIOS veterinary diagnosis demo without creating an account.',
};

export default function DemoPage() {
    return <DemoCase />;
}
