import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    EDGE_BOX_DEVICE_CREDENTIALS,
    EDGE_BOXES,
    EDGE_SYNC_ARTIFACTS,
    EDGE_SYNC_JOBS,
} from '@/lib/db/schemaContracts';
import { createOutboxEvent } from '@/lib/outbox/outbox-service';
import { resolvePublicCatalogTenant, type PublicCatalogSource } from '@/lib/platform/publicTenant';
import { recordControlPlaneAction } from '@/lib/settings/controlPlane';
import { getSupabaseServer } from '@/lib/supabaseServer';

export type EdgeBoxStatus = 'provisioning' | 'online' | 'degraded' | 'offline' | 'retired';
export type EdgeSyncJobType = 'telemetry_flush' | 'model_bundle' | 'dataset_delta' | 'config_sync';
export type EdgeSyncDirection = 'cloud_to_edge' | 'edge_to_cloud';
export type EdgeSyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type EdgeArtifactType = 'model_bundle' | 'dataset_delta' | 'config_bundle' | 'telemetry_archive';
export type EdgeArtifactStatus = 'staged' | 'synced' | 'failed' | 'expired';
export type EdgeDeviceCredentialStatus = 'active' | 'rotated' | 'revoked' | 'expired';
export type EdgeDeviceCredentialIssueReason = 'provisioning' | 'rotation' | 'recovery';
export type EdgeDeviceCredentialAction = 'heartbeat' | 'pull_jobs' | 'ack_job' | 'provisioning_check' | 'sync_request';

