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
            },
            fileName: filename,
        });
        module._compile(outputText, filename);
    };
}

const { normalizeInferenceInput } = require(path.join(appRoot, 'lib', 'input', 'inputNormalizer.ts'));
const { buildAntigravityClinicalSignal, renderAntigravityClinicalSignal } = require(path.join(appRoot, 'lib', 'ai', 'antigravitySignal.ts'));

const normalized = normalizeInferenceInput(
    'My dog is super tired, not eating, tried to vomit but nothing came out, stomach looks big, started suddenly after eating.',
    'freetext',
);

assert.equal(normalized.species, 'canine');
assert.ok(normalized.symptoms.includes('lethargy'));
assert.ok(normalized.symptoms.includes('anorexia'));
assert.ok(normalized.symptoms.includes('non-productive retching'));
assert.ok(normalized.symptoms.includes('abdominal distension'));

const signal = normalized.metadata.antigravity_signal;
assert.ok(signal, 'Expected antigravity signal metadata to be attached');
assert.equal(signal.species_constraint, 'Canis lupus familiaris');
assert.ok(signal.derived_signals.temporal_pattern.includes('acute'));
assert.ok(signal.derived_signals.exposure_risks.includes('recent_meal'));
assert.ok(signal.signal_quality_score >= 0.7);
assert.ok(renderAntigravityClinicalSignal(signal).includes('Species Constraint:'));

const atypicalSignal = buildAntigravityClinicalSignal({
    species: 'dog',
    symptoms: ['bradycardia', 'dehydration'],
    metadata: {
        raw_note: 'Dog with bradycardia and dehydration noted on exam.',
    },
});

assert.ok(
    atypicalSignal.contradiction_flags.includes('bradycardia with dehydration is an atypical pairing'),
    'Expected atypical pairing contradiction flag',
);

console.log('Antigravity clinical signal tests passed.');
