#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
    buildTrainedMaskedUpdateCommitment,
    trainLocalFederatedTask,
    toFederatedUpdateSubmissionPayload,
    VetiosFederationNodeAgent,
    VetiosFederationNodeClient,
    type FederationRoundTask,
    type LocalClinicalLearningRecord,
} from './index.js';

interface CliOptions {
    service: boolean;
    configPath?: string;
    recordsPath?: string;
    taskPath?: string;
    outputPath?: string;
    statePath?: string;
    logPath?: string;
    pollMs?: number;
    once: boolean;
    maxIterations?: number;
    submit: boolean;
    baseUrl?: string;
    machineToken?: string;
    tenantId?: string;
    federationKey?: string;
    nodeRef?: string;
    partnerRef?: string;
    secret?: string;
    outcomeEligibilitySnapshotId?: string;
}

interface ServiceConfig {
    records_path?: string;
    state_path?: string;
    log_path?: string;
    poll_ms?: number;
    base_url?: string;
    machine_token?: string;
    tenant_id?: string;
    federation_key?: string;
    node_ref?: string;
    partner_ref?: string;
    secret?: string;
    outcome_eligibility_snapshot_id?: string;
}

interface NodeServiceState {
    schema: 'vetios_federation_node_service_state_v1';
    node_ref: string;
    key_version: number;
    node_private_key_der_base64: string;
    node_public_key_der_base64: string;
    node_public_key_fingerprint: string;
    created_at: string;
    updated_at: string;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.service) {
        await runServiceMode(options);
        return;
    }
    if (!options.recordsPath || !options.taskPath) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    const records = await readJson<LocalClinicalLearningRecord[]>(options.recordsPath);
    const task = await readJson<FederationRoundTask>(options.taskPath);
    const tenantId = requiredOption(options.tenantId ?? process.env.VETIOS_TENANT_ID, 'tenant id');
    const federationKey = requiredOption(options.federationKey ?? task.federation_key, 'federation key');
    const secret = requiredOption(options.secret ?? process.env.VETIOS_NODE_SECRET, 'node secret');
    const partnerRef = options.partnerRef ?? task.partner_ref;
    const trained = trainLocalFederatedTask({
        task,
        records,
        tenantId,
        federationKey,
        partnerRef,
    });
    const commitment = buildTrainedMaskedUpdateCommitment({
        task,
        dataset: trained.dataset,
        delta: trained.delta,
        outcomeEligibilitySnapshotId: options.outcomeEligibilitySnapshotId,
        secret,
    });

    let submission: unknown = null;
    if (options.submit) {
        const client = new VetiosFederationNodeClient({
            baseUrl: requiredOption(options.baseUrl ?? process.env.VETIOS_BASE_URL, 'base URL'),
            machineToken: requiredOption(options.machineToken ?? process.env.VETIOS_MACHINE_TOKEN, 'machine token'),
            federationKey,
            nodeRef: requiredOption(options.nodeRef ?? task.node_ref, 'node ref'),
            partnerRef,
        });
        await client.heartbeat({
            local_runner: 'vetios-federation-node-cli',
            outcome_eligibility_status: trained.dataset.snapshot_draft.eligibility_status,
            record_digest: trained.dataset.record_digest,
        });
        submission = await client.submitUpdate(task.federation_round_id, commitment);
    }

    const output = {
        snapshot_draft: trained.dataset.snapshot_draft,
        local_delta_summary: {
            schema: trained.delta.schema,
            task_type: trained.delta.task_type,
            contribution_role: trained.delta.contribution_role,
            eligible_record_count: trained.delta.eligible_record_count,
            training_record_count: trained.delta.training_record_count,
            holdout_record_count: trained.delta.holdout_record_count,
            feature_count: trained.delta.feature_count,
            label_count: trained.delta.label_count,
            delta_digest: trained.delta.delta_digest,
            delta_norm: trained.delta.delta_norm,
            metric_summary: trained.delta.metric_summary,
        },
        secure_aggregation_materialization: {
            schema: commitment.secure_aggregation_materialization.schema,
            masking_protocol: commitment.secure_aggregation_materialization.masking_protocol,
            dimension_count: commitment.secure_aggregation_materialization.dimension_count,
            pairwise_mask_count: commitment.secure_aggregation_materialization.pairwise_mask_commitments.length,
            unmask_share_count: commitment.secure_aggregation_materialization.unmask_share_commitments.length,
            dropped_peer_refs: commitment.secure_aggregation_materialization.dropped_peer_refs,
            masked_vector_digest: commitment.secure_aggregation_materialization.masked_vector_digest,
            mask_commitment_hash: commitment.secure_aggregation_materialization.mask_commitment_hash,
            evidence: commitment.secure_aggregation_materialization.evidence,
        },
        submission_payload: toFederatedUpdateSubmissionPayload(commitment),
        submitted: options.submit,
        submission,
    };
    const json = `${JSON.stringify(output, null, 2)}\n`;
    if (options.outputPath) {
        await writeFile(options.outputPath, json, 'utf8');
    } else {
        process.stdout.write(json);
    }
}

