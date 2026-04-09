import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computePhiHat } from '@vetios/cire-engine';
import { publishSovereignSignal } from '@/lib/platform/eventBus';

type SovereignPlan = 'starter' | 'pro' | 'enterprise';
type SovereignSystemType = 'llm' | 'classifier' | 'diagnostic' | 'custom';
type SovereignRunStatus = 'pending' | 'running' | 'complete' | 'failed' | 'blocked';

type SovereignClientRecord = {
    id: string;
    api_key: string;
    name: string;
    email: string;
    plan: SovereignPlan;
    runs_used: number;
    runs_limit: number;
    created_at: string;
};

type SovereignRegistrationRecord = {
    id: string;
    client_id: string;
    system_name: string;
    system_type: SovereignSystemType;
    inference_endpoint: string;
    auth_header: string | null;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
    phi_field_path: string;
    created_at: string;
};

type SovereignRunRecord = {
    id: string;
    client_id: string;
    registration_id: string;
    status: SovereignRunStatus;
    config: Record<string, unknown>;
    phi_curve: Array<Record<string, unknown>> | null;
    collapse_profile: Record<string, unknown> | null;
    hii: number | null;
    report_url: string | null;
    sentinel_config: Record<string, unknown> | null;
    summary: Record<string, unknown>;
    error_message: string | null;
    created_at: string;
    completed_at: string | null;
};

declare global {
    // eslint-disable-next-line no-var
    var __vetiosSovereignJobs: Map<string, { running: boolean }> | undefined;
}

function getSovereignJobStore() {
    if (!globalThis.__vetiosSovereignJobs) {
        globalThis.__vetiosSovereignJobs = new Map<string, { running: boolean }>();
    }
    return globalThis.__vetiosSovereignJobs;
}

export async function requireSovereignClient(
    client: SupabaseClient,
    req: Request,
) {
    const authHeader = req.headers.get('authorization') ?? '';
    const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null;
    if (!apiKey) {
        throw createHttpError(401, 'sovereign_unauthorized', 'Bearer API key is required.');
    }

    const { data, error } = await client
        .from('sovereign_clients')
        .select('*')
        .eq('api_key', apiKey)
        .maybeSingle();

    if (error) {
        throw createHttpError(500, 'sovereign_client_lookup_failed', error.message);
    }
    if (!data) {
        throw createHttpError(401, 'sovereign_unauthorized', 'Invalid Sovereign API key.');
    }

    return data as SovereignClientRecord;
}

export async function registerSovereignSystem(
    client: SupabaseClient,
    sovereignClient: SovereignClientRecord,
    input: {
        system_name: string;
        system_type: SovereignSystemType;
        inference_endpoint: string;
        auth_header?: string | null;
        input_schema: Record<string, unknown>;
        output_schema: Record<string, unknown>;
    },
) {
    const phiFieldPath = readText(asRecord(input.output_schema).phi_field_path);
    if (!phiFieldPath) {
        throw createHttpError(400, 'phi_field_path_required', 'output_schema.phi_field_path is required.');
    }

    const { data, error } = await client
        .from('sovereign_registrations')
        .insert({
            client_id: sovereignClient.id,
            system_name: input.system_name,
            system_type: input.system_type,
            inference_endpoint: input.inference_endpoint,
            auth_header: input.auth_header ?? null,
            input_schema: input.input_schema,
            output_schema: input.output_schema,
            phi_field_path: phiFieldPath,
        })
        .select('*')
        .single();

    if (error || !data) {
        throw createHttpError(500, 'sovereign_register_failed', error?.message ?? 'Failed to register system.');
    }

    return {
        registration_id: readText((data as Record<string, unknown>).id),
    };
}

