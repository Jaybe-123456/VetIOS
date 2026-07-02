#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
    buildLocalMultiNodeFederatedRoundProof,
    buildTrainedMaskedUpdateCommitment,
    trainLocalFederatedTask,
    toFederatedUpdateSubmissionPayload,
    VetiosFederationNodeAgent,
    VetiosFederationNodeClient,
    type FederationRoundTask,
    type LocalClinicalLearningRecord,
} from './index.js';

interface CliOptions {
    init: boolean;
    service: boolean;
    rotateKeys: boolean;
    doctor: boolean;
    roundProof: boolean;
    configPath?: string;
    participantsPath?: string;
    recordsPath?: string;
    recordSourcesPath?: string;
    taskPath?: string;
    outputPath?: string;
    statePath?: string;
    logPath?: string;
    pollMs?: number;
    retryAttempts?: number;
    retryBaseMs?: number;
    rotationReason?: string;
    rotationPacketPath?: string;
    once: boolean;
    maxIterations?: number;
    outDir?: string;
    submit: boolean;
    baseUrl?: string;
    machineToken?: string;
    tenantId?: string;
    federationKey?: string;
    federationRoundId?: string;
    roundKey?: string;
    taskType?: FederationRoundTask['task_type'];
    nodeRef?: string;
    partnerRef?: string;
    secret?: string;
    outcomeEligibilitySnapshotId?: string;
    minimumParticipants?: number;
    minimumRequiredRows?: number;
    minimumProvenanceRows?: number;
    minimumTrustScoredRows?: number;
    includeAggregateVector: boolean;
    includeCoordinatorRecoveryKey: boolean;
}

interface ServiceConfig {
    records_path?: string;
    record_sources_path?: string;
    record_sources?: ServiceRecordSource[];
    state_path?: string;
    log_path?: string;
    poll_ms?: number;
    retry_attempts?: number;
    retry_base_ms?: number;
    base_url?: string;
    machine_token?: string;
    tenant_id?: string;
    federation_key?: string;
    node_ref?: string;
    partner_ref?: string;
    secret?: string;
    outcome_eligibility_snapshot_id?: string;
}

type ServiceRecordSourceKind = 'vetios_json' | 'vetios_jsonl' | 'pims_csv' | 'lab_csv' | 'pacs_json';

interface ServiceRecordSource {
    kind?: ServiceRecordSourceKind;
    path: string;
    source_system?: string;
    defaults?: Partial<LocalClinicalLearningRecord>;
    columns?: Record<string, string>;
}

interface RoundProofParticipantConfig {
    tenant_id?: string;
    tenantId?: string;
    node_ref?: string;
    nodeRef?: string;
    partner_ref?: string | null;
    partnerRef?: string | null;
    secret?: string | null;
    outcome_eligibility_snapshot_id?: string | null;
    outcomeEligibilitySnapshotId?: string | null;
    records_path?: string;
    recordsPath?: string;
    record_sources_path?: string;
    recordSourcesPath?: string;
    record_sources?: ServiceRecordSource[];
    recordSources?: ServiceRecordSource[];
}

interface LoadedRecordSourceSummary {
    kind: ServiceRecordSourceKind;
    source_system: string | null;
    records_loaded: number;
    digest: string;
    source_ref_hash: string;
}

interface LoadedRecordSet {
    records: LocalClinicalLearningRecord[];
    source_summaries: LoadedRecordSourceSummary[];
    source_digest: string;
    duplicate_record_count: number;
}

interface NodeServiceState {
    schema: 'vetios_federation_node_service_state_v1';
    node_ref: string;
    key_version: number;
    node_private_key_der_base64: string;
    node_public_key_der_base64: string;
    node_public_key_fingerprint: string;
    previous_node_public_key_fingerprint?: string | null;
    signing_private_key_der_base64: string;
    signing_public_key_der_base64: string;
    signing_key_fingerprint: string;
    previous_signing_key_fingerprint?: string | null;
    rotated_at?: string | null;
    rotation_count?: number;
    created_at: string;
    updated_at: string;
}

interface RetryObservation<T> {
    value: T;
    attempts: number;
    transient_errors: string[];
}

