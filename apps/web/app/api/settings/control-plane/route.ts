import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { resolveRequestActor } from '@/lib/auth/requestActor';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    backfillEvaluationEvents,
    createControlPlaneApiKey,
    emitControlPlaneSystemEvent,
    getControlPlaneSnapshot,
    injectControlPlaneSimulation,
    markControlPlaneAlertResolved,
    recordControlPlaneAction,
    revokeControlPlaneApiKey,
    runDatasetBackfill,
    runRegistryControlAction,
    updateControlPlaneConfig,
    updateControlPlaneProfile,
} from '@/lib/settings/controlPlane';
import { emitTelemetryHeartbeat } from '@/lib/telemetry/service';
import type {
    ControlPlaneAlertSensitivity,
    ControlPlaneSimulationScenario,
    ControlPlaneUserRole,
} from '@/lib/settings/types';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SettingsControlAction =
    | {
        action: 'update_profile';
        organization?: string | null;
        role?: ControlPlaneUserRole;
    }
    | {
        action: 'generate_api_key';
        label?: string;
        scopes?: string[];
    }
    | {
        action: 'revoke_api_key';
        api_key_id?: string;
    }
    | {
        action: 'update_config';
        config?: {
            latency_threshold_ms?: number;
            drift_threshold?: number;
            confidence_threshold?: number;
            alert_sensitivity?: ControlPlaneAlertSensitivity;
            simulation_enabled?: boolean;
            decision_mode?: 'observe' | 'assist' | 'autonomous';
            safe_mode_enabled?: boolean;
            abstain_threshold?: number;
            auto_execute_confidence_threshold?: number;
        };
    }
    | {
        action: 'run_system_diagnostic';
    }
    | {
        action: 'resolve_alert';
        alert_id?: string;
    }
    | {
        action: 'registry_action';
        run_id?: string;
        registry_action?: 'promote_to_staging' | 'promote_to_production' | 'archive' | 'rollback';
        reason?: string;
        incident_id?: string | null;
    }
    | {
        action: 'inject_simulation';
        scenario?: ControlPlaneSimulationScenario;
        target_node_id?: string;
        severity?: 'degraded' | 'critical';
    }
    | {
        action: 'restart_telemetry_stream' | 'reinitialize_pipelines' | 'reindex_dataset' | 'backfill_evaluation_events';
    };

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    try {
        const actor = resolveRequestActor(session);
        const adminClient = getSupabaseServer();
        await emitTelemetryHeartbeat(adminClient, {
            tenantId: actor.tenantId,
            source: 'settings_control_plane',
            targetNodeId: 'telemetry_observer',
            metadata: {
                view: 'settings',
            },
        });
        const userContext = await resolveUserContext(session);
        const snapshot = await getControlPlaneSnapshot({
            client: adminClient,
            tenantId: actor.tenantId,
            userId: actor.userId,
            userContext,
        });

        const response = NextResponse.json({
            snapshot,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error', request_id: requestId },
            { status: 500 },
        );
    }
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 20, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session && process.env.VETIOS_DEV_BYPASS !== 'true') {
        return NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    }

    const parsed = await safeJson<SettingsControlAction>(req);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, request_id: requestId }, { status: 400 });
    }

    const adminClient = getSupabaseServer();
    const actor = resolveRequestActor(session);
    const userContext = await resolveUserContext(session);
    const currentRole = resolveRole(userContext.user, userContext.auth_mode);

    try {
        const payload = parsed.data;
        let actionResult: Record<string, unknown> = {};
        const requiresAdmin = isAdminOnlyAction(payload.action);
        if (requiresAdmin && currentRole !== 'admin') {
            return NextResponse.json(
                { error: 'Admin role required for this control-plane action.', request_id: requestId },
                { status: 403 },
            );
        }

        if (payload.action === 'update_profile') {
            if (!actor.userId) {
                throw new Error('A valid user session is required to update profile metadata.');
            }
            if (payload.role && currentRole !== 'admin') {
                throw new Error('Only admins can change user roles.');
            }
            await updateControlPlaneProfile({
                adminClient,
                userId: actor.userId,
                currentUser: userContext.user,
                organization: payload.organization,
                role: payload.role,
            });
            actionResult = { updated_profile: true };
        } else if (payload.action === 'generate_api_key') {
            if (!payload.label || payload.label.trim().length === 0) {
                throw new Error('label is required');
            }
            const generated = await createControlPlaneApiKey({
                client: adminClient,
                tenantId: actor.tenantId,
                actor: actor.userId,
                label: payload.label.trim(),
                scopes: Array.isArray(payload.scopes) && payload.scopes.length > 0 ? payload.scopes : ['tenant.read', 'tenant.write'],
            });
            actionResult = {
                generated_api_key: generated.key,
                api_key_record: generated.record,
            };
        } else if (payload.action === 'revoke_api_key') {
            if (!payload.api_key_id) throw new Error('api_key_id is required');
            actionResult = {
                api_key_record: await revokeControlPlaneApiKey({
                    client: adminClient,
                    tenantId: actor.tenantId,
                    actor: actor.userId,
                    apiKeyId: payload.api_key_id,
                }),
            };
        } else if (payload.action === 'update_config') {
            const config = payload.config ?? {};
            validateConfig(config);
            actionResult = {
                configuration: await updateControlPlaneConfig({
                    client: adminClient,
                    tenantId: actor.tenantId,
                    actor: actor.userId,
                    patch: config,
                }),
            };
        } else if (payload.action === 'run_system_diagnostic') {
            const snapshot = await getControlPlaneSnapshot({
                client: adminClient,
                tenantId: actor.tenantId,
                userId: actor.userId,
                userContext,
            });
            actionResult = {
                diagnostics: snapshot.diagnostics,
                pipelines: snapshot.pipelines,
            };
        } else if (payload.action === 'resolve_alert') {
            if (!payload.alert_id) throw new Error('alert_id is required');
            await markControlPlaneAlertResolved({
                client: adminClient,
                tenantId: actor.tenantId,
                alertId: payload.alert_id,
            });
            actionResult = { resolved_alert_id: payload.alert_id };
        } else if (payload.action === 'registry_action') {
            if (!payload.run_id || !payload.registry_action) {
                throw new Error('run_id and registry_action are required');
            }
            actionResult = {
                registry: await runRegistryControlAction({
                    client: adminClient,
                    tenantId: actor.tenantId,
                    runId: payload.run_id,
                    actor: actor.userId,
                    action: payload.registry_action,
                    reason: payload.reason,
                    incidentId: payload.incident_id ?? null,
                }),
            };
        } else if (payload.action === 'inject_simulation') {
            if (!payload.scenario || !payload.target_node_id) {
                throw new Error('scenario and target_node_id are required');
            }
            actionResult = await injectControlPlaneSimulation({
                client: adminClient,
                tenantId: actor.tenantId,
                actor: actor.userId,
                scenario: payload.scenario,
                targetNodeId: payload.target_node_id,
                severity: payload.severity === 'degraded' ? 'degraded' : 'critical',
            });
        } else if (payload.action === 'restart_telemetry_stream' || payload.action === 'reinitialize_pipelines') {
            await emitControlPlaneSystemEvent({
                client: adminClient,
                tenantId: actor.tenantId,
                actor: actor.userId,
                action: payload.action,
            });
            actionResult = { accepted: true, action: payload.action };
        } else if (payload.action === 'reindex_dataset') {
            actionResult = {
                backfill: await runDatasetBackfill(adminClient, actor.tenantId),
            };
        } else if (payload.action === 'backfill_evaluation_events') {
            actionResult = await backfillEvaluationEvents({
                client: adminClient,
                tenantId: actor.tenantId,
            });
        } else {
            throw new Error('Unsupported control-plane action.');
        }

        await recordControlPlaneAction({
            client: adminClient,
            tenantId: actor.tenantId,
            actor: actor.userId,
            actionType: payload.action === 'registry_action' ? `${payload.action}:${payload.registry_action}` : payload.action,
            status: 'completed',
            targetType: resolveTargetType(payload),
            targetId: resolveTargetId(payload),
            requiresConfirmation: requiresConfirmation(payload.action),
            metadata: actionResult,
        });

        const snapshot = await getControlPlaneSnapshot({
            client: adminClient,
            tenantId: actor.tenantId,
            userId: actor.userId,
            userContext,
        });

        const response = NextResponse.json({
            result: actionResult,
            snapshot,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        await recordControlPlaneAction({
            client: adminClient,
            tenantId: actor.tenantId,
            actor: actor.userId,
            actionType: parsed.data.action,
            status: 'failed',
            targetType: resolveTargetType(parsed.data),
            targetId: resolveTargetId(parsed.data),
            requiresConfirmation: requiresConfirmation(parsed.data.action),
            metadata: {
                error: error instanceof Error ? error.message : 'Unknown error',
            },
        });

        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error', request_id: requestId },
            { status: 500 },
        );
    }
}

async function resolveUserContext(session: Awaited<ReturnType<typeof resolveSessionTenant>>) {
    if (!session) {
        return {
            user: null,
            token_expiry: null,
            auth_mode: 'dev_bypass' as const,
        };
    }

    const [userResult, sessionResult] = await Promise.all([
        session.supabase.auth.getUser(),
        session.supabase.auth.getSession(),
    ]);

    return {
        user: userResult.data.user ?? null,
        token_expiry: sessionResult.data.session?.expires_at
            ? new Date(sessionResult.data.session.expires_at * 1000).toISOString()
            : null,
        auth_mode: 'session' as const,
    };
}

function resolveRole(user: User | null, authMode: 'session' | 'dev_bypass'): ControlPlaneUserRole {
    if (authMode === 'dev_bypass') return 'admin';
    const metadata = asRecord(user?.user_metadata);
    const appMetadata = asRecord(user?.app_metadata);
    const candidate = textOrNull(metadata.role) ?? textOrNull(appMetadata.role);
    if (candidate === 'admin' || candidate === 'researcher' || candidate === 'clinician' || candidate === 'developer') {
        return candidate;
    }
    return 'developer';
}

function isAdminOnlyAction(action: SettingsControlAction['action']) {
    return action === 'generate_api_key'
        || action === 'revoke_api_key'
        || action === 'update_config'
        || action === 'registry_action'
        || action === 'inject_simulation'
        || action === 'restart_telemetry_stream'
        || action === 'reinitialize_pipelines'
        || action === 'reindex_dataset'
        || action === 'backfill_evaluation_events';
}

function requiresConfirmation(action: SettingsControlAction['action']) {
    return action === 'registry_action'
        || action === 'revoke_api_key'
        || action === 'restart_telemetry_stream'
        || action === 'reinitialize_pipelines'
        || action === 'reindex_dataset'
        || action === 'backfill_evaluation_events';
}

function resolveTargetType(payload: SettingsControlAction) {
    if (payload.action === 'revoke_api_key') return 'api_key';
    if (payload.action === 'resolve_alert') return 'alert';
    if (payload.action === 'registry_action') return 'registry_run';
    if (payload.action === 'inject_simulation') return 'topology_node';
    return null;
}

function resolveTargetId(payload: SettingsControlAction) {
    if (payload.action === 'revoke_api_key') return payload.api_key_id ?? null;
    if (payload.action === 'resolve_alert') return payload.alert_id ?? null;
    if (payload.action === 'registry_action') return payload.run_id ?? null;
    if (payload.action === 'inject_simulation') return payload.target_node_id ?? null;
    return null;
}

function validateConfig(config: NonNullable<Extract<SettingsControlAction, { action: 'update_config' }>['config']>) {
    if (config.latency_threshold_ms != null && (config.latency_threshold_ms < 50 || config.latency_threshold_ms > 10000)) {
        throw new Error('latency_threshold_ms must be between 50 and 10000');
    }
    if (config.drift_threshold != null && (config.drift_threshold < 0 || config.drift_threshold > 1)) {
        throw new Error('drift_threshold must be between 0 and 1');
    }
    if (config.confidence_threshold != null && (config.confidence_threshold < 0 || config.confidence_threshold > 1)) {
        throw new Error('confidence_threshold must be between 0 and 1');
    }
    if (config.abstain_threshold != null && (config.abstain_threshold < 0 || config.abstain_threshold > 1)) {
        throw new Error('abstain_threshold must be between 0 and 1');
    }
    if (config.auto_execute_confidence_threshold != null && (config.auto_execute_confidence_threshold < 0 || config.auto_execute_confidence_threshold > 1)) {
        throw new Error('auto_execute_confidence_threshold must be between 0 and 1');
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function textOrNull(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
