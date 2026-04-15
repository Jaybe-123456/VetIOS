'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';

export function AppProviders({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 30_000,
                        refetchOnWindowFocus: false,
                    },
                },
            }),
    );

    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} forcedTheme="dark">
                {children}
                <Toaster
                    position="bottom-right"
                    toastOptions={{
                        style: {
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-default)',
                            color: 'var(--text-secondary)',
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: '12px',
                            borderRadius: '4px',
                        },
                        classNames: {
                            success: 'border-green-500 text-green-400',
                            error: 'border-red-500 text-red-400',
                            warning: 'border-amber-500 text-amber-400',
                        },
                    }}
                />
            </ThemeProvider>
        </QueryClientProvider>
    );
}
