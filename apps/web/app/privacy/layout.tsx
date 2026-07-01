import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Privacy Policy | VetIOS',
    description: 'How VetIOS handles clinical data, inference traces, and operator telemetry.',
    alternates: { canonical: '/privacy' },
};

export default function PrivacyLayout({ children }: { children: ReactNode }) {
    return children;
}
