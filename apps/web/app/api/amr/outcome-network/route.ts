import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import {
    AMR_NETWORK_SITE_EVENT_TYPES,
    AMR_NETWORK_SITE_TYPES,
    AMR_OUTCOME_EPISODE_EVENT_TYPES,
    assessAMROutcomeEpisode,
    buildAMRNetworkSiteSummaries,
    buildAMROutcomeNetworkSnapshot,
    hashAMRNetworkJson,
    hashAMRNetworkValue,
    type AMRCalibrationEvidenceRow,
    type AMRNetworkSiteEventRow,
    type AMROutcomeEpisodeEventRow,
    type AMRSurveillanceEvidenceRow,
} from '@/lib/amr/outcomeNetwork';
import { validateAMREpisodeReferences } from '@/lib/amr/outcomeNetworkReferences';
import {
    recordOutcomeCalibrationRun,
    type OutcomeCalibrationCase,
} from '@/lib/inference/outcomeCalibration';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const OptionalUuidSchema = z.string().uuid().optional();
const SiteEvidenceSchema = z.object({
    agreement_version: z.string().trim().min(1).max(80).optional(),
    connector_version: z.string().trim().min(1).max(80).optional(),
    verification_method: z.enum([
        'dry_run',
        'schema_validation',
        'production_probe',
        'manual_attestation',
    ]).optional(),
    verified_record_count: z.number().int().min(0).max(10_000_000).optional(),
    failure_code: z.string().trim().min(1).max(80).optional(),
}).strict().default({});
const EpisodeEvidenceSchema = z.object({
    source_system: z.string().trim().min(1).max(80).optional(),
    source_version: z.string().trim().min(1).max(80).optional(),
    ast_method: z.string().trim().min(1).max(80).optional(),
    interpretation_standard: z.string().trim().min(1).max(80).optional(),
    interpretation_standard_version: z.string().trim().min(1).max(80).optional(),
    panel_version: z.string().trim().min(1).max(80).optional(),
    treatment_strategy: z.enum([
        'empiric',
        'culture_directed',
        'de_escalated',
        'supportive_only',
        'no_antimicrobial',
    ]).optional(),
    followup_days: z.number().int().min(0).max(3_650).optional(),
}).strict().default({});

const RecordSiteEventSchema = z.object({
    action: z.literal('record_site_event'),
    request_id: z.string().uuid(),
    site_id: z.string().uuid().optional(),
    site_type: z.enum(AMR_NETWORK_SITE_TYPES),
    event_type: z.enum(AMR_NETWORK_SITE_EVENT_TYPES),
    display_label: z.string().trim().min(1).max(160).optional(),
    site_ref: z.string().trim().min(1).max(256).optional(),
    connector_key: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{1,78}[a-z0-9]$/).optional(),
    evidence: SiteEvidenceSchema,
    occurred_at: z.string().datetime().optional(),
});

const RecordEpisodeEventSchema = z.object({
    action: z.literal('record_episode_event'),
    request_id: z.string().uuid(),
    episode_id: z.string().uuid().optional(),
    event_type: z.enum(AMR_OUTCOME_EPISODE_EVENT_TYPES),
    site_id: OptionalUuidSchema,
    lab_site_id: OptionalUuidSchema,
    case_id: OptionalUuidSchema,
    inference_event_id: OptionalUuidSchema,
    clinical_outcome_id: OptionalUuidSchema,
    amr_stewardship_event_id: OptionalUuidSchema,
    amr_lab_feed_event_id: OptionalUuidSchema,
    species: z.string().trim().min(1).max(80).optional(),
    pathogen_key: z.string().trim().min(1).max(160).optional(),
    drug_class: z.string().trim().min(1).max(160).optional(),
    outcome_status: z.enum([
        'improved',
        'resolved',
        'unchanged',
        'worsened',
        'relapsed',
        'adverse_event',
        'unknown',
    ]).optional(),
    consent_status: z.enum(['pending', 'approved', 'declined', 'revoked']).optional(),
    review_status: z.enum(['pending', 'completed', 'rejected']).optional(),
    reviewer_ref: z.string().trim().min(1).max(256).optional(),
    is_synthetic: z.boolean().default(false),
    deidentified: z.boolean().default(true),
    source_record_digest: Sha256Schema.optional(),
    evidence_packet_hash: Sha256Schema.optional(),
    evidence: EpisodeEvidenceSchema,
    occurred_at: z.string().datetime().optional(),
});

const PersistSnapshotSchema = z.object({
    action: z.literal('persist_snapshot'),
    request_id: z.string().uuid(),
});
const RunCalibrationSchema = z.object({
    action: z.literal('run_calibration'),
    request_id: z.string().uuid(),
    minimum_required_outcomes: z.number().int().min(5).max(250).default(20),
});