export async function startSovereignRun(
    client: SupabaseClient,
    sovereignClient: SovereignClientRecord,
    input: {
        registration_id: string;
        m_steps?: number;
        samples_per_step?: number;
        perturbation_mix?: {
            noise_weight?: number;
            incompleteness_weight?: number;
            contradiction_weight?: number;
        };
        include_hysteresis_test?: boolean;
    },
) {
    await assertSovereignPlanCapacity(client, sovereignClient);
    const registration = await getSovereignRegistration(client, sovereignClient.id, input.registration_id);
    const config = {
        registration_id: input.registration_id,
        m_steps: clampInteger(input.m_steps, 2, 100, 20),
        samples_per_step: clampInteger(input.samples_per_step, 1, 500, 100),
        perturbation_mix: normalizePerturbationMix(input.perturbation_mix),
        include_hysteresis_test: input.include_hysteresis_test !== false,
    };

    const { data, error } = await client
        .from('sovereign_runs')
        .insert({
            client_id: sovereignClient.id,
            registration_id: registration.id,
            status: 'running',
            config,
            report_url: `/sovereign/runs/${randomUUID()}/report`,
            summary: {},
        })
        .select('*')
        .single();

    if (error || !data) {
        throw createHttpError(500, 'sovereign_run_create_failed', error?.message ?? 'Failed to create run.');
    }

    const run = normalizeRun(data as Record<string, unknown>);
    await client
        .from('sovereign_runs')
        .update({
            report_url: `/sovereign/runs/${run.id}/report`,
        })
        .eq('id', run.id);

    await client
        .from('sovereign_clients')
        .update({
            runs_used: sovereignClient.runs_used + 1,
        })
        .eq('id', sovereignClient.id);

    getSovereignJobStore().set(run.id, { running: true });
    void executeSovereignRun(client, sovereignClient, registration, {
        ...run,
        report_url: `/sovereign/runs/${run.id}/report`,
    }).catch(async (error) => {
        await finalizeSovereignRun(client, run.id, {
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Sovereign run failed.',
            summary: {},
        }).catch(() => undefined);
        getSovereignJobStore().delete(run.id);
    });

    return {
        run_id: run.id,
        status: 'running',
        sse_url: `/sovereign/runs/${run.id}/progress`,
    };
}

export async function getSovereignRun(
    client: SupabaseClient,
    sovereignClient: SovereignClientRecord,
    runId: string,
) {
    const { data, error } = await client
        .from('sovereign_runs')
        .select('*')
        .eq('id', runId)
        .eq('client_id', sovereignClient.id)
        .maybeSingle();

    if (error) {
        throw createHttpError(500, 'sovereign_run_load_failed', error.message);
    }
    if (!data) {
        throw createHttpError(404, 'sovereign_run_not_found', 'Run not found.');
    }

    return normalizeRun(data as Record<string, unknown>);
}

export async function getSovereignBenchmark(
    client: SupabaseClient,
    sovereignClient: SovereignClientRecord,
    systemType?: SovereignSystemType | null,
) {
    const registrations = await listRows(client, 'sovereign_registrations');
    const runs = await listRows(client, 'sovereign_runs');
    const registrationTypeById = new Map<string, SovereignSystemType>(
        registrations
            .map((row) => ({
                id: readText(row.id),
                systemType: readText(row.system_type) as SovereignSystemType | null,
            }))
            .filter((entry): entry is { id: string; systemType: SovereignSystemType } => Boolean(entry.id && entry.systemType))
            .map((entry) => [entry.id, entry.systemType]),
    );

    const filteredRuns = runs.filter((row) => readText(row.status) === 'complete')
        .filter((row) => {
            if (!systemType) return true;
            const registrationId = readText(row.registration_id);
            return registrationId ? registrationTypeById.get(registrationId) === systemType : false;
        });

    const phiAtZero = filteredRuns
        .map((row) => readNumber(asArray(row.phi_curve)[0] && asRecord(asArray(row.phi_curve)[0]).phi_hat))
        .filter((value): value is number => value != null);
    const mCollapse = filteredRuns
        .map((row) => readNumber(asRecord(row.collapse_profile).universal))
        .filter((value): value is number => value != null);
    const hii = filteredRuns
        .map((row) => readNumber(row.hii))
        .filter((value): value is number => value != null);

    return {
        median_phi_at_0: median(phiAtZero),
        median_m_collapse: median(mCollapse),
        median_hii: median(hii),
        n_systems: new Set(filteredRuns.map((row) => readText(row.registration_id)).filter(Boolean)).size,
    };
}

export function buildSovereignReportPdf(run: SovereignRunRecord) {
    const lines = [
        'SOVEREIGN COLLAPSE REPORT',
        `RUN ID: ${run.id}`,
        `STATUS: ${run.status.toUpperCase()}`,
        `PHI BASELINE: ${formatMaybeNumber(readNumber(asArray(run.phi_curve)[0] && asRecord(asArray(run.phi_curve)[0]).phi_hat), 4)}`,
        `HII: ${formatMaybeNumber(run.hii, 4)}`,
        `COLLAPSE PROFILE: ${JSON.stringify(run.collapse_profile ?? {})}`,
        `SENTINEL CONFIG: ${JSON.stringify(run.sentinel_config ?? {})}`,
    ];

    return buildSimplePdf(lines);
}

