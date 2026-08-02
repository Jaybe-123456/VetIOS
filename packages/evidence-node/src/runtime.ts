import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
    normalizeEvidenceNodeSource,
    EVIDENCE_NODE_AST_SCHEMA,
    hashEvidenceNodeMapping,
    validateEvidenceNodeMapping,
    type EvidenceNodeMapping,
    type EvidenceNodeSourceFormat,
} from './index.js';
import { VetiosEvidenceNodeClient, EvidenceNodeRemoteError } from './client.js';
import { decodeSpoolKey, EvidenceNodeSpool } from './spool.js';

export interface EvidenceNodeRuntimeConfig {
    schema: 'vetios.evidence-node.config.v1';
    node_id: string;
    connector_version: string;
    mapping_path: string;
    spool_directory: string;
    spool_key_file?: string;
    spool_key_env?: string;
    reference_key_id: string;
    reference_key_file?: string;
    reference_key_env?: string;
    poll_interval_ms?: number;
    max_delivery_attempts?: number;
    vetios: {
        base_url: string;
        client_id: string;
        client_secret_env: string;
        token_path?: string;
        operations_path?: string;
        scopes?: string[];
        timeout_ms?: number;
        tls: {
            pfx_path?: string;
            pfx_passphrase_env?: string;
            cert_path?: string;
            key_path?: string;
            key_passphrase_env?: string;
            ca_path?: string;
            servername?: string;
        };
    };
    sources: EvidenceNodeSourceConfig[];
}

export type EvidenceNodeSourceConfig =
    | EvidenceNodeFileDropSourceConfig
    | EvidenceNodeWebhookSourceConfig
    | EvidenceNodeApiPollSourceConfig
    | EvidenceNodeSftpSourceConfig;

interface EvidenceNodeBaseSourceConfig {
    key: string;
    enabled?: boolean;
    format: EvidenceNodeSourceFormat;
}

export interface EvidenceNodeFileDropSourceConfig extends EvidenceNodeBaseSourceConfig {
    transport: 'file_drop';
    inbox_path: string;
    archive_path: string;
    filename_pattern?: string;
}

export interface EvidenceNodeWebhookSourceConfig extends EvidenceNodeBaseSourceConfig {
    transport: 'webhook';
    listen_host?: string;
    listen_port: number;
    path?: string;
    hmac_secret_env: string;
    signature_header?: string;
    timestamp_header?: string;
    maximum_clock_skew_seconds?: number;
}

export interface EvidenceNodeApiPollSourceConfig extends EvidenceNodeBaseSourceConfig {
    transport: 'api_poll';
    url: string;
    bearer_token_env?: string;
    api_key_env?: string;
    api_key_header?: string;
    timeout_ms?: number;
}

export interface EvidenceNodeSftpSourceConfig extends EvidenceNodeBaseSourceConfig {
    transport: 'sftp';
    host: string;
    port?: number;
    username: string;
    private_key_path: string;
    known_hosts_path: string;
    remote_inbox: string;
    remote_archive: string;
    filename_pattern?: string;
    sftp_binary?: string;
}

export interface EvidenceNodeCycleReport {
    started_at: string;
    completed_at: string;
    collected: number;
    duplicates: number;
    delivered: number;
    retried: number;
    dead_lettered: number;
    blocked: number;
    records_rejected: number;
    connector_probe_event_id: string | null;
    heartbeat_status: 'passed' | 'failed';
    source_errors: Array<{ source_key: string; error: string }>;
    spool: Awaited<ReturnType<EvidenceNodeSpool['snapshot']>>;
}

export interface EvidenceNodeDoctorReport {
    ready: boolean;
    checked_at: string;
    node_id: string;
    mapping_hash_ready: boolean;
    mapping_hash: string;
    enabled_sources: number;
    checks: Array<{ key: string; status: 'pass' | 'fail'; detail: string }>;
}

