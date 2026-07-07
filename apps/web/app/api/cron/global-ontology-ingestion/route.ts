import { NextResponse } from 'next/server';
import { apiGuard } from '@/lib/http/apiGuard';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';
import { withRequestHeaders } from '@/lib/http/requestId';
import {
    buildGlobalBiomedicalOntologyPopulationRows,
    recordGlobalBiomedicalOntologyPopulationEvents,
} from '@/lib/inference/globalBiomedicalOntologyPopulation';
import {
    fetchOfficialOntologyMatches,
    recordVerifiedExternalCodeMappings,
} from '@/lib/inference/globalOneHealthOfficialIngestion';
import {
    buildGlobalOntologyCompletionSnapshot,
    recordGlobalOntologyCompletionSnapshot,
} from '@/lib/inference/globalOntologyCompletionSnapshot';
import { recordOfficialOntologyIngestionRunEvent } from '@/lib/inference/officialOntologyIngestionEvents';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const GLOBAL_ONTOLOGY_JOB = 'global-ontology-ingestion';
const GLOBAL_ONTOLOGY_SCHEDULE = '35 3 * * *';

export async function GET(req: Request) {
    return runGlobalOntologyIngestion(req);
}

export async function POST(req: Request) {
    return runGlobalOntologyIngestion(req);
}

async function runGlobalOntologyIngestion(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 2,
        windowMs: 60_000,
        maxBodySize: 64 * 1024,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const cronAuth = authorizeCronRequest(req, GLOBAL_ONTOLOGY_JOB);
    if (!cronAuth.authorized) {
        const response = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const url = new URL(req.url);
    const tenantId = normalizeOptionalText(url.searchParams.get('tenant_id'))
        ?? normalizeOptionalText(process.env.VETIOS_PLATFORM_TENANT_ID ?? null)
        ?? normalizeOptionalText(process.env.VETIOS_PUBLIC_TENANT_ID ?? null);
    if (!tenantId) {
        const response = NextResponse.json({
            error: 'tenant_missing',
            message: 'tenant_id, VETIOS_PLATFORM_TENANT_ID, or VETIOS_PUBLIC_TENANT_ID is required.',
            request_id: requestId,
        }, { status: 400 });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const dryRun = url.searchParams.get('dry_run') === 'true';
    const maxNodesPerProvider = readBoundedInt(
        url.searchParams.get('max_nodes_per_provider'),
        Number(process.env.GLOBAL_ONTOLOGY_MAX_NODES_PER_PROVIDER ?? 5000),
        1,
        250_000,
    );
    const maxRelationshipsPerProvider = readBoundedInt(
        url.searchParams.get('max_relationships_per_provider'),
        Number(process.env.GLOBAL_ONTOLOGY_MAX_RELATIONSHIPS_PER_PROVIDER ?? 10000),
        1,
        500_000,
    );
    const providerKeys = url.searchParams.get('provider_keys')
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    const conditionKeys = url.searchParams.get('condition_keys')
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);

    const supabase = getSupabaseServer();
    const populationRequestId = `global_ontology_population:${requestId}`;
    const ingestionRequestId = `global_ontology_mapping_ingestion:${requestId}`;
    const completionRequestId = `global_ontology_completion:${requestId}`;
    const populationRows = await buildGlobalBiomedicalOntologyPopulationRows({
        tenantId,
        requestId: populationRequestId,
        providerKeys,
        maxNodesPerProvider,
        maxRelationshipsPerProvider,
        observedAt: new Date().toISOString(),
        env: process.env,
    });
    const populationWrite = dryRun
        ? {
            releaseRows: populationRows.releaseRows.length,
            nodeRows: populationRows.nodeRows.length,
            relationshipRows: populationRows.relationshipRows.length,
            snapshotInserted: false,
            error: null,
        }
        : await recordGlobalBiomedicalOntologyPopulationEvents(
            supabase as unknown as Parameters<typeof recordGlobalBiomedicalOntologyPopulationEvents>[0],
            populationRows,
        );

    const ingestion = await fetchOfficialOntologyMatches({
        providerKeys,
        conditionKeys,
        env: process.env,
    });
    const mappingWrite = dryRun
        ? { inserted: 0, error: null }
        : await recordVerifiedExternalCodeMappings({
            client: supabase as unknown as Parameters<typeof recordVerifiedExternalCodeMappings>[0]['client'],
            tenantId,
            requestId: ingestionRequestId,
            matches: ingestion.matches,
            observedAt: new Date().toISOString(),
        });
    const ingestionAudit = await recordOfficialOntologyIngestionRunEvent(
        supabase as unknown as Parameters<typeof recordOfficialOntologyIngestionRunEvent>[0],
        {
            tenantId,
            requestId: ingestionRequestId,
            ingestion,
            insertedRows: mappingWrite.inserted,
            dryRun,
            observedAt: new Date().toISOString(),
        },
    );

    const completion = await buildGlobalOntologyCompletionSnapshot(
        supabase as unknown as Parameters<typeof buildGlobalOntologyCompletionSnapshot>[0],
        {
            tenantId,
            requestId: completionRequestId,
            observedAt: new Date().toISOString(),
            env: process.env,
        },
    );
    const completionWrite = dryRun
        ? { id: null, error: null }
        : await recordGlobalOntologyCompletionSnapshot(
            supabase as unknown as Parameters<typeof recordGlobalOntologyCompletionSnapshot>[0],
            completion.snapshot,
        );

    const failed = populationWrite.error || mappingWrite.error || ingestionAudit.error || completionWrite.error;
    const response = NextResponse.json({
        cron: {
            ...buildCronExecutionRecord(GLOBAL_ONTOLOGY_JOB, cronAuth, requestId),
            schedule: GLOBAL_ONTOLOGY_SCHEDULE,
            tenant_id: tenantId,
            dry_run: dryRun,
        },
        population: {
            release_rows: populationWrite.releaseRows,
            node_rows: populationWrite.nodeRows,
            relationship_rows: populationWrite.relationshipRows,
            snapshot_inserted: populationWrite.snapshotInserted,
            skipped_providers: populationRows.skippedProviders,
            errors: populationRows.errors,
            error: populationWrite.error,
        },
        mapping_ingestion: {
            matched_conditions: new Set(ingestion.matches.map((match) => match.condition_key)).size,
            matches: ingestion.matches.length,
            inserted_rows: mappingWrite.inserted,
            skipped_providers: ingestion.skipped_providers,
            errors: ingestion.errors,
            audit_event_id: ingestionAudit.id,
            audit_error: ingestionAudit.error,
            error: mappingWrite.error,
        },
        completion: {
            snapshot: completion.snapshot,
            snapshot_event_id: completionWrite.id,
            query_errors: completion.query_errors,
            error: completionWrite.error,
        },
        writes_committed: !dryRun,
        request_id: requestId,
    }, { status: failed ? 207 : dryRun ? 200 : 201 });
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function normalizeOptionalText(value: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function readBoundedInt(value: string | null, fallback: number, min: number, max: number) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}