const PostSchema = z.discriminatedUnion('action', [
    RecordSiteEventSchema,
    RecordEpisodeEventSchema,
    PersistSnapshotSchema,
    RunCalibrationSchema,
]);

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['evaluation:read'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const loaded = await loadNetworkData(supabase, auth.actor.tenantId);
    if (loaded.error) return networkStorageError(loaded.error);

    const snapshot = buildAMROutcomeNetworkSnapshot({
        siteEvents: loaded.siteEvents,
        episodeEvents: loaded.episodeEvents,
        calibrationEvidence: loaded.calibrationEvidence,
        surveillanceEvidence: loaded.surveillanceEvidence,
    });

    return NextResponse.json({
        snapshot,
        calibration_warning: loaded.calibrationWarning,
        de_identified: true,
        raw_lab_reports_stored: false,
        error: null,
    });
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['outcome:write'],
    });
    if (auth.error || !auth.actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = PostSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: 'invalid_input', detail: parsed.error.flatten() },
            { status: 400 },
        );
    }

    const actorId = auth.actor.userId
        ?? auth.actor.principalLabel
        ?? auth.actor.oauthClientId
        ?? 'machine_actor';

    if (parsed.data.action === 'record_site_event') {
        return recordSiteEvent({
            supabase,
            tenantId: auth.actor.tenantId,
            actorId,
            body: parsed.data,
        });
    }

    if (parsed.data.action === 'record_episode_event') {
        return recordEpisodeEvent({
            supabase,
            tenantId: auth.actor.tenantId,
            actorId,
            body: parsed.data,
        });
    }

    if (parsed.data.action === 'run_calibration') {
        return runAMROutcomeCalibration({
            supabase,
            tenantId: auth.actor.tenantId,
            requestId: parsed.data.request_id,
            minimumRequiredOutcomes: parsed.data.minimum_required_outcomes,
        });
    }

    return persistNetworkSnapshot({
        supabase,
        tenantId: auth.actor.tenantId,
        requestId: parsed.data.request_id,
    });
}

