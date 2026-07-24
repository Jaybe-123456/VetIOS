import { createHash } from 'crypto';

export const AMR_PILOT_TARGET_EPISODES = 250;
export const AMR_PILOT_MIN_LABS = 1;
export const AMR_PILOT_MIN_CLINICS = 3;
export const AMR_PILOT_TARGET_CLINICS = 5;

export const AMR_NETWORK_SITE_TYPES = ['laboratory', 'clinic'] as const;
export type AMRNetworkSiteType = (typeof AMR_NETWORK_SITE_TYPES)[number];

export const AMR_NETWORK_SITE_EVENT_TYPES = [
    'invited',
    'enrolled',
    'data_use_approved',
    'data_use_revoked',
    'connector_verified',
    'connector_failed',
    'paused',
    'retired',
] as const;
export type AMRNetworkSiteEventType = (typeof AMR_NETWORK_SITE_EVENT_TYPES)[number];

export const AMR_OUTCOME_EPISODE_EVENT_TYPES = [
    'episode_opened',
    'culture_received',
    'ast_verified',
    'treatment_recorded',
    'clinical_review_completed',
    'outcome_confirmed',
    'eligibility_evaluated',
    'episode_closed',
] as const;
export type AMROutcomeEpisodeEventType = (typeof AMR_OUTCOME_EPISODE_EVENT_TYPES)[number];

export interface AMRNetworkSiteEventRow {
    id?: string | null;
    tenant_id: string;
    request_id?: string | null;
    site_id: string;
    site_type: AMRNetworkSiteType | string;
    event_type: AMRNetworkSiteEventType | string;
    display_label?: string | null;
    site_ref_hash?: string | null;
    connector_key?: string | null;
    actor_id?: string | null;
    evidence?: Record<string, unknown> | null;
    event_hash?: string | null;
    occurred_at?: string | null;
    created_at?: string | null;
}

export interface AMROutcomeEpisodeEventRow {
    id?: string | null;
    tenant_id: string;
    request_id?: string | null;
    episode_id: string;
    site_id?: string | null;
    lab_site_id?: string | null;
    event_type: AMROutcomeEpisodeEventType | string;
    case_id?: string | null;
    inference_event_id?: string | null;
    clinical_outcome_id?: string | null;
    amr_stewardship_event_id?: string | null;
    amr_lab_feed_event_id?: string | null;
    species?: string | null;
    pathogen_key?: string | null;
    drug_class?: string | null;
    outcome_status?: string | null;
    consent_status?: string | null;
    review_status?: string | null;
    reviewer_ref_hash?: string | null;
    is_synthetic?: boolean | null;
    deidentified?: boolean | null;
    source_record_digest?: string | null;
    evidence_packet_hash?: string | null;
    calibration_eligible?: boolean | null;
    federation_eligible?: boolean | null;
    eligibility_blockers?: string[] | null;
    event_payload?: Record<string, unknown> | null;
    event_hash?: string | null;
    actor_id?: string | null;
    occurred_at?: string | null;
    created_at?: string | null;
}

export interface AMRCalibrationEvidenceRow {
    calibration_run_id?: string | null;
    evidence_type?: string | null;
    outcome_label_count?: number | null;
    expected_calibration_error?: number | null;
    brier_score?: number | null;
    calibration_status?: string | null;
    created_at?: string | null;
}

export interface AMRSurveillanceEvidenceRow {
    id?: string | null;
    pathogen_key?: string | null;
    drug_class?: string | null;
    trend_bucket_key?: string | null;
    lab_feed_status?: string | null;
    resistance_signal_score?: number | null;
    one_health_export_ready?: boolean | null;
    source_record_digest?: string | null;
    observed_at?: string | null;
    created_at?: string | null;
}

export interface AMRNetworkSiteSummary {
    site_id: string;
    site_type: AMRNetworkSiteType;
    display_label: string;
    connector_key: string | null;
    enrolled: boolean;
    data_use_approved: boolean;
    connector_verified: boolean;
    operational: boolean;
    status: 'invited' | 'enrolling' | 'operational' | 'paused' | 'retired';
    blockers: string[];
    latest_event_at: string | null;
}

