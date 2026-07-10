import IngestionOperationsConsoleClient from '@/components/IngestionOperationsConsoleClient';
import { requireAdminPageSession } from '@/lib/auth/pageGuard';

export const dynamic = 'force-dynamic';

export default async function IngestionOperationsPage() {
    await requireAdminPageSession('/dashboard/ingestion');

    return <IngestionOperationsConsoleClient />;
}