interface ServiceIterationInput {
    client: VetiosFederationNodeClient;
    recordSources: ServiceRecordSource[];
    tenantId: string;
    federationKey: string;
    nodeRef: string;
    partnerRef: string | null;
    secret: string;
    outcomeEligibilitySnapshotId?: string | null;
    state: NodeServiceState;
    iteration: number;
    retryAttempts: number;
    retryBaseMs: number;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.init) {
        await runInitMode(options);
        return;
    }
    if (options.rotateKeys) {
        await runRotateKeysMode(options);
        return;
    }
    if (options.doctor) {
        await runDoctorMode(options);
        return;
    }
    if (options.roundProof) {
        await runRoundProofMode(options);
        return;
    }
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
    const options: CliOptions = {
        init: args[0] === 'init' || args.includes('--init'),
        service: args[0] === 'service' || args.includes('--service'),
        rotateKeys: args[0] === 'rotate-keys' || args.includes('--rotate-keys'),
        doctor: args[0] === 'doctor' || args.includes('--doctor'),
        roundProof: args[0] === 'round-proof' || args.includes('--round-proof'),
        submit: false,
        once: false,
        includeAggregateVector: false,
        includeCoordinatorRecoveryKey: false,
    };
    const startIndex = args[0] === 'service'
        || args[0] === 'init'
        || args[0] === 'rotate-keys'
        || args[0] === 'doctor'
        || args[0] === 'round-proof'
        ? 1
        : 0;
    for (let index = startIndex; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--init') {
            options.init = true;
            continue;
        }
        if (arg === '--service') {
            options.service = true;
            continue;
        }
        if (arg === '--rotate-keys') {
            options.rotateKeys = true;
            continue;
        }
        if (arg === '--doctor') {
            options.doctor = true;
            continue;
        }
        if (arg === '--round-proof') {
            options.roundProof = true;
            continue;
        }
        if (arg === '--submit') {
            options.submit = true;
            continue;
        }
        if (arg === '--include-aggregate-vector') {
            options.includeAggregateVector = true;
            continue;
        }
        if (arg === '--include-coordinator-recovery-key') {
            options.includeCoordinatorRecoveryKey = true;
            continue;
        }
        if (arg === '--once') {
            options.once = true;
            continue;
        }
        const value = args[index + 1];
        if (!value) continue;
        if (arg === '--config') options.configPath = value;
        if (arg === '--participants') options.participantsPath = value;
        if (arg === '--records') options.recordsPath = value;
        if (arg === '--record-sources') options.recordSourcesPath = value;
        if (arg === '--task') options.taskPath = value;
        if (arg === '--out') options.outputPath = value;
        if (arg === '--state') options.statePath = value;
        if (arg === '--log') options.logPath = value;
        if (arg === '--out-dir') options.outDir = value;
        if (arg === '--poll-ms') options.pollMs = parsePositiveInteger(value);
        if (arg === '--retry-attempts') options.retryAttempts = parsePositiveInteger(value);
        if (arg === '--retry-base-ms') options.retryBaseMs = parsePositiveInteger(value);
        if (arg === '--rotation-reason') options.rotationReason = value;
        if (arg === '--rotation-packet') options.rotationPacketPath = value;
        if (arg === '--max-iterations') options.maxIterations = parsePositiveInteger(value);
        if (arg === '--base-url') options.baseUrl = value;
        if (arg === '--machine-token') options.machineToken = value;
        if (arg === '--tenant-id') options.tenantId = value;
        if (arg === '--federation-key') options.federationKey = value;
        if (arg === '--federation-round-id') options.federationRoundId = value;
        if (arg === '--round-key') options.roundKey = value;
        if (arg === '--task-type') options.taskType = readTaskType(value);
        if (arg === '--node-ref') options.nodeRef = value;
        if (arg === '--partner-ref') options.partnerRef = value;
        if (arg === '--secret') options.secret = value;
        if (arg === '--outcome-eligibility-snapshot-id') options.outcomeEligibilitySnapshotId = value;
        if (arg === '--minimum-participants') options.minimumParticipants = parsePositiveInteger(value);
        if (arg === '--minimum-required-rows') options.minimumRequiredRows = parsePositiveInteger(value);
        if (arg === '--minimum-provenance-rows') options.minimumProvenanceRows = parsePositiveInteger(value);
        if (arg === '--minimum-trust-scored-rows') options.minimumTrustScoredRows = parsePositiveInteger(value);
        index += 1;
    }
    return options;
}

async function runInitMode(options: CliOptions): Promise<void> {
    const tenantId = requiredOption(options.tenantId ?? process.env.VETIOS_TENANT_ID, 'tenant id');
    const federationKey = requiredOption(options.federationKey ?? process.env.VETIOS_FEDERATION_KEY, 'federation key');
    const nodeRef = requiredOption(options.nodeRef ?? process.env.VETIOS_NODE_REF, 'node ref');
    const partnerRef = options.partnerRef ?? process.env.VETIOS_PARTNER_REF ?? nodeRef;
    const baseUrl = options.baseUrl ?? process.env.VETIOS_BASE_URL ?? 'https://vetios.tech';
    const outDir = options.outDir ?? '.vetios-node';
    const configPath = options.configPath ?? `${outDir}/${nodeRef}.config.json`;
    const statePath = options.statePath ?? `${outDir}/${nodeRef}.state.json`;
    const logPath = options.logPath ?? `${outDir}/${nodeRef}.audit.jsonl`;
    const recordsPath = options.recordsPath ?? 'exports/pims-cases.csv';
    const sourceKind = inferSourceKind(recordsPath);
    const state = await loadOrCreateNodeServiceState(statePath, nodeRef);
    const config: ServiceConfig & { schema: string; requires_env: string[] } = {
        schema: 'vetios_federation_node_service_config_v1',
        record_sources: [{
            kind: sourceKind,
            path: recordsPath,
            source_system: defaultSourceSystem(sourceKind),
            defaults: {
                consent_status: 'granted',
                provenance_status: sourceKind === 'lab_csv' ? 'externally_verified' : 'source_attested',
            },
        }],
        state_path: statePath,
        log_path: logPath,
        poll_ms: options.pollMs ?? 30_000,
        retry_attempts: options.retryAttempts ?? 3,
        retry_base_ms: options.retryBaseMs ?? 1_000,
        base_url: baseUrl,
        tenant_id: tenantId,
        federation_key: federationKey,
        node_ref: nodeRef,
        partner_ref: partnerRef,
        requires_env: ['VETIOS_MACHINE_TOKEN', 'VETIOS_NODE_SECRET'],
    };
    const configDigest = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    const enrollmentPacket = {
        schema: 'vetios_federation_node_enrollment_packet_v1',
        tenant_id: tenantId,
        federation_key: federationKey,
        node_ref: nodeRef,
        partner_ref: partnerRef,
        node_public_key_der_base64: state.node_public_key_der_base64,
        node_public_key_fingerprint: state.node_public_key_fingerprint,
        signing_public_key_der_base64: state.signing_public_key_der_base64,
        signing_key_fingerprint: state.signing_key_fingerprint,
        key_version: state.key_version,
        service_config_digest: configDigest,
        requested_scopes: ['federation:node'],
        deployment_environment: 'production',
        generated_at: new Date().toISOString(),
        raw_records_shared: false,
        raw_model_delta_shared: false,
    };
    const enrollmentPath = `${outDir}/${nodeRef}.enrollment.json`;
    const windowsPath = `${outDir}/${nodeRef}.run-service.ps1`;
    const systemdPath = `${outDir}/${nodeRef}.service`;
    await ensureParentDirectory(configPath);
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await writeFile(enrollmentPath, `${JSON.stringify(enrollmentPacket, null, 2)}\n`, 'utf8');
    await writeFile(windowsPath, buildWindowsServiceTemplate(configPath), 'utf8');
    await writeFile(systemdPath, buildSystemdTemplate(configPath, nodeRef), 'utf8');
    process.stdout.write(`${JSON.stringify({
        schema: 'vetios_federation_node_init_result_v1',
        config_path: configPath,
        state_path: statePath,
        enrollment_packet_path: enrollmentPath,
        windows_runner_path: windowsPath,
        systemd_unit_path: systemdPath,
        node_public_key_fingerprint: state.node_public_key_fingerprint,
        signing_key_fingerprint: state.signing_key_fingerprint,
        secrets_written_to_config: false,
        next_steps: [
            'store VETIOS_MACHINE_TOKEN and VETIOS_NODE_SECRET in the host secret manager or environment',
            'send the enrollment packet to the VetIOS federation coordinator',
            'run vetios-federation-node service --config <config_path> --once for a smoke test',
        ],
    }, null, 2)}\n`);
}

