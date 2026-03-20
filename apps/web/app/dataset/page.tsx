import { ClinicalDatasetClient } from '@/components/ClinicalDatasetClient';
import { createSupabaseClinicalDatasetStore, getTenantClinicalDataset } from '@/lib/dataset/clinicalDataset';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export default async function ClinicalDatasetPage() {
    const session = await resolveSessionTenant();
    const tenantId = session?.tenantId ?? resolveDevTenantId();

    if (!tenantId) {
        return (
            <ClinicalDatasetClient
                clinicalCases={[]}
                inferenceEvents={[]}
                refreshedAt={new Date().toISOString()}
            />
        );
    }

    const supabase = getSupabaseServer();
    const datasetStore = createSupabaseClinicalDatasetStore(supabase);
    const dataset = await getTenantClinicalDataset(datasetStore, tenantId, 50, {
        authenticatedUserId: session?.userId ?? null,
        source: 'dataset_page',
    });

    return <ClinicalDatasetClient {...dataset} />;
}

function resolveDevTenantId(): string | null {
    if (process.env.VETIOS_DEV_BYPASS !== 'true') {
        return null;
    }

    const configuredTenantId = process.env.VETIOS_DEV_TENANT_ID?.trim();
    return configuredTenantId || null;
}
