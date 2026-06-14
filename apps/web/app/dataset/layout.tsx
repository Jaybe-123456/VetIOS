import type { ReactNode } from 'react';
import { requireAdminPageSession } from '@/lib/auth/pageGuard';

export default async function DatasetLayout({ children }: { children: ReactNode }) {
    await requireAdminPageSession('/dataset');
    return children;
}