async function runRotateKeysMode(options: CliOptions): Promise<void> {
    const config = options.configPath ? await readJson<ServiceConfig>(options.configPath) : {};
    const tenantId = requiredOption(options.tenantId ?? config.tenant_id ?? process.env.VETIOS_TENANT_ID, 'tenant id');
    const federationKey = requiredOption(options.federationKey ?? config.federation_key ?? process.env.VETIOS_FEDERATION_KEY, 'federation key');
    const nodeRef = requiredOption(options.nodeRef ?? config.node_ref ?? process.env.VETIOS_NODE_REF, 'node ref');
    const partnerRef = options.partnerRef ?? config.partner_ref ?? process.env.VETIOS_PARTNER_REF ?? nodeRef;
    const statePath = options.statePath ?? config.state_path ?? `.vetios-node/${nodeRef}.state.json`;
    const logPath = options.logPath ?? config.log_path ?? `.vetios-node/${nodeRef}.audit.jsonl`;
    const rotationReason = options.rotationReason ?? 'scheduled_rotation';
    const existing = await loadOrCreateNodeServiceState(statePath, nodeRef);
    const previousFingerprint = existing.node_public_key_fingerprint;
    const previousSigningFingerprint = existing.signing_key_fingerprint;
    const rotatedAt = new Date().toISOString();
    const rotated = createNodeServiceState({
        nodeRef,
        keyVersion: existing.key_version + 1,
        createdAt: existing.created_at,
        previousNodePublicKeyFingerprint: previousFingerprint,
        previousSigningKeyFingerprint: previousSigningFingerprint,
        rotatedAt,
        rotationCount: (existing.rotation_count ?? 0) + 1,
    });
    const packetPath = options.rotationPacketPath
        ?? join(dirname(statePath), `${nodeRef}.key-rotation-v${rotated.key_version}.json`);
    const rotationPacket = {
        schema: 'vetios_federation_node_key_rotation_packet_v1',
        tenant_id: tenantId,
        federation_key: federationKey,
        node_ref: nodeRef,
        partner_ref: partnerRef,
        previous_node_public_key_fingerprint: previousFingerprint,
        node_public_key_der_base64: rotated.node_public_key_der_base64,
        node_public_key_fingerprint: rotated.node_public_key_fingerprint,
        previous_signing_key_fingerprint: previousSigningFingerprint,
        signing_public_key_der_base64: rotated.signing_public_key_der_base64,
        signing_key_fingerprint: rotated.signing_key_fingerprint,
        previous_key_version: existing.key_version,
        key_version: rotated.key_version,
        rotation_reason: rotationReason,
        generated_at: rotated.updated_at,
        private_key_exported: false,
        raw_records_shared: false,
        raw_model_delta_shared: false,
    };
    const audit = {
        schema: 'vetios_federation_node_key_rotation_audit_v1',
        status: 'rotated',
        tenant_id: tenantId,
        federation_key: federationKey,
        node_ref: nodeRef,
        partner_ref: partnerRef,
        previous_node_public_key_fingerprint: previousFingerprint,
        node_public_key_fingerprint: rotated.node_public_key_fingerprint,
        previous_signing_key_fingerprint: previousSigningFingerprint,
        signing_key_fingerprint: rotated.signing_key_fingerprint,
        previous_key_version: existing.key_version,
        key_version: rotated.key_version,
        rotation_reason: rotationReason,
        observed_at: rotated.updated_at,
        private_key_exported: false,
        raw_records_shared: false,
        raw_model_delta_shared: false,
    };
    await ensureParentDirectory(statePath);
    await writeFile(statePath, `${JSON.stringify(rotated, null, 2)}\n`, 'utf8');
    await ensureParentDirectory(packetPath);
    await writeFile(packetPath, `${JSON.stringify(rotationPacket, null, 2)}\n`, 'utf8');
    await appendAuditLog(logPath, audit);
    process.stdout.write(`${JSON.stringify({
        schema: 'vetios_federation_node_key_rotation_result_v1',
        state_path: statePath,
        rotation_packet_path: packetPath,
        audit_log_path: logPath,
        previous_node_public_key_fingerprint: previousFingerprint,
        node_public_key_fingerprint: rotated.node_public_key_fingerprint,
        previous_signing_key_fingerprint: previousSigningFingerprint,
        signing_key_fingerprint: rotated.signing_key_fingerprint,
        previous_key_version: existing.key_version,
        key_version: rotated.key_version,
        private_key_exported: false,
        next_steps: [
            'send the key rotation packet to the VetIOS federation coordinator',
            'restart the node service so future heartbeats use the rotated key',
        ],
    }, null, 2)}\n`);
}