export interface AMROutcomeEpisodeAssessment {
    episode_id: string;
    site_id: string | null;
    lab_site_id: string | null;
    species: string | null;
    pathogen_key: string | null;
    drug_class: string | null;
    event_count: number;
    stage:
        | 'opened'
        | 'culture_received'
        | 'ast_verified'
        | 'treatment_recorded'
        | 'review_completed'
        | 'outcome_confirmed'
        | 'closed';
    completion_percent: number;
    culture_received: boolean;
    ast_verified: boolean;
    treatment_recorded: boolean;
    review_completed: boolean;
    outcome_confirmed: boolean;
    closed: boolean;
    outcome_status: string | null;
    deidentified: boolean;
    synthetic: boolean;
    consent_approved: boolean;
    source_site_operational: boolean;
    lab_site_operational: boolean;
    inference_event_id: string | null;
    clinical_outcome_id: string | null;
    amr_stewardship_event_id: string | null;
    amr_lab_feed_event_id: string | null;
    source_record_digest: string | null;
    evidence_packet_hash: string | null;
    calibration_eligible: boolean;
    federation_eligible: boolean;
    blockers: string[];
    latest_event_at: string | null;
}

export interface AMROutcomeNetworkSnapshot {
    schema_version: 'amr-outcome-network-pilot-v1';
    generated_at: string;
    pilot_status: 'not_configured' | 'enrolling' | 'collecting' | 'evidence_ready';
    targets: {
        minimum_laboratories: number;
        minimum_clinics: number;
        target_clinics: number;
        outcome_confirmed_episodes: number;
    };
    sites: {
        total: number;
        operational_laboratories: number;
        operational_clinics: number;
        connector_verified: number;
        data_use_approved: number;
        rows: AMRNetworkSiteSummary[];
    };
    episodes: {
        total: number;
        culture_received: number;
        ast_verified: number;
        treatment_recorded: number;
        review_completed: number;
        outcome_confirmed: number;
        calibration_eligible: number;
        federation_eligible: number;
        synthetic_excluded: number;
        privacy_blocked: number;
        target_progress_percent: number;
        rows: AMROutcomeEpisodeAssessment[];
    };
    calibration_proof: {
        status: 'unavailable' | 'baseline_only' | 'improved' | 'stable' | 'regressed';
        run_count: number;
        outcome_count: number;
        baseline_ece: number | null;
        current_ece: number | null;
        ece_delta: number | null;
        current_brier_score: number | null;
    };
    surveillance_proof: {
        status: 'unavailable' | 'collecting' | 'operational' | 'evidence_ready';
        total_records: number;
        outcome_linked_records: number;
        outcome_link_rate: number;
        one_health_export_ready_records: number;
        resistance_signal_records: number;
        unique_trend_buckets: number;
        unique_pathogens: number;
        unique_drug_classes: number;
        source_digest_bundle_hash: string;
    };
    federation_manifest: {
        eligible_episode_count: number;
        network_threshold_met: boolean;
        source_digest_bundle_hash: string;
        episode_ids: string[];
    };
    blockers: string[];
    next_actions: string[];
    proof_hash: string;
}

