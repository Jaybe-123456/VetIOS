import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
    buildEvidenceNodeCompatibilityExport,
    buildEvidenceNodeContractSummaries,
    buildEvidenceNodeOperationsSnapshot,
    type EvidenceNodeClosureTaskRow,
    type EvidenceNodeContractEventRow,
    type EvidenceNodeExportEventRow,
    type EvidenceNodeIdentityLinkRow,
    type EvidenceNodeIngestionProjectionRow,
    type EvidenceNodeReceiptRow,
    type EvidenceNodeResultProjectionRow,
} from '@/lib/amr/evidenceNode';
import {
    buildAMRNetworkSiteSummaries,
    hashAMRNetworkJson,
    hashAMRNetworkValue,
    type AMRNetworkSiteEventRow,
} from '@/lib/amr/outcomeNetwork';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { enforceVetiosClinicalActorGate } from '@/lib/auth/authTrustRouteGate';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const OptionalText = z.string().trim().min(1).max(512).optional();

const ContractSchema = z.object({
    action: z.literal('record_adapter_contract_event'),
    request_id: UuidSchema,
    contract_id: UuidSchema.optional(),
    event_type: z.enum(['drafted', 'approved', 'activated', 'suspended', 'revoked', 'expired']),
    adapter_key: OptionalText,
    contract_version: z.string().trim().min(1).max(80).optional(),
    mapping_version: z.string().trim().min(1).max(80).optional(),
    mapping_hash: Sha256Schema.optional(),
    reference_key_id: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/).optional(),
    clinic_site_id: UuidSchema.optional(),
    lab_site_id: UuidSchema.optional(),
    oauth_client_id: UuidSchema.optional(),
    mtls_cert_thumbprint: Sha256Schema.optional(),
    source_system: z.string().trim().min(1).max(120).optional(),
    source_version: z.string().trim().min(1).max(80).optional(),
    permitted_transports: z.array(z.enum(['webhook', 'api_poll', 'sftp', 'file_drop'])).min(1).max(4).optional(),
    permitted_formats: z.array(z.enum([
        'vetios_ast_json_v1',
        'hl7_v2_oru_r01',
        'fhir_r4_bundle',
        'rfc4180_csv',
    ])).min(1).max(4).optional(),
    writeback_permitted: z.boolean().optional(),
    closure_destination_channel: z.enum([
        'pims_writeback',
        'lis_writeback',
        'signed_webhook',
        'manual_work_queue',
    ]).optional(),
    purpose: OptionalText,
    terms_hash: Sha256Schema.optional(),
    data_use_agreement_hash: Sha256Schema.optional(),
    consent_basis: OptionalText,
    deidentification_profile: OptionalText,
    effective_at: z.string().datetime().optional(),
    expires_at: z.string().datetime().optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();

const ClosureSchema = z.object({
    action: z.literal('record_closure_task_event'),
    request_id: UuidSchema,
    task_id: UuidSchema,
    event_type: z.enum(['dispatched', 'acknowledged', 'completed', 'cancelled', 'failed']),
    destination_ref: OptionalText,
    case_id: UuidSchema.optional(),
    patient_episode_id: UuidSchema.optional(),
    inference_event_id: UuidSchema.optional(),
    clinical_outcome_id: UuidSchema.optional(),
    amr_stewardship_event_id: UuidSchema.optional(),
    outcome_status: z.enum(['improved', 'resolved', 'unchanged', 'worsened', 'relapsed', 'adverse_event', 'unknown']).optional(),
    consent_status: z.enum(['pending', 'approved', 'declined', 'revoked']).optional(),
    treatment_strategy: z.enum([
        'empiric',
        'culture_directed',
        'de_escalated',
        'supportive_only',
        'no_antimicrobial',
    ]).optional(),
    followup_days: z.number().int().min(0).max(3_650).optional(),
    reviewer_ref: OptionalText,
    writeback_receipt_hash: Sha256Schema.optional(),
    blocker_code: z.string().trim().min(1).max(160).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();

const GenerateExportSchema = z.object({
    action: z.literal('generate_compatibility_export'),
    request_id: UuidSchema,
    export_id: UuidSchema.optional(),
    profile: z.enum(['infarm_compat_v1', 'nahln_compat_v1', 'kabs_compat_v1']),
    ingestion_event_ids: z.array(UuidSchema).min(1).max(500),
}).strict();

const ExportStateSchema = z.object({
    action: z.literal('record_export_state'),
    request_id: UuidSchema,
    export_id: UuidSchema,
    event_type: z.enum(['validated', 'delivered', 'accepted', 'rejected']),
    acceptance_receipt_hash: Sha256Schema.optional(),
    blocker_code: z.string().trim().min(1).max(160).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();

const PostSchema = z.discriminatedUnion('action', [
    ContractSchema,
    ClosureSchema,
    GenerateExportSchema,
    ExportStateSchema,
]);

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['amr:read'] });
    if (auth.error || !auth.actor) {
        return withHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), requestId, startTime);
    }
    const loaded = await loadEvidenceNodeData(supabase, auth.actor.tenantId);
    if (loaded.error) return withHeaders(storageError(loaded.error), requestId, startTime);
    return withHeaders(NextResponse.json({
        snapshot: buildEvidenceNodeOperationsSnapshot(loaded),
        recent: {
            receipts: loaded.receipts.slice(0, 100),
            identity_links: loaded.identityLinks.slice(0, 100),
            closure_tasks: loaded.closureTasks.slice(0, 100),
            exports: loaded.exports.slice(0, 100),
        },
        execution_boundary: {
            raw_laboratory_payloads_stored: false,
            direct_identifiers_stored: false,
            proprietary_breakpoint_tables_embedded: false,
            compatibility_export_is_official_acceptance: false,
            partner_specific_vendor_writeback_transport_active: false,
            vendor_writeback_requires_signed_contract_and_receiver_adapter: true,
            external_receiver_schema_certification_inferred: false,
        },
        request_id: requestId,
        error: null,
    }), requestId, startTime);
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;
    const parsed = PostSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return withHeaders(NextResponse.json({
            error: 'invalid_input',
            detail: parsed.error.flatten(),
        }, { status: 400 }), requestId, startTime);
    }
    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['amr:read'] });
    if (auth.error || !auth.actor) {
        return withHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), requestId, startTime);
    }
    if (auth.actor.authMode !== 'session' || !auth.actor.userId) {
        return withHeaders(NextResponse.json({
            error: 'interactive_session_required',
        }, { status: 403 }), requestId, startTime);
    }
    const contractAdmin = ['admin', 'system_admin'].includes(auth.actor.role ?? '');
    const clinicalOperator = contractAdmin || auth.actor.role === 'clinician';
    if (parsed.data.action === 'record_adapter_contract_event' && !contractAdmin) {
        return withHeaders(NextResponse.json({ error: 'admin_role_required' }, { status: 403 }), requestId, startTime);
    }
    if (parsed.data.action !== 'record_adapter_contract_event' && !clinicalOperator) {
        return withHeaders(NextResponse.json({ error: 'clinical_operator_role_required' }, { status: 403 }), requestId, startTime);
    }
    const actionKey = parsed.data.action === 'record_adapter_contract_event'
        ? 'amr.evidence_node.contract.write'
        : parsed.data.action === 'record_closure_task_event'
            ? 'amr.evidence_node.closure.write'
            : 'amr.evidence_node.export.write';
    const resourceId = parsed.data.action === 'record_adapter_contract_event'
        ? parsed.data.contract_id ?? parsed.data.request_id
        : parsed.data.action === 'record_closure_task_event'
            ? parsed.data.task_id
            : parsed.data.export_id ?? parsed.data.request_id;
    const trustGate = await enforceVetiosClinicalActorGate({
        client: supabase as unknown as Parameters<typeof enforceVetiosClinicalActorGate>[0]['client'],
        requestId,
        actor: auth.actor,
        actionKey,
        resource: { type: 'amr_evidence_node', id: resourceId, tenantId: auth.actor.tenantId },
        evidence: { route: 'api/amr/evidence-node', operation: parsed.data.action },
    });
    if (!trustGate.ok) return withHeaders(trustGate.response, requestId, startTime);

    const actorId = auth.actor.userId;
    let response: NextResponse;
    if (parsed.data.action === 'record_adapter_contract_event') {
        response = await recordContractEvent(supabase, auth.actor.tenantId, actorId, parsed.data);
    } else if (parsed.data.action === 'record_closure_task_event') {
        response = await recordClosureEvent(supabase, auth.actor.tenantId, actorId, parsed.data);
    } else if (parsed.data.action === 'generate_compatibility_export') {
        response = await generateExport(supabase, auth.actor.tenantId, actorId, parsed.data);
    } else {
        response = await recordExportState(supabase, auth.actor.tenantId, actorId, parsed.data);
    }
    return withHeaders(response, requestId, startTime);
}

async function recordContractEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    actorId: string,
    body: z.infer<typeof ContractSchema>,
) {
    const replay = await loadIdempotentEvent(
        supabase,
        'evidence_node_adapter_contract_events',
        tenantId,
        body.request_id,
    );
    if (replay.error) return storageError(replay.error);
    if (replay.row) {
        if (
            replay.row.event_type !== body.event_type
            || (body.contract_id && replay.row.contract_id !== body.contract_id)
        ) {
            return idempotencyConflict();
        }
        return NextResponse.json({
            contract_id: replay.row.contract_id,
            contract_event_id: replay.row.id,
            event_type: replay.row.event_type,
            active: replay.row.event_type === 'activated',
            cached: true,
            error: null,
        });
    }
    const contractId = body.contract_id
        ?? deterministicUuid(`evidence-contract:${tenantId}:${body.request_id}`);
    const { data: priorData, error: priorError } = await supabase
        .from('evidence_node_adapter_contract_events').select('*')
        .eq('tenant_id', tenantId).eq('contract_id', contractId)
        .order('occurred_at', { ascending: true }).limit(100);
    if (priorError) return storageError(priorError.message);
    const priorRows = (priorData ?? []) as EvidenceNodeContractEventRow[];
    const previous = priorRows.at(-1) ?? null;
    const transitionError = validateContractTransition(previous?.event_type ?? null, body.event_type);
    if (transitionError) return NextResponse.json({ error: transitionError }, { status: 409 });
    const facts = {
        adapter_key: body.adapter_key ?? previous?.adapter_key,
        contract_version: body.contract_version ?? previous?.contract_version,
        mapping_version: body.mapping_version ?? previous?.mapping_version,
        mapping_hash: body.mapping_hash ?? previous?.mapping_hash,
        reference_key_id: body.reference_key_id ?? previous?.reference_key_id,
        clinic_site_id: body.clinic_site_id ?? previous?.clinic_site_id,
        lab_site_id: body.lab_site_id ?? previous?.lab_site_id,
        oauth_client_id: body.oauth_client_id ?? previous?.oauth_client_id,
        mtls_cert_thumbprint_hash: body.mtls_cert_thumbprint
            ? hashAMRNetworkValue(body.mtls_cert_thumbprint.toLowerCase())
            : previous?.mtls_cert_thumbprint_hash,
        source_system: body.source_system ?? previous?.source_system,
        source_version: body.source_version ?? previous?.source_version ?? null,
        permitted_transports: body.permitted_transports ?? previous?.permitted_transports,
        permitted_formats: body.permitted_formats ?? previous?.permitted_formats,
        writeback_permitted: body.writeback_permitted ?? previous?.writeback_permitted ?? false,
        closure_destination_channel: body.closure_destination_channel
            ?? previous?.closure_destination_channel
            ?? 'manual_work_queue',
        purpose: body.purpose ?? previous?.purpose,
        terms_hash: body.terms_hash ?? previous?.terms_hash,
        data_use_agreement_hash: body.data_use_agreement_hash ?? previous?.data_use_agreement_hash,
        consent_basis: body.consent_basis ?? previous?.consent_basis,
        deidentification_profile: body.deidentification_profile ?? previous?.deidentification_profile,
        effective_at: body.effective_at ?? previous?.effective_at ?? null,
        expires_at: body.expires_at ?? previous?.expires_at ?? null,
    };
    const missing = Object.entries(facts).filter(([key, value]) => (
        key !== 'source_version' && key !== 'expires_at' && (value == null || (Array.isArray(value) && value.length === 0))
    )).map(([key]) => key);
    if (missing.length > 0) return NextResponse.json({ error: 'adapter_contract_incomplete', missing_fields: missing }, { status: 400 });
    if (!facts.writeback_permitted && facts.closure_destination_channel !== 'manual_work_queue') {
        return NextResponse.json({ error: 'writeback_permission_required_for_destination' }, { status: 400 });
    }
    const oauthValidation = await validateContractOAuthClient(
        supabase,
        tenantId,
        String(facts.oauth_client_id),
        String(facts.mtls_cert_thumbprint_hash),
    );
    if (oauthValidation) return NextResponse.json({ error: oauthValidation }, { status: 409 });
    if (body.event_type === 'activated') {
        const readiness = await validateSiteReadiness(supabase, tenantId, String(facts.clinic_site_id), String(facts.lab_site_id));
        if (readiness.length > 0) return NextResponse.json({ error: 'adapter_site_readiness_blocked', blockers: readiness }, { status: 409 });
    }
    const event = {
        tenant_id: tenantId,
        request_id: body.request_id,
        contract_id: contractId,
        event_type: body.event_type,
        ...facts,
        evidence: { ...(body.evidence ?? {}), raw_payload_export_permitted: false },
        actor_id: actorId,
    };
    const inserted = await insertIdempotent(supabase, 'evidence_node_adapter_contract_events', tenantId, body.request_id, {
        ...event,
        event_hash: hashAMRNetworkJson(event),
    });
    if (inserted.error) return storageError(inserted.error);
    return NextResponse.json({
        contract_id: contractId,
        contract_event_id: inserted.id,
        event_type: body.event_type,
        active: body.event_type === 'activated',
        cached: inserted.cached,
        error: null,
    }, { status: inserted.cached ? 200 : 201 });
}

async function recordClosureEvent(
    supabase: ReturnType<typeof getSupabaseServer>, tenantId: string, actorId: string,
    body: z.infer<typeof ClosureSchema>,
) {
    const replay = await loadIdempotentEvent(
        supabase,
        'evidence_node_closure_task_events',
        tenantId,
        body.request_id,
    );
    if (replay.error) return storageError(replay.error);
    if (replay.row) {
        if (replay.row.task_id !== body.task_id || replay.row.event_type !== body.event_type) {
            return idempotencyConflict();
        }
        return NextResponse.json({
            task_event_id: replay.row.id,
            task_id: replay.row.task_id,
            event_type: replay.row.event_type,
            cached: true,
            error: null,
        });
    }
    const { data, error } = await supabase.from('evidence_node_closure_task_events').select('*')
        .eq('tenant_id', tenantId).eq('task_id', body.task_id)
        .order('occurred_at', { ascending: true }).limit(100);
    if (error) return storageError(error.message);
    const previous = ((data ?? []) as Array<Record<string, unknown>>).at(-1);
    if (!previous) return NextResponse.json({ error: 'closure_task_not_found' }, { status: 404 });
    const transitionError = validateClosureTransition(String(previous.event_type), body.event_type);
    if (transitionError) return NextResponse.json({ error: transitionError }, { status: 409 });
    if (body.event_type === 'completed' && !body.reviewer_ref) {
        return NextResponse.json({ error: 'closure_reviewer_required' }, { status: 400 });
    }
    if (['failed'].includes(body.event_type) && !body.blocker_code) {
        return NextResponse.json({ error: 'closure_blocker_required' }, { status: 400 });
    }
    if (body.event_type === 'completed') {
        const taskType = String(previous.task_type);
        if (taskType === 'reconcile_episode' && !body.case_id && !body.patient_episode_id) {
            return NextResponse.json({ error: 'case_or_patient_episode_required' }, { status: 400 });
        }
        if (taskType === 'confirm_treatment' && (!body.amr_stewardship_event_id || !body.treatment_strategy)) {
            return NextResponse.json({ error: 'stewardship_event_and_treatment_strategy_required' }, { status: 400 });
        }
        if (taskType === 'confirm_follow_up' && body.followup_days == null) {
            return NextResponse.json({ error: 'followup_days_required' }, { status: 400 });
        }
        if (taskType === 'confirm_outcome' && (
            !body.inference_event_id
            || !body.clinical_outcome_id
            || !body.outcome_status
            || body.outcome_status === 'unknown'
            || !body.consent_status
        )) {
            return NextResponse.json({ error: 'linked_outcome_status_and_consent_required' }, { status: 400 });
        }
        if (previous.destination_channel !== 'manual_work_queue' && !body.writeback_receipt_hash) {
            return NextResponse.json({ error: 'writeback_receipt_required' }, { status: 400 });
        }
    }
    const evidence = {
        ...(body.evidence ?? {}),
        ...(body.treatment_strategy ? { treatment_strategy: body.treatment_strategy } : {}),
        ...(body.followup_days != null ? { followup_days: body.followup_days } : {}),
    };
    const { data: rpcData, error: rpcError } = await supabase.rpc('advance_evidence_node_closure_task_v1', {
        p_event: {
            tenant_id: tenantId,
            request_id: body.request_id,
            task_id: body.task_id,
            event_type: body.event_type,
            destination_ref_hash: body.destination_ref
                ? hashAMRNetworkValue(body.destination_ref)
                : previous.destination_ref_hash,
            case_id: body.case_id ?? previous.case_id,
            patient_episode_id: body.patient_episode_id ?? previous.patient_episode_id,
            inference_event_id: body.inference_event_id ?? null,
            clinical_outcome_id: body.clinical_outcome_id ?? null,
            amr_stewardship_event_id: body.amr_stewardship_event_id ?? null,
            outcome_status: body.outcome_status ?? previous.outcome_status,
            consent_status: body.consent_status ?? null,
            reviewer_ref_hash: body.reviewer_ref ? hashAMRNetworkValue(body.reviewer_ref) : null,
            writeback_receipt_hash: body.writeback_receipt_hash ?? null,
            blocker_code: body.blocker_code ?? null,
            evidence,
            actor_id: actorId,
        },
    });
    if (rpcError) {
        if (rpcError.code === 'P0002') {
            return NextResponse.json({
                error: 'closure_task_not_found',
                detail: rpcError.message,
            }, { status: 404 });
        }
        if (['22023', '23514'].includes(rpcError.code ?? '')) {
            return NextResponse.json({
                error: 'evidence_node_closure_transition_blocked',
                detail: rpcError.message,
            }, { status: 409 });
        }
        return storageError(rpcError.message);
    }
    const result = rpcData && typeof rpcData === 'object' && !Array.isArray(rpcData)
        ? rpcData as Record<string, unknown>
        : {};
    return NextResponse.json({ ...result, error: null }, { status: result.cached === true ? 200 : 201 });
}

async function generateExport(
    supabase: ReturnType<typeof getSupabaseServer>, tenantId: string, actorId: string,
    body: z.infer<typeof GenerateExportSchema>,
) {
    const { data: ingestions, error: ingestionError } = await supabase
        .from('amr_ast_ingestion_events').select('*').eq('tenant_id', tenantId).in('id', body.ingestion_event_ids);
    if (ingestionError) return storageError(ingestionError.message);
    if ((ingestions ?? []).length !== new Set(body.ingestion_event_ids).size) {
        return NextResponse.json({ error: 'one_or_more_ingestions_not_found' }, { status: 404 });
    }
    const { data: results, error: resultError } = await supabase
        .from('amr_ast_result_events').select('*').eq('tenant_id', tenantId).in('ingestion_event_id', body.ingestion_event_ids)
        .order('ingestion_event_id').order('result_index');
    if (resultError) return storageError(resultError.message);
    const projection = buildEvidenceNodeCompatibilityExport({
        profile: body.profile,
        ingestions: (ingestions ?? []) as EvidenceNodeIngestionProjectionRow[],
        results: (results ?? []) as EvidenceNodeResultProjectionRow[],
    });
    const exportId = body.export_id
        ?? deterministicUuid(`evidence-export:${tenantId}:${body.request_id}`);
    const replay = await loadIdempotentEvent(
        supabase,
        'evidence_node_export_events',
        tenantId,
        body.request_id,
    );
    if (replay.error) return storageError(replay.error);
    if (replay.row) {
        if (
            replay.row.event_type !== 'generated'
            || replay.row.export_id !== exportId
            || replay.row.export_profile !== body.profile
            || replay.row.artifact_hash !== projection.artifact_hash
        ) {
            return idempotencyConflict();
        }
        return NextResponse.json({
            export_id: replay.row.export_id,
            export_event_id: replay.row.id,
            ...projection,
            official_acceptance: false,
            cached: true,
            error: null,
        }, { status: projection.validation_status === 'passed' ? 200 : 422 });
    }
    const event = {
        tenant_id: tenantId,
        request_id: body.request_id,
        export_id: exportId,
        event_type: 'generated',
        export_profile: body.profile,
        profile_version: '1.0.0',
        record_count: projection.record_count,
        eligible_record_count: projection.eligible_record_count,
        source_bundle_hash: projection.source_bundle_hash,
        mapping_bundle_hash: projection.mapping_bundle_hash,
        artifact_hash: projection.artifact_hash,
        validation_scope: projection.validation_scope,
        validation_status: projection.validation_status,
        official_acceptance: false,
        acceptance_receipt_hash: null,
        blockers: projection.blockers,
        warnings: projection.warnings,
        evidence: {
            compatibility_only: true,
            compatibility_scope: projection.artifact.compatibility_scope,
            intended_receiver: projection.artifact.intended_receiver,
            receiver_schema_verified: false,
            raw_payload_included: false,
            breakpoint_tables_embedded: false,
        },
        actor_id: actorId,
    };
    const inserted = await insertIdempotent(supabase, 'evidence_node_export_events', tenantId, body.request_id, {
        ...event,
        event_hash: hashAMRNetworkJson(event),
    });
    if (inserted.error) return storageError(inserted.error);
    return NextResponse.json({
        export_id: exportId,
        export_event_id: inserted.id,
        ...projection,
        official_acceptance: false,
        cached: inserted.cached,
        error: null,
    }, { status: projection.validation_status === 'passed' ? 201 : 422 });
}

