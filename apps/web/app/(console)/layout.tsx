import type { ReactNode } from 'react';
import { requirePageSession } from '@/lib/auth/pageGuard';
import { AuthInactivityTimer } from '@/components/auth/AuthInactivityTimer';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
    await requirePageSession('/inference');
    
    return (
        <>
            <AuthInactivityTimer />
            {children}
        </>
    );
}