async function runAMROutcomeCalibration(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    requestId: string;
    minimumRequiredOutcomes: number;
}) {
    const cached = await loadCachedCalibrationResponse(
        input.supabase,
        input.tenantId,
        input.requestId,
    );
    if (cached.error) return networkStorageError(cached.error);
    if (cached.response) return NextResponse.json(cached.response);

    const loaded = await loadNetworkData(input.supabase, input.tenantId);
    if (loaded.error) return networkStorageError(loaded.error);
    const sites = buildAMRNetworkSiteSummaries(loaded.siteEvents);
    const episodeGroups = new Map<string, AMROutcomeEpisodeEventRow[]>();
    for (const event of loaded.episodeEvents) {
        const rows = episodeGroups.get(event.episode_id) ?? [];
        rows.push(event);
        episodeGroups.set(event.episode_id, rows);
    }
    const eligibleEpisodes = Array.from(episodeGroups.values())
        .map((rows) => assessAMROutcomeEpisode(rows, sites))
        .filter((episode) => episode.calibration_eligible);
    const inferenceIds = uniqueStrings(
        eligibleEpisodes.map((episode) => episode.inference_event_id),
    );
    const outcomeIds = uniqueStrings(
        eligibleEpisodes.map((episode) => episode.clinical_outcome_id),
    );

    const [inferenceResult, outcomeResult] = await Promise.all([
        inferenceIds.length > 0
            ? input.supabase
                .from('ai_inference_events')
                .select('id, case_id, output_payload, differentials, confidence_score, model_version, is_synthetic, created_at')
                .eq('tenant_id', input.tenantId)
                .in('id', inferenceIds)
            : Promise.resolve({ data: [], error: null }),
        outcomeIds.length > 0
            ? input.supabase
                .from('clinical_outcome_events')
                .select('id, inference_event_id, actual_label, actual_confidence, calibration_delta, label_type, outcome_payload, outcome_timestamp, is_synthetic, created_at')
                .eq('tenant_id', input.tenantId)
                .in('id', outcomeIds)
            : Promise.resolve({ data: [], error: null }),
    ]);
    if (inferenceResult.error || outcomeResult.error) {
        return NextResponse.json(
            {
                error: 'amr_calibration_source_load_failed',
                detail: inferenceResult.error?.message ?? outcomeResult.error?.message,
            },
            { status: 503 },
        );
    }

    const inferenceById = new Map(
        (inferenceResult.data ?? []).map((row) => [String(row.id), row as Record<string, unknown>]),
    );
    const outcomeById = new Map(
        (outcomeResult.data ?? []).map((row) => [String(row.id), row as Record<string, unknown>]),
    );
    const calibrationRows: OutcomeCalibrationCase[] = eligibleEpisodes.flatMap((episode) => {
        const inference = episode.inference_event_id
            ? inferenceById.get(episode.inference_event_id)
            : null;
        const outcome = episode.clinical_outcome_id
            ? outcomeById.get(episode.clinical_outcome_id)
            : null;
        if (!inference || !outcome) return [];
        const topDifferentials = readDifferentials(inference);
        const actualLabel = readText(outcome.actual_label)
            ?? readText(asRecord(outcome.outcome_payload).label)
            ?? readText(asRecord(outcome.outcome_payload).actual_diagnosis);
        if (!actualLabel) return [];

        return [{
            tenantId: input.tenantId,
            outcomeEventId: episode.clinical_outcome_id,
            inferenceEventId: episode.inference_event_id,
            caseId: readText(inference.case_id),
            species: episode.species,
            label: actualLabel,
            labelType: readText(outcome.label_type),
            predictedLabel: topDifferentials[0]?.label ?? null,
            predictedProbability: readNumber(inference.confidence_score)
                ?? topDifferentials[0]?.probability
                ?? null,
            actualConfidence: readNumber(outcome.actual_confidence),
            calibrationDelta: readNumber(outcome.calibration_delta),
            topDifferentials,
            modelVersion: readText(inference.model_version),
            evidenceType: 'amr_culture_ast',
            synthetic: episode.synthetic
                || inference.is_synthetic === true
                || outcome.is_synthetic === true
                || readText(outcome.label_type) === 'synthetic',
            sourceKind: 'amr_outcome_network_pilot',
            observedAt: readText(outcome.outcome_timestamp)
                ?? readText(outcome.created_at)
                ?? episode.latest_event_at,
        }];
    });

    const result = await recordOutcomeCalibrationRun(input.supabase, {
        tenantId: input.tenantId,
        requestId: input.requestId,
        runKind: 'manual_recompute',
        minimumRequiredOutcomes: input.minimumRequiredOutcomes,
        sourceWindowStart: calibrationRows
            .map((row) => row.observedAt)
            .filter((value): value is string => Boolean(value))
            .sort()[0] ?? null,
        sourceWindowEnd: calibrationRows
            .map((row) => row.observedAt)
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1) ?? null,
        rows: calibrationRows,
    });
    if (result.error) {
        const raced = await loadCachedCalibrationResponse(
            input.supabase,
            input.tenantId,
            input.requestId,
        );
        if (raced.response) return NextResponse.json(raced.response);
        return NextResponse.json(
            { error: 'amr_calibration_run_failed', detail: result.error },
            { status: 503 },
        );
    }

    return NextResponse.json({
        calibration: result.data,
        eligible_episode_count: eligibleEpisodes.length,
        linked_calibration_row_count: calibrationRows.length,
        synthetic_rows_excluded: result.data?.synthetic_rows_excluded ?? 0,
        cached: false,
        error: null,
    });
}

async function recordSiteEvent(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    actorId: string;
    body: z.infer<typeof RecordSiteEventSchema>;
}) {
    const cachedRequest = await loadCachedEventByRequest(
        input.supabase,
        'amr_network_site_events',
        input.tenantId,
        input.body.request_id,
        'site_id',
    );
    if (cachedRequest.error) return networkStorageError(cachedRequest.error);
    if (cachedRequest.id && cachedRequest.entityId) {
        const cachedEvents = await loadSiteEvents(
            input.supabase,
            input.tenantId,
            cachedRequest.entityId,
        );
        if (cachedEvents.error) return networkStorageError(cachedEvents.error);
        return NextResponse.json({
            site_event_id: cachedRequest.id,
            site_id: cachedRequest.entityId,
            cached: true,
            site: buildAMRNetworkSiteSummaries(cachedEvents.rows)[0] ?? null,
            raw_site_reference_stored: false,
            error: null,
        });
    }

    const siteId = input.body.site_id ?? randomUUID();
    const existing = await loadSiteEvents(input.supabase, input.tenantId, siteId);
    if (existing.error) return networkStorageError(existing.error);

    const semanticError = validateSiteTransition(input.body, existing.rows);
    if (semanticError) {
        return NextResponse.json({ error: semanticError }, { status: 409 });
    }

    const occurredAt = input.body.occurred_at ?? new Date().toISOString();
    const event = {
        tenant_id: input.tenantId,
        request_id: input.body.request_id,
        site_id: siteId,
        site_type: input.body.site_type,
        event_type: input.body.event_type,
        display_label: input.body.display_label ?? null,
        site_ref_hash: input.body.site_ref ? hashAMRNetworkValue(input.body.site_ref) : null,
        connector_key: input.body.connector_key ?? null,
        actor_id: input.actorId,
        evidence: input.body.evidence,
        occurred_at: occurredAt,
    };
    const eventHash = hashAMRNetworkJson(event);
    const inserted = await insertIdempotentEvent({
        supabase: input.supabase,
        table: 'amr_network_site_events',
        tenantId: input.tenantId,
        requestId: input.body.request_id,
        payload: { ...event, event_hash: eventHash },
    });
    if (inserted.error) return networkStorageError(inserted.error);

    const candidateRows: AMRNetworkSiteEventRow[] = inserted.cached
        ? existing.rows
        : [...existing.rows, { ...event, event_hash: eventHash }];
    const summary = buildAMRNetworkSiteSummaries(candidateRows)
        .find((site) => site.site_id === siteId) ?? null;

    return NextResponse.json({
        site_event_id: inserted.id,
        site_id: siteId,
        cached: inserted.cached,
        site: summary,
        raw_site_reference_stored: false,
        error: null,
    });
}

