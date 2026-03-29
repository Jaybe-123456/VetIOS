const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'lib', 'settings', 'permissions.ts');
const generatedDir = path.join(appRoot, '.generated-tests');
const generatedModulePath = path.join(generatedDir, 'settings.permissions.cjs');

function compilePermissionsModule() {
    fs.mkdirSync(generatedDir, { recursive: true });
    const source = fs.readFileSync(sourcePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: sourcePath,
    });
    fs.writeFileSync(generatedModulePath, transpiled.outputText, 'utf8');
    delete require.cache[generatedModulePath];
    return require(generatedModulePath);
}

function cleanupGeneratedArtifacts() {
    fs.rmSync(generatedDir, { recursive: true, force: true });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function run() {
    const moduleUnderTest = compilePermissionsModule();
    const {
        buildControlPlanePermissionSet,
        canRoleRunSimulations,
        classifySettingsControlPlaneActionAccess,
        resolveControlPlaneRole,
    } = moduleUnderTest;

    assert(canRoleRunSimulations('admin') === true, 'Admins should be able to run simulations.');
    assert(canRoleRunSimulations('developer') === true, 'Developers should be able to run simulations.');
    assert(canRoleRunSimulations('researcher') === false, 'Researchers should not be able to run simulations.');
    assert(canRoleRunSimulations('clinician') === false, 'Clinicians should not be able to run simulations.');

    const developerPermissions = buildControlPlanePermissionSet('developer');
    assert(developerPermissions.can_run_simulations === true, 'Developer permission set should expose simulation access.');
    assert(developerPermissions.can_manage_configuration === false, 'Developer permission set should not expose full configuration access.');

    const adminPermissions = buildControlPlanePermissionSet('admin');
    assert(adminPermissions.can_manage_configuration === true, 'Admins should retain full configuration access.');

    assert(classifySettingsControlPlaneActionAccess('set_simulation_mode') === 'simulation', 'Simulation mode toggles should use simulation access.');
    assert(classifySettingsControlPlaneActionAccess('inject_simulation') === 'simulation', 'Simulation injection should use simulation access.');
    assert(classifySettingsControlPlaneActionAccess('update_config') === 'admin', 'Full config changes must remain admin-only.');
    assert(classifySettingsControlPlaneActionAccess('registry_action') === 'admin', 'Registry control actions must remain admin-only.');
    assert(classifySettingsControlPlaneActionAccess('run_system_diagnostic') === 'public', 'Diagnostics should remain broadly available.');

    const roleFromMetadata = resolveControlPlaneRole({
        user_metadata: { role: 'developer' },
        app_metadata: {},
    }, 'session');
    assert(roleFromMetadata === 'developer', 'Session role resolution should honor metadata roles.');

    const devBypassRole = resolveControlPlaneRole(null, 'dev_bypass');
    assert(devBypassRole === 'admin', 'Dev bypass should still resolve to admin.');

    console.log('control-plane simulation permission tests passed');
}

try {
    run();
} finally {
    cleanupGeneratedArtifacts();
}
