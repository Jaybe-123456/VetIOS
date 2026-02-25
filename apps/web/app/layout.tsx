import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import UserNav from '@/components/UserNav';

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
            <body className="h-screen w-screen overflow-hidden flex flex-col">
                <header className="h-12 border-b border-grid flex items-center justify-between px-4 shrink-0 bg-dim">
                    <div className="flex items-center gap-4">
                        <span className="font-mono font-bold tracking-tight text-accent">VET_IOS //</span>
                        <span className="font-mono text-sm text-muted">V1.0 OMEGA</span>
                    </div>
                    <div className="flex items-center gap-6">
                        <nav className="flex items-center gap-6 font-mono text-xs uppercase tracking-widest text-muted">
                            <a href="/inference" className="hover:text-foreground transition-colors">Inference</a>
                            <a href="/outcome" className="hover:text-foreground transition-colors">Outcome</a>
                            <a href="/simulate" className="hover:text-foreground transition-colors">Simulate</a>
                            <a href="/intelligence" className="hover:text-foreground transition-colors">Network</a>
                        </nav>
                        <div className="h-4 w-px bg-grid" />
                        <UserNav />
                    </div>
                </header>
                <main className="flex-1 overflow-auto bg-background">
                    {children}
                </main>
            </body>
        </html>
    );
}

