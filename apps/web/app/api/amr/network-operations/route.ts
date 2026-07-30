import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
    buildAMRNetworkSiteSummaries,
    hashAMRNetworkJson,
    hashAMRNetworkValue,
    type AMRNetworkSiteEventRow,
} from '@/lib/amr/outcomeNetwork';
import {
    AMR_AST_SCHEMA_VERSION,
    AMR_CONNECTOR_PROBE_MAX_AGE_HOURS,
    buildAMRExchangeAgreementSummaries,
    buildAMRNetworkOperationsSnapshot,
    buildAMRUsageEvent,
    evaluateAMRConnectorProbe,
    prepareCanonicalAMRASTPacket,
    type AMRASTIngestionEventRow,
    type AMRASTReconciliationEventRow,
    type AMRConnectorProbeEventRow,
    type AMRExchangeAgreementEventRow,
    type AMRExchangeSettlementEventRow,
    type AMRExchangeUsageEventRow,
} from '@/lib/amr/networkOperations';
import { resolveClinicalApiActor, type ClinicalApiActor } from '@/lib/auth/machineAuth';
import { enforceVetiosClinicalActorGate } from '@/lib/auth/authTrustRouteGate';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const OptionalText = z.string().trim().min(1).max(256).optional();
const OptionalUuid = UuidSchema.optional();