async function runDoctorMode(options: CliOptions): Promise<void> {
    const config = options.configPath ? await readJson<ServiceConfig>(options.configPath) : {};
    const tenantId = readConfiguredText(options.tenantId ?? config.tenant_id ?? process.env.VETIOS_TENANT_ID);
    const federationKey = readConfiguredText(options.federationKey ?? config.federation_key ?? process.env.VETIOS_FEDERATION_KEY);
    const nodeRef = readConfiguredText(options.nodeRef ?? config.node_ref ?? process.env.VETIOS_NODE_REF);
    const partnerRef = readConfiguredText(options.partnerRef ?? config.partner_ref ?? process.env.VETIOS_PARTNER_REF);
    const baseUrl = readConfiguredText(options.baseUrl ?? config.base_url ?? process.env.VETIOS_BASE_URL);
    const machineTokenPresent = Boolean(readConfiguredText(options.machineToken ?? config.machine_token ?? process.env.VETIOS_MACHINE_TOKEN));
    const nodeSecretPresent = Boolean(readConfiguredText(options.secret ?? config.secret ?? process.env.VETIOS_NODE_SECRET));
    const statePath = options.statePath ?? config.state_path ?? `.vetios-node/${nodeRef ?? 'unconfigured-node'}.state.json`;
    const blockers = new Set<string>();
    const warnings = new Set<string>();

    if (!tenantId) blockers.add('tenant_id_missing');
    if (!federationKey) blockers.add('federation_key_missing');
    if (!nodeRef) blockers.add('node_ref_missing');
    if (!baseUrl) blockers.add('base_url_missing');
    if (!machineTokenPresent) blockers.add('machine_token_missing');
    if (!nodeSecretPresent) blockers.add('node_secret_missing');
    if (config.machine_token) warnings.add('machine_token_configured_in_file_prefer_secret_manager');
    if (config.secret) warnings.add('node_secret_configured_in_file_prefer_secret_manager');

    let recordSources: ServiceRecordSource[] = [];
    let sourceError: string | null = null;
    try {
        recordSources = await resolveRecordSources(options, config);
    } catch (error) {
        sourceError = error instanceof Error ? error.message : 'record source resolution failed';
        blockers.add('record_sources_missing');
    }

    let loaded = emptyLoadedRecordSet();
    try {
        loaded = recordSources.length > 0 ? await loadLocalClinicalRecords(recordSources) : emptyLoadedRecordSet();
    } catch (error) {
        sourceError = error instanceof Error ? error.message : 'record source load failed';
        blockers.add('record_source_load_failed');
    }
    if (loaded.records.length === 0) blockers.add('no_records_loaded');

    const state = nodeRef ? await loadOrCreateNodeServiceState(statePath, nodeRef) : null;
    const dataset = tenantId && federationKey && nodeRef
        ? trainLocalFederatedTask({
            task: placeholderHeartbeatTask({
                federationKey,
                nodeRef,
                partnerRef: partnerRef ?? nodeRef,
            }),
            records: loaded.records,
            tenantId,
            federationKey,
            partnerRef: partnerRef ?? nodeRef,
        }).dataset
        : null;
    if (dataset && dataset.eligible_records.length === 0) blockers.add('no_federation_eligible_records');
    if (dataset && dataset.snapshot_draft.blockers.length > 0) {
        for (const blocker of dataset.snapshot_draft.blockers) blockers.add(`eligibility_${blocker}`);
    }

    const result = {
        schema: 'vetios_federation_node_doctor_result_v1',
        status: blockers.size === 0 ? 'ready' : 'blocked',
        checked_at: new Date().toISOString(),
        config_path: options.configPath ?? null,
        state_path: statePath,
        federation_key: federationKey,
        node_ref: nodeRef,
        partner_ref: partnerRef ?? null,
        base_url_configured: baseUrl != null,
        env_readiness: {
            machine_token_present: machineTokenPresent,
            node_secret_present: nodeSecretPresent,
            secrets_written_to_output: false,
        },
        key_state: state
            ? {
                key_version: state.key_version,
                node_public_key_fingerprint: state.node_public_key_fingerprint,
                signing_key_fingerprint: state.signing_key_fingerprint,
                rotation_count: state.rotation_count ?? 0,
                private_key_exported: false,
            }
            : null,
        source_evidence: {
            source_count: recordSources.length,
            record_count: loaded.records.length,
            duplicate_record_count: loaded.duplicate_record_count,
            record_source_digest: loaded.source_digest,
            record_source_summaries: loaded.source_summaries,
            local_source_paths_shared: false,
            source_error: sourceError,
        },
        eligibility_evidence: dataset
            ? {
                outcome_eligibility_status: dataset.snapshot_draft.eligibility_status,
                eligible_record_count: dataset.eligible_records.length,
                outcome_confirmed_rows: dataset.snapshot_draft.outcome_confirmed_rows,
                provenance_verified_rows: dataset.snapshot_draft.provenance_verified_rows,
                trust_scored_rows: dataset.snapshot_draft.trust_scored_rows,
                average_trust_score: dataset.snapshot_draft.average_trust_score,
                source_record_digest: dataset.snapshot_draft.source_record_digest,
                blockers: dataset.snapshot_draft.blockers,
            }
            : null,
        privacy_boundary: buildServicePrivacyBoundary(),
        local_execution_boundary: {
            network_calls_made: false,
            raw_records_shared_with_vetios: false,
            raw_model_delta_shared_with_vetios: false,
            local_private_key_exported: false,
            local_source_paths_shared: false,
        },
        blockers: Array.from(blockers).sort(),
        warnings: Array.from(warnings).sort(),
    };
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (options.outputPath) {
        await writeFile(options.outputPath, json, 'utf8');
    } else {
        process.stdout.write(json);
    }
}

async function runRoundProofMode(options: CliOptions): Promise<void> {
    const federationKey = requiredOption(options.federationKey ?? process.env.VETIOS_FEDERATION_KEY, 'federation key');
    const participantsPath = requiredOption(options.participantsPath, 'participants manifest path');
    const participants = await readJson<RoundProofParticipantConfig[]>(participantsPath);
    if (!Array.isArray(participants) || participants.length === 0) {
        throw new Error('Participants manifest must be a non-empty JSON array.');
    }

    const loadedParticipants = await Promise.all(participants.map(async (participant, index) => {
        const tenantId = requiredOption(participant.tenant_id ?? participant.tenantId, `participant ${index + 1} tenant_id`);
        const nodeRef = requiredOption(participant.node_ref ?? participant.nodeRef, `participant ${index + 1} node_ref`);
        const partnerRef = participant.partner_ref ?? participant.partnerRef ?? nodeRef;
        const recordSources = await resolveParticipantRecordSources(participant);
        const loaded = await loadLocalClinicalRecords(recordSources);
        return {
            proof_input: {
                tenantId,
                nodeRef,
                partnerRef,
                records: loaded.records,
                secret: participant.secret ?? `round-proof-secret:${nodeRef}`,
                outcomeEligibilitySnapshotId: participant.outcome_eligibility_snapshot_id
                    ?? participant.outcomeEligibilitySnapshotId
                    ?? null,
            },
            source_evidence: {
                tenant_id: tenantId,
                node_ref: nodeRef,
                partner_ref: partnerRef,
                record_count: loaded.records.length,
                duplicate_record_count: loaded.duplicate_record_count,
                record_source_digest: loaded.source_digest,
                record_source_summaries: loaded.source_summaries,
                local_source_paths_shared: false,
            },
        };
    }));

    const proof = buildLocalMultiNodeFederatedRoundProof({
        federationKey,
        roundKey: options.roundKey,
        taskType: options.taskType ?? 'diagnosis_delta',
        federationRoundId: options.federationRoundId ?? null,
        minimumParticipants: options.minimumParticipants,
        minimumRequiredRows: options.minimumRequiredRows,
        minimumProvenanceRows: options.minimumProvenanceRows,
        minimumTrustScoredRows: options.minimumTrustScoredRows,
        includeAggregateVector: options.includeAggregateVector,
        includeCoordinatorRecoveryKey: options.includeCoordinatorRecoveryKey,
        participants: loadedParticipants.map((entry) => entry.proof_input),
    });
    const output = {
        schema: 'vetios_federation_node_round_proof_cli_result_v1',
        generated_at: proof.generated_at,
        federation_key: proof.federation_key,
        round_key: proof.round_key,
        federation_round_id: proof.federation_round_id,
        status: proof.status,
        participant_source_evidence: loadedParticipants.map((entry) => entry.source_evidence),
        proof,
        privacy_boundary: {
            raw_records_shared: false,
            raw_site_deltas_shared: false,
            raw_unmask_share_seeds_shared: false,
            local_source_paths_shared: false,
            node_private_keys_exported: false,
            coordinator_private_key_included: options.includeCoordinatorRecoveryKey,
            coordinator_private_key_local_proof_only: options.includeCoordinatorRecoveryKey,
        },
    };
    const json = `${JSON.stringify(output, null, 2)}\n`;
    if (options.outputPath) {
        await writeFile(options.outputPath, json, 'utf8');
    } else {
        process.stdout.write(json);
    }
}