export interface EdgeBoxRecord {
    id: string;
    tenant_id: string;
    node_name: string;
    site_label: string;
    hardware_class: string | null;
    status: EdgeBoxStatus;
    software_version: string | null;
    last_heartbeat_at: string | null;
    last_sync_at: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface EdgeSyncJobRecord {
    id: string;
    tenant_id: string;
    edge_box_id: string;
    job_type: EdgeSyncJobType;
    direction: EdgeSyncDirection;
    status: EdgeSyncJobStatus;
    payload: Record<string, unknown>;
    scheduled_at: string;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface EdgeSyncArtifactRecord {
    id: string;
    tenant_id: string;
    edge_box_id: string | null;
    artifact_type: EdgeArtifactType;
    artifact_ref: string;
    content_hash: string;
    size_bytes: number;
    status: EdgeArtifactStatus;
    metadata: Record<string, unknown>;
    created_at: string;
    synced_at: string | null;
    updated_at: string;
}

export interface EdgeBoxDeviceCredentialRecord {
    id: string;
    tenant_id: string;
    edge_box_id: string;
    key_prefix: string;
    status: EdgeDeviceCredentialStatus;
    issued_reason: EdgeDeviceCredentialIssueReason;
    scopes: string[];
    expires_at: string | null;
    last_used_at: string | null;
    last_used_action: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    revoked_by: string | null;
    revoked_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface EdgeBoxControlPlaneSnapshot {
    tenant_id: string;
    edge_boxes: EdgeBoxRecord[];
    device_credentials: EdgeBoxDeviceCredentialRecord[];
    sync_jobs: EdgeSyncJobRecord[];
    sync_artifacts: EdgeSyncArtifactRecord[];
    summary: {
        online_nodes: number;
        degraded_nodes: number;
        active_device_credentials: number;
        expiring_device_credentials: number;
        revoked_device_credentials: number;
        queued_jobs: number;
        failed_jobs: number;
        staged_artifacts: number;
    };
    refreshed_at: string;
}

export interface PublicEdgeBoxSnapshot {
    configured: boolean;
    source: PublicCatalogSource;
    tenant_id: string | null;
    summary: EdgeBoxControlPlaneSnapshot['summary'];
    edge_boxes: EdgeBoxRecord[];
    sync_jobs: EdgeSyncJobRecord[];
    refreshed_at: string | null;
}

export interface EdgeBoxProvisioningResult {
    edge_box: EdgeBoxRecord;
    device_credential: EdgeBoxDeviceCredentialRecord | null;
    provisioning_token: string;
    sync_endpoint: string;
}

export interface EdgeBoxCredentialIssueResult {
    edge_box: EdgeBoxRecord;
    device_credential: EdgeBoxDeviceCredentialRecord;
    provisioning_token: string;
    sync_endpoint: string;
}

export interface EdgeSyncPullResult {
    edge_box: EdgeBoxRecord;
    jobs: EdgeSyncJobRecord[];
    artifacts: EdgeSyncArtifactRecord[];
    pulled_at: string;
}

export interface EdgeSyncAckResult {
    edge_box: EdgeBoxRecord;
    sync_job: EdgeSyncJobRecord;
}

const EDGE_AUTH_TOKEN_METADATA_KEY = 'edge_auth_token_hash';
const EDGE_SYNC_ENDPOINT = '/api/edge-box/sync';

export async function getEdgeBoxControlPlaneSnapshot(
    client: SupabaseClient,
    tenantId: string,
    options: { limit?: number } = {},
): Promise<EdgeBoxControlPlaneSnapshot> {
    const limit = options.limit ?? 24;
    const [edgeBoxes, deviceCredentials, syncJobs, syncArtifacts] = await Promise.all([
        listEdgeBoxes(client, tenantId, limit),
        listEdgeDeviceCredentials(client, tenantId, limit),
        listEdgeSyncJobs(client, tenantId, limit),
        listEdgeSyncArtifacts(client, tenantId, limit),
    ]);
    const expiringCutoff = Date.now() + 30 * 24 * 60 * 60 * 1000;

    return {
        tenant_id: tenantId,
        edge_boxes: edgeBoxes,
        device_credentials: deviceCredentials,
        sync_jobs: syncJobs,
        sync_artifacts: syncArtifacts,
        summary: {
            online_nodes: edgeBoxes.filter((box) => box.status === 'online').length,
            degraded_nodes: edgeBoxes.filter((box) => box.status === 'degraded' || box.status === 'offline').length,
            active_device_credentials: deviceCredentials.filter((credential) => credential.status === 'active').length,
            expiring_device_credentials: deviceCredentials.filter((credential) => (
                credential.status === 'active'
                && credential.expires_at != null
                && new Date(credential.expires_at).getTime() <= expiringCutoff
            )).length,
            revoked_device_credentials: deviceCredentials.filter((credential) => credential.status === 'revoked' || credential.status === 'rotated').length,
            queued_jobs: syncJobs.filter((job) => job.status === 'queued' || job.status === 'running').length,
            failed_jobs: syncJobs.filter((job) => job.status === 'failed').length,
            staged_artifacts: syncArtifacts.filter((artifact) => artifact.status === 'staged').length,
        },
        refreshed_at: new Date().toISOString(),
    };
}

export async function getPublicEdgeBoxSnapshot(): Promise<PublicEdgeBoxSnapshot> {
    const target = await resolvePublicCatalogTenant();
    if (!target.tenantId) {
        return {
            configured: false,
            source: target.source,
            tenant_id: null,
            summary: {
                online_nodes: 0,
                degraded_nodes: 0,
                active_device_credentials: 0,
                expiring_device_credentials: 0,
                revoked_device_credentials: 0,
                queued_jobs: 0,
                failed_jobs: 0,
                staged_artifacts: 0,
            },
            edge_boxes: [],
            sync_jobs: [],
            refreshed_at: null,
        };
    }

    try {
        const snapshot = await getEdgeBoxControlPlaneSnapshot(getSupabaseServer(), target.tenantId, { limit: 12 });
        return {
            configured: true,
            source: target.source,
            tenant_id: target.tenantId,
            summary: snapshot.summary,
            edge_boxes: snapshot.edge_boxes,
            sync_jobs: snapshot.sync_jobs,
            refreshed_at: snapshot.refreshed_at,
        };
    } catch {
        return {
            configured: true,
            source: target.source,
            tenant_id: target.tenantId,
            summary: {
                online_nodes: 0,
                degraded_nodes: 0,
                active_device_credentials: 0,
                expiring_device_credentials: 0,
                revoked_device_credentials: 0,
                queued_jobs: 0,
                failed_jobs: 0,
                staged_artifacts: 0,
            },
            edge_boxes: [],
            sync_jobs: [],
            refreshed_at: new Date().toISOString(),
        };
    }
}

export async function createEdgeBox(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        nodeName: string;
        siteLabel: string;
        hardwareClass?: string | null;
        status?: EdgeBoxStatus;
        softwareVersion?: string | null;
        metadata?: Record<string, unknown>;
    },
): Promise<EdgeBoxProvisioningResult> {
    const C = EDGE_BOXES.COLUMNS;
    const provisioningToken = generateProvisioningToken();
    const payload = {
        [C.tenant_id]: input.tenantId,
        [C.node_name]: requireText(input.nodeName, 'node_name'),
        [C.site_label]: requireText(input.siteLabel, 'site_label'),
        [C.hardware_class]: normalizeOptionalText(input.hardwareClass),
        [C.status]: input.status ?? 'provisioning',
        [C.software_version]: normalizeOptionalText(input.softwareVersion),
        [C.metadata]: {
            ...(input.metadata ?? {}),
            [EDGE_AUTH_TOKEN_METADATA_KEY]: hashEdgeToken(provisioningToken),
            provisioning_token_rotated_at: new Date().toISOString(),
            sync_endpoint: EDGE_SYNC_ENDPOINT,
        },
        [C.created_by]: input.actor,
    };

    const { data, error } = await client
        .from(EDGE_BOXES.TABLE)
        .upsert(payload, {
            onConflict: `${C.tenant_id},${C.node_name}`,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create edge box: ${error?.message ?? 'Unknown error'}`);
    }

    const edgeBox = mapEdgeBox(asRecord(data));
    const deviceCredential = await issueEdgeDeviceCredential(client, {
        tenantId: input.tenantId,
        actor: input.actor,
        edgeBox,
        token: provisioningToken,
        reason: 'provisioning',
        metadata: {
            sync_endpoint: EDGE_SYNC_ENDPOINT,
            issued_from: 'edge_box_registration',
        },
    }).catch((credentialError) => {
        if (isMissingEdgeCredentialTableError(credentialError)) {
            return null;
        }
        throw credentialError;
    });
    await recordEdgeControlAction(client, {
        tenantId: input.tenantId,
        actor: input.actor,
        actionType: 'edge_box_registered',
        targetId: edgeBox.id,
        metadata: {
            node_name: edgeBox.node_name,
            site_label: edgeBox.site_label,
            status: edgeBox.status,
        },
    });

    return {
        edge_box: edgeBox,
        device_credential: deviceCredential,
        provisioning_token: provisioningToken,
        sync_endpoint: EDGE_SYNC_ENDPOINT,
    };
}

export async function rotateEdgeBoxDeviceCredential(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        edgeBoxId: string;
        reason?: EdgeDeviceCredentialIssueReason;
    },
): Promise<EdgeBoxCredentialIssueResult> {
    const edgeBox = await requireEdgeBoxForTenant(client, input.tenantId, input.edgeBoxId);
    const provisioningToken = generateProvisioningToken();
    const deviceCredential = await issueEdgeDeviceCredential(client, {
        tenantId: input.tenantId,
        actor: input.actor,
        edgeBox,
        token: provisioningToken,
        reason: input.reason ?? 'rotation',
        metadata: {
            sync_endpoint: EDGE_SYNC_ENDPOINT,
            issued_from: 'control_plane_rotation',
        },
    });
    const C = EDGE_BOXES.COLUMNS;
    const { data, error } = await client
        .from(EDGE_BOXES.TABLE)
        .update({
            [C.metadata]: {
                ...edgeBox.metadata,
                [EDGE_AUTH_TOKEN_METADATA_KEY]: hashEdgeToken(provisioningToken),
                provisioning_token_rotated_at: new Date().toISOString(),
                sync_endpoint: EDGE_SYNC_ENDPOINT,
                device_auth_hardened: true,
                active_device_credential_id: deviceCredential.id,
            },
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, edgeBox.id)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to rotate edge box credential metadata: ${error?.message ?? 'Unknown error'}`);
    }

    const updatedEdgeBox = mapEdgeBox(asRecord(data));
    await recordEdgeControlAction(client, {
        tenantId: input.tenantId,
        actor: input.actor,
        actionType: 'edge_device_credential_rotated',
        targetType: 'edge_box_device_credential',
        targetId: deviceCredential.id,
        metadata: {
            edge_box_id: edgeBox.id,
            key_prefix: deviceCredential.key_prefix,
            expires_at: deviceCredential.expires_at,
        },
    });

    return {
        edge_box: updatedEdgeBox,
        device_credential: deviceCredential,
        provisioning_token: provisioningToken,
        sync_endpoint: EDGE_SYNC_ENDPOINT,
    };
}

export async function revokeEdgeBoxDeviceCredential(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        credentialId: string;
    },
): Promise<EdgeBoxDeviceCredentialRecord> {
    const existing = await requireEdgeDeviceCredentialForTenant(client, input.tenantId, input.credentialId);
    const C = EDGE_BOX_DEVICE_CREDENTIALS.COLUMNS;
    const now = new Date().toISOString();
    const { data, error } = await client
        .from(EDGE_BOX_DEVICE_CREDENTIALS.TABLE)
        .update({
            [C.status]: 'revoked',
            [C.revoked_by]: input.actor,
            [C.revoked_at]: now,
            [C.metadata]: {
                ...existing.metadata,
                revoked_from: 'control_plane',
            },
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, existing.id)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to revoke edge box credential: ${error?.message ?? 'Unknown error'}`);
    }

    const credential = mapEdgeDeviceCredential(asRecord(data));
    await recordEdgeControlAction(client, {
        tenantId: input.tenantId,
        actor: input.actor,
        actionType: 'edge_device_credential_revoked',
        targetType: 'edge_box_device_credential',
        targetId: credential.id,
        metadata: {
            edge_box_id: credential.edge_box_id,
            key_prefix: credential.key_prefix,
        },
    });
    return credential;
}

export async function queueEdgeSyncJob(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        edgeBoxId: string;
        jobType: EdgeSyncJobType;
        direction: EdgeSyncDirection;
        payload?: Record<string, unknown>;
        status?: EdgeSyncJobStatus;
        scheduledAt?: string | null;
    },
): Promise<EdgeSyncJobRecord> {
    const edgeBox = await requireEdgeBoxForTenant(client, input.tenantId, input.edgeBoxId);
    const jobType = normalizeEdgeSyncJobType(input.jobType);
    const direction = normalizeEdgeSyncDirection(input.direction);
    const C = EDGE_SYNC_JOBS.COLUMNS;
    const { data, error } = await client
        .from(EDGE_SYNC_JOBS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.edge_box_id]: input.edgeBoxId,
            [C.job_type]: jobType,
            [C.direction]: direction,
            [C.status]: input.status ?? 'queued',
            [C.payload]: buildEdgeSyncPayload(input.payload ?? {}, edgeBox),
            [C.scheduled_at]: normalizeOptionalText(input.scheduledAt) ?? new Date().toISOString(),
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to queue edge sync job: ${error?.message ?? 'Unknown error'}`);
    }

