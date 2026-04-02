import type { Metadata } from 'next';
import { ExperimentTrackingClient } from '@/components/ExperimentTrackingClient';
import { getExperimentDashboardSnapshot } from '@/lib/experiments/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Experiment Track',
    description: 'VetIOS Experiment Track is the reproducible AI research stack for veterinary institutions, preserving the dataset versions, hyperparameters, model lineage, and comparisons behind every published result.',
};

export default async function ExperimentsPage() {
    const session = await resolveSessionTenant();
    const tenantId = session?.tenantId ?? resolveDevTenantId();

    const initialSnapshot = tenantId
        ? await getExperimentDashboardSnapshot(
            createSupabaseExperimentTrackingStore(getSupabaseServer()),
            tenantId,
            { runLimit: 50, readOnly: false },
        )
        : {
            tenant_id: '',
            summary: {
                total_runs: 0,
                active_runs: 0,
                failed_runs: 0,
                summary_only_runs: 0,
                telemetry_coverage_pct: 0,
                registry_link_coverage_pct: 0,
                safety_metric_coverage_pct: 0,
                full_safety_metric_coverage_pct: 0,
                failed_run_ids: [],
                active_run_ids: [],
            },
            runs: [],
            selected_run_id: null,
            selected_run_detail: null,
            comparison: null,
            refreshed_at: new Date().toISOString(),
        };

    return <ExperimentTrackingClient initialSnapshot={initialSnapshot} />;
}

function resolveDevTenantId(): string | null {
    if (process.env.VETIOS_DEV_BYPASS !== 'true') {
        return null;
    }

    const configuredTenantId = process.env.VETIOS_DEV_TENANT_ID?.trim();
    return configuredTenantId || null;
}