export function buildAMRNetworkSiteSummaries(rows: AMRNetworkSiteEventRow[]): AMRNetworkSiteSummary[] {
    const grouped = groupBy(rows, (row) => row.site_id);

    return Array.from(grouped.entries())
        .map(([siteId, events]) => {
            const sorted = sortByOccurredAt(events);
            let enrolled = false;
            let dataUseApproved = false;
            let connectorVerified = false;
            let paused = false;
            let retired = false;

            for (const event of sorted) {
                switch (event.event_type) {
                    case 'enrolled':
                        enrolled = true;
                        paused = false;
                        break;
                    case 'data_use_approved':
                        dataUseApproved = true;
                        break;
                    case 'data_use_revoked':
                        dataUseApproved = false;
                        break;
                    case 'connector_verified':
                        connectorVerified = true;
                        break;
                    case 'connector_failed':
                        connectorVerified = false;
                        break;
                    case 'paused':
                        paused = true;
                        break;
                    case 'retired':
                        retired = true;
                        paused = false;
                        connectorVerified = false;
                        break;
                }
            }

            const latest = sorted.at(-1) ?? events[0];
            const siteType: AMRNetworkSiteType = latest?.site_type === 'laboratory' ? 'laboratory' : 'clinic';
            const blockers = uniqueStrings([
                ...(!enrolled ? ['site_enrollment_incomplete'] : []),
                ...(!dataUseApproved ? ['data_use_approval_missing'] : []),
                ...(!connectorVerified ? ['connector_verification_missing'] : []),
                ...(paused ? ['site_paused'] : []),
                ...(retired ? ['site_retired'] : []),
            ]);
            const operational = blockers.length === 0;
            const status: AMRNetworkSiteSummary['status'] = retired
                ? 'retired'
                : paused
                    ? 'paused'
                    : operational
                        ? 'operational'
                        : enrolled
                            ? 'enrolling'
                            : 'invited';

            return {
                site_id: siteId,
                site_type: siteType,
                display_label: latestNonEmpty(sorted, (row) => row.display_label)
                    ?? `${siteType} ${siteId.slice(0, 8)}`,
                connector_key: latestNonEmpty(sorted, (row) => row.connector_key),
                enrolled,
                data_use_approved: dataUseApproved,
                connector_verified: connectorVerified,
                operational,
                status,
                blockers,
                latest_event_at: readTimestamp(latest?.occurred_at ?? latest?.created_at),
            };
        })
        .sort((left, right) => {
            if (left.operational !== right.operational) return left.operational ? -1 : 1;
            if (left.site_type !== right.site_type) return left.site_type.localeCompare(right.site_type);
            return left.display_label.localeCompare(right.display_label);
        });
}

