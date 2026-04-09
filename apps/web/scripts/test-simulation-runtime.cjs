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
    writeGeneratedModule(generatedDir, path.join('lib', 'platform', 'alerts.js'), `
exports.createPlatformAlert = async function(client, input) {
    client.__alerts = client.__alerts || [];
    client.__alerts.push(input);
};
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'platform', 'eventBus.js'), `
exports.publishSimulationSignal = function() {
    return undefined;
};
exports.subscribeSimulationSignal = function() {
    return () => undefined;
};
exports.publishPlatformTelemetry = function() {
    return undefined;
};
exports.subscribePlatformTelemetry = function() {
    return () => undefined;
};
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'platform', 'telemetry.js'), `
exports.recordPlatformTelemetry = async function(client, input) {
    client.tables.platform_telemetry.push({
        id: client.nextId(),
        created_at: new Date().toISOString(),
        ...input,
    });
};
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'platform', 'tenantContext.js'), `
exports.issueInternalPlatformToken = () => {
    if (!process.env.VETIOS_JWT_SECRET) {
        throw new Error('VETIOS_JWT_SECRET is required to issue internal platform tokens.');
    }
    return 'test-token';
};
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'ai', 'inferenceOrchestrator.js'), `
exports.runInferencePipeline = async function(input) {
    const rawInput = input?.rawInput?.input_signature || {};
    const note = String(rawInput?.metadata?.raw_note || '');
    const contradiction = /zzqv|nonsensical|999/i.test(note) ? 0.3 : 0.05;
    const confidence = input.model === 'candidate-regressed' ? 0.45 : input.model === 'candidate-strong' ? 0.9 : 0.78;
    return {
        output_payload: {
            diagnosis: {
                confidence_score: confidence,
                top_differentials: [{ name: 'Simulated Differential', probability: confidence }],
            },
            abstain_recommendation: contradiction > 0.25,
            competitive_differential: contradiction > 0.2,
            differential_spread: { spread: contradiction > 0.25 ? 0.03 : 0.2 },
            telemetry: {},
        },
        confidence_score: confidence,
        contradiction_analysis: {
            contradiction_score: contradiction,
        },
        uncertainty_metrics: {},
    };
};
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'logging', 'inferenceLogger.js'), `
exports.logInference = async function(client, input) {
    client.tables.ai_inference_events.push({
        id: input.id,
        tenant_id: input.tenant_id,
        input_signature: input.input_signature,
        model_name: input.model_name,
        model_version: input.model_version,
        created_at: new Date().toISOString(),
    });
    return input.id;
};
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'platform', 'flywheel.js'), `
exports.runInferenceFlywheel = async function(_client, input) {
    const score = input.modelVersion === 'candidate-regressed' ? 0.45 : input.modelVersion === 'candidate-strong' ? 0.9 : 0.82;
    return {
        outcome: { id: 'outcome_' + input.inferenceEventId, status: 'scored' },
        evaluation: { id: 'evaluation_' + input.inferenceEventId, score, dataset_version: 1 },
    };
};
`);
    writeGeneratedModule(generatedDir, path.join('lib', 'platform', 'governance.js'), `
exports.writeGovernanceAuditEvent = async (client, input) => {
    client.__auditEvents = client.__auditEvents || [];
    client.__auditEvents.push(input);
};
exports.evaluateGovernancePolicyForInference = async (_client, input) => {
    const note = String(input?.requestBody?.input?.input_signature?.metadata?.raw_note || '');
    const flagged = /ignore previous|override|drop table|x-trusted-diagnosis|dan|system prompt|template_injection/i.test(note);
    const blocked = /maximum lethal dose|euthanize a cat at home/i.test(note);
    return {
        decision: blocked ? 'block' : 'allow',
        policyId: null,
        reason: blocked ? 'unsafe_prompt' : (flagged ? 'adversarial_pattern' : null),
        tokenCount: 0,
        flagged,
    };
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
            if (this.singleMode === 'single' || this.singleMode === 'maybeSingle') {
                return { data: rows[0] ?? null, error: null };
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
            simulation_events: [],
            adversarial_prompts: [],
            regression_replays: [],
            platform_telemetry: [],
            ai_inference_events: [
                {
                    id: 'evt1',
                    tenant_id: 'tenant_001',
                    status: 'completed',
                    input_signature: {
                        species: 'canine',
                        breed: 'Mixed Breed',
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
                    status: 'completed',
                    input_signature: {
                        species: 'canine',
                        breed: 'Mixed Breed',
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
                {
                    registry_id: 'reg_baseline',
                    tenant_id: 'tenant_001',
                    run_id: 'run_baseline',
                    model_name: 'Baseline Champion',
                    model_version: 'baseline',
                    model_family: 'diagnostics',
                    lifecycle_status: 'production',
                    registry_role: 'champion',
                    status: 'production',
                    role: 'champion',
                    blocked: false,
                    created_at: '2026-04-01T00:00:00.000Z',
                    updated_at: '2026-04-08T00:00:00.000Z',
                },
                {
                    registry_id: 'reg_candidate',
                    tenant_id: 'tenant_001',
                    run_id: 'run_candidate',
                    model_name: 'Candidate Regressed',
                    model_version: 'candidate-regressed',
                    model_family: 'diagnostics',
                    lifecycle_status: 'candidate',
                    registry_role: 'challenger',
                    status: 'candidate',
                    role: 'challenger',
                    blocked: false,
                    created_at: '2026-04-02T00:00:00.000Z',
                    updated_at: '2026-04-08T00:00:00.000Z',
                },
            ],
        };
        this.__auditEvents = [];
        this.__alerts = [];
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
        if (record && (record.status === 'complete' || record.status === 'completed' || record.status === 'failed' || record.status === 'blocked')) {
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
            mode: 'load',
            scenarioName: 'Scenario Load Runtime Check',
            config: {
                mode: 'load',
                scenario_name: 'Scenario Load Runtime Check',
                model_version: 'baseline',
                agent_count: 2,
                requests_per_agent: 2,
                request_rate_per_second: 20,
                duration_seconds: 10,
                prompt_distribution: {
                    canine: 100,
                    feline: 0,
                    equine: 0,
                    other: 0,
                },
            },
        });
        const scenarioLoadDone = await waitForSimulationCompletion(client, scenarioLoad.id);
        assert.equal(scenarioLoadDone.status, 'complete', 'Scenario load should complete.');
        assert.equal(scenarioLoadDone.completed, scenarioLoadDone.total, 'Scenario load should advance completed progress to total.');
        assert.ok((scenarioLoadDone.summary.total_requests ?? 0) >= 1, 'Scenario load should record executed requests.');
        assert.equal(scenarioLoadDone.summary.success_rate, 100, 'Scenario load should report successful mock responses.');
        assert.ok(client.tables.platform_telemetry.length >= scenarioLoadDone.total, 'Scenario load should emit simulation telemetry records.');
        assert.ok(client.tables.simulation_events.some((entry) => entry.simulation_id === scenarioLoad.id && entry.event_type === 'request_complete'), 'Scenario load should persist request_complete events.');

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
        assert.ok(['complete', 'failed'].includes(adversarialDone.status), 'Adversarial simulation should finish with a terminal status.');
        assert.ok(typeof adversarialDone.summary.passed === 'number', 'Adversarial simulation should record pass counts.');
        assert.ok(typeof adversarialDone.summary.failed === 'number', 'Adversarial simulation should record failure counts.');
        assert.deepEqual(
            adversarialDone.summary.categories.map((entry) => entry.category).sort(),
            ['injection', 'jailbreak'],
            'Adversarial simulation should preserve per-category summaries.',
        );
        assert.ok(client.tables.adversarial_prompts.length > 0, 'Adversarial simulation should seed the prompt library.');
        assert.ok(client.__auditEvents.some((entry) => entry.eventType === 'adversarial_suite_results'), 'Adversarial simulation should emit a separate adversarial audit event.');

        const regression = await startSimulationRun(client, {
            actor,
            tenantId: 'tenant_001',
            mode: 'regression',
            scenarioName: 'Regression Runtime Check',
            candidateModelVersion: 'candidate-regressed',
            config: {
                mode: 'regression',
                baseline_model: 'baseline',
                candidate_model_version: 'candidate-regressed',
                candidate_model: 'candidate-regressed',
                replay_n: 2,
                threshold_pct: 10,
                auto_block: true,
            },
        });
        const regressionDone = await waitForSimulationCompletion(client, regression.id);
        const candidateModel = client.tables.model_registry.find((entry) => entry.model_version === 'candidate-regressed');
        assert.equal(regressionDone.status, 'blocked', 'Regression simulation should block when the candidate regresses past threshold.');
        assert.equal(regressionDone.summary.regression_count, 2, 'Regression simulation should count degraded replays.');
        assert.equal(regressionDone.summary.blocked, true, 'Regression simulation should record blocked status in results.');
        assert.equal(candidateModel?.blocked, true, 'Regression simulation should block the candidate model in model_registry.');
        assert.equal(candidateModel?.block_reason, 'Regression simulation', 'Regression simulation should record the block reason.');
        assert.ok(client.__auditEvents.length >= 1, 'Regression simulation should emit a governance audit event.');
        assert.ok(client.__alerts.some((entry) => entry.type === 'model_blocked'), 'Regression simulation should raise a model_blocked alert.');

        console.log('simulation runtime tests passed');
    } finally {
        fs.rmSync(generatedDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
