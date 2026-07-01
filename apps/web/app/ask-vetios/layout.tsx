import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Ask VetIOS | VetIOS',
    description: 'Ask VetIOS clinical intelligence for veterinary questions, research-depth explanations, and differential reasoning.',
    alternates: { canonical: '/ask-vetios' },
};

export default function AskVetiosLayout({ children }: { children: ReactNode }) {
    return children;
}
