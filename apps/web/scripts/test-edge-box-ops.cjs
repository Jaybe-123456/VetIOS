const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'lib', 'edgeBox', 'service.ts');

function writeGeneratedModule(generatedDir, relativePath, source) {
    const targetPath = path.join(generatedDir, 'node_modules', '@', relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, source, 'utf8');
}

function compileEdgeBoxService(generatedDir) {
    writeGeneratedModule(generatedDir, path.join('lib', 'db', 'schemaContracts.js'), `
exports.EDGE_BOXES = { TABLE: 'edge_boxes', COLUMNS: {
    id: 'id', tenant_id: 'tenant_id', node_name: 'node_name', site_label: 'site_label',
    hardware_class: 'hardware_class', status: 'status', software_version: 'software_version',
    last_heartbeat_at: 'last_heartbeat_at', last_sync_at: 'last_sync_at',
    metadata: 'metadata', created_by: 'created_by', created_at: 'created_at', updated_at: 'updated_at',
} };
exports.EDGE_SYNC_JOBS = { TABLE: 'edge_sync_jobs', COLUMNS: {
    id: 'id', tenant_id: 'tenant_id', edge_box_id: 'edge_box_id', job_type: 'job_type',
    direction: 'direction', status: 'status', payload: 'payload', scheduled_at: 'scheduled_at',
    started_at: 'started_at', completed_at: 'completed_at', error_message: 'error_message',
    created_by: 'created_by', created_at: 'created_at', updated_at: 'updated_at',
} };
exports.EDGE_SYNC_ARTIFACTS = { TABLE: 'edge_sync_artifacts', COLUMNS: {
    id: 'id', tenant_id: 'tenant_id', edge_box_id: 'edge_box_id', artifact_type: 'artifact_type',
    artifact_ref: 'artifact_ref', content_hash: 'content_hash', size_bytes: 'size_bytes',
    status: 'status', metadata: 'metadata', created_at: 'created_at', synced_at: 'synced_at',
    updated_at: 'updated_at',
} };
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'platform', 'publicTenant.js'), `
exports.resolvePublicCatalogTenant = async () => ({ tenantId: 'tenant_001', source: 'env' });
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'supabaseServer.js'), `
exports.getSupabaseServer = () => global.__edgeBoxTestClient;
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'outbox', 'outbox-service.js'), `
exports.createOutboxEvent = async function(params, client) {
    const now = new Date().toISOString();
    const row = {
        id: client.nextId(),
        tenant_id: params.metadata?.tenant_id || params.metadata?.tenantId || 'outbox_system',
        aggregate_type: params.aggregateType,
        aggregate_id: params.aggregateId,
        event_name: params.eventName,
        topic: params.eventName,
        handler_key: params.aggregateType,
        target_type: params.aggregateType === 'api_webhook' ? 'connector_webhook' : 'internal_task',
        target_ref: params.aggregateId,
        payload: params.payload || {},
        headers: {},
        metadata: params.metadata || {},
        status: 'pending',
        attempt_count: 0,
        max_attempts: params.maxAttempts || 5,
        available_at: now,
        created_at: now,
        updated_at: now,
    };
    client.tables.outbox_events.push(row);
    return row;
};
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'settings', 'controlPlane.js'), `
exports.recordControlPlaneAction = async function(input) {
    input.client.tables.control_plane_action_log.push({
        id: input.client.nextId(),
        tenant_id: input.tenantId,
        actor: input.actor,
        action_type: input.actionType,
        target_type: input.targetType,
        target_id: input.targetId,
        status: input.status,
        metadata: input.metadata || {},
        created_at: new Date().toISOString(),
    });
};
`);

    const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: sourcePath,
    });
    const outputPath = path.join(generatedDir, 'edge-box-service.cjs');
    fs.writeFileSync(outputPath, transpiled.outputText, 'utf8');
    delete require.cache[outputPath];
    return require(outputPath);
}

