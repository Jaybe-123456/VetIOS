import type { ReactNode } from 'react';
import { requirePageSession } from '@/lib/auth/pageGuard';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
    await requirePageSession('/dashboard');
    return children;
}