export function assessAMROutcomeEpisode(
    rows: AMROutcomeEpisodeEventRow[],
    sites: AMRNetworkSiteSummary[],
): AMROutcomeEpisodeAssessment {
    if (rows.length === 0) throw new Error('AMR outcome episode rows are required.');
    const sorted = sortByOccurredAt(rows);
    const latest = sorted.at(-1) ?? rows[0];
    const eventTypes = new Set(sorted.map((row) => row.event_type));
    const siteId = latestNonEmpty(sorted, (row) => row.site_id);
    const labSiteId = latestNonEmpty(sorted, (row) => row.lab_site_id);
    const inferenceEventId = latestNonEmpty(sorted, (row) => row.inference_event_id);
    const clinicalOutcomeId = latestNonEmpty(sorted, (row) => row.clinical_outcome_id);
    const amrStewardshipEventId = latestNonEmpty(
        sorted,
        (row) => row.amr_stewardship_event_id,
    );
    const amrLabFeedEventId = latestNonEmpty(sorted, (row) => row.amr_lab_feed_event_id);
    const sourceRecordDigest = latestNonEmpty(sorted, (row) => row.source_record_digest);
    const evidencePacketHash = latestNonEmpty(sorted, (row) => row.evidence_packet_hash);
    const consentStatus = latestNonEmpty(sorted, (row) => row.consent_status);
    const reviewStatus = latestNonEmpty(sorted, (row) => row.review_status);
    const outcomeStatus = latestNonEmpty(sorted, (row) => row.outcome_status);
    const sourceSite = sites.find((site) => site.site_id === siteId) ?? null;
    const labSite = sites.find((site) => site.site_id === labSiteId) ?? null;
    const sourceSiteOperational = sourceSite?.site_type === 'clinic' && sourceSite.operational;
    const labSiteOperational = labSite?.site_type === 'laboratory' && labSite.operational;
    const cultureReceived = eventTypes.has('culture_received') || eventTypes.has('ast_verified');
    const astVerified = eventTypes.has('ast_verified');
    const treatmentRecorded = eventTypes.has('treatment_recorded');
    const reviewCompleted = eventTypes.has('clinical_review_completed') && reviewStatus === 'completed';
    const outcomeConfirmed = eventTypes.has('outcome_confirmed')
        && Boolean(outcomeStatus && outcomeStatus !== 'unknown');
    const closed = eventTypes.has('episode_closed');
    const synthetic = sorted.some((row) => row.is_synthetic === true);
    const deidentified = sorted.every((row) => row.deidentified === true);
    const consentApproved = consentStatus === 'approved';
    const sourceDigestValid = isSha256(sourceRecordDigest);
    const evidenceHashValid = isSha256(evidencePacketHash);
    const calibrationEligible = Boolean(
        outcomeConfirmed
        && astVerified
        && treatmentRecorded
        && reviewCompleted
        && inferenceEventId
        && clinicalOutcomeId
        && amrStewardshipEventId
        && amrLabFeedEventId
        && consentApproved
        && deidentified
        && !synthetic
        && sourceDigestValid
        && evidenceHashValid
        && closed,
    );
    const federationEligible = Boolean(
        calibrationEligible
        && sourceSiteOperational
        && labSiteOperational,
    );
    const blockers = uniqueStrings([
        ...(!cultureReceived ? ['culture_result_missing'] : []),
        ...(!astVerified ? ['ast_verification_missing'] : []),
        ...(!treatmentRecorded ? ['treatment_record_missing'] : []),
        ...(!reviewCompleted ? ['clinician_review_missing'] : []),
        ...(!outcomeConfirmed ? ['confirmed_outcome_missing'] : []),
        ...(!inferenceEventId ? ['linked_inference_missing'] : []),
        ...(!clinicalOutcomeId ? ['linked_clinical_outcome_missing'] : []),
        ...(!amrStewardshipEventId ? ['amr_stewardship_event_missing'] : []),
        ...(!amrLabFeedEventId ? ['amr_lab_feed_event_missing'] : []),
        ...(!consentApproved ? ['learning_consent_missing'] : []),
        ...(!deidentified ? ['deidentification_failed'] : []),
        ...(synthetic ? ['synthetic_episode_excluded'] : []),
        ...(!sourceSiteOperational ? ['operational_clinic_missing'] : []),
        ...(!labSiteOperational ? ['operational_laboratory_missing'] : []),
        ...(!sourceDigestValid ? ['source_record_digest_missing'] : []),
        ...(!evidenceHashValid ? ['evidence_packet_hash_missing'] : []),
        ...(!closed ? ['episode_closure_missing'] : []),
    ]);
    const completedStages = [
        cultureReceived,
        astVerified,
        treatmentRecorded,
        reviewCompleted,
        outcomeConfirmed,
        closed,
    ].filter(Boolean).length;

    return {
        episode_id: rows[0].episode_id,
        site_id: siteId,
        lab_site_id: labSiteId,
        species: latestNonEmpty(sorted, (row) => row.species),
        pathogen_key: latestNonEmpty(sorted, (row) => row.pathogen_key),
        drug_class: latestNonEmpty(sorted, (row) => row.drug_class),
        event_count: rows.length,
        stage: resolveEpisodeStage({
            closed,
            outcomeConfirmed,
            reviewCompleted,
            treatmentRecorded,
            astVerified,
            cultureReceived,
        }),
        completion_percent: roundMetric(completedStages / 6 * 100),
        culture_received: cultureReceived,
        ast_verified: astVerified,
        treatment_recorded: treatmentRecorded,
        review_completed: reviewCompleted,
        outcome_confirmed: outcomeConfirmed,
        closed,
        outcome_status: outcomeStatus,
        deidentified,
        synthetic,
        consent_approved: consentApproved,
        source_site_operational: sourceSiteOperational,
        lab_site_operational: labSiteOperational,
        inference_event_id: inferenceEventId,
        clinical_outcome_id: clinicalOutcomeId,
        amr_stewardship_event_id: amrStewardshipEventId,
        amr_lab_feed_event_id: amrLabFeedEventId,
        source_record_digest: sourceRecordDigest,
        evidence_packet_hash: evidencePacketHash,
        calibration_eligible: calibrationEligible,
        federation_eligible: federationEligible,
        blockers,
        latest_event_at: readTimestamp(latest?.occurred_at ?? latest?.created_at),
    };
}

