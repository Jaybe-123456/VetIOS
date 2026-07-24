import type { ReactNode } from 'react';
import { requireAdminPageSession } from '@/lib/auth/pageGuard';

export default async function AMROutcomeNetworkLayout({ children }: { children: ReactNode }) {
    await requireAdminPageSession('/amr-network');
    return children;
}