    const job = mapEdgeSyncJob(asRecord(data));
    await enqueueEdgeSyncOutboxEvent(client, {
        tenantId: input.tenantId,
        edgeBox,
        syncJob: job,
    }).catch(async (outboxError) => {
        await recordEdgeControlAction(client, {
            tenantId: input.tenantId,
            actor: input.actor,
            actionType: 'edge_sync_outbox_enqueue_failed',
            status: 'failed',
            targetId: job.id,
            metadata: {
                error: outboxError instanceof Error ? outboxError.message : 'Failed to enqueue edge sync outbox event.',
            },
        });
    });
    await recordEdgeControlAction(client, {
        tenantId: input.tenantId,
        actor: input.actor,
        actionType: 'edge_sync_job_queued',
        targetId: job.id,
        metadata: {
            edge_box_id: edgeBox.id,
            job_type: job.job_type,
            direction: job.direction,
        },
    });

    return job;
}

export async function registerEdgeArtifact(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor?: string | null;
        edgeBoxId?: string | null;
        artifactType: EdgeArtifactType;
        artifactRef: string;
        contentHash: string;
        sizeBytes?: number;
        status?: EdgeArtifactStatus;
        metadata?: Record<string, unknown>;
    },
): Promise<EdgeSyncArtifactRecord> {
    const edgeBoxId = normalizeOptionalText(input.edgeBoxId);
    if (edgeBoxId) {
        await requireEdgeBoxForTenant(client, input.tenantId, edgeBoxId);
    }
    const artifactType = normalizeEdgeArtifactType(input.artifactType);
    const contentHash = normalizeContentHash(input.contentHash);
    const C = EDGE_SYNC_ARTIFACTS.COLUMNS;
    const { data, error } = await client
        .from(EDGE_SYNC_ARTIFACTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.edge_box_id]: edgeBoxId,
            [C.artifact_type]: artifactType,
            [C.artifact_ref]: requireText(input.artifactRef, 'artifact_ref'),
            [C.content_hash]: contentHash,
            [C.size_bytes]: Math.max(0, Math.round(input.sizeBytes ?? 0)),
            [C.status]: input.status ?? 'staged',
            [C.metadata]: input.metadata ?? {},
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to register edge artifact: ${error?.message ?? 'Unknown error'}`);
    }

    const artifact = mapEdgeSyncArtifact(asRecord(data));
    await recordEdgeControlAction(client, {
        tenantId: input.tenantId,
        actor: input.actor ?? null,
        actionType: 'edge_artifact_staged',
        targetType: 'edge_sync_artifact',
        targetId: artifact.id,
        metadata: {
            edge_box_id: artifact.edge_box_id,
            artifact_type: artifact.artifact_type,
            artifact_ref: artifact.artifact_ref,
            size_bytes: artifact.size_bytes,
        },
    });

    return artifact;
}

export async function updateEdgeHeartbeat(
    client: SupabaseClient,
    input: {
        tenantId: string;
        edgeBoxId: string;
        status?: EdgeBoxStatus;
        softwareVersion?: string | null;
        actor?: string | null;
    },
): Promise<EdgeBoxRecord> {
    await requireEdgeBoxForTenant(client, input.tenantId, input.edgeBoxId);
    const C = EDGE_BOXES.COLUMNS;
    const now = new Date().toISOString();
    const { data, error } = await client
        .from(EDGE_BOXES.TABLE)
        .update({
            [C.status]: input.status ?? 'online',
            [C.software_version]: normalizeOptionalText(input.softwareVersion),
            [C.last_heartbeat_at]: now,
            [C.last_sync_at]: now,
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.id, input.edgeBoxId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to update edge heartbeat: ${error?.message ?? 'Unknown error'}`);
    }

    const edgeBox = mapEdgeBox(asRecord(data));
    await recordEdgeControlAction(client, {
        tenantId: input.tenantId,
        actor: input.actor ?? edgeBox.id,
        actionType: 'edge_box_heartbeat',
        targetId: edgeBox.id,
        metadata: {
            status: edgeBox.status,
            software_version: edgeBox.software_version,
        },
    });
    return edgeBox;
}

