const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const generatedDir = path.join(appRoot, '.generated-tests');
const permissionsSourcePath = path.join(appRoot, 'lib', 'settings', 'permissions.ts');
const generatedPermissionsPath = path.join(generatedDir, 'permissions.cjs');

function compilePermissionsModule() {
    fs.mkdirSync(generatedDir, { recursive: true });
    const source = fs.readFileSync(permissionsSourcePath, 'utf8');
    const rewritten = source.replace("import type { User } from '@supabase/supabase-js';", '').replace("import type { ControlPlanePermissionSet, ControlPlaneUserRole } from './types';", '');
    const transpiled = ts.transpileModule(rewritten, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: permissionsSourcePath,
    });
    fs.writeFileSync(generatedPermissionsPath, transpiled.outputText, 'utf8');
    delete require.cache[generatedPermissionsPath];
    return require(generatedPermissionsPath);
}

function cleanupGeneratedArtifacts() {
    fs.rmSync(generatedDir, { recursive: true, force: true });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertFileContains(filePath, snippet) {
    const contents = fs.readFileSync(filePath, 'utf8');
    assert(contents.includes(snippet), `${path.relative(appRoot, filePath)} is missing expected authorization snippet: ${snippet}`);
}

function main() {
    const permissions = compilePermissionsModule();
    const clinicianDefault = permissions.resolveControlPlaneRole(null, 'session');
    assert(clinicianDefault === 'clinician', `Expected missing-role users to default to clinician, got ${clinicianDefault}`);

    const clinicianSet = permissions.buildControlPlanePermissionSet('clinician');
    assert(clinicianSet.can_manage_models === false, 'Clinician role must not manage models.');
    assert(clinicianSet.can_manage_configuration === false, 'Clinician role must not manage configuration.');
    assert(clinicianSet.can_run_debug_tools === false, 'Clinician role must not run debug tools.');
    assert(clinicianSet.can_view_governance === true, 'Clinician role should keep governance visibility.');

    const adminSet = permissions.buildControlPlanePermissionSet('admin');
    assert(adminSet.can_manage_models === true, 'Admin role must manage models.');
    assert(adminSet.can_manage_configuration === true, 'Admin role must manage configuration.');

    assertFileContains(path.join(appRoot, 'app', 'api', 'learning', 'promote', 'route.ts'), "isRouteAuthorizationGranted(authContext, 'manage_models')");
    assertFileContains(path.join(appRoot, 'app', 'api', 'learning', 'rollback', 'route.ts'), "isRouteAuthorizationGranted(authContext, 'manage_models')");
    assertFileContains(path.join(appRoot, 'app', 'api', 'models', 'registry', 'control-plane', 'route.ts'), "isRouteAuthorizationGranted(authContext, requirement)");
    assertFileContains(path.join(appRoot, 'app', 'api', 'experiments', 'runs', '[runId]', 'registry', 'route.ts'), "isRouteAuthorizationGranted(authContext, 'manage_models')");
    assertFileContains(path.join(appRoot, 'app', 'api', 'dataset', 'debug', 'route.ts'), "isRouteAuthorizationGranted(authContext, 'run_debug_tools')");
    assertFileContains(path.join(appRoot, 'app', 'models', 'page.tsx'), 'permissionSet.can_view_governance');

    console.log('[PASS] access control defaults and sensitive route guards are in place');
}

try {
    main();
} finally {
    cleanupGeneratedArtifacts();
}