function parseArgs(args: string[]): CliOptions {
    const options: CliOptions = { service: args[0] === 'service' || args.includes('--service'), submit: false, once: false };
    const startIndex = args[0] === 'service' ? 1 : 0;
    for (let index = startIndex; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--service') {
            options.service = true;
            continue;
        }
        if (arg === '--submit') {
            options.submit = true;
            continue;
        }
        if (arg === '--once') {
            options.once = true;
            continue;
        }
        const value = args[index + 1];
        if (!value) continue;
        if (arg === '--config') options.configPath = value;
        if (arg === '--records') options.recordsPath = value;
        if (arg === '--task') options.taskPath = value;
        if (arg === '--out') options.outputPath = value;
        if (arg === '--state') options.statePath = value;
        if (arg === '--log') options.logPath = value;
        if (arg === '--poll-ms') options.pollMs = parsePositiveInteger(value);
        if (arg === '--max-iterations') options.maxIterations = parsePositiveInteger(value);
        if (arg === '--base-url') options.baseUrl = value;
        if (arg === '--machine-token') options.machineToken = value;
        if (arg === '--tenant-id') options.tenantId = value;
        if (arg === '--federation-key') options.federationKey = value;
        if (arg === '--node-ref') options.nodeRef = value;
        if (arg === '--partner-ref') options.partnerRef = value;
        if (arg === '--secret') options.secret = value;
        if (arg === '--outcome-eligibility-snapshot-id') options.outcomeEligibilitySnapshotId = value;
        index += 1;
    }
    return options;
}

async function runServiceMode(options: CliOptions): Promise<void> {
    const config = options.configPath ? await readJson<ServiceConfig>(options.configPath) : {};
    const recordsPath = requiredOption(options.recordsPath ?? config.records_path, 'records path');
    const baseUrl = requiredOption(options.baseUrl ?? config.base_url ?? process.env.VETIOS_BASE_URL, 'base URL');
    const machineToken = requiredOption(options.machineToken ?? config.machine_token ?? process.env.VETIOS_MACHINE_TOKEN, 'machine token');
    const tenantId = requiredOption(options.tenantId ?? config.tenant_id ?? process.env.VETIOS_TENANT_ID, 'tenant id');
    const federationKey = requiredOption(options.federationKey ?? config.federation_key ?? process.env.VETIOS_FEDERATION_KEY, 'federation key');
    const nodeRef = requiredOption(options.nodeRef ?? config.node_ref ?? process.env.VETIOS_NODE_REF, 'node ref');
    const partnerRef = options.partnerRef ?? config.partner_ref ?? process.env.VETIOS_PARTNER_REF ?? null;
    const secret = requiredOption(options.secret ?? config.secret ?? process.env.VETIOS_NODE_SECRET, 'node secret');
    const statePath = options.statePath ?? config.state_path ?? `.vetios-node/${nodeRef}.state.json`;
    const logPath = options.logPath ?? config.log_path ?? `.vetios-node/${nodeRef}.audit.jsonl`;
    const pollMs = Math.max(1_000, options.pollMs ?? config.poll_ms ?? 30_000);
    const maxIterations = options.once ? 1 : options.maxIterations;
    const state = await loadOrCreateNodeServiceState(statePath, nodeRef);
    const client = new VetiosFederationNodeClient({
        baseUrl,
        machineToken,
        federationKey,
        nodeRef,
        partnerRef,
    });

    let iteration = 0;
    while (maxIterations == null || iteration < maxIterations) {
        iteration += 1;
        const audit = await runServiceIteration({
            client,
            recordsPath,
            tenantId,
            federationKey,
            nodeRef,
            partnerRef,
            secret,
            outcomeEligibilitySnapshotId: options.outcomeEligibilitySnapshotId ?? config.outcome_eligibility_snapshot_id,
            state,
            iteration,
        }).catch((error: unknown) => ({
            schema: 'vetios_federation_node_service_audit_v1',
            status: 'error',
            iteration,
            observed_at: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'unknown service iteration failure',
        }));
        await appendAuditLog(logPath, audit);
        process.stdout.write(`${JSON.stringify(audit)}\n`);
        if (options.once) break;
        await sleep(pollMs);
    }
}