export async function authenticateEdgeBox(
    client: SupabaseClient,
    input: {
        edgeBoxId: string;
        token: string;
        action?: EdgeDeviceCredentialAction;
    },
): Promise<EdgeBoxRecord> {
    const C = EDGE_BOXES.COLUMNS;
    const { data, error } = await client
        .from(EDGE_BOXES.TABLE)
        .select('*')
        .eq(C.id, requireText(input.edgeBoxId, 'edge_box_id'))
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to authenticate edge box: ${error.message}`);
    }
    if (!data) {
        throw unauthorizedEdgeBoxError();
    }

    const row = asRecord(data);
    const tokenHash = hashEdgeToken(input.token);
    let credentialLedgerAvailable = true;
    const credential = await findActiveEdgeDeviceCredential(client, {
        edgeBoxId: String(row.id),
        tokenHash,
    }).catch((credentialError) => {
        if (isMissingEdgeCredentialTableError(credentialError)) {
            credentialLedgerAvailable = false;
            return null;
        }
        throw credentialError;
    });
    if (credential) {
        if (credential.expires_at && new Date(credential.expires_at).getTime() <= Date.now()) {
            await expireEdgeDeviceCredential(client, credential).catch(() => undefined);
            throw unauthorizedEdgeBoxError();
        }
        await markEdgeDeviceCredentialUsed(client, credential, input.action ?? 'sync_request').catch(() => undefined);
        return mapEdgeBox(row);
    }
    if (credentialLedgerAvailable) {
        const hasCredentialLedger = await edgeBoxHasCredentialLedger(client, String(row.id)).catch((ledgerError) => {
            if (isMissingEdgeCredentialTableError(ledgerError)) {
                return false;
            }
            throw ledgerError;
        });
        if (hasCredentialLedger) {
            throw unauthorizedEdgeBoxError();
        }
    }

    const metadata = asRecord(row.metadata);
    const expectedHash = readString(metadata[EDGE_AUTH_TOKEN_METADATA_KEY]);
    if (!expectedHash || !compareEdgeTokenHash(input.token, expectedHash)) {
        throw unauthorizedEdgeBoxError();
    }

    return mapEdgeBox(row);
}

export async function pullEdgeSyncWork(
    client: SupabaseClient,
    input: {
        edgeBoxId: string;
        token: string;
        softwareVersion?: string | null;
        limit?: number;
    },
): Promise<EdgeSyncPullResult> {
    const edgeBox = await authenticateEdgeBox(client, {
        edgeBoxId: input.edgeBoxId,
        token: input.token,
        action: 'pull_jobs',
    });
    const heartbeat = await updateEdgeHeartbeat(client, {
        tenantId: edgeBox.tenant_id,
        edgeBoxId: edgeBox.id,
        status: 'online',
        softwareVersion: input.softwareVersion ?? edgeBox.software_version,
        actor: edgeBox.id,
    });
    const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
    const now = new Date().toISOString();
    const jobColumns = EDGE_SYNC_JOBS.COLUMNS;
    const artifactColumns = EDGE_SYNC_ARTIFACTS.COLUMNS;
    const { data: jobRows, error: jobsError } = await client
        .from(EDGE_SYNC_JOBS.TABLE)
        .select('*')
        .eq(jobColumns.tenant_id, edgeBox.tenant_id)
        .eq(jobColumns.edge_box_id, edgeBox.id)
        .eq(jobColumns.status, 'queued')
        .lte(jobColumns.scheduled_at, now)
        .order(jobColumns.scheduled_at, { ascending: true })
        .limit(limit);

    if (jobsError) {
        throw new Error(`Failed to pull edge sync jobs: ${jobsError.message}`);
    }

    const jobs = (jobRows ?? []).map((row) => mapEdgeSyncJob(asRecord(row)));
    if (jobs.length > 0) {
        await client
            .from(EDGE_SYNC_JOBS.TABLE)
            .update({
                [jobColumns.status]: 'running',
                [jobColumns.started_at]: now,
            })
            .eq(jobColumns.tenant_id, edgeBox.tenant_id)
            .in(jobColumns.id, jobs.map((job) => job.id));
    }
    const pulledJobs = jobs.map((job) => ({
        ...job,
        status: 'running' as EdgeSyncJobStatus,
        started_at: job.started_at ?? now,
        updated_at: now,
    }));

    const { data: artifactRows, error: artifactError } = await client
        .from(EDGE_SYNC_ARTIFACTS.TABLE)
        .select('*')
        .eq(artifactColumns.tenant_id, edgeBox.tenant_id)
        .eq(artifactColumns.status, 'staged')
        .or(`${artifactColumns.edge_box_id}.eq.${edgeBox.id},${artifactColumns.edge_box_id}.is.null`)
        .order(artifactColumns.created_at, { ascending: false })
        .limit(limit);

    if (artifactError) {
        throw new Error(`Failed to pull edge sync artifacts: ${artifactError.message}`);
    }

    return {
        edge_box: heartbeat,
        jobs: pulledJobs,
        artifacts: (artifactRows ?? []).map((row) => mapEdgeSyncArtifact(asRecord(row))),
        pulled_at: now,
    };
}

export async function acknowledgeEdgeSyncJob(
    client: SupabaseClient,
    input: {
        edgeBoxId: string;
        token: string;
        jobId: string;
        status: 'succeeded' | 'failed' | 'canceled';
        errorMessage?: string | null;
        syncedArtifactIds?: string[];
    },
): Promise<EdgeSyncAckResult> {
    const edgeBox = await authenticateEdgeBox(client, {
        edgeBoxId: input.edgeBoxId,
        token: input.token,
        action: 'ack_job',
    });
    const C = EDGE_SYNC_JOBS.COLUMNS;
    const now = new Date().toISOString();
    const { data, error } = await client
        .from(EDGE_SYNC_JOBS.TABLE)
        .update({
            [C.status]: input.status,
            [C.completed_at]: now,
            [C.error_message]: input.status === 'failed'
                ? normalizeOptionalText(input.errorMessage) ?? 'Edge node reported sync failure.'
                : null,
        })
        .eq(C.tenant_id, edgeBox.tenant_id)
        .eq(C.edge_box_id, edgeBox.id)
        .eq(C.id, requireText(input.jobId, 'job_id'))
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to acknowledge edge sync job: ${error?.message ?? 'Unknown error'}`);
    }

    const artifactIds = (input.syncedArtifactIds ?? []).filter((value) => typeof value === 'string' && value.trim().length > 0);
    if (artifactIds.length > 0 && input.status === 'succeeded') {
        const artifactColumns = EDGE_SYNC_ARTIFACTS.COLUMNS;
        await client
            .from(EDGE_SYNC_ARTIFACTS.TABLE)
            .update({
                [artifactColumns.status]: 'synced',
                [artifactColumns.synced_at]: now,
            })
            .eq(artifactColumns.tenant_id, edgeBox.tenant_id)
            .in(artifactColumns.id, artifactIds);
    }

    const heartbeat = await updateEdgeHeartbeat(client, {
        tenantId: edgeBox.tenant_id,
        edgeBoxId: edgeBox.id,
        status: input.status === 'failed' ? 'degraded' : 'online',
        softwareVersion: edgeBox.software_version,
        actor: edgeBox.id,
    });

    await recordEdgeControlAction(client, {
        tenantId: edgeBox.tenant_id,
        actor: edgeBox.id,
        actionType: 'edge_sync_job_acknowledged',
        targetType: 'edge_sync_job',
        targetId: String((data as Record<string, unknown>).id),
        status: input.status === 'failed' ? 'failed' : 'completed',
        metadata: {
            status: input.status,
            synced_artifact_ids: artifactIds,
        },
    });

    return {
        edge_box: heartbeat,
        sync_job: mapEdgeSyncJob(asRecord(data)),
    };
}

