const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const generatedDir = path.join(appRoot, '.generated-tests-risk-scope');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function transpileIntoGenerated(relativePath, sourcePath) {
    const targetPath = path.join(generatedDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const source = fs.readFileSync(sourcePath, 'utf8');
    let output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: sourcePath,
    }).outputText;

    if (relativePath.endsWith(path.join('lib', 'ai', 'emergencyRules.js'))) {
        output = output.replace("@/lib/ai/clinicalSignals", "./clinicalSignals");
    }

    fs.writeFileSync(targetPath, output, 'utf8');
}

function compileModules() {
    transpileIntoGenerated(path.join('lib', 'ai', 'clinicalSignals.js'), path.join(appRoot, 'lib', 'ai', 'clinicalSignals.ts'));
    transpileIntoGenerated(path.join('lib', 'ai', 'emergencyRules.js'), path.join(appRoot, 'lib', 'ai', 'emergencyRules.ts'));
    transpileIntoGenerated(path.join('lib', 'ai', 'abdominalEmergency.js'), path.join(appRoot, 'lib', 'ai', 'abdominalEmergency.ts'));

    const signalsPath = path.join(generatedDir, 'lib', 'ai', 'clinicalSignals.js');
    const emergencyPath = path.join(generatedDir, 'lib', 'ai', 'emergencyRules.js');
    const riskPath = path.join(generatedDir, 'lib', 'ai', 'abdominalEmergency.js');
    delete require.cache[signalsPath];
    delete require.cache[emergencyPath];
    delete require.cache[riskPath];

    return {
        signals: require(signalsPath),
        emergency: require(emergencyPath),
        risk: require(riskPath),
    };
}

function cleanupGeneratedArtifacts() {
    fs.rmSync(generatedDir, { recursive: true, force: true });
}

function main() {
    const mod = compileModules();

    const neurologicCase = {
        species: 'dog',
        breed: 'Dachshund',
        symptoms: ['back pain', 'reluctance to move', 'hindlimb weakness', 'ataxia', 'paralysis'],
        history: 'Acute onset after jumping with spinal cord deficits and disc extrusion on imaging.',
    };
    const neurologicSignals = mod.signals.extractClinicalSignals(neurologicCase);
    const neurologicEmergency = mod.emergency.evaluateEmergencyRules(neurologicCase);
    const neurologicRisk = mod.risk.buildCatastrophicRiskOutput({
        signals: neurologicSignals,
        emergencyEval: neurologicEmergency,
        severityScore: 1,
    });

    assert(
        neurologicRisk.catastrophic_deterioration_risk_6h < 0.5,
        `Non-abdominal neurologic case should not inherit extreme abdominal catastrophe risk, got ${neurologicRisk.catastrophic_deterioration_risk_6h.toFixed(3)}.`,
    );
    assert(
        neurologicRisk.definition.toLowerCase().includes('non-abdominal'),
        'Non-abdominal neurologic case should clearly warn that abdominal catastrophe calibration is limited.',
    );

    const gdvCase = {
        species: 'dog',
        symptoms: ['non-productive retching', 'abdominal distension', 'collapse', 'drooling'],
        history: 'Acute onset after a meal in a deep-chested breed with rapid deterioration.',
        metadata: { breed: 'Great Dane' },
    };
    const gdvSignals = mod.signals.extractClinicalSignals(gdvCase);
    const gdvEmergency = mod.emergency.evaluateEmergencyRules(gdvCase);
    const gdvRisk = mod.risk.buildCatastrophicRiskOutput({
        signals: gdvSignals,
        emergencyEval: gdvEmergency,
        severityScore: 0.97,
    });

    assert(
        gdvRisk.catastrophic_deterioration_risk_6h >= 0.85,
        `Classic GDV case should still produce very high catastrophic risk, got ${gdvRisk.catastrophic_deterioration_risk_6h.toFixed(3)}.`,
    );
    assert(
        gdvRisk.definition.toLowerCase().includes('abdominal deterioration'),
        'Classic abdominal emergency case should keep the abdominal deterioration definition.',
    );

    console.log('[PASS] risk model scope respects non-abdominal vs abdominal calibration');
}

try {
    main();
} finally {
    cleanupGeneratedArtifacts();
}