async function recordEpisodeEvent(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    actorId: string;
    body: z.infer<typeof RecordEpisodeEventSchema>;
}) {
    if (input.body.event_type === 'eligibility_evaluated') {
        return NextResponse.json(
            { error: 'eligibility_is_system_computed' },
            { status: 403 },
        );
    }

    const cachedRequest = await loadCachedEventByRequest(
        input.supabase,
        'amr_outcome_episode_events',
        input.tenantId,
        input.body.request_id,
        'episode_id',
    );
    if (cachedRequest.error) return networkStorageError(cachedRequest.error);
    if (cachedRequest.id && cachedRequest.entityId) {
        const loaded = await loadNetworkData(input.supabase, input.tenantId);
        if (loaded.error) return networkStorageError(loaded.error);
        const sites = buildAMRNetworkSiteSummaries(loaded.siteEvents);
        const cachedRows = loaded.episodeEvents.filter(
            (row) => row.episode_id === cachedRequest.entityId,
        );
        return NextResponse.json({
            episode_event_id: cachedRequest.id,
            eligibility_event_id: null,
            episode_id: cachedRequest.entityId,
            cached: true,
            assessment: cachedRows.length > 0
                ? assessAMROutcomeEpisode(cachedRows, sites)
                : null,
            raw_lab_report_stored: false,
            reviewer_reference_stored: false,
            error: null,
        });
    }

    const episodeId = input.body.episode_id
        ?? (input.body.event_type === 'episode_opened' ? randomUUID() : null);
    if (!episodeId) {
        return NextResponse.json({ error: 'episode_id_required' }, { status: 400 });
    }

    const loaded = await loadNetworkData(input.supabase, input.tenantId);
    if (loaded.error) return networkStorageError(loaded.error);
    const currentRows = loaded.episodeEvents.filter((row) => row.episode_id === episodeId);
    const sites = buildAMRNetworkSiteSummaries(loaded.siteEvents);
    const transitionError = validateEpisodeTransition(input.body, currentRows, sites);
    if (transitionError) {
        return NextResponse.json({ error: transitionError }, { status: 409 });
    }

    const referenceValidation = await validateAMREpisodeReferences({
        supabase: input.supabase,
        tenantId: input.tenantId,
        body: input.body,
        currentRows,
    });
    if (referenceValidation.storageError) {
        return networkStorageError(referenceValidation.storageError);
    }
    if (referenceValidation.error) {
        return NextResponse.json(
            { error: referenceValidation.error },
            { status: 409 },
        );
    }

    const resolved = referenceValidation.resolved;
    const occurredAt = input.body.occurred_at ?? new Date().toISOString();
    const event = {
        tenant_id: input.tenantId,
        request_id: input.body.request_id,
        episode_id: episodeId,
        site_id: resolved.siteId,
        lab_site_id: resolved.labSiteId,
        event_type: input.body.event_type,
        case_id: resolved.caseId,
        inference_event_id: resolved.inferenceEventId,
        clinical_outcome_id: resolved.clinicalOutcomeId,
        amr_stewardship_event_id: resolved.amrStewardshipEventId,
        amr_lab_feed_event_id: resolved.amrLabFeedEventId,
        species: resolved.species,
        pathogen_key: resolved.pathogenKey,
        drug_class: resolved.drugClass,
        outcome_status: resolved.outcomeStatus,
        consent_status: resolved.consentStatus,
        review_status: resolved.reviewStatus,
        reviewer_ref_hash: input.body.reviewer_ref
            ? hashAMRNetworkValue(input.body.reviewer_ref)
            : null,
        is_synthetic: referenceValidation.synthetic,
        deidentified: referenceValidation.deidentified,
        source_record_digest: resolved.sourceRecordDigest,
        evidence_packet_hash: resolved.evidencePacketHash,
        calibration_eligible: false,
        federation_eligible: false,
        eligibility_blockers: [],
        event_payload: {
            ...input.body.evidence,
            provenance: referenceValidation.provenance,
        },
        actor_id: input.actorId,
        occurred_at: occurredAt,
    };
    const eventHash = hashAMRNetworkJson(event);
    const inserted = await insertIdempotentEvent({
        supabase: input.supabase,
        table: 'amr_outcome_episode_events',
        tenantId: input.tenantId,
        requestId: input.body.request_id,
        payload: { ...event, event_hash: eventHash },
    });
    if (inserted.error) return networkStorageError(inserted.error);

    let assessmentRows = inserted.cached
        ? currentRows
        : [...currentRows, { ...event, event_hash: eventHash }];
    let assessment = assessAMROutcomeEpisode(assessmentRows, sites);
    let eligibilityEventId: string | null = null;

    if (!inserted.cached) {
        const eligibilityEvent = {
            tenant_id: input.tenantId,
            request_id: randomUUID(),
            episode_id: episodeId,
            site_id: assessment.site_id,
            lab_site_id: assessment.lab_site_id,
            event_type: 'eligibility_evaluated',
            case_id: null,
            inference_event_id: assessment.inference_event_id,
            clinical_outcome_id: assessment.clinical_outcome_id,
            amr_stewardship_event_id: assessment.amr_stewardship_event_id,
            amr_lab_feed_event_id: assessment.amr_lab_feed_event_id,
            species: assessment.species,
            pathogen_key: assessment.pathogen_key,
            drug_class: assessment.drug_class,
            outcome_status: assessment.outcome_status,
            consent_status: assessment.consent_approved ? 'approved' : null,
            review_status: assessment.review_completed ? 'completed' : null,
            reviewer_ref_hash: null,
            is_synthetic: assessment.synthetic,
            deidentified: assessment.deidentified,
            source_record_digest: assessment.source_record_digest,
            evidence_packet_hash: assessment.evidence_packet_hash,
            calibration_eligible: assessment.calibration_eligible,
            federation_eligible: assessment.federation_eligible,
            eligibility_blockers: assessment.blockers,
            event_payload: {
                evaluator: 'amr-outcome-network-pilot-v1',
                stage: assessment.stage,
            },
            actor_id: 'vetios_amr_eligibility_engine',
            occurred_at: new Date().toISOString(),
        };
        const eligibilityHash = hashAMRNetworkJson(eligibilityEvent);
        const { data: eligibilityRow, error: eligibilityError } = await input.supabase
            .from('amr_outcome_episode_events')
            .insert({ ...eligibilityEvent, event_hash: eligibilityHash })
            .select('id')
            .single();
        if (eligibilityError) return networkStorageError(eligibilityError.message);
        eligibilityEventId = eligibilityRow?.id ? String(eligibilityRow.id) : null;
        assessmentRows = [...assessmentRows, { ...eligibilityEvent, event_hash: eligibilityHash }];
        assessment = assessAMROutcomeEpisode(assessmentRows, sites);
    }

    return NextResponse.json({
        episode_event_id: inserted.id,
        eligibility_event_id: eligibilityEventId,
        episode_id: episodeId,
        cached: inserted.cached,
        assessment,
        raw_lab_report_stored: false,
        reviewer_reference_stored: false,
        error: null,
    });
}

