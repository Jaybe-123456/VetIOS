import type { SupabaseClient } from '@supabase/supabase-js';
import {
    EDGE_BOXES,
    EDGE_SYNC_ARTIFACTS,
    EDGE_SYNC_JOBS,
} from '@/lib/db/schemaContracts';
import { resolvePublicCatalogTenant, type PublicCatalogSource } from '@/lib/platform/publicTenant';
import { getSupabaseServer } from '@/lib/supabaseServer';

export type EdgeBoxStatus = 'provisioning' | 'online' | 'degraded' | 'offline' | 'retired';
export type EdgeSyncJobType = 'telemetry_flush' | 'model_bundle' | 'dataset_delta' | 'config_sync';
export type EdgeSyncDirection = 'cloud_to_edge' | 'edge_to_cloud';
export type EdgeSyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type EdgeArtifactType = 'model_bundle' | 'dataset_delta' | 'config_bundle' | 'telemetry_archive';
export type EdgeArtifactStatus = 'staged' | 'synced' | 'failed' | 'expired';

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

export interface EdgeBoxControlPlaneSnapshot {
    tenant_id: string;
    edge_boxes: EdgeBoxRecord[];
    sync_jobs: EdgeSyncJobRecord[];
    sync_artifacts: EdgeSyncArtifactRecord[];
    summary: {
        online_nodes: number;
        degraded_nodes: number;
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

export async function getEdgeBoxControlPlaneSnapshot(
    client: SupabaseClient,
    tenantId: string,
    options: { limit?: number } = {},
): Promise<EdgeBoxControlPlaneSnapshot> {
    const limit = options.limit ?? 24;
    const [edgeBoxes, syncJobs, syncArtifacts] = await Promise.all([
        listEdgeBoxes(client, tenantId, limit),
        listEdgeSyncJobs(client, tenantId, limit),
        listEdgeSyncArtifacts(client, tenantId, limit),
    ]);

    return {
        tenant_id: tenantId,
        edge_boxes: edgeBoxes,
        sync_jobs: syncJobs,
        sync_artifacts: syncArtifacts,
        summary: {
            online_nodes: edgeBoxes.filter((box) => box.status === 'online').length,
            degraded_nodes: edgeBoxes.filter((box) => box.status === 'degraded' || box.status === 'offline').length,
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
): Promise<EdgeBoxRecord> {
    const C = EDGE_BOXES.COLUMNS;
    const payload = {
        [C.tenant_id]: input.tenantId,
        [C.node_name]: requireText(input.nodeName, 'node_name'),
        [C.site_label]: requireText(input.siteLabel, 'site_label'),
        [C.hardware_class]: normalizeOptionalText(input.hardwareClass),
        [C.status]: input.status ?? 'provisioning',
        [C.software_version]: normalizeOptionalText(input.softwareVersion),
        [C.metadata]: input.metadata ?? {},
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

    return mapEdgeBox(asRecord(data));
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
    const C = EDGE_SYNC_JOBS.COLUMNS;
    const { data, error } = await client
        .from(EDGE_SYNC_JOBS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.edge_box_id]: input.edgeBoxId,
            [C.job_type]: input.jobType,
            [C.direction]: input.direction,
            [C.status]: input.status ?? 'queued',
            [C.payload]: input.payload ?? {},
            [C.scheduled_at]: normalizeOptionalText(input.scheduledAt) ?? new Date().toISOString(),
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to queue edge sync job: ${error?.message ?? 'Unknown error'}`);
    }

    return mapEdgeSyncJob(asRecord(data));
}

export async function registerEdgeArtifact(
    client: SupabaseClient,
    input: {
        tenantId: string;
        edgeBoxId?: string | null;
        artifactType: EdgeArtifactType;
        artifactRef: string;
        contentHash: string;
        sizeBytes?: number;
        status?: EdgeArtifactStatus;
        metadata?: Record<string, unknown>;
    },
): Promise<EdgeSyncArtifactRecord> {
    const C = EDGE_SYNC_ARTIFACTS.COLUMNS;
    const { data, error } = await client
        .from(EDGE_SYNC_ARTIFACTS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.edge_box_id]: normalizeOptionalText(input.edgeBoxId),
            [C.artifact_type]: input.artifactType,
            [C.artifact_ref]: requireText(input.artifactRef, 'artifact_ref'),
            [C.content_hash]: requireText(input.contentHash, 'content_hash'),
            [C.size_bytes]: Math.max(0, Math.round(input.sizeBytes ?? 0)),
            [C.status]: input.status ?? 'staged',
            [C.metadata]: input.metadata ?? {},
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to register edge artifact: ${error?.message ?? 'Unknown error'}`);
    }

    return mapEdgeSyncArtifact(asRecord(data));
}

export async function updateEdgeHeartbeat(
    client: SupabaseClient,
    input: {
        tenantId: string;
        edgeBoxId: string;
        status?: EdgeBoxStatus;
        softwareVersion?: string | null;
    },
): Promise<EdgeBoxRecord> {
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

    return mapEdgeBox(asRecord(data));
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
        metadata: asRecord(row.metadata),
        created_by: readString(row.created_by),
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

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
