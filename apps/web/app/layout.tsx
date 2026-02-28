import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/Sidebar';
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
            <body className="h-screen w-screen overflow-hidden flex bg-background text-foreground">
                <Sidebar />
                <div className="flex-1 flex flex-col h-full overflow-hidden relative">
                    <header className="h-16 border-b border-grid flex items-center justify-end px-6 shrink-0 bg-background/50 backdrop-blur-md absolute top-0 right-0 left-0 z-10 w-full pointer-events-none">
                        <div className="pointer-events-auto flex items-center gap-4">
                            <UserNav />
                        </div>
                    </header>
                    <main className="flex-1 overflow-auto bg-background pt-16">
                        {children}
                    </main>
                </div>
            </body>
        </html>
    );
}

