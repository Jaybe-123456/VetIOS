import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    classifySafetyState,
    computeCPS,
    computeInputMHat,
    computePhiHat,
    extractProbabilityVectorFromOutput,
    type InferenceInput,
    type RollingStateSnapshot,
    type SafetyState,
    updateRollingState as advanceRollingState,
} from '@vetios/cire-engine';
import { createPlatformAlert } from '@/lib/platform/alerts';
import { writeGovernanceAuditEvent } from '@/lib/platform/governance';
import { getActiveModelVersion, startSimulationRun } from '@/lib/platform/simulations';
import type { PlatformActor } from '@/lib/platform/types';

export type CireSnapshot = {
    id?: string;
    inference_id: string;
    tenant_id: string;
    phi_hat: number;
    delta_rolling: number;
    sigma_delta: number;
    cps: number;
    input_m_hat: number;
    safety_state: SafetyState;
    reliability_badge: 'HIGH' | 'REVIEW' | 'CAUTION' | 'SUPPRESSED';
    created_at?: string;
};

export type CireIncident = {
    id: string;
    inference_id: string;
    tenant_id: string;
    safety_state: SafetyState;
    phi_hat: number | null;
    cps: number | null;
    input_summary: Record<string, unknown>;
    resolution_notes: string | null;
    resolved: boolean;
    resolved_at: string | null;
    resolved_by: string | null;
    created_at: string;
};

export type CireCollapseProfile = {
    id: string;
    tenant_id: string;
    model_version: string;
    phi_baseline: number;
    m_threshold_map: Record<string, unknown>;
    hii: number | null;
    phi_curve: Array<Record<string, unknown>>;
    calibrated_at: string;
    simulation_id: string | null;
};

export type RollingState = {
    tenant_id: string;
    phi_ema: number;
    delta_ema: number;
    sigma_buffer: number[];
    sigma_delta: number;
    delta_hat: number;
    window_count: number;
    last_phi_hat: number | null;
    updated_at?: string | null;
};

export type CireEvaluationResult = {
    snapshot: CireSnapshot;
    rolling_state: RollingState;
    profile: CireCollapseProfile | null;
    input_quality: number;
    incident: CireIncident | null;
};

export async function evaluateInferenceReliability(
    client: SupabaseClient,
    input: {
        inferenceId: string;
        tenantId: string;
        actor: PlatformActor;
        inputPayload: InferenceInput;
        outputPayload: Record<string, unknown>;
        modelVersion: string;
    },
): Promise<CireEvaluationResult> {
    const vector = extractDifferentialVector(input.outputPayload);
    const inputMHat = computeInputMHat(input.inputPayload);
    const phiHat = computePhiHat(vector);
    const rollingState = await updateRollingState(client, input.tenantId, phiHat);
    const profile = await getLatestCollapseProfile(client, input.tenantId, input.modelVersion);
    const phiBaseline = Math.max(profile?.phi_baseline ?? 1, 0.0001);
    const cps = computeCPS(
        phiHat,
        rollingState.delta_ema,
        rollingState.sigma_delta,
        phiBaseline,
    );
    const classification = classifySafetyState(cps);
    const snapshot: CireSnapshot = {
        inference_id: input.inferenceId,
        tenant_id: input.tenantId,
        phi_hat: roundNumber(phiHat, 6),
        delta_rolling: roundNumber(rollingState.delta_ema, 6),
        sigma_delta: roundNumber(rollingState.sigma_delta, 6),
        cps: roundNumber(cps, 6),
        input_m_hat: roundNumber(inputMHat, 6),
        safety_state: classification.safety_state,
        reliability_badge: classification.reliability_badge,
    };

    const persistedSnapshot = await insertCireSnapshot(client, snapshot);
    let incident: CireIncident | null = null;

    if (classification.safety_state === 'critical' || classification.safety_state === 'blocked') {
        incident = await createCireIncident(client, {
            inference_id: input.inferenceId,
            tenant_id: input.tenantId,
            safety_state: classification.safety_state,
            phi_hat: snapshot.phi_hat,
            cps: snapshot.cps,
            input_summary: buildInputSummary(input.inputPayload, inputMHat),
        });

        await createPlatformAlert(client, {
            tenantId: input.tenantId,
            type: 'cire_safety_alert',
            severity: classification.safety_state === 'blocked' ? 'critical' : 'high',
            title: classification.safety_state === 'blocked'
                ? 'CIRE OUTPUT SUPPRESSED'
                : 'CIRE RELIABILITY WARNING',
            message: `CIRE classified inference ${input.inferenceId} as ${classification.safety_state}.`,
            metadata: {
                inference_id: input.inferenceId,
                incident_id: incident.id,
                cps: snapshot.cps,
                phi_hat: snapshot.phi_hat,
                safety_state: classification.safety_state,
            },
        }).catch(() => undefined);
    }

    await writeGovernanceAuditEvent(client, {
        tenantId: input.tenantId,
        actor: input.actor.userId,
        eventType: classification.safety_state === 'nominal'
            ? 'cire_nominal'
            : classification.safety_state === 'warning'
                ? 'cire_warning'
                : classification.safety_state === 'critical'
                    ? 'cire_critical'
                    : 'cire_blocked',
        payload: {
            inference_id: input.inferenceId,
            phi_hat: snapshot.phi_hat,
            cps: snapshot.cps,
            safety_state: snapshot.safety_state,
            input_quality_score: roundNumber(1 - inputMHat, 6),
            cire_snapshot_id: persistedSnapshot.id ?? null,
            cire_incident_id: incident?.id ?? null,
        },
    }).catch(() => undefined);

    return {
        snapshot: persistedSnapshot,
        rolling_state: rollingState,
        profile,
        input_quality: roundNumber(1 - inputMHat, 6),
        incident,
    };
}