async function executeSovereignRun(
    client: SupabaseClient,
    sovereignClient: SovereignClientRecord,
    registration: SovereignRegistrationRecord,
    run: SovereignRunRecord,
) {
    const config = run.config;
    const mix = normalizePerturbationMix(asRecord(config.perturbation_mix));
    const mSteps = clampInteger(readNumber(config.m_steps), 2, 100, 20);
    const samplesPerStep = clampInteger(readNumber(config.samples_per_step), 1, 500, 100);
    const includeHysteresisTest = readBoolean(config.include_hysteresis_test) ?? true;
    const mValues = linspace(0, 1, mSteps);
    const capabilityCurves = new Map<string, Array<{ m: number; phi_hat: number }>>();
    const phiCurve: Array<Record<string, unknown>> = [];
    let completedSteps = 0;
    const totalSteps = mValues.length + (includeHysteresisTest ? mValues.length : 0);

    for (const capability of ['noise', 'incompleteness', 'contradiction'] as const) {
        const rows: Array<{ m: number; phi_hat: number }> = [];
        for (const m of mValues) {
            const observations = await runCapabilitySweep(registration, {
                m,
                samplesPerStep,
                capability,
                mix,
            });
            rows.push({ m, phi_hat: mean(observations.map((entry) => entry.phi_hat)) });
        }
        capabilityCurves.set(capability, rows);
    }

    for (const m of mValues) {
        const observations = await runMixedSweep(registration, {
            m,
            samplesPerStep,
            mix,
        });
        completedSteps += 1;
        const row = {
            m: round(m, 4),
            phi_hat: round(mean(observations.map((entry) => entry.phi_hat)), 6),
            p_mean: round(mean(observations.map((entry) => entry.success ? 1 : 0)), 6),
            latency_mean: round(mean(observations.map((entry) => entry.latency_ms)), 2),
        };
        phiCurve.push(row);
        await updateSovereignRunProgress(client, run.id, sovereignClient.id, {
            current_step: completedSteps,
            total_steps: totalSteps,
            m: row.m,
            phi_hat: row.phi_hat,
            p_mean: row.p_mean,
            latency_mean: row.latency_mean,
        });
    }

    let recoveredPhi = readNumber(phiCurve[0]?.phi_hat) ?? 0;
    if (includeHysteresisTest) {
        for (const m of [...mValues].reverse()) {
            const observations = await runMixedSweep(registration, {
                m,
                samplesPerStep,
                mix,
            });
            completedSteps += 1;
            const phiHat = round(mean(observations.map((entry) => entry.phi_hat)), 6);
            if (m === 0) {
                recoveredPhi = phiHat;
            }
            await updateSovereignRunProgress(client, run.id, sovereignClient.id, {
                current_step: completedSteps,
                total_steps: totalSteps,
                m: round(m, 4),
                phi_hat: phiHat,
                reverse: true,
            });
        }
    }

    const phiBaseline = Math.max(readNumber(phiCurve[0]?.phi_hat) ?? 1, 0.0001);
    const collapseProfile = {
        noise: findCollapseThreshold(capabilityCurves.get('noise') ?? [], phiBaseline),
        incompleteness: findCollapseThreshold(capabilityCurves.get('incompleteness') ?? [], phiBaseline),
        contradiction: findCollapseThreshold(capabilityCurves.get('contradiction') ?? [], phiBaseline),
        universal: findCollapseThreshold(phiCurve.map((entry) => ({
            m: readNumber(entry.m) ?? 0,
            phi_hat: readNumber(entry.phi_hat) ?? 0,
        })), phiBaseline),
    };
    const hii = round(clamp(1 - (recoveredPhi / phiBaseline), 0, 1), 6);
    const sentinelConfig = {
        phi_baseline: round(phiBaseline, 6),
        warn_threshold_cps: 0.25,
        critical_threshold_cps: 0.5,
        block_threshold_cps: 0.75,
        ema_alpha: 0.1,
        sigma_window: 50,
    };

    await finalizeSovereignRun(client, run.id, {
        status: 'complete',
        phi_curve: phiCurve,
        collapse_profile: collapseProfile,
        hii,
        sentinel_config: sentinelConfig,
        report_url: `/sovereign/runs/${run.id}/report`,
        summary: {
            certification_badge: (readNumber(phiCurve.find((entry) => Math.abs((readNumber(entry.m) ?? 0) - 0.5) < 0.001)?.phi_hat) ?? 0) > 0.6,
        },
    });
    getSovereignJobStore().delete(run.id);
}

