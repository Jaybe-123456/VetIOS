import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { runPartnerV1Route } from '@/lib/api/v1-route';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { resolvePartnerOwnerTenantId } from '@/lib/api/partner-service';

type CaseRow = {
    species?: string | null;
    species_canonical?: string | null;
    primary_condition_class?: string | null;
    confirmed_diagnosis?: string | null;
    predicted_diagnosis?: string | null;
    metadata?: Record<string, unknown> | null;
    patient_metadata?: Record<string, unknown> | null;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const speciesFilter = url.searchParams.get('species')?.trim().toLowerCase() ?? null;
    const regionFilter = url.searchParams.get('region')?.trim().toLowerCase() ?? null;
    const limit = Math.max(50, Math.min(1000, Number(url.searchParams.get('limit') ?? '500')));

    return runPartnerV1Route(request, {
        endpoint: '/v1/dataset/prevalence',
        aggregateType: 'dataset_prevalence',
        handler: async (auth) => {
            const tenantId = resolvePartnerOwnerTenantId(auth.partner);
            if (!tenantId) {
                return NextResponse.json({ error: 'Partner is missing an owner tenant mapping.' }, { status: 400 });
            }

            const { data, error } = await getSupabaseServer()
                .from('clinical_cases')
                .select('species,species_canonical,primary_condition_class,confirmed_diagnosis,predicted_diagnosis,metadata,patient_metadata')
                .eq('tenant_id', tenantId)
                .order('updated_at', { ascending: false })
                .limit(limit);

            if (error) {
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            const rows = ((data ?? []) as CaseRow[]).filter((row) => {
                const species = (row.species_canonical ?? row.species ?? '').toLowerCase();
                const metadataRegion = readRegion(row).toLowerCase();
                return (!speciesFilter || species.includes(speciesFilter))
                    && (!regionFilter || metadataRegion.includes(regionFilter));
            });

            const buckets = new Map<string, number>();
            for (const row of rows) {
                const label = row.confirmed_diagnosis ?? row.predicted_diagnosis ?? row.primary_condition_class ?? 'unknown';
                buckets.set(label, (buckets.get(label) ?? 0) + 1);
            }

            const total = rows.length || 1;
            const conditions = [...buckets.entries()]
                .map(([condition, count]) => ({
                    condition,
                    count,
                    prevalence_pct: Math.round((count / total) * 10_000) / 100,
                }))
                .sort((left, right) => right.count - left.count)
                .slice(0, 20);

            return NextResponse.json({
                species: speciesFilter,
                region: regionFilter,
                cases_analyzed: rows.length,
                conditions,
            });
        },
    });
}

function readRegion(row: CaseRow) {
    const metadata = row.metadata ?? {};
    const patientMetadata = row.patient_metadata ?? {};
    const metadataRegion = typeof metadata.region === 'string' ? metadata.region : null;
    const patientRegion = typeof patientMetadata.region === 'string' ? patientMetadata.region : null;
    return metadataRegion ?? patientRegion ?? 'global';
}
