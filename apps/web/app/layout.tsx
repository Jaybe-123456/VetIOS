import type { Metadata } from 'next';
import { localFont } from 'next/font/local';
import './globals.css';
import AppShell from '@/components/AppShell';

const inter = localFont({
  src: [
    {
      path: '../../../public/fonts/inter-variable.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-inter',
});

const jetbrainsMono = localFont({
  src: [
    {
      path: '../../../public/fonts/jetbrains-mono-variable.woff2',
      weight: '100 800',
      style: 'normal',
    },
  ],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: 'VetIOS Inference Console',
  description: 'Intelligence infrastructure for veterinary medicine.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>\n      <body className="h-screen w-screen overflow-hidden flex bg-background text-foreground">\n        <AppShell>\n          {children}\n        </AppShell>\n      </body>\n    </html>\n  );\n}