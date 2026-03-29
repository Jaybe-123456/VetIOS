import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { applyDecisionEngineToTopologySnapshot, evaluateDecisionEngine } from '@/lib/decisionEngine/service';
import { createSupabaseExperimentTrackingStore } from '@/lib/experiments/supabaseStore';
import { getModelRegistryControlPlaneSnapshot } from '@/lib/experiments/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { resolveTopologySimulationTarget, getTopologySnapshot } from '@/lib/intelligence/topologyService';
import { logSimulation } from '@/lib/logging/simulationLogger';
import { buildControlPlanePermissionSet, resolveControlPlaneRole } from '@/lib/settings/permissions';
import { getControlPlaneSimulationMode } from '@/lib/settings/controlPlane';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { emitTelemetryEvent, telemetrySimulationEventId } from '@/lib/telemetry/service';
import type { TopologySimulationScenario, TopologyWindow } from '@/lib/intelligence/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_WINDOWS: TopologyWindow[] = ['1h', '24h'];
const VALID_TARGETS = new Set([
    'control_plane',
    'registry_control',
    'telemetry_observer',
    'clinic_network',
    'dataset_hub',
    'diagnostics_model',
    'vision_model',
    'therapeutics_model',
    'decision_fabric',
    'outcome_feedback',
    'simulation_cluster',
]);

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const actor = resolveRequestActor(session);
    const url = new URL(req.url);
    const window = resolveWindow(url.searchParams.get('window'));
    const until = url.searchParams.get('until');

    try {
        const client = getSupabaseServer();
        const snapshot = await getTopologySnapshot(client, actor.tenantId, {
            window,
            until,
            observerHeartbeatTimestamp: until ? null : new Date().toISOString(),
        });
        const decisionEngine = await evaluateDecisionEngine({
            client,
            tenantId: actor.tenantId,
            topologySnapshot: snapshot,
            triggerSource: 'topology_api',
            readOnly: true,
        });
        const enrichedSnapshot = applyDecisionEngineToTopologySnapshot(snapshot, decisionEngine);

        const response = NextResponse.json({
            snapshot: enrichedSnapshot,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] GET /api/intelligence/topology Error:`, error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Unknown error',
                request_id: requestId,
            },
            { status: 500 },
        );
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const actor = resolveRequestActor(session);
    const userContext = await resolveUserContext(session);
    const currentRole = resolveControlPlaneRole(userContext.user, userContext.auth_mode);
    const permissionSet = buildControlPlanePermissionSet(currentRole);
    const parsed = await safeJson<{
        scenario?: TopologySimulationScenario;
        target_node_id?: string;
        severity?: 'degraded' | 'critical';
    }>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const scenario = parsed.data.scenario;
    const targetNodeId = parsed.data.target_node_id;
    const severity = parsed.data.severity === 'degraded' ? 'degraded' : 'critical';
    if (!scenario || !isSimulationScenario(scenario) || !targetNodeId || !VALID_TARGETS.has(targetNodeId)) {
        return NextResponse.json(
            { error: 'Invalid simulation payload.', request_id: requestId },
            { status: 400 },
        );
    }
    if (!permissionSet.can_run_simulations) {
        return NextResponse.json(
            { error: 'Simulation operator role required for topology simulation.', request_id: requestId },
            { status: 403 },
        );
    }

    try {
        const client = getSupabaseServer();
        const simulationMode = await getControlPlaneSimulationMode(client, actor.tenantId);
        if (!simulationMode.simulation_enabled) {
            return NextResponse.json(
                { error: 'Enable simulation mode before injecting topology scenarios.', request_id: requestId },
                { status: 409 },
            );
        }
        const experimentStore = createSupabaseExperimentTrackingStore(client);
        const controlPlane = await getModelRegistryControlPlaneSnapshot(experimentStore, actor.tenantId);
        const target = resolveTopologySimulationTarget(controlPlane, targetNodeId);
        const profile = buildInjectionProfile(scenario, severity, targetNodeId);
        const simulationEventId = randomUUID();
        const timestamp = new Date().toISOString();

        await logSimulation(client, {
            id: simulationEventId,
            tenant_id: actor.tenantId,
            user_id: actor.userId,
            source_module: 'intelligence_topology',
            simulation_type: `topology_${scenario}`,
            simulation_parameters: {
                target_node_id: targetNodeId,
                severity,
            },
            triggered_inference_id: null,
            failure_mode: severity === 'critical' ? scenario : null,
            stress_metrics: {
                ...profile,
                model_version: target.model_version,
                run_id: target.run_id,
            },
            is_real_world: false,
        });

        await emitTelemetryEvent(client, {
            event_id: telemetrySimulationEventId(simulationEventId),
            tenant_id: actor.tenantId,
            linked_event_id: null,
            source_id: simulationEventId,
            source_table: 'edge_simulation_events',
            event_type: 'simulation',
            timestamp,
            model_version: target.model_version,
            run_id: target.run_id,
            metrics: {
                latency_ms: profile.latency_ms,
                confidence: profile.confidence_avg,
                prediction: targetNodeId,
            },
            system: {
                cpu: profile.cpu,
                gpu: profile.gpu,
                memory: profile.memory,
            },
            metadata: {
                source_module: 'intelligence_topology',
                target_node_id: targetNodeId,
                scenario,
                synthetic: true,
                injected_status: profile.status,
                injected_latency_ms: profile.latency_ms,
                injected_error_rate: profile.error_rate,
                injected_drift_score: profile.drift_score,
                injected_confidence_avg: profile.confidence_avg,
                request_id: requestId,
                simulation_event_id: simulationEventId,
            },
        });

        const response = NextResponse.json({
            injected: true,
            simulation_event_id: simulationEventId,
            telemetry_event_id: telemetrySimulationEventId(simulationEventId),
            target,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        console.error(`[${requestId}] POST /api/intelligence/topology Error:`, error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Unknown error',
                request_id: requestId,
            },
            { status: 500 },
        );
    }
}

function resolveWindow(value: string | null): TopologyWindow {
    return VALID_WINDOWS.includes(value as TopologyWindow) ? value as TopologyWindow : '24h';
}

async function resolveUserContext(session: Awaited<ReturnType<typeof resolveSessionTenant>>) {
    if (!session) {
        return {
            user: null,
            auth_mode: 'dev_bypass' as const,
        };
    }

    const userResult = await session.supabase.auth.getUser();
    return {
        user: userResult.data.user ?? null,
        auth_mode: 'session' as const,
    };
}

function isSimulationScenario(value: string): value is TopologySimulationScenario {
    return value === 'failure' || value === 'drift' || value === 'adversarial_attack';
}

function buildInjectionProfile(
    scenario: TopologySimulationScenario,
    severity: 'degraded' | 'critical',
    targetNodeId: string,
) {
    const isCritical = severity === 'critical';

    if (scenario === 'drift') {
        return {
            status: isCritical ? 'critical' : 'degraded',
            latency_ms: isCritical ? 1_200 : 820,
            error_rate: isCritical ? 0.16 : 0.08,
            drift_score: isCritical ? 0.34 : 0.18,
            confidence_avg: isCritical ? 0.48 : 0.66,
            cpu: 0.74,
            gpu: 0.69,
            memory: 0.72,
            target_node_id: targetNodeId,
        };
    }

    if (scenario === 'adversarial_attack') {
        return {
            status: 'critical',
            latency_ms: 2_600,
            error_rate: 0.22,
            drift_score: 0.29,
            confidence_avg: 0.41,
            cpu: 0.91,
            gpu: 0.88,
            memory: 0.84,
            target_node_id: targetNodeId,
        };
    }

    return {
        status: isCritical ? 'critical' : 'degraded',
        latency_ms: isCritical ? 2_300 : 1_050,
        error_rate: isCritical ? 0.19 : 0.09,
        drift_score: isCritical ? 0.14 : 0.08,
        confidence_avg: isCritical ? 0.46 : 0.63,
        cpu: isCritical ? 0.86 : 0.68,
        gpu: isCritical ? 0.74 : 0.54,
        memory: isCritical ? 0.8 : 0.61,
        target_node_id: targetNodeId,
    };
}
