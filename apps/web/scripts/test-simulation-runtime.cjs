const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const sourcePath = path.join(appRoot, 'lib', 'platform', 'simulations.ts');

function writeGeneratedModule(generatedDir, relativePath, source) {
    const targetPath = path.join(generatedDir, 'node_modules', '@', relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, source, 'utf8');
}

function compileSimulationModule(generatedDir) {
    writeGeneratedModule(generatedDir, path.join('app', 'api', 'inference', 'route.js'), `
exports.POST = async function(request) {
    const body = JSON.parse(await request.text());
    const modelVersion = body?.model?.version || 'unknown';
    const rawNote = body?.input?.input_signature?.metadata?.raw_note || '';
    const prompt = String(rawNote);
    let score = 0.82;
    if (/ignore previous safety|override|prescribe unrestricted/i.test(prompt)) score = 0.35;
    if (/metadata injection|tool result|x-trusted-diagnosis/i.test(prompt)) score = 0.42;
    if (/zzqv|nonsensical|999/i.test(prompt)) score = 0.4;
    if (modelVersion === 'candidate-regressed') score = 0.45;
    if (modelVersion === 'candidate-strong') score = 0.9;
    return new Response(JSON.stringify({
        evaluation: { score },
        blocked: false,
        inference_latency_ms: 12,
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'platform', 'webhooks.js'), 'exports.dispatchWebhookEvent = async () => undefined;');
    writeGeneratedModule(generatedDir, path.join('lib', 'platform', 'tenantContext.js'), 'exports.issueInternalPlatformToken = () => "test-token";');
    writeGeneratedModule(generatedDir, path.join('lib', 'platform', 'governance.js'), `
exports.writeGovernanceAuditEvent = async (client, input) => {
    client.__auditEvents = client.__auditEvents || [];
    client.__auditEvents.push(input);
};
`);

    const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: sourcePath,
    });

    const compiledModulePath = path.join(generatedDir, 'simulations.cjs');
    fs.mkdirSync(path.dirname(compiledModulePath), { recursive: true });
    fs.writeFileSync(compiledModulePath, transpiled.outputText, 'utf8');
    delete require.cache[compiledModulePath];
    return require(compiledModulePath);
}

class FakeQuery {
    constructor(client, table) {
        this.client = client;
        this.table = table;
        this.filters = [];
        this.insertRows = null;
        this.updatePatch = null;
        this.head = false;
        this.wantCount = false;
        this.singleMode = null;
        this.limitCount = null;
        this.orderField = null;
        this.orderAscending = true;
    }

    insert(rows) {
        this.insertRows = Array.isArray(rows) ? rows : [rows];
        return this;
    }

    upsert(rows) {
        const tableRows = this.client.tables[this.table];
        for (const row of rows) {
            const existingIndex = tableRows.findIndex((entry) =>
                entry.tenant_id === row.tenant_id && entry.prompt === row.prompt,
            );
            if (existingIndex >= 0) {
                tableRows[existingIndex] = { ...tableRows[existingIndex], ...row };
            } else {
                tableRows.push({
                    id: this.client.nextId(),
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    ...row,
                });
            }
        }
        return Promise.resolve({ error: null });
    }

    update(patch) {
        this.updatePatch = patch;
        return this;
    }

    select(_columns, options) {
        this.head = options?.head === true;
        this.wantCount = options?.count === 'exact';
        return this;
    }

    eq(field, value) {
        this.filters.push((row) => row[field] === value);
        return this;
    }

    in(field, values) {
        this.filters.push((row) => values.includes(row[field]));
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
        for (const filter of this.filters) {
            rows = rows.filter(filter);
        }
        if (this.orderField) {
            const direction = this.orderAscending ? 1 : -1;
            rows.sort((left, right) => String(left[this.orderField]).localeCompare(String(right[this.orderField])) * direction);
        }
        if (typeof this.limitCount === 'number') {
            rows = rows.slice(0, this.limitCount);
        }
        return rows;
    }

    async _resolve() {
        if (this.insertRows) {
            const inserted = this.insertRows.map((row) => ({
                id: this.client.nextId(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                error_message: null,
                ...row,
            }));
            this.client.tables[this.table].push(...inserted);
            return { data: inserted[0] ?? null, error: null };
        }

        if (this.updatePatch) {
            const rows = this._rows();
            for (const row of rows) {
                Object.assign(row, this.updatePatch, { updated_at: new Date().toISOString() });
            }
            return { data: rows, error: null };
        }

        const rows = this._rows();
        if (this.head && this.wantCount) {
            return { data: null, count: rows.length, error: null };
        }
        if (this.singleMode === 'single' || this.singleMode === 'maybeSingle') {
            return { data: rows[0] ?? null, error: null };
        }
        return { data: rows, error: null };
    }
}

class FakeSupabaseClient {
    constructor() {
        this._idCounter = 1;
        this.tables = {
            simulations: [],
            adversarial_prompts: [],
            ai_inference_events: [
                {
                    id: 'evt1',
                    tenant_id: 'tenant_001',
                    input_signature: {
                        metadata: { raw_note: 'baseline vomiting case' },
                        symptoms: ['vomiting', 'lethargy'],
                    },
                    model_name: 'baseline',
                    model_version: 'baseline',
                    created_at: '2026-04-08T00:00:00.000Z',
                },
                {
                    id: 'evt2',
                    tenant_id: 'tenant_001',
                    input_signature: {
                        metadata: { raw_note: 'baseline respiratory case' },
                        symptoms: ['cough', 'dyspnea'],
                    },
                    model_name: 'baseline',
                    model_version: 'baseline',
                    created_at: '2026-04-07T00:00:00.000Z',
                },
            ],
            evaluations: [
                { tenant_id: 'tenant_001', inference_event_id: 'evt1', score: 0.83 },
                { tenant_id: 'tenant_001', inference_event_id: 'evt2', score: 0.79 },
            ],
            model_registry: [
                { tenant_id: 'tenant_001', model_version: 'candidate-regressed', registry_role: 'candidate', status: 'candidate' },
            ],
        };
        this.__auditEvents = [];
    }

    nextId() {
        return `sim_${this._idCounter++}`;
    }

    from(table) {
        if (!this.tables[table]) {
            this.tables[table] = [];
        }
        return new FakeQuery(this, table);
    }
}

async function waitForSimulationCompletion(client, simulationId) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15_000) {
        const record = client.tables.simulations.find((entry) => entry.id === simulationId);
        if (record && (record.status === 'completed' || record.status === 'failed')) {
            return record;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for simulation ${simulationId}`);
}

