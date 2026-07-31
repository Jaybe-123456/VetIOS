import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
    AMR_COMPUTATION_CLASSES,
    AMR_CONCORDANCE_ALGORITHM_VERSION,
    AMR_GENOMIC_EVIDENCE_SCHEMA_VERSION,
    AMR_VALIDATION_STATUSES,
    assessAMRGenomicPipelineValidation,
    buildAMRConcordanceEvents,
    buildAMREvidenceFabricSnapshot,
    buildAMRGenomicPipelineValidationRef,
    hashAMREvidenceValue,
    prepareAMRGenomicEvidence,
    type AMRASTIngestionEvidenceRow,
    type AMRASTResultEvidenceRow,
    type AMRConcordanceEventRow,
    type AMRExternalValidationEvidenceRow,
    type AMRGenomicEvidenceRow,
    type AMRGenomicEvidenceInput,
} from '@/lib/amr/evidenceFabric';
import { enforceVetiosClinicalActorGate } from '@/lib/auth/authTrustRouteGate';
import { resolveClinicalApiActor, type ClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const OptionalText = z.string().trim().min(1).max(256).optional();

const GenomicEvidencePacketSchema = z.object({
    schema_version: z.literal(AMR_GENOMIC_EVIDENCE_SCHEMA_VERSION),
    source_system: z.string().trim().min(1).max(160),
    source_version: OptionalText,
    source_record_digest: Sha256Schema,
    sequence_hash: Sha256Schema,
    isolate_ref: z.string().trim().min(1).max(256),
    amr_ast_ingestion_event_id: UuidSchema,
    lab_site_id: UuidSchema,
    species: z.string().trim().min(1).max(80),
    pathogen_label: OptionalText,
    region: z.string().trim().min(1).max(64).optional(),
    resistance_genes: z.array(z.string().trim().min(1).max(128)).max(2_000),
    resistance_classes: z.array(z.string().trim().min(1).max(128)).max(500),
    assayed_drug_classes: z.array(z.string().trim().min(1).max(128)).max(500),
    pipeline_name: z.string().trim().min(1).max(160),
    pipeline_version: z.string().trim().min(1).max(120),
    reference_database_versions: z.record(
        z.string().trim().min(1).max(120),
        z.string().trim().min(1).max(160),
    ),
    quality_status: z.enum(['passed', 'warning', 'failed', 'not_reported']),
    validation_status: z.enum(AMR_VALIDATION_STATUSES),
    computation_class: z.enum(AMR_COMPUTATION_CLASSES),
    quantum_backend: OptionalText,
    deidentified: z.boolean().default(true),
    is_synthetic: z.boolean().default(false),
    observed_at: z.string().datetime(),
    evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();

const ValidateGenomicEvidenceSchema = z.object({
    action: z.literal('validate_genomic_evidence'),
    request_id: UuidSchema,
    packet: GenomicEvidencePacketSchema,
}).strict();

const RecordGenomicEvidenceSchema = z.object({
    action: z.literal('record_genomic_evidence'),
    request_id: UuidSchema,
    packet: GenomicEvidencePacketSchema,
}).strict();

const MaterializeConcordanceSchema = z.object({
    action: z.literal('materialize_concordance'),
    request_id: UuidSchema,
    amr_ast_ingestion_event_id: UuidSchema,
    genomic_event_id: UuidSchema,
}).strict();

const PostSchema = z.discriminatedUnion('action', [
    ValidateGenomicEvidenceSchema,
    RecordGenomicEvidenceSchema,
    MaterializeConcordanceSchema,
]);

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['amr:read'],
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

    const loaded = await loadEvidenceFabricData(supabase, auth.actor.tenantId);
    if (loaded.error) {
        return withHeaders(storageError(loaded.error, requestId), requestId, startTime);
    }

    return withHeaders(
        NextResponse.json({
            snapshot: buildAMREvidenceFabricSnapshot(loaded),
            evidence_boundary: {
                raw_sequences_stored: false,
                raw_ast_measurements_preserved: true,
                genotype_absence_requires_explicit_assay_coverage: true,
                quantum_clinical_decision_influence: false,
                official_submission_certified: false,
            },
            request_id: requestId,
            error: null,
        }),
        requestId,
        startTime,
    );
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 120, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const parsed = PostSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return withHeaders(
            NextResponse.json({
                error: 'invalid_input',
                detail: parsed.error.flatten(),
                request_id: requestId,
            }, { status: 400 }),
            requestId,
            startTime,
        );
    }

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: parsed.data.action === 'validate_genomic_evidence'
            ? ['amr:read']
            : ['amr:ingest'],
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
    const actorId = auth.actor.userId
        ?? auth.actor.principalLabel
        ?? auth.actor.oauthClientId
        ?? 'machine_actor';

    let response: NextResponse;
    if (parsed.data.action === 'validate_genomic_evidence') {
        response = await validateGenomicEvidence({
            supabase,
            actor: auth.actor,
            actorId,
            requestId,
            body: parsed.data,
        });
    } else if (parsed.data.action === 'record_genomic_evidence') {
        response = await recordGenomicEvidence({
            supabase,
            actor: auth.actor,
            actorId,
            requestId,
            body: parsed.data,
        });
    } else {
        response = await materializeConcordance({
            supabase,
            actor: auth.actor,
            actorId,
            requestId,
            materializationRequestId: parsed.data.request_id,
            ingestionEventId: parsed.data.amr_ast_ingestion_event_id,
            genomicEventId: parsed.data.genomic_event_id,
        });
    }

    return withHeaders(response, requestId, startTime);
}

async function validateGenomicEvidence(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    actor: ClinicalApiActor;
    actorId: string;
    requestId: string;
    body: z.infer<typeof ValidateGenomicEvidenceSchema>;
}) {
    const pipelineValidation = await resolvePipelineValidation(
        input.supabase,
        input.actor.tenantId,
        input.body.packet,
    );
    if (pipelineValidation.error) {
        return storageError(pipelineValidation.error, input.requestId);
    }
    const prepared = prepareAMRGenomicEvidence({
        tenantId: input.actor.tenantId,
        requestId: input.body.request_id,
        actorId: input.actorId,
        oauthClientId: input.actor.oauthClientId ?? null,
        pipelineValidation: pipelineValidation.assessment,
        packet: input.body.packet,
    });
    const lineage = await loadASTIngestion(
        input.supabase,
        input.actor.tenantId,
        input.body.packet.amr_ast_ingestion_event_id,
    );
    if (lineage.error) return storageError(lineage.error, input.requestId);
    const lineageBlockers = validateGenomicASTLineage({
        ingestion: lineage.row,
        isolateRefHash: hashAMREvidenceValue(input.body.packet.isolate_ref),
        labSiteId: input.body.packet.lab_site_id,
        oauthClientId: input.actor.oauthClientId ?? null,
        requireOAuthBinding: false,
    });

    return NextResponse.json({
        mode: 'dry_run',
        recordable: prepared.recordable && lineageBlockers.length === 0,
        clinical_use_allowed:
            prepared.clinical_use_allowed && lineageBlockers.length === 0,
        blockers: uniqueStrings([...prepared.blockers, ...lineageBlockers]),
        clinical_blockers: uniqueStrings([
            ...prepared.clinical_blockers,
            ...lineageBlockers,
        ]),
        warnings: prepared.warnings,
        evidence_hash: prepared.evidence_hash,
        pipeline_validation_ref: pipelineValidation.assessment.target_ref,
        external_validation_event_id:
            pipelineValidation.assessment.external_validation_event_id,
        raw_sequence_stored: false,
        persisted: false,
        request_id: input.requestId,
        error: null,
    }, {
        status: prepared.recordable && lineageBlockers.length === 0 ? 200 : 422,
    });
}

