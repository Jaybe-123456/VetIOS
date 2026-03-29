const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'lib', 'ai', 'diseaseOntology.ts');
const generatedDir = path.join(appRoot, '.generated-tests');
const generatedPath = path.join(generatedDir, 'diseaseOntology.cjs');

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

function topName(result) {
    return result.ranked[0]?.name ?? null;
}

function runCase(mod, scenario) {
    const result = mod.scoreClosedWorldDiseases({
        inputSignature: scenario.inputSignature,
        observationHints: scenario.observationHints,
        species: scenario.species,
    });

    assert(result.ranked.length > 0, `Scenario "${scenario.name}" returned no ranked diagnoses.`);
    assert(mod.getClosedWorldDiseaseNames().includes(topName(result)), `Scenario "${scenario.name}" returned a non-ontology top diagnosis.`);
    if (scenario.expectedTop) {
        assert(topName(result) === scenario.expectedTop, `Scenario "${scenario.name}" expected top diagnosis "${scenario.expectedTop}" but got "${topName(result)}".`);
    }
    if (scenario.expectedTop3) {
        const top3 = result.ranked.slice(0, 3).map((entry) => entry.name);
        assert(top3.includes(scenario.expectedTop3), `Scenario "${scenario.name}" expected "${scenario.expectedTop3}" in top-3 but got ${top3.join(', ')}.`);
    }
    if (scenario.expectedCategory) {
        assert(result.activeCategories.includes(scenario.expectedCategory), `Scenario "${scenario.name}" expected active category "${scenario.expectedCategory}" but got ${result.activeCategories.join(', ')}.`);
    }
    if (scenario.minTopMargin != null) {
        const margin = (result.ranked[0]?.probability ?? 0) - (result.ranked[1]?.probability ?? 0);
        assert(margin >= scenario.minTopMargin, `Scenario "${scenario.name}" expected top-margin >= ${scenario.minTopMargin} but got ${margin.toFixed(3)}.`);
    }
    if (scenario.forbidTop) {
        assert(topName(result) !== scenario.forbidTop, `Scenario "${scenario.name}" unexpectedly ranked forbidden diagnosis "${scenario.forbidTop}" first.`);
    }

    return result;
}

function main() {
    const mod = compileModule();

    const ontology = mod.getMasterDiseaseOntology();
    const diseaseNames = mod.getClosedWorldDiseaseNames();
    const uniqueNames = new Set(diseaseNames);
    assert(uniqueNames.size === diseaseNames.length, 'Disease ontology contains duplicate disease names.');
    assert(mod.normalizeOntologyDiseaseName('Totally Invented Syndrome') === null, 'Unknown disease labels must normalize to null.');
    assert(mod.normalizeOntologyDiseaseName('Foreign Body Obstruction') === 'Intestinal Obstruction', 'Legacy obstruction alias did not normalize to ontology disease.');

    const scenarios = [
        {
            name: 'classic gdv',
            species: 'dog',
            expectedTop: 'Gastric Dilatation-Volvulus (GDV)',
            expectedCategory: 'Gastrointestinal',
            minTopMargin: 0.1,
            inputSignature: {
                species: 'dog',
                symptoms: ['non-productive retching', 'abdominal distension', 'collapse', 'drooling'],
                history: 'Acute onset after meal in deep-chested breed with rapid deterioration.',
                metadata: { breed: 'Great Dane' },
            },
        },
        {
            name: 'rabies adversarial neurologic',
            species: 'dog',
            expectedTop: 'Rabies',
            expectedCategory: 'Neurological',
            inputSignature: {
                species: 'dog',
                symptoms: ['aggression', 'difficulty swallowing', 'drooling'],
                history: 'Acute neurologic behavior change with progressive paralysis.',
            },
        },
        {
            name: 'rodenticide hemotoxic tox',
            species: 'dog',
            expectedTop: 'Anticoagulant Rodenticide Toxicity',
            expectedCategory: 'Toxicology',
            inputSignature: {
                species: 'dog',
                symptoms: ['collapse', 'difficulty breathing', 'bleeding'],
                exposure: 'Possible rat poison ingestion yesterday.',
                labs: { coagulopathy: true, anemia: true },
            },
        },
        {
            name: 'endocrine negative evidence',
            species: 'dog',
            expectedTop: 'Hyperadrenocorticism',
            expectedCategory: 'Endocrine',
            forbidTop: 'Diabetes Mellitus',
            inputSignature: {
                species: 'dog',
                symptoms: ['polyuria', 'polydipsia', 'panting', 'hair loss', 'pot bellied'],
                history: 'Chronic gradual onset.',
                labs: {
                    marked_alp_elevation: true,
                    dilute_urine: true,
                    glucosuria_absent: true,
                    mild_hyperglycemia: true,
                },
            },
        },
        {
            name: 'giardiasis over generic enteritis',
            species: 'dog',
            expectedTop3: 'Giardiasis',
            expectedCategory: 'Parasitic',
            inputSignature: {
                species: 'dog',
                symptoms: ['diarrhea', 'weight loss'],
                history: 'Chronic intermittent loose stool with kennel exposure.',
            },
        },
        {
            name: 'organophosphate vs primary neurologic',
            species: 'dog',
            expectedTop: 'Organophosphate Toxicity',
            expectedCategory: 'Toxicology',
            inputSignature: {
                species: 'dog',
                symptoms: ['drooling', 'tremors', 'difficulty breathing'],
                exposure: 'Pesticide exposure with pinpoint pupils.',
                exam: { miosis: true },
            },
        },
    ];

    for (const scenario of scenarios) {
        const result = runCase(mod, scenario);
        const top3 = result.ranked.slice(0, 3).map((entry) => `${entry.name}:${entry.probability.toFixed(3)}`).join(', ');
        console.log(`[PASS] ${scenario.name} -> ${top3}`);
    }

    console.log(`[PASS] validated ${ontology.length} ontology diseases with closed-world constraint checks`);
}

try {
    main();
} finally {
    cleanupGeneratedArtifacts();
}