async function persistNetworkSnapshot(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    tenantId: string;
    requestId: string;
}) {
    const cached = await loadCachedNetworkSnapshot(
        input.supabase,
        input.tenantId,
        input.requestId,
    );
    if (cached.error) return networkStorageError(cached.error);
    if (cached.id && cached.snapshot) {
        return NextResponse.json({
            snapshot_event_id: cached.id,
            cached: true,
            snapshot: cached.snapshot,
            error: null,
        });
    }

    const loaded = await loadNetworkData(input.supabase, input.tenantId);
    if (loaded.error) return networkStorageError(loaded.error);
    const snapshot = buildAMROutcomeNetworkSnapshot({
        siteEvents: loaded.siteEvents,
        episodeEvents: loaded.episodeEvents,
        calibrationEvidence: loaded.calibrationEvidence,
        surveillanceEvidence: loaded.surveillanceEvidence,
    });
    const payload = {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        pilot_status: snapshot.pilot_status,
        operational_laboratories: snapshot.sites.operational_laboratories,
        operational_clinics: snapshot.sites.operational_clinics,
        total_episodes: snapshot.episodes.total,
        outcome_confirmed_episodes: snapshot.episodes.outcome_confirmed,
        calibration_eligible_episodes: snapshot.episodes.calibration_eligible,
        federation_eligible_episodes: snapshot.episodes.federation_eligible,
        target_episode_count: snapshot.targets.outcome_confirmed_episodes,
        target_progress_percent: snapshot.episodes.target_progress_percent,
        network_threshold_met: snapshot.federation_manifest.network_threshold_met,
        calibration_status: snapshot.calibration_proof.status,
        baseline_ece: snapshot.calibration_proof.baseline_ece,
        current_ece: snapshot.calibration_proof.current_ece,
        ece_delta: snapshot.calibration_proof.ece_delta,
        surveillance_status: snapshot.surveillance_proof.status,
        outcome_linked_surveillance_records: snapshot.surveillance_proof.outcome_linked_records,
        one_health_export_ready_records: snapshot.surveillance_proof.one_health_export_ready_records,
        unique_trend_buckets: snapshot.surveillance_proof.unique_trend_buckets,
        surveillance_source_digest_bundle_hash: snapshot.surveillance_proof.source_digest_bundle_hash,
        source_digest_bundle_hash: snapshot.federation_manifest.source_digest_bundle_hash,
        snapshot_hash: snapshot.proof_hash,
        blockers: snapshot.blockers,
        next_actions: snapshot.next_actions,
        snapshot,
    };
    const inserted = await insertIdempotentEvent({
        supabase: input.supabase,
        table: 'amr_outcome_network_snapshots',
        tenantId: input.tenantId,
        requestId: input.requestId,
        payload,
    });
    if (inserted.error) return networkStorageError(inserted.error);

    if (inserted.cached) {
        const replay = await loadCachedNetworkSnapshot(
            input.supabase,
            input.tenantId,
            input.requestId,
        );
        if (replay.error) return networkStorageError(replay.error);
        if (replay.id && replay.snapshot) {
            return NextResponse.json({
                snapshot_event_id: replay.id,
                cached: true,
                snapshot: replay.snapshot,
                error: null,
            });
        }
    }

    return NextResponse.json({
        snapshot_event_id: inserted.id,
        cached: inserted.cached,
        snapshot,
        error: null,
    });
}