async function recordGenomicEvidence(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    actor: ClinicalApiActor;
    actorId: string;
    requestId: string;
    body: z.infer<typeof RecordGenomicEvidenceSchema>;
}) {
    const trustGate = await enforceVetiosClinicalActorGate({
        client: input.supabase as unknown as Parameters<
            typeof enforceVetiosClinicalActorGate
        >[0]['client'],
        requestId: input.requestId,
        actor: input.actor,
        actionKey: 'amr.genomic.ingest',
        resource: {
            type: 'amr_genomic_evidence',
            id: input.body.packet.source_record_digest,
            tenantId: input.actor.tenantId,
        },
        evidence: {
            route: 'api/amr/evidence-fabric',
            ast_ingestion_event_id: input.body.packet.amr_ast_ingestion_event_id,
            computation_class: input.body.packet.computation_class,
        },
    });
    if (!trustGate.ok) return trustGate.response;
    if (!hasMTLSWorkloadIdentity(input.actor)) {
        return NextResponse.json({
            error: 'mtls_bound_oauth_workload_required',
            request_id: input.requestId,
        }, { status: 403 });
    }

    const ingestion = await loadASTIngestion(
        input.supabase,
        input.actor.tenantId,
        input.body.packet.amr_ast_ingestion_event_id,
    );
    if (ingestion.error) return storageError(ingestion.error, input.requestId);
    const lineageBlockers = validateGenomicASTLineage({
        ingestion: ingestion.row,
        isolateRefHash: hashAMREvidenceValue(input.body.packet.isolate_ref),
        labSiteId: input.body.packet.lab_site_id,
        oauthClientId: input.actor.oauthClientId ?? null,
        requireOAuthBinding: true,
    });
    const pipelineValidation = await resolvePipelineValidation(
        input.supabase,
        input.actor.tenantId,
        input.body.packet,
    );
    if (pipelineValidation.error) {
        return storageError(pipelineValidation.error, input.requestId);
    }
    const prepared = prepareAMRGenomicEvidence({
        tenantId: input.actor.tenantId,
        requestId: input.body.request_id,
        actorId: input.actorId,
        oauthClientId: input.actor.oauthClientId ?? null,
        pipelineValidation: pipelineValidation.assessment,
        packet: input.body.packet,
    });
    const blockers = uniqueStrings([...prepared.blockers, ...lineageBlockers]);
    if (!prepared.recordable || blockers.length > 0) {
        return NextResponse.json({
            error: 'genomic_evidence_blocked',
            recordable: false,
            clinical_use_allowed: false,
            blockers,
            clinical_blockers: uniqueStrings([
                ...prepared.clinical_blockers,
                ...lineageBlockers,
            ]),
            warnings: prepared.warnings,
            request_id: input.requestId,
        }, { status: 422 });
    }

    const inserted = await insertGenomicEvidence(
        input.supabase,
        input.actor.tenantId,
        input.body.request_id,
        prepared.event,
    );
    if (inserted.error || !inserted.row) {
        return storageError(
            inserted.error ?? 'AMR genomic evidence insert returned no row.',
            input.requestId,
        );
    }

    const concordance = await materializeConcordanceRows({
        supabase: input.supabase,
        tenantId: input.actor.tenantId,
        actorId: input.actorId,
        materializationRequestId: input.body.request_id,
        ingestion: ingestion.row!,
        genomic: inserted.row,
    });
    if (concordance.error) return storageError(concordance.error, input.requestId);

    return NextResponse.json({
        genomic_event_id: inserted.row.id,
        evidence_hash: inserted.row.evidence_hash,
        clinical_use_allowed: inserted.row.clinical_use_allowed === true,
        clinical_blockers: inserted.row.clinical_blockers ?? [],
        pipeline_validation_ref: inserted.row.pipeline_validation_ref,
        external_validation_event_id:
            inserted.row.external_validation_event_id,
        concordance: {
            materialized: concordance.materialized,
            cached: concordance.cached,
            review_required: concordance.rows.filter(
                (row) => row.clinical_actionability === 'review_required',
            ).length,
            surveillance_supported: concordance.rows.filter(
                (row) => row.clinical_actionability === 'surveillance_supported',
            ).length,
        },
        warnings: prepared.warnings,
        raw_sequence_stored: false,
        quantum_clinical_decision_influence: false,
        cached: inserted.cached,
        request_id: input.requestId,
        error: null,
    }, { status: inserted.cached ? 200 : 201 });
}