const ASTResultSchema = z.object({
    antimicrobial_label: z.string().trim().min(1).max(160),
    antimicrobial_key: OptionalText,
    antimicrobial_code_system: OptionalText,
    antimicrobial_code: OptionalText,
    drug_class: OptionalText,
    measurement_type: z.enum(['mic', 'disk_diffusion', 'qualitative']),
    mic_value: z.number().nonnegative().optional(),
    mic_operator: z.enum(['<', '<=', '=', '>=', '>']).optional(),
    mic_unit: OptionalText,
    zone_diameter_mm: z.number().positive().max(1000).optional(),
    qualitative_result: OptionalText,
    interpretation: z.enum(['S', 'I', 'R', 'SDD', 'NS', 'IE', 'UNKNOWN']),
    breakpoint_value: z.number().nonnegative().optional(),
    breakpoint_unit: OptionalText,
    breakpoint_basis: z.string().trim().min(1).max(320).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();

const CanonicalASTPacketSchema = z.object({
    schema_version: z.literal(AMR_AST_SCHEMA_VERSION),
    source_system: z.string().trim().min(1).max(120),
    source_version: OptionalText,
    source_record_digest: Sha256Schema,
    isolate_ref: z.string().trim().min(1).max(256),
    patient_ref: z.string().trim().min(1).max(256).optional(),
    site_id: UuidSchema,
    lab_site_id: UuidSchema,
    connector_probe_event_id: UuidSchema,
    species: z.string().trim().min(1).max(80),
    breed: OptionalText,
    production_class: OptionalText,
    specimen_type: z.string().trim().min(1).max(120),
    anatomical_site: OptionalText,
    country_code: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
    admin_area: OptionalText,
    organism_label: z.string().trim().min(1).max(200),
    organism_key: OptionalText,
    organism_code_system: OptionalText,
    organism_code: OptionalText,
    culture_collected_at: z.string().datetime().optional(),
    observed_at: z.string().datetime(),
    ast_method: z.string().trim().min(1).max(120),
    interpretation_standard: z.string().trim().min(1).max(120),
    interpretation_standard_version: z.string().trim().min(1).max(80),
    qc_status: z.enum(['passed', 'warning', 'failed', 'not_reported']),
    deidentified: z.boolean().default(true),
    is_synthetic: z.boolean().default(false),
    results: z.array(ASTResultSchema).min(1).max(256),
    evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();

const RecordProbeSchema = z.object({
    action: z.literal('record_connector_probe'),
    request_id: UuidSchema,
    site_id: UuidSchema,
    connector_installation_id: OptionalUuid,
    probe_type: z.enum(['dry_run', 'schema_validation', 'production_probe', 'heartbeat']),
    source_system: z.string().trim().min(1).max(120),
    connector_version: z.string().trim().min(1).max(80),
    schema_version: z.literal(AMR_AST_SCHEMA_VERSION),
    observed_record_count: z.number().int().min(0).max(10_000_000),
    latency_ms: z.number().int().min(0).max(300_000).optional(),
    oldest_record_at: z.string().datetime().optional(),
    newest_record_at: z.string().datetime().optional(),
    request_digest: Sha256Schema,
    response_digest: Sha256Schema,
    evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();

const ValidateASTSchema = z.object({
    action: z.literal('validate_ast_packet'),
    request_id: UuidSchema,
    packet: CanonicalASTPacketSchema,
}).strict();

const IngestASTSchema = z.object({
    action: z.literal('ingest_ast_packet'),
    request_id: UuidSchema,
    connector_installation_id: OptionalUuid,
    packet: CanonicalASTPacketSchema,
}).strict();

const ReconcileASTSchema = z.object({
    action: z.literal('record_reconciliation_event'),
    request_id: UuidSchema,
    ingestion_event_id: UuidSchema,
    reconciliation_event: z.enum(['matched', 'unmatched', 'failed', 'requeued']),
    episode_id: OptionalUuid,
    case_id: OptionalUuid,
    amr_lab_feed_event_ids: z.array(UuidSchema).max(256).default([]),
    blocker_code: z.string().trim().min(1).max(160).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();

const PostSchema = z.discriminatedUnion('action', [
    RecordProbeSchema,
    ValidateASTSchema,
    IngestASTSchema,
    ReconcileASTSchema,
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
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 }),
            requestId,
            startTime,
        );
    }

    const loaded = await loadOperationsData(supabase, auth.actor.tenantId);
    if (loaded.error) {
        return withHeaders(storageError(loaded.error, requestId), requestId, startTime);
    }
    const snapshot = buildAMRNetworkOperationsSnapshot(loaded);
    return withHeaders(
        NextResponse.json({
            snapshot,
            privacy: {
                raw_lab_reports_stored: false,
                direct_identifiers_stored: false,
                source_references_hashed: true,
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
    const requiredScopes = parsed.data.action === 'record_reconciliation_event'
        ? ['outcome:write'] as const
        : parsed.data.action === 'validate_ast_packet'
            ? ['amr:read'] as const
            : ['amr:ingest'] as const;
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes,
    });
    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 }),
            requestId,
            startTime,
        );
    }
    const actorId = auth.actor.userId
        ?? auth.actor.principalLabel
        ?? auth.actor.oauthClientId
        ?? 'machine_actor';

    let response: NextResponse;
    if (parsed.data.action === 'record_connector_probe') {
        response = await recordConnectorProbe({
            supabase,
            actor: auth.actor,
            actorId,
            requestId,
            body: parsed.data,
        });
    } else if (parsed.data.action === 'validate_ast_packet') {
        const prepared = prepareCanonicalAMRASTPacket({
            tenantId: auth.actor.tenantId,
            requestId: parsed.data.request_id,
            actorId,
            connectorInstallationId: auth.actor.connectorInstallation?.id ?? null,
            oauthClientId: auth.actor.oauthClientId ?? null,
            packet: parsed.data.packet,
        });
        response = NextResponse.json({
            mode: 'dry_run',
            accepted: prepared.accepted,
            blockers: prepared.blockers,
            warnings: prepared.warnings,
            canonical_packet_hash: prepared.canonical_packet_hash,
            normalized_result_count: prepared.results.length,
            persisted: false,
            request_id: requestId,
            error: null,
        });
    } else if (parsed.data.action === 'ingest_ast_packet') {
        response = await ingestASTPacket({
            supabase,
            actor: auth.actor,
            actorId,
            requestId,
            body: parsed.data,
        });
    } else {
        response = await recordReconciliationEvent({
            supabase,
            actor: auth.actor,
            actorId,
            requestId,
            body: parsed.data,
        });
    }

    return withHeaders(response, requestId, startTime);
}

async function recordConnectorProbe(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    actor: ClinicalApiActor;
    actorId: string;
    requestId: string;
    body: z.infer<typeof RecordProbeSchema>;
}) {
    const trustGate = await enforceVetiosClinicalActorGate({
        client: input.supabase as unknown as Parameters<typeof enforceVetiosClinicalActorGate>[0]['client'],
        requestId: input.requestId,
        actor: input.actor,
        actionKey: 'amr.connector.probe',
        resource: {
            type: 'amr_connector_probe',
            id: input.body.site_id,
            tenantId: input.actor.tenantId,
        },
        evidence: {
            route: 'api/amr/network-operations',
            probe_type: input.body.probe_type,
            connector_installation_id: input.body.connector_installation_id ?? null,
        },
    });
    if (!trustGate.ok) return trustGate.response;

    const siteEvents = await loadSiteEvents(
        input.supabase,
        input.actor.tenantId,
        input.body.site_id,
    );
    if (siteEvents.error) return storageError(siteEvents.error, input.requestId);
    const site = buildAMRNetworkSiteSummaries(siteEvents.rows)[0] ?? null;
    if (!site) {
        return NextResponse.json({ error: 'site_invitation_required' }, { status: 409 });
    }

    const evaluation = evaluateAMRConnectorProbe({
        probeType: input.body.probe_type,
        tokenBindingMethod: resolveTokenBinding(input.actor),
        oauthClientId: input.actor.oauthClientId ?? null,
        certificateThumbprint: input.actor.mtlsCertThumbprint ?? null,
        sourceSystem: input.body.source_system,
        connectorVersion: input.body.connector_version,
        schemaVersion: input.body.schema_version,
        observedRecordCount: input.body.observed_record_count,
        latencyMs: input.body.latency_ms,
        oldestRecordAt: input.body.oldest_record_at,
        newestRecordAt: input.body.newest_record_at,
        requestDigest: input.body.request_digest,
        responseDigest: input.body.response_digest,
    });
    const readinessBlockers = [
        ...(!site.enrolled ? ['site_enrollment_incomplete'] : []),
        ...(!site.data_use_approved ? ['data_use_approval_missing'] : []),
    ];
    const blockers = uniqueStrings([...evaluation.blockers, ...readinessBlockers]);
    const productionVerified = evaluation.production_verified && blockers.length === 0;
    const probeStatus = blockers.length > 0 ? 'blocked' : evaluation.status;
    const event = {
        tenant_id: input.actor.tenantId,
        request_id: input.body.request_id,
        site_id: input.body.site_id,
        connector_installation_id: input.body.connector_installation_id
            ?? input.actor.connectorInstallation?.id
            ?? null,
        oauth_client_id: input.actor.oauthClientId ?? null,
        api_credential_id: input.actor.credentialId,
        probe_type: input.body.probe_type,
        probe_status: probeStatus,
        token_binding_method: resolveTokenBinding(input.actor),
        certificate_thumbprint_hash: evaluation.certificate_thumbprint_hash,
        source_system: input.body.source_system.trim(),
        connector_version: input.body.connector_version.trim(),
        schema_version: input.body.schema_version,
        observed_record_count: input.body.observed_record_count,
        latency_ms: input.body.latency_ms ?? null,
        oldest_record_at: input.body.oldest_record_at ?? null,
        newest_record_at: input.body.newest_record_at ?? null,
        request_digest: input.body.request_digest,
        response_digest: input.body.response_digest,
        receipt_hash: hashAMRNetworkJson({
            evaluation_receipt_hash: evaluation.receipt_hash,
            site_id: input.body.site_id,
            blockers,
        }),
        blockers,
        warnings: evaluation.warnings,
        evidence: {
            ...(input.body.evidence ?? {}),
            production_verified: productionVerified,
            auth_mode: input.actor.authMode,
            assurance_level: input.actor.assuranceLevel,
            oauth_access_token_id: input.actor.oauthAccessTokenId ?? null,
            raw_certificate_stored: false,
        },
    };
    const inserted = await insertIdempotent(
        input.supabase,
        'amr_connector_probe_events',
        input.actor.tenantId,
        input.body.request_id,
        event,
    );
    if (inserted.error) return storageError(inserted.error, input.requestId);

    let siteEventId: string | null = null;
    if (!inserted.cached && (input.body.probe_type === 'production_probe' || input.body.probe_type === 'heartbeat')) {
        const siteEventType = productionVerified ? 'connector_verified' : 'connector_failed';
        const siteEvent = {
            tenant_id: input.actor.tenantId,
            request_id: randomUUID(),
            site_id: input.body.site_id,
            site_type: site.site_type,
            event_type: siteEventType,
            display_label: site.display_label,
            site_ref_hash: null,
            connector_key: input.body.source_system,
            actor_id: input.actorId,
            evidence: {
                attestation_status: productionVerified ? 'verified' : 'failed',
                attestation_event_id: inserted.id,
                token_binding_method: resolveTokenBinding(input.actor),
                certificate_thumbprint_hash: evaluation.certificate_thumbprint_hash,
                connector_version: input.body.connector_version,
                schema_version: input.body.schema_version,
                observed_record_count: input.body.observed_record_count,
                receipt_hash: event.receipt_hash,
                blockers,
            },
            occurred_at: new Date().toISOString(),
        };
        const { data, error } = await input.supabase
            .from('amr_network_site_events')
            .insert({ ...siteEvent, event_hash: hashAMRNetworkJson(siteEvent) })
            .select('id')
            .single();
        if (error) return storageError(error.message, input.requestId);
        siteEventId = String(data.id);
    }

    return NextResponse.json({
        connector_probe_event_id: inserted.id,
        site_event_id: siteEventId,
        probe_status: probeStatus,
        production_verified: productionVerified,
        blockers,
        warnings: evaluation.warnings,
        receipt_hash: event.receipt_hash,
        cached: inserted.cached,
        request_id: input.requestId,
        error: null,
    }, { status: probeStatus === 'passed' ? 200 : 422 });
}

async function ingestASTPacket(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    actor: ClinicalApiActor;
    actorId: string;
    requestId: string;
    body: z.infer<typeof IngestASTSchema>;
}) {
    const trustGate = await enforceVetiosClinicalActorGate({
        client: input.supabase as unknown as Parameters<typeof enforceVetiosClinicalActorGate>[0]['client'],
        requestId: input.requestId,
        actor: input.actor,
        actionKey: 'amr.ast.ingest',
        resource: {
            type: 'amr_ast_packet',
            id: input.body.packet.source_record_digest,
            tenantId: input.actor.tenantId,
        },
        evidence: {
            route: 'api/amr/network-operations',
            lab_site_id: input.body.packet.lab_site_id,
            schema_version: input.body.packet.schema_version,
        },
    });
    if (!trustGate.ok) return trustGate.response;
    if (
        input.actor.authMode !== 'oauth_client'
        || input.actor.tokenBindingMethod !== 'mtls'
        || !input.actor.mtlsCertThumbprint
    ) {
        return NextResponse.json({
            error: 'mtls_bound_oauth_workload_required',
            request_id: input.requestId,
        }, { status: 403 });
    }

    const probe = await loadProbe(
        input.supabase,
        input.actor.tenantId,
        input.body.packet.connector_probe_event_id,
    );
    if (probe.error) return storageError(probe.error, input.requestId);
    if (
        !probe.row
        || probe.row.site_id !== input.body.packet.lab_site_id
        || probe.row.oauth_client_id !== input.actor.oauthClientId
        || probe.row.probe_status !== 'passed'
        || !['production_probe', 'heartbeat'].includes(probe.row.probe_type)
        || probe.row.token_binding_method !== 'mtls'
        || probe.row.certificate_thumbprint_hash
            !== hashAMRNetworkValue(input.actor.mtlsCertThumbprint)
        || !isFreshProbe(probe.row)
    ) {
        return NextResponse.json({
            error: 'active_mtls_connector_probe_required',
            request_id: input.requestId,
        }, { status: 409 });
    }

    const siteRows = await loadTenantSiteEvents(input.supabase, input.actor.tenantId);
    if (siteRows.error) return storageError(siteRows.error, input.requestId);
    const sites = buildAMRNetworkSiteSummaries(siteRows.rows);
    const clinic = sites.find((site) => site.site_id === input.body.packet.site_id);
    const lab = sites.find((site) => site.site_id === input.body.packet.lab_site_id);
    const networkBlockers = uniqueStrings([
        ...(clinic?.site_type !== 'clinic' ? ['tenant_clinic_site_required'] : []),
        ...(!clinic?.enrolled ? ['clinic_enrollment_required'] : []),
        ...(!clinic?.data_use_approved ? ['clinic_data_use_approval_required'] : []),
        ...(lab?.site_type !== 'laboratory' ? ['tenant_laboratory_site_required'] : []),
        ...(!lab?.operational ? ['operational_laboratory_required'] : []),
    ]);

    const prepared = prepareCanonicalAMRASTPacket({
        tenantId: input.actor.tenantId,
        requestId: input.body.request_id,
        actorId: input.actorId,
        connectorInstallationId: input.body.connector_installation_id ?? null,
        oauthClientId: input.actor.oauthClientId ?? null,
        packet: input.body.packet,
    });
    if (networkBlockers.length > 0) {
        prepared.accepted = false;
        prepared.blockers = uniqueStrings([...prepared.blockers, ...networkBlockers]);
        prepared.ingestion.ingestion_status = 'blocked';
        prepared.ingestion.blockers = prepared.blockers;
        prepared.results = [];
        prepared.surveillance_events = [];
    }

    const { data, error } = await input.supabase.rpc('ingest_amr_ast_packet_v1', {
        p_ingestion: prepared.ingestion,
        p_results: prepared.results,
        p_surveillance_events: prepared.surveillance_events,
    });
    if (error) return storageError(error.message, input.requestId);
    const result = asRecord(data);
    const ingestionEventId = readText(result.ingestion_event_id);
    if (!ingestionEventId) {
        return storageError('AMR AST ingestion RPC did not return an event ID.', input.requestId);
    }

    const metering = prepared.accepted
        ? await meterASTIngestion({
            supabase: input.supabase,
            tenantId: input.actor.tenantId,
            ingestionEventId,
            labSiteId: input.body.packet.lab_site_id,
            sourceDigest: prepared.source_record_digest,
            requestId: deterministicUuid(`usage:${input.body.request_id}`),
        })
        : { usageEventId: null, error: null };

    return NextResponse.json({
        accepted: prepared.accepted,
        ingestion_event_id: ingestionEventId,
        reconciliation_event_id: readText(result.reconciliation_event_id),
        lab_feed_event_ids: Array.isArray(result.lab_feed_event_ids)
            ? result.lab_feed_event_ids
            : [],
        usage_event_id: metering.usageEventId,
        metering_warning: metering.error,
        blockers: prepared.blockers,
        warnings: prepared.warnings,
        canonical_packet_hash: prepared.canonical_packet_hash,
        raw_payload_stored: false,
        cached: result.cached === true,
        request_id: input.requestId,
        error: null,
    }, { status: prepared.accepted ? 200 : 422 });
}

async function recordReconciliationEvent(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    actor: ClinicalApiActor;
    actorId: string;
    requestId: string;
    body: z.infer<typeof ReconcileASTSchema>;
}) {
    const trustGate = await enforceVetiosClinicalActorGate({
        client: input.supabase as unknown as Parameters<typeof enforceVetiosClinicalActorGate>[0]['client'],
        requestId: input.requestId,
        actor: input.actor,
        actionKey: 'amr.reconciliation.write',
        resource: {
            type: 'amr_ast_reconciliation',
            id: input.body.ingestion_event_id,
            tenantId: input.actor.tenantId,
        },
        evidence: {
            route: 'api/amr/network-operations',
            reconciliation_event: input.body.reconciliation_event,
        },
    });
    if (!trustGate.ok) return trustGate.response;

    const { data: ingestion, error: ingestionError } = await input.supabase
        .from('amr_ast_ingestion_events')
        .select('id, ingestion_status')
        .eq('tenant_id', input.actor.tenantId)
        .eq('id', input.body.ingestion_event_id)
        .maybeSingle();
    if (ingestionError) return storageError(ingestionError.message, input.requestId);
    if (!ingestion) {
        return NextResponse.json({ error: 'ast_ingestion_not_found' }, { status: 404 });
    }
    if (input.body.reconciliation_event === 'matched' && !input.body.episode_id && !input.body.case_id) {
        return NextResponse.json({
            error: 'matched_reconciliation_requires_episode_or_case',
        }, { status: 400 });
    }
    if (
        ['unmatched', 'failed'].includes(input.body.reconciliation_event)
        && !input.body.blocker_code
    ) {
        return NextResponse.json({
            error: 'reconciliation_blocker_code_required',
        }, { status: 400 });
    }

    const { data: priorRows, error: priorError } = await input.supabase
        .from('amr_ast_reconciliation_events')
        .select('attempt_no, reconciliation_event')
        .eq('tenant_id', input.actor.tenantId)
        .eq('ingestion_event_id', input.body.ingestion_event_id)
        .order('occurred_at', { ascending: false })
        .limit(1);
    if (priorError) return storageError(priorError.message, input.requestId);
    const prior = Array.isArray(priorRows) ? priorRows[0] : null;
    if (prior?.reconciliation_event === 'matched') {
        return NextResponse.json({
            error: 'matched_reconciliation_is_terminal',
        }, { status: 409 });
    }
    const attemptNo = Math.max(1, Number(prior?.attempt_no ?? 0) + 1);
    const event = {
        tenant_id: input.actor.tenantId,
        request_id: input.body.request_id,
        ingestion_event_id: input.body.ingestion_event_id,
        reconciliation_event: input.body.reconciliation_event,
        episode_id: input.body.episode_id ?? null,
        case_id: input.body.case_id ?? null,
        amr_lab_feed_event_ids: input.body.amr_lab_feed_event_ids,
        blocker_code: input.body.blocker_code ?? null,
        attempt_no: attemptNo,
        evidence: input.body.evidence ?? {},
        actor_id: input.actorId,
        occurred_at: new Date().toISOString(),
    };
    const inserted = await insertIdempotent(
        input.supabase,
        'amr_ast_reconciliation_events',
        input.actor.tenantId,
        input.body.request_id,
        { ...event, event_hash: hashAMRNetworkJson(event) },
    );
    if (inserted.error) return storageError(inserted.error, input.requestId);

    return NextResponse.json({
        reconciliation_event_id: inserted.id,
        ingestion_event_id: input.body.ingestion_event_id,
        reconciliation_event: input.body.reconciliation_event,
        attempt_no: attemptNo,
        cached: inserted.cached,
        request_id: input.requestId,
        error: null,
    });
}

