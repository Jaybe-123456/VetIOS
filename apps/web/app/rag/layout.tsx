import type { ReactNode } from 'react';
import { requirePageSession } from '@/lib/auth/pageGuard';

export default async function AgenticRagLayout({ children }: { children: ReactNode }) {
    await requirePageSession('/rag');
    return children;
}
