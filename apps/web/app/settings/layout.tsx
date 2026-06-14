import type { ReactNode } from 'react';
import { requireAdminPageSession } from '@/lib/auth/pageGuard';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
    await requireAdminPageSession('/settings');
    return children;
}