async function runCapabilitySweep(
    registration: SovereignRegistrationRecord,
    input: {
        m: number;
        samplesPerStep: number;
        capability: 'noise' | 'incompleteness' | 'contradiction';
        mix: { noise_weight: number; incompleteness_weight: number; contradiction_weight: number };
    },
) {
    const results: Array<{ phi_hat: number; success: boolean; latency_ms: number }> = [];
    for (let index = 0; index < input.samplesPerStep; index += 1) {
        const sample = buildRegisteredInputSample(registration.input_schema, index);
        const perturbed = perturbRegisteredSample(sample, input.capability, input.m, index);
        const result = await callRegisteredEndpoint(registration, perturbed);
        results.push(result);
    }
    return results;
}

async function runMixedSweep(
    registration: SovereignRegistrationRecord,
    input: {
        m: number;
        samplesPerStep: number;
        mix: { noise_weight: number; incompleteness_weight: number; contradiction_weight: number };
    },
) {
    const results: Array<{ phi_hat: number; success: boolean; latency_ms: number }> = [];
    for (let index = 0; index < input.samplesPerStep; index += 1) {
        let sample = buildRegisteredInputSample(registration.input_schema, index);
        if (input.mix.noise_weight > 0) {
            sample = perturbRegisteredSample(sample, 'noise', input.m * input.mix.noise_weight, index);
        }
        if (input.mix.incompleteness_weight > 0) {
            sample = perturbRegisteredSample(sample, 'incompleteness', input.m * input.mix.incompleteness_weight, index);
        }
        if (input.mix.contradiction_weight > 0) {
            sample = perturbRegisteredSample(sample, 'contradiction', input.m * input.mix.contradiction_weight, index);
        }
        const result = await callRegisteredEndpoint(registration, sample);
        results.push(result);
    }
    return results;
}

async function callRegisteredEndpoint(
    registration: SovereignRegistrationRecord,
    payload: Record<string, unknown>,
) {
    const startedAt = Date.now();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (registration.auth_header) {
        const [headerName, ...rest] = registration.auth_header.includes(':')
            ? registration.auth_header.split(':')
            : ['Authorization', registration.auth_header];
        headers[headerName.trim()] = rest.join(':').trim();
    }

    const response = await fetch(registration.inference_endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
    });
    const raw = await response.json().catch(() => ({}));
    const latencyMs = Date.now() - startedAt;
    const vector = normalizeProbabilityVector(readAtPath(raw, registration.phi_field_path));
    const phiHat = computePhiHat(vector);

    return {
        phi_hat: phiHat,
        success: response.ok,
        latency_ms: latencyMs,
    };
}

async function updateSovereignRunProgress(
    client: SupabaseClient,
    runId: string,
    clientId: string,
    summary: Record<string, unknown>,
) {
    await client
        .from('sovereign_runs')
        .update({
            summary,
        })
        .eq('id', runId);

    publishSovereignSignal({
        client_id: clientId,
        run_id: runId,
        status: 'running',
        type: 'progress',
    });
}

async function finalizeSovereignRun(
    client: SupabaseClient,
    runId: string,
    patch: Partial<{
        status: SovereignRunStatus;
        phi_curve: Array<Record<string, unknown>>;
        collapse_profile: Record<string, unknown>;
        hii: number | null;
        sentinel_config: Record<string, unknown>;
        report_url: string;
        summary: Record<string, unknown>;
        error_message: string;
    }>,
) {
    const { data, error } = await client
        .from('sovereign_runs')
        .update({
            status: patch.status,
            phi_curve: patch.phi_curve,
            collapse_profile: patch.collapse_profile,
            hii: patch.hii,
            sentinel_config: patch.sentinel_config,
            report_url: patch.report_url,
            summary: patch.summary ?? {},
            error_message: patch.error_message ?? null,
            completed_at: patch.status === 'complete' ? new Date().toISOString() : null,
        })
        .eq('id', runId)
        .select('*')
        .single();

    if (error || !data) {
        throw createHttpError(500, 'sovereign_run_finalize_failed', error?.message ?? 'Failed to finalize run.');
    }

    const run = normalizeRun(data as Record<string, unknown>);
    publishSovereignSignal({
        client_id: run.client_id,
        run_id: run.id,
        status: run.status,
        type: run.status === 'complete' ? 'complete' : 'error',
    });

    return run;
}

