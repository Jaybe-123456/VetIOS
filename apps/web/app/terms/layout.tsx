import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Terms of Service | VetIOS',
    description: 'Terms governing use of VetIOS clinical intelligence infrastructure and inference services.',
    alternates: { canonical: '/terms' },
};

export default function TermsLayout({ children }: { children: ReactNode }) {
    return children;
}