async function runServiceMode(options: CliOptions): Promise<void> {
    const config = options.configPath ? await readJson<ServiceConfig>(options.configPath) : {};
    const recordSources = await resolveRecordSources(options, config);
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
    const retryAttempts = Math.max(1, options.retryAttempts ?? config.retry_attempts ?? 3);
    const retryBaseMs = Math.max(100, options.retryBaseMs ?? config.retry_base_ms ?? 1_000);
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
            recordSources,
            tenantId,
            federationKey,
            nodeRef,
            partnerRef,
            secret,
            outcomeEligibilitySnapshotId: options.outcomeEligibilitySnapshotId ?? config.outcome_eligibility_snapshot_id,
            state,
            iteration,
            retryAttempts,
            retryBaseMs,
        }).catch((error: unknown) => ({
            schema: 'vetios_federation_node_service_audit_v1',
            status: 'error',
            iteration,
            observed_at: new Date().toISOString(),
            federation_key: federationKey,
            node_ref: nodeRef,
            partner_ref: partnerRef,
            key_version: state.key_version,
            node_public_key_fingerprint: state.node_public_key_fingerprint,
            signing_key_fingerprint: state.signing_key_fingerprint,
            retry_policy: {
                attempts: retryAttempts,
                base_ms: retryBaseMs,
            },
            privacy_boundary: buildServicePrivacyBoundary(),
            error: error instanceof Error ? error.message : 'unknown service iteration failure',
        }));
        await appendAuditLog(logPath, audit);
        process.stdout.write(`${JSON.stringify(audit)}\n`);
        if (options.once) break;
        await sleep(pollMs);
    }
}

async function runServiceIteration(input: ServiceIterationInput): Promise<Record<string, unknown>> {
    const loaded = await loadLocalClinicalRecords(input.recordSources);
    const records = loaded.records;
    const currentRound = await withRetryReport(
        () => input.client.getCurrentRound(),
        { attempts: input.retryAttempts, baseMs: input.retryBaseMs },
    );
    const current = asRecord(currentRound.value);
    const tasks = readTasks(current.tasks);
    const task = tasks.find((entry) => entry.task_status === 'issued' || entry.task_status === 'pulled' || entry.task_status === 'planned') ?? null;
    const trainedDataset = trainLocalFederatedTask({
        task: task ?? placeholderHeartbeatTask(input),
        records,
        tenantId: input.tenantId,
        federationKey: input.federationKey,
        partnerRef: input.partnerRef,
    }).dataset;
    const baseAudit = buildServiceAuditBase(input, loaded, trainedDataset, {
        current_round_attempts: currentRound.attempts,
        current_round_transient_errors: currentRound.transient_errors,
        task_available: task != null,
        available_task_count: tasks.length,
    });

    const heartbeat = await withRetryReport(() => input.client.heartbeat({
        local_runner: 'vetios-federation-node-service',
        service_mode: true,
        node_public_key_der_base64: input.state.node_public_key_der_base64,
        node_public_key_fingerprint: input.state.node_public_key_fingerprint,
        signing_public_key_der_base64: input.state.signing_public_key_der_base64,
        signing_key_fingerprint: input.state.signing_key_fingerprint,
        key_version: input.state.key_version,
        outcome_eligibility_status: trainedDataset.snapshot_draft.eligibility_status,
        record_digest: trainedDataset.record_digest,
        record_count: records.length,
        record_source_digest: loaded.source_digest,
        record_source_summaries: loaded.source_summaries,
        raw_records_shared: false,
        privacy_boundary: buildServicePrivacyBoundary(),
    }), { attempts: input.retryAttempts, baseMs: input.retryBaseMs });

    if (!task) {
        return {
            ...baseAudit,
            status: 'heartbeat_only',
            task_available: false,
            heartbeat_attempts: heartbeat.attempts,
            heartbeat_transient_errors: heartbeat.transient_errors,
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
        signingKey: {
            privateKeyDerBase64: input.state.signing_private_key_der_base64,
        },
    });
    const taskRun = await withRetryReport(
        () => agent.runTask(hydratedTask),
        { attempts: input.retryAttempts, baseMs: input.retryBaseMs },
    );
    const result = taskRun.value;

    return {
        ...baseAudit,
        status: 'submitted_update',
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
        heartbeat_attempts: heartbeat.attempts,
        heartbeat_transient_errors: heartbeat.transient_errors,
        task_run_attempts: taskRun.attempts,
        task_run_transient_errors: taskRun.transient_errors,
        secure_aggregation: {
            schema: result.commitment.secure_aggregation_materialization.schema,
            masking_protocol: result.commitment.secure_aggregation_materialization.masking_protocol,
            dimension_count: result.commitment.secure_aggregation_materialization.dimension_count,
            pairwise_mask_count: result.commitment.secure_aggregation_materialization.pairwise_mask_commitments.length,
            encrypted_unmask_share_envelope_count: result.commitment.secure_aggregation_materialization.encrypted_unmask_share_envelopes.length,
            dropped_peer_count: result.commitment.secure_aggregation_materialization.dropped_peer_refs.length,
            masked_vector_digest: result.commitment.secure_aggregation_materialization.masked_vector_digest,
            local_mask_sum_digest: result.commitment.secure_aggregation_materialization.local_mask_sum_digest,
            raw_unmask_share_seed_shared: false,
        },
    };
}