async function getSovereignRegistration(
    client: SupabaseClient,
    clientId: string,
    registrationId: string,
) {
    const { data, error } = await client
        .from('sovereign_registrations')
        .select('*')
        .eq('id', registrationId)
        .eq('client_id', clientId)
        .maybeSingle();

    if (error) {
        throw createHttpError(500, 'sovereign_registration_lookup_failed', error.message);
    }
    if (!data) {
        throw createHttpError(404, 'sovereign_registration_not_found', 'Registration not found.');
    }

    return normalizeRegistration(data as Record<string, unknown>);
}

async function assertSovereignPlanCapacity(
    client: SupabaseClient,
    sovereignClient: SovereignClientRecord,
) {
    if (sovereignClient.plan === 'enterprise') {
        return;
    }

    if (sovereignClient.plan === 'starter' && sovereignClient.runs_used >= 1) {
        throw createHttpError(403, 'sovereign_plan_limit_reached', 'Starter plan already used its available run.');
    }

    if (sovereignClient.plan === 'pro') {
        const { data, error } = await client
            .from('sovereign_runs')
            .select('id,created_at')
            .eq('client_id', sovereignClient.id)
            .gte('created_at', new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString());
        if (error) {
            throw createHttpError(500, 'sovereign_plan_limit_check_failed', error.message);
        }
        if ((data ?? []).length >= 10) {
            throw createHttpError(403, 'sovereign_plan_limit_reached', 'Pro plan monthly run limit reached.');
        }
    }
}

function normalizePerturbationMix(value: unknown) {
    const record = asRecord(value);
    const noise = clamp(readNumber(record.noise_weight) ?? 0.34, 0, 1);
    const incompleteness = clamp(readNumber(record.incompleteness_weight) ?? 0.33, 0, 1);
    const contradiction = clamp(readNumber(record.contradiction_weight) ?? 0.33, 0, 1);
    const total = noise + incompleteness + contradiction || 1;

    return {
        noise_weight: round(noise / total, 6),
        incompleteness_weight: round(incompleteness / total, 6),
        contradiction_weight: round(contradiction / total, 6),
    };
}

function buildRegisteredInputSample(inputSchema: Record<string, unknown>, seed: number) {
    const fields: unknown[] = Array.isArray(asRecord(inputSchema).fields) ? asRecord(inputSchema).fields as unknown[] : [];
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
        const record = asRecord(field);
        const name = readText(record.name);
        if (!name) continue;
        payload[name] = synthesizeFieldValue(record, seed);
    }
    return payload;
}

function synthesizeFieldValue(field: Record<string, unknown>, seed: number) {
    const type = readText(field.type) ?? 'string';
    const enumValues = Array.isArray(field.enum) ? field.enum : [];
    if (enumValues.length > 0) {
        return enumValues[seed % enumValues.length];
    }
    if (type === 'number' || type === 'integer' || type === 'float') {
        const range = Array.isArray(field.range) ? field.range : [];
        const min = readNumber(range[0]) ?? 0;
        const max = readNumber(range[1]) ?? 100;
        return round(min + (((seed % 10) / 10) * (max - min)), 2);
    }
    if (type === 'boolean') {
        return seed % 2 === 0;
    }
    return `${readText(field.name) ?? 'field'}_${seed}`;
}

function perturbRegisteredSample(
    payload: Record<string, unknown>,
    capability: 'noise' | 'incompleteness' | 'contradiction',
    m: number,
    seed: number,
) {
    const next = { ...payload };
    const keys = Object.keys(next);
    if (keys.length === 0) {
        return next;
    }

    if (capability === 'noise') {
        const key = keys[seed % keys.length];
        next[key] = `${String(next[key] ?? '')} ${'noise '.repeat(Math.max(1, Math.round(m * 10)))}`.trim();
        return next;
    }

    if (capability === 'incompleteness') {
        const removeCount = Math.max(1, Math.round(keys.length * Math.max(0.1, m)));
        for (const key of keys.slice(0, removeCount)) {
            delete next[key];
        }
        return next;
    }

    const key = keys[seed % keys.length];
    next[key] = typeof next[key] === 'number' ? -Math.abs(Number(next[key])) : `contradiction_${seed}`;
    return next;
}

