import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    createConnectorInstallationWithCredential,
    getConnectorInstallation,
    listConnectorInstallations,
    updateConnectorInstallation,
    type ConnectorInstallationRecord,
} from '@/lib/auth/machineAuth';
import {
    CONNECTOR_INSTALLATIONS,
    PASSIVE_NATIVE_VENDOR_CONNECTIONS,
    PASSIVE_NATIVE_VENDOR_SYNC_RUNS,
    PASSIVE_SIGNAL_EVENTS,
    SIGNAL_SOURCES,
} from '@/lib/db/schemaContracts';
import { dispatchOutboxBatch, enqueueOutboxEvent, getOutboxQueueSnapshot, type ConnectorDeliveryAttemptRecord } from '@/lib/eventPlane/outbox';
import {
    getNativeVendorAdapter,
    nativeVendorAdapters,
    type NativeVendorAdapterDefinition,
    type NativeVendorAuthProtocol,
} from '@/lib/platform/nativeVendorAdapters';
import { passiveSignalConnectors } from '@/lib/platform/passiveSignalCatalog';
import {
    passiveSignalMarketplace,
    type PassiveConnectorSyncMode,
    type PassiveSignalMarketplaceDefinition,
} from '@/lib/platform/passiveSignalMarketplace';

export type NativeVendorConnectionStatus = 'authorization_required' | 'active' | 'paused' | 'revoked' | 'error';
export type NativeVendorSyncRunReason = 'manual' | 'scheduled' | 'authorization_callback' | 'backfill';
export type NativeVendorSyncRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface NativeVendorConnectionRecord {
    id: string;
    tenant_id: string;
    adapter_key: string;
    connector_installation_id: string | null;
    vendor_name: string;
    vendor_account_ref: string | null;
    auth_protocol: NativeVendorAuthProtocol;
    status: NativeVendorConnectionStatus;
    authorization_state_hash: string | null;
    credential_ref_hash: string | null;
    requested_scopes: string[];
    adapter_runtime_url: string | null;
    supported_connector_types: string[];
    sync_mode: PassiveConnectorSyncMode;
    interval_hours: number | null;
    next_sync_at: string | null;
    last_authorized_at: string | null;
    last_sync_at: string | null;
    last_sync_status: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface NativeVendorSyncRunRecord {
    id: string;
    tenant_id: string;
    native_connection_id: string;
    connector_installation_id: string | null;
    adapter_key: string;
    run_reason: NativeVendorSyncRunReason;
    status: NativeVendorSyncRunStatus;
    requested_at: string;
    started_at: string | null;
    finished_at: string | null;
    events_ingested: number;
    outbox_event_id: string | null;
    error_message: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface IssuedNativeVendorConnection {
    connection: NativeVendorConnectionRecord;
    connector_installation: ConnectorInstallationRecord | null;
    generated_api_key: string | null;
    authorization_state: string;
    authorization_url: string | null;
}

export interface PassiveConnectorInstallationSnapshot extends ConnectorInstallationRecord {
    marketplace_template: PassiveSignalMarketplaceDefinition | null;
    sync_mode: PassiveConnectorSyncMode;
    auth_strategy: string | null;
    supported_connector_types: string[];
    webhook_url: string | null;
    scheduler: {
        enabled: boolean;
        interval_hours: number | null;
        next_sync_at: string | null;
        last_sync_requested_at: string | null;
        last_sync_status: string | null;
    };
    latest_delivery_attempt: ConnectorDeliveryAttemptRecord | null;
}

export interface PassiveSignalOperationsSnapshot {
    tenant_id: string;
    marketplace: PassiveSignalMarketplaceDefinition[];
    native_adapters: NativeVendorAdapterDefinition[];
    installations: PassiveConnectorInstallationSnapshot[];
    native_connections: NativeVendorConnectionRecord[];
    recent_native_sync_runs: NativeVendorSyncRunRecord[];
    readiness: PassiveSignalReadinessSnapshot;
    recent_delivery_attempts: ConnectorDeliveryAttemptRecord[];
    summary: {
        marketplace_templates: number;
        live_templates: number;
        native_adapter_templates: number;
        native_active_connections: number;
        native_authorization_required: number;
        native_queued_syncs: number;
        active_installations: number;
        scheduled_installations: number;
        webhook_installations: number;
        recent_failed_syncs: number;
        ready_connector_types: number;
        missing_connector_types: number;
        recent_signals_24h: number;
        stale_signal_sources: number;
    };
    refreshed_at: string;
}

export type PassiveSignalCoverageStatus = 'ready' | 'quiet' | 'stale' | 'missing';

export interface PassiveSignalCoverageRow {
    connector_type: string;
    label: string;
    catalog_readiness: 'live' | 'beta' | 'planned';
    installed_connectors: number;
    active_sources: number;
    recent_events_24h: number;
    recent_events_7d: number;
    last_observed_at: string | null;
    last_synced_at: string | null;
    status: PassiveSignalCoverageStatus;
    operator_note: string;
}

export interface PassiveSignalReadinessSnapshot {
    required_connector_types: number;
    ready_connector_types: number;
    quiet_connector_types: number;
    stale_connector_types: number;
    missing_connector_types: number;
    recent_signals_24h: number;
    recent_signals_7d: number;
    stale_signal_sources: number;
    coverage: PassiveSignalCoverageRow[];
    privacy_contract: string[];
}

export async function getPassiveSignalOperationsSnapshot(
    client: SupabaseClient,
    tenantId: string,
): Promise<PassiveSignalOperationsSnapshot> {
    const [installations, outboxSnapshot, signalSources, recentSignals, nativeConnections, nativeSyncRuns] = await Promise.all([
        listConnectorInstallations(client, tenantId),
        getOutboxQueueSnapshot(client, tenantId, {
            limit: 20,
            handlerKey: 'connector_webhook',
        }),
        listSignalSources(client, tenantId),
        listRecentPassiveSignals(client, tenantId),
        listNativeVendorConnections(client, tenantId),
        listNativeVendorSyncRuns(client, tenantId),
    ]);

    const attemptsByInstallation = new Map<string, ConnectorDeliveryAttemptRecord>();
    for (const attempt of outboxSnapshot.recent_attempts) {
        if (!attempt.connector_installation_id) continue;
        if (!attemptsByInstallation.has(attempt.connector_installation_id)) {
            attemptsByInstallation.set(attempt.connector_installation_id, attempt);
        }
    }

    const installationSnapshots = installations.map((installation) =>
        mapInstallationSnapshot(installation, attemptsByInstallation.get(installation.id) ?? null),
    );
    const readiness = buildPassiveSignalReadiness({
        installations: installationSnapshots,
        signalSources,
        recentSignals,
    });

    return {
        tenant_id: tenantId,
        marketplace: passiveSignalMarketplace,
        native_adapters: nativeVendorAdapters,
        installations: installationSnapshots,
        native_connections: nativeConnections,
        recent_native_sync_runs: nativeSyncRuns,
        readiness,
        recent_delivery_attempts: outboxSnapshot.recent_attempts,
        summary: {
            marketplace_templates: passiveSignalMarketplace.length,
            live_templates: passiveSignalMarketplace.filter((template) => template.readiness === 'live').length,
            native_adapter_templates: nativeVendorAdapters.length,
            native_active_connections: nativeConnections.filter((connection) => connection.status === 'active').length,
            native_authorization_required: nativeConnections.filter((connection) => connection.status === 'authorization_required').length,
            native_queued_syncs: nativeSyncRuns.filter((run) => run.status === 'queued' || run.status === 'running').length,
            active_installations: installationSnapshots.filter((installation) => installation.status === 'active').length,
            scheduled_installations: installationSnapshots.filter((installation) => installation.scheduler.enabled).length,
            webhook_installations: installationSnapshots.filter((installation) => installation.sync_mode === 'webhook_push').length,
            recent_failed_syncs: outboxSnapshot.recent_attempts.filter((attempt) => attempt.status === 'dead_letter' || attempt.status === 'retryable').length,
            ready_connector_types: readiness.ready_connector_types,
            missing_connector_types: readiness.missing_connector_types,
            recent_signals_24h: readiness.recent_signals_24h,
            stale_signal_sources: readiness.stale_signal_sources,
        },
        refreshed_at: new Date().toISOString(),
    };
}

export async function installMarketplacePassiveConnector(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    marketplaceId: string;
    installationName?: string | null;
    vendorAccountRef?: string | null;
    webhookUrl?: string | null;
    intervalHours?: number | null;
}): Promise<{
    installation: ConnectorInstallationRecord;
    generated_api_key: string;
}> {
    const template = requireMarketplaceTemplate(input.marketplaceId);
    const intervalHours = normalizePositiveInteger(input.intervalHours) ?? template.default_interval_hours;
    const schedulerEnabled = template.sync_mode === 'scheduled_pull';
    const metadata = buildPassiveConnectorMetadata({
        template,
        webhookUrl: normalizeOptionalText(input.webhookUrl),
        intervalHours,
        schedulerEnabled,
        nextSyncAt: schedulerEnabled && intervalHours != null
            ? new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString()
            : null,
    });

    const created = await createConnectorInstallationWithCredential({
        client: input.client,
        tenantId: input.tenantId,
        actor: input.actor,
        installationName: normalizeOptionalText(input.installationName) ?? template.label,
        connectorType: template.supported_connector_types[0] ?? 'lab_result',
        vendorName: template.vendor_name,
        vendorAccountRef: normalizeOptionalText(input.vendorAccountRef),
        label: `${template.label} connector`,
        scopes: ['signals:connect', 'signals:ingest'],
        metadata,
    });

    return {
        installation: created.installation,
        generated_api_key: created.apiKey,
    };
}

export async function configurePassiveConnectorInstallation(input: {
    client: SupabaseClient;
    tenantId: string;
    connectorInstallationId: string;
    installationName?: string | null;
    vendorAccountRef?: string | null;
    status?: ConnectorInstallationRecord['status'];
    webhookUrl?: string | null;
    syncMode?: PassiveConnectorSyncMode | null;
    intervalHours?: number | null;
    schedulerEnabled?: boolean | null;
}): Promise<ConnectorInstallationRecord> {
    const existing = await getConnectorInstallation(input.client, input.tenantId, input.connectorInstallationId);
    if (!existing) {
        throw new Error('Connector installation was not found.');
    }

    const current = readPassiveConnectorConfig(existing.metadata);
    const nextSyncMode = input.syncMode ?? current.sync_mode;
    const nextIntervalHours = normalizePositiveInteger(input.intervalHours) ?? current.scheduler.interval_hours;
    const nextSchedulerEnabled = input.schedulerEnabled ?? current.scheduler.enabled;
    const nextWebhookUrl = input.webhookUrl !== undefined ? normalizeOptionalText(input.webhookUrl) : current.webhook_url;

    return updateConnectorInstallation({
        client: input.client,
        tenantId: input.tenantId,
        connectorInstallationId: input.connectorInstallationId,
        patch: {
            installation_name: normalizeOptionalText(input.installationName) ?? undefined,
            vendor_account_ref: input.vendorAccountRef !== undefined ? normalizeOptionalText(input.vendorAccountRef) : undefined,
            status: input.status,
            metadata: {
                webhook_url: nextWebhookUrl,
                passive_signal: {
                    ...asRecord(existing.metadata.passive_signal),
                    sync_mode: nextSyncMode,
                    supported_connector_types: current.supported_connector_types,
                    auth_strategy: current.auth_strategy,
                    scheduler: {
                        enabled: Boolean(nextSchedulerEnabled),
                        interval_hours: nextIntervalHours,
                        next_sync_at: Boolean(nextSchedulerEnabled) && nextIntervalHours != null
                            ? current.scheduler.next_sync_at ?? new Date(Date.now() + nextIntervalHours * 60 * 60 * 1000).toISOString()
                            : null,
                        last_sync_requested_at: current.scheduler.last_sync_requested_at,
                        last_sync_status: current.scheduler.last_sync_status,
                    },
                },
            },
        },
    });
}

export async function createNativeVendorConnection(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    adapterKey: string;
    vendorAccountRef?: string | null;
    connectorInstallationId?: string | null;
    adapterRuntimeUrl?: string | null;
    intervalHours?: number | null;
    requestedScopes?: string[];
    redirectUri?: string | null;
}): Promise<IssuedNativeVendorConnection> {
    const adapter = requireNativeVendorAdapter(input.adapterKey);
    const authorizationState = createNativeAuthorizationState();
    const intervalHours = normalizePositiveInteger(input.intervalHours) ?? adapter.default_interval_hours;
    const connector = input.connectorInstallationId
        ? {
            installation: await requireConnectorInstallation(input.client, input.tenantId, input.connectorInstallationId),
            apiKey: null,
        }
        : await createConnectorInstallationWithCredential({
            client: input.client,
            tenantId: input.tenantId,
            actor: input.actor,
            installationName: `${adapter.display_name} native connection`,
            connectorType: adapter.supported_connector_types[0] ?? 'pims_sync',
            vendorName: adapter.vendor_name,
            vendorAccountRef: normalizeOptionalText(input.vendorAccountRef),
            label: `${adapter.display_name} native runtime key`,
            scopes: ['signals:connect', 'signals:ingest'],
            metadata: {
                passive_signal: {
                    native_adapter_key: adapter.adapter_key,
                    native_adapter: true,
                    supported_connector_types: adapter.supported_connector_types,
                    sync_mode: adapter.sync_mode,
                    auth_strategy: adapter.auth_protocol,
                    scheduler: {
                        enabled: adapter.sync_mode === 'scheduled_pull',
                        interval_hours: intervalHours,
                        next_sync_at: intervalHours != null ? new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString() : null,
                        last_sync_requested_at: null,
                        last_sync_status: null,
                    },
                },
            },
        });
    const runtimeUrl = normalizeOptionalText(input.adapterRuntimeUrl);
    const scopes = normalizeScopes(input.requestedScopes, adapter);
    const now = new Date().toISOString();
    const C = PASSIVE_NATIVE_VENDOR_CONNECTIONS.COLUMNS;
    const { data, error } = await input.client
        .from(PASSIVE_NATIVE_VENDOR_CONNECTIONS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.adapter_key]: adapter.adapter_key,
            [C.connector_installation_id]: connector.installation.id,
            [C.vendor_name]: adapter.vendor_name,
            [C.vendor_account_ref]: normalizeOptionalText(input.vendorAccountRef),
            [C.auth_protocol]: adapter.auth_protocol,
            [C.status]: adapter.auth_protocol === 'oauth2_pkce' ? 'authorization_required' : 'active',
            [C.authorization_state_hash]: hashSecret(authorizationState),
            [C.credential_ref_hash]: null,
            [C.requested_scopes]: scopes,
            [C.adapter_runtime_url]: runtimeUrl,
            [C.supported_connector_types]: adapter.supported_connector_types,
            [C.sync_mode]: adapter.sync_mode,
            [C.interval_hours]: intervalHours,
            [C.next_sync_at]: adapter.sync_mode === 'scheduled_pull' && intervalHours != null
                ? new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString()
                : null,
            [C.last_authorized_at]: adapter.auth_protocol === 'oauth2_pkce' ? null : now,
            [C.last_sync_status]: 'not_started',
            [C.metadata]: {
                adapter_type: adapter.adapter_type,
                vendor_contract_required: adapter.vendor_contract_required,
                redirect_uri: normalizeOptionalText(input.redirectUri),
                authorization_state_issued_at: now,
                setup_steps: adapter.setup_steps,
            },
            [C.created_by]: input.actor,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create native vendor connection: ${error?.message ?? 'Unknown error'}`);
    }

    const connection = mapNativeVendorConnection(asRecord(data));
    return {
        connection,
        connector_installation: connector.installation,
        generated_api_key: connector.apiKey,
        authorization_state: authorizationState,
        authorization_url: buildNativeAuthorizationUrl(adapter, {
            state: authorizationState,
            redirectUri: normalizeOptionalText(input.redirectUri),
            scopes,
        }),
    };
}

export async function acceptNativeVendorAuthorizationCallback(input: {
    client: SupabaseClient;
    state: string;
    code?: string | null;
    error?: string | null;
}): Promise<NativeVendorConnectionRecord> {
    const stateHash = hashSecret(input.state);
    const C = PASSIVE_NATIVE_VENDOR_CONNECTIONS.COLUMNS;
    const { data: existing, error: lookupError } = await input.client
        .from(PASSIVE_NATIVE_VENDOR_CONNECTIONS.TABLE)
        .select('*')
        .eq(C.authorization_state_hash, stateHash)
        .maybeSingle();

    if (lookupError) {
        throw new Error(`Failed to resolve native vendor authorization state: ${lookupError.message}`);
    }
    if (!existing) {
        throw new Error('Native vendor authorization state was not found.');
    }

    const existingRecord = asRecord(existing);
    const existingMetadata = asRecord(existingRecord.metadata);
    const issuedAt = normalizeTimestamp(existingMetadata.authorization_state_issued_at);
    const stateMaxAgeMs = 10 * 60_000;
    if (!issuedAt || Date.now() - Date.parse(issuedAt) > stateMaxAgeMs) {
        await input.client
            .from(PASSIVE_NATIVE_VENDOR_CONNECTIONS.TABLE)
            .update({
                [C.status]: 'error',
                [C.authorization_state_hash]: null,
                [C.last_sync_status]: 'authorization_state_expired',
                [C.metadata]: {
                    ...existingMetadata,
                    authorization_state_expired_at: new Date().toISOString(),
                },
            })
            .eq(C.id, String(existingRecord.id))
            .eq(C.authorization_state_hash, stateHash);
        throw new Error('Native vendor authorization state has expired.');
    }
    if (normalizeNativeAuthProtocol(existingRecord.auth_protocol) !== 'oauth2_pkce') {
        throw new Error('Native vendor authorization callback is only valid for OAuth 2.0 PKCE connections.');
    }
    if (!input.error && !normalizeOptionalText(input.code)) {
        throw new Error('Native vendor authorization code is required.');
    }

    const now = new Date().toISOString();
    const status: NativeVendorConnectionStatus = input.error ? 'error' : 'authorization_required';
    const { data, error } = await input.client
        .from(PASSIVE_NATIVE_VENDOR_CONNECTIONS.TABLE)
        .update({
            [C.status]: status,
            [C.authorization_state_hash]: null,
            [C.credential_ref_hash]: existingRecord.credential_ref_hash ?? null,
            [C.last_authorized_at]: null,
            [C.last_sync_status]: input.error ? 'authorization_error' : 'token_exchange_pending',
            [C.metadata]: {
                ...existingMetadata,
                authorization_callback_at: now,
                authorization_error: normalizeOptionalText(input.error),
                authorization_code_received: Boolean(input.code),
                token_exchange_status: input.error ? 'not_started' : 'pending',
            },
        })
        .eq(C.id, String(existingRecord.id))
        .eq(C.authorization_state_hash, stateHash)
        .select('*')
        .maybeSingle();

    if (error || !data) {
        throw new Error(`Failed to consume native vendor authorization state: ${error?.message ?? 'State was already used'}`);
    }

    return mapNativeVendorConnection(asRecord(data));
}

export async function queueNativeVendorSync(input: {
    client: SupabaseClient;
    tenantId: string;
    nativeConnectionId: string;
    reason: NativeVendorSyncRunReason;
    dispatchNow?: boolean;
}): Promise<{
    connection: NativeVendorConnectionRecord;
    sync_run: NativeVendorSyncRunRecord;
}> {
    const connection = await requireNativeVendorConnection(input.client, input.tenantId, input.nativeConnectionId);
    if (connection.status !== 'active') {
        throw new Error('Native vendor connection must be active before sync can run.');
    }

    const run = await insertNativeVendorSyncRun(input.client, {
        tenantId: input.tenantId,
        connection,
        reason: input.reason,
        status: 'queued',
        metadata: {
            supported_connector_types: connection.supported_connector_types,
            adapter_runtime_configured: Boolean(connection.adapter_runtime_url),
        },
    });

    let outboxEventId: string | null = null;
    if (connection.adapter_runtime_url) {
        const event = await enqueueOutboxEvent(input.client, {
            tenantId: input.tenantId,
            topic: 'native_vendor.sync_requested',
            handlerKey: 'connector_webhook',
            targetType: 'connector_webhook',
            targetRef: connection.connector_installation_id,
            idempotencyKey: `native-vendor-sync:${run.id}`,
            payload: {
                native_sync_run_id: run.id,
                native_connection_id: connection.id,
                adapter_key: connection.adapter_key,
                vendor_name: connection.vendor_name,
                vendor_account_ref: connection.vendor_account_ref,
                requested_at: run.requested_at,
                supported_connector_types: connection.supported_connector_types,
            },
            metadata: {
                webhook_url: connection.adapter_runtime_url,
                native_vendor_adapter: true,
                adapter_key: connection.adapter_key,
                vendor_name: connection.vendor_name,
            },
            maxAttempts: 4,
        });
        outboxEventId = event.event.id;
    }

    const completedRun = outboxEventId
        ? await updateNativeVendorSyncRunOutbox(input.client, run, outboxEventId)
        : run;

    await touchNativeVendorConnectionAfterSyncRequest(input.client, connection, completedRun);

    if (input.dispatchNow !== false && outboxEventId) {
        await dispatchOutboxBatch(input.client, {
            workerId: `native-vendor-sync:${connection.id}:${Date.now().toString(36)}`,
            tenantId: input.tenantId,
            batchSize: 10,
        });
    }

    return {
        connection,
        sync_run: completedRun,
    };
}

export async function runDueNativeVendorSyncs(input: {
    client: SupabaseClient;
    tenantId?: string | null;
    actor: string | null;
}): Promise<NativeVendorSyncRunRecord[]> {
    const connections = input.tenantId
        ? await listNativeVendorConnections(input.client, input.tenantId)
        : await listNativeVendorConnectionsAcrossTenants(input.client);
    const now = Date.now();
    const queued: NativeVendorSyncRunRecord[] = [];

    for (const connection of connections) {
        if (connection.status !== 'active') continue;
        if (connection.sync_mode !== 'scheduled_pull') continue;
        if (!connection.next_sync_at) continue;
        if (new Date(connection.next_sync_at).getTime() > now) continue;
        const result = await queueNativeVendorSync({
            client: input.client,
            tenantId: connection.tenant_id,
            nativeConnectionId: connection.id,
            reason: 'scheduled',
            dispatchNow: false,
        });
        queued.push(result.sync_run);
    }

    return queued;
}

export async function requestPassiveConnectorSync(input: {
    client: SupabaseClient;
    tenantId: string;
    actor: string | null;
    connectorInstallationId: string;
    reason: 'manual' | 'scheduled';
    dispatchNow?: boolean;
}): Promise<{
    installation: ConnectorInstallationRecord;
    outbox_event_id: string;
}> {
    const installation = await getConnectorInstallation(input.client, input.tenantId, input.connectorInstallationId);
    if (!installation) {
        throw new Error('Connector installation was not found.');
    }

    const config = readPassiveConnectorConfig(installation.metadata);
    if (!config.webhook_url) {
        throw new Error('Connector installation is missing webhook_url and cannot run sync.');
    }

    const now = new Date();
    const event = await enqueueOutboxEvent(input.client, {
        tenantId: input.tenantId,
        topic: 'connector.sync_requested',
        handlerKey: 'connector_webhook',
        targetType: 'connector_webhook',
        targetRef: installation.id,
        idempotencyKey: `connector-sync:${installation.id}:${input.reason}:${now.toISOString()}`,
        payload: {
            connector_installation_id: installation.id,
            reason: input.reason,
            requested_at: now.toISOString(),
            supported_connector_types: config.supported_connector_types,
            sync_mode: config.sync_mode,
            vendor_name: installation.vendor_name,
            vendor_account_ref: installation.vendor_account_ref,
        },
        metadata: {
            webhook_url: config.webhook_url,
            connector_type: installation.connector_type,
            vendor_name: installation.vendor_name,
            vendor_account_ref: installation.vendor_account_ref,
            marketplace_id: config.marketplace_id,
        },
    });

    const updated = await updateConnectorInstallation({
        client: input.client,
        tenantId: input.tenantId,
        connectorInstallationId: installation.id,
        patch: {
            metadata: {
                passive_signal: {
                    ...asRecord(installation.metadata.passive_signal),
                    scheduler: {
                        ...asRecord(asRecord(installation.metadata.passive_signal).scheduler),
                        last_sync_requested_at: now.toISOString(),
                        last_sync_status: 'queued',
                        next_sync_at: config.scheduler.enabled && config.scheduler.interval_hours != null
                            ? new Date(now.getTime() + config.scheduler.interval_hours * 60 * 60 * 1000).toISOString()
                            : asRecord(asRecord(installation.metadata.passive_signal).scheduler).next_sync_at ?? null,
                    },
                },
            },
        },
    });

    if (input.dispatchNow !== false) {
        await dispatchOutboxBatch(input.client, {
            workerId: `passive-signal-sync:${installation.id}:${Date.now().toString(36)}`,
            tenantId: input.tenantId,
            batchSize: 10,
        });
    }

    return {
        installation: updated,
        outbox_event_id: event.event.id,
    };
}

export async function runDuePassiveConnectorSyncs(input: {
    client: SupabaseClient;
    tenantId?: string | null;
    actor: string | null;
}): Promise<Array<{
    connector_installation_id: string;
    installation_name: string;
    outbox_event_id: string;
}>> {
    const installations = input.tenantId
        ? await listConnectorInstallations(input.client, input.tenantId)
        : await listConnectorInstallationsAcrossTenants(input.client);
    const now = new Date();
    const queued: Array<{ connector_installation_id: string; installation_name: string; outbox_event_id: string; tenant_id: string }> = [];

    for (const installation of installations) {
        const config = readPassiveConnectorConfig(installation.metadata);
        if (installation.status !== 'active') continue;
        if (!config.scheduler.enabled) continue;
        if (config.sync_mode !== 'scheduled_pull') continue;
        if (!config.webhook_url) continue;
        if (config.scheduler.next_sync_at && new Date(config.scheduler.next_sync_at).getTime() > now.getTime()) continue;

        const sync = await requestPassiveConnectorSync({
            client: input.client,
            tenantId: installation.tenant_id,
            actor: input.actor,
            connectorInstallationId: installation.id,
            reason: 'scheduled',
            dispatchNow: false,
        });
        queued.push({
            connector_installation_id: installation.id,
            installation_name: installation.installation_name,
            outbox_event_id: sync.outbox_event_id,
            tenant_id: installation.tenant_id,
        });
    }

    const tenantIds = Array.from(new Set(queued.map((entry) => entry.tenant_id)));
    for (const tenantId of tenantIds) {
        await dispatchOutboxBatch(input.client, {
            workerId: `passive-signal-cron:${tenantId}:${Date.now().toString(36)}`,
            tenantId,
            batchSize: 25,
        });
    }

    return queued.map(({ tenant_id, ...rest }) => rest);
}

function mapInstallationSnapshot(
    installation: ConnectorInstallationRecord,
    latestDeliveryAttempt: ConnectorDeliveryAttemptRecord | null,
): PassiveConnectorInstallationSnapshot {
    const config = readPassiveConnectorConfig(installation.metadata);
    return {
        ...installation,
        marketplace_template: passiveSignalMarketplace.find((template) => template.id === config.marketplace_id) ?? null,
        sync_mode: config.sync_mode,
        auth_strategy: config.auth_strategy,
        supported_connector_types: config.supported_connector_types,
        webhook_url: config.webhook_url,
        scheduler: config.scheduler,
        latest_delivery_attempt: latestDeliveryAttempt,
    };
}

function requireMarketplaceTemplate(id: string): PassiveSignalMarketplaceDefinition {
    const template = passiveSignalMarketplace.find((candidate) => candidate.id === id) ?? null;
    if (!template) {
        throw new Error('Passive connector marketplace template was not found.');
    }
    return template;
}

function buildPassiveConnectorMetadata(input: {
    template: PassiveSignalMarketplaceDefinition;
    webhookUrl: string | null;
    intervalHours: number | null;
    schedulerEnabled: boolean;
    nextSyncAt: string | null;
}): Record<string, unknown> {
    return {
        webhook_url: input.webhookUrl,
        passive_signal: {
            marketplace_id: input.template.id,
            sync_mode: input.template.sync_mode,
            auth_strategy: input.template.auth_strategy,
            supported_connector_types: input.template.supported_connector_types,
            coverage_notes: input.template.coverage_notes,
            scheduler: {
                enabled: input.schedulerEnabled,
                interval_hours: input.intervalHours,
                next_sync_at: input.nextSyncAt,
                last_sync_requested_at: null,
                last_sync_status: null,
            },
        },
    };
}

function readPassiveConnectorConfig(metadata: Record<string, unknown>) {
    const passiveSignal = asRecord(metadata.passive_signal);
    const scheduler = asRecord(passiveSignal.scheduler);
    const template = passiveSignalMarketplace.find((candidate) => candidate.id === normalizeOptionalText(passiveSignal.marketplace_id)) ?? null;
    const supportedConnectorTypes = asStringArray(passiveSignal.supported_connector_types);

    return {
        marketplace_id: normalizeOptionalText(passiveSignal.marketplace_id),
        sync_mode: normalizeSyncMode(passiveSignal.sync_mode) ?? template?.sync_mode ?? 'manual_file_drop',
        auth_strategy: normalizeOptionalText(passiveSignal.auth_strategy) ?? template?.auth_strategy ?? null,
        supported_connector_types: supportedConnectorTypes.length > 0
            ? supportedConnectorTypes
            : template?.supported_connector_types ?? [],
        webhook_url: normalizeOptionalText(metadata.webhook_url) ?? normalizeOptionalText(passiveSignal.webhook_url),
        scheduler: {
            enabled: readBoolean(scheduler.enabled),
            interval_hours: normalizePositiveInteger(scheduler.interval_hours) ?? template?.default_interval_hours ?? null,
            next_sync_at: normalizeTimestamp(scheduler.next_sync_at),
            last_sync_requested_at: normalizeTimestamp(scheduler.last_sync_requested_at),
            last_sync_status: normalizeOptionalText(scheduler.last_sync_status),
        },
    };
}

async function listConnectorInstallationsAcrossTenants(client: SupabaseClient): Promise<ConnectorInstallationRecord[]> {
    const C = CONNECTOR_INSTALLATIONS.COLUMNS;
    const { data, error } = await client
        .from(CONNECTOR_INSTALLATIONS.TABLE)
        .select('*')
        .order(C.created_at, { ascending: false })
        .limit(300);

    if (error) {
        throw new Error(`Failed to list connector installations across tenants: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        installation_name: String(row.installation_name),
        connector_type: String(row.connector_type),
        vendor_name: normalizeOptionalText(row.vendor_name),
        vendor_account_ref: normalizeOptionalText(row.vendor_account_ref),
        status: row.status === 'paused' || row.status === 'revoked' ? row.status : 'active',
        metadata: asRecord(row.metadata),
        created_by: normalizeOptionalText(row.created_by),
        last_used_at: normalizeOptionalText(row.last_used_at),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
    }));
}

