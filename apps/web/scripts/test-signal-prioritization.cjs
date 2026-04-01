const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'lib', 'ai', 'diseaseOntology.ts');
const generatedDir = path.join(appRoot, '.generated-tests-signal-prioritization');
const generatedPath = path.join(generatedDir, 'diseaseOntology.signal-prioritization.cjs');

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

function runScenario(mod, scenario) {
    const result = mod.scoreClosedWorldDiseases({
        inputSignature: scenario.inputSignature,
        observationHints: scenario.observationHints,
        species: scenario.species,
    });

    assert(result.ranked.length > 0, `Scenario "${scenario.name}" returned no differentials.`);
    assert(result.ranked[0].name === scenario.expectedTop, `Scenario "${scenario.name}" expected top "${scenario.expectedTop}" but got "${result.ranked[0].name}".`);

    if (scenario.forbidTop) {
        assert(result.ranked[0].name !== scenario.forbidTop, `Scenario "${scenario.name}" unexpectedly ranked "${scenario.forbidTop}" first.`);
    }

    if (scenario.requiredAnchorLock) {
        const lockIds = result.signalHierarchy.anchor_locks.map((lock) => lock.id);
        assert(lockIds.includes(scenario.requiredAnchorLock), `Scenario "${scenario.name}" expected anchor lock "${scenario.requiredAnchorLock}" but got [${lockIds.join(', ')}].`);
    }

    if (scenario.minimumMargin != null) {
        const margin = (result.ranked[0]?.probability ?? 0) - (result.ranked[1]?.probability ?? 0);
        assert(margin >= scenario.minimumMargin, `Scenario "${scenario.name}" expected margin >= ${scenario.minimumMargin} but got ${margin.toFixed(3)}.`);
    }

    if (scenario.expectedProtectedCategory) {
        assert(
            result.signalHierarchy.protected_categories.includes(scenario.expectedProtectedCategory),
            `Scenario "${scenario.name}" expected protected category "${scenario.expectedProtectedCategory}" but got [${result.signalHierarchy.protected_categories.join(', ')}].`,
        );
    }

    if (scenario.maxTopProbability != null) {
        assert(
            (result.ranked[0]?.probability ?? 0) <= scenario.maxTopProbability,
            `Scenario "${scenario.name}" expected top probability <= ${scenario.maxTopProbability} but got ${(result.ranked[0]?.probability ?? 0).toFixed(3)}.`,
        );
    }

    return result;
}

function main() {
    const mod = compileModule();
    const scenarios = [
        {
            name: 'neurologic infection anchor defeats epilepsy fallback',
            species: 'dog',
            expectedTop: 'Infectious Meningoencephalitis',
            forbidTop: 'Idiopathic Epilepsy',
            requiredAnchorLock: 'infectious-neuro-anchor',
            expectedProtectedCategory: 'Neurological',
            minimumMargin: 0.08,
            inputSignature: {
                species: 'dog',
                symptoms: ['seizures', 'fever', 'neck pain', 'lethargy', 'anorexia'],
                history: 'Acute neurologic decline after recent tick exposure with disorientation and progressive worsening.',
            },
        },
        {
            name: 'cushings anchor resists diabetes generic overlap',
            species: 'dog',
            expectedTop: 'Hyperadrenocorticism',
            forbidTop: 'Diabetes Mellitus',
            expectedProtectedCategory: 'Endocrine',
            minimumMargin: 0.06,
            inputSignature: {
                species: 'dog',
                symptoms: ['polyuria', 'polydipsia', 'panting', 'hair loss', 'pot bellied', 'weight loss'],
                history: 'Chronic gradual onset over months.',
                labs: {
                    marked_alp_elevation: true,
                    dilute_urine: true,
                    glucosuria_absent: true,
                    mild_hyperglycemia: true,
                },
            },
        },
        {
            name: 'organophosphate anchor defeats infectious noise',
            species: 'dog',
            expectedTop: 'Organophosphate Toxicity',
            requiredAnchorLock: 'organophosphate-anchor',
            expectedProtectedCategory: 'Toxicology',
            minimumMargin: 0.08,
            inputSignature: {
                species: 'dog',
                symptoms: ['drooling', 'tremors', 'difficulty breathing', 'fever', 'weakness'],
                exposure: 'Sudden onset after pesticide exposure with pinpoint pupils.',
                exam: { miosis: true },
            },
        },
        {
            name: 'gdv anchor defeats gastritis noise',
            species: 'dog',
            expectedTop: 'Gastric Dilatation-Volvulus (GDV)',
            requiredAnchorLock: 'gdv-anchor',
            expectedProtectedCategory: 'Gastrointestinal',
            minimumMargin: 0.16,
            inputSignature: {
                species: 'dog',
                symptoms: ['non-productive retching', 'abdominal distension', 'drooling', 'weakness', 'diarrhea'],
                history: 'Acute onset after meal in a deep-chested breed with pale gums and rapid deterioration.',
            },
        },
        {
            name: 'missing anchor data widens instead of collapsing to generic certainty',
            species: 'dog',
            expectedTop: 'Idiopathic Epilepsy',
            maxTopProbability: 0.45,
            inputSignature: {
                species: 'dog',
                symptoms: ['seizures', 'lethargy'],
                history: 'Intermittent episodes but limited exam information available.',
            },
        },
    ];

    for (const scenario of scenarios) {
        const result = runScenario(mod, scenario);
        const top3 = result.ranked.slice(0, 3).map((entry) => `${entry.name}:${entry.probability.toFixed(3)}`).join(', ');
        console.log(`[PASS] ${scenario.name} -> ${top3}`);
    }
}

try {
    main();
} finally {
    cleanupGeneratedArtifacts();
}
