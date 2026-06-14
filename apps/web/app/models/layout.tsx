import type { ReactNode } from 'react';
import { requireAdminPageSession } from '@/lib/auth/pageGuard';

export default async function ModelsLayout({ children }: { children: ReactNode }) {
    await requireAdminPageSession('/models');
    return children;
}