async function runServiceIteration(input: {
    client: VetiosFederationNodeClient;
    recordsPath: string;
    tenantId: string;
    federationKey: string;
    nodeRef: string;
    partnerRef: string | null;
    secret: string;
    outcomeEligibilitySnapshotId?: string | null;
    state: NodeServiceState;
    iteration: number;
}): Promise<Record<string, unknown>> {
    const records = await readJson<LocalClinicalLearningRecord[]>(input.recordsPath);
    const current = asRecord(await input.client.getCurrentRound());
    const tasks = readTasks(current.tasks);
    const task = tasks.find((entry) => entry.task_status === 'issued' || entry.task_status === 'pulled' || entry.task_status === 'planned') ?? null;
    const trainedDataset = trainLocalFederatedTask({
        task: task ?? placeholderHeartbeatTask(input),
        records,
        tenantId: input.tenantId,
        federationKey: input.federationKey,
        partnerRef: input.partnerRef,
    }).dataset;

    await input.client.heartbeat({
        local_runner: 'vetios-federation-node-service',
        service_mode: true,
        node_public_key_der_base64: input.state.node_public_key_der_base64,
        node_public_key_fingerprint: input.state.node_public_key_fingerprint,
        key_version: input.state.key_version,
        outcome_eligibility_status: trainedDataset.snapshot_draft.eligibility_status,
        record_digest: trainedDataset.record_digest,
        record_count: records.length,
        raw_records_shared: false,
    });

    if (!task) {
        return {
            schema: 'vetios_federation_node_service_audit_v1',
            status: 'heartbeat_only',
            iteration: input.iteration,
            observed_at: new Date().toISOString(),
            task_available: false,
            record_digest: trainedDataset.record_digest,
            eligible_record_count: trainedDataset.eligible_records.length,
            raw_records_shared: false,
        };
    }

    const hydratedTask = hydrateTaskWithNodeKey(task, input.state);
    const agent = new VetiosFederationNodeAgent({
        client: input.client,
        records,
        secret: input.secret,
        tenantId: input.tenantId,
        federationKey: input.federationKey,
        partnerRef: input.partnerRef,
        outcomeEligibilitySnapshotId: input.outcomeEligibilitySnapshotId ?? task.outcome_eligibility_snapshot_id ?? null,
    });
    const result = await agent.runTask(hydratedTask);

    return {
        schema: 'vetios_federation_node_service_audit_v1',
        status: 'submitted_update',
        iteration: input.iteration,
        observed_at: new Date().toISOString(),
        federation_round_id: hydratedTask.federation_round_id,
        round_node_task_id: hydratedTask.id,
        task_type: hydratedTask.task_type,
        contribution_role: result.commitment.contribution_role,
        payload_commitment_hash: result.commitment.payload_commitment_hash,
        mask_commitment_hash: result.commitment.mask_commitment_hash,
        masking_protocol: result.commitment.masking_protocol,
        encrypted_unmask_share_envelope_count: result.commitment.secure_aggregation_materialization.encrypted_unmask_share_envelopes.length,
        eligible_record_count: result.delta.eligible_record_count,
        record_digest: result.dataset.record_digest,
        submission_received: result.submission != null,
        raw_records_shared: false,
        raw_model_delta_shared: false,
    };
}

async function readJson<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function loadOrCreateNodeServiceState(path: string, nodeRef: string): Promise<NodeServiceState> {
    try {
        const existing = JSON.parse(await readFile(path, 'utf8')) as NodeServiceState;
        if (existing.schema === 'vetios_federation_node_service_state_v1' && existing.node_private_key_der_base64) {
            return existing;
        }
    } catch {
        // Create a fresh local key state below.
    }
    const now = new Date().toISOString();
    const keyPair = generateKeyPairSync('x25519');
    const privateDer = keyPair.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
    const publicDer = keyPair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    const state: NodeServiceState = {
        schema: 'vetios_federation_node_service_state_v1',
        node_ref: nodeRef,
        key_version: 1,
        node_private_key_der_base64: privateDer.toString('base64'),
        node_public_key_der_base64: publicDer.toString('base64'),
        node_public_key_fingerprint: createHash('sha256').update(publicDer).digest('hex').slice(0, 32),
        created_at: now,
        updated_at: now,
    };
    await ensureParentDirectory(path);
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return state;
}