async function materializeConcordance(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    actor: ClinicalApiActor;
    actorId: string;
    requestId: string;
    materializationRequestId: string;
    ingestionEventId: string;
    genomicEventId: string;
}) {
    const trustGate = await enforceVetiosClinicalActorGate({
        client: input.supabase as unknown as Parameters<
            typeof enforceVetiosClinicalActorGate
        >[0]['client'],
        requestId: input.requestId,
        actor: input.actor,
        actionKey: 'amr.concordance.materialize',
        resource: {
            type: 'amr_phenotype_genotype_concordance',
            id: `${input.ingestionEventId}:${input.genomicEventId}`,
            tenantId: input.actor.tenantId,
        },
        evidence: {
            route: 'api/amr/evidence-fabric',
            algorithm_version: AMR_CONCORDANCE_ALGORITHM_VERSION,
        },
    });
    if (!trustGate.ok) return trustGate.response;
    if (!hasMTLSWorkloadIdentity(input.actor)) {
        return NextResponse.json({
            error: 'mtls_bound_oauth_workload_required',
            request_id: input.requestId,
        }, { status: 403 });
    }

    const [ingestion, genomic] = await Promise.all([
        loadASTIngestion(input.supabase, input.actor.tenantId, input.ingestionEventId),
        loadGenomicEvent(input.supabase, input.actor.tenantId, input.genomicEventId),
    ]);
    const loadError = ingestion.error ?? genomic.error;
    if (loadError) return storageError(loadError, input.requestId);
    if (!ingestion.row || !genomic.row) {
        return NextResponse.json({
            error: 'evidence_lineage_not_found',
            request_id: input.requestId,
        }, { status: 404 });
    }
    const lineageBlockers = uniqueStrings([
        ...validateGenomicASTLineage({
            ingestion: ingestion.row,
            isolateRefHash: genomic.row.isolate_ref_hash ?? '',
            labSiteId: genomic.row.lab_site_id ?? '',
            oauthClientId: input.actor.oauthClientId ?? null,
            requireOAuthBinding: true,
        }),
        ...(genomic.row.oauth_client_id !== input.actor.oauthClientId
            ? ['genomic_connector_oauth_identity_mismatch']
            : []),
    ]);
    if (lineageBlockers.length > 0) {
        return NextResponse.json({
            error: 'amr_evidence_lineage_forbidden',
            blockers: lineageBlockers,
            request_id: input.requestId,
        }, { status: 403 });
    }
    const currentValidation = await resolvePipelineValidationByRef(
        input.supabase,
        input.actor.tenantId,
        genomic.row.pipeline_validation_ref,
    );
    if (currentValidation.error) {
        return storageError(currentValidation.error, input.requestId);
    }
    const genomicForConcordance: AMRGenomicEvidenceRow =
        currentValidation.assessment.externally_verified
            && currentValidation.assessment.external_validation_event_id
                === genomic.row.external_validation_event_id
            ? genomic.row
            : {
                ...genomic.row,
                clinical_use_allowed: false,
                clinical_blockers: uniqueStrings([
                    ...(genomic.row.clinical_blockers ?? []),
                    ...currentValidation.assessment.clinical_blockers,
                    'current_external_validation_required',
                ]),
            };

    const result = await materializeConcordanceRows({
        supabase: input.supabase,
        tenantId: input.actor.tenantId,
        actorId: input.actorId,
        materializationRequestId: input.materializationRequestId,
        ingestion: ingestion.row,
        genomic: genomicForConcordance,
    });
    if (result.error) return storageError(result.error, input.requestId);

    return NextResponse.json({
        materialized: result.materialized,
        cached: result.cached,
        concordance_events: result.rows,
        algorithm_version: AMR_CONCORDANCE_ALGORITHM_VERSION,
        clinical_decision_influence: false,
        request_id: input.requestId,
        error: null,
    });
}

