import type { ReactNode } from 'react';
import { requireAdminPageSession } from '@/lib/auth/pageGuard';

export default async function TelemetryLayout({ children }: { children: ReactNode }) {
    await requireAdminPageSession('/telemetry');
    return children;
}
