import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Sign In',
    description: 'Secure VetIOS sign-in for veterinary teams.',
    alternates: {
        canonical: '/login',
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

export default function LoginLayout({ children }: { children: React.ReactNode }) {
    return children;
}
