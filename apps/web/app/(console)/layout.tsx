import type { ReactNode } from 'react';
import { requirePageSession } from '@/lib/auth/pageGuard';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
    await requirePageSession('/inference');
    return children;
}