async function readJson<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function resolveRecordSources(options: CliOptions, config: ServiceConfig): Promise<ServiceRecordSource[]> {
    const sourcesPath = options.recordSourcesPath ?? config.record_sources_path;
    if (sourcesPath) {
        const sources = await readJson<ServiceRecordSource[]>(sourcesPath);
        if (Array.isArray(sources) && sources.length > 0) return sources;
    }
    if (Array.isArray(config.record_sources) && config.record_sources.length > 0) {
        return config.record_sources;
    }
    const recordsPath = options.recordsPath ?? config.records_path;
    if (recordsPath) {
        return [{ kind: 'vetios_json', path: recordsPath, source_system: 'local-json' }];
    }
    throw new Error('Missing records path or record_sources. Provide --records, --record-sources, or config.record_sources.');
}

async function resolveParticipantRecordSources(participant: RoundProofParticipantConfig): Promise<ServiceRecordSource[]> {
    const sources = participant.record_sources ?? participant.recordSources;
    if (Array.isArray(sources) && sources.length > 0) return sources;
    const sourcesPath = participant.record_sources_path ?? participant.recordSourcesPath;
    if (sourcesPath) {
        const loaded = await readJson<ServiceRecordSource[]>(sourcesPath);
        if (Array.isArray(loaded) && loaded.length > 0) return loaded;
    }
    const recordsPath = participant.records_path ?? participant.recordsPath;
    if (recordsPath) {
        return [{
            kind: inferSourceKind(recordsPath),
            path: recordsPath,
            source_system: 'round-proof-local-export',
        }];
    }
    const nodeRef = participant.node_ref ?? participant.nodeRef ?? 'unknown-node';
    throw new Error(`Missing record sources for participant ${nodeRef}. Provide record_sources, record_sources_path, or records_path.`);
}

function emptyLoadedRecordSet(): LoadedRecordSet {
    return {
        records: [],
        source_summaries: [],
        source_digest: createHash('sha256').update('[]').digest('hex'),
        duplicate_record_count: 0,
    };
}

async function loadLocalClinicalRecords(sources: ServiceRecordSource[]): Promise<LoadedRecordSet> {
    const sourceSummaries: LoadedRecordSourceSummary[] = [];
    const recordsById = new Map<string, LocalClinicalLearningRecord>();
    let duplicateRecordCount = 0;
    for (const source of sources) {
        const kind = source.kind ?? inferSourceKind(source.path);
        const records = await loadRecordsFromSource({ ...source, kind });
        for (const record of records) {
            if (recordsById.has(record.local_record_id)) {
                duplicateRecordCount += 1;
            }
            recordsById.set(record.local_record_id, record);
        }
        sourceSummaries.push({
            kind,
            source_system: source.source_system ?? null,
            records_loaded: records.length,
            digest: createHash('sha256').update(JSON.stringify(records.map((record) => record.local_record_id).sort())).digest('hex'),
            source_ref_hash: createHash('sha256').update(`${kind}:${source.source_system ?? ''}:${basename(source.path)}`).digest('hex'),
        });
    }
    const records = Array.from(recordsById.values()).sort((left, right) => left.local_record_id.localeCompare(right.local_record_id));
    return {
        records,
        source_summaries: sourceSummaries,
        source_digest: createHash('sha256').update(JSON.stringify(sourceSummaries.map((summary) => summary.digest).sort())).digest('hex'),
        duplicate_record_count: duplicateRecordCount,
    };
}

function buildServiceAuditBase(
    input: ServiceIterationInput,
    loaded: LoadedRecordSet,
    dataset: ReturnType<typeof trainLocalFederatedTask>['dataset'],
    runtime: Record<string, unknown>,
): Record<string, unknown> {
    return {
        schema: 'vetios_federation_node_service_audit_v1',
        iteration: input.iteration,
        observed_at: new Date().toISOString(),
        federation_key: input.federationKey,
        node_ref: input.nodeRef,
        partner_ref: input.partnerRef,
        key_version: input.state.key_version,
        node_public_key_fingerprint: input.state.node_public_key_fingerprint,
        signing_key_fingerprint: input.state.signing_key_fingerprint,
        retry_policy: {
            attempts: input.retryAttempts,
            base_ms: input.retryBaseMs,
        },
        record_count: loaded.records.length,
        duplicate_record_count: loaded.duplicate_record_count,
        eligible_record_count: dataset.eligible_records.length,
        outcome_eligibility_status: dataset.snapshot_draft.eligibility_status,
        average_trust_score: dataset.snapshot_draft.average_trust_score,
        record_digest: dataset.record_digest,
        record_source_digest: loaded.source_digest,
        record_source_summaries: loaded.source_summaries,
        privacy_boundary: buildServicePrivacyBoundary(),
        local_execution_boundary: {
            runner: 'vetios-federation-node-service',
            raw_records_loaded_from_local_sources: true,
            raw_records_shared_with_vetios: false,
            raw_model_delta_shared_with_vetios: false,
            local_private_key_exported: false,
            local_source_paths_shared: false,
        },
        runtime,
    };
}

function buildServicePrivacyBoundary(): Record<string, false> {
    return {
        raw_records_shared: false,
        raw_model_delta_shared: false,
        unmasked_delta_shared: false,
        raw_unmask_share_seed_shared: false,
        private_key_exported: false,
        local_source_paths_shared: false,
    };
}

async function loadRecordsFromSource(source: ServiceRecordSource & { kind: ServiceRecordSourceKind }): Promise<LocalClinicalLearningRecord[]> {
    if (source.kind === 'vetios_json') {
        const rows = await readJson<unknown>(source.path);
        const records = Array.isArray(rows) ? rows : [rows];
        return records.map((entry, index) => normalizeSourceRecord(asRecord(entry), source, index));
    }
    if (source.kind === 'vetios_jsonl') {
        const text = await readFile(source.path, 'utf8');
        return text.split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line, index) => normalizeSourceRecord(asRecord(JSON.parse(line)), source, index));
    }
    if (source.kind === 'pims_csv' || source.kind === 'lab_csv') {
        const rows = parseCsv(await readFile(source.path, 'utf8'));
        return rows.map((row, index) => normalizeCsvRecord(row, source, index));
    }
    const report = await readJson<unknown>(source.path);
    const entries = Array.isArray(report) ? report : [report];
    return entries.map((entry, index) => normalizePacsRecord(asRecord(entry), source, index));
}