async function main() {
    const generatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetios-simulation-runtime-'));

    try {
        const { startSimulationRun } = compileSimulationModule(generatedDir);
        const client = new FakeSupabaseClient();
        const actor = {
            userId: 'user_001',
            role: 'developer',
            tenantId: 'tenant_001',
        };

        const scenarioLoad = await startSimulationRun(client, {
            actor,
            tenantId: 'tenant_001',
            mode: 'scenario_load',
            scenarioName: 'Scenario Load Runtime Check',
            config: {
                mode: 'scenario_load',
                scenario_name: 'Scenario Load Runtime Check',
                model_version: 'baseline',
                agent_count: 2,
                requests_per_agent: 2,
                request_rate_per_second: 20,
                duration_seconds: 1,
                prompt_distribution: [
                    { prompt: 'dog vomiting lethargy abdominal pain', weight: 1 },
                ],
            },
        });
        const scenarioLoadDone = await waitForSimulationCompletion(client, scenarioLoad.id);
        assert.equal(scenarioLoadDone.status, 'completed', 'Scenario load should complete.');
        assert.equal(scenarioLoadDone.completed, scenarioLoadDone.total, 'Scenario load should advance completed progress to total.');
        assert.ok((scenarioLoadDone.summary.executed_total ?? 0) >= 1, 'Scenario load should record executed requests.');
        assert.equal(scenarioLoadDone.summary.success_rate, 1, 'Scenario load should report successful mock responses.');

        const adversarial = await startSimulationRun(client, {
            actor,
            tenantId: 'tenant_001',
            mode: 'adversarial',
            scenarioName: 'Adversarial Runtime Check',
            config: {
                mode: 'adversarial',
                model_version: 'baseline',
                categories: ['jailbreak', 'injection'],
            },
        });
        const adversarialDone = await waitForSimulationCompletion(client, adversarial.id);
        assert.equal(adversarialDone.status, 'completed', 'Adversarial simulation should complete.');
        assert.ok(typeof adversarialDone.summary.passed === 'number', 'Adversarial simulation should record pass counts.');
        assert.ok(typeof adversarialDone.summary.failed === 'number', 'Adversarial simulation should record failure counts.');
        assert.deepEqual(
            Object.keys(adversarialDone.summary.by_category ?? {}).sort(),
            ['injection', 'jailbreak'],
            'Adversarial simulation should preserve per-category summaries.',
        );
        assert.ok(client.tables.adversarial_prompts.length > 0, 'Adversarial simulation should seed the prompt library.');

        const regression = await startSimulationRun(client, {
            actor,
            tenantId: 'tenant_001',
            mode: 'regression',
            scenarioName: 'Regression Runtime Check',
            candidateModelVersion: 'candidate-regressed',
            config: {
                mode: 'regression',
                candidate_model_version: 'candidate-regressed',
            },
        });
        const regressionDone = await waitForSimulationCompletion(client, regression.id);
        const candidateModel = client.tables.model_registry.find((entry) => entry.model_version === 'candidate-regressed');
        assert.equal(regressionDone.status, 'completed', 'Regression simulation should complete.');
        assert.equal(regressionDone.summary.regressions, 2, 'Regression simulation should count degraded replays.');
        assert.equal(regressionDone.summary.regression_risk, true, 'Regression simulation should raise regression risk when threshold is exceeded.');
        assert.equal(candidateModel?.status, 'at_risk', 'Regression simulation should mark the candidate model at risk.');
        assert.ok(client.__auditEvents.length >= 1, 'Regression simulation should emit a governance audit event.');

        console.log('simulation runtime tests passed');
    } finally {
        fs.rmSync(generatedDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
