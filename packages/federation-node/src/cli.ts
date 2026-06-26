#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import {
    buildTrainedMaskedUpdateCommitment,
    trainLocalFederatedTask,
    toFederatedUpdateSubmissionPayload,
    VetiosFederationNodeClient,
    type FederationRoundTask,
    type LocalClinicalLearningRecord,
} from './index.js';

interface CliOptions {
    recordsPath?: string;
    taskPath?: string;
    outputPath?: string;
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

async function main() {
    const options = parseArgs(process.argv.slice(2));
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
    const options: CliOptions = { submit: false };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--submit') {
            options.submit = true;
            continue;
        }
        const value = args[index + 1];
        if (!value) continue;
        if (arg === '--records') options.recordsPath = value;
        if (arg === '--task') options.taskPath = value;
        if (arg === '--out') options.outputPath = value;
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

async function readJson<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, 'utf8')) as T;
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