function normalizeSourceRecord(
    row: Record<string, unknown>,
    source: ServiceRecordSource,
    index: number,
): LocalClinicalLearningRecord {
    return {
        ...source.defaults,
        local_record_id: readFirstText(row, ['local_record_id', 'id', 'case_id', 'patient_id']) ?? `${source.path}:${index}`,
        species: readFirstText(row, ['species']),
        breed: readFirstText(row, ['breed']),
        age_years: readFirstNumber(row, ['age_years', 'age']),
        sex: readFirstText(row, ['sex']),
        signs: readDelimitedList(row.signs ?? row.presenting_complaint ?? row.reason_for_visit),
        duration_days: readFirstNumber(row, ['duration_days', 'duration']),
        labs: asRecord(row.labs),
        imaging: asRecord(row.imaging),
        treatment: asRecord(row.treatment),
        diagnosis: readFirstText(row, ['diagnosis', 'assessment']),
        outcome: readFirstText(row, ['outcome']),
        outcome_confirmed: readBoolean(row.outcome_confirmed),
        lab_confirmed: readBoolean(row.lab_confirmed),
        expert_reviewed: readBoolean(row.expert_reviewed),
        clinician_confirmed: readBoolean(row.clinician_confirmed),
        amr_related: readBoolean(row.amr_related),
        culture_collected: readBoolean(row.culture_collected),
        consent_status: readConsentStatus(row.consent_status) ?? source.defaults?.consent_status,
        provenance_status: readProvenanceStatus(row.provenance_status) ?? source.defaults?.provenance_status,
        source_system: source.source_system ?? readFirstText(row, ['source_system']) ?? source.kind,
        observed_at: readFirstText(row, ['observed_at', 'visit_date', 'resulted_at']),
    };
}

function normalizeCsvRecord(row: Record<string, string>, source: ServiceRecordSource, index: number): LocalClinicalLearningRecord {
    const mapped = mapColumns(row, source.columns);
    const labs = source.kind === 'lab_csv'
        ? {
            test_name: readFirstText(mapped, ['test_name', 'lab_test']),
            result: readFirstText(mapped, ['result', 'lab_result']),
            organism: readFirstText(mapped, ['organism', 'pathogen']),
            antimicrobial: readFirstText(mapped, ['antimicrobial', 'drug']),
            interpretation: readFirstText(mapped, ['interpretation', 'susceptibility']),
        }
        : {};
    return {
        ...normalizeSourceRecord(mapped, source, index),
        labs,
        lab_confirmed: source.kind === 'lab_csv' || readBoolean(mapped.lab_confirmed),
        culture_collected: source.kind === 'lab_csv' || readBoolean(mapped.culture_collected),
        amr_related: source.kind === 'lab_csv' || readBoolean(mapped.amr_related),
        source_system: source.source_system ?? source.kind,
    };
}

function normalizePacsRecord(row: Record<string, unknown>, source: ServiceRecordSource, index: number): LocalClinicalLearningRecord {
    return {
        ...normalizeSourceRecord(row, source, index),
        imaging: {
            modality: readFirstText(row, ['modality']),
            body_region: readFirstText(row, ['body_region', 'study_region']),
            report_digest: readFirstText(row, ['report_digest', 'report_hash']),
            finding_summary: readFirstText(row, ['finding_summary', 'impression']),
        },
        expert_reviewed: readBoolean(row.expert_reviewed) ?? true,
        source_system: source.source_system ?? 'pacs',
    };
}

function parseCsv(text: string): Record<string, string>[] {
    const rows: string[][] = [];
    let current = '';
    let row: string[] = [];
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];
        if (char === '"' && quoted && next === '"') {
            current += '"';
            index += 1;
            continue;
        }
        if (char === '"') {
            quoted = !quoted;
            continue;
        }
        if (char === ',' && !quoted) {
            row.push(current);
            current = '';
            continue;
        }
        if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && next === '\n') index += 1;
            row.push(current);
            if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
            row = [];
            current = '';
            continue;
        }
        current += char;
    }
    row.push(current);
    if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
    const [header = [], ...body] = rows;
    const keys = header.map((cell) => cell.trim());
    return body.map((cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index]?.trim() ?? ''])));
}

function inferSourceKind(path: string): ServiceRecordSourceKind {
    const lower = path.toLowerCase();
    if (lower.endsWith('.jsonl')) return 'vetios_jsonl';
    if (lower.includes('lab') && lower.endsWith('.csv')) return 'lab_csv';
    if (lower.endsWith('.csv')) return 'pims_csv';
    if (lower.includes('pacs') || lower.includes('imaging')) return 'pacs_json';
    return 'vetios_json';
}

function defaultSourceSystem(kind: ServiceRecordSourceKind): string {
    if (kind === 'lab_csv') return 'reference-lab';
    if (kind === 'pacs_json') return 'pacs';
    if (kind === 'pims_csv') return 'clinic-pims';
    return 'local-export';
}

function mapColumns(row: Record<string, string>, columns: Record<string, string> | undefined): Record<string, unknown> {
    if (!columns) return row;
    const mapped: Record<string, unknown> = { ...row };
    for (const [target, source] of Object.entries(columns)) {
        mapped[target] = row[source] ?? row[target];
    }
    return mapped;
}

function buildWindowsServiceTemplate(configPath: string): string {
    return `# VetIOS federation node runner template.
# Store VETIOS_MACHINE_TOKEN and VETIOS_NODE_SECRET in the host secret manager or session environment before running.
$ErrorActionPreference = "Stop"
vetios-federation-node service --config "${configPath}"
`;
}

function buildSystemdTemplate(configPath: string, nodeRef: string): string {
    return `[Unit]
Description=VetIOS Federation Node (${nodeRef})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=VETIOS_MACHINE_TOKEN=
Environment=VETIOS_NODE_SECRET=
ExecStart=/usr/bin/env vetios-federation-node service --config ${configPath}
Restart=always
RestartSec=15
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
`;
}

