import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Create Account',
    description: 'Create a secure VetIOS account for veterinary operations.',
    alternates: {
        canonical: '/signup',
    },
    robots: {
        index: false,
        follow: false,
        googleBot: {
            index: false,
            follow: false,
        },
    },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
    return children;
}