class FakeQuery {
    constructor(client, table) {
        this.client = client;
        this.table = table;
        this.filters = [];
        this.insertRows = null;
        this.updatePatch = null;
        this.singleMode = null;
        this.orderField = null;
        this.orderAscending = true;
        this.limitCount = null;
    }

    insert(rows) {
        this.insertRows = Array.isArray(rows) ? rows : [rows];
        return this;
    }

    upsert(row) {
        const tableRows = this.client.tables[this.table];
        const existingIndex = tableRows.findIndex((entry) =>
            entry.tenant_id === row.tenant_id && entry.node_name === row.node_name,
        );
        const next = {
            id: existingIndex >= 0 ? tableRows[existingIndex].id : this.client.nextId(),
            created_at: existingIndex >= 0 ? tableRows[existingIndex].created_at : new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...tableRows[existingIndex],
            ...row,
        };
        if (existingIndex >= 0) tableRows[existingIndex] = next;
        else tableRows.push(next);
        this.upserted = next;
        return this;
    }

    update(patch) {
        this.updatePatch = patch;
        return this;
    }

    select() {
        return this;
    }

    eq(field, value) {
        this.filters.push((row) => row[field] === value);
        return this;
    }

    lte(field, value) {
        this.filters.push((row) => String(row[field]) <= String(value));
        return this;
    }

    in(field, values) {
        this.filters.push((row) => values.includes(row[field]));
        return this;
    }

    or(expression) {
        const [eqPart, nullPart] = expression.split(',');
        const [eqField, _eqOperator, eqValue] = eqPart.split('.');
        const nullField = nullPart.split('.')[0];
        this.filters.push((row) => row[eqField] === eqValue || row[nullField] == null);
        return this;
    }

    order(field, options) {
        this.orderField = field;
        this.orderAscending = options?.ascending !== false;
        return this;
    }

    limit(value) {
        this.limitCount = value;
        return this;
    }

    single() {
        this.singleMode = 'single';
        return this._resolve();
    }

    maybeSingle() {
        this.singleMode = 'maybeSingle';
        return this._resolve();
    }

    then(resolve, reject) {
        return this._resolve().then(resolve, reject);
    }

    _rows() {
        let rows = [...this.client.tables[this.table]];
        for (const filter of this.filters) rows = rows.filter(filter);
        if (this.orderField) {
            const direction = this.orderAscending ? 1 : -1;
            rows.sort((left, right) => String(left[this.orderField]).localeCompare(String(right[this.orderField])) * direction);
        }
        if (typeof this.limitCount === 'number') rows = rows.slice(0, this.limitCount);
        return rows;
    }

    async _resolve() {
        if (this.upserted) {
            return { data: this.upserted, error: null };
        }
        if (this.insertRows) {
            const rows = this.insertRows.map((row) => ({
                id: this.client.nextId(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...row,
            }));
            this.client.tables[this.table].push(...rows);
            return { data: rows[0] ?? null, error: null };
        }
        if (this.updatePatch) {
            const rows = this._rows();
            for (const row of rows) {
                Object.assign(row, this.updatePatch, { updated_at: new Date().toISOString() });
            }
            if (this.singleMode) return { data: rows[0] ?? null, error: null };
            return { data: rows, error: null };
        }
        const rows = this._rows();
        if (this.singleMode) return { data: rows[0] ?? null, error: null };
        return { data: rows, error: null };
    }
}

class FakeSupabaseClient {
    constructor() {
        this._idCounter = 1;
        this.tables = {
            edge_boxes: [],
            edge_sync_jobs: [],
            edge_sync_artifacts: [],
            outbox_events: [],
            control_plane_action_log: [],
        };
    }

    nextId() {
        return `edge_test_${this._idCounter++}`;
    }