export class EvidenceNodeRuntime {
    readonly config: EvidenceNodeRuntimeConfig;
    readonly mapping: EvidenceNodeMapping;
    readonly spool: EvidenceNodeSpool;
    readonly client: VetiosEvidenceNodeClient;
    private readonly referenceKey: Buffer;
    private activeConnectorProbeEventId: string;
    private readonly webhookServers: Server[] = [];
    private stopRequested = false;

    private dedupeNamespace(sourceKey: string): string {
        return `${sourceKey}:${this.mapping.adapter_key}:${this.mapping.mapping_version}:${hashEvidenceNodeMapping(this.mapping)}`;
    }

    private constructor(input: {
        config: EvidenceNodeRuntimeConfig;
        mapping: EvidenceNodeMapping;
        spool: EvidenceNodeSpool;
        client: VetiosEvidenceNodeClient;
        referenceKey: Buffer;
    }) {
        this.config = input.config;
        this.mapping = input.mapping;
        this.spool = input.spool;
        this.client = input.client;
        this.referenceKey = input.referenceKey;
        this.activeConnectorProbeEventId = '';
    }

    static async load(configPath: string): Promise<EvidenceNodeRuntime> {
        const absoluteConfigPath = resolve(configPath);
        const configDirectory = dirname(absoluteConfigPath);
        const config = resolveConfigPaths(parseConfig(await readJson(absoluteConfigPath)), configDirectory);
        const resolveFromConfig = (path: string) => resolve(configDirectory, path);
        const mapping = await readJson(resolveFromConfig(config.mapping_path)) as EvidenceNodeMapping;
        const mappingBlockers = validateEvidenceNodeMapping(mapping);
        if (mappingBlockers.length > 0) {
            throw new Error(`Evidence Node mapping is blocked: ${mappingBlockers.join(', ')}`);
        }
        const spoolKey = await loadSpoolKey(config, resolveFromConfig);
        const referenceKey = await loadReferenceKey(config, resolveFromConfig);
        const tls = config.vetios.tls;
        const pfx = tls.pfx_path ? await readFile(resolveFromConfig(tls.pfx_path)) : undefined;
        const cert = tls.cert_path ? await readFile(resolveFromConfig(tls.cert_path)) : undefined;
        const key = tls.key_path ? await readFile(resolveFromConfig(tls.key_path)) : undefined;
        const ca = tls.ca_path ? await readFile(resolveFromConfig(tls.ca_path)) : undefined;
        const clientSecret = requiredEnvironment(config.vetios.client_secret_env);
        const spool = new EvidenceNodeSpool({
            root: resolveFromConfig(config.spool_directory),
            encryptionKey: spoolKey,
        });
        await spool.initialize();
        return new EvidenceNodeRuntime({
            config,
            mapping,
            spool,
            referenceKey,
            client: new VetiosEvidenceNodeClient({
                baseUrl: config.vetios.base_url,
                clientId: config.vetios.client_id,
                clientSecret,
                scopes: config.vetios.scopes,
                tokenPath: config.vetios.token_path,
                operationsPath: config.vetios.operations_path,
                timeoutMs: config.vetios.timeout_ms,
                tls: {
                    pfx,
                    cert,
                    key,
                    ca,
                    passphrase: tls.pfx_passphrase_env
                        ? requiredEnvironment(tls.pfx_passphrase_env)
                        : tls.key_passphrase_env
                            ? requiredEnvironment(tls.key_passphrase_env)
                            : undefined,
                    servername: tls.servername,
                },
            }),
        });
    }

    async doctor(options: { probeRemote?: boolean } = {}): Promise<EvidenceNodeDoctorReport> {
        const checks: EvidenceNodeDoctorReport['checks'] = [];
        const add = (key: string, status: 'pass' | 'fail', detail: string) => checks.push({ key, status, detail });
        add('mapping', 'pass', `${this.mapping.adapter_key}@${this.mapping.mapping_version}`);
        const snapshot = await this.spool.snapshot();
        add('encrypted_spool', 'pass', `${snapshot.pending} pending, ${snapshot.dead_letter} dead-letter`);
        for (const source of enabledSources(this.config)) {
            try {
                await validateSourcePrerequisites(source);
                add(`source:${source.key}`, 'pass', source.transport);
            } catch (error) {
                add(`source:${source.key}`, 'fail', sanitizeError(error));
            }
        }
        if (options.probeRemote) {
            try {
                const response = await this.client.operationsSnapshot();
                add('vetios_control_plane', 'pass', `HTTP ${response.status}`);
            } catch (error) {
                add('vetios_control_plane', 'fail', sanitizeError(error));
            }
        }
        return {
            ready: checks.every((check) => check.status === 'pass'),
            checked_at: new Date().toISOString(),
            node_id: this.config.node_id,
            mapping_hash_ready: true,
            mapping_hash: hashEvidenceNodeMapping(this.mapping),
            enabled_sources: enabledSources(this.config).length,
            checks,
        };
    }

    async runCycle(): Promise<EvidenceNodeCycleReport> {
        const startedAt = new Date().toISOString();
        const counters = {
            collected: 0,
            duplicates: 0,
            delivered: 0,
            retried: 0,
            dead_lettered: 0,
            blocked: 0,
            records_rejected: 0,
        };
        const sourceErrors: EvidenceNodeCycleReport['source_errors'] = [];
        await this.spool.releaseStaleProcessing();
        for (const source of enabledSources(this.config).filter((item) => item.transport !== 'webhook')) {
            try {
                const result = await this.collectSource(source);
                counters.collected += result.created;
                counters.duplicates += result.duplicates;
            } catch (error) {
                sourceErrors.push({ source_key: source.key, error: sanitizeError(error) });
            }
        }
        let connectorProbeEventId: string;
        try {
            connectorProbeEventId = await this.refreshConnectorHeartbeat({
                startedAt,
                observedRecordCount: counters.collected + counters.duplicates,
                sourceErrors,
            });
        } catch (error) {
            sourceErrors.push({ source_key: 'vetios_control_plane_heartbeat', error: sanitizeError(error) });
            return {
                started_at: startedAt,
                completed_at: new Date().toISOString(),
                ...counters,
                connector_probe_event_id: null,
                heartbeat_status: 'failed',
                source_errors: sourceErrors,
                spool: await this.spool.snapshot(),
            };
        }
        const delivery = await this.processSpool();
        counters.delivered += delivery.delivered;
        counters.retried += delivery.retried;
        counters.dead_lettered += delivery.deadLettered;
        counters.blocked += delivery.blocked;
        counters.records_rejected += delivery.recordsRejected;
        return {
            started_at: startedAt,
            completed_at: new Date().toISOString(),
            ...counters,
            connector_probe_event_id: connectorProbeEventId,
            heartbeat_status: 'passed',
            source_errors: sourceErrors,
            spool: await this.spool.snapshot(),
        };
    }

    async startService(onCycle?: (report: EvidenceNodeCycleReport) => void): Promise<void> {
        this.stopRequested = false;
        for (const source of enabledSources(this.config).filter(isWebhookSource)) {
            this.webhookServers.push(await this.startWebhook(source));
        }
        const interval = Math.max(5_000, this.config.poll_interval_ms ?? 30_000);
        while (!this.stopRequested) {
            const report = await this.runCycle();
            onCycle?.(report);
            if (this.stopRequested) break;
            await sleep(interval);
        }
    }

    async stop(): Promise<void> {
        this.stopRequested = true;
        await Promise.all(this.webhookServers.splice(0).map((server) => new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
        })));
    }

    private async collectSource(source: Exclude<EvidenceNodeSourceConfig, EvidenceNodeWebhookSourceConfig>) {
        if (source.transport === 'file_drop') return this.collectFileDrop(source);
        if (source.transport === 'api_poll') return this.collectApi(source);
        return this.collectSftp(source);
    }

    private async collectFileDrop(source: EvidenceNodeFileDropSourceConfig) {
        const inbox = resolve(source.inbox_path);
        const archive = resolve(source.archive_path);
        await Promise.all([mkdir(inbox, { recursive: true }), mkdir(archive, { recursive: true })]);
        const names = (await readdir(inbox)).filter((name) => matchesFilename(name, source.filename_pattern));
        let created = 0;
        let duplicates = 0;
        for (const name of names.sort()) {
            const inputPath = join(inbox, name);
            if (!(await stat(inputPath)).isFile()) continue;
            const content = await readFile(inputPath, 'utf8');
            const result = await this.spool.enqueue(source.key, {
                format: source.format,
                transport: source.transport,
                source_ref: `file-drop:${name}`,
                content,
                received_at: new Date().toISOString(),
            }, this.dedupeNamespace(source.key));
            result.created ? created += 1 : duplicates += 1;
            await moveWithoutOverwrite(inputPath, join(archive, name));
        }
        return { created, duplicates };
    }

    private async collectApi(source: EvidenceNodeApiPollSourceConfig) {
        const url = new URL(source.url);
        if (url.protocol !== 'https:') throw new Error('API poll source must use HTTPS.');
        const headers: Record<string, string> = { accept: source.format === 'rfc4180_csv' ? 'text/csv' : 'application/json' };
        if (source.bearer_token_env) headers.authorization = `Bearer ${requiredEnvironment(source.bearer_token_env)}`;
        if (source.api_key_env) headers[source.api_key_header ?? 'x-api-key'] = requiredEnvironment(source.api_key_env);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), source.timeout_ms ?? 30_000);
        try {
            const response = await fetch(url, { headers, signal: controller.signal, redirect: 'error' });
            if (!response.ok) throw new Error(`API poll returned HTTP ${response.status}.`);
            const content = await readResponseWithLimit(response, 10 * 1024 * 1024);
            const sourceRef = `api:${url.origin}${url.pathname}:${response.headers.get('etag') ?? response.headers.get('last-modified') ?? 'unversioned'}`;
            const result = await this.spool.enqueue(source.key, {
                format: source.format,
                transport: source.transport,
                source_ref: sourceRef,
                content,
                received_at: new Date().toISOString(),
            }, this.dedupeNamespace(source.key));
            return { created: result.created ? 1 : 0, duplicates: result.created ? 0 : 1 };
        } finally {
            clearTimeout(timeout);
        }
    }

    private async collectSftp(source: EvidenceNodeSftpSourceConfig) {
        validateSftpPath(source.remote_inbox);
        validateSftpPath(source.remote_archive);
        const listing = await runSftp(source, [`ls -1 ${source.remote_inbox}`]);
        const names = listing.stdout.split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => isSafeRemoteFilename(line) && matchesFilename(line, source.filename_pattern));
        const scratch = resolve(this.config.spool_directory, 'sftp-staging', source.key);
        await mkdir(scratch, { recursive: true });
        let created = 0;
        let duplicates = 0;
        for (const name of names.sort()) {
            const localPath = join(scratch, name);
            await runSftp(source, [`get ${source.remote_inbox}/${name} ${localPath}`]);
            const content = await readFile(localPath, 'utf8');
            const result = await this.spool.enqueue(source.key, {
                format: source.format,
                transport: source.transport,
                source_ref: `sftp:${source.host}:${source.remote_inbox}/${name}`,
                content,
                received_at: new Date().toISOString(),
            }, this.dedupeNamespace(source.key));
            result.created ? created += 1 : duplicates += 1;
            await runSftp(source, [`rename ${source.remote_inbox}/${name} ${source.remote_archive}/${name}`]);
            await rm(localPath, { force: true });
        }
        return { created, duplicates };
    }

    private async processSpool() {
        const leased = await this.spool.lease(25);
        let delivered = 0;
        let retried = 0;
        let deadLettered = 0;
        let blocked = 0;
        let recordsRejected = 0;
        for (const job of leased) {
            const normalized = normalizeEvidenceNodeSource({
                mapping: this.mapping,
                source: job.source,
                referenceKey: this.referenceKey,
                referenceKeyId: this.config.reference_key_id,
                connectorProbeEventId: this.activeConnectorProbeEventId,
            });
            recordsRejected += normalized.rejected_records.length;
            if (!normalized.accepted) {
                const recordBlockers = normalized.rejected_records.flatMap((record) => (
                    record.blockers.map((blocker) => `record_${record.record_index}:${blocker}`)
                ));
                await this.spool.deadLetter(
                    job,
                    `normalization_blocked:${[...normalized.blockers, ...recordBlockers].join(',')}`,
                );
                deadLettered += 1;
                blocked += 1;
                continue;
            }
            try {
                const receipts: Array<Record<string, unknown>> = [];
                if (normalized.rejected_records.length > 0) {
                    receipts.push({
                        receipt_type: 'local_normalization_rejections',
                        rejected_record_count: normalized.rejected_records.length,
                        rejected_records: normalized.rejected_records,
                        raw_values_included: false,
                    });
                }
                for (const submission of normalized.submissions) {
                    const response = await this.client.ingest({
                        ...submission,
                        packet: {
                            ...submission.packet,
                            connector_probe_event_id: this.activeConnectorProbeEventId,
                        },
                    });
                    receipts.push(sanitizeEvidenceNodeRemoteReceipt(response));
                }
                await this.spool.complete(job, receipts);
                delivered += 1;
            } catch (error) {
                if (error instanceof EvidenceNodeRemoteError && !error.retryable) {
                    await this.spool.deadLetter(job, `remote_rejected:${error.status}:${error.message}`);
                    deadLettered += 1;
                } else {
                    const result = await this.spool.retry(job, error, {
                        maxAttempts: this.config.max_delivery_attempts ?? 6,
                    });
                    result === 'dead_letter' ? deadLettered += 1 : retried += 1;
                }
            }
        }
        return { delivered, retried, deadLettered, blocked, recordsRejected };
    }

    private async refreshConnectorHeartbeat(input: {
        startedAt: string;
        observedRecordCount: number;
        sourceErrors: EvidenceNodeCycleReport['source_errors'];
    }): Promise<string> {
        const observedRecordCount = Math.min(10_000_000, Math.max(0, input.observedRecordCount));
        const completedAt = new Date().toISOString();
        const spool = await this.spool.snapshot();
        const requestFacts = {
            node_id: this.config.node_id,
            adapter_key: this.mapping.adapter_key,
            mapping_hash: hashEvidenceNodeMapping(this.mapping),
            source_system: this.mapping.source_system,
            connector_version: this.config.connector_version,
        };
        const responseFacts = {
            observed_record_count: observedRecordCount,
            source_error_count: input.sourceErrors.length,
            spool,
        };
        const response = await this.client.recordProbe({
            action: 'record_connector_probe',
            request_id: randomUUID(),
            site_id: this.mapping.defaults.lab_site_id,
            probe_type: 'heartbeat',
            source_system: this.mapping.source_system,
            connector_version: this.config.connector_version,
            schema_version: EVIDENCE_NODE_AST_SCHEMA,
            observed_record_count: observedRecordCount,
            request_digest: localSha256(JSON.stringify(requestFacts)),
            response_digest: localSha256(JSON.stringify(responseFacts)),
            evidence: {
                schema: 'vetios.evidence-node.heartbeat.v1',
                ...requestFacts,
                source_error_count: input.sourceErrors.length,
                connector_cycle_started_at: input.startedAt,
                connector_cycle_completed_at: completedAt,
                source_record_timestamp_claimed: false,
                raw_payload_included: false,
                spool,
            },
        });
        const probeEventId = textValue(response.body.connector_probe_event_id);
        if (
            !probeEventId
            || response.body.probe_status !== 'passed'
            || response.body.production_verified !== true
        ) {
            throw new Error('Evidence Node heartbeat did not return verified connector proof.');
        }
        this.activeConnectorProbeEventId = probeEventId;
        return probeEventId;
    }

    private async startWebhook(source: EvidenceNodeWebhookSourceConfig): Promise<Server> {
        const secret = requiredEnvironment(source.hmac_secret_env);
        const expectedPath = source.path ?? `/evidence/${source.key}`;
        const server = createServer(async (request, response) => {
            try {
                if (request.method !== 'POST' || request.url?.split('?')[0] !== expectedPath) {
                    respondJson(response, 404, { error: 'not_found' });
                    return;
                }
                const body = await readIncomingBody(request, 10 * 1024 * 1024);
                verifyWebhookSignature(request, body, secret, source);
                const receivedAt = new Date().toISOString();
                const deliveryId = request.headers['x-delivery-id'] ?? request.headers['x-request-id'] ?? receivedAt;
                const result = await this.spool.enqueue(source.key, {
                    format: source.format,
                    transport: source.transport,
                    source_ref: `webhook:${source.key}:${String(deliveryId)}`,
                    content: body.toString('utf8'),
                    received_at: receivedAt,
                }, this.dedupeNamespace(source.key));
                respondJson(response, result.created ? 202 : 200, {
                    accepted: true,
                    duplicate: !result.created,
                    job_id: result.job.id,
                });
            } catch (error) {
                respondJson(response, 400, { error: sanitizeError(error) });
            }
        });
        await new Promise<void>((resolveListen, reject) => {
            server.once('error', reject);
            server.listen(source.listen_port, source.listen_host ?? '127.0.0.1', () => resolveListen());
        });
        return server;
    }
}

function parseConfig(value: unknown): EvidenceNodeRuntimeConfig {
    if (!isRecord(value) || value.schema !== 'vetios.evidence-node.config.v1') {
        throw new Error('Evidence Node config schema must be vetios.evidence-node.config.v1.');
    }
    const config = value as unknown as EvidenceNodeRuntimeConfig;
    if (!config.node_id?.trim()) throw new Error('Evidence Node config node_id is required.');
    if (!config.connector_version?.trim()) throw new Error('Evidence Node config connector_version is required.');
    if (!config.mapping_path?.trim()) throw new Error('Evidence Node config mapping_path is required.');
    if (!config.spool_directory?.trim()) throw new Error('Evidence Node config spool_directory is required.');
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(config.reference_key_id ?? '')) {
        throw new Error('Evidence Node config reference_key_id is required and must be a stable non-secret identifier.');
    }
    if (!isRecord(config.vetios)) throw new Error('Evidence Node config vetios section is required.');
    if (!Array.isArray(config.sources) || config.sources.length === 0) {
        throw new Error('Evidence Node config requires at least one source.');
    }
    const keys = new Set<string>();
    for (const source of config.sources) {
        if (!source.key?.trim() || keys.has(source.key)) throw new Error('Evidence Node source keys must be unique and non-empty.');
        keys.add(source.key);
        if (!['file_drop', 'webhook', 'api_poll', 'sftp'].includes(source.transport)) {
            throw new Error(`Unsupported Evidence Node transport: ${String(source.transport)}`);
        }
    }
    return config;
}