export async function updateRollingState(
    client: SupabaseClient,
    tenantId: string,
    phiHat: number,
): Promise<RollingState> {
    const { data: existing, error: readError } = await client
        .from('cire_rolling_state')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

    if (readError) {
        throw new Error(`Failed to load CIRE rolling state: ${readError.message}`);
    }

    const next = advanceRollingState((existing ?? null) as RollingStateSnapshot | null, phiHat);
    const payload = {
        tenant_id: tenantId,
        phi_ema: next.phi_ema,
        delta_ema: next.delta_ema,
        sigma_buffer: next.sigma_buffer,
        window_count: next.window_count,
        last_phi_hat: next.last_phi_hat,
        updated_at: new Date().toISOString(),
    };

    const { data, error } = await client
        .from('cire_rolling_state')
        .upsert(payload, { onConflict: 'tenant_id' })
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to persist CIRE rolling state: ${error?.message ?? 'Unknown error'}`);
    }

    return {
        tenant_id: tenantId,
        phi_ema: readNumber(data.phi_ema) ?? next.phi_ema,
        delta_ema: readNumber(data.delta_ema) ?? next.delta_ema,
        sigma_buffer: normalizeNumberArray(data.sigma_buffer),
        sigma_delta: next.sigma_delta,
        delta_hat: next.delta_hat,
        window_count: readNumber(data.window_count) ?? next.window_count,
        last_phi_hat: readNumber(data.last_phi_hat),
        updated_at: readText(data.updated_at),
    };
}

export async function getCireStatus(
    client: SupabaseClient,
    tenantId: string,
) {
    const { data: snapshots, error: snapshotsError } = await client
        .from('cire_snapshots')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(200);

    if (snapshotsError) {
        throw new Error(`Failed to load CIRE snapshots: ${snapshotsError.message}`);
    }

    const { data: incidents, error: incidentsError } = await client
        .from('cire_incidents')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(500);

    if (incidentsError) {
        throw new Error(`Failed to load CIRE incidents: ${incidentsError.message}`);
    }

    const profile = await getLatestCollapseProfile(client, tenantId);
    const activeModel = await getActiveModelVersion(client, tenantId);
    const recentSnapshots = (snapshots ?? []) as Array<Record<string, unknown>>;
    const last100 = recentSnapshots.slice(0, 100);
    const last24h = recentSnapshots.filter((row) => isWithinDays(readText(row.created_at), 1));
    const incidentCount7d = ((incidents ?? []) as Array<Record<string, unknown>>)
        .filter((row) => isWithinDays(readText(row.created_at), 7))
        .length;
    const latestSnapshot = recentSnapshots[0] ?? null;

    return {
        phi_population_mean: roundNumber(mean(last100.map((row) => readNumber(row.phi_hat)).filter(isNumber)) ?? 0, 6),
        rolling_cps: readNumber(latestSnapshot?.cps) ?? 0,
        safety_state_distribution: {
            nominal: countByState(last24h, 'nominal'),
            warning: countByState(last24h, 'warning'),
            critical: countByState(last24h, 'critical'),
            blocked: countByState(last24h, 'blocked'),
        },
        incident_count_7d: incidentCount7d,
        calibration_status: !profile
            ? 'uncalibrated'
            : activeModel && profile.model_version !== activeModel
                ? 'stale'
                : !isWithinDays(profile.calibrated_at, 30)
                    ? 'stale'
                    : 'calibrated',
        last_calibrated_at: profile?.calibrated_at ?? null,
    };
}

export async function listCireIncidents(
    client: SupabaseClient,
    input: {
        tenantId: string;
        resolved?: boolean | null;
        limit?: number;
        cursor?: string | null;
    },
) {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const { data, error } = await client
        .from('cire_incidents')
        .select('*')
        .eq('tenant_id', input.tenantId)
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) {
        throw new Error(`Failed to load CIRE incidents: ${error.message}`);
    }

    const rows = ((data ?? []) as Array<Record<string, unknown>>)
        .filter((row) => input.resolved == null ? true : (row.resolved === input.resolved))
        .sort(compareCreatedDesc);

    const cursorCreatedAt = input.cursor
        ? readText(rows.find((row) => readText(row.id) === input.cursor)?.created_at)
        : null;
    const filtered = cursorCreatedAt
        ? rows.filter((row) => Date.parse(readText(row.created_at) ?? '') < Date.parse(cursorCreatedAt))
        : rows;
    const page = filtered.slice(0, limit + 1);
    const hasMore = page.length > limit;

    return {
        rows: page.slice(0, limit).map(normalizeIncidentRow),
        nextCursor: hasMore ? readText(page[limit]?.id) : null,
    };
}

export async function resolveCireIncident(
    client: SupabaseClient,
    input: {
        tenantId: string;
        incidentId: string;
        resolvedBy: string | null;
        resolutionNotes: string | null;
        overrideAction?: boolean;
    },
) {
    const patch = {
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: input.resolvedBy,
        resolution_notes: input.resolutionNotes,
    };
    const { data, error } = await client
        .from('cire_incidents')
        .update(patch)
        .eq('tenant_id', input.tenantId)
        .eq('id', input.incidentId)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to resolve CIRE incident: ${error?.message ?? 'Unknown error'}`);
    }

    await writeGovernanceAuditEvent(client, {
        tenantId: input.tenantId,
        actor: input.resolvedBy,
        eventType: input.overrideAction ? 'governance_override' : 'cire_incident_resolved',
        payload: {
            cire_incident_id: input.incidentId,
            resolution_notes: input.resolutionNotes,
        },
    }).catch(() => undefined);

    return normalizeIncidentRow(data as Record<string, unknown>);
}

