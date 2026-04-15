import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';
import { AppProviders } from '@/components/AppProviders';
import { getConfiguredSiteOrigin, shouldIndexSite } from '@/lib/site';

const siteOrigin = getConfiguredSiteOrigin();
const allowIndexing = shouldIndexSite();

export const metadata: Metadata = {
    metadataBase: siteOrigin ? new URL(siteOrigin) : undefined,
    applicationName: 'VetIOS',
    title: {
        default: 'VetIOS',
        template: '%s | VetIOS',
    },
    description: 'VetIOS clinical intelligence console for veterinary inference, triage, model operations, and outcome learning.',
    alternates: siteOrigin ? { canonical: '/' } : undefined,
    referrer: 'origin-when-cross-origin',
    robots: allowIndexing
        ? {
            index: true,
            follow: true,
            googleBot: {
                index: true,
                follow: true,
            },
        }
        : {
            index: false,
            follow: false,
            googleBot: {
                index: false,
                follow: false,
            },
        },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning className="dark font-mono">
            <body className="h-screen w-screen overflow-hidden flex bg-background text-foreground">
                <AppProviders>
                    <AppShell>{children}</AppShell>
                </AppProviders>
            </body>
        </html>
    );
}