async function recordExportState(
    supabase: ReturnType<typeof getSupabaseServer>, tenantId: string, actorId: string,
    body: z.infer<typeof ExportStateSchema>,
) {
    const replay = await loadIdempotentEvent(
        supabase,
        'evidence_node_export_events',
        tenantId,
        body.request_id,
    );
    if (replay.error) return storageError(replay.error);
    if (replay.row) {
        if (
            replay.row.export_id !== body.export_id
            || replay.row.event_type !== body.event_type
            || (body.acceptance_receipt_hash
                && replay.row.acceptance_receipt_hash !== body.acceptance_receipt_hash)
        ) {
            return idempotencyConflict();
        }
        return NextResponse.json({
            export_id: replay.row.export_id,
            export_event_id: replay.row.id,
            event_type: replay.row.event_type,
            cached: true,
            error: null,
        });
    }
    const { data, error } = await supabase.from('evidence_node_export_events').select('*')
        .eq('tenant_id', tenantId).eq('export_id', body.export_id)
        .order('occurred_at', { ascending: true }).limit(100);
    if (error) return storageError(error.message);
    const previous = ((data ?? []) as Array<Record<string, unknown>>).at(-1);
    if (!previous) return NextResponse.json({ error: 'export_not_found' }, { status: 404 });
    const transitionError = validateExportTransition(String(previous.event_type), body.event_type);
    if (transitionError) return NextResponse.json({ error: transitionError }, { status: 409 });
    if (body.event_type === 'accepted' && !body.acceptance_receipt_hash) {
        return NextResponse.json({ error: 'external_acceptance_receipt_required' }, { status: 400 });
    }
    if (body.event_type === 'rejected' && !body.blocker_code) {
        return NextResponse.json({ error: 'export_rejection_reason_required' }, { status: 400 });
    }
    const event = {
        tenant_id: tenantId,
        request_id: body.request_id,
        export_id: body.export_id,
        event_type: body.event_type,
        export_profile: previous.export_profile,
        profile_version: previous.profile_version,
        record_count: previous.record_count,
        eligible_record_count: previous.eligible_record_count,
        source_bundle_hash: previous.source_bundle_hash,
        mapping_bundle_hash: previous.mapping_bundle_hash,
        artifact_hash: previous.artifact_hash,
        validation_scope: ['accepted', 'rejected'].includes(body.event_type)
            ? 'external_receiver'
            : previous.validation_scope,
        validation_status: body.event_type === 'rejected' ? 'failed' : previous.validation_status,
        official_acceptance: body.event_type === 'accepted',
        acceptance_receipt_hash: body.acceptance_receipt_hash ?? null,
        blockers: body.blocker_code ? [body.blocker_code] : [],
        warnings: previous.warnings,
        evidence: {
            ...(body.evidence ?? {}),
            validation_scope: ['accepted', 'rejected'].includes(body.event_type)
                ? 'external_receiver'
                : previous.validation_scope,
        },
        actor_id: actorId,
    };
    const inserted = await insertIdempotent(supabase, 'evidence_node_export_events', tenantId, body.request_id, {
        ...event,
        event_hash: hashAMRNetworkJson(event),
    });
    if (inserted.error) return storageError(inserted.error);
    return NextResponse.json({ export_id: body.export_id, export_event_id: inserted.id, event_type: body.event_type, cached: inserted.cached, error: null });
}