export async function getLatestCollapseProfile(
    client: SupabaseClient,
    tenantId: string,
    modelVersion?: string | null,
): Promise<CireCollapseProfile | null> {
    let query = client
        .from('cire_collapse_profiles')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('calibrated_at', { ascending: false })
        .limit(10);

    if (modelVersion) {
        query = query.eq('model_version', modelVersion);
    }

    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to load CIRE collapse profile: ${error.message}`);
    }

    const row = ((data ?? []) as Array<Record<string, unknown>>)[0];
    return row ? normalizeCollapseProfile(row) : null;
}

export async function getPhiHistory(
    client: SupabaseClient,
    input: {
        tenantId: string;
        from?: string | null;
        to?: string | null;
        granularity?: 'minute' | 'hour' | 'day';
    },
) {
    const { data, error } = await client
        .from('cire_snapshots')
        .select('*')
        .eq('tenant_id', input.tenantId)
        .order('created_at', { ascending: true })
        .limit(5000);

    if (error) {
        throw new Error(`Failed to load CIRE phi history: ${error.message}`);
    }

    const fromMs = input.from ? Date.parse(input.from) : null;
    const toMs = input.to ? Date.parse(input.to) : null;
    const granularity = input.granularity ?? 'hour';
    const buckets = new Map<string, {
        phi: number[];
        cps: number[];
        incidents: number;
        timestamp: string;
    }>();

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const createdAt = readText(row.created_at);
        if (!createdAt) continue;
        const timestampMs = Date.parse(createdAt);
        if (fromMs && timestampMs < fromMs) continue;
        if (toMs && timestampMs > toMs) continue;

        const bucketKey = bucketTimestamp(createdAt, granularity);
        const bucket = buckets.get(bucketKey) ?? {
            phi: [],
            cps: [],
            incidents: 0,
            timestamp: bucketKey,
        };
        const phi = readNumber(row.phi_hat);
        const cps = readNumber(row.cps);
        if (phi != null) bucket.phi.push(phi);
        if (cps != null) bucket.cps.push(cps);
        if (readText(row.safety_state) === 'critical' || readText(row.safety_state) === 'blocked') {
            bucket.incidents += 1;
        }
        buckets.set(bucketKey, bucket);
    }

    return Array.from(buckets.values()).map((bucket) => ({
        timestamp: bucket.timestamp,
        phi_mean: roundNumber(mean(bucket.phi) ?? 0, 6),
        cps_mean: roundNumber(mean(bucket.cps) ?? 0, 6),
        incident_count: bucket.incidents,
    }));
}

export async function storeCollapseProfile(
    client: SupabaseClient,
    input: {
        tenantId: string;
        modelVersion: string;
        phiBaseline: number;
        mThresholdMap: Record<string, unknown>;
        hii: number | null;
        phiCurve: Array<Record<string, unknown>>;
        simulationId: string | null;
    },
) {
    const payload = {
        tenant_id: input.tenantId,
        model_version: input.modelVersion,
        phi_baseline: input.phiBaseline,
        m_threshold_map: input.mThresholdMap,
        hii: input.hii,
        phi_curve: input.phiCurve,
        simulation_id: input.simulationId,
    };
    const { data, error } = await client
        .from('cire_collapse_profiles')
        .insert(payload)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to store CIRE collapse profile: ${error?.message ?? 'Unknown error'}`);
    }

    if (input.hii != null && input.hii > 0.3) {
        await createPlatformAlert(client, {
            tenantId: input.tenantId,
            type: 'cire_hysteresis_warning',
            severity: 'high',
            title: 'CIRE HII RETRAINING ALERT',
            message: `Collapse hysteresis irreversibility index reached ${roundNumber(input.hii, 4)}.`,
            metadata: {
                model_version: input.modelVersion,
                simulation_id: input.simulationId,
                hii: input.hii,
            },
        }).catch(() => undefined);
    }

    return normalizeCollapseProfile(data as Record<string, unknown>);
}