function validateSiteTransition(
    body: z.infer<typeof RecordSiteEventSchema>,
    rows: AMRNetworkSiteEventRow[],
): string | null {
    const summary = rows.length > 0 ? buildAMRNetworkSiteSummaries(rows)[0] ?? null : null;
    if (body.event_type === 'invited') {
        return rows.length > 0 ? 'site_already_exists' : null;
    }
    if (!summary) return 'site_invitation_required';
    if (body.site_type !== summary.site_type) return 'site_type_is_immutable';
    if (summary.status === 'retired') return 'retired_site_cannot_transition';
    if (body.event_type === 'enrolled' && summary.enrolled) return 'site_already_enrolled';
    if (body.event_type === 'data_use_approved') {
        if (!summary.enrolled) return 'site_enrollment_required';
        if (!body.evidence.agreement_version) return 'agreement_version_required';
    }
    if (body.event_type === 'connector_verified') {
        if (!summary.data_use_approved) return 'data_use_approval_required';
        if (!body.connector_key && !summary.connector_key) return 'connector_key_required';
        if (!body.evidence.verification_method) return 'verification_method_required';
    }
    return null;
}

function validateEpisodeTransition(
    body: z.infer<typeof RecordEpisodeEventSchema>,
    rows: AMROutcomeEpisodeEventRow[],
    sites: ReturnType<typeof buildAMRNetworkSiteSummaries>,
): string | null {
    const current = rows.length > 0 ? assessAMROutcomeEpisode(rows, sites) : null;
    if (body.event_type === 'episode_opened') {
        if (current) return 'episode_already_opened';
        if (!body.site_id || !body.lab_site_id) return 'clinic_and_laboratory_required';
        if (!body.species) return 'species_required';
        const clinic = sites.find((site) => site.site_id === body.site_id);
        const lab = sites.find((site) => site.site_id === body.lab_site_id);
        if (clinic?.site_type !== 'clinic' || !clinic.operational) return 'operational_clinic_required';
        if (lab?.site_type !== 'laboratory' || !lab.operational) return 'operational_laboratory_required';
        return null;
    }
    if (!current) return 'episode_opening_required';
    if (current.closed) return 'closed_episode_is_immutable';

    if (body.event_type === 'culture_received') {
        return body.source_record_digest ? null : 'source_record_digest_required';
    }
    if (body.event_type === 'ast_verified') {
        if (!current.culture_received) return 'culture_result_required_before_ast';
        if (!body.amr_lab_feed_event_id) return 'amr_lab_feed_event_id_required';
        if (!body.source_record_digest || !body.evidence_packet_hash) return 'source_and_evidence_hashes_required';
        if (!body.evidence.interpretation_standard || !body.evidence.interpretation_standard_version) {
            return 'ast_interpretation_standard_and_version_required';
        }
    }
    if (body.event_type === 'treatment_recorded') {
        if (!current.ast_verified) return 'verified_ast_required_before_treatment';
        if (!body.amr_stewardship_event_id) return 'amr_stewardship_event_id_required';
        if (!body.evidence.treatment_strategy) return 'treatment_strategy_required';
    }
    if (body.event_type === 'clinical_review_completed') {
        if (!current.treatment_recorded) return 'treatment_record_required_before_review';
        if (body.review_status !== 'completed' || !body.reviewer_ref) {
            return 'completed_review_and_reviewer_reference_required';
        }
    }
    if (body.event_type === 'outcome_confirmed') {
        if (!current.review_completed) return 'clinical_review_required_before_outcome';
        if (!body.inference_event_id || !body.clinical_outcome_id) return 'inference_and_outcome_links_required';
        if (!body.outcome_status || body.outcome_status === 'unknown') return 'confirmed_outcome_status_required';
    }
    if (body.event_type === 'episode_closed' && !current.outcome_confirmed) {
        return 'confirmed_outcome_required_before_closure';
    }
    return null;
}

