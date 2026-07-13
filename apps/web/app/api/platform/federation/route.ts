import { NextResponse } from 'next/server';
import {
    buildForbiddenRouteResponse,
    buildRouteAuthorizationContext,
    isRouteAuthorizationGranted,
    type RouteAuthorizationContext,
} from '@/lib/auth/authorization';
import {
    enforceVetiosHighRiskRouteGate,
    mapFederationActionToAuthTrustAction,
} from '@/lib/auth/authTrustRouteGate';
import { resolveExperimentApiActor } from '@/lib/auth/internalApi';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    buildFederatedAggregateArtifacts,
    type FederatedAggregateTaskType,
} from '@/lib/federation/aggregateBuilder';
import {
    runFederatedChampionSurveillance,
    type FederatedChampionSurveillanceThresholds,
} from '@/lib/federation/championSurveillance';
import { generateFederatedCandidateEvidence } from '@/lib/federation/evidenceGenerator';
import { generateFederatedExternalValidationPackets } from '@/lib/federation/externalValidation';
import { registerFederatedRoundCandidateModels } from '@/lib/federation/modelPromotion';
import { runFederatedPromotionAutomation } from '@/lib/federation/promotionAutomation';
import type { LearningTaskType } from '@/lib/learningEngine/types';
import {
    EXTERNAL_VALIDATION_ATTESTATION_STATUSES,
    EXTERNAL_VALIDATION_ATTESTOR_KINDS,
    EXTERNAL_VALIDATION_VERIFICATION_STATUSES,
    type ExternalValidationAttestationStatus,
    type ExternalValidationAttestorKind,
    type ExternalValidationVerificationStatus,
} from '@/lib/platform/externalValidation';
import {
    finalizeFederationRoundSecureAggregation,
    issueFederationRoundNodeTasks,
    reviewFederatedUpdateSubmission,
    type CoordinatorTaskType,
    type CoordinatorUpdateReviewStatus,
} from '@/lib/federation/coordinatorRuntime';
import {
    FEDERATION_NODE_ATTESTATION_ENVIRONMENTS,
    FEDERATION_NODE_ATTESTATION_EVENT_KINDS,
    FEDERATION_NODE_ATTESTATION_STATUSES,
    FEDERATION_NODE_ATTESTATION_VERIFICATION_STATUSES,
    recordFederationNodeAttestationEvent,
    type FederationNodeAttestationEnvironment,
    type FederationNodeAttestationEventKind,
    type FederationNodeAttestationStatus,
    type FederationNodeAttestationVerificationStatus,
} from '@/lib/federation/nodeAttestation';
import {
    enrollFederationTenant,
    getFederationControlPlaneSnapshot,
    publishFederatedSiteSnapshots,
    runDueFederationAutomation,
    runFederationAutomation,
    runFederationRound,
    setFederationGovernancePolicy,
    upsertFederationMembership,
    type FederationMembershipStatus,
    type FederationParticipationMode,
} from '@/lib/federation/service';
import type { FederationGovernancePolicy } from '@/lib/federation/policy';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

