import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hashAMREvidenceJson } from '@/lib/amr/evidenceFabric';
import { enforceVetiosClinicalActorGate } from '@/lib/auth/authTrustRouteGate';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { screenAMRSequence } from '@/lib/amr/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AMRSubmitSchema = z.object({
    request_id: z.string().uuid().optional(),
    sequence: z.string().min(20),
    species: z.string().min(1),
    region: z.string().min(2).max(64).optional(),
    pathogen_label: z.string().min(1).max(128).optional(),
    clinical_outcome_id: z.string().uuid().optional(),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['amr:ingest'],
    });

    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json(
                { error: 'Unauthorized', request_id: requestId },
                { status: 401 },
            ),
            requestId,
            startTime,
        );
    }

    const parsed = AMRSubmitSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return withHeaders(
            NextResponse.json(
                {
                    error: 'invalid_input',
                    detail: parsed.error.flatten(),
                    request_id: requestId,
                },
                { status: 400 },
            ),
            requestId,
            startTime,
        );
    }
    const operationRequestId = parsed.data.request_id ?? randomUUID();
    const trustGate = await enforceVetiosClinicalActorGate({
        client: supabase as unknown as Parameters<
            typeof enforceVetiosClinicalActorGate
        >[0]['client'],
        requestId,
        actor: auth.actor,
        actionKey: 'amr.genomic.ingest',
        resource: {
            type: 'amr_research_genomic_screen',
            id: operationRequestId,
            tenantId: auth.actor.tenantId,
        },
        evidence: {
            route: 'api/amr/submit',
            operational_evidence: false,
        },
    });
    if (!trustGate.ok) return withHeaders(trustGate.response, requestId, startTime);
    if (
        auth.actor.authMode !== 'oauth_client'
        || auth.actor.tokenBindingMethod !== 'mtls'
        || !auth.actor.mtlsCertThumbprint
    ) {
        return withHeaders(
            NextResponse.json({
                error: 'mtls_bound_oauth_workload_required',
                request_id: requestId,
            }, { status: 403 }),
            requestId,
            startTime,
        );
    }

    const screenResult = await screenAMRSequence({
        sequence: parsed.data.sequence,
        species: parsed.data.species,
    });

    const payload = {
        tenant_id: auth.actor.tenantId,
        request_id: operationRequestId,
        species: normalizeLabel(parsed.data.species),
        pathogen_label: normalizeOptionalLabel(parsed.data.pathogen_label),
        region: normalizeRegion(parsed.data.region),
        resistance_genes: screenResult.resistance_genes,
        resistance_classes: screenResult.resistance_classes,
        novel_pattern_score: screenResult.novel_pattern_score,
        quantum_backend: screenResult.quantum_backend,
        sequence_hash: screenResult.sequence_hash,
        card_db_version: screenResult.card_db_version,
        clinical_outcome_id: parsed.data.clinical_outcome_id ?? null,
        source_system: 'vetios_research_screen_api',
        source_version: 'v1',
        source_record_digest: screenResult.sequence_hash,
        pipeline_name: screenResult.algorithm_id,
        pipeline_version: screenResult.algorithm_version,
        reference_database_versions: screenResult.reference_database_versions,
        assayed_drug_classes: [],
        quality_status: 'not_reported',
        validation_status: screenResult.validation_status,
        computation_class: screenResult.computation_class,
        clinical_use_allowed: false,
        deidentified: true,
        is_synthetic: false,
        raw_sequence_stored: false,
        evidence_hash: hashAMREvidenceJson({
            sequence_hash: screenResult.sequence_hash,
            algorithm_id: screenResult.algorithm_id,
            algorithm_version: screenResult.algorithm_version,
            resistance_genes: screenResult.resistance_genes,
            resistance_classes: screenResult.resistance_classes,
        }),
        blockers: [
            'isolate_linked_ast_required',
            'external_validation_required',
        ],
        warnings: screenResult.warnings,
        evidence: {
            screening_mode: 'research_only',
            clinical_decision_influence: false,
            raw_sequence_stored: false,
            phenotypic_ast_required: true,
        },
        actor_id: auth.actor.principalLabel
            ?? auth.actor.oauthClientId
            ?? 'oauth_client',
        oauth_client_id: auth.actor.oauthClientId,
        observed_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from('amr_genomic_events')
        .insert(payload)
        .select('id')
        .single();

    if (error) {
        if (error.code === '23505') {
            const existing = await loadExistingAMREvent(
                supabase,
                auth.actor.tenantId,
                operationRequestId,
                screenResult.sequence_hash,
                screenResult.algorithm_id,
                screenResult.algorithm_version,
            );
            if (existing) {
                return withHeaders(
                    NextResponse.json(
                        buildResponse(existing.id, screenResult, true, requestId),
                    ),
                    requestId,
                    startTime,
                );
            }
        }
        const missingMigration = /column .* does not exist|schema cache/i.test(error.message);
        return withHeaders(
            NextResponse.json(
                {
                    error: missingMigration
                        ? 'amr_evidence_fabric_migration_required'
                        : 'amr_event_store_failed',
                    detail: error.message,
                    migration: missingMigration
                        ? 'supabase/migrations/20260730010000_amr_evidence_fabric.sql'
                        : undefined,
                    request_id: requestId,
                },
                { status: 503 },
            ),
            requestId,
            startTime,
        );
    }

    return withHeaders(
        NextResponse.json(
            buildResponse(String(data.id), screenResult, false, requestId),
            { status: 201 },
        ),
        requestId,
        startTime,
    );
}

async function loadExistingAMREvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
    sequenceHash: string,
    pipelineName: string,
    pipelineVersion: string,
): Promise<{ id: string } | null> {
    const byRequest = await supabase
        .from('amr_genomic_events')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
    if (byRequest.data?.id) return { id: String(byRequest.data.id) };

    const { data } = await supabase
        .from('amr_genomic_events')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('sequence_hash', sequenceHash)
        .eq('pipeline_name', pipelineName)
        .eq('pipeline_version', pipelineVersion)
        .maybeSingle();
    return data?.id ? { id: String(data.id) } : null;
}

function buildResponse(
    amrEventId: string,
    result: Awaited<ReturnType<typeof screenAMRSequence>>,
    cached: boolean,
    requestId: string,
) {
    return {
        amr_event_id: amrEventId,
        resistance_genes: result.resistance_genes,
        resistance_classes: result.resistance_classes,
        novel_pattern_score: result.novel_pattern_score,
        novelty_flag: result.novel_pattern_score > 0.75
            ? 'heuristic_review_signal'
            : 'not_flagged',
        quantum_backend: result.quantum_backend,
        card_db_version: result.card_db_version,
        reference_database_versions: result.reference_database_versions,
        algorithm_id: result.algorithm_id,
        algorithm_version: result.algorithm_version,
        computation_class: result.computation_class,
        validation_status: result.validation_status,
        clinical_use_allowed: false,
        screening_mode: 'research_only',
        clinical_decision_influence: false,
        phenotypic_ast_required: true,
        warnings: result.warnings,
        cached,
        request_id: requestId,
        error: null,
    };
}

function normalizeLabel(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeOptionalLabel(value: string | undefined): string | null {
    return value ? normalizeLabel(value) : null;
}

function normalizeRegion(value: string | undefined): string | null {
    const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    return normalized || null;
}

function withHeaders(response: NextResponse, requestId: string, startTime: number) {
    response.headers.set('Cache-Control', 'private, no-store');
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