export function buildAMROutcomeNetworkSnapshot(input: {
    siteEvents: AMRNetworkSiteEventRow[];
    episodeEvents: AMROutcomeEpisodeEventRow[];
    calibrationEvidence?: AMRCalibrationEvidenceRow[];
    surveillanceEvidence?: AMRSurveillanceEvidenceRow[];
    generatedAt?: string;
}): AMROutcomeNetworkSnapshot {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const sites = buildAMRNetworkSiteSummaries(input.siteEvents);
    const episodeGroups = groupBy(input.episodeEvents, (row) => row.episode_id);
    const episodes = Array.from(episodeGroups.values())
        .map((rows) => assessAMROutcomeEpisode(rows, sites))
        .sort((left, right) => (right.latest_event_at ?? '').localeCompare(left.latest_event_at ?? ''));
    const operationalLabs = sites.filter((site) => site.site_type === 'laboratory' && site.operational).length;
    const operationalClinics = sites.filter((site) => site.site_type === 'clinic' && site.operational).length;
    const federationEligible = episodes.filter((episode) => episode.federation_eligible);
    const outcomeConfirmed = episodes.filter((episode) => episode.outcome_confirmed).length;
    const networkThresholdMet = operationalLabs >= AMR_PILOT_MIN_LABS
        && operationalClinics >= AMR_PILOT_MIN_CLINICS
        && federationEligible.length >= AMR_PILOT_TARGET_EPISODES;
    const calibrationProof = buildAMRCalibrationProof(input.calibrationEvidence ?? []);
    const surveillanceProof = buildAMRSurveillanceProof(
        input.surveillanceEvidence ?? [],
        episodes,
    );
    const evidenceThresholdMet = networkThresholdMet
        && calibrationProof.status === 'improved'
        && surveillanceProof.status === 'evidence_ready';
    const blockers = uniqueStrings([
        ...(operationalLabs < AMR_PILOT_MIN_LABS ? ['operational_laboratory_required'] : []),
        ...(operationalClinics < AMR_PILOT_MIN_CLINICS ? [`minimum_${AMR_PILOT_MIN_CLINICS}_operational_clinics_required`] : []),
        ...(outcomeConfirmed < AMR_PILOT_TARGET_EPISODES ? [`${AMR_PILOT_TARGET_EPISODES - outcomeConfirmed}_confirmed_outcomes_remaining`] : []),
        ...(federationEligible.length < AMR_PILOT_TARGET_EPISODES ? [`${AMR_PILOT_TARGET_EPISODES - federationEligible.length}_federation_eligible_episodes_remaining`] : []),
        ...(calibrationProof.status !== 'improved' ? ['amr_calibration_improvement_not_proven'] : []),
        ...(surveillanceProof.status !== 'evidence_ready' ? ['outcome_linked_surveillance_evidence_incomplete'] : []),
    ]);
    const federationSourceDigest = hashJson(federationEligible.map((episode) => ({
        episode_id: episode.episode_id,
        source_record_digest: episode.source_record_digest,
        evidence_packet_hash: episode.evidence_packet_hash,
    })));
    const pilotStatus: AMROutcomeNetworkSnapshot['pilot_status'] = input.siteEvents.length === 0
        ? 'not_configured'
        : operationalLabs < AMR_PILOT_MIN_LABS || operationalClinics < AMR_PILOT_MIN_CLINICS
            ? 'enrolling'
            : evidenceThresholdMet
                ? 'evidence_ready'
                : 'collecting';
    const snapshotWithoutHash = {
        schema_version: 'amr-outcome-network-pilot-v1' as const,
        generated_at: generatedAt,
        pilot_status: pilotStatus,
        targets: {
            minimum_laboratories: AMR_PILOT_MIN_LABS,
            minimum_clinics: AMR_PILOT_MIN_CLINICS,
            target_clinics: AMR_PILOT_TARGET_CLINICS,
            outcome_confirmed_episodes: AMR_PILOT_TARGET_EPISODES,
        },
        sites: {
            total: sites.length,
            operational_laboratories: operationalLabs,
            operational_clinics: operationalClinics,
            connector_verified: sites.filter((site) => site.connector_verified).length,
            data_use_approved: sites.filter((site) => site.data_use_approved).length,
            rows: sites,
        },
        episodes: {
            total: episodes.length,
            culture_received: episodes.filter((episode) => episode.culture_received).length,
            ast_verified: episodes.filter((episode) => episode.ast_verified).length,
            treatment_recorded: episodes.filter((episode) => episode.treatment_recorded).length,
            review_completed: episodes.filter((episode) => episode.review_completed).length,
            outcome_confirmed: outcomeConfirmed,
            calibration_eligible: episodes.filter((episode) => episode.calibration_eligible).length,
            federation_eligible: federationEligible.length,
            synthetic_excluded: episodes.filter((episode) => episode.synthetic).length,
            privacy_blocked: episodes.filter((episode) => !episode.deidentified).length,
            target_progress_percent: roundMetric(
                Math.min(100, federationEligible.length / AMR_PILOT_TARGET_EPISODES * 100),
            ),
            rows: episodes,
        },
        calibration_proof: calibrationProof,
        surveillance_proof: surveillanceProof,
        federation_manifest: {
            eligible_episode_count: federationEligible.length,
            network_threshold_met: networkThresholdMet,
            source_digest_bundle_hash: federationSourceDigest,
            episode_ids: federationEligible.map((episode) => episode.episode_id).sort(),
        },
        blockers,
        next_actions: buildNextActions({
            operationalLabs,
            operationalClinics,
            outcomeConfirmed,
            federationEligible: federationEligible.length,
            calibrationStatus: calibrationProof.status,
            surveillanceStatus: surveillanceProof.status,
        }),
    };

    return {
        ...snapshotWithoutHash,
        proof_hash: hashJson(snapshotWithoutHash),
    };
}

