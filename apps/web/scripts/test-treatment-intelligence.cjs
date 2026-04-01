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

function buildNoisyNeurologicBundle(mod) {
    return mod.buildTreatmentRecommendationBundle({
        inferenceEventId: '22222222-2222-4222-8222-222222222222',
        diagnosisLabel: 'Intervertebral Disc Disease (IVDD)',
        diagnosisConfidence: 0.58,
        emergencyLevel: 'HIGH',
        severityScore: 0.86,
        species: 'dog',
        inputSignature: {
            species: 'dog',
            breed: 'Dachshund',
            symptoms: ['back pain', 'hindlimb weakness', 'ataxia', 'paralysis'],
            history: 'Acute onset after jumping with spinal cord deficits, but infectious and inflammatory neurologic alternatives have not been excluded yet.',
        },
        outputPayload: {
            diagnosis: {
                top_differentials: [
                    { name: 'Intervertebral Disc Disease (IVDD)', probability: 0.58 },
                    { name: 'Rabies', probability: 0.22 },
                    { name: 'Immune-Mediated Meningoencephalitis', probability: 0.18 },
                ],
            },
            contradiction_analysis: {
                contradiction_flags: ['differential instability'],
                contradiction_score: 0.36,
                abstain: true,
            },
            abstain_recommendation: true,
            risk_assessment: {
                emergency_level: 'HIGH',
                severity_score: 0.86,
            },
        },
        context: buildContext('advanced'),
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

    const noisyNeurologic = buildNoisyNeurologicBundle(mod);
    assert(noisyNeurologic.management_mode === 'diagnostic_management', 'Noisy neurologic case should activate diagnostic-management mode.');
    assert(noisyNeurologic.options.every((option) => option.uncertainty.diagnostic_management_required === true), 'Diagnostic-management mode should propagate to every pathway option.');
    assert(noisyNeurologic.options.some((option) => option.intervention_details.procedure_types.some((entry) => entry.toLowerCase().includes('confirmatory') || entry.toLowerCase().includes('repeat focused neurologic examination'))), 'Noisy neurologic case should prioritize confirmatory diagnostics in treatment procedures.');
    assert(noisyNeurologic.options.some((option) => option.why_relevant.toLowerCase().includes('diagnostic-management pathway')), 'Noisy neurologic case should reframe rationale around diagnostic management.');

    const inferencePage = fs.readFileSync(inferencePageSource, 'utf8');
    const recommendRoute = fs.readFileSync(recommendRouteSource, 'utf8');
    const outcomeRoute = fs.readFileSync(outcomeRouteSource, 'utf8');
    assert(inferencePage.includes('TreatmentPathwaysPanel'), 'Inference console is missing the treatment pathways panel.');
    assert(inferencePage.includes('Acute deterioration risk model'), 'Inference console is missing the generic non-abdominal risk label.');
    assert(inferencePage.includes('Diagnostic Management Mode') || fs.readFileSync(path.join(appRoot, 'components', 'TreatmentPathwaysPanel.tsx'), 'utf8').includes('Diagnostic Management Mode'), 'Treatment pathways UI is missing the diagnostic-management banner.');
    assert(recommendRoute.includes('recommendTreatmentPathways'), 'Treatment recommend route is missing treatment service integration.');
    assert(outcomeRoute.includes('recordTreatmentDecisionAndOutcome'), 'Treatment outcome route is missing treatment logging integration.');

    console.log(`[PASS] validated treatment intelligence coverage for ${ontology.length} ontology diseases`);
}

try {
    main();
} finally {
    cleanupGeneratedArtifacts();
}
