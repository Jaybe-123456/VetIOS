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

    if (scenario.expectedDominantSystem) {
        assert(
            result.signalHierarchy.dominant_system === scenario.expectedDominantSystem,
            `Scenario "${scenario.name}" expected dominant system "${scenario.expectedDominantSystem}" but got "${result.signalHierarchy.dominant_system}".`,
        );
    }

    if (scenario.forbidTop3) {
        const top3 = result.ranked.slice(0, 3).map((entry) => entry.name);
        assert(
            !top3.includes(scenario.forbidTop3),
            `Scenario "${scenario.name}" unexpectedly ranked "${scenario.forbidTop3}" in the top-3 (${top3.join(', ')}).`,
        );
    }

    if (scenario.requiredDownweightedGenericSignal) {
        assert(
            result.signalHierarchy.generic_signals_downweighted.includes(scenario.requiredDownweightedGenericSignal),
            `Scenario "${scenario.name}" expected generic signal "${scenario.requiredDownweightedGenericSignal}" to be down-weighted but got [${result.signalHierarchy.generic_signals_downweighted.join(', ')}].`,
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
            name: 'hepatic tox anchors defeat generic gastroenteritis overlap',
            species: 'dog',
            expectedTop: 'Aflatoxicosis',
            expectedProtectedCategory: 'Toxicology',
            expectedDominantSystem: 'hepatic',
            forbidTop3: 'Acute Gastroenteritis',
            requiredDownweightedGenericSignal: 'vomiting',
            minimumMargin: 0.05,
            inputSignature: {
                species: 'dog',
                symptoms: ['vomiting', 'diarrhea', 'lethargy', 'weakness'],
                history: 'Feed-associated toxicosis with progressive jaundice and hepatic failure concerns.',
                exposure: 'Possible aflatoxin exposure.',
                exam: {
                    jaundice: true,
                    hepatic_dysfunction: true,
                },
                labs: {
                    alt_u_l: 340,
                    ast_u_l: 162,
                    total_bilirubin_mg_dl: 2.8,
                    coagulopathy: true,
                },
            },
        },
        {
            name: 'neurologic infection anchor defeats epilepsy fallback',
            species: 'dog',
            expectedTop: 'Infectious Meningoencephalitis',
            forbidTop: 'Idiopathic Epilepsy',
            requiredAnchorLock: 'infectious-neuro-anchor',
            expectedProtectedCategory: 'Neurological',
            expectedDominantSystem: 'neurologic',
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
            name: 'ivdd structural anchors outrank infectious neurologic noise',
            species: 'dog',
            expectedTop: 'Intervertebral Disc Disease (IVDD)',
            expectedProtectedCategory: 'Neurological',
            minimumMargin: 0.45,
            inputSignature: {
                species: 'dog',
                breed: 'Dachshund',
                symptoms: ['back pain', 'reluctance to move', 'hindlimb weakness', 'ataxia', 'paralysis'],
                history: 'Presenting complaint: Acute onset back pain and hindlimb weakness. Duration: Sudden onset after jumping. Owner observations: Dog cried out, now reluctant to move, dragging hind legs. Neurologic exam: Spinal cord deficits. Imaging: Disc extrusion.',
            },
        },
        {
            name: 'gdv anchor defeats gastritis noise',
            species: 'dog',
            expectedTop: 'Gastric Dilatation-Volvulus (GDV)',
            requiredAnchorLock: 'gdv-anchor',
            expectedProtectedCategory: 'Gastrointestinal',
            expectedDominantSystem: 'gastrointestinal',
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
