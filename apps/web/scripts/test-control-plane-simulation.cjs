const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const appRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(appRoot, 'lib', 'settings', 'permissions.ts');
const loggerSourcePath = path.join(appRoot, 'lib', 'logging', 'simulationLogger.ts');
const generatedDir = path.join(appRoot, '.generated-tests');
const generatedModulePath = path.join(generatedDir, 'settings.permissions.cjs');
const generatedLoggerModulePath = path.join(generatedDir, 'simulationLogger.cjs');

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

function compileSimulationLoggerModule() {
    fs.mkdirSync(path.join(generatedDir, 'node_modules', '@', 'lib', 'db'), { recursive: true });
    fs.writeFileSync(
        path.join(generatedDir, 'node_modules', '@', 'lib', 'db', 'schemaContracts.js'),
        `
exports.EDGE_SIMULATION_EVENTS = {
  TABLE: 'edge_simulation_events',
  COLUMNS: {
    id: 'id',
    tenant_id: 'tenant_id',
    user_id: 'user_id',
    clinic_id: 'clinic_id',
    case_id: 'case_id',
    source_module: 'source_module',
    simulation_type: 'simulation_type',
    simulation_parameters: 'simulation_parameters',
    triggered_inference_id: 'triggered_inference_id',
    failure_mode: 'failure_mode',
    stress_metrics: 'stress_metrics',
    is_real_world: 'is_real_world',
  },
};
`,
        'utf8',
    );
    const source = fs.readFileSync(loggerSourcePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
        fileName: loggerSourcePath,
    });
    fs.writeFileSync(generatedLoggerModulePath, transpiled.outputText, 'utf8');
    delete require.cache[generatedLoggerModulePath];
    return require(generatedLoggerModulePath);
}

function cleanupGeneratedArtifacts() {
    fs.rmSync(generatedDir, { recursive: true, force: true });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

class FakeInsertQuery {
    constructor(client, table) {
        this.client = client;
        this.table = table;
        this.rows = [];
    }

    insert(row) {
        this.rows = [row];
        return this;
    }

    select() {
        return this;
    }

    single() {
        const row = this.rows[0];
        this.client.inserted.push({ table: this.table, row });
        return Promise.resolve({ data: { id: row.id }, error: null });
    }
}

class FakeLoggerClient {
    constructor() {
        this.inserted = [];
    }

    from(table) {
        return new FakeInsertQuery(this, table);
    }
}

function assertUuid(value, message) {
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), message);
}

async function run() {
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

    const { logSimulation } = compileSimulationLoggerModule();
    const loggerClient = new FakeLoggerClient();
    const loggedId = await logSimulation(loggerClient, {
        id: '1477aac76d0806b0',
        tenant_id: '5254467f-ad37-4edc-8664-3c6ddc9c88b3',
        user_id: 'cbed28e94f8e84ec',
        clinic_id: 'not-a-uuid',
        case_id: null,
        source_module: 'settings_control_plane',
        simulation_type: 'settings_failure',
        simulation_parameters: {},
        triggered_inference_id: 'bca6407f1f9a3c52',
        failure_mode: 'failure',
        stress_metrics: {},
        is_real_world: false,
    });
    const insertedSimulation = loggerClient.inserted[0].row;
    assertUuid(loggedId, 'Simulation logger should replace non-UUID simulation IDs before insert.');
    assertUuid(insertedSimulation.id, 'Inserted edge simulation event ID should be canonical UUID.');
    assert(insertedSimulation.tenant_id === '5254467f-ad37-4edc-8664-3c6ddc9c88b3', 'Logger should preserve valid tenant UUIDs.');
    assert(insertedSimulation.user_id === null, 'Logger should null invalid optional user UUIDs.');
    assert(insertedSimulation.clinic_id === null, 'Logger should null invalid optional clinic UUIDs.');
    assert(insertedSimulation.triggered_inference_id === null, 'Logger should null invalid optional linked inference UUIDs.');
    await logSimulation(new FakeLoggerClient(), {
        tenant_id: '5254467f-ad37-4edc-8664-3c6ddc9c88b3',
        simulation_type: 'settings_drift',
        simulation_parameters: {},
        triggered_inference_id: null,
        is_real_world: false,
    });
    try {
        await logSimulation(new FakeLoggerClient(), {
            tenant_id: 'dev_tenant_001',
            simulation_type: 'settings_failure',
            simulation_parameters: {},
            triggered_inference_id: null,
            is_real_world: false,
        });
        throw new Error('Invalid tenant UUID should fail before Supabase insert.');
    } catch (error) {
        assert(
            error instanceof Error && /tenant_id must be a canonical UUID/.test(error.message),
            'Invalid tenant UUID should produce a precise logger error.',
        );
    }

    console.log('control-plane simulation permission tests passed');
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        cleanupGeneratedArtifacts();
    });