async function loadEvidenceNodeData(supabase: ReturnType<typeof getSupabaseServer>, tenantId: string) {
    const [contracts, receipts, identity, closure, exports, probes] = await Promise.all([
        supabase.from('evidence_node_adapter_contract_events').select('*').eq('tenant_id', tenantId).order('occurred_at', { ascending: true }).limit(10_000),
        supabase.from('evidence_node_ingestion_receipt_events').select('*').eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(50_000),
        supabase.from('evidence_node_identity_link_events').select('*').eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(50_000),
        supabase.from('evidence_node_closure_task_events').select('*').eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(50_000),
        supabase.from('evidence_node_export_events').select('*').eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(10_000),
        supabase.from('amr_connector_probe_events').select('site_id, oauth_client_id, probe_status, occurred_at').eq('tenant_id', tenantId).order('occurred_at', { ascending: false }).limit(10_000),
    ]);
    return {
        contracts: (contracts.data ?? []) as EvidenceNodeContractEventRow[],
        receipts: (receipts.data ?? []) as EvidenceNodeReceiptRow[],
        identityLinks: (identity.data ?? []) as EvidenceNodeIdentityLinkRow[],
        closureTasks: (closure.data ?? []) as EvidenceNodeClosureTaskRow[],
        exports: (exports.data ?? []) as EvidenceNodeExportEventRow[],
        connectorProbes: (probes.data ?? []) as Array<{
            site_id: string;
            oauth_client_id: string | null;
            probe_status: string;
            occurred_at: string;
        }>,
        error: contracts.error?.message ?? receipts.error?.message ?? identity.error?.message
            ?? closure.error?.message ?? exports.error?.message ?? probes.error?.message ?? null,
    };
}

