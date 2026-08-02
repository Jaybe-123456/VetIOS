#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { hashEvidenceNodeMapping, type EvidenceNodeMapping } from './index.js';
import { EvidenceNodeRuntime, type EvidenceNodeRuntimeConfig } from './runtime.js';

interface CliOptions {
    command: 'init' | 'doctor' | 'once' | 'service' | 'replay-dead-letter' | 'help';
    configPath: string;
    outDir: string;
    nodeId: string;
    contractId: string;
    siteId: string;
    labSiteId: string;
    remote: boolean;
    limit: number;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === 'help') {
        printUsage();
        return;
    }
    if (options.command === 'init') {
        const result = await initializeNode(options);
        writeOutput(result);
        return;
    }
    const runtime = await EvidenceNodeRuntime.load(options.configPath);
    if (options.command === 'doctor') {
        const report = await runtime.doctor({ probeRemote: options.remote });
        writeOutput(report);
        if (!report.ready) process.exitCode = 2;
        return;
    }
    if (options.command === 'once') {
        writeOutput(await runtime.runCycle());
        return;
    }
    if (options.command === 'replay-dead-letter') {
        writeOutput({ replayed_job_ids: await runtime.spool.replayDeadLetters(options.limit) });
        return;
    }
    const stop = async () => {
        await runtime.stop();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await runtime.startService((report) => writeOutput(report));
}

function parseArgs(args: string[]): CliOptions {
    const commandRaw = args[0] ?? 'help';
    const command = ['init', 'doctor', 'once', 'service', 'replay-dead-letter'].includes(commandRaw)
        ? commandRaw as CliOptions['command']
        : 'help';
    const value = (name: string, fallback = '') => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] ?? fallback : fallback;
    };
    return {
        command,
        configPath: value('--config', 'evidence-node.config.json'),
        outDir: value('--out-dir', '.vetios-evidence-node'),
        nodeId: value('--node-id', 'lab-evidence-node-001'),
        contractId: value('--contract-id'),
        siteId: value('--site-id'),
        labSiteId: value('--lab-site-id'),
        remote: args.includes('--remote'),
        limit: positiveInteger(value('--limit', '25'), 25),
    };
}

