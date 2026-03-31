import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Reset Access',
    description: 'Request a password reset for an existing VetIOS password account.',
    alternates: {
        canonical: '/forgot-password',
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

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
    return children;
}
