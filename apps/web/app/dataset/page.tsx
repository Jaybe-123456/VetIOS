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
                quarantinedCases={[]}
                inferenceEvents={[]}
                summary={{
                    live_count: 0,
                    quarantined_count: 0,
                    unlabeled_count: 0,
                    label_coverage_count: 0,
                    adversarial_count: 0,
                    severity_coverage_count: 0,
                    contradiction_coverage_count: 0,
                    calibration_ready_count: 0,
                    label_coverage_pct: 0,
                    severity_coverage_pct: 0,
                    contradiction_coverage_pct: 0,
                    adversarial_coverage_pct: 0,
                    invalid_quarantined_pct: 0,
                    calibration_readiness_pct: 0,
                }}
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