export function buildAMRSurveillanceProof(
    rows: AMRSurveillanceEvidenceRow[],
    episodes: AMROutcomeEpisodeAssessment[],
): AMROutcomeNetworkSnapshot['surveillance_proof'] {
    const normalizedRows = rows.filter((row) => isSha256(readText(row.source_record_digest)));
    const eligibleLabFeedIds = new Set(
        episodes
            .filter((episode) => episode.outcome_confirmed)
            .map((episode) => episode.amr_lab_feed_event_id)
            .filter((value): value is string => Boolean(value)),
    );
    const outcomeLinkedRows = normalizedRows.filter((row) => Boolean(row.id && eligibleLabFeedIds.has(row.id)));
    const exportReadyRows = normalizedRows.filter((row) => row.one_health_export_ready === true);
    const resistanceSignalRows = normalizedRows.filter((row) => {
        const status = readText(row.lab_feed_status);
        const score = readNumber(row.resistance_signal_score) ?? 0;
        return status === 'resistance_signal'
            || status === 'one_health_export_ready'
            || score >= 0.45;
    });
    const linkedExportReadyRows = outcomeLinkedRows.filter((row) => row.one_health_export_ready === true);
    const status: AMROutcomeNetworkSnapshot['surveillance_proof']['status'] = normalizedRows.length === 0
        ? 'unavailable'
        : outcomeLinkedRows.length === 0
            ? 'collecting'
            : linkedExportReadyRows.length >= AMR_PILOT_TARGET_EPISODES
                ? 'evidence_ready'
                : 'operational';

    return {
        status,
        total_records: normalizedRows.length,
        outcome_linked_records: outcomeLinkedRows.length,
        outcome_link_rate: roundMetric(
            normalizedRows.length > 0 ? outcomeLinkedRows.length / normalizedRows.length : 0,
        ),
        one_health_export_ready_records: exportReadyRows.length,
        resistance_signal_records: resistanceSignalRows.length,
        unique_trend_buckets: uniqueNonEmptyCount(normalizedRows, (row) => row.trend_bucket_key),
        unique_pathogens: uniqueNonEmptyCount(normalizedRows, (row) => row.pathogen_key),
        unique_drug_classes: uniqueNonEmptyCount(normalizedRows, (row) => row.drug_class),
        source_digest_bundle_hash: hashJson(
            normalizedRows
                .map((row) => row.source_record_digest)
                .filter(Boolean)
                .sort(),
        ),
    };
}