async function loadNetworkData(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
): Promise<{
    siteEvents: AMRNetworkSiteEventRow[];
    episodeEvents: AMROutcomeEpisodeEventRow[];
    calibrationEvidence: AMRCalibrationEvidenceRow[];
    surveillanceEvidence: AMRSurveillanceEvidenceRow[];
    calibrationWarning: string | null;
    error: string | null;
}> {
    const [siteResult, episodeResult, calibrationResult, surveillanceResult] = await Promise.all([
        supabase
            .from('amr_network_site_events')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('occurred_at', { ascending: true })
            .limit(10_000),
        supabase
            .from('amr_outcome_episode_events')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('occurred_at', { ascending: true })
            .limit(50_000),
        supabase
            .from('outcome_calibration_buckets')
            .select('calibration_run_id, evidence_type, outcome_label_count, expected_calibration_error, brier_score, calibration_status, created_at')
            .eq('tenant_id', tenantId)
            .in('evidence_type', ['amr', 'amr_culture_ast'])
            .order('created_at', { ascending: true })
            .limit(10_000),
        supabase
            .from('amr_lab_feed_surveillance_events')
            .select('id, pathogen_key, drug_class, trend_bucket_key, lab_feed_status, resistance_signal_score, one_health_export_ready, source_record_digest, observed_at, created_at')
            .eq('tenant_id', tenantId)
            .order('observed_at', { ascending: true })
            .limit(50_000),
    ]);

    return {
        siteEvents: (siteResult.data ?? []) as AMRNetworkSiteEventRow[],
        episodeEvents: (episodeResult.data ?? []) as AMROutcomeEpisodeEventRow[],
        calibrationEvidence: (calibrationResult.data ?? []) as AMRCalibrationEvidenceRow[],
        surveillanceEvidence: (surveillanceResult.data ?? []) as AMRSurveillanceEvidenceRow[],
        calibrationWarning: calibrationResult.error?.message ?? null,
        error: siteResult.error?.message
            ?? episodeResult.error?.message
            ?? surveillanceResult.error?.message
            ?? null,
    };
}