async function initializeNode(options: CliOptions) {
    const outDir = resolve(options.outDir);
    await mkdir(join(outDir, 'inbox'), { recursive: true });
    await mkdir(join(outDir, 'archive'), { recursive: true });
    await mkdir(join(outDir, 'certs'), { recursive: true });
    const contractId = requiredUuid(options.contractId, '--contract-id');
    const siteId = requiredUuid(options.siteId, '--site-id');
    const labSiteId = requiredUuid(options.labSiteId, '--lab-site-id');
    const safeNodeId = options.nodeId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
    const configName = `${safeNodeId}.config.json`;
    const mappingName = `${safeNodeId}.mapping.json`;
    const keyName = `${safeNodeId}.spool.key`;
    const referenceKeyName = `${safeNodeId}.reference.key`;
    const config: EvidenceNodeRuntimeConfig = {
        schema: 'vetios.evidence-node.config.v1',
        node_id: safeNodeId,
        connector_version: '0.0.1',
        mapping_path: mappingName,
        spool_directory: 'spool',
        spool_key_file: keyName,
        reference_key_id: `${safeNodeId}-references-v1`,
        reference_key_file: referenceKeyName,
        poll_interval_ms: 30_000,
        max_delivery_attempts: 6,
        vetios: {
            base_url: 'https://mtls.vetios.tech',
            client_id: 'REPLACE_WITH_CONTRACT_BOUND_OAUTH_CLIENT_ID',
            client_secret_env: 'VETIOS_EVIDENCE_NODE_CLIENT_SECRET',
            scopes: ['amr:read', 'amr:ingest'],
            tls: {
                pfx_path: 'certs/partner.pfx',
                pfx_passphrase_env: 'VETIOS_EVIDENCE_NODE_PFX_PASSPHRASE',
                servername: 'mtls.vetios.tech',
            },
        },
        sources: [{
            key: 'laboratory-file-drop',
            transport: 'file_drop',
            format: 'rfc4180_csv',
            inbox_path: 'inbox',
            archive_path: 'archive',
            filename_pattern: '\\.(csv)$',
        }],
    };
    const mapping: EvidenceNodeMapping = {
        schema: 'vetios.evidence-node.mapping.v1',
        adapter_key: `${safeNodeId}.lab-adapter.v1`,
        mapping_version: '1.0.0',
        contract_id: contractId,
        contract_version: '1.0.0',
        source_system: 'REPLACE_WITH_LIS_VENDOR_AND_PRODUCT',
        source_version: 'REPLACE_WITH_LIS_VERSION',
        defaults: {
            site_id: siteId,
            lab_site_id: labSiteId,
            country_code: 'KE',
            ast_method: 'REPLACE_WITH_LAB_AST_METHOD',
            interpretation_standard: 'REPLACE_WITH_LAB_STANDARD',
            interpretation_standard_version: 'REPLACE_WITH_STANDARD_VERSION',
            qc_status: 'not_reported',
            deidentified: true,
            is_synthetic: false,
        },
        fields: {
            accession_ref: 'accession_id',
            isolate_ref: 'isolate_id',
            patient_ref: 'patient_id',
            species: 'species',
            specimen_type: 'specimen_type',
            organism_label: 'organism',
            observed_at: 'observed_at',
            antimicrobial_label: 'antimicrobial',
            measurement_type: 'measurement_type',
            mic_value: 'mic_value',
            mic_operator: 'mic_operator',
            mic_unit: 'mic_unit',
            zone_diameter_mm: 'zone_diameter_mm',
            qualitative_result: 'qualitative_result',
            interpretation: 'interpretation',
        },
        code_maps: {
            interpretation: {
                susceptible: 'S',
                intermediate: 'I',
                resistant: 'R',
            },
        },
        csv: { delimiter: ',' },
    };
    const runner = process.platform === 'win32'
        ? `$env:VETIOS_EVIDENCE_NODE_CLIENT_SECRET='<secret-manager>'\n$env:VETIOS_EVIDENCE_NODE_PFX_PASSPHRASE='<secret-manager>'\nvetios-evidence-node service --config '${configName}'\n`
        : `#!/usr/bin/env sh\nexec vetios-evidence-node service --config './${configName}'\n`;
    await Promise.all([
        writePrivateJson(join(outDir, configName), config),
        writePrivateJson(join(outDir, mappingName), mapping),
        writeFile(join(outDir, keyName), `${randomBytes(32).toString('hex')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
        writeFile(join(outDir, referenceKeyName), `${randomBytes(32).toString('hex')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }),
        writeFile(join(outDir, process.platform === 'win32' ? `${safeNodeId}.run.ps1` : `${safeNodeId}.run.sh`), runner, { encoding: 'utf8', mode: 0o700 }),
    ]);
    return {
        initialized: true,
        node_id: safeNodeId,
        config_path: join(outDir, configName),
        mapping_path: join(outDir, mappingName),
        mapping_hash: hashEvidenceNodeMapping(mapping),
        spool_key_path: join(outDir, keyName),
        reference_key_path: join(outDir, referenceKeyName),
        reference_key_id: config.reference_key_id,
        enrollment_contract_id: contractId,
        privacy_boundary: 'Raw payloads never leave the source trust boundary; the spool is encrypted and the file-drop archive remains laboratory-controlled.',
        next: [
            'Review and approve the versioned mapping with the laboratory.',
            'Place the issued partner PFX under certs/; configure ca_path only when the server uses a private CA.',
            'Inject OAuth and PFX secrets with the host secret manager.',
            `Run vetios-evidence-node doctor --config ${configName} --remote.`,
        ],
    };
}

function requiredUuid(value: string, name: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error(`${name} must be a UUID.`);
    }
    return value;
}

function positiveInteger(value: string, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function writePrivateJson(path: string, value: unknown) {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

function writeOutput(value: unknown) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printUsage() {
    const command = basename(process.argv[1] ?? 'vetios-evidence-node');
    process.stdout.write(`VetIOS Evidence Node\n\n`);
    process.stdout.write(`  ${command} init --out-dir <dir> --node-id <id> --contract-id <uuid> --site-id <uuid> --lab-site-id <uuid>\n`);
    process.stdout.write(`  ${command} doctor --config <path> [--remote]\n`);
    process.stdout.write(`  ${command} once --config <path>\n`);
    process.stdout.write(`  ${command} service --config <path>\n`);
    process.stdout.write(`  ${command} replay-dead-letter --config <path> [--limit 25]\n`);
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
