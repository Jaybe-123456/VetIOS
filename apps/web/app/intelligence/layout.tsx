import type { ReactNode } from 'react';
import { requireAdminPageSession } from '@/lib/auth/pageGuard';

export default async function IntelligenceLayout({ children }: { children: ReactNode }) {
    await requireAdminPageSession('/intelligence');
    return children;
}
