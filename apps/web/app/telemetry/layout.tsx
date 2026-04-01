import type { ReactNode } from 'react';
import { requirePageSession } from '@/lib/auth/pageGuard';

export default async function TelemetryLayout({ children }: { children: ReactNode }) {
    await requirePageSession('/telemetry');
    return children;
}

