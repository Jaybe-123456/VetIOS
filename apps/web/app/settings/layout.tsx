import type { ReactNode } from 'react';
import { requirePageSession } from '@/lib/auth/pageGuard';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
    await requirePageSession('/settings');
    return children;
}