async function meterASTIngestion(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    ingestionEventId: string;
    labSiteId: string;
    sourceDigest: string;
    requestId: string;
}): Promise<{ usageEventId: string | null; error: string | null }> {
    const { data, error } = await input.supabase
        .from('amr_exchange_agreement_events')
        .select('*')
        .eq('tenant_id', input.tenantId)
        .eq('product_key', 'amr.culture_ast.normalized.v1')
        .order('occurred_at', { ascending: true })
        .limit(10_000);
    if (error) return { usageEventId: null, error: error.message };
    const agreement = buildAMRExchangeAgreementSummaries(
        (data ?? []) as AMRExchangeAgreementEventRow[],
    ).find((candidate) => (
        candidate.active
        && (!candidate.provider_site_id || candidate.provider_site_id === input.labSiteId)
    ));
    if (!agreement) return { usageEventId: null, error: 'active_ast_exchange_agreement_missing' };

    const usage = buildAMRUsageEvent({
        tenantId: input.tenantId,
        requestId: input.requestId,
        agreement,
        sourceType: 'ast_ingestion',
        sourceEventId: input.ingestionEventId,
        sourceDigest: input.sourceDigest,
        evidence: {
            automatic_metering: true,
            raw_clinical_record_stored: false,
        },
    });
    const inserted = await insertIdempotent(
        input.supabase,
        'amr_exchange_usage_events',
        input.tenantId,
        input.requestId,
        usage,
    );
    return {
        usageEventId: inserted.id,
        error: inserted.error,
    };
}