async function materializeConcordanceRows(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    actorId: string;
    materializationRequestId: string;
    ingestion: AMRASTIngestionEvidenceRow;
    genomic: AMRGenomicEvidenceRow;
}) {
    const results = await loadASTResults(
        input.supabase,
        input.tenantId,
        input.ingestion.id,
    );
    if (results.error) {
        return {
            rows: [] as AMRConcordanceEventRow[],
            materialized: 0,
            cached: 0,
            error: results.error,
        };
    }
    const drafts = buildAMRConcordanceEvents({
        tenantId: input.tenantId,
        requestId: input.materializationRequestId,
        actorId: input.actorId,
        ingestion: input.ingestion,
        results: results.rows,
        genomic: input.genomic,
    });
    if (drafts.length === 0) {
        return {
            rows: [] as AMRConcordanceEventRow[],
            materialized: 0,
            cached: 0,
            error: 'No AST result rows are available for concordance.',
        };
    }

    const existing = await input.supabase
        .from('amr_phenotype_genotype_concordance_events')
        .select('*')
        .eq('tenant_id', input.tenantId)
        .eq('ast_ingestion_event_id', input.ingestion.id)
        .eq('genomic_event_id', input.genomic.id)
        .eq('algorithm_version', AMR_CONCORDANCE_ALGORITHM_VERSION)
        .limit(1_000);
    if (existing.error) {
        return {
            rows: [] as AMRConcordanceEventRow[],
            materialized: 0,
            cached: 0,
            error: existing.error.message,
        };
    }
    const existingRows = (existing.data ?? []) as AMRConcordanceEventRow[];
    const existingResultIds = new Set(
        existingRows.map((row) => row.ast_result_event_id),
    );
    const pending = drafts.filter(
        (draft) => !existingResultIds.has(draft.ast_result_event_id),
    );
    let insertedRows: AMRConcordanceEventRow[] = [];
    if (pending.length > 0) {
        const inserted = await input.supabase
            .from('amr_phenotype_genotype_concordance_events')
            .insert(pending)
            .select('*');
        if (inserted.error) {
            return {
                rows: existingRows,
                materialized: 0,
                cached: existingRows.length,
                error: inserted.error.message,
            };
        }
        insertedRows = (inserted.data ?? []) as AMRConcordanceEventRow[];
    }

    return {
        rows: [...existingRows, ...insertedRows],
        materialized: insertedRows.length,
        cached: existingRows.length,
        error: null as string | null,
    };
}