function resolveConfigPaths(config: EvidenceNodeRuntimeConfig, base: string): EvidenceNodeRuntimeConfig {
    const absolute = (path: string | undefined) => path ? resolve(base, path) : undefined;
    return {
        ...config,
        mapping_path: absolute(config.mapping_path)!,
        spool_directory: absolute(config.spool_directory)!,
        spool_key_file: absolute(config.spool_key_file),
        reference_key_file: absolute(config.reference_key_file),
        vetios: {
            ...config.vetios,
            tls: {
                ...config.vetios.tls,
                pfx_path: absolute(config.vetios.tls.pfx_path),
                cert_path: absolute(config.vetios.tls.cert_path),
                key_path: absolute(config.vetios.tls.key_path),
                ca_path: absolute(config.vetios.tls.ca_path),
            },
        },
        sources: config.sources.map((source) => {
            if (source.transport === 'file_drop') {
                return {
                    ...source,
                    inbox_path: absolute(source.inbox_path)!,
                    archive_path: absolute(source.archive_path)!,
                };
            }
            if (source.transport === 'sftp') {
                return {
                    ...source,
                    private_key_path: absolute(source.private_key_path)!,
                    known_hosts_path: absolute(source.known_hosts_path)!,
                };
            }
            return source;
        }),
    };
}