async function loadOperationsData(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
): Promise<{
    connectorProbes: AMRConnectorProbeEventRow[];
    ingestionEvents: AMRASTIngestionEventRow[];
    reconciliationEvents: AMRASTReconciliationEventRow[];
    agreementEvents: AMRExchangeAgreementEventRow[];
    usageEvents: AMRExchangeUsageEventRow[];
    settlementEvents: AMRExchangeSettlementEventRow[];
    error: string | null;
}> {
    const [
        probes,
        ingestions,
        reconciliations,
        agreements,
        usage,
        settlements,
    ] = await Promise.all([
        supabase.from('amr_connector_probe_events').select('*')
            .eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(10_000),
        supabase.from('amr_ast_ingestion_events').select('*')
            .eq('tenant_id', tenantId).order('observed_at', { ascending: false }).limit(20_000),
        supabase.from('amr_ast_reconciliation_events').select('*')
            .eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(50_000),
        supabase.from('amr_exchange_agreement_events').select('*')
            .eq('tenant_id', tenantId).order('occurred_at', { ascending: true }).limit(10_000),
        supabase.from('amr_exchange_usage_events').select('*')
            .eq('tenant_id', tenantId).order('metered_at', { ascending: false }).limit(50_000),
        supabase.from('amr_exchange_settlement_events').select('*')
            .eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(10_000),
    ]);
    return {
        connectorProbes: (probes.data ?? []) as AMRConnectorProbeEventRow[],
        ingestionEvents: (ingestions.data ?? []) as AMRASTIngestionEventRow[],
        reconciliationEvents: (reconciliations.data ?? []) as AMRASTReconciliationEventRow[],
        agreementEvents: (agreements.data ?? []) as AMRExchangeAgreementEventRow[],
        usageEvents: (usage.data ?? []) as AMRExchangeUsageEventRow[],
        settlementEvents: (settlements.data ?? []) as AMRExchangeSettlementEventRow[],
        error: probes.error?.message
            ?? ingestions.error?.message
            ?? reconciliations.error?.message
            ?? agreements.error?.message
            ?? usage.error?.message
            ?? settlements.error?.message
            ?? null,
    };
}

