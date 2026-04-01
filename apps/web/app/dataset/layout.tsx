import type { ReactNode } from 'react';
import { requirePageSession } from '@/lib/auth/pageGuard';

export default async function DatasetLayout({ children }: { children: ReactNode }) {
    await requirePageSession('/dataset');
    return children;
}

