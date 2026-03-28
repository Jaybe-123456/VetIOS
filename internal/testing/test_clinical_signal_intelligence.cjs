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

const { normalizeSingleSymptomToken } = require(path.join(appRoot, 'lib', 'clinicalCases', 'symptomOntology.ts'));
const {
    extractClinicalTermsFromText,
    getClinicalVocabularyStats,
} = require(path.join(appRoot, 'lib', 'clinicalSignal', 'clinicalVocabulary.ts'));
const { detectContradictions } = require(path.join(appRoot, 'lib', 'ai', 'contradictionEngine.ts'));
const {
    buildSignalWeightProfile,
} = require(path.join(appRoot, 'lib', 'clinicalSignal', 'signalWeightEngine.ts'));
const { runInferencePipeline } = require(path.join(appRoot, 'lib', 'ai', 'inferenceOrchestrator.ts'));

async function main() {
    process.env.VETIOS_DEV_BYPASS = 'true';
    process.env.VETIOS_LOCAL_REASONER = 'true';

    const vocabularyStats = getClinicalVocabularyStats();
    assert.ok(vocabularyStats.total_terms >= 100, 'Expected clinical vocabulary to include at least 100 normalized terms');

    assert.equal(normalizeSingleSymptomToken('drinking a lot'), 'polydipsia');
    assert.equal(normalizeSingleSymptomToken('trying to vomit but nothing came out'), 'retching_unproductive');
    assert.equal(normalizeSingleSymptomToken('belly swollen'), 'abdominal_distension');

    const contextTerms = extractClinicalTermsFromText('Intact female, recent heat cycle, vaginal discharge after boarding.');
    assert.ok(contextTerms.includes('intact_female'));
    assert.ok(contextTerms.includes('recent_estrus'));
    assert.ok(contextTerms.includes('vaginal_discharge'));
    assert.ok(contextTerms.includes('kennel_exposure'));

    const bradycardiaConflict = detectContradictions({
        species: 'dog',
        symptoms: ['bradycardia', 'dehydration'],
        metadata: { raw_note: 'Slow heart rate and dehydrated on exam.' },
    });
    assert.ok(bradycardiaConflict.contradiction_score >= 0.18);
    assert.ok(bradycardiaConflict.contradiction_reasons.some((reason) => reason.includes('bradycardia with dehydration')));

    const painConflict = detectContradictions({
        species: 'dog',
        symptoms: ['abdominal distension'],
        metadata: { raw_note: 'Marked abdominal distension but no pain behavior noted.' },
    });
    assert.ok(painConflict.contradiction_reasons.some((reason) => reason.includes('pain behavior')));

    const urinaryConflict = detectContradictions({
        species: 'cat',
        symptoms: ['straining to pee', 'only dribbles urine'],
        urination_status: 'normal',
        metadata: { raw_note: 'Male cat seems blocked but owner reports normal urination.' },
    });
    assert.ok(urinaryConflict.contradiction_score >= 0.28);
    assert.ok(urinaryConflict.contradiction_reasons.some((reason) => reason.includes('normal urination')));

    const respiratoryConflict = detectContradictions({
        species: 'dog',
        symptoms: ['respiratory distress', 'cyanosis'],
        respiratory_effort: 'normal',
        metadata: { raw_note: 'Reported normal breathing effort despite severe respiratory distress.' },
    });
    assert.ok(respiratoryConflict.contradiction_score >= 0.24);
    assert.ok(respiratoryConflict.contradiction_reasons.some((reason) => reason.includes('normal respiratory effort')));

    const signalWeightProfile = buildSignalWeightProfile({
        species: 'dog',
        breed: 'Great Dane',
        symptoms: ['trying to vomit but nothing came out', 'belly swollen', 'collapse', 'pale gums'],
        metadata: {
            raw_note: 'Started suddenly after eating.',
            antigravity_signal: {
                derived_signals: {
                    exposure_risks: ['recent_meal'],
                    reproductive_relevance: ['not_reported'],
                },
                patient_history: { key_context: ['recent_meal'] },
                symptom_vector: ['non-productive retching', 'abdominal distension', 'collapse', 'pale mucous membranes'],
                contradiction_flags: ['none'],
            },
        },
    });
    assert.ok(signalWeightProfile.weighted_signals[0].category === 'red_flag');
    assert.ok(signalWeightProfile.emergency_overrides.some((label) => label.includes('non-productive retching')));
    assert.ok(signalWeightProfile.applied_overrides.includes('abdominal_mechanical_emergency_cluster'));

    const pipelineResult = await runInferencePipeline({
        model: 'gpt-4o-mini',
        rawInput: {
            species: 'dog',
            symptoms: ['bradycardia', 'dehydration', 'trying to vomit but nothing came out', 'belly swollen'],
            history: 'Started suddenly after eating and the owner says activity is normal.',
            activity_status: 'normal',
        },
        inputMode: 'json',
    });

    assert.ok(pipelineResult.output_payload.signal_weight_profile, 'Expected signal weight profile to be attached to the inference payload');
    assert.ok(Array.isArray(pipelineResult.output_payload.priority_signals), 'Expected priority signals array on inference payload');
    assert.ok(
        Array.isArray(pipelineResult.output_payload.contradiction_analysis.contradiction_details),
        'Expected structured contradiction details on inference payload',
    );
    assert.ok(
        pipelineResult.output_payload.contradiction_analysis.matched_rule_ids.length > 0,
        'Expected contradiction rule identifiers in inference payload',
    );

    console.log('Clinical signal intelligence tests passed.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