async function insertGenomicEvidence(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
    event: Record<string, unknown>,
) {
    const inserted = await supabase
        .from('amr_genomic_events')
        .insert(event)
        .select('*')
        .single();
    if (!inserted.error && inserted.data?.id) {
        return {
            row: inserted.data as AMRGenomicEvidenceRow,
            cached: false,
            error: null as string | null,
        };
    }
    if (inserted.error?.code !== '23505') {
        return {
            row: null,
            cached: false,
            error: inserted.error?.message ?? 'Genomic evidence insert failed.',
        };
    }
    const existing = await supabase
        .from('amr_genomic_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
    return {
        row: existing.data as AMRGenomicEvidenceRow | null,
        cached: Boolean(existing.data?.id),
        error: existing.error?.message
            ?? (existing.data?.id ? null : inserted.error.message),
    };
}

async function resolvePipelineValidation(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    packet: Pick<
        AMRGenomicEvidenceInput,
        'pipeline_name' | 'pipeline_version' | 'reference_database_versions'
    >,
) {
    return resolvePipelineValidationByRef(
        supabase,
        tenantId,
        buildAMRGenomicPipelineValidationRef(packet),
    );
}

async function resolvePipelineValidationByRef(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    targetRef: string | null | undefined,
) {
    if (!targetRef) {
        return {
            assessment: assessAMRGenomicPipelineValidation({
                targetRef: 'amr_genomic_pipeline:missing',
                event: null,
            }),
            error: null as string | null,
        };
    }
    const latest = await supabase
        .from('external_validation_events')
        .select(
            'id, validation_target_type, validation_target_ref, attestor_kind, '
            + 'validation_scope, attestation_status, verification_status, '
            + 'evidence_grade, validation_score, observed_at, created_at',
        )
        .eq('tenant_id', tenantId)
        .eq('validation_target_ref', targetRef)
        .order('observed_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    return {
        assessment: assessAMRGenomicPipelineValidation({
            targetRef,
            event: latest.data as AMRExternalValidationEvidenceRow | null,
        }),
        error: latest.error?.message ?? null,
    };
}

async function loadEvidenceFabricData(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
) {
    const [ingestions, results, genomicEvents, concordanceEvents] = await Promise.all([
        supabase.from('amr_ast_ingestion_events').select('*')
            .eq('tenant_id', tenantId).order('observed_at', { ascending: false }).limit(5_000),
        supabase.from('amr_ast_result_events').select('*')
            .eq('tenant_id', tenantId).order('observed_at', { ascending: false }).limit(25_000),
        supabase.from('amr_genomic_events').select('*')
            .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(5_000),
        supabase.from('amr_phenotype_genotype_concordance_events').select('*')
            .eq('tenant_id', tenantId).order('observed_at', { ascending: false }).limit(25_000),
    ]);
    return {
        ingestions: (ingestions.data ?? []) as AMRASTIngestionEvidenceRow[],
        results: (results.data ?? []) as AMRASTResultEvidenceRow[],
        genomicEvents: (genomicEvents.data ?? []) as AMRGenomicEvidenceRow[],
        concordanceEvents: (concordanceEvents.data ?? []) as AMRConcordanceEventRow[],
        error: ingestions.error?.message
            ?? results.error?.message
            ?? genomicEvents.error?.message
            ?? concordanceEvents.error?.message
            ?? null,
    };
}

async function loadASTIngestion(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    ingestionEventId: string,
) {
    const { data, error } = await supabase
        .from('amr_ast_ingestion_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', ingestionEventId)
        .maybeSingle();
    return {
        row: data as AMRASTIngestionEvidenceRow | null,
        error: error?.message ?? null,
    };
}

async function loadASTResults(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    ingestionEventId: string,
) {
    const { data, error } = await supabase
        .from('amr_ast_result_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('ingestion_event_id', ingestionEventId)
        .order('result_index', { ascending: true })
        .limit(1_000);
    return {
        rows: (data ?? []) as AMRASTResultEvidenceRow[],
        error: error?.message ?? null,
    };
}

async function loadGenomicEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    genomicEventId: string,
) {
    const { data, error } = await supabase
        .from('amr_genomic_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', genomicEventId)
        .maybeSingle();
    return {
        row: data as AMRGenomicEvidenceRow | null,
        error: error?.message ?? null,
    };
}

function validateGenomicASTLineage(input: {
    ingestion: AMRASTIngestionEvidenceRow | null;
    isolateRefHash: string;
    labSiteId: string;
    oauthClientId: string | null;
    requireOAuthBinding: boolean;
}): string[] {
    if (!input.ingestion) return ['accepted_ast_ingestion_not_found'];
    return uniqueStrings([
        ...(input.ingestion.ingestion_status !== 'accepted'
            ? ['accepted_ast_ingestion_required']
            : []),
        ...(input.ingestion.isolate_ref_hash !== input.isolateRefHash
            ? ['isolate_reference_mismatch']
            : []),
        ...(input.ingestion.lab_site_id !== input.labSiteId
            ? ['laboratory_site_mismatch']
            : []),
        ...(input.requireOAuthBinding
            && input.ingestion.oauth_client_id !== input.oauthClientId
            ? ['ast_connector_oauth_identity_mismatch']
            : []),
    ]);
}

function hasMTLSWorkloadIdentity(actor: ClinicalApiActor): boolean {
    return actor.authMode === 'oauth_client'
        && actor.tokenBindingMethod === 'mtls'
        && Boolean(actor.oauthClientId && actor.mtlsCertThumbprint);
}

function storageError(message: string, requestId: string) {
    const missingSchema = /relation .* does not exist|schema cache|could not find the table|column .* does not exist/i
        .test(message);
    return NextResponse.json({
        error: missingSchema
            ? 'amr_evidence_fabric_migration_required'
            : 'amr_evidence_fabric_storage_failed',
        detail: message,
        migration: missingSchema
            ? 'supabase/migrations/20260730010000_amr_evidence_fabric.sql'
            : undefined,
        request_id: requestId,
    }, { status: 503 });
}

function withHeaders(response: NextResponse, requestId: string, startTime: number) {
    response.headers.set('Cache-Control', 'private, no-store');
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(
        new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
    ).sort();
}
