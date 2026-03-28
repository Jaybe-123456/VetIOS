const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(repoRoot, 'apps', 'web');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
        request = path.join(appRoot, request.slice(2));
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};

for (const extension of ['.ts', '.tsx']) {
    require.extensions[extension] = function compileTypeScript(module, filename) {
        const source = fs.readFileSync(filename, 'utf8');
        const { outputText } = ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                jsx: ts.JsxEmit.ReactJSX,
                esModuleInterop: true,
                resolveJsonModule: true,
            },
            fileName: filename,
        });
        module._compile(outputText, filename);
    };
}

const { runInferencePipeline } = require(path.join(appRoot, 'lib', 'ai', 'inferenceOrchestrator.ts'));

function getDifferentials(result) {
    const diagnosis = result.output_payload.diagnosis ?? {};
    return Array.isArray(diagnosis.top_differentials) ? diagnosis.top_differentials : [];
}

function getRank(result, targetName) {
    const normalized = targetName.toLowerCase();
    const index = getDifferentials(result).findIndex((entry) => String(entry.name ?? '').toLowerCase() === normalized);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function topName(result) {
    return String(getDifferentials(result)[0]?.name ?? '');
}

async function main() {
    process.env.VETIOS_DEV_BYPASS = 'true';
    process.env.VETIOS_LOCAL_REASONER = 'true';

    const cushingBaseline = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            breed: 'Miniature Poodle',
            age: '10 years',
            duration_days: 120,
            symptoms: [
                'polyuria',
                'polydipsia',
                'polyphagia',
                'panting',
                'hair thinning',
                'pot-bellied appearance',
            ],
            history: 'Chronic gradual onset over months with progressive panting and a pot-bellied appearance.',
            lab_results: [
                {
                    text: 'ALP 1180 U/L. Cholesterol 410 mg/dL. ACTH stimulation test supportive for hyperadrenocorticism. USG 1.010. Urine glucose negative.',
                },
            ],
            glucosuria: false,
        },
        inputMode: 'json',
    });
    assert.equal(topName(cushingBaseline), 'Hyperadrenocorticism', 'Cushing baseline should rank Hyperadrenocorticism first');
    assert.ok(
        getRank(cushingBaseline, 'Hyperadrenocorticism') < getRank(cushingBaseline, 'Diabetes Mellitus'),
        'Cushing baseline should outrank Diabetes Mellitus',
    );

    const diabetesBaseline = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            breed: 'Mixed Breed',
            age: '8 years',
            duration_days: 30,
            symptoms: [
                'polyuria',
                'polydipsia',
                'polyphagia',
                'weight loss',
                'lethargy',
            ],
            history: 'Increased thirst and urination with weight loss.',
            lab_results: [
                {
                    text: 'Blood glucose 412 mg/dL. Glucosuria present. Ketonuria present. Compatible diabetic metabolic profile.',
                },
            ],
            glucosuria: true,
            ketonuria: true,
        },
        inputMode: 'json',
    });
    assert.equal(topName(diabetesBaseline), 'Diabetes Mellitus', 'Diabetes baseline should rank Diabetes Mellitus first');
    assert.ok(
        getRank(diabetesBaseline, 'Diabetes Mellitus') < getRank(diabetesBaseline, 'Hyperadrenocorticism'),
        'Diabetes baseline should outrank Hyperadrenocorticism',
    );

    const mildHyperglycemiaConfuser = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            breed: 'Terrier Mix',
            age: '11 years',
            duration_days: 150,
            symptoms: [
                'polyuria',
                'polydipsia',
                'polyphagia',
                'panting',
                'alopecia',
                'pot-bellied appearance',
            ],
            history: 'Gradual onset over several months with chronic body shape change.',
            lab_results: [
                {
                    text: 'Glucose 168 mg/dL. ALP 960 U/L. Cholesterol 365 mg/dL. USG 1.012. Urine glucose negative.',
                },
            ],
            glucosuria: false,
        },
        inputMode: 'json',
    });
    assert.equal(topName(mildHyperglycemiaConfuser), 'Hyperadrenocorticism', 'Mild hyperglycemia without glucosuria should not let Diabetes Mellitus dominate');
    assert.ok(
        getRank(mildHyperglycemiaConfuser, 'Hyperadrenocorticism') < getRank(mildHyperglycemiaConfuser, 'Diabetes Mellitus'),
        'Negative urine glucose evidence should keep Hyperadrenocorticism ahead of Diabetes Mellitus',
    );
    assert.ok(
        (mildHyperglycemiaConfuser.output_payload.contradiction_analysis?.matched_rule_ids ?? []).includes('mild_hyperglycemia_without_glucosuria'),
        'Mild hyperglycemia without glucosuria should be surfaced as an exclusion-style contradiction signal',
    );

    console.log('Endocrine differential regression suite passed.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
