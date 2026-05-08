import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';
import { AppProviders } from '@/components/AppProviders';
import { getConfiguredSiteOrigin, shouldIndexSite } from '@/lib/site';

const siteOrigin = getConfiguredSiteOrigin();
const allowIndexing = shouldIndexSite();

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
  interactiveWidget: 'resizes-visual',
};

export const metadata: Metadata = {
  metadataBase: siteOrigin ? new URL(siteOrigin) : undefined,
  applicationName: 'VetIOS',
  title: {
    default: 'VetIOS',
    template: '%s | VetIOS',
  },
  description:
    'VetIOS clinical intelligence console for veterinary inference, triage, model operations, and outcome learning.',
  alternates: siteOrigin ? { canonical: '/' } : undefined,
  referrer: 'origin-when-cross-origin',
  robots: allowIndexing
    ? {
        index: true,
        follow: true,
        googleBot: { index: true, follow: true },
      }
    : {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
      },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // "dark" class is hardcoded here so SSR and client agree from frame 1.
    // AppProviders uses forcedTheme="dark" so next-themes never overrides it.
    <html lang="en" className="dark font-mono" suppressHydrationWarning>
      <body className="h-screen w-screen overflow-hidden flex bg-background text-foreground">
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
