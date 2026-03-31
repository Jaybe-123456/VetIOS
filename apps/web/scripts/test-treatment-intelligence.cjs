const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const generatedDir = path.join(appRoot, '.generated-tests');
const diseaseOntologySource = path.join(appRoot, 'lib', 'ai', 'diseaseOntology.ts');
const treatmentTypesSource = path.join(appRoot, 'lib', 'treatmentIntelligence', 'types.ts');
const treatmentEngineSource = path.join(appRoot, 'lib', 'treatmentIntelligence', 'engine.ts');
const inferencePageSource = path.join(appRoot, 'app', '(console)', 'inference', 'page.tsx');
const recommendRouteSource = path.join(appRoot, 'app', 'api', 'treatment', 'recommend', 'route.ts');
const outcomeRouteSource = path.join(appRoot, 'app', 'api', 'treatment', 'outcome', 'route.ts');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function transpileIntoGenerated(relativePath, sourcePath) {
    const targetPath = path.join(generatedDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const source = fs.readFileSync(sourcePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: sourcePath,
    });
    fs.writeFileSync(targetPath, transpiled.outputText, 'utf8');
}

function compileModules() {
    transpileIntoGenerated(path.join('lib', 'ai', 'diseaseOntology.js'), diseaseOntologySource);
    transpileIntoGenerated(path.join('lib', 'treatmentIntelligence', 'types.js'), treatmentTypesSource);
    transpileIntoGenerated(path.join('lib', 'treatmentIntelligence', 'engine.js'), treatmentEngineSource);
    const enginePath = path.join(generatedDir, 'lib', 'treatmentIntelligence', 'engine.js');
    delete require.cache[enginePath];
    return require(enginePath);
}

function cleanupGeneratedArtifacts() {
    fs.rmSync(generatedDir, { recursive: true, force: true });
}

function buildContext(resourceProfile = 'advanced') {
    return {
        resource_profile: resourceProfile,
        regulatory_region: 'US',
        care_environment: 'general practice',
        comorbidities: [],
        lab_flags: [],
    };
}

function buildBundle(mod, diseaseName, resourceProfile = 'advanced') {
    const ontology = mod.__getMasterDiseaseOntologyForTreatmentTest
        ? mod.__getMasterDiseaseOntologyForTreatmentTest()
        : null;
    const ontologyEntry = Array.isArray(ontology)
        ? ontology.find((entry) => entry.name === diseaseName)
        : null;
    const featureHint = ontologyEntry?.key_clinical_features?.[0]?.term ?? null;

    return mod.buildTreatmentRecommendationBundle({
        inferenceEventId: '11111111-1111-4111-8111-111111111111',
        diagnosisLabel: diseaseName,
        diagnosisConfidence: 0.86,
        emergencyLevel: 'CRITICAL',
        severityScore: 0.91,
        species: ontologyEntry?.species_relevance?.[0] ?? 'dog',
        inputSignature: {
            species: ontologyEntry?.species_relevance?.[0] ?? 'dog',
            symptoms: featureHint ? [featureHint.replace(/_/g, ' ')] : [],
            metadata: { breed: 'Great Dane' },
        },
        outputPayload: {
            diagnosis: {
                top_differentials: [
                    { name: diseaseName, probability: 0.86 },
                    { name: 'Acute Pancreatitis', probability: 0.08 },
                    { name: 'Septic Peritonitis', probability: 0.04 },
                ],
            },
            contradiction_analysis: {
                contradiction_flags: [],
            },
            risk_assessment: {
                emergency_level: 'CRITICAL',
                severity_score: 0.91,
            },
        },
        context: buildContext(resourceProfile),
        observedPerformance: [],
    });
}

function main() {
    const mod = compileModules();

    const ontology = mod.__getMasterDiseaseOntologyForTreatmentTest
        ? mod.__getMasterDiseaseOntologyForTreatmentTest()
        : [];

    assert(Array.isArray(ontology) && ontology.length > 0, 'Treatment test helper failed to expose ontology coverage.');

    for (const disease of ontology) {
        const bundle = buildBundle(mod, disease.name);
        mod.validateTreatmentBundle(bundle);
        assert(bundle.options.length === 3, `Disease ${disease.name} did not return exactly three pathways.`);
        assert(bundle.options.every((option) => option.autonomous_prescribing_blocked === true), `Disease ${disease.name} returned an unsafe autonomous treatment option.`);
        assert(bundle.options.every((option) => option.clinician_validation_required === true), `Disease ${disease.name} returned a pathway without clinician validation.`);
        assert(bundle.options.every((option) => option.intervention_details.reference_range_notes.some((note) => note.toLowerCase().includes('licensed veterinarian'))), `Disease ${disease.name} is missing dosing/reference safety language.`);
    }

    const gdvAdvanced = buildBundle(mod, 'Gastric Dilatation-Volvulus (GDV)', 'advanced');
    assert(gdvAdvanced.options[0].treatment_pathway === 'gold_standard', 'Advanced GDV case should rank gold-standard pathway first.');

    const gdvLowResource = buildBundle(mod, 'Gastric Dilatation-Volvulus (GDV)', 'low_resource');
    assert(gdvLowResource.options[0].treatment_pathway === 'resource_constrained', 'Low-resource GDV case should rank resource-constrained pathway first.');

    const rabies = buildBundle(mod, 'Rabies');
    assert(rabies.options.every((option) => option.intervention_details.drug_classes.length === 0), 'Rabies support should not generate drug classes.');
    assert(rabies.options.some((option) => option.why_relevant.toLowerCase().includes('public-health') || option.why_relevant.toLowerCase().includes('containment')), 'Rabies support should emphasize containment/public health.');

    const inferencePage = fs.readFileSync(inferencePageSource, 'utf8');
    const recommendRoute = fs.readFileSync(recommendRouteSource, 'utf8');
    const outcomeRoute = fs.readFileSync(outcomeRouteSource, 'utf8');
    assert(inferencePage.includes('TreatmentPathwaysPanel'), 'Inference console is missing the treatment pathways panel.');
    assert(recommendRoute.includes('recommendTreatmentPathways'), 'Treatment recommend route is missing treatment service integration.');
    assert(outcomeRoute.includes('recordTreatmentDecisionAndOutcome'), 'Treatment outcome route is missing treatment logging integration.');

    console.log(`[PASS] validated treatment intelligence coverage for ${ontology.length} ontology diseases`);
}

try {
    main();
} finally {
    cleanupGeneratedArtifacts();
}