async function listEdgeBoxes(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<EdgeBoxRecord[]> {
    const C = EDGE_BOXES.COLUMNS;
    const { data, error } = await client
        .from(EDGE_BOXES.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.updated_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list edge boxes: ${error.message}`);
    }

    return (data ?? []).map((row) => mapEdgeBox(asRecord(row)));
}

async function listEdgeDeviceCredentials(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<EdgeBoxDeviceCredentialRecord[]> {
    const C = EDGE_BOX_DEVICE_CREDENTIALS.COLUMNS;
    const { data, error } = await client
        .from(EDGE_BOX_DEVICE_CREDENTIALS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.updated_at, { ascending: false })
        .limit(limit * 2);

    if (error) {
        if (isMissingEdgeCredentialTableError(error)) return [];
        throw new Error(`Failed to list edge box device credentials: ${error.message}`);
    }

    return (data ?? []).map((row) => mapEdgeDeviceCredential(asRecord(row)));
}

async function listEdgeSyncJobs(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<EdgeSyncJobRecord[]> {
    const C = EDGE_SYNC_JOBS.COLUMNS;
    const { data, error } = await client
        .from(EDGE_SYNC_JOBS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.scheduled_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list edge sync jobs: ${error.message}`);
    }

    return (data ?? []).map((row) => mapEdgeSyncJob(asRecord(row)));
}

