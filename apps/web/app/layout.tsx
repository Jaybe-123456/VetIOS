import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/AppShell';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

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
        <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
            <body className="h-screen w-screen overflow-hidden flex bg-background text-foreground">
                <AppShell>
                    {children}
                </AppShell>
            </body>
        </html>
    );
}