async function loadSiteEvents(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    siteId: string,
): Promise<{ rows: AMRNetworkSiteEventRow[]; error: string | null }> {
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

async function insertIdempotentEvent(input: {
    supabase: ReturnType<typeof getSupabaseServer>;
    table: string;
    tenantId: string;
    requestId: string;
    payload: Record<string, unknown>;
}): Promise<{ id: string | null; cached: boolean; error: string | null }> {
    const { data, error } = await input.supabase
        .from(input.table)
        .insert(input.payload)
        .select('id')
        .single();
    if (!error && data?.id) {
        return { id: String(data.id), cached: false, error: null };
    }
    if (error?.code === '23505') {
        const { data: cached, error: cachedError } = await input.supabase
            .from(input.table)
            .select('id')
            .eq('tenant_id', input.tenantId)
            .eq('request_id', input.requestId)
            .maybeSingle();
        return {
            id: cached?.id ? String(cached.id) : null,
            cached: Boolean(cached?.id),
            error: cachedError?.message ?? (cached?.id ? null : error.message),
        };
    }
    return { id: null, cached: false, error: error?.message ?? 'insert_failed' };
}

async function loadCachedEventByRequest(
    supabase: ReturnType<typeof getSupabaseServer>,
    table: string,
    tenantId: string,
    requestId: string,
    entityColumn: 'site_id' | 'episode_id',
): Promise<{ id: string | null; entityId: string | null; error: string | null }> {
    const { data, error } = await supabase
        .from(table)
        .select(`id, ${entityColumn}`)
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
    const row = data as Record<string, unknown> | null;
    return {
        id: readText(row?.id),
        entityId: readText(row?.[entityColumn]),
        error: error?.message ?? null,
    };
}

async function loadCachedCalibrationResponse(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
): Promise<{
    response: Record<string, unknown> | null;
    error: string | null;
}> {
    const { data, error } = await supabase
        .from('outcome_calibration_runs')
        .select('id, run_status, source_event_count, eligible_rows, synthetic_rows_excluded, bucket_count, source_digest, blockers, warnings')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) return { response: null, error: error.message };
    if (!data) return { response: null, error: null };
    const row = data as Record<string, unknown>;
    const eligibleRows = readNumber(row.eligible_rows) ?? 0;
    const syntheticRowsExcluded = readNumber(row.synthetic_rows_excluded) ?? 0;

    return {
        response: {
            calibration: {
                run_id: readText(row.id),
                run_status: readText(row.run_status),
                source_event_count: readNumber(row.source_event_count) ?? 0,
                eligible_rows: eligibleRows,
                synthetic_rows_excluded: syntheticRowsExcluded,
                bucket_count: readNumber(row.bucket_count) ?? 0,
                source_digest: readText(row.source_digest),
                blockers: Array.isArray(row.blockers) ? row.blockers : [],
                warnings: Array.isArray(row.warnings) ? row.warnings : [],
            },
            eligible_episode_count: eligibleRows,
            linked_calibration_row_count: eligibleRows,
            synthetic_rows_excluded: syntheticRowsExcluded,
            cached: true,
            error: null,
        },
        error: null,
    };
}

async function loadCachedNetworkSnapshot(
    supabase: ReturnType<typeof getSupabaseServer>,
    tenantId: string,
    requestId: string,
): Promise<{
    id: string | null;
    snapshot: Record<string, unknown> | null;
    error: string | null;
}> {
    const { data, error } = await supabase
        .from('amr_outcome_network_snapshots')
        .select('id, snapshot')
        .eq('tenant_id', tenantId)
        .eq('request_id', requestId)
        .maybeSingle();
    const row = data as Record<string, unknown> | null;
    return {
        id: readText(row?.id),
        snapshot: Object.keys(asRecord(row?.snapshot)).length > 0
            ? asRecord(row?.snapshot)
            : null,
        error: error?.message ?? null,
    };
}

function networkStorageError(detail: string) {
    const missing = detail.includes('amr_network_site_events')
        || detail.includes('amr_outcome_episode_events')
        || detail.includes('amr_outcome_network_snapshots');
    return NextResponse.json(
        {
            error: missing ? 'amr_outcome_network_storage_missing' : 'amr_outcome_network_store_failed',
            detail,
            migration: missing
                ? 'supabase/migrations/20260723000000_amr_outcome_network_pilot.sql'
                : null,
        },
        { status: 503 },
    );
}

function readDifferentials(row: Record<string, unknown>): Array<{ label: string; probability: number }> {
    const outputPayload = asRecord(row.output_payload);
    const diagnosis = asRecord(outputPayload.diagnosis);
    const candidates = Array.isArray(row.differentials) && row.differentials.length > 0
        ? row.differentials
        : Array.isArray(outputPayload.differentials) && outputPayload.differentials.length > 0
            ? outputPayload.differentials
            : Array.isArray(diagnosis.top_differentials)
                ? diagnosis.top_differentials
                : [];
    return candidates.flatMap((entry) => {
        const record = asRecord(entry);
        const label = readText(record.label) ?? readText(record.name) ?? readText(record.condition);
        const probability = readNumber(record.probability)
            ?? readNumber(record.p)
            ?? readNumber(record.confidence)
            ?? readNumber(record.confidence_score);
        return label && probability != null
            ? [{ label, probability: Math.max(0, Math.min(1, probability)) }]
            : [];
    });
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function uniqueStrings(values: Array<string | null>): string[] {
    return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