async function loadSpoolKey(
    config: EvidenceNodeRuntimeConfig,
    resolveFromConfig: (path: string) => string,
) {
    if (config.spool_key_env) return decodeSpoolKey(requiredEnvironment(config.spool_key_env));
    if (config.spool_key_file) return decodeSpoolKey(await readFile(resolveFromConfig(config.spool_key_file), 'utf8'));
    throw new Error('Evidence Node config requires spool_key_env or spool_key_file.');
}

async function loadReferenceKey(
    config: EvidenceNodeRuntimeConfig,
    resolveFromConfig: (path: string) => string,
) {
    if (config.reference_key_env) return decodeSpoolKey(requiredEnvironment(config.reference_key_env));
    if (config.reference_key_file) return decodeSpoolKey(await readFile(resolveFromConfig(config.reference_key_file), 'utf8'));
    throw new Error('Evidence Node config requires reference_key_env or reference_key_file.');
}

async function validateSourcePrerequisites(source: EvidenceNodeSourceConfig): Promise<void> {
    if (source.transport === 'file_drop') {
        const inboxPath = resolve(source.inbox_path);
        const archivePath = resolve(source.archive_path);
        if (inboxPath === archivePath) {
            throw new Error('File-drop archive_path must differ from inbox_path.');
        }
        await mkdir(inboxPath, { recursive: true });
        await mkdir(archivePath, { recursive: true });
        return;
    }
    if (source.transport === 'webhook') {
        requiredEnvironment(source.hmac_secret_env);
        if (!Number.isInteger(source.listen_port) || source.listen_port < 1 || source.listen_port > 65535) {
            throw new Error('Webhook listen_port is invalid.');
        }
        return;
    }
    if (source.transport === 'api_poll') {
        if (new URL(source.url).protocol !== 'https:') throw new Error('API source URL must use HTTPS.');
        if (source.bearer_token_env) requiredEnvironment(source.bearer_token_env);
        if (source.api_key_env) requiredEnvironment(source.api_key_env);
        return;
    }
    await Promise.all([stat(resolve(source.private_key_path)), stat(resolve(source.known_hosts_path))]);
    validateSftpPath(source.remote_inbox);
    validateSftpPath(source.remote_archive);
}

async function runSftp(source: EvidenceNodeSftpSourceConfig, commands: string[]) {
    const args = [
        '-b', '-',
        '-P', String(source.port ?? 22),
        '-i', resolve(source.private_key_path),
        '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'StrictHostKeyChecking=yes',
        '-o', `UserKnownHostsFile=${resolve(source.known_hosts_path)}`,
        `${source.username}@${source.host}`,
    ];
    return new Promise<{ stdout: string; stderr: string }>((resolveProcess, reject) => {
        const child = spawn(source.sftp_binary ?? 'sftp', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
        child.once('error', reject);
        child.once('close', (code) => {
            const output = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
            code === 0 ? resolveProcess(output) : reject(new Error(`SFTP exited ${code}: ${output.stderr.slice(0, 1000)}`));
        });
        child.stdin.end(`${commands.join('\n')}\n`);
    });
}

function verifyWebhookSignature(
    request: IncomingMessage,
    body: Buffer,
    secret: string,
    source: EvidenceNodeWebhookSourceConfig,
) {
    const signatureHeader = (source.signature_header ?? 'x-vetios-signature').toLowerCase();
    const timestampHeader = (source.timestamp_header ?? 'x-vetios-timestamp').toLowerCase();
    const signature = String(request.headers[signatureHeader] ?? '').replace(/^sha256=/i, '').toLowerCase();
    const timestamp = String(request.headers[timestampHeader] ?? '');
    if (!/^[a-f0-9]{64}$/.test(signature)) throw new Error('webhook_signature_missing_or_invalid');
    const timestampMs = Date.parse(timestamp);
    const maximumSkewMs = Math.max(30, source.maximum_clock_skew_seconds ?? 300) * 1000;
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > maximumSkewMs) {
        throw new Error('webhook_timestamp_outside_allowed_skew');
    }
    const expected = createHmac('sha256', secret).update(timestamp).update('.').update(body).digest();
    const received = Buffer.from(signature, 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        throw new Error('webhook_signature_mismatch');
    }
}