function hydrateTaskWithNodeKey(task: FederationRoundTask, state: NodeServiceState): FederationRoundTask {
    const secureAggregationConfig = asRecord(task.secure_aggregation_config);
    return {
        ...task,
        secure_aggregation_config: {
            ...secureAggregationConfig,
            node_private_key_der_base64: secureAggregationConfig.node_private_key_der_base64 ?? state.node_private_key_der_base64,
            node_public_key_der_base64: secureAggregationConfig.node_public_key_der_base64 ?? state.node_public_key_der_base64,
            node_public_key_fingerprint: secureAggregationConfig.node_public_key_fingerprint ?? state.node_public_key_fingerprint,
        },
    };
}

function readTasks(value: unknown): Array<FederationRoundTask & { task_status?: string | null; outcome_eligibility_snapshot_id?: string | null }> {
    return Array.isArray(value)
        ? value.map((entry) => asRecord(entry)).map((entry) => ({
            id: String(entry.id ?? ''),
            federation_round_id: String(entry.federation_round_id ?? ''),
            federation_key: String(entry.federation_key ?? ''),
            round_key: String(entry.round_key ?? ''),
            node_ref: String(entry.node_ref ?? ''),
            partner_ref: String(entry.partner_ref ?? ''),
            task_type: readTaskType(entry.task_type),
            plan_hash: String(entry.plan_hash ?? ''),
            dataset_policy: asRecord(entry.dataset_policy),
            secure_aggregation_config: asRecord(entry.secure_aggregation_config),
            task_payload: asRecord(entry.task_payload),
            task_status: typeof entry.task_status === 'string' ? entry.task_status : null,
            outcome_eligibility_snapshot_id: typeof entry.outcome_eligibility_snapshot_id === 'string' ? entry.outcome_eligibility_snapshot_id : null,
        })).filter((task) => task.id.length > 0 && task.federation_round_id.length > 0)
        : [];
}

function placeholderHeartbeatTask(input: {
    federationKey: string;
    nodeRef: string;
    partnerRef: string | null;
}): FederationRoundTask {
    return {
        id: 'heartbeat-only',
        federation_round_id: 'heartbeat-only',
        federation_key: input.federationKey,
        round_key: `${input.federationKey}:heartbeat`,
        node_ref: input.nodeRef,
        partner_ref: input.partnerRef ?? input.nodeRef,
        task_type: 'support_summary',
        plan_hash: createHash('sha256').update('heartbeat-only').digest('hex'),
        secure_aggregation_config: {},
        task_payload: {},
        dataset_policy: {},
    };
}

async function appendAuditLog(path: string, audit: Record<string, unknown>): Promise<void> {
    await ensureParentDirectory(path);
    await appendFile(path, `${JSON.stringify(audit)}\n`, 'utf8');
}

async function ensureParentDirectory(path: string): Promise<void> {
    const parent = dirname(path);
    if (parent && parent !== '.') {
        await mkdir(parent, { recursive: true });
    }
}

function readTaskType(value: unknown): FederationRoundTask['task_type'] {
    if (
        value === 'diagnosis_delta'
        || value === 'severity_delta'
        || value === 'support_summary'
        || value === 'secure_aggregation_key'
        || value === 'unmask_share'
    ) {
        return value;
    }
    return 'diagnosis_delta';
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function parsePositiveInteger(value: string): number | undefined {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredOption(value: string | undefined, label: string): string {
    if (value && value.trim().length > 0) return value;
    throw new Error(`Missing ${label}. Provide a CLI flag or environment variable.`);
}

function printUsage() {
    process.stderr.write(`Usage:
  vetios-federation-node --records records.json --task task.json --tenant-id <tenant> --secret <secret> [--out commitment.json]

Optional submit mode:
  vetios-federation-node --records records.json --task task.json --tenant-id <tenant> --secret <secret> --base-url <url> --machine-token <token> --submit

Environment fallbacks:
  VETIOS_TENANT_ID, VETIOS_NODE_SECRET, VETIOS_BASE_URL, VETIOS_MACHINE_TOKEN
`);
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Federation node CLI failed'}\n`);
    process.exitCode = 1;
});