async function requireConnectorInstallation(
    client: SupabaseClient,
    tenantId: string,
    connectorInstallationId: string,
): Promise<ConnectorInstallationRecord> {
    const installation = await getConnectorInstallation(client, tenantId, connectorInstallationId);
    if (!installation) {
        throw new Error('Connector installation was not found.');
    }
    return installation;
}

function requireNativeVendorAdapter(adapterKey: string): NativeVendorAdapterDefinition {
    const adapter = getNativeVendorAdapter(adapterKey);
    if (!adapter) {
        throw new Error('Native vendor adapter was not found.');
    }
    return adapter;
}

async function listNativeVendorConnections(
    client: SupabaseClient,
    tenantId: string,
): Promise<NativeVendorConnectionRecord[]> {
    const C = PASSIVE_NATIVE_VENDOR_CONNECTIONS.COLUMNS;
    const { data, error } = await client
        .from(PASSIVE_NATIVE_VENDOR_CONNECTIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.updated_at, { ascending: false })
        .limit(200);

    if (error) {
        if (isMissingNativeVendorTableError(error.message)) return [];
        throw new Error(`Failed to list native vendor connections: ${error.message}`);
    }

    return (data ?? []).map((row) => mapNativeVendorConnection(asRecord(row)));
}

async function listNativeVendorConnectionsAcrossTenants(client: SupabaseClient): Promise<NativeVendorConnectionRecord[]> {
    const C = PASSIVE_NATIVE_VENDOR_CONNECTIONS.COLUMNS;
    const { data, error } = await client
        .from(PASSIVE_NATIVE_VENDOR_CONNECTIONS.TABLE)
        .select('*')
        .order(C.updated_at, { ascending: false })
        .limit(500);

    if (error) {
        if (isMissingNativeVendorTableError(error.message)) return [];
        throw new Error(`Failed to list native vendor connections across tenants: ${error.message}`);
    }

    return (data ?? []).map((row) => mapNativeVendorConnection(asRecord(row)));
}