async function listEdgeSyncArtifacts(
    client: SupabaseClient,
    tenantId: string,
    limit: number,
): Promise<EdgeSyncArtifactRecord[]> {
    const C = EDGE_SYNC_ARTIFACTS.COLUMNS;
    const { data, error } = await client
        .from(EDGE_SYNC_ARTIFACTS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.created_at, { ascending: false })
        .limit(limit);

    if (error) {
        throw new Error(`Failed to list edge sync artifacts: ${error.message}`);
    }

    return (data ?? []).map((row) => mapEdgeSyncArtifact(asRecord(row)));
}

function mapEdgeBox(row: Record<string, unknown>): EdgeBoxRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        node_name: readString(row.node_name) ?? 'unknown-node',
        site_label: readString(row.site_label) ?? 'Unknown site',
        hardware_class: readString(row.hardware_class),
        status: (readString(row.status) ?? 'provisioning') as EdgeBoxStatus,
        software_version: readString(row.software_version),
        last_heartbeat_at: readString(row.last_heartbeat_at),
        last_sync_at: readString(row.last_sync_at),
        metadata: sanitizeEdgeBoxMetadata(asRecord(row.metadata)),
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapEdgeDeviceCredential(row: Record<string, unknown>): EdgeBoxDeviceCredentialRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        edge_box_id: readString(row.edge_box_id) ?? 'unknown_edge_box',
        key_prefix: readString(row.key_prefix) ?? 'unknown_prefix',
        status: normalizeEdgeDeviceCredentialStatus(row.status),
        issued_reason: normalizeEdgeDeviceCredentialIssueReason(row.issued_reason),
        scopes: readStringArray(row.scopes),
        expires_at: readString(row.expires_at),
        last_used_at: readString(row.last_used_at),
        last_used_action: readString(row.last_used_action),
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
        revoked_by: readString(row.revoked_by),
        revoked_at: readString(row.revoked_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapEdgeSyncJob(row: Record<string, unknown>): EdgeSyncJobRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        edge_box_id: readString(row.edge_box_id) ?? 'unknown_edge_box',
        job_type: (readString(row.job_type) ?? 'config_sync') as EdgeSyncJobType,
        direction: (readString(row.direction) ?? 'cloud_to_edge') as EdgeSyncDirection,
        status: (readString(row.status) ?? 'queued') as EdgeSyncJobStatus,
        payload: asRecord(row.payload),
        scheduled_at: String(row.scheduled_at ?? row.created_at),
        started_at: readString(row.started_at),
        completed_at: readString(row.completed_at),
        error_message: readString(row.error_message),
        created_by: readString(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapEdgeSyncArtifact(row: Record<string, unknown>): EdgeSyncArtifactRecord {
    return {
        id: String(row.id),
        tenant_id: readString(row.tenant_id) ?? 'unknown_tenant',
        edge_box_id: readString(row.edge_box_id),
        artifact_type: (readString(row.artifact_type) ?? 'config_bundle') as EdgeArtifactType,
        artifact_ref: readString(row.artifact_ref) ?? 'unknown_artifact',
        content_hash: readString(row.content_hash) ?? 'unknown_hash',
        size_bytes: typeof row.size_bytes === 'number' ? row.size_bytes : Number(row.size_bytes ?? 0),
        status: (readString(row.status) ?? 'staged') as EdgeArtifactStatus,
        metadata: asRecord(row.metadata),
        created_at: String(row.created_at),
        synced_at: readString(row.synced_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

async function requireEdgeBoxForTenant(
    client: SupabaseClient,
    tenantId: string,
    edgeBoxId: string,
): Promise<EdgeBoxRecord> {
    const C = EDGE_BOXES.COLUMNS;
    const { data, error } = await client
        .from(EDGE_BOXES.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.id, requireText(edgeBoxId, 'edge_box_id'))
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to verify edge box ownership: ${error.message}`);
    }
    if (!data) {
        throw new Error('Edge box not found for this tenant.');
    }

    return mapEdgeBox(asRecord(data));
}

async function requireEdgeDeviceCredentialForTenant(
    client: SupabaseClient,
    tenantId: string,
    credentialId: string,
): Promise<EdgeBoxDeviceCredentialRecord> {
    const C = EDGE_BOX_DEVICE_CREDENTIALS.COLUMNS;
    const { data, error } = await client
        .from(EDGE_BOX_DEVICE_CREDENTIALS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.id, requireText(credentialId, 'credential_id'))
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load edge box credential: ${error.message}`);
    }
    if (!data) {
        throw new Error('Edge box credential not found for this tenant.');
    }

    return mapEdgeDeviceCredential(asRecord(data));
}

async function issueEdgeDeviceCredential(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        edgeBox: EdgeBoxRecord;
        token: string;
        reason: EdgeDeviceCredentialIssueReason;
        metadata?: Record<string, unknown>;
    },
): Promise<EdgeBoxDeviceCredentialRecord> {
    const C = EDGE_BOX_DEVICE_CREDENTIALS.COLUMNS;
    const now = new Date().toISOString();
    const tokenHash = hashEdgeToken(input.token);
    const keyPrefix = extractEdgeTokenPrefix(input.token);

    const { error: rotateError } = await client
        .from(EDGE_BOX_DEVICE_CREDENTIALS.TABLE)
        .update({
            [C.status]: 'rotated',
            [C.revoked_by]: input.actor,
            [C.revoked_at]: now,
        })
        .eq(C.tenant_id, input.tenantId)
        .eq(C.edge_box_id, input.edgeBox.id)
        .eq(C.status, 'active');

    if (rotateError && !isMissingEdgeCredentialTableError(rotateError)) {
        throw new Error(`Failed to rotate existing edge credentials: ${rotateError.message}`);
    }
    if (rotateError && isMissingEdgeCredentialTableError(rotateError)) {
        throw rotateError;
    }

    const { data, error } = await client
        .from(EDGE_BOX_DEVICE_CREDENTIALS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.edge_box_id]: input.edgeBox.id,
            [C.key_prefix]: keyPrefix,
            [C.token_hash]: tokenHash,
            [C.status]: 'active',
            [C.issued_reason]: input.reason,
            [C.scopes]: ['edge:heartbeat', 'edge:sync:pull', 'edge:sync:ack'],
            [C.expires_at]: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
            [C.metadata]: {
                ...(input.metadata ?? {}),
                node_name: input.edgeBox.node_name,
                site_label: input.edgeBox.site_label,
            },
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to issue edge box credential: ${error?.message ?? 'Unknown error'}`);
    }

    return mapEdgeDeviceCredential(asRecord(data));
}

async function findActiveEdgeDeviceCredential(
    client: SupabaseClient,
    input: {
        edgeBoxId: string;
        tokenHash: string;
    },
): Promise<EdgeBoxDeviceCredentialRecord | null> {
    const C = EDGE_BOX_DEVICE_CREDENTIALS.COLUMNS;
    const { data, error } = await client
        .from(EDGE_BOX_DEVICE_CREDENTIALS.TABLE)
        .select('*')
        .eq(C.edge_box_id, input.edgeBoxId)
        .eq(C.token_hash, input.tokenHash)
        .eq(C.status, 'active')
        .maybeSingle();

    if (error) {
        throw error;
    }
    return data ? mapEdgeDeviceCredential(asRecord(data)) : null;
}

async function edgeBoxHasCredentialLedger(client: SupabaseClient, edgeBoxId: string): Promise<boolean> {
    const C = EDGE_BOX_DEVICE_CREDENTIALS.COLUMNS;
    const { data, error } = await client
        .from(EDGE_BOX_DEVICE_CREDENTIALS.TABLE)
        .select(C.id)
        .eq(C.edge_box_id, edgeBoxId)
        .limit(1);

    if (error) {
        throw error;
    }
    return (data ?? []).length > 0;
}

async function markEdgeDeviceCredentialUsed(
    client: SupabaseClient,
    credential: EdgeBoxDeviceCredentialRecord,
    action: EdgeDeviceCredentialAction,
): Promise<void> {
    const C = EDGE_BOX_DEVICE_CREDENTIALS.COLUMNS;
    await client
        .from(EDGE_BOX_DEVICE_CREDENTIALS.TABLE)
        .update({
            [C.last_used_at]: new Date().toISOString(),
            [C.last_used_action]: action,
        })
        .eq(C.id, credential.id);
}

async function expireEdgeDeviceCredential(
    client: SupabaseClient,
    credential: EdgeBoxDeviceCredentialRecord,
): Promise<void> {
    const C = EDGE_BOX_DEVICE_CREDENTIALS.COLUMNS;
    await client
        .from(EDGE_BOX_DEVICE_CREDENTIALS.TABLE)
        .update({
            [C.status]: 'expired',
            [C.metadata]: {
                ...credential.metadata,
                expired_at: new Date().toISOString(),
            },
        })
        .eq(C.id, credential.id);
}

async function enqueueEdgeSyncOutboxEvent(
    client: SupabaseClient,
    input: {
        tenantId: string;
        edgeBox: EdgeBoxRecord;
        syncJob: EdgeSyncJobRecord;
    },
) {
    await createOutboxEvent({
        aggregateType: 'edge_sync',
        aggregateId: input.syncJob.id,
        eventName: 'edge.sync_job_queued',
        payload: {
            tenant_id: input.tenantId,
            edge_box_id: input.edgeBox.id,
            sync_job_id: input.syncJob.id,
            job_type: input.syncJob.job_type,
            direction: input.syncJob.direction,
            scheduled_at: input.syncJob.scheduled_at,
        },
        metadata: {
            tenant_id: input.tenantId,
            edge_box_id: input.edgeBox.id,
            sync_job_id: input.syncJob.id,
        },
    }, client);
}

async function recordEdgeControlAction(
    client: SupabaseClient,
    input: {
        tenantId: string;
        actor: string | null;
        actionType: string;
        targetType?: string;
        targetId?: string;
        status?: 'requested' | 'completed' | 'failed';
        metadata?: Record<string, unknown>;
    },
) {
    await recordControlPlaneAction({
        client,
        tenantId: input.tenantId,
        actor: input.actor,
        actionType: input.actionType,
        status: input.status ?? 'completed',
        targetType: input.targetType ?? 'edge_box',
        targetId: input.targetId ?? null,
        requiresConfirmation: false,
        metadata: input.metadata ?? {},
    }).catch(() => undefined);
}

function buildEdgeSyncPayload(payload: Record<string, unknown>, edgeBox: EdgeBoxRecord): Record<string, unknown> {
    return {
        ...payload,
        edge_box: {
            id: edgeBox.id,
            node_name: edgeBox.node_name,
            site_label: edgeBox.site_label,
            software_version: edgeBox.software_version,
        },
    };
}

function generateProvisioningToken(): string {
    const keyPrefix = randomBytes(5).toString('hex');
    return `vetios_edge_${keyPrefix}_${randomBytes(32).toString('base64url')}`;
}

function hashEdgeToken(token: string): string {
    return createHash('sha256').update(requireText(token, 'edge_token')).digest('hex');
}

function extractEdgeTokenPrefix(token: string): string {
    const normalized = requireText(token, 'edge_token');
    const parts = normalized.split('_');
    if (parts.length >= 4 && parts[0] === 'vetios' && parts[1] === 'edge') {
        return parts[2].slice(0, 32);
    }
    return createHash('sha256').update(normalized).digest('hex').slice(0, 10);
}

function compareEdgeTokenHash(token: string, expectedHash: string): boolean {
    const actual = Buffer.from(hashEdgeToken(token), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function unauthorizedEdgeBoxError(): Error {
    const error = new Error('Unauthorized edge box.');
    (error as Error & { status?: number }).status = 401;
    return error;
}

function sanitizeEdgeBoxMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...metadata };
    delete sanitized[EDGE_AUTH_TOKEN_METADATA_KEY];
    return sanitized;
}

function normalizeEdgeSyncJobType(value: string): EdgeSyncJobType {
    if (value === 'telemetry_flush' || value === 'model_bundle' || value === 'dataset_delta' || value === 'config_sync') {
        return value;
    }
    throw new Error('Invalid edge sync job_type.');
}

function normalizeEdgeSyncDirection(value: string): EdgeSyncDirection {
    if (value === 'cloud_to_edge' || value === 'edge_to_cloud') {
        return value;
    }
    throw new Error('Invalid edge sync direction.');
}

function normalizeEdgeArtifactType(value: string): EdgeArtifactType {
    if (value === 'model_bundle' || value === 'dataset_delta' || value === 'config_bundle' || value === 'telemetry_archive') {
        return value;
    }
    throw new Error('Invalid edge artifact_type.');
}

function normalizeEdgeDeviceCredentialStatus(value: unknown): EdgeDeviceCredentialStatus {
    return value === 'active' || value === 'rotated' || value === 'revoked' || value === 'expired'
        ? value
        : 'active';
}

function normalizeEdgeDeviceCredentialIssueReason(value: unknown): EdgeDeviceCredentialIssueReason {
    return value === 'provisioning' || value === 'rotation' || value === 'recovery'
        ? value
        : 'provisioning';
}

function normalizeContentHash(value: string): string {
    const normalized = requireText(value, 'content_hash').replace(/^sha256:/i, '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new Error('content_hash must be a SHA-256 hex digest.');
    }
    return normalized;
}

function requireText(value: string | null | undefined, field: string): string {
    if (!value || value.trim().length === 0) {
        throw new Error(`${field} is required.`);
    }
    return value.trim();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function isMissingEdgeCredentialTableError(error: unknown): boolean {
    const message = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message ?? '')
            : String(error ?? '');
    return message.includes(EDGE_BOX_DEVICE_CREDENTIALS.TABLE)
        || message.includes('Could not find the table')
        || message.includes('schema cache');
}