async function validateContractOAuthClient(
    supabase: ReturnType<typeof getSupabaseServer>, tenantId: string, oauthClientId: string,
    expectedThumbprintHash: string,
) {
    const { data, error } = await supabase.from('oauth_clients')
        .select('id, tenant_id, status, allowed_scopes, mtls_required, mtls_cert_thumbprints')
        .eq('id', oauthClientId).maybeSingle();
    if (error) return error.message;
    if (!data || data.tenant_id !== tenantId || data.status !== 'active') return 'active_tenant_oauth_client_required';
    if (!data.mtls_required) return 'oauth_client_mtls_required';
    if (!Array.isArray(data.allowed_scopes) || !data.allowed_scopes.includes('amr:ingest')) return 'oauth_client_amr_ingest_scope_required';
    const activeThumbprints = Array.isArray(data.mtls_cert_thumbprints)
        ? data.mtls_cert_thumbprints.filter((value: unknown): value is string => typeof value === 'string')
        : [];
    if (!activeThumbprints.some((thumbprint: string) => (
        hashAMRNetworkValue(thumbprint.toLowerCase()) === expectedThumbprintHash
    ))) {
        return 'oauth_client_certificate_binding_mismatch';
    }
    return null;
}

async function validateSiteReadiness(
    supabase: ReturnType<typeof getSupabaseServer>, tenantId: string, clinicSiteId: string, labSiteId: string,
) {
    const { data, error } = await supabase.from('amr_network_site_events').select('*')
        .eq('tenant_id', tenantId).in('site_id', [clinicSiteId, labSiteId])
        .order('occurred_at', { ascending: true }).limit(10_000);
    if (error) return [error.message];
    const sites = buildAMRNetworkSiteSummaries((data ?? []) as AMRNetworkSiteEventRow[]);
    const clinic = sites.find((site) => site.site_id === clinicSiteId);
    const lab = sites.find((site) => site.site_id === labSiteId);
    return [
        ...(clinic?.site_type !== 'clinic' ? ['clinic_site_required'] : []),
        ...(!clinic?.enrolled ? ['clinic_enrollment_required'] : []),
        ...(!clinic?.data_use_approved ? ['clinic_data_use_approval_required'] : []),
        ...(lab?.site_type !== 'laboratory' ? ['laboratory_site_required'] : []),
        ...(!lab?.operational ? ['operational_laboratory_required'] : []),
    ];
}

