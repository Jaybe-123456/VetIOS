import type { ReactNode } from 'react';
import { requirePageSession } from '@/lib/auth/pageGuard';

export default async function ModelsLayout({ children }: { children: ReactNode }) {
    await requirePageSession('/models');
    return children;
}