function enabledSources(config: EvidenceNodeRuntimeConfig) {
    return config.sources.filter((source) => source.enabled !== false);
}

function isWebhookSource(source: EvidenceNodeSourceConfig): source is EvidenceNodeWebhookSourceConfig {
    return source.transport === 'webhook';
}

function matchesFilename(name: string, pattern?: string): boolean {
    if (!name || name.startsWith('.') || name.endsWith('.part') || name.endsWith('.tmp')) return false;
    if (!pattern) return ['.csv', '.json', '.hl7', '.txt'].includes(extname(name).toLowerCase());
    if (pattern.length > 200) throw new Error('filename_pattern exceeds 200 characters.');
    return new RegExp(pattern, 'i').test(name);
}

function validateSftpPath(path: string) {
    if (!/^\/[a-zA-Z0-9._/-]+$/.test(path) || path.includes('..')) {
        throw new Error('SFTP paths must be absolute and contain only safe path characters.');
    }
}

function isSafeRemoteFilename(value: string) {
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/.test(basename(value)) && basename(value) === value;
}

async function moveWithoutOverwrite(from: string, desired: string) {
    await mkdir(dirname(desired), { recursive: true });
    let target = desired;
    try {
        await stat(target);
        target = join(dirname(desired), `${basename(desired, extname(desired))}.${Date.now()}${extname(desired)}`);
    } catch {
        // Target is available.
    }
    await rename(from, target);
}

async function readIncomingBody(request: IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > limit) throw new Error('webhook_payload_exceeds_10mb');
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

async function readResponseWithLimit(response: Response, limit: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error('api_payload_exceeds_10mb');
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

export function sanitizeEvidenceNodeRemoteReceipt(
    response: { status: number; request_id: string | null; body: Record<string, unknown> },
) {
    const receiptStatus = textValue(response.body.receipt_status);
    return {
        status: response.status,
        request_id: response.request_id,
        accepted: response.body.accepted === true,
        cached: response.body.cached === true,
        receipt_id: textValue(response.body.receipt_id),
        receipt_event_id: textValue(response.body.receipt_event_id),
        receipt_hash: textValue(response.body.receipt_hash),
        receipt_status: receiptStatus,
        ingestion_event_id: textValue(response.body.ingestion_event_id),
        identity_link_id: textValue(response.body.identity_link_id),
        identity_status: textValue(response.body.identity_status),
        amr_episode_id: textValue(response.body.amr_episode_id),
        closure_task_id: textValue(response.body.closure_task_id),
        reconciliation_event_id: textValue(response.body.reconciliation_event_id),
        lab_feed_event_ids: Array.isArray(response.body.lab_feed_event_ids)
            ? response.body.lab_feed_event_ids.filter((value): value is string => typeof value === 'string')
            : [],
        canonical_packet_hash: textValue(response.body.canonical_packet_hash),
        duplicate: receiptStatus === 'duplicate' || response.body.cached === true,
    };
}

function respondJson(response: import('node:http').ServerResponse, status: number, body: Record<string, unknown>) {
    const serialized = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serialized) });
    response.end(serialized);
}

function requiredEnvironment(name: string): string {
    if (!name?.trim()) throw new Error('Environment variable name is missing from Evidence Node config.');
    const value = process.env[name];
    if (!value?.trim()) throw new Error(`Required environment variable ${name} is not configured.`);
    return value;
}

function localSha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

async function readJson(path: string): Promise<unknown> {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function sanitizeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, ' ').slice(0, 1000);
}

function textValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(milliseconds: number) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}