async function requireNativeVendorConnection(
    client: SupabaseClient,
    tenantId: string,
    nativeConnectionId: string,
): Promise<NativeVendorConnectionRecord> {
    const C = PASSIVE_NATIVE_VENDOR_CONNECTIONS.COLUMNS;
    const { data, error } = await client
        .from(PASSIVE_NATIVE_VENDOR_CONNECTIONS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .eq(C.id, nativeConnectionId)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to load native vendor connection: ${error.message}`);
    }
    if (!data) {
        throw new Error('Native vendor connection was not found.');
    }

    return mapNativeVendorConnection(asRecord(data));
}

async function listNativeVendorSyncRuns(
    client: SupabaseClient,
    tenantId: string,
): Promise<NativeVendorSyncRunRecord[]> {
    const C = PASSIVE_NATIVE_VENDOR_SYNC_RUNS.COLUMNS;
    const { data, error } = await client
        .from(PASSIVE_NATIVE_VENDOR_SYNC_RUNS.TABLE)
        .select('*')
        .eq(C.tenant_id, tenantId)
        .order(C.requested_at, { ascending: false })
        .limit(80);

    if (error) {
        if (isMissingNativeVendorTableError(error.message)) return [];
        throw new Error(`Failed to list native vendor sync runs: ${error.message}`);
    }

    return (data ?? []).map((row) => mapNativeVendorSyncRun(asRecord(row)));
}

async function insertNativeVendorSyncRun(
    client: SupabaseClient,
    input: {
        tenantId: string;
        connection: NativeVendorConnectionRecord;
        reason: NativeVendorSyncRunReason;
        status: NativeVendorSyncRunStatus;
        metadata?: Record<string, unknown>;
    },
): Promise<NativeVendorSyncRunRecord> {
    const C = PASSIVE_NATIVE_VENDOR_SYNC_RUNS.COLUMNS;
    const { data, error } = await client
        .from(PASSIVE_NATIVE_VENDOR_SYNC_RUNS.TABLE)
        .insert({
            [C.tenant_id]: input.tenantId,
            [C.native_connection_id]: input.connection.id,
            [C.connector_installation_id]: input.connection.connector_installation_id,
            [C.adapter_key]: input.connection.adapter_key,
            [C.run_reason]: input.reason,
            [C.status]: input.status,
            [C.requested_at]: new Date().toISOString(),
            [C.metadata]: input.metadata ?? {},
        })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to create native vendor sync run: ${error?.message ?? 'Unknown error'}`);
    }

    return mapNativeVendorSyncRun(asRecord(data));
}