export async function startCireCalibration(
    client: SupabaseClient,
    input: {
        actor: PlatformActor;
        tenantId: string;
    },
) {
    const activeModel = await getActiveModelVersion(client, input.tenantId);
    if (!activeModel) {
        throw new Error('No active production model is available for CIRE calibration.');
    }

    const simulation = await startSimulationRun(client, {
        actor: input.actor,
        tenantId: input.tenantId,
        mode: 'adversarial',
        scenarioName: 'CIRE Calibration Sweep',
        config: {
            cire_calibration: true,
            model_version: activeModel,
            m_steps: 12,
            samples_per_step: 12,
            include_hysteresis_test: true,
            categories: ['gibberish', 'conflicting_inputs', 'injection'],
            prompts_per_category: 8,
        },
    });

    return {
        simulation_id: simulation.id,
        estimated_duration_seconds: 180,
    };
}

export function extractDifferentialVector(outputPayload: Record<string, unknown>) {
    const vector = extractProbabilityVectorFromOutput(outputPayload, 'diagnosis.top_differentials');
    if (vector.length > 0) {
        return vector;
    }

    const diagnosis = asRecord(outputPayload.diagnosis);
    const topDiffs = Array.isArray(diagnosis.top_differentials) ? diagnosis.top_differentials : [];
    return topDiffs
        .map((entry) => readNumber(asRecord(entry).probability))
        .filter((value): value is number => value != null);
}