type FederationAction =
    | {
        action?: 'upsert_membership';
        federation_key?: string | null;
        coordinator_tenant_id?: string | null;
        participation_mode?: FederationParticipationMode | null;
        status?: FederationMembershipStatus | null;
        weight?: number | string | null;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'publish_snapshot';
        federation_key?: string | null;
    }
    | {
        action: 'run_round';
        federation_key?: string | null;
        snapshot_max_age_hours?: number | string | null;
    }
    | {
        action: 'enroll_tenant';
        federation_key?: string | null;
        target_tenant_id?: string | null;
        participation_mode?: FederationParticipationMode | null;
        status?: FederationMembershipStatus | null;
        weight?: number | string | null;
        metadata?: Record<string, unknown>;
    }
    | {
        action: 'set_governance';
        federation_key?: string | null;
        enrollment_mode?: string | null;
        auto_enroll_enabled?: boolean | string | null;
        approved_tenant_ids?: string[] | string | null;
        auto_publish_snapshots?: boolean | string | null;
        auto_run_rounds?: boolean | string | null;
        round_interval_hours?: number | string | null;
        snapshot_max_age_hours?: number | string | null;
        minimum_participants?: number | string | null;
        minimum_benchmark_pass_rate?: number | string | null;
        maximum_calibration_avg_ece?: number | string | null;
        allow_shadow_participants?: boolean | string | null;
    }
    | {
        action: 'run_automation';
        federation_key?: string | null;
        force?: boolean | string | null;
    }
    | {
        action: 'run_due_automation';
        federation_key?: string | null;
    }
    | {
        action: 'register_federated_candidate';
        federation_key?: string | null;
        federation_round_id?: string | null;
    }
    | {
        action: 'issue_round_node_tasks';
        federation_key?: string | null;
        federation_round_id?: string | null;
        task_types?: CoordinatorTaskType[] | string | null;
        dataset_policy?: Record<string, unknown>;
        secure_aggregation_config?: Record<string, unknown>;
        task_payload?: Record<string, unknown>;
        due_at?: string | null;
    }
    | {
        action: 'record_federation_node_attestation';
        federation_key?: string | null;
        target_tenant_id?: string | null;
        node_ref?: string | null;
        partner_ref?: string | null;
        membership_id?: string | null;
        attestation_event?: string | null;
        attestation_status?: string | null;
        verification_status?: string | null;
        deployment_environment?: string | null;
        software_version?: string | null;
        software_artifact_hash?: string | null;
        build_provenance_hash?: string | null;
        sbom_hash?: string | null;
        signed_payload_hash?: string | null;
        signature_algorithm?: string | null;
        signature_hash?: string | null;
        signing_key_fingerprint?: string | null;
        transparency_log_ref?: string | null;
        allowed_task_types?: CoordinatorTaskType[] | string | null;
        expires_at?: string | null;
        blockers?: string[] | string | null;
        evidence?: Record<string, unknown>;
        observed_at?: string | null;
    }
    | {
        action: 'review_update_submission';
        federation_key?: string | null;
        federation_round_id?: string | null;
        submission_id?: string | null;
        review_status?: CoordinatorUpdateReviewStatus | null;
        review_reason?: string | null;
        evidence?: Record<string, unknown>;
    }
    | {
        action: 'finalize_secure_aggregation';
        federation_key?: string | null;
        federation_round_id?: string | null;
        minimum_accepted_updates?: number | string | null;
        mark_completed?: boolean | string | null;
        evidence?: Record<string, unknown>;
    }
    | {
        action: 'build_federated_aggregate_artifacts';
        federation_key?: string | null;
        federation_round_id?: string | null;
        task_types?: FederatedAggregateTaskType[] | string | null;
        minimum_accepted_updates?: number | string | null;
        mark_completed?: boolean | string | null;
        coordinator_private_key_pem?: string | null;
        coordinator_private_key_der_base64?: string | null;
        evidence?: Record<string, unknown>;
    }
    | {
        action: 'run_federated_promotion_automation';
        federation_key?: string | null;
        federation_round_id?: string | null;
        build_aggregate_artifacts?: boolean | string | null;
        task_types?: FederatedAggregateTaskType[] | string | null;
        minimum_accepted_updates?: number | string | null;
        mark_completed?: boolean | string | null;
        coordinator_private_key_pem?: string | null;
        coordinator_private_key_der_base64?: string | null;
        evidence?: Record<string, unknown>;
    }
    | {
        action: 'generate_federated_candidate_evidence';
        federation_key?: string | null;
        federation_round_id?: string | null;
        candidate_model_version?: string | null;
        runtime_evidence?: Record<string, unknown>;
        benchmark_evidence?: Record<string, unknown>;
        calibration_evidence?: Record<string, unknown>;
        regression_evidence?: Record<string, unknown>;
        evidence?: Record<string, unknown>;
    }
    | {
        action: 'generate_federated_external_validation';
        federation_key?: string | null;
        federation_round_id?: string | null;
        candidate_model_version?: string | null;
        attestor_kind?: string | null;
        attestor_ref?: string | null;
        attestation_status?: string | null;
        verification_status?: string | null;
        signature_algorithm?: string | null;
        signature_hash?: string | null;
        signing_key_fingerprint?: string | null;
        source_system?: string | null;
        source_ref?: string | null;
        evidence?: Record<string, unknown>;
        observed_at?: string | null;
    }
    | {
        action: 'run_federated_champion_surveillance';
        federation_key?: string | null;
        model_registry_id?: string | null;
        model_version?: string | null;
        task_type?: LearningTaskType | string | null;
        execute_rollback?: boolean | string | null;
        window_hours?: number | string | null;
        thresholds?: Record<string, unknown>;
    };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const url = new URL(req.url);
    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
        tenantIdHint: url.searchParams.get('tenant_id'),
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolveFederationAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(authContext, 'admin')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: 'api/platform/federation:GET',
            requirement: 'admin',
        });
    }

    const federationKey = normalizeFederationKey(url.searchParams.get('federation_key'));
    const snapshot = await getFederationControlPlaneSnapshot(adminClient, authContext.tenantId, {
        federationKey,
    });

    const response = NextResponse.json({
        snapshot,
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const body = await safeJson<FederationAction>(req);
    if (!body.ok) {
        return NextResponse.json({ error: body.error, request_id: requestId }, { status: 400 });
    }

    const actor = await resolveExperimentApiActor(req, {
        allowInternalToken: true,
    });
    if (!actor && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const adminClient = getSupabaseServer();
    const authContext = await resolveFederationAuthorizationContext(actor);
    if (!isRouteAuthorizationGranted(authContext, 'admin')) {
        return buildForbiddenRouteResponse({
            client: adminClient,
            requestId,
            context: authContext,
            route: `api/platform/federation:${body.data.action ?? 'upsert_membership'}`,
            requirement: 'admin',
        });
    }
    const action = body.data.action ?? 'upsert_membership';
    const trustGate = await enforceVetiosHighRiskRouteGate({
        client: adminClient,
        requestId,
        context: authContext,
        actionKey: mapFederationActionToAuthTrustAction(action),
        resource: {
            type: resolveFederationTrustResourceType(action),
            id: resolveFederationTrustResourceId(body.data),
            tenantId: authContext.tenantId,
        },
        evidence: {
            route: 'api/platform/federation',
            requested_action: action,
        },
    });
    if (!trustGate.ok) {
        withRequestHeaders(trustGate.response.headers, requestId, startTime);
        return trustGate.response;
    }

    try {
        const federationKey = normalizeRequiredFederationKey(body.data.federation_key);
        let result: Record<string, unknown>;

        if (action === 'upsert_membership') {
            const membershipBody = body.data as Extract<FederationAction, { action?: 'upsert_membership' }>;
            result = {
                membership: await upsertFederationMembership(adminClient, {
                    federationKey,
                    tenantId: authContext.tenantId,
                    coordinatorTenantId: normalizeTenantId(membershipBody.coordinator_tenant_id) ?? authContext.tenantId,
                    actor: authContext.userId,
                    participationMode: normalizeParticipationMode(membershipBody.participation_mode) ?? 'full',
                    status: normalizeMembershipStatus(membershipBody.status) ?? 'active',
                    weight: normalizePositiveNumber(membershipBody.weight) ?? 1,
                    metadata: asRecord(membershipBody.metadata),
                }),
            };
        } else if (action === 'publish_snapshot') {
            result = {
                published_snapshots: await publishFederatedSiteSnapshots(adminClient, {
                    tenantId: authContext.tenantId,
                    actor: authContext.userId,
                    federationKey,
                }),
            };
        } else if (action === 'run_round') {
            const roundBody = body.data as Extract<FederationAction, { action: 'run_round' }>;
            result = await runFederationRound(adminClient, {
                federationKey,
                actorTenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                actor: authContext.userId,
                snapshotMaxAgeHours: normalizePositiveNumber(roundBody.snapshot_max_age_hours) ?? 24,
            });
        } else if (action === 'enroll_tenant') {
            const enrollmentBody = body.data as Extract<FederationAction, { action: 'enroll_tenant' }>;
            const targetTenantId = normalizeTenantId(enrollmentBody.target_tenant_id);
            if (!targetTenantId) {
                throw new Error('target_tenant_id is required for federation enrollment.');
            }
            result = {
                membership: await enrollFederationTenant(adminClient, {
                    federationKey,
                    actorTenantId: authContext.tenantId,
                    actor: authContext.userId,
                    targetTenantId,
                    participationMode: normalizeParticipationMode(enrollmentBody.participation_mode) ?? 'full',
                    status: normalizeMembershipStatus(enrollmentBody.status) ?? 'active',
                    weight: normalizePositiveNumber(enrollmentBody.weight) ?? 1,
                    metadata: asRecord(enrollmentBody.metadata),
                }),
            };
        } else if (action === 'set_governance') {
            const governanceBody = body.data as Extract<FederationAction, { action: 'set_governance' }>;
            result = {
                membership: await setFederationGovernancePolicy(adminClient, {
                    federationKey,
                    actorTenantId: authContext.tenantId,
                    actor: authContext.userId,
                    policy: buildGovernancePolicyPatch(governanceBody),
                }),
            };
        } else if (action === 'run_automation') {
            const automationBody = body.data as Extract<FederationAction, { action: 'run_automation' }>;
            result = {
                automation: await runFederationAutomation(adminClient, {
                    federationKey,
                    actorTenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                    actor: authContext.userId,
                    force: normalizeBoolean(automationBody.force) ?? false,
                }),
            };
        } else if (action === 'run_due_automation') {
            result = {
                automations: await runDueFederationAutomation(adminClient, {
                    tenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                    federationKey,
                    actor: authContext.userId,
                }),
            };
        } else if (action === 'register_federated_candidate') {
            const promotionBody = body.data as Extract<FederationAction, { action: 'register_federated_candidate' }>;
            const federationRoundId = normalizeUuid(promotionBody.federation_round_id);
            if (!federationRoundId) {
                throw new Error('federation_round_id is required for federated candidate registration.');
            }
            result = {
                promotion: await registerFederatedRoundCandidateModels(adminClient, {
                    federationRoundId,
                    actor: authContext.userId,
                }),
            };
        } else if (action === 'issue_round_node_tasks') {
            const taskBody = body.data as Extract<FederationAction, { action: 'issue_round_node_tasks' }>;
            const federationRoundId = normalizeUuid(taskBody.federation_round_id);
            if (!federationRoundId) {
                throw new Error('federation_round_id is required for federation node task issuance.');
            }
            result = {
                node_tasks: await issueFederationRoundNodeTasks(adminClient, {
                    federationRoundId,
                    actorTenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                    actor: authContext.userId,
                    taskTypes: normalizeCoordinatorTaskTypes(taskBody.task_types),
                    datasetPolicy: asRecord(taskBody.dataset_policy),
                    secureAggregationConfig: asRecord(taskBody.secure_aggregation_config),
                    taskPayload: asRecord(taskBody.task_payload),
                    dueAt: normalizeIsoDate(taskBody.due_at),
                }),
            };
        } else if (action === 'record_federation_node_attestation') {
            const attestationBody = body.data as Extract<FederationAction, { action: 'record_federation_node_attestation' }>;
            const nodeRef = normalizeOptionalText(attestationBody.node_ref);
            if (!nodeRef) {
                throw new Error('node_ref is required for federation node attestation.');
            }
            result = {
                node_attestation: await recordFederationNodeAttestationEvent(adminClient, {
                    tenantId: normalizeTenantId(attestationBody.target_tenant_id) ?? authContext.tenantId,
                    federationKey,
                    nodeRef,
                    partnerRef: normalizeOptionalText(attestationBody.partner_ref),
                    membershipId: normalizeUuid(attestationBody.membership_id),
                    attestationEvent: normalizeNodeAttestationEventKind(attestationBody.attestation_event),
                    attestationStatus: normalizeNodeAttestationStatus(attestationBody.attestation_status),
                    verificationStatus: normalizeNodeAttestationVerificationStatus(attestationBody.verification_status),
                    deploymentEnvironment: normalizeNodeAttestationEnvironment(attestationBody.deployment_environment),
                    softwareVersion: normalizeOptionalText(attestationBody.software_version),
                    softwareArtifactHash: normalizeHash(attestationBody.software_artifact_hash),
                    buildProvenanceHash: normalizeHash(attestationBody.build_provenance_hash),
                    sbomHash: normalizeHash(attestationBody.sbom_hash),
                    signedPayloadHash: normalizeHash(attestationBody.signed_payload_hash),
                    signatureAlgorithm: normalizeOptionalText(attestationBody.signature_algorithm),
                    signatureHash: normalizeHash(attestationBody.signature_hash),
                    signingKeyFingerprint: normalizeOptionalText(attestationBody.signing_key_fingerprint),
                    transparencyLogRef: normalizeOptionalText(attestationBody.transparency_log_ref),
                    allowedTaskTypes: normalizeCoordinatorTaskTypes(attestationBody.allowed_task_types),
                    expiresAt: normalizeIsoDate(attestationBody.expires_at),
                    blockers: normalizeTextList(attestationBody.blockers),
                    evidence: asRecord(attestationBody.evidence),
                    observedAt: normalizeIsoDate(attestationBody.observed_at),
                }),
            };
        } else if (action === 'review_update_submission') {
            const reviewBody = body.data as Extract<FederationAction, { action: 'review_update_submission' }>;
            const federationRoundId = normalizeUuid(reviewBody.federation_round_id);
            const submissionId = normalizeUuid(reviewBody.submission_id);
            const reviewStatus = normalizeUpdateReviewStatus(reviewBody.review_status);
            if (!federationRoundId || !submissionId) {
                throw new Error('federation_round_id and submission_id are required for federated update review.');
            }
            result = {
                update_review: await reviewFederatedUpdateSubmission(adminClient, {
                    federationRoundId,
                    submissionId,
                    actorTenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                    actor: authContext.userId,
                    reviewStatus,
                    reviewReason: normalizeOptionalText(reviewBody.review_reason),
                    evidence: asRecord(reviewBody.evidence),
                }),
            };
        } else if (action === 'finalize_secure_aggregation') {
            const finalizeBody = body.data as Extract<FederationAction, { action: 'finalize_secure_aggregation' }>;
            const federationRoundId = normalizeUuid(finalizeBody.federation_round_id);
            if (!federationRoundId) {
                throw new Error('federation_round_id is required for secure aggregation finalization.');
            }
            result = {
                secure_aggregation: await finalizeFederationRoundSecureAggregation(adminClient, {
                    federationRoundId,
                    actorTenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                    actor: authContext.userId,
                    minimumAcceptedUpdates: normalizePositiveInteger(finalizeBody.minimum_accepted_updates),
                    markCompleted: normalizeBoolean(finalizeBody.mark_completed) ?? false,
                    evidence: asRecord(finalizeBody.evidence),
                }),
            };
        } else if (action === 'build_federated_aggregate_artifacts') {
            const aggregateBody = body.data as Extract<FederationAction, { action: 'build_federated_aggregate_artifacts' }>;
            const federationRoundId = normalizeUuid(aggregateBody.federation_round_id);
            if (!federationRoundId) {
                throw new Error('federation_round_id is required for federated aggregate artifact building.');
            }
            result = {
                aggregate_artifacts: await buildFederatedAggregateArtifacts(adminClient, {
                    federationRoundId,
                    actorTenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                    actor: authContext.userId,
                    taskTypes: normalizeAggregateTaskTypes(aggregateBody.task_types),
                    minimumAcceptedUpdates: normalizePositiveInteger(aggregateBody.minimum_accepted_updates),
                    markCompleted: normalizeBoolean(aggregateBody.mark_completed) ?? false,
                    evidence: asRecord(aggregateBody.evidence),
                    coordinatorPrivateKeyPem: normalizeOptionalText(aggregateBody.coordinator_private_key_pem),
                    coordinatorPrivateKeyDerBase64: normalizeOptionalText(aggregateBody.coordinator_private_key_der_base64),
                }),
            };
        } else if (action === 'run_federated_promotion_automation') {
            const automationBody = body.data as Extract<FederationAction, { action: 'run_federated_promotion_automation' }>;
            const federationRoundId = normalizeUuid(automationBody.federation_round_id);
            if (!federationRoundId) {
                throw new Error('federation_round_id is required for federated promotion automation.');
            }
            result = {
                promotion_automation: await runFederatedPromotionAutomation(adminClient, {
                    federationRoundId,
                    actorTenantId: authContext.authMode === 'internal_token' ? null : authContext.tenantId,
                    actor: authContext.userId,
                    buildAggregateArtifacts: normalizeBoolean(automationBody.build_aggregate_artifacts) ?? true,
                    aggregateTaskTypes: normalizeAggregateTaskTypes(automationBody.task_types),
                    minimumAcceptedUpdates: normalizePositiveInteger(automationBody.minimum_accepted_updates),
                    markRoundCompleted: normalizeBoolean(automationBody.mark_completed) ?? false,
                    aggregateEvidence: asRecord(automationBody.evidence),
                    coordinatorPrivateKeyPem: normalizeOptionalText(automationBody.coordinator_private_key_pem),
                    coordinatorPrivateKeyDerBase64: normalizeOptionalText(automationBody.coordinator_private_key_der_base64),
                }),
            };
        } else if (action === 'generate_federated_candidate_evidence') {
            const evidenceBody = body.data as Extract<FederationAction, { action: 'generate_federated_candidate_evidence' }>;
            const candidateModelVersion = normalizeOptionalText(evidenceBody.candidate_model_version);
            if (!candidateModelVersion) {
                throw new Error('candidate_model_version is required for federated candidate evidence generation.');
            }
            result = {
                candidate_evidence: await generateFederatedCandidateEvidence(adminClient, {
                    tenantId: authContext.tenantId,
                    candidateModelVersion,
                    federationRoundId: normalizeUuid(evidenceBody.federation_round_id),
                    runtimeEvidence: evidenceBody.runtime_evidence == null ? undefined : asRecord(evidenceBody.runtime_evidence),
                    benchmarkEvidence: asRecord(evidenceBody.benchmark_evidence),
                    calibrationEvidence: asRecord(evidenceBody.calibration_evidence),
                    regressionEvidence: asRecord(evidenceBody.regression_evidence),
                    operatorEvidence: asRecord(evidenceBody.evidence),
                    actor: authContext.userId,
                }),
            };
        } else if (action === 'generate_federated_external_validation') {
            const validationBody = body.data as Extract<FederationAction, { action: 'generate_federated_external_validation' }>;
            const federationRoundId = normalizeUuid(validationBody.federation_round_id);
            if (!federationRoundId) {
                throw new Error('federation_round_id is required for federated external validation generation.');
            }
            result = {
                external_validation: await generateFederatedExternalValidationPackets(adminClient, {
                    tenantId: authContext.tenantId,
                    federationRoundId,
                    candidateModelVersion: normalizeOptionalText(validationBody.candidate_model_version),
                    options: {
                        attestorKind: normalizeExternalValidationAttestorKind(validationBody.attestor_kind),
                        attestorRef: normalizeOptionalText(validationBody.attestor_ref),
                        attestationStatus: normalizeExternalValidationAttestationStatus(validationBody.attestation_status),
                        verificationStatus: normalizeExternalValidationVerificationStatus(validationBody.verification_status),
                        signatureAlgorithm: normalizeOptionalText(validationBody.signature_algorithm),
                        signatureHash: normalizeHash(validationBody.signature_hash),
                        signingKeyFingerprint: normalizeOptionalText(validationBody.signing_key_fingerprint),
                        sourceSystem: normalizeOptionalText(validationBody.source_system),
                        sourceRef: normalizeOptionalText(validationBody.source_ref),
                        operatorEvidence: asRecord(validationBody.evidence),
                        actor: authContext.userId,
                        observedAt: normalizeIsoDate(validationBody.observed_at),
                    },
                }),
            };
        } else if (action === 'run_federated_champion_surveillance') {
            const surveillanceBody = body.data as Extract<FederationAction, { action: 'run_federated_champion_surveillance' }>;
            result = {
                champion_surveillance: await runFederatedChampionSurveillance(adminClient, {
                    tenantId: authContext.tenantId,
                    actor: authContext.userId,
                    modelRegistryId: normalizeUuid(surveillanceBody.model_registry_id),
                    modelVersion: normalizeOptionalText(surveillanceBody.model_version),
                    taskType: normalizeLearningTaskType(surveillanceBody.task_type),
                    executeRollback: normalizeBoolean(surveillanceBody.execute_rollback) ?? false,
                    windowHours: normalizePositiveNumber(surveillanceBody.window_hours),
                    thresholds: normalizeSurveillanceThresholds(surveillanceBody.thresholds),
                }),
            };
        } else {
            return NextResponse.json({ error: 'Unsupported federation action.', request_id: requestId }, { status: 400 });
        }

        const response = NextResponse.json({
            ...result,
            snapshot: await getFederationControlPlaneSnapshot(adminClient, authContext.tenantId, {
                federationKey,
            }),
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            { error: error instanceof Error ? error.message : 'Federation action failed.', request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}

async function resolveFederationAuthorizationContext(
    actor: Awaited<ReturnType<typeof resolveExperimentApiActor>>,
): Promise<RouteAuthorizationContext> {
    if (actor?.authMode === 'internal_token') {
        return buildRouteAuthorizationContext({
            tenantId: actor.tenantId,
            userId: actor.userId,
            authMode: 'internal_token',
            user: null,
        });
    }

    const session = await resolveSessionTenant();
    if (session) {
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        return buildRouteAuthorizationContext({
            tenantId: session.tenantId,
            userId: session.userId,
            authMode: 'session',
            user,
        });
    }

    return buildRouteAuthorizationContext({
        tenantId: process.env.VETIOS_DEV_TENANT_ID ?? 'dev_tenant_001',
        userId: process.env.VETIOS_DEV_USER_ID ?? null,
        authMode: process.env.VETIOS_DEV_BYPASS === 'true' ? 'dev_bypass' : 'session',
        user: null,
    });
}

function resolveFederationTrustResourceType(action: string): string {
    if (
        action === 'run_round'
        || action === 'issue_round_node_tasks'
        || action === 'finalize_secure_aggregation'
        || action === 'build_federated_aggregate_artifacts'
        || action === 'run_federated_promotion_automation'
        || action === 'generate_federated_external_validation'
        || action === 'run_federated_champion_surveillance'
    ) {
        return 'federation_round';
    }
    if (action === 'register_federated_candidate' || action === 'generate_federated_candidate_evidence') {
        return 'model_registry_entry';
    }
    if (action === 'record_federation_node_attestation') {
        return 'federation_node';
    }
    if (action === 'review_update_submission') {
        return 'federated_update_submission';
    }
    return 'federation';
}

function resolveFederationTrustResourceId(payload: FederationAction): string | null {
    return readRecordText(payload, 'federation_round_id')
        ?? readRecordText(payload, 'submission_id')
        ?? readRecordText(payload, 'model_registry_id')
        ?? readRecordText(payload, 'node_ref')
        ?? readRecordText(payload, 'federation_key');
}

function readRecordText(value: unknown, key: string): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const entry = (value as Record<string, unknown>)[key];
    return typeof entry === 'string' && entry.trim().length > 0 ? entry.trim() : null;
}

function normalizeFederationKey(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9:_-]{2,63}$/.test(normalized)) {
        return null;
    }
    return normalized;
}

function normalizeRequiredFederationKey(value: unknown): string {
    const normalized = normalizeFederationKey(value);
    if (!normalized) {
        throw new Error('federation_key is required and must be 3-64 chars using letters, numbers, :, _, or -.');
    }
    return normalized;
}

function normalizeTenantId(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeUuid(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
        ? normalized
        : null;
}

function normalizeCoordinatorTaskTypes(value: unknown): CoordinatorTaskType[] | undefined {
    const raw = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];
    const allowed = new Set<CoordinatorTaskType>([
        'diagnosis_delta',
        'severity_delta',
        'support_summary',
        'secure_aggregation_key',
        'unmask_share',
    ]);
    const normalized = raw
        .map((entry) => typeof entry === 'string' ? entry.trim() : '')
        .filter((entry): entry is CoordinatorTaskType => allowed.has(entry as CoordinatorTaskType));
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function normalizeUpdateReviewStatus(value: unknown): CoordinatorUpdateReviewStatus {
    if (value === 'accepted' || value === 'rejected' || value === 'quarantined') {
        return value;
    }
    return 'accepted';
}

function normalizeNodeAttestationEventKind(value: unknown): FederationNodeAttestationEventKind | null {
    return FEDERATION_NODE_ATTESTATION_EVENT_KINDS.includes(value as FederationNodeAttestationEventKind)
        ? value as FederationNodeAttestationEventKind
        : null;
}

function normalizeNodeAttestationStatus(value: unknown): FederationNodeAttestationStatus | null {
    return FEDERATION_NODE_ATTESTATION_STATUSES.includes(value as FederationNodeAttestationStatus)
        ? value as FederationNodeAttestationStatus
        : null;
}

function normalizeNodeAttestationVerificationStatus(value: unknown): FederationNodeAttestationVerificationStatus | null {
    return FEDERATION_NODE_ATTESTATION_VERIFICATION_STATUSES.includes(value as FederationNodeAttestationVerificationStatus)
        ? value as FederationNodeAttestationVerificationStatus
        : null;
}

function normalizeNodeAttestationEnvironment(value: unknown): FederationNodeAttestationEnvironment | null {
    return FEDERATION_NODE_ATTESTATION_ENVIRONMENTS.includes(value as FederationNodeAttestationEnvironment)
        ? value as FederationNodeAttestationEnvironment
        : null;
}

function normalizeAggregateTaskTypes(value: unknown): FederatedAggregateTaskType[] | undefined {
    const raw = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];
    const allowed = new Set<FederatedAggregateTaskType>(['diagnosis', 'severity']);
    const normalized = raw
        .map((entry) => typeof entry === 'string' ? entry.trim() : '')
        .filter((entry): entry is FederatedAggregateTaskType => allowed.has(entry as FederatedAggregateTaskType));
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function normalizeLearningTaskType(value: unknown): LearningTaskType | null {
    return value === 'diagnosis' || value === 'severity' || value === 'hybrid' ? value : null;
}

function normalizeExternalValidationAttestorKind(value: unknown): ExternalValidationAttestorKind | null {
    return EXTERNAL_VALIDATION_ATTESTOR_KINDS.includes(value as ExternalValidationAttestorKind)
        ? value as ExternalValidationAttestorKind
        : null;
}

function normalizeExternalValidationAttestationStatus(value: unknown): ExternalValidationAttestationStatus | null {
    return EXTERNAL_VALIDATION_ATTESTATION_STATUSES.includes(value as ExternalValidationAttestationStatus)
        ? value as ExternalValidationAttestationStatus
        : null;
}

function normalizeExternalValidationVerificationStatus(value: unknown): ExternalValidationVerificationStatus | null {
    return EXTERNAL_VALIDATION_VERIFICATION_STATUSES.includes(value as ExternalValidationVerificationStatus)
        ? value as ExternalValidationVerificationStatus
        : null;
}

function normalizeSurveillanceThresholds(value: unknown): Partial<FederatedChampionSurveillanceThresholds> {
    const record = asRecord(value);
    const thresholds: Partial<FederatedChampionSurveillanceThresholds> = {};
    const minimumOutcomeLinkedEvents = normalizePositiveInteger(record.minimum_outcome_linked_events ?? record.minimumOutcomeLinkedEvents);
    if (minimumOutcomeLinkedEvents != null) {
        thresholds.minimumOutcomeLinkedEvents = minimumOutcomeLinkedEvents;
    }
    const maximumErrorRate = normalizeFractionalNumber(record.maximum_error_rate ?? record.maximumErrorRate);
    if (maximumErrorRate != null) {
        thresholds.maximumErrorRate = maximumErrorRate;
    }
    const maximumDangerousFalseNegativeRate = normalizeFractionalNumber(record.maximum_dangerous_false_negative_rate ?? record.maximumDangerousFalseNegativeRate);
    if (maximumDangerousFalseNegativeRate != null) {
        thresholds.maximumDangerousFalseNegativeRate = maximumDangerousFalseNegativeRate;
    }
    const maximumMeanCalibrationError = normalizeFractionalNumber(record.maximum_mean_calibration_error ?? record.maximumMeanCalibrationError);
    if (maximumMeanCalibrationError != null) {
        thresholds.maximumMeanCalibrationError = maximumMeanCalibrationError;
    }
    const maximumMeanDriftScore = normalizeFractionalNumber(record.maximum_mean_drift_score ?? record.maximumMeanDriftScore);
    if (maximumMeanDriftScore != null) {
        thresholds.maximumMeanDriftScore = maximumMeanDriftScore;
    }
    const maximumMeanSimulationDegradation = normalizeFractionalNumber(record.maximum_mean_simulation_degradation ?? record.maximumMeanSimulationDegradation);
    if (maximumMeanSimulationDegradation != null) {
        thresholds.maximumMeanSimulationDegradation = maximumMeanSimulationDegradation;
    }
    const watchFraction = normalizeFractionalNumber(record.watch_fraction ?? record.watchFraction);
    if (watchFraction != null) {
        thresholds.watchFraction = watchFraction;
    }
    return thresholds;
}

function normalizePositiveInteger(value: unknown): number | null {
    const number = normalizePositiveNumber(value);
    return number == null ? null : Math.max(0, Math.round(number));
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeHash(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeIsoDate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeParticipationMode(value: unknown): FederationParticipationMode | null {
    return value === 'full' || value === 'shadow' ? value : null;
}

function normalizeMembershipStatus(value: unknown): FederationMembershipStatus | null {
    return value === 'active' || value === 'paused' || value === 'revoked' ? value : null;
}

function buildGovernancePolicyPatch(
    body: Extract<FederationAction, { action: 'set_governance' }>,
): Partial<FederationGovernancePolicy> {
    const policy: Partial<FederationGovernancePolicy> = {};

    const enrollmentMode = normalizeEnrollmentMode(body.enrollment_mode);
    if (enrollmentMode) {
        policy.enrollment_mode = enrollmentMode;
    }

    const autoEnrollEnabled = normalizeBoolean(body.auto_enroll_enabled);
    if (autoEnrollEnabled != null) {
        policy.auto_enroll_enabled = autoEnrollEnabled;
    }

    if (body.approved_tenant_ids != null) {
        policy.approved_tenant_ids = normalizeTenantIdList(body.approved_tenant_ids);
    }

    const autoPublishSnapshots = normalizeBoolean(body.auto_publish_snapshots);
    if (autoPublishSnapshots != null) {
        policy.auto_publish_snapshots = autoPublishSnapshots;
    }

    const autoRunRounds = normalizeBoolean(body.auto_run_rounds);
    if (autoRunRounds != null) {
        policy.auto_run_rounds = autoRunRounds;
    }

    const roundIntervalHours = normalizePositiveNumber(body.round_interval_hours);
    if (roundIntervalHours != null) {
        policy.round_interval_hours = roundIntervalHours;
    }

    const snapshotMaxAgeHours = normalizePositiveNumber(body.snapshot_max_age_hours);
    if (snapshotMaxAgeHours != null) {
        policy.snapshot_max_age_hours = snapshotMaxAgeHours;
    }

    const minimumParticipants = normalizePositiveNumber(body.minimum_participants);
    if (minimumParticipants != null) {
        policy.minimum_participants = minimumParticipants;
    }

    if (body.minimum_benchmark_pass_rate != null) {
        policy.minimum_benchmark_pass_rate = normalizeFractionalNumber(body.minimum_benchmark_pass_rate);
    }

    if (body.maximum_calibration_avg_ece != null) {
        policy.maximum_calibration_avg_ece = normalizeFractionalNumber(body.maximum_calibration_avg_ece);
    }

    const allowShadowParticipants = normalizeBoolean(body.allow_shadow_participants);
    if (allowShadowParticipants != null) {
        policy.allow_shadow_participants = allowShadowParticipants;
    }

    return policy;
}

function normalizeEnrollmentMode(value: unknown): FederationGovernancePolicy['enrollment_mode'] | null {
    return value === 'coordinator_only' || value === 'allow_list' || value === 'open'
        ? value
        : null;
}

function normalizeBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return null;
}

function normalizePositiveNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
}

function normalizeFractionalNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value < 0) return null;
        if (value > 1 && value <= 100) return value / 100;
        return value <= 1 ? value : null;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return null;
        }
        if (parsed > 1 && parsed <= 100) {
            return parsed / 100;
        }
        return parsed <= 1 ? parsed : null;
    }
    return null;
}

function normalizeTenantIdList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => normalizeTenantId(entry))
            .filter((entry): entry is string => entry != null);
    }
    if (typeof value === 'string') {
        return value
            .split(/[\s,]+/)
            .map((entry) => normalizeTenantId(entry))
            .filter((entry): entry is string => entry != null);
    }
    return [];
}

function normalizeTextList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => normalizeOptionalText(entry))
            .filter((entry): entry is string => entry != null);
    }
    if (typeof value === 'string') {
        return value
            .split(/[\s,]+/)
            .map((entry) => normalizeOptionalText(entry))
            .filter((entry): entry is string => entry != null);
    }
    return [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