async function updateNativeVendorSyncRunOutbox(
    client: SupabaseClient,
    run: NativeVendorSyncRunRecord,
    outboxEventId: string,
): Promise<NativeVendorSyncRunRecord> {
    const C = PASSIVE_NATIVE_VENDOR_SYNC_RUNS.COLUMNS;
    const { data, error } = await client
        .from(PASSIVE_NATIVE_VENDOR_SYNC_RUNS.TABLE)
        .update({
            [C.outbox_event_id]: outboxEventId,
            [C.metadata]: {
                ...run.metadata,
                outbox_event_id: outboxEventId,
            },
        })
        .eq(C.id, run.id)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to attach native vendor sync run to outbox: ${error?.message ?? 'Unknown error'}`);
    }

    return mapNativeVendorSyncRun(asRecord(data));
}

async function touchNativeVendorConnectionAfterSyncRequest(
    client: SupabaseClient,
    connection: NativeVendorConnectionRecord,
    run: NativeVendorSyncRunRecord,
): Promise<void> {
    const intervalHours = connection.interval_hours;
    const C = PASSIVE_NATIVE_VENDOR_CONNECTIONS.COLUMNS;
    const nextSyncAt = connection.sync_mode === 'scheduled_pull' && intervalHours != null
        ? new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString()
        : connection.next_sync_at;
    const { error } = await client
        .from(PASSIVE_NATIVE_VENDOR_CONNECTIONS.TABLE)
        .update({
            [C.last_sync_status]: run.outbox_event_id ? 'queued_outbox' : 'queued_waiting_for_adapter_runtime',
            [C.next_sync_at]: nextSyncAt,
            [C.metadata]: {
                ...connection.metadata,
                last_sync_run_id: run.id,
                last_sync_requested_at: run.requested_at,
            },
        })
        .eq(C.id, connection.id);

    if (error) {
        throw new Error(`Failed to update native vendor connection scheduler: ${error.message}`);
    }
}

function isMissingNativeVendorTableError(message: string): boolean {
    return message.includes('passive_native_vendor_')
        || message.includes('Could not find the table')
        || message.includes('schema cache');
}

type SignalSourceRecord = {
    id: string;
    source_type: string;
    status: string;
    last_synced_at: string | null;
    updated_at: string | null;
};

type PassiveSignalEventRecord = {
    id: string;
    signal_type: string;
    observed_at: string;
    ingestion_status: string;
    source_id: string | null;
};

async function listSignalSources(client: SupabaseClient, tenantId: string): Promise<SignalSourceRecord[]> {
    const C = SIGNAL_SOURCES.COLUMNS;
    const { data, error } = await client
        .from(SIGNAL_SOURCES.TABLE)
        .select(`${C.id},${C.source_type},${C.status},${C.last_synced_at},${C.updated_at}`)
        .eq(C.tenant_id, tenantId)
        .order(C.updated_at, { ascending: false })
        .limit(300);

    if (error) {
        throw new Error(`Failed to list passive signal sources: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
        id: String(row.id),
        source_type: String(row.source_type),
        status: String(row.status),
        last_synced_at: normalizeTimestamp(row.last_synced_at),
        updated_at: normalizeTimestamp(row.updated_at),
    }));
}

