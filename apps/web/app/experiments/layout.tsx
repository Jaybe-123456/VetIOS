import type { ReactNode } from 'react';
import { requirePageSession } from '@/lib/auth/pageGuard';

export default async function ExperimentsLayout({ children }: { children: ReactNode }) {
    await requirePageSession('/experiments');
    return children;
}