async function loadOrCreateNodeServiceState(path: string, nodeRef: string): Promise<NodeServiceState> {
    try {
        const existing = JSON.parse(await readFile(path, 'utf8')) as NodeServiceState;
        if (existing.schema === 'vetios_federation_node_service_state_v1' && existing.node_private_key_der_base64) {
            const normalized = normalizeNodeServiceState(existing, nodeRef);
            if (normalized !== existing) {
                await ensureParentDirectory(path);
                await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
            }
            return normalized;
        }
    } catch {
        // Create a fresh local key state below.
    }
    const state = createNodeServiceState({ nodeRef, keyVersion: 1 });
    await ensureParentDirectory(path);
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return state;
}

function createNodeServiceState(input: {
    nodeRef: string;
    keyVersion: number;
    createdAt?: string;
    previousNodePublicKeyFingerprint?: string | null;
    previousSigningKeyFingerprint?: string | null;
    rotatedAt?: string | null;
    rotationCount?: number;
}): NodeServiceState {
    const updatedAt = input.rotatedAt ?? new Date().toISOString();
    const keyPair = generateKeyPairSync('x25519');
    const privateDer = keyPair.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
    const publicDer = keyPair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    const signing = createSigningKeyFields(input.previousSigningKeyFingerprint ?? null);
    return {
        schema: 'vetios_federation_node_service_state_v1',
        node_ref: input.nodeRef,
        key_version: input.keyVersion,
        node_private_key_der_base64: privateDer.toString('base64'),
        node_public_key_der_base64: publicDer.toString('base64'),
        node_public_key_fingerprint: createHash('sha256').update(publicDer).digest('hex').slice(0, 32),
        previous_node_public_key_fingerprint: input.previousNodePublicKeyFingerprint ?? null,
        ...signing,
        rotated_at: input.rotatedAt ?? null,
        rotation_count: input.rotationCount ?? 0,
        created_at: input.createdAt ?? updatedAt,
        updated_at: updatedAt,
    };
}

function normalizeNodeServiceState(existing: NodeServiceState, nodeRef: string): NodeServiceState {
    if (
        existing.signing_private_key_der_base64
        && existing.signing_public_key_der_base64
        && existing.signing_key_fingerprint
    ) {
        return existing;
    }
    const signing = createSigningKeyFields(existing.previous_signing_key_fingerprint ?? null);
    return {
        ...existing,
        node_ref: existing.node_ref || nodeRef,
        ...signing,
        updated_at: new Date().toISOString(),
    };
}

function createSigningKeyFields(previousSigningKeyFingerprint?: string | null): Pick<
    NodeServiceState,
    'signing_private_key_der_base64'
    | 'signing_public_key_der_base64'
    | 'signing_key_fingerprint'
    | 'previous_signing_key_fingerprint'
> {
    const signingKeyPair = generateKeyPairSync('ed25519');
    const privateDer = signingKeyPair.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
    const publicDer = signingKeyPair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    return {
        signing_private_key_der_base64: privateDer.toString('base64'),
        signing_public_key_der_base64: publicDer.toString('base64'),
        signing_key_fingerprint: createHash('sha256').update(publicDer).digest('hex').slice(0, 32),
        previous_signing_key_fingerprint: previousSigningKeyFingerprint ?? null,
    };
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

function readFirstText(row: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return null;
}

function readFirstNumber(row: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim().length > 0) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return null;
}

function readDelimitedList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
    }
    if (typeof value === 'string') {
        return value.split(/[;|,]/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    }
    return [];
}

function readBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
        if (['false', 'no', 'n', '0'].includes(normalized)) return false;
    }
    return null;
}

function readConsentStatus(value: unknown): LocalClinicalLearningRecord['consent_status'] | null {
    return value === 'unknown'
        || value === 'granted'
        || value === 'denied'
        || value === 'revoked'
        || value === 'not_required'
        ? value
        : null;
}

function readProvenanceStatus(value: unknown): LocalClinicalLearningRecord['provenance_status'] | null {
    return value === 'not_verified'
        || value === 'source_attested'
        || value === 'hash_verified'
        || value === 'reviewer_verified'
        || value === 'externally_verified'
        ? value
        : null;
}

function parsePositiveInteger(value: string): number | undefined {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readConfiguredText(value: string | undefined | null): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function withRetryReport<T>(
    operation: () => Promise<T>,
    options: { attempts: number; baseMs: number },
): Promise<RetryObservation<T>> {
    let lastError: unknown;
    const transientErrors: string[] = [];
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
        try {
            return {
                value: await operation(),
                attempts: attempt,
                transient_errors: transientErrors,
            };
        } catch (error) {
            lastError = error;
            if (attempt === options.attempts) break;
            transientErrors.push(error instanceof Error ? error.message : 'unknown retryable failure');
            await sleep(options.baseMs * 2 ** (attempt - 1));
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Retry operation failed.');
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

Initialize a deployable clinic/lab node:
  vetios-federation-node init --tenant-id <tenant> --federation-key <key> --node-ref <node> --records exports/pims-cases.csv

Optional submit mode:
  vetios-federation-node --records records.json --task task.json --tenant-id <tenant> --secret <secret> --base-url <url> --machine-token <token> --submit

Service mode:
  vetios-federation-node service --config .vetios-node/<node>.config.json

Local doctor preflight:
  vetios-federation-node doctor --config .vetios-node/<node>.config.json

Rotate local node keys:
  vetios-federation-node rotate-keys --config .vetios-node/<node>.config.json --rotation-reason scheduled_rotation

Materialize a local multi-node secure aggregation proof:
  vetios-federation-node round-proof \
    --participants participants.json \
    --federation-key one_health_amr \
    --round-key one_health_amr:round:001 \
    --federation-round-id round-001 \
    --minimum-participants 3 \
    --minimum-required-rows 20 \
    --include-coordinator-recovery-key \
    --out round-proof.json

Environment fallbacks:
  VETIOS_TENANT_ID, VETIOS_FEDERATION_KEY, VETIOS_NODE_REF, VETIOS_PARTNER_REF,
  VETIOS_NODE_SECRET, VETIOS_BASE_URL, VETIOS_MACHINE_TOKEN
`);
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Federation node CLI failed'}\n`);
    process.exitCode = 1;
});