async function listRecentPassiveSignals(client: SupabaseClient, tenantId: string): Promise<PassiveSignalEventRecord[]> {
    const C = PASSIVE_SIGNAL_EVENTS.COLUMNS;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await client
        .from(PASSIVE_SIGNAL_EVENTS.TABLE)
        .select(`${C.id},${C.signal_type},${C.observed_at},${C.ingestion_status},${C.source_id}`)
        .eq(C.tenant_id, tenantId)
        .gte(C.observed_at, sevenDaysAgo)
        .order(C.observed_at, { ascending: false })
        .limit(500);

    if (error) {
        throw new Error(`Failed to list recent passive signal events: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
        id: String(row.id),
        signal_type: String(row.signal_type),
        observed_at: normalizeTimestamp(row.observed_at) ?? new Date(0).toISOString(),
        ingestion_status: String(row.ingestion_status),
        source_id: normalizeOptionalText(row.source_id),
    }));
}

function buildPassiveSignalReadiness(input: {
    installations: PassiveConnectorInstallationSnapshot[];
    signalSources: SignalSourceRecord[];
    recentSignals: PassiveSignalEventRecord[];
}): PassiveSignalReadinessSnapshot {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const staleThreshold = now - 72 * 60 * 60 * 1000;
    const requiredConnectors = passiveSignalConnectors.filter((connector) => connector.readiness !== 'planned');
    const staleSignalSources = input.signalSources.filter((source) => {
        if (source.status !== 'active') return false;
        if (!source.last_synced_at) return true;
        return new Date(source.last_synced_at).getTime() < staleThreshold;
    }).length;

    const coverage = requiredConnectors.map((connector): PassiveSignalCoverageRow => {
        const installations = input.installations.filter((installation) =>
            installation.status === 'active'
            && (installation.supported_connector_types.includes(connector.sourceType)
                || installation.connector_type === connector.sourceType),
        );
        const sources = input.signalSources.filter((source) =>
            source.source_type === connector.sourceType
            && source.status === 'active',
        );
        const signals = input.recentSignals.filter((signal) => signal.signal_type === connector.sourceType);
        const recentEvents24h = signals.filter((signal) => new Date(signal.observed_at).getTime() >= twentyFourHoursAgo).length;
        const lastObservedAt = newestTimestamp(signals.map((signal) => signal.observed_at));
        const lastSyncedAt = newestTimestamp(sources.map((source) => source.last_synced_at).filter(Boolean));
        const hasStaleSource = sources.some((source) => {
            if (!source.last_synced_at) return true;
            return new Date(source.last_synced_at).getTime() < staleThreshold;
        });
        const status = resolveCoverageStatus({
            installedConnectors: installations.length,
            activeSources: sources.length,
            recentEvents7d: signals.length,
            hasStaleSource,
        });

        return {
            connector_type: connector.sourceType,
            label: connector.label,
            catalog_readiness: connector.readiness,
            installed_connectors: installations.length,
            active_sources: sources.length,
            recent_events_24h: recentEvents24h,
            recent_events_7d: signals.length,
            last_observed_at: lastObservedAt,
            last_synced_at: lastSyncedAt,
            status,
            operator_note: coverageOperatorNote(status),
        };
    });

    return {
        required_connector_types: coverage.length,
        ready_connector_types: coverage.filter((row) => row.status === 'ready').length,
        quiet_connector_types: coverage.filter((row) => row.status === 'quiet').length,
        stale_connector_types: coverage.filter((row) => row.status === 'stale').length,
        missing_connector_types: coverage.filter((row) => row.status === 'missing').length,
        recent_signals_24h: input.recentSignals.filter((signal) => new Date(signal.observed_at).getTime() >= twentyFourHoursAgo).length,
        recent_signals_7d: input.recentSignals.length,
        stale_signal_sources: staleSignalSources,
        coverage,
        privacy_contract: [
            'Accept only installation-scoped connector credentials or approved service actors.',
            'For native vendor adapters, store OAuth/API credential hashes only; never persist raw tokens or authorization codes.',
            'Normalize vendor payloads before episode reconciliation.',
            'Keep raw vendor payloads in passive signal events; surface only normalized facts to clinical workflows.',
            'Do not require owner contact data, patient names, or microchip IDs for connector readiness.',
        ],
    };
}

function resolveCoverageStatus(input: {
    installedConnectors: number;
    activeSources: number;
    recentEvents7d: number;
    hasStaleSource: boolean;
}): PassiveSignalCoverageStatus {
    if (input.installedConnectors === 0 && input.activeSources === 0) return 'missing';
    if (input.hasStaleSource) return 'stale';
    if (input.recentEvents7d > 0) return 'ready';
    return 'quiet';
}

function coverageOperatorNote(status: PassiveSignalCoverageStatus): string {
    if (status === 'ready') return 'Signals are flowing into the outcome network.';
    if (status === 'stale') return 'Connector exists but one or more sources have not synced recently.';
    if (status === 'quiet') return 'Connector is installed but no signal arrived in the last seven days.';
    return 'Install a marketplace connector or create a signal source before expecting passive learning.';
}

function newestTimestamp(values: Array<string | null | undefined>): string | null {
    let newest: string | null = null;
    let newestTime = Number.NEGATIVE_INFINITY;
    for (const value of values) {
        const normalized = normalizeTimestamp(value);
        if (!normalized) continue;
        const time = new Date(normalized).getTime();
        if (time > newestTime) {
            newest = normalized;
            newestTime = time;
        }
    }
    return newest;
}

function normalizeSyncMode(value: unknown): PassiveConnectorSyncMode | null {
    return value === 'webhook_push' || value === 'scheduled_pull' || value === 'manual_file_drop'
        ? value
        : null;
}

function normalizePositiveInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed);
        }
    }
    return null;
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeTimestamp(value: unknown): string | null {
    const text = normalizeOptionalText(value);
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
}

function readBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true';
    return false;
}

function mapNativeVendorConnection(row: Record<string, unknown>): NativeVendorConnectionRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        adapter_key: String(row.adapter_key),
        connector_installation_id: normalizeOptionalText(row.connector_installation_id),
        vendor_name: normalizeOptionalText(row.vendor_name) ?? 'Unknown vendor',
        vendor_account_ref: normalizeOptionalText(row.vendor_account_ref),
        auth_protocol: normalizeNativeAuthProtocol(row.auth_protocol),
        status: normalizeNativeConnectionStatus(row.status),
        authorization_state_hash: normalizeOptionalText(row.authorization_state_hash),
        credential_ref_hash: normalizeOptionalText(row.credential_ref_hash),
        requested_scopes: asStringArray(row.requested_scopes),
        adapter_runtime_url: normalizeOptionalText(row.adapter_runtime_url),
        supported_connector_types: asStringArray(row.supported_connector_types),
        sync_mode: normalizeSyncMode(row.sync_mode) ?? 'scheduled_pull',
        interval_hours: normalizePositiveInteger(row.interval_hours),
        next_sync_at: normalizeTimestamp(row.next_sync_at),
        last_authorized_at: normalizeTimestamp(row.last_authorized_at),
        last_sync_at: normalizeTimestamp(row.last_sync_at),
        last_sync_status: normalizeOptionalText(row.last_sync_status),
        metadata: asRecord(row.metadata),
        created_by: normalizeOptionalText(row.created_by),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at ?? row.created_at),
    };
}

function mapNativeVendorSyncRun(row: Record<string, unknown>): NativeVendorSyncRunRecord {
    return {
        id: String(row.id),
        tenant_id: String(row.tenant_id),
        native_connection_id: String(row.native_connection_id),
        connector_installation_id: normalizeOptionalText(row.connector_installation_id),
        adapter_key: String(row.adapter_key),
        run_reason: normalizeNativeSyncReason(row.run_reason),
        status: normalizeNativeSyncStatus(row.status),
        requested_at: String(row.requested_at ?? row.created_at),
        started_at: normalizeTimestamp(row.started_at),
        finished_at: normalizeTimestamp(row.finished_at),
        events_ingested: normalizePositiveInteger(row.events_ingested) ?? 0,
        outbox_event_id: normalizeOptionalText(row.outbox_event_id),
        error_message: normalizeOptionalText(row.error_message),
        metadata: asRecord(row.metadata),
        created_at: String(row.created_at),
    };
}

function normalizeNativeAuthProtocol(value: unknown): NativeVendorAuthProtocol {
    return value === 'oauth2_pkce' || value === 'oauth2_client_credentials' || value === 'api_key' || value === 'sftp_drop'
        ? value
        : 'api_key';
}

function normalizeNativeConnectionStatus(value: unknown): NativeVendorConnectionStatus {
    return value === 'active' || value === 'paused' || value === 'revoked' || value === 'error' || value === 'authorization_required'
        ? value
        : 'authorization_required';
}

function normalizeNativeSyncReason(value: unknown): NativeVendorSyncRunReason {
    return value === 'manual' || value === 'scheduled' || value === 'authorization_callback' || value === 'backfill'
        ? value
        : 'manual';
}

function normalizeNativeSyncStatus(value: unknown): NativeVendorSyncRunStatus {
    return value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'skipped'
        ? value
        : 'queued';
}

function normalizeScopes(scopes: string[] | undefined, adapter: NativeVendorAdapterDefinition): string[] {
    const supplied = Array.isArray(scopes)
        ? scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0)
        : [];
    if (supplied.length > 0) return Array.from(new Set(supplied));
    return adapter.supported_connector_types.map((type) => `signals:${type}`);
}

function createNativeAuthorizationState(): string {
    return randomBytes(32).toString('base64url');
}

function hashSecret(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function buildNativeAuthorizationUrl(
    adapter: NativeVendorAdapterDefinition,
    input: {
        state: string;
        redirectUri: string | null;
        scopes: string[];
    },
): string | null {
    if (adapter.auth_protocol !== 'oauth2_pkce') return null;
    const baseUrl = process.env.VETIOS_NATIVE_VENDOR_AUTH_BASE_URL?.trim();
    if (!baseUrl) return null;
    const url = new URL(baseUrl);
    url.searchParams.set('adapter_key', adapter.adapter_key);
    url.searchParams.set('vendor', adapter.vendor_name);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', input.state);
    url.searchParams.set('scope', input.scopes.join(' '));
    if (input.redirectUri) {
        url.searchParams.set('redirect_uri', input.redirectUri);
    }
    return url.toString();
}