    from(table) {
        if (!this.tables[table]) this.tables[table] = [];
        return new FakeQuery(this, table);
    }
}

async function main() {
    const generatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetios-edge-box-'));
    try {
        const service = compileEdgeBoxService(generatedDir);
        const client = new FakeSupabaseClient();
        global.__edgeBoxTestClient = client;

        const provisioned = await service.createEdgeBox(client, {
            tenantId: 'tenant_001',
            actor: 'admin_001',
            nodeName: 'nairobi-edge-01',
            siteLabel: 'Nairobi Clinic',
            hardwareClass: 'x86_64-mini',
            softwareVersion: 'edge-1.0.0',
        });
        assert.ok(provisioned.provisioning_token.startsWith('vetios_edge_'), 'Provisioning should return a one-time edge token.');
        assert.equal(provisioned.edge_box.metadata.edge_auth_token_hash, undefined, 'Snapshots must not expose token hashes.');
        assert.equal(client.tables.edge_boxes[0].metadata.edge_auth_token_hash.length, 64, 'Token hash should be stored server-side.');

        const job = await service.queueEdgeSyncJob(client, {
            tenantId: 'tenant_001',
            actor: 'admin_001',
            edgeBoxId: provisioned.edge_box.id,
            jobType: 'config_sync',
            direction: 'cloud_to_edge',
            payload: { scope: 'full' },
        });
        assert.equal(job.status, 'queued', 'Sync job should start queued.');
        assert.ok(client.tables.outbox_events.some((row) => row.aggregate_type === 'edge_sync' && row.aggregate_id === job.id), 'Queueing a job should emit a durable edge_sync outbox event.');

        await assert.rejects(
            () => service.queueEdgeSyncJob(client, {
                tenantId: 'tenant_other',
                actor: 'admin_002',
                edgeBoxId: provisioned.edge_box.id,
                jobType: 'config_sync',
                direction: 'cloud_to_edge',
                payload: {},
            }),
            /Edge box not found/,
            'Tenant ownership must be enforced before queueing sync jobs.',
        );

        const artifact = await service.registerEdgeArtifact(client, {
            tenantId: 'tenant_001',
            actor: 'admin_001',
            edgeBoxId: provisioned.edge_box.id,
            artifactType: 'config_bundle',
            artifactRef: 'supabase://edge/config/nairobi-edge-01.json',
            contentHash: 'a'.repeat(64),
            sizeBytes: 512,
        });
        assert.equal(artifact.status, 'staged', 'Artifacts should start staged.');
        await assert.rejects(
            () => service.registerEdgeArtifact(client, {
                tenantId: 'tenant_001',
                artifactType: 'config_bundle',
                artifactRef: 'bad',
                contentHash: 'not-a-sha',
            }),
            /SHA-256/,
            'Artifact content hashes must be SHA-256 hex digests.',
        );

        const pulled = await service.pullEdgeSyncWork(client, {
            edgeBoxId: provisioned.edge_box.id,
            token: provisioned.provisioning_token,
            softwareVersion: 'edge-1.0.1',
        });
        assert.equal(pulled.jobs.length, 1, 'Authenticated edge nodes should pull queued work.');
        assert.equal(pulled.jobs[0].status, 'running', 'Pulled jobs should be returned as running leases.');
        assert.equal(pulled.artifacts.length, 1, 'Authenticated edge nodes should see staged artifacts.');
        assert.equal(client.tables.edge_sync_jobs[0].status, 'running', 'Pulling work should mark jobs running.');

        const ack = await service.acknowledgeEdgeSyncJob(client, {
            edgeBoxId: provisioned.edge_box.id,
            token: provisioned.provisioning_token,
            jobId: job.id,
            status: 'succeeded',
            syncedArtifactIds: [artifact.id],
        });
        assert.equal(ack.sync_job.status, 'succeeded', 'Edge ack should complete the job.');
        assert.equal(client.tables.edge_sync_artifacts[0].status, 'synced', 'Successful ack should mark reported artifacts synced.');
        assert.ok(client.tables.control_plane_action_log.length >= 4, 'Edge operations should be recorded in control-plane action log.');

        console.log('edge box ops tests passed');
    } finally {
        delete global.__edgeBoxTestClient;
        fs.rmSync(generatedDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
