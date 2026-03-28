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

const {
    buildFailureCorrectionFeatureVector,
    generateFailureCorrectionReport,
} = require(path.join(appRoot, 'lib', 'learning', 'failureCorrectionEngine.ts'));
const { logModelImprovementAudit } = require(path.join(appRoot, 'lib', 'learning', 'modelImprover.ts'));

async function main() {
    const report = generateFailureCorrectionReport({
        case_input: {
            species: 'dog',
            symptoms: ['vomiting', 'diarrhea', 'lethargy', 'dehydration', 'bradycardia'],
            history: 'Episodes come and go for months and improved with IV fluids during a previous hospitalization.',
            metadata: {
                raw_note: 'Slow heart rate, dehydrated, weak, and vomiting again.',
            },
        },
        predicted_condition: 'Acute Gastroenteritis',
        target_condition: 'Hypoadrenocorticism',
        predicted_condition_class: 'Inflammatory',
        target_condition_class: 'Metabolic / Endocrine',
        diagnosis_feature_importance: {
            vomiting: 0.82,
            diarrhea: 0.79,
            lethargy: 0.64,
            dehydration: 0.48,
        },
    });

    assert.equal(report.pattern_differentiation.target_pattern.family, 'endocrine_metabolic_crisis');
    assert.ok(
        report.failure_diagnosis_summary.missing_or_underweighted_signals.some((entry) => entry.includes('bradycardia')),
        'Expected bradycardia to be surfaced as underweighted',
    );
    assert.ok(
        report.failure_diagnosis_summary.overweighted_generic_signals.some((entry) => entry.includes('vomiting')),
        'Expected vomiting to remain identified as an overweighted generic signal',
    );
    assert.ok(
        report.failure_diagnosis_summary.ignored_contradictions.some((entry) => entry.includes('bradycardia') && entry.includes('dehydration')),
        'Expected hemodynamic mismatch contradiction to be generated',
    );
    assert.ok(
        report.temporal_pattern_rules.some((rule) => rule.add_temporal_flags.includes('recurrent_episodic_course')),
        'Expected recurrent course temporal rule',
    );
    assert.ok(
        report.feature_enrichment_rules.some((rule) => rule.add_inferred_features.includes('endocrine_metabolic_instability_pattern')),
        'Expected endocrine instability enrichment feature',
    );
    assert.ok(
        report.updated_signal_weighting_rules.some((rule) => rule.boost_pattern_families.includes('endocrine_metabolic_crisis')),
        'Expected weighting rule to boost endocrine/metabolic crisis family',
    );

    const featureVector = buildFailureCorrectionFeatureVector(report);
    assert.equal(featureVector.fc_target_endocrine_metabolic_crisis, 1);
    assert.equal(featureVector.fc_enriched_endocrine_metabolic_instability_pattern, 1);
    assert.ok(featureVector.fc_contradiction_pressure > 0);

    let insertedAudit = null;
    const mockClient = {
        from: () => ({
            insert: (payload) => {
                insertedAudit = payload;
                return {
                    select: () => ({
                        single: async () => ({ data: { id: 'audit-1' }, error: null }),
                    }),
                };
            },
        }),
    };

    await logModelImprovementAudit(mockClient, {
        tenant_id: 'tenant-1',
        inference_event_id: 'inf-1',
        pre_update_prediction: { diagnosis: { top: 'Acute Gastroenteritis' } },
        pre_confidence: 0.83,
        reinforcement_applied: true,
        actual_correctness: 0,
        calibration_improvement: 0.41,
        failure_correction_report: report,
    });

    assert.equal(
        insertedAudit.post_update_prediction._failure_correction_report.pattern_differentiation.target_pattern.family,
        'endocrine_metabolic_crisis',
    );

    console.log('Failure correction engine tests passed.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
