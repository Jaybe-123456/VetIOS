import { DeveloperAnalyticsClient } from '@/components/developer/DeveloperAnalyticsClient';

export const dynamic = 'force-dynamic';

export default function AdminDeveloperAnalyticsPage() {
    return <DeveloperAnalyticsClient adminMode />;
}
