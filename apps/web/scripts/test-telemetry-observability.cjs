const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'lib', 'telemetry', 'observability.ts');
const generatedDir = path.join(appRoot, '.generated-tests');
const generatedPath = path.join(generatedDir, 'observability.cjs');
const telemetryPagePath = path.join(appRoot, 'app', 'telemetry', 'page.tsx');
const inferenceRoutePath = path.join(appRoot, 'app', 'api', 'inference', 'route.ts');
const outcomeRoutePath = path.join(appRoot, 'app', 'api', 'outcome', 'route.ts');

function compileModule() {
    fs.mkdirSync(generatedDir, { recursive: true });
    const source = fs.readFileSync(sourcePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: sourcePath,
    });
    fs.writeFileSync(generatedPath, transpiled.outputText, 'utf8');
    delete require.cache[generatedPath];
    return require(generatedPath);
}

function cleanupGeneratedArtifacts() {
    fs.rmSync(generatedDir, { recursive: true, force: true });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertClose(actual, expected, message) {
    assert(Math.abs(actual - expected) < 0.0001, `${message} Expected ${expected}, got ${actual}`);
}

function main() {
    const mod = compileModule();

    const evaluationRows = [
        {
            prediction: 'GDV',
            ground_truth: 'GDV',
            prediction_correct: true,
            prediction_confidence: 0.93,
            evaluation_payload: { top3_labels: ['GDV', 'Pancreatitis', 'Peritonitis'], abstain: false },
        },
        {
            prediction: 'Pancreatitis',
            ground_truth: 'GDV',
            prediction_correct: false,
            prediction_confidence: 0.82,
            evaluation_payload: { top3_labels: ['Pancreatitis', 'GDV', 'Gastroenteritis'], abstain: false },
        },
        {
            prediction: 'Gastroenteritis',
            ground_truth: 'Pancreatitis',
            prediction_correct: false,
            prediction_confidence: 0.88,
            evaluation_payload: { top3_labels: ['Gastroenteritis', 'Foreign Body Obstruction', 'Toxicity'], abstain: false },
        },
        {
            prediction: 'Peritonitis',
            ground_truth: 'Peritonitis',
            prediction_correct: true,
            prediction_confidence: 0.74,
            evaluation_payload: { top3_labels: ['Peritonitis', 'Pancreatitis', 'Pyometra'], abstain: true },
        },
    ];

    const aggregate = mod.buildRollingAccuracyAggregate('tenant_a', 'diag_v2', evaluationRows, '2026-03-31T12:00:00.000Z');
    assertClose(aggregate.top1_accuracy, 0.5, 'Rolling top-1 accuracy mismatch.');
    assertClose(aggregate.top3_accuracy, 0.75, 'Rolling top-3 accuracy mismatch.');
    assertClose(aggregate.calibration_gap, 0.3425, 'Calibration gap mismatch.');
    assertClose(aggregate.abstention_rate, 0.25, 'Abstention rate mismatch.');
    assertClose(aggregate.overconfidence_rate, 0.5, 'Overconfidence rate mismatch.');

    const diseaseRows = mod.buildDiseasePerformanceRows('tenant_a', evaluationRows, '2026-03-31T12:00:00.000Z');
    const gdv = diseaseRows.find((row) => row.disease_name === 'GDV');
    assert(gdv, 'Expected GDV disease performance row.');
    assertClose(gdv.recall, 0.5, 'GDV recall mismatch.');
    assertClose(gdv.top3_recall, 1, 'GDV top-3 recall mismatch.');

    const nearMiss = mod.buildOutcomeFailureEvent({
        tenantId: 'tenant_a',
        inferenceEventId: 'inf_1',
        outcomeEventId: 'out_1',
        evaluationEventId: 'eval_1',
        modelVersion: 'diag_v2',
        observedAt: '2026-03-31T12:00:00.000Z',
        prediction: 'Pancreatitis',
        actual: 'GDV',
        confidence: 0.83,
        contradictionScore: 0.2,
        outputPayload: {
            diagnosis: {
                top_differentials: [
                    { name: 'Pancreatitis' },
                    { name: 'GDV' },
                    { name: 'Gastroenteritis' },
                ],
            },
            diagnosis_feature_importance: { abdominal_distension: 0.9 },
            severity_feature_importance: { collapse: 0.7 },
        },
        actualOutcome: { emergency_level: 'CRITICAL' },
    });
    assert(nearMiss.error_type === 'near_miss', 'Expected near-miss failure classification.');
    assert(nearMiss.actual_in_top3 === true, 'Near miss should record actual_in_top3=true.');
    assert(nearMiss.failure_classification === 'feature_weighting_error', 'Near miss should classify as feature weighting error.');

    const abstention = mod.buildAbstentionFailureEvent({
        tenantId: 'tenant_a',
        inferenceEventId: 'inf_2',
        modelVersion: 'diag_v2',
        observedAt: '2026-03-31T12:01:00.000Z',
        outputPayload: {
            abstain_recommendation: true,
            abstain_reason: 'contradiction threshold exceeded',
            diagnosis: {
                top_differentials: [{ name: 'Rabies' }, { name: 'Distemper' }],
            },
        },
        confidenceScore: 0.41,
        contradictionScore: 0.81,
    });
    assert(abstention.error_type === 'abstention_trigger', 'Expected abstention trigger event.');
    assert(abstention.abstained === true, 'Abstention flag should be true.');

    const top3 = mod.resolveTopKLabels({
        diagnosis: {
            top_differentials: [{ name: 'Rabies' }, { name: 'Distemper' }, { name: 'Tetanus' }],
        },
    }, 3);
    assert(top3.join(',') === 'Rabies,Distemper,Tetanus', 'Top-3 label extraction failed.');

    const pageSource = fs.readFileSync(telemetryPagePath, 'utf8');
    assert(pageSource.includes('Rolling Top-1'), 'Telemetry page is missing rolling top-1 metric.');
    assert(pageSource.includes('Failure Telemetry'), 'Telemetry page is missing failure telemetry panel.');
    assert(pageSource.includes('Disease Performance'), 'Telemetry page is missing disease performance panel.');
    assert(fs.readFileSync(inferenceRoutePath, 'utf8').includes('recordInferenceObservability'), 'Inference route is missing observability hook.');
    assert(fs.readFileSync(outcomeRoutePath, 'utf8').includes('recordOutcomeObservability'), 'Outcome route is missing observability hook.');

    console.log('[PASS] telemetry observability rolling metrics, failure classification, and dashboard hooks verified');
}

try {
    main();
} finally {
    cleanupGeneratedArtifacts();
}
