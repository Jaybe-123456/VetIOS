import type { SupabaseClient } from '@supabase/supabase-js';
import {
    createConnectorInstallationWithCredential,
    getConnectorInstallation,
    listConnectorInstallations,
    updateConnectorInstallation,
    type ConnectorInstallationRecord,
} from '@/lib/auth/machineAuth';
import { CONNECTOR_INSTALLATIONS, PASSIVE_SIGNAL_EVENTS, SIGNAL_SOURCES } from '@/lib/db/schemaContracts';
import { dispatchOutboxBatch, enqueueOutboxEvent, getOutboxQueueSnapshot, type ConnectorDeliveryAttemptRecord } from '@/lib/eventPlane/outbox';
import { passiveSignalConnectors } from '@/lib/platform/passiveSignalCatalog';
import {
    passiveSignalMarketplace,
    type PassiveConnectorSyncMode,
    type PassiveSignalMarketplaceDefinition,
} from '@/lib/platform/passiveSignalMarketplace';

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
    installations: PassiveConnectorInstallationSnapshot[];
    readiness: PassiveSignalReadinessSnapshot;
    recent_delivery_attempts: ConnectorDeliveryAttemptRecord[];
    summary: {
        marketplace_templates: number;
        live_templates: number;
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
    const [installations, outboxSnapshot, signalSources, recentSignals] = await Promise.all([
        listConnectorInstallations(client, tenantId),
        getOutboxQueueSnapshot(client, tenantId, {
            limit: 20,
            handlerKey: 'connector_webhook',
        }),
        listSignalSources(client, tenantId),
        listRecentPassiveSignals(client, tenantId),
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
        installations: installationSnapshots,
        readiness,
        recent_delivery_attempts: outboxSnapshot.recent_attempts,
        summary: {
            marketplace_templates: passiveSignalMarketplace.length,
            live_templates: passiveSignalMarketplace.filter((template) => template.readiness === 'live').length,
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