export function buildAMRCalibrationProof(rows: AMRCalibrationEvidenceRow[]): AMROutcomeNetworkSnapshot['calibration_proof'] {
    const filtered = rows.filter((row) => {
        const evidenceType = readText(row.evidence_type)?.toLowerCase();
        return evidenceType === 'amr' || evidenceType === 'amr_culture_ast';
    });
    const grouped = groupBy(filtered, (row) => row.calibration_run_id ?? `unlinked:${row.created_at ?? 'unknown'}`);
    const runs = Array.from(grouped.entries()).map(([runId, buckets]) => {
        const outcomeCount = buckets.reduce((sum, row) => sum + Math.max(0, readNumber(row.outcome_label_count) ?? 0), 0);
        return {
            run_id: runId,
            created_at: buckets.map((row) => readTimestamp(row.created_at)).filter(Boolean).sort().at(-1) ?? null,
            outcome_count: outcomeCount,
            ece: weightedAverage(buckets, 'expected_calibration_error'),
            brier_score: weightedAverage(buckets, 'brier_score'),
        };
    }).sort((left, right) => (left.created_at ?? '').localeCompare(right.created_at ?? ''));
    const baseline = runs[0] ?? null;
    const current = runs.at(-1) ?? null;
    const delta = baseline?.ece != null && current?.ece != null && runs.length > 1
        ? roundMetric(current.ece - baseline.ece)
        : null;
    const status: AMROutcomeNetworkSnapshot['calibration_proof']['status'] = runs.length === 0
        ? 'unavailable'
        : runs.length === 1 || delta == null
            ? 'baseline_only'
            : delta < -0.005
                ? 'improved'
                : delta > 0.005
                    ? 'regressed'
                    : 'stable';

    return {
        status,
        run_count: runs.length,
        outcome_count: current?.outcome_count ?? 0,
        baseline_ece: baseline?.ece ?? null,
        current_ece: current?.ece ?? null,
        ece_delta: delta,
        current_brier_score: current?.brier_score ?? null,
    };
}

export function hashAMRNetworkValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function hashAMRNetworkJson(value: unknown): string {
    return hashJson(value);
}