function validateContractTransition(previous: string | null, next: string) {
    if (!previous) return next === 'drafted' ? null : 'adapter_contract_must_begin_drafted';
    if (['revoked', 'expired'].includes(previous)) return 'adapter_contract_terminal';
    const allowed: Record<string, string[]> = {
        drafted: ['approved', 'revoked'],
        approved: ['activated', 'revoked'],
        activated: ['suspended', 'revoked', 'expired'],
        suspended: ['activated', 'revoked', 'expired'],
    };
    return allowed[previous]?.includes(next) ? null : 'adapter_contract_transition_invalid';
}

function validateClosureTransition(previous: string, next: string) {
    if (['completed', 'cancelled'].includes(previous)) return 'closure_task_terminal';
    const allowed: Record<string, string[]> = {
        queued: ['dispatched', 'completed', 'cancelled', 'failed'],
        dispatched: ['acknowledged', 'completed', 'failed', 'cancelled'],
        acknowledged: ['completed', 'failed', 'cancelled'],
        failed: ['dispatched', 'cancelled'],
    };
    return allowed[previous]?.includes(next) ? null : 'closure_task_transition_invalid';
}

function validateExportTransition(previous: string, next: string) {
    if (['accepted', 'rejected'].includes(previous)) return 'export_state_terminal';
    const allowed: Record<string, string[]> = {
        generated: ['validated', 'delivered', 'rejected'],
        validated: ['delivered', 'rejected'],
        delivered: ['accepted', 'rejected'],
    };
    return allowed[previous]?.includes(next) ? null : 'export_state_transition_invalid';
}

async function insertIdempotent(
    supabase: ReturnType<typeof getSupabaseServer>, table: string, tenantId: string,
    requestId: string, payload: Record<string, unknown>,
) {
    const { data, error } = await supabase.from(table).insert(payload).select('*').single();
    if (!error && data?.id) {
        return {
            id: String(data.id),
            row: data as Record<string, unknown>,
            cached: false,
            error: null as string | null,
        };
    }
    if (error?.code !== '23505') {
        return { id: null, row: null, cached: false, error: error?.message ?? 'Insert failed.' };
    }
    const existing = await supabase.from(table).select('*')
        .eq('tenant_id', tenantId).eq('request_id', requestId).maybeSingle();
    const existingRow = existing.data as Record<string, unknown> | null;
    if (
        existingRow?.event_hash
        && payload.event_hash
        && existingRow.event_hash !== payload.event_hash
    ) {
        return { id: null, row: existingRow, cached: false, error: 'idempotency_key_payload_mismatch' };
    }
    return {
        id: existingRow?.id ? String(existingRow.id) : null,
        row: existingRow,
        cached: Boolean(existingRow?.id),
        error: existing.error?.message ?? (existingRow?.id ? null : error.message),
    };
}

async function loadIdempotentEvent(
    supabase: ReturnType<typeof getSupabaseServer>,
    table: string,
    tenantId: string,
    requestId: string,
) {
    const { data, error } = await supabase.from(table).select('*')
        .eq('tenant_id', tenantId).eq('request_id', requestId).maybeSingle();
    return {
        row: data ? data as Record<string, unknown> : null,
        error: error?.message ?? null,
    };
}

function idempotencyConflict() {
    return NextResponse.json({
        error: 'idempotency_key_reused_with_different_operation',
    }, { status: 409 });
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

function storageError(detail: string) {
    if (detail === 'idempotency_key_payload_mismatch') return idempotencyConflict();
    const missing = /relation .* does not exist|schema cache|could not find the table|function .* does not exist/i.test(detail);
    return NextResponse.json({
        error: missing ? 'evidence_node_migration_required' : 'evidence_node_storage_failed',
        detail,
        migration: missing ? 'supabase/migrations/20260801000000_evidence_node_lab_adapter.sql' : undefined,
    }, { status: 503 });
}

function withHeaders(response: NextResponse, requestId: string, startTime: number) {
    response.headers.set('Cache-Control', 'private, no-store');
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}
