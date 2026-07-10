import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';
import { AppProviders } from '@/components/AppProviders';
import { getConfiguredSiteOrigin, shouldIndexSite } from '@/lib/site';

const siteOrigin = getConfiguredSiteOrigin();
const allowIndexing = shouldIndexSite();
const ogImage = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'VetIOS veterinary AI infrastructure',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
  interactiveWidget: 'resizes-content',
};

export const metadata: Metadata = {
  metadataBase: siteOrigin ? new URL(siteOrigin) : undefined,
  applicationName: 'VetIOS',
  title: {
    default: 'VetIOS | AI-Native Veterinary Intelligence Infrastructure',
    template: '%s | VetIOS',
  },
  description:
    'VetIOS is veterinary AI infrastructure for clinical inference, differential diagnosis, outcome learning, simulation, graph intelligence, and quantum-ready AMR research.',
  keywords: [
    'VetIOS',
    'veterinary AI',
    'veterinary diagnostic AI',
    'AI veterinary platform',
    'veterinary clinical intelligence',
    'veterinary inference API',
    'veterinary knowledge graph',
    'quantum veterinary AI',
    'AMR veterinary surveillance',
  ],
  alternates: siteOrigin ? { canonical: '/' } : undefined,
  creator: 'VetIOS',
  publisher: 'VetIOS',
  category: 'Veterinary artificial intelligence software',
  referrer: 'origin-when-cross-origin',
  openGraph: siteOrigin
    ? {
        type: 'website',
        url: siteOrigin,
        siteName: 'VetIOS',
        title: 'VetIOS | AI-Native Veterinary Intelligence Infrastructure',
        description:
          'Closed-loop veterinary AI infrastructure for inference, outcome learning, simulation, graph intelligence, and quantum-ready AMR research.',
        images: [ogImage],
      }
    : undefined,
  twitter: {
    card: 'summary_large_image',
    title: 'VetIOS | AI-Native Veterinary Intelligence Infrastructure',
    description:
      'Closed-loop veterinary AI infrastructure for clinical inference, outcome learning, simulation, and quantum-ready research.',
    images: [ogImage.url],
  },
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
      <body className="h-[100dvh] min-h-[100svh] w-full overflow-hidden flex bg-background text-foreground">
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
