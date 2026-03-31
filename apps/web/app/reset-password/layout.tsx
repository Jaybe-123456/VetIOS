import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Set New Password',
    description: 'Create a new VetIOS password from a verified password-reset session.',
    alternates: {
        canonical: '/reset-password',
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

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
    return children;
}
