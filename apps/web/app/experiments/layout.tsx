import type { ReactNode } from 'react';
import { requireAdminPageSession } from '@/lib/auth/pageGuard';

export default async function ExperimentsLayout({ children }: { children: ReactNode }) {
    await requireAdminPageSession('/experiments');
    return children;
}