async function loadTenantSiteEvents(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
) {
    const { data, error } = await supabase
        .from('amr_network_site_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('occurred_at', { ascending: true })
        .limit(10_000);
    return {
        rows: (data ?? []) as AMRNetworkSiteEventRow[],
        error: error?.message ?? null,
    };
}

async function loadSiteEvents(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    siteId: string,
) {
    const { data, error } = await supabase
        .from('amr_network_site_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('site_id', siteId)
        .order('occurred_at', { ascending: true })
        .limit(1_000);
    return {
        rows: (data ?? []) as AMRNetworkSiteEventRow[],
        error: error?.message ?? null,
    };
}

async function loadProbe(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    probeId: string,
) {
    const { data, error } = await supabase
        .from('amr_connector_probe_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', probeId)
        .maybeSingle();
    return {
        row: data as AMRConnectorProbeEventRow | null,
        error: error?.message ?? null,
    };
}

async function insertIdempotent(
    supabase: ReturnType<typeof getSupabaseServer>,
    table: string,
    tenantId: string,
    requestId: string,
    payload: Record<string, unknown>,
): Promise<{ id: string | null; cached: boolean; error: string | null }> {
    const { data, error } = await supabase
        .from(table)
        .insert(payload)
        .select('id')
        .single();
    if (!error && data?.id) {
        return { id: String(data.id), cached: false, error: null };
    }
    if (error?.code !== '23505') {
        return { id: null, cached: false, error: error?.message ?? 'Insert failed.' };
    }
    const { data: existing, error: existingError } = await supabase
        .from(table)
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
    return {
        id: existing?.id ? String(existing.id) : null,
        cached: Boolean(existing?.id),
        error: existingError?.message ?? (existing?.id ? null : error.message),
    };
}

function resolveTokenBinding(actor: ClinicalApiActor): 'session' | 'api_key' | 'dpop' | 'mtls' {
    if (actor.tokenBindingMethod === 'mtls') return 'mtls';
    if (actor.tokenBindingMethod === 'dpop') return 'dpop';
    if (actor.authMode === 'connector_installation' || actor.authMode === 'service_account') {
        return 'api_key';
    }
    return 'session';
}

function storageError(message: string, requestId: string) {
    const missingSchema = /relation .* does not exist|schema cache|could not find the table/i.test(message);
    return NextResponse.json({
        error: missingSchema
            ? 'amr_network_operations_migration_required'
            : 'amr_network_operations_storage_failed',
        detail: message,
        migration: missingSchema
            ? 'supabase/migrations/20260730000000_amr_network_operations_exchange.sql'
            : undefined,
        request_id: requestId,
    }, { status: 503 });
}

function withHeaders(response: NextResponse, requestId: string, startTime: number) {
    response.headers.set('Cache-Control', 'private, no-store');
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean))).sort();
}

function deterministicUuid(value: string): string {
    const hash = hashAMRNetworkJson(value);
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        `4${hash.slice(13, 16)}`,
        `8${hash.slice(17, 20)}`,
        hash.slice(20, 32),
    ].join('-');
}

function isFreshProbe(probe: AMRConnectorProbeEventRow): boolean {
    const timestamp = Date.parse(probe.occurred_at ?? probe.created_at ?? '');
    if (!Number.isFinite(timestamp)) return false;
    const ageMs = Date.now() - timestamp;
    return ageMs >= 0
        && ageMs <= AMR_CONNECTOR_PROBE_MAX_AGE_HOURS * 60 * 60 * 1_000;
}