async function insertCireSnapshot(
    client: SupabaseClient,
    snapshot: CireSnapshot,
) {
    const { data, error } = await client
        .from('cire_snapshots')
        .insert(snapshot)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to persist CIRE snapshot: ${error?.message ?? 'Unknown error'}`);
    }

    return {
        ...snapshot,
        id: readText(data.id) ?? undefined,
        created_at: readText(data.created_at) ?? undefined,
    };
}

async function createCireIncident(
    client: SupabaseClient,
    input: Omit<CireIncident, 'id' | 'resolved' | 'resolved_at' | 'resolved_by' | 'created_at' | 'resolution_notes'>,
) {
    const payload = {
        inference_id: input.inference_id,
        tenant_id: input.tenant_id,
        safety_state: input.safety_state,
        phi_hat: input.phi_hat,
        cps: input.cps,
        input_summary: input.input_summary,
    };
    const { data, error } = await client
        .from('cire_incidents')
        .insert(payload)
        .select('*')
        .single();

    if (error || !data) {
        throw new Error(`Failed to persist CIRE incident: ${error?.message ?? 'Unknown error'}`);
    }

    return normalizeIncidentRow(data as Record<string, unknown>);
}

function buildInputSummary(input: InferenceInput, inputMHat: number) {
    const normalized = asRecord(input.input?.input_signature ?? input.input_signature ?? input);
    return {
        species: readText(normalized.species),
        breed: readText(normalized.breed),
        symptom_count: Array.isArray(normalized.symptoms) ? normalized.symptoms.length : 0,
        region: readText(asRecord(normalized.metadata).region),
        urgency: readText(asRecord(normalized.metadata).urgency),
        input_m_hat: roundNumber(inputMHat, 6),
    };
}

function normalizeIncidentRow(row: Record<string, unknown>): CireIncident {
    return {
        id: readText(row.id) ?? randomUUID(),
        inference_id: readText(row.inference_id) ?? '',
        tenant_id: readText(row.tenant_id) ?? '',
        safety_state: (readText(row.safety_state) ?? 'warning') as SafetyState,
        phi_hat: readNumber(row.phi_hat),
        cps: readNumber(row.cps),
        input_summary: asRecord(row.input_summary),
        resolution_notes: readText(row.resolution_notes),
        resolved: row.resolved === true,
        resolved_at: readText(row.resolved_at),
        resolved_by: readText(row.resolved_by),
        created_at: readText(row.created_at) ?? new Date().toISOString(),
    };
}

function normalizeCollapseProfile(row: Record<string, unknown>): CireCollapseProfile {
    return {
        id: readText(row.id) ?? randomUUID(),
        tenant_id: readText(row.tenant_id) ?? '',
        model_version: readText(row.model_version) ?? '',
        phi_baseline: readNumber(row.phi_baseline) ?? 1,
        m_threshold_map: asRecord(row.m_threshold_map),
        hii: readNumber(row.hii),
        phi_curve: Array.isArray(row.phi_curve) ? row.phi_curve as Array<Record<string, unknown>> : [],
        calibrated_at: readText(row.calibrated_at) ?? new Date().toISOString(),
        simulation_id: readText(row.simulation_id),
    };
}

function countByState(rows: Array<Record<string, unknown>>, state: SafetyState) {
    return rows.filter((row) => readText(row.safety_state) === state).length;
}

function bucketTimestamp(timestamp: string, granularity: 'minute' | 'hour' | 'day') {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    if (granularity === 'day') {
        date.setUTCHours(0, 0, 0, 0);
    } else if (granularity === 'hour') {
        date.setUTCMinutes(0, 0, 0);
    } else {
        date.setUTCSeconds(0, 0);
    }
    return date.toISOString();
}

function compareCreatedDesc(left: Record<string, unknown>, right: Record<string, unknown>) {
    return Date.parse(readText(right.created_at) ?? '') - Date.parse(readText(left.created_at) ?? '');
}

function isWithinDays(timestamp: string | null, days: number) {
    if (!timestamp) return false;
    const delta = Date.now() - Date.parse(timestamp);
    return Number.isFinite(delta) && delta <= (days * 24 * 60 * 60 * 1000);
}

function mean(values: number[]) {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isNumber(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function normalizeNumberArray(value: unknown) {
    return Array.isArray(value)
        ? value.map((entry) => readNumber(entry)).filter((entry): entry is number => entry != null)
        : [];
}

function roundNumber(value: number, precision: number) {
    return Number(value.toFixed(precision));
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

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