function normalizeRegistration(row: Record<string, unknown>): SovereignRegistrationRecord {
    return {
        id: readText(row.id) ?? '',
        client_id: readText(row.client_id) ?? '',
        system_name: readText(row.system_name) ?? '',
        system_type: (readText(row.system_type) ?? 'custom') as SovereignSystemType,
        inference_endpoint: readText(row.inference_endpoint) ?? '',
        auth_header: readText(row.auth_header),
        input_schema: asRecord(row.input_schema),
        output_schema: asRecord(row.output_schema),
        phi_field_path: readText(row.phi_field_path) ?? '',
        created_at: readText(row.created_at) ?? new Date().toISOString(),
    };
}

function normalizeRun(row: Record<string, unknown>): SovereignRunRecord {
    return {
        id: readText(row.id) ?? '',
        client_id: readText(row.client_id) ?? '',
        registration_id: readText(row.registration_id) ?? '',
        status: (readText(row.status) ?? 'pending') as SovereignRunStatus,
        config: asRecord(row.config),
        phi_curve: Array.isArray(row.phi_curve) ? row.phi_curve as Array<Record<string, unknown>> : null,
        collapse_profile: asRecord(row.collapse_profile),
        hii: readNumber(row.hii),
        report_url: readText(row.report_url),
        sentinel_config: asRecord(row.sentinel_config),
        summary: asRecord(row.summary),
        error_message: readText(row.error_message),
        created_at: readText(row.created_at) ?? new Date().toISOString(),
        completed_at: readText(row.completed_at),
    };
}

async function listRows(
    client: SupabaseClient,
    table: string,
) {
    const { data, error } = await client.from(table).select('*');
    if (error) {
        throw createHttpError(500, 'sovereign_table_read_failed', `Failed to read ${table}: ${error.message}`);
    }
    return (data ?? []) as Array<Record<string, unknown>>;
}

function normalizeProbabilityVector(value: unknown): number[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => {
                if (typeof entry === 'number') return entry;
                if (typeof entry === 'object' && entry !== null) {
                    const probability = readNumber(asRecord(entry).probability) ?? readNumber(asRecord(entry).value);
                    return probability;
                }
                return null;
            })
            .filter((entry): entry is number => entry != null);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.values(value)
            .map((entry) => readNumber(entry))
            .filter((entry): entry is number => entry != null);
    }
    return [];
}

function readAtPath(value: unknown, path: string) {
    return path
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean)
        .reduce<unknown>((current, key) => {
            if (current == null) return undefined;
            if (Array.isArray(current)) {
                const index = Number(key);
                return Number.isInteger(index) ? current[index] : undefined;
            }
            if (typeof current === 'object') {
                return asRecord(current)[key];
            }
            return undefined;
        }, value);
}

function findCollapseThreshold(curve: Array<{ m: number; phi_hat: number }>, phiBaseline: number) {
    const threshold = phiBaseline * 0.5;
    const point = curve.find((entry) => entry.phi_hat <= threshold);
    return round(point?.m ?? 1, 6);
}

function linspace(start: number, end: number, steps: number) {
    return Array.from({ length: steps }, (_, index) => {
        if (steps === 1) return start;
        return start + ((end - start) * (index / (steps - 1)));
    });
}

function buildSimplePdf(lines: string[]) {
    const safeLines = lines.map((line) => line.replace(/[()\\]/g, (match) => `\\${match}`));
    const content = [
        'BT',
        '/F1 11 Tf',
        '50 760 Td',
        ...safeLines.flatMap((line, index) => index === 0 ? [`(${line}) Tj`] : ['T*', `(${line}) Tj`]),
        'ET',
    ].join('\n');
    const stream = Buffer.from(content, 'utf8');
    const objects = [
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj',
        `4 0 obj << /Length ${stream.length} >> stream\n${content}\nendstream endobj`,
        '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj',
    ];
    let body = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
        offsets.push(Buffer.byteLength(body, 'utf8'));
        body += `${object}\n`;
    }
    const xrefOffset = Buffer.byteLength(body, 'utf8');
    body += `xref\n0 ${objects.length + 1}\n`;
    body += '0000000000 65535 f \n';
    for (let index = 1; index < offsets.length; index += 1) {
        body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(body, 'utf8');
}

function createHttpError(status: number, code: string, message: string) {
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = status;
    error.code = code;
    return error;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function round(value: number, precision: number) {
    return Number(value.toFixed(precision));
}

function mean(values: number[]) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2, 6)
        : round(sorted[middle] ?? 0, 6);
}

function formatMaybeNumber(value: number | null, precision: number) {
    return value == null ? 'n/a' : value.toFixed(precision);
}

function readText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function asArray(value: unknown) {
    return Array.isArray(value) ? value : [];
}