function buildNextActions(input: {
    operationalLabs: number;
    operationalClinics: number;
    outcomeConfirmed: number;
    federationEligible: number;
    calibrationStatus: AMROutcomeNetworkSnapshot['calibration_proof']['status'];
    surveillanceStatus: AMROutcomeNetworkSnapshot['surveillance_proof']['status'];
}): string[] {
    return uniqueStrings([
        ...(input.operationalLabs < AMR_PILOT_MIN_LABS ? ['enroll_and_verify_one_reference_laboratory'] : []),
        ...(input.operationalClinics < AMR_PILOT_MIN_CLINICS ? [`enroll_${AMR_PILOT_MIN_CLINICS - input.operationalClinics}_more_clinics`] : []),
        ...(input.outcomeConfirmed < AMR_PILOT_TARGET_EPISODES ? ['continue_culture_ast_treatment_review_outcome_closure'] : []),
        ...(input.federationEligible < input.outcomeConfirmed ? ['resolve_episode_federation_eligibility_blockers'] : []),
        ...(input.calibrationStatus === 'unavailable' ? ['run_first_amr_outcome_calibration_baseline'] : []),
        ...(input.calibrationStatus === 'baseline_only' ? ['run_followup_amr_calibration_after_additional_outcomes'] : []),
        ...(input.calibrationStatus === 'regressed' ? ['hold_model_promotion_and_review_amr_calibration_regression'] : []),
        ...(input.surveillanceStatus === 'unavailable' ? ['ingest_first_verified_ast_surveillance_record'] : []),
        ...(input.surveillanceStatus === 'collecting' ? ['link_amr_surveillance_records_to_confirmed_outcomes'] : []),
        ...(input.surveillanceStatus === 'operational' ? ['continue_outcome_linked_one_health_export_evidence_to_250'] : []),
        ...(input.operationalLabs >= AMR_PILOT_MIN_LABS
            && input.operationalClinics >= AMR_PILOT_MIN_CLINICS
            && input.federationEligible >= AMR_PILOT_TARGET_EPISODES
            && input.calibrationStatus === 'improved'
            && input.surveillanceStatus === 'evidence_ready'
            ? ['submit_federation_candidate_with_amr_evidence_manifest'] : []),
    ]);
}

function resolveEpisodeStage(input: {
    closed: boolean;
    outcomeConfirmed: boolean;
    reviewCompleted: boolean;
    treatmentRecorded: boolean;
    astVerified: boolean;
    cultureReceived: boolean;
}): AMROutcomeEpisodeAssessment['stage'] {
    if (input.closed) return 'closed';
    if (input.outcomeConfirmed) return 'outcome_confirmed';
    if (input.reviewCompleted) return 'review_completed';
    if (input.treatmentRecorded) return 'treatment_recorded';
    if (input.astVerified) return 'ast_verified';
    if (input.cultureReceived) return 'culture_received';
    return 'opened';
}

function weightedAverage(
    rows: AMRCalibrationEvidenceRow[],
    key: 'expected_calibration_error' | 'brier_score',
): number | null {
    let weightedTotal = 0;
    let weightTotal = 0;
    for (const row of rows) {
        const value = readNumber(row[key]);
        if (value == null) continue;
        const weight = Math.max(1, readNumber(row.outcome_label_count) ?? 1);
        weightedTotal += value * weight;
        weightTotal += weight;
    }
    return weightTotal > 0 ? roundMetric(weightedTotal / weightTotal) : null;
}

function latestNonEmpty<T>(
    rows: T[],
    read: (row: T) => string | null | undefined,
): string | null {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index];
        if (row == null) continue;
        const value = readText(read(row));
        if (value) return value;
    }
    return null;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
        const value = key(row);
        const entries = grouped.get(value) ?? [];
        entries.push(row);
        grouped.set(value, entries);
    }
    return grouped;
}

function sortByOccurredAt<T extends { occurred_at?: string | null; created_at?: string | null }>(rows: T[]): T[] {
    return [...rows].sort((left, right) => {
        const leftAt = readTimestamp(left.occurred_at ?? left.created_at) ?? '';
        const rightAt = readTimestamp(right.occurred_at ?? right.created_at) ?? '';
        return leftAt.localeCompare(rightAt);
    });
}

function isSha256(value: string | null): boolean {
    return Boolean(value && /^[a-f0-9]{64}$/.test(value));
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readTimestamp(value: unknown): string | null {
    const text = readText(value);
    if (!text) return null;
    return Number.isNaN(Date.parse(text)) ? null : text;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean))).sort();
}

function uniqueNonEmptyCount<T>(rows: T[], read: (row: T) => unknown): number {
    return new Set(rows.map((row) => readText(read(row))).filter(Boolean)).size;
}

function roundMetric(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

function hashJson(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}
