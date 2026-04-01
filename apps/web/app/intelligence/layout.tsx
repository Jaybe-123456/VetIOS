import type { ReactNode } from 'react';
import { requirePageSession } from '@/lib/auth/pageGuard';

export default async function IntelligenceLayout({ children }: { children: ReactNode }) {
    await requirePageSession('/intelligence');
    return children;
}

