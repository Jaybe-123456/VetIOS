'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
            {children}
            <Toaster
                position="bottom-right"
                toastOptions={{
                    style: {
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        color: 'hsl(var(--foreground))',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '12px',
                        borderRadius: '8px',
                    },
                }}
            />
        </QueryClientProvider>
    );
}
