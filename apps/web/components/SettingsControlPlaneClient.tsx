'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import DeveloperApiExplorer from '@/components/DeveloperApiExplorer';
import {
    ConsoleCard,
    Container,
    DataRow,
    PageHeader,
    TerminalButton,
    TerminalInput,
    TerminalLabel,
    TerminalTextarea,
} from '@/components/ui/terminal';
import { getSupabaseBrowser } from '@/lib/supabaseBrowser';
import type {
    ControlPlaneAlertSensitivity,
    ControlPlaneLogRecord,
    ControlPlanePipelineState,
    ControlPlaneSimulationScenario,
    ControlPlaneSnapshot,
    ControlPlaneSnapshotResponse,
    ControlPlaneUserRole,
} from '@/lib/settings/types';
import {
    Activity,
    AlertTriangle,
    Bug,
    Gauge,
    KeyRound,
    RefreshCw,
    RotateCcw,
    Settings2,
    ShieldCheck,
    UserCog,
    Wifi,
} from 'lucide-react';

type ControlPlaneTab =
    | 'profile'
    | 'access'
    | 'health'
    | 'pipelines'
    | 'governance'
    | 'debug'
    | 'simulation'
    | 'logs'
    | 'configuration'
    | 'alerts';

const TABS: Array<{ id: ControlPlaneTab; label: string }> = [
    { id: 'profile', label: 'Profile' },
    { id: 'access', label: 'Access & Security' },
    { id: 'health', label: 'System Health' },
    { id: 'pipelines', label: 'Pipelines' },
    { id: 'governance', label: 'Model Governance' },
    { id: 'debug', label: 'Debug Tools' },
    { id: 'simulation', label: 'Simulation' },
    { id: 'logs', label: 'Logs' },
    { id: 'configuration', label: 'Configuration' },
    { id: 'alerts', label: 'Alerts' },
];

const SIMULATION_TARGETS = [
    { id: 'diagnostics_model', label: 'Diagnostics Model' },
    { id: 'vision_model', label: 'Vision Model' },
    { id: 'therapeutics_model', label: 'Therapeutics Model' },
    { id: 'clinic_network', label: 'Clinic Network' },
    { id: 'dataset_hub', label: 'Clinical Data Hub' },
    { id: 'simulation_cluster', label: 'Simulation Cluster' },
    { id: 'control_plane', label: 'Control Plane' },
] as const;

export default function SettingsControlPlaneClient() {
    const [activeTab, setActiveTab] = useState<ControlPlaneTab>('profile');
    const [snapshot, setSnapshot] = useState<ControlPlaneSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionState, setActionState] = useState<{ status: 'idle' | 'running' | 'success' | 'error'; message: string; payload?: unknown }>({
        status: 'idle',
        message: '',
    });
    const [browserSession, setBrowserSession] = useState<Session | null>(null);
    const [profileDraft, setProfileDraft] = useState<{ organization: string; role: ControlPlaneUserRole }>({
        organization: '',
        role: 'developer',
    });
    const [configDraft, setConfigDraft] = useState({
        latency_threshold_ms: 900,
        drift_threshold: 0.2,
        confidence_threshold: 0.65,
        alert_sensitivity: 'balanced' as ControlPlaneAlertSensitivity,
        simulation_enabled: false,
        decision_mode: 'observe' as ControlPlaneSnapshot['configuration']['decision_mode'],
        safe_mode_enabled: false,
        abstain_threshold: 0.8,
        auto_execute_confidence_threshold: 0.9,
    });
    const [newKeyLabel, setNewKeyLabel] = useState('VetIOS operator key');
    const [newKeyScopes, setNewKeyScopes] = useState('tenant.read,tenant.write');
    const [selectedSimulationTarget, setSelectedSimulationTarget] = useState<string>('diagnostics_model');
    const [selectedSimulationSeverity, setSelectedSimulationSeverity] = useState<'degraded' | 'critical'>('critical');
    const [logFilter, setLogFilter] = useState({
        eventType: 'all',
        runId: '',
        modelVersion: '',
    });

    useEffect(() => {
        void refreshSnapshot(true);

        const interval = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            void refreshSnapshot(false);
        }, 60_000);

        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        const supabase = getSupabaseBrowser();
        supabase.auth.getSession().then(({ data }) => {
            setBrowserSession(data.session ?? null);
        });

        const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            setBrowserSession(nextSession);
        });

        return () => data.subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!snapshot) return;
        setProfileDraft({
            organization: snapshot.profile.organization ?? '',
            role: snapshot.profile.role,
        });
        setConfigDraft({
            latency_threshold_ms: snapshot.configuration.latency_threshold_ms,
            drift_threshold: snapshot.configuration.drift_threshold,
            confidence_threshold: snapshot.configuration.confidence_threshold,
            alert_sensitivity: snapshot.configuration.alert_sensitivity,
            simulation_enabled: snapshot.configuration.simulation_enabled,
            decision_mode: snapshot.configuration.decision_mode,
            safe_mode_enabled: snapshot.configuration.safe_mode_enabled,
            abstain_threshold: snapshot.configuration.abstain_threshold,
            auto_execute_confidence_threshold: snapshot.configuration.auto_execute_confidence_threshold,
        });
    }, [snapshot]);

    const filteredLogs = useMemo(() => {
        if (!snapshot) return [];
        return snapshot.logs.filter((log) => {
            const eventMatch = logFilter.eventType === 'all' || log.category === logFilter.eventType || log.event_type === logFilter.eventType;
            const runMatch = logFilter.runId.trim().length === 0 || (log.run_id ?? '').includes(logFilter.runId.trim());
            const modelMatch = logFilter.modelVersion.trim().length === 0 || (log.model_version ?? '').includes(logFilter.modelVersion.trim());
            return eventMatch && runMatch && modelMatch;
        });
    }, [logFilter, snapshot]);

    async function refreshSnapshot(initial = false) {
        if (initial) {
            setLoading(true);
        } else {
            setRefreshing(true);
        }
        setError(null);

        try {
            const res = await fetch('/api/settings/control-plane', { cache: 'no-store' });
            const data = await res.json() as ControlPlaneSnapshotResponse | { error?: string };
            if (!res.ok || !('snapshot' in data)) {
                throw new Error('error' in data && typeof data.error === 'string' ? data.error : 'Failed to load control plane');
            }
            setSnapshot(data.snapshot);
        } catch (fetchError) {
            setError(fetchError instanceof Error ? fetchError.message : 'Failed to load control plane');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    async function runAction(
        body: Record<string, unknown>,
        options: { confirmMessage?: string } = {},
    ) {
        if (options.confirmMessage && !window.confirm(options.confirmMessage)) {
            return;
        }

        setActionState({ status: 'running', message: 'Executing control-plane action...' });

        try {
            const res = await fetch('/api/settings/control-plane', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json() as { error?: string; result?: unknown; snapshot?: ControlPlaneSnapshot };
            if (!res.ok) {
                throw new Error(typeof data.error === 'string' ? data.error : 'Control-plane action failed');
            }
            if (data.snapshot) {
                setSnapshot(data.snapshot);
            }
            setActionState({
                status: 'success',
                message: `Action completed: ${String(body.action)}`,
                payload: data.result,
            });
        } catch (actionError) {
            setActionState({
                status: 'error',
                message: actionError instanceof Error ? actionError.message : 'Unknown control-plane error',
            });
        }
    }

    async function runProbe(label: string, endpoint: string, init?: RequestInit) {
        setActionState({ status: 'running', message: `Running probe: ${label}` });

        try {
            const res = await fetch(endpoint, init);
            const data = await res.json();
            setActionState({
                status: res.ok ? 'success' : 'error',
                message: `${label} returned ${res.status}`,
                payload: data,
            });
            if (res.ok) {
                await refreshSnapshot(false);
            }
        } catch (probeError) {
            setActionState({
                status: 'error',
                message: probeError instanceof Error ? probeError.message : `Probe failed: ${label}`,
            });
        }
    }

    async function runTelemetryStreamProbe() {
        setActionState({ status: 'running', message: 'Probing /telemetry/stream...' });

        try {
            const payload = await new Promise<unknown>((resolve, reject) => {
                const source = new EventSource('/telemetry/stream');
                const timeout = window.setTimeout(() => {
                    source.close();
                    reject(new Error('Timed out waiting for telemetry stream payload.'));
                }, 5000);

                source.onmessage = (event) => {
                    window.clearTimeout(timeout);
                    source.close();
                    resolve(JSON.parse(event.data) as unknown);
                };

                source.addEventListener('stream-error', (event) => {
                    window.clearTimeout(timeout);
                    source.close();
                    const messageEvent = event as MessageEvent<string>;
                    reject(new Error(messageEvent.data || 'Telemetry stream returned an error.'));
                });

                source.onerror = () => {
                    window.clearTimeout(timeout);
                    source.close();
                    reject(new Error('Telemetry stream connection failed.'));
                };
            });

            setActionState({
                status: 'success',
                message: 'Telemetry stream delivered a live payload.',
                payload,
            });
        } catch (streamError) {
            setActionState({
                status: 'error',
                message: streamError instanceof Error ? streamError.message : 'Telemetry stream probe failed.',
            });
        }
    }

    async function handleSignOut() {
        const supabase = getSupabaseBrowser();
        await supabase.auth.signOut();
        window.location.href = '/login';
    }

    async function handleRefreshSession() {
        const supabase = getSupabaseBrowser();
        const { data, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
            setActionState({ status: 'error', message: refreshError.message });
            return;
        }
        setBrowserSession(data.session ?? null);
        setActionState({ status: 'success', message: 'JWT session refreshed.', payload: data.session });
    }

    if (loading) {
        return (
            <Container>
                <PageHeader
                    title="VETIOS CONTROL PLANE"
                    description="Bootstrapping centralized system state, telemetry, governance, and access controls."
                />
                <ConsoleCard title="Initializing">
                    <div className="font-mono text-xs text-muted flex items-center gap-2">
                        <Activity className="w-4 h-4 animate-spin" />
                        Loading control-plane snapshot...
                    </div>
                </ConsoleCard>
            </Container>
        );
    }

    if (!snapshot) {
        return (
            <Container>
                <PageHeader
                    title="VETIOS CONTROL PLANE"
                    description="Centralized operating layer for access, infrastructure, telemetry, and governance."
                />
                <ConsoleCard title="Load Failure">
                    <div className="font-mono text-xs text-danger">{error ?? 'Failed to load control plane.'}</div>
                    <div className="pt-3">
                        <TerminalButton onClick={() => void refreshSnapshot(true)}>Retry</TerminalButton>
                    </div>
                </ConsoleCard>
            </Container>
        );
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader
                title="VETIOS CONTROL PLANE"
                description="Centralized operating system layer for access, debugging, infrastructure health, telemetry, simulation, and model governance."
            />

            <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 mb-6">
                <SummaryCard
                    icon={<UserCog className="w-4 h-4" />}
                    label="Operator Role"
                    value={snapshot.profile.role.toUpperCase()}
                    tone="accent"
                />
                <SummaryCard
                    icon={<Gauge className="w-4 h-4" />}
                    label="Network Health"
                    value={`${snapshot.system_health.network_health_score}%`}
                    tone={snapshot.system_health.network_health_score >= 80 ? 'accent' : snapshot.system_health.network_health_score >= 60 ? 'warning' : 'danger'}
                />
                <SummaryCard
                    icon={<Wifi className="w-4 h-4" />}
                    label="Telemetry Status"
                    value={snapshot.system_health.telemetry_status.toUpperCase()}
                    tone={snapshot.system_health.telemetry_status === 'connected' ? 'accent' : 'danger'}
                />
                <SummaryCard
                    icon={<AlertTriangle className="w-4 h-4" />}
                    label="Active Alerts"
                    value={String(snapshot.alerts.filter((alert) => !alert.resolved).length)}
                    tone={snapshot.alerts.some((alert) => !alert.resolved && alert.severity === 'critical') ? 'danger' : 'warning'}
                />
            </div>

            <ConsoleCard title="Control Actions" className="mb-6">
                <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="font-mono text-xs text-muted">
                        {refreshing ? 'Refreshing snapshot...' : `Last refreshed ${new Date(snapshot.refreshed_at).toLocaleTimeString()}`}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <TerminalButton variant="secondary" onClick={() => void refreshSnapshot(false)}>
                            <RefreshCw className="w-3 h-3 mr-2" />
                            Refresh Snapshot
                        </TerminalButton>
                        <TerminalButton variant="secondary" onClick={() => void runAction({ action: 'run_system_diagnostic' })}>
                            <ShieldCheck className="w-3 h-3 mr-2" />
                            Run System Diagnostic
                        </TerminalButton>
                    </div>
                </div>
                <ActionStatePanel actionState={actionState} />
            </ConsoleCard>

            <div className="flex flex-wrap gap-2 mb-6">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-3 py-2 border font-mono text-xs uppercase tracking-widest transition-colors ${
                            activeTab === tab.id
                                ? 'border-accent text-accent bg-accent/10'
                                : 'border-grid text-muted hover:border-muted hover:text-foreground'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {renderTab({
                activeTab,
                snapshot,
                browserSession,
                profileDraft,
                configDraft,
                newKeyLabel,
                newKeyScopes,
                selectedSimulationSeverity,
                selectedSimulationTarget,
                filteredLogs,
                logFilter,
                onProfileDraftChange: setProfileDraft,
                onConfigDraftChange: setConfigDraft,
                onNewKeyLabelChange: setNewKeyLabel,
                onNewKeyScopesChange: setNewKeyScopes,
                onSelectedSimulationSeverityChange: setSelectedSimulationSeverity,
                onSelectedSimulationTargetChange: setSelectedSimulationTarget,
                onLogFilterChange: setLogFilter,
                onRunAction: runAction,
                onRunProbe: runProbe,
                onRunTelemetryStreamProbe: runTelemetryStreamProbe,
                onSignOut: handleSignOut,
                onRefreshSession: handleRefreshSession,
            })}
        </Container>
    );
}

function renderTab(input: {
    activeTab: ControlPlaneTab;
    snapshot: ControlPlaneSnapshot;
    browserSession: Session | null;
    profileDraft: { organization: string; role: ControlPlaneUserRole };
    configDraft: {
        latency_threshold_ms: number;
        drift_threshold: number;
        confidence_threshold: number;
        alert_sensitivity: ControlPlaneAlertSensitivity;
        simulation_enabled: boolean;
        decision_mode: ControlPlaneSnapshot['configuration']['decision_mode'];
        safe_mode_enabled: boolean;
        abstain_threshold: number;
        auto_execute_confidence_threshold: number;
    };
    newKeyLabel: string;
    newKeyScopes: string;
    selectedSimulationTarget: string;
    selectedSimulationSeverity: 'degraded' | 'critical';
    filteredLogs: ControlPlaneLogRecord[];
    logFilter: {
        eventType: string;
        runId: string;
        modelVersion: string;
    };
    onProfileDraftChange: Dispatch<SetStateAction<{ organization: string; role: ControlPlaneUserRole }>>;
    onConfigDraftChange: Dispatch<SetStateAction<{
        latency_threshold_ms: number;
        drift_threshold: number;
        confidence_threshold: number;
        alert_sensitivity: ControlPlaneAlertSensitivity;
        simulation_enabled: boolean;
        decision_mode: ControlPlaneSnapshot['configuration']['decision_mode'];
        safe_mode_enabled: boolean;
        abstain_threshold: number;
        auto_execute_confidence_threshold: number;
    }>>;
    onNewKeyLabelChange: Dispatch<SetStateAction<string>>;
    onNewKeyScopesChange: Dispatch<SetStateAction<string>>;
    onSelectedSimulationTargetChange: Dispatch<SetStateAction<string>>;
    onSelectedSimulationSeverityChange: Dispatch<SetStateAction<'degraded' | 'critical'>>;
    onLogFilterChange: Dispatch<SetStateAction<{
        eventType: string;
        runId: string;
        modelVersion: string;
    }>>;
    onRunAction: (body: Record<string, unknown>, options?: { confirmMessage?: string }) => Promise<void>;
    onRunProbe: (label: string, endpoint: string, init?: RequestInit) => Promise<void>;
    onRunTelemetryStreamProbe: () => Promise<void>;
    onSignOut: () => Promise<void>;
    onRefreshSession: () => Promise<void>;
}) {
    const isAdmin = input.snapshot.profile.permission_set.can_manage_infrastructure;

    switch (input.activeTab) {
        case 'profile':
            return renderProfileTab(input);
        case 'access':
            return renderAccessTab(input);
        case 'health':
            return renderHealthTab(input.snapshot);
        case 'pipelines':
            return renderPipelinesTab(input.snapshot, input.onRunAction, isAdmin);
        case 'governance':
            return renderGovernanceTab(input.snapshot, input.onRunAction, isAdmin);
        case 'debug':
            return renderDebugTab(input.snapshot, input.onRunAction, input.onRunProbe, input.onRunTelemetryStreamProbe, isAdmin);
        case 'simulation':
            return renderSimulationTab(input, isAdmin);
        case 'logs':
            return renderLogsTab(input);
        case 'configuration':
            return renderConfigurationTab(input, isAdmin);
        case 'alerts':
            return renderAlertsTab(input.snapshot, input.onRunAction, isAdmin);
        default:
            return null;
    }
}

function SummaryCard({
    icon,
    label,
    value,
    tone,
}: {
    icon: ReactNode;
    label: string;
    value: string;
    tone: 'accent' | 'warning' | 'danger';
}) {
    const tones = {
        accent: 'border-accent/30 text-accent',
        warning: 'border-[#ffcc00]/30 text-[#ffcc00]',
        danger: 'border-danger/30 text-danger',
    } as const;

    return (
        <ConsoleCard className={`p-4 ${tones[tone]}`}>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted mb-2">
                {icon}
                {label}
            </div>
            <div className="font-mono text-2xl">{value}</div>
        </ConsoleCard>
    );
}

function ActionStatePanel({
    actionState,
}: {
    actionState: { status: 'idle' | 'running' | 'success' | 'error'; message: string; payload?: unknown };
}) {
    if (actionState.status === 'idle') {
        return (
            <div className="pt-4 font-mono text-xs text-muted">
                No control action has been executed in this session yet.
            </div>
        );
    }

    const tone = actionState.status === 'error'
        ? 'border-danger text-danger'
        : actionState.status === 'running'
            ? 'border-[#ffcc00] text-[#ffcc00]'
            : 'border-accent text-accent';

    return (
        <div className={`mt-4 border ${tone} bg-black/20 p-3 font-mono text-xs`}>
            <div>{actionState.message}</div>
            {actionState.payload != null && (
                <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[11px] text-foreground/80">
                    {JSON.stringify(actionState.payload, null, 2)}
                </pre>
            )}
        </div>
    );
}

function renderProfileTab(input: Parameters<typeof renderTab>[0]) {
    const canChangeRole = input.snapshot.profile.role === 'admin';

    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <ConsoleCard title="Account Profile">
                <div className="space-y-2">
                    <DataRow label="User ID" value={input.snapshot.profile.user_id ?? 'NO DATA'} />
                    <DataRow label="Email" value={input.snapshot.profile.email ?? 'NO DATA'} />
                    <DataRow label="Role" value={input.snapshot.profile.role.toUpperCase()} />
                    <DataRow label="Organization" value={input.snapshot.profile.organization ?? 'NO DATA'} />
                    <DataRow
                        label="Last Login"
                        value={input.snapshot.profile.last_login ? new Date(input.snapshot.profile.last_login).toLocaleString() : 'NO DATA'}
                    />
                </div>
            </ConsoleCard>

            <ConsoleCard title="Profile Editor">
                <div className="space-y-4">
                    <div>
                        <TerminalLabel>Organization</TerminalLabel>
                        <TerminalInput
                            value={input.profileDraft.organization}
                            onChange={(event) => input.onProfileDraftChange((current) => ({ ...current, organization: event.target.value }))}
                        />
                    </div>
                    <div>
                        <TerminalLabel>Role</TerminalLabel>
                        <select
                            value={input.profileDraft.role}
                            disabled={!canChangeRole}
                            onChange={(event) => input.onProfileDraftChange((current) => ({ ...current, role: event.target.value as ControlPlaneUserRole }))}
                            className="w-full bg-dim border border-grid p-3 font-mono text-sm text-foreground disabled:opacity-50"
                        >
                            <option value="admin">admin</option>
                            <option value="researcher">researcher</option>
                            <option value="clinician">clinician</option>
                            <option value="developer">developer</option>
                        </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <TerminalButton
                            onClick={() => void input.onRunAction({
                                action: 'update_profile',
                                organization: input.profileDraft.organization,
                                role: canChangeRole ? input.profileDraft.role : undefined,
                            })}
                        >
                            Save Profile
                        </TerminalButton>
                        <TerminalButton variant="secondary" onClick={() => void input.onSignOut()}>
                            Sign Out
                        </TerminalButton>
                    </div>
                    {!canChangeRole && (
                        <div className="font-mono text-[11px] text-muted">
                            Only admin operators can change role assignments.
                        </div>
                    )}
                </div>
            </ConsoleCard>

            <ConsoleCard title="Permissions">
                <div className="flex flex-wrap gap-2">
                    {input.snapshot.profile.permissions.map((permission) => (
                        <span key={permission} className="px-2 py-1 border border-grid font-mono text-[10px] uppercase tracking-widest text-muted">
                            {permission}
                        </span>
                    ))}
                </div>
            </ConsoleCard>
        </div>
    );
}

function renderAccessTab(input: Parameters<typeof renderTab>[0]) {
    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <ConsoleCard title="Access & Tokens" className="xl:col-span-2">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <DataRow label="Tenant ID" value={input.snapshot.access_security.tenant_id} />
                        <DataRow label="Auth Mode" value={input.snapshot.access_security.auth_mode.toUpperCase()} />
                        <DataRow
                            label="Token Expiry"
                            value={input.snapshot.access_security.token_expiry ? new Date(input.snapshot.access_security.token_expiry).toLocaleString() : 'NO DATA'}
                        />
                        <DataRow label="Scope" value={input.snapshot.access_security.access_scope.join(', ')} />
                    </div>
                    <div className="space-y-4">
                        <div>
                            <TerminalLabel>JWT Access Token</TerminalLabel>
                            <TerminalTextarea
                                className="min-h-[120px]"
                                readOnly
                                value={input.browserSession?.access_token ?? 'NO DATA'}
                            />
                        </div>
                        <div>
                            <TerminalLabel>Refresh Token</TerminalLabel>
                            <TerminalTextarea
                                className="min-h-[120px]"
                                readOnly
                                value={input.browserSession?.refresh_token ?? 'NO DATA'}
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <TerminalButton variant="secondary" onClick={() => void input.onRefreshSession()}>
                                Refresh JWT
                            </TerminalButton>
                        </div>
                    </div>
                </div>
            </ConsoleCard>

            <ConsoleCard title="Active Session">
                {input.snapshot.access_security.active_sessions.map((session) => (
                    <div key={session.session_id} className="mb-4 border border-grid/50 p-3">
                        <DataRow label="Session" value={session.label} />
                        <DataRow label="Current" value={session.current ? 'YES' : 'NO'} />
                        <DataRow
                            label="Expires"
                            value={session.expires_at ? new Date(session.expires_at).toLocaleString() : 'NO DATA'}
                        />
                        <DataRow label="Tenant Isolation" value={session.tenant_isolation} />
                    </div>
                ))}
            </ConsoleCard>

            <ConsoleCard title="API Key Management" className="xl:col-span-3">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                    <div className="space-y-4">
                        <div>
                            <TerminalLabel>Key Label</TerminalLabel>
                            <TerminalInput value={input.newKeyLabel} onChange={(event) => input.onNewKeyLabelChange(event.target.value)} />
                        </div>
                        <div>
                            <TerminalLabel>Scopes (comma separated)</TerminalLabel>
                            <TerminalInput value={input.newKeyScopes} onChange={(event) => input.onNewKeyScopesChange(event.target.value)} />
                        </div>
                        <TerminalButton
                            onClick={() => void input.onRunAction({
                                action: 'generate_api_key',
                                label: input.newKeyLabel,
                                scopes: input.newKeyScopes.split(',').map((value) => value.trim()).filter(Boolean),
                            })}
                            disabled={!input.snapshot.profile.permission_set.can_manage_api_keys}
                        >
                            <KeyRound className="w-3 h-3 mr-2" />
                            Generate API Key
                        </TerminalButton>
                    </div>
                    <div className="xl:col-span-2 space-y-3">
                        {input.snapshot.access_security.api_keys.length === 0 ? (
                            <div className="font-mono text-xs text-muted">No control-plane API keys registered.</div>
                        ) : (
                            input.snapshot.access_security.api_keys.map((key) => (
                                <div key={key.id} className="border border-grid p-3">
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <DataRow label="Label" value={key.label} />
                                            <DataRow label="Prefix" value={key.key_prefix} />
                                            <DataRow label="Status" value={key.status.toUpperCase()} />
                                        </div>
                                        <div className="space-y-2">
                                            <DataRow label="Scopes" value={key.scopes.join(', ') || 'NO DATA'} />
                                            <DataRow label="Created" value={new Date(key.created_at).toLocaleString()} />
                                            <DataRow label="Last Used" value={key.last_used_at ? new Date(key.last_used_at).toLocaleString() : 'NO DATA'} />
                                        </div>
                                    </div>
                                    {key.status === 'active' && (
                                        <div className="pt-3">
                                            <TerminalButton
                                                variant="danger"
                                                disabled={!input.snapshot.profile.permission_set.can_manage_api_keys}
                                                onClick={() => void input.onRunAction(
                                                    { action: 'revoke_api_key', api_key_id: key.id },
                                                    { confirmMessage: `Revoke API key "${key.label}"?` },
                                                )}
                                            >
                                                Revoke Key
                                            </TerminalButton>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </ConsoleCard>
        </div>
    );
}

function renderHealthTab(snapshot: ControlPlaneSnapshot) {
    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <ConsoleCard title="Operational Intelligence" className="xl:col-span-2">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <DataRow label="Telemetry Status" value={snapshot.system_health.telemetry_status.toUpperCase()} />
                        <DataRow label="Topology State" value={snapshot.system_health.topology_state} />
                        <DataRow
                            label="Ingestion Rate"
                            value={snapshot.system_health.event_ingestion_rate != null ? `${snapshot.system_health.event_ingestion_rate}/min` : 'NO DATA'}
                        />
                        <DataRow label="Network Health" value={`${snapshot.system_health.network_health_score}%`} />
                    </div>
                    <div className="space-y-2">
                        <DataRow label="Last Inference" value={formatTimestamp(snapshot.system_health.last_inference_timestamp)} />
                        <DataRow label="Last Outcome" value={formatTimestamp(snapshot.system_health.last_outcome_timestamp)} />
                        <DataRow label="Last Evaluation" value={formatTimestamp(snapshot.system_health.last_evaluation_event_timestamp)} />
                        <DataRow label="Last Simulation" value={formatTimestamp(snapshot.system_health.last_simulation_timestamp)} />
                        <DataRow label="Decision Mode" value={snapshot.decision_engine.mode.toUpperCase()} />
                        <DataRow label="Safe Mode" value={snapshot.decision_engine.safe_mode_enabled ? 'ENABLED' : 'DISABLED'} />
                    </div>
                </div>
                <div className="pt-4 border-t border-grid mt-4 font-mono text-xs text-muted space-y-2">
                    <div>Where failing: {snapshot.diagnostics.where_failing}</div>
                    <div>Root cause: {snapshot.diagnostics.root_cause}</div>
                    <div>Impact: {snapshot.diagnostics.impact}</div>
                    <div>Next action: {snapshot.diagnostics.next_action}</div>
                    <div>Decision engine: {snapshot.decision_engine.summary.next_action}</div>
                </div>
            </ConsoleCard>

            <ConsoleCard title="Warnings">
                {snapshot.system_health.warnings.length === 0 && snapshot.diagnostics.warnings.length === 0 ? (
                    <div className="font-mono text-xs text-accent">No active control-plane warnings.</div>
                ) : (
                    <div className="space-y-2 font-mono text-xs">
                        {[...snapshot.system_health.warnings, ...snapshot.diagnostics.warnings].map((warning, index) => (
                            <div key={`${warning}-${index}`} className="border border-[#ffcc00]/30 bg-[#ffcc00]/5 p-3 text-[#ffcc00]">
                                {warning}
                            </div>
                        ))}
                    </div>
                )}
            </ConsoleCard>
        </div>
    );
}

function renderPipelinesTab(
    snapshot: ControlPlaneSnapshot,
    onRunAction: Parameters<typeof renderTab>[0]['onRunAction'],
    isAdmin: boolean,
) {
    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <ConsoleCard title="Pipeline State" className="xl:col-span-2">
                <div className="space-y-3">
                    {snapshot.pipelines.map((pipeline) => (
                        <PipelineCard key={pipeline.key} pipeline={pipeline} />
                    ))}
                </div>
            </ConsoleCard>

            <ConsoleCard title="Infrastructure Controls">
                <div className="space-y-3">
                    <ControlActionButton
                        disabled={!isAdmin}
                        label="Restart Telemetry Stream"
                        onClick={() => void onRunAction(
                            { action: 'restart_telemetry_stream' },
                            { confirmMessage: 'Emit a telemetry-stream restart request?' },
                        )}
                    />
                    <ControlActionButton
                        disabled={!isAdmin}
                        label="Reinitialize Pipelines"
                        onClick={() => void onRunAction(
                            { action: 'reinitialize_pipelines' },
                            { confirmMessage: 'Emit a pipeline reinitialization request?' },
                        )}
                    />
                    <ControlActionButton
                        disabled={!isAdmin}
                        label="Reindex Dataset"
                        onClick={() => void onRunAction(
                            { action: 'reindex_dataset' },
                            { confirmMessage: 'Backfill and reindex tenant dataset state now?' },
                        )}
                    />
                    <ControlActionButton
                        disabled={!isAdmin}
                        label="Backfill Evaluation Events"
                        onClick={() => void onRunAction(
                            { action: 'backfill_evaluation_events' },
                            { confirmMessage: 'Backfill missing evaluation events and telemetry now?' },
                        )}
                    />
                </div>
                {!isAdmin && (
                    <div className="pt-4 font-mono text-[11px] text-muted">
                        Admin role required for infrastructure controls.
                    </div>
                )}
            </ConsoleCard>
        </div>
    );
}

function renderGovernanceTab(
    snapshot: ControlPlaneSnapshot,
    onRunAction: Parameters<typeof renderTab>[0]['onRunAction'],
    isAdmin: boolean,
) {
    return (
        <div className="space-y-4">
            {snapshot.governance.families.map((family) => (
                <ConsoleCard key={family.model_family} title={`${family.model_family.toUpperCase()} Governance`}>
                    <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 mb-4">
                        <DataCard label="Production" value={family.current_production_model ?? 'NO DATA'} />
                        <DataCard label="Staging" value={family.staging_candidate ?? 'NO DATA'} />
                        <DataCard label="Rollback Target" value={family.rollback_target ?? 'NO DATA'} />
                        <DataCard label="Active Route" value={family.active_registry_id ?? 'NO DATA'} />
                    </div>
                    <div className="space-y-3">
                        {family.entries.map((entry) => (
                            <div key={entry.registry_id} className="border border-grid p-3">
                                <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
                                    <DataCard label="Version" value={entry.model_version} />
                                    <DataCard label="Role" value={entry.registry_role.toUpperCase()} />
                                    <DataCard label="Lifecycle" value={entry.lifecycle_status.toUpperCase()} />
                                    <DataCard label="Promotion" value={entry.promotion_allowed ? 'YES' : 'NO'} />
                                    <DataCard label="Decision" value={entry.deployment_decision.toUpperCase()} />
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-5 gap-2 mt-3 font-mono text-[10px] uppercase tracking-widest text-muted">
                                    {Object.entries(entry.gating).map(([gate, status]) => (
                                        <div key={gate} className="border border-grid px-2 py-2">
                                            {gate}: <span className={status === 'pass' ? 'text-accent' : status === 'fail' ? 'text-danger' : 'text-[#ffcc00]'}>{status.toUpperCase()}</span>
                                        </div>
                                    ))}
                                </div>
                                {entry.blockers.length > 0 && (
                                    <div className="mt-3 border border-danger/30 bg-danger/5 p-3 font-mono text-xs text-danger">
                                        Promotion Blockers: {entry.blockers.join('; ')}
                                    </div>
                                )}
                                <div className="flex flex-wrap gap-2 mt-3">
                                    <TerminalButton
                                        disabled={!isAdmin || !entry.promotion_allowed || entry.lifecycle_status === 'production'}
                                        onClick={() => void onRunAction(
                                            { action: 'registry_action', run_id: entry.run_id, registry_action: 'promote_to_production' },
                                            { confirmMessage: `Promote ${entry.model_version} to production?` },
                                        )}
                                    >
                                        Promote
                                    </TerminalButton>
                                    <TerminalButton
                                        variant="secondary"
                                        disabled={!isAdmin || entry.lifecycle_status !== 'candidate'}
                                        onClick={() => void onRunAction(
                                            { action: 'registry_action', run_id: entry.run_id, registry_action: 'promote_to_staging' },
                                            { confirmMessage: `Promote ${entry.model_version} to staging?` },
                                        )}
                                    >
                                        Stage
                                    </TerminalButton>
                                    <TerminalButton
                                        variant="secondary"
                                        disabled={!isAdmin || entry.registry_role !== 'champion'}
                                        onClick={() => void onRunAction(
                                            { action: 'registry_action', run_id: entry.run_id, registry_action: 'rollback', reason: 'settings_control_plane_manual_rollback' },
                                            { confirmMessage: `Rollback champion ${entry.model_version}?` },
                                        )}
                                    >
                                        Rollback
                                    </TerminalButton>
                                    <TerminalButton
                                        variant="danger"
                                        disabled={!isAdmin || entry.lifecycle_status === 'archived'}
                                        onClick={() => void onRunAction(
                                            { action: 'registry_action', run_id: entry.run_id, registry_action: 'archive' },
                                            { confirmMessage: `Archive ${entry.model_version}?` },
                                        )}
                                    >
                                        Archive
                                    </TerminalButton>
                                </div>
                            </div>
                        ))}
                    </div>
                </ConsoleCard>
            ))}
        </div>
    );
}

function renderDebugTab(
    snapshot: ControlPlaneSnapshot,
    onRunAction: Parameters<typeof renderTab>[0]['onRunAction'],
    onRunProbe: Parameters<typeof renderTab>[0]['onRunProbe'],
    onRunTelemetryStreamProbe: Parameters<typeof renderTab>[0]['onRunTelemetryStreamProbe'],
    isAdmin: boolean,
) {
    const latestInferenceEventId = snapshot.debug.latest_inference_event_id;

    return (
        <div className="space-y-4">
            <ConsoleCard title="System Diagnostics">
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
                    <DataCard label="Latest Inference Event" value={latestInferenceEventId ?? 'NO DATA'} />
                    <DataCard label="Latest Evaluation Event" value={snapshot.debug.latest_evaluation_event_id ?? 'NO DATA'} />
                    <DataCard label="Dataset Rows" value={String(snapshot.debug.dataset_row_count)} />
                    <DataCard
                        label="Orphan Events"
                        value={String(
                            snapshot.debug.orphan_counts.inference_events_missing_case_id
                            + snapshot.debug.orphan_counts.outcome_events_missing_case_id
                            + snapshot.debug.orphan_counts.simulation_events_missing_case_id,
                        )}
                    />
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                    <ControlActionButton
                        label="Test Inference Endpoint"
                        onClick={() => void onRunProbe('Inference endpoint', '/api/inference', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                model: { name: 'gpt-4o-mini', version: '1.0.0' },
                                input: {
                                    input_signature: {
                                        species: 'Canis lupus familiaris',
                                        breed: 'Golden Retriever',
                                        symptoms: ['lethargy', 'fever', 'loss of appetite'],
                                        metadata: {},
                                    },
                                },
                            }),
                        })}
                    />
                    <ControlActionButton
                        label="Test Outcome Creation"
                        disabled={!latestInferenceEventId}
                        onClick={() => void onRunProbe('Outcome creation', '/api/outcome', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                inference_event_id: latestInferenceEventId,
                                outcome: {
                                    type: 'confirmed_diagnosis',
                                    payload: {
                                        confirmed_diagnosis: 'Parvovirus',
                                        primary_condition_class: 'infectious',
                                        emergency_level: 'urgent',
                                    },
                                    timestamp: new Date().toISOString(),
                                },
                            }),
                        })}
                    />
                    <ControlActionButton
                        label="Run System Diagnostic"
                        onClick={() => void onRunAction({ action: 'run_system_diagnostic' })}
                    />
                    <ControlActionButton
                        label="Test Telemetry Stream"
                        onClick={() => void onRunTelemetryStreamProbe()}
                    />
                    <ControlActionButton
                        label="Test Evaluation Creation"
                        onClick={() => void onRunProbe('Evaluation creation', '/api/evaluation', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                inference_event_id: latestInferenceEventId ?? undefined,
                                model_name: 'VetIOS Diagnostics',
                                model_version: '1.0.0',
                                predicted_confidence: 0.82,
                                trigger_type: 'inference',
                            }),
                        })}
                    />
                    <ControlActionButton
                        label="Backfill Evaluations"
                        disabled={!isAdmin}
                        onClick={() => void onRunAction(
                            { action: 'backfill_evaluation_events' },
                            { confirmMessage: 'Backfill missing evaluation events now?' },
                        )}
                    />
                </div>
            </ConsoleCard>

            <ConsoleCard title="Developer API Explorer">
                <DeveloperApiExplorer latestInferenceEventId={latestInferenceEventId} />
            </ConsoleCard>
        </div>
    );
}

function renderSimulationTab(
    input: Parameters<typeof renderTab>[0],
    isAdmin: boolean,
) {
    const simulations: Array<{ label: string; scenario: ControlPlaneSimulationScenario; icon: ReactNode }> = [
        { label: 'Inject Latency Spike', scenario: 'failure', icon: <Gauge className="w-3 h-3" /> },
        { label: 'Inject Drift Spike', scenario: 'drift', icon: <Activity className="w-3 h-3" /> },
        { label: 'Inject Failure Node', scenario: 'adversarial_attack', icon: <Bug className="w-3 h-3" /> },
        { label: 'Inject Incorrect Outcomes', scenario: 'incorrect_outcome_burst', icon: <RotateCcw className="w-3 h-3" /> },
    ];

    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <ConsoleCard title="Simulation Mode" className="xl:col-span-1">
                <div className="space-y-4">
                    <DataRow label="Current Mode" value={input.snapshot.configuration.simulation_enabled ? 'ON' : 'OFF'} />
                    <TerminalButton
                        disabled={!isAdmin}
                        onClick={() => void input.onRunAction({
                            action: 'update_config',
                            config: {
                                simulation_enabled: !input.snapshot.configuration.simulation_enabled,
                            },
                        })}
                    >
                        {input.snapshot.configuration.simulation_enabled ? 'Disable' : 'Enable'} Simulation Mode
                    </TerminalButton>
                </div>
            </ConsoleCard>

            <ConsoleCard title="Injection Controls" className="xl:col-span-2">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                    <div>
                        <TerminalLabel>Target Node</TerminalLabel>
                        <select
                            value={input.selectedSimulationTarget}
                            onChange={(event) => input.onSelectedSimulationTargetChange(event.target.value)}
                            className="w-full bg-dim border border-grid p-3 font-mono text-sm text-foreground"
                        >
                            {SIMULATION_TARGETS.map((target) => (
                                <option key={target.id} value={target.id}>{target.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <TerminalLabel>Severity</TerminalLabel>
                        <select
                            value={input.selectedSimulationSeverity}
                            onChange={(event) => input.onSelectedSimulationSeverityChange(event.target.value as 'degraded' | 'critical')}
                            className="w-full bg-dim border border-grid p-3 font-mono text-sm text-foreground"
                        >
                            <option value="critical">critical</option>
                            <option value="degraded">degraded</option>
                        </select>
                    </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {simulations.map((simulation) => (
                        <ControlActionButton
                            key={simulation.scenario}
                            disabled={!isAdmin}
                            label={simulation.label}
                            icon={simulation.icon}
                            onClick={() => void input.onRunAction(
                                {
                                    action: 'inject_simulation',
                                    scenario: simulation.scenario,
                                    target_node_id: input.selectedSimulationTarget,
                                    severity: input.selectedSimulationSeverity,
                                },
                                { confirmMessage: `${simulation.label} on ${input.selectedSimulationTarget}?` },
                            )}
                        />
                    ))}
                </div>
                {!isAdmin && (
                    <div className="pt-4 font-mono text-[11px] text-muted">
                        Admin role required to inject synthetic failures into the control graph.
                    </div>
                )}
            </ConsoleCard>
        </div>
    );
}

function renderLogsTab(input: Parameters<typeof renderTab>[0]) {
    return (
        <div className="space-y-4">
            <ConsoleCard title="Log Filters">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div>
                        <TerminalLabel>Event Type</TerminalLabel>
                        <select
                            value={input.logFilter.eventType}
                            onChange={(event) => input.onLogFilterChange((current) => ({ ...current, eventType: event.target.value }))}
                            className="w-full bg-dim border border-grid p-3 font-mono text-sm text-foreground"
                        >
                            <option value="all">all</option>
                            <option value="inference">inference</option>
                            <option value="outcome">outcome</option>
                            <option value="evaluation">evaluation</option>
                            <option value="simulation">simulation</option>
                            <option value="control">control</option>
                            <option value="registry">registry</option>
                            <option value="error">error</option>
                        </select>
                    </div>
                    <div>
                        <TerminalLabel>Run ID</TerminalLabel>
                        <TerminalInput
                            value={input.logFilter.runId}
                            onChange={(event) => input.onLogFilterChange((current) => ({ ...current, runId: event.target.value }))}
                        />
                    </div>
                    <div>
                        <TerminalLabel>Model Version</TerminalLabel>
                        <TerminalInput
                            value={input.logFilter.modelVersion}
                            onChange={(event) => input.onLogFilterChange((current) => ({ ...current, modelVersion: event.target.value }))}
                        />
                    </div>
                </div>
            </ConsoleCard>

            <ConsoleCard title="Trace Viewer">
                <div className="bg-black border border-grid/50 p-4 h-[480px] overflow-y-auto font-mono text-xs space-y-2">
                    {input.filteredLogs.length === 0 ? (
                        <div className="text-muted">No logs match the current filters.</div>
                    ) : (
                        input.filteredLogs.map((log) => (
                            <div key={log.id} className={log.level === 'ERROR' ? 'text-danger' : log.level === 'WARN' ? 'text-[#ffcc00]' : 'text-muted/90'}>
                                <span className="text-muted/40 mr-2">{new Date(log.timestamp).toLocaleString()}</span>
                                <span className="mr-2">[{log.category}]</span>
                                {log.message}
                                {(log.run_id || log.model_version) && (
                                    <span className="text-muted/50 ml-2">
                                        {log.run_id ? `run=${log.run_id}` : ''}
                                        {log.run_id && log.model_version ? ' ' : ''}
                                        {log.model_version ? `model=${log.model_version}` : ''}
                                    </span>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </ConsoleCard>
        </div>
    );
}

function renderConfigurationTab(
    input: Parameters<typeof renderTab>[0],
    isAdmin: boolean,
) {
    return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <ConsoleCard title="Configuration Management" className="xl:col-span-2">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                        <TerminalLabel>Decision Mode</TerminalLabel>
                        <select
                            value={input.configDraft.decision_mode}
                            onChange={(event) => input.onConfigDraftChange((current) => ({ ...current, decision_mode: event.target.value as typeof current.decision_mode }))}
                            className="w-full bg-dim border border-grid p-3 font-mono text-sm text-foreground"
                        >
                            <option value="observe">observe</option>
                            <option value="assist">assist</option>
                            <option value="autonomous">autonomous</option>
                        </select>
                    </div>
                    <div>
                        <TerminalLabel>Latency Threshold (ms)</TerminalLabel>
                        <TerminalInput
                            type="number"
                            value={input.configDraft.latency_threshold_ms}
                            onChange={(event) => input.onConfigDraftChange((current) => ({ ...current, latency_threshold_ms: Number(event.target.value) }))}
                        />
                    </div>
                    <div>
                        <TerminalLabel>Drift Threshold</TerminalLabel>
                        <TerminalInput
                            type="number"
                            step="0.01"
                            value={input.configDraft.drift_threshold}
                            onChange={(event) => input.onConfigDraftChange((current) => ({ ...current, drift_threshold: Number(event.target.value) }))}
                        />
                    </div>
                    <div>
                        <TerminalLabel>Confidence Threshold</TerminalLabel>
                        <TerminalInput
                            type="number"
                            step="0.01"
                            value={input.configDraft.confidence_threshold}
                            onChange={(event) => input.onConfigDraftChange((current) => ({ ...current, confidence_threshold: Number(event.target.value) }))}
                        />
                    </div>
                    <div>
                        <TerminalLabel>Abstain Threshold</TerminalLabel>
                        <TerminalInput
                            type="number"
                            step="0.01"
                            value={input.configDraft.abstain_threshold}
                            onChange={(event) => input.onConfigDraftChange((current) => ({ ...current, abstain_threshold: Number(event.target.value) }))}
                        />
                    </div>
                    <div>
                        <TerminalLabel>Alert Sensitivity</TerminalLabel>
                        <select
                            value={input.configDraft.alert_sensitivity}
                            onChange={(event) => input.onConfigDraftChange((current) => ({ ...current, alert_sensitivity: event.target.value as ControlPlaneAlertSensitivity }))}
                            className="w-full bg-dim border border-grid p-3 font-mono text-sm text-foreground"
                        >
                            <option value="low">low</option>
                            <option value="balanced">balanced</option>
                            <option value="high">high</option>
                        </select>
                    </div>
                    <div>
                        <TerminalLabel>Auto-Execute Confidence</TerminalLabel>
                        <TerminalInput
                            type="number"
                            step="0.01"
                            value={input.configDraft.auto_execute_confidence_threshold}
                            onChange={(event) => input.onConfigDraftChange((current) => ({ ...current, auto_execute_confidence_threshold: Number(event.target.value) }))}
                        />
                    </div>
                </div>
                <div className="pt-4 flex flex-wrap gap-2">
                    <TerminalButton
                        disabled={!isAdmin}
                        onClick={() => void input.onRunAction({
                            action: 'update_config',
                            config: input.configDraft,
                        })}
                    >
                        <Settings2 className="w-3 h-3 mr-2" />
                        Save Configuration
                    </TerminalButton>
                </div>
            </ConsoleCard>

            <ConsoleCard title="Current Runtime Config">
                <DataRow label="Updated At" value={formatTimestamp(input.snapshot.configuration.updated_at)} />
                <DataRow label="Updated By" value={input.snapshot.configuration.updated_by ?? 'NO DATA'} />
                <DataRow label="Simulation Enabled" value={input.snapshot.configuration.simulation_enabled ? 'TRUE' : 'FALSE'} />
                <DataRow label="Decision Mode" value={input.snapshot.configuration.decision_mode.toUpperCase()} />
                <DataRow label="Safe Mode Enabled" value={input.snapshot.configuration.safe_mode_enabled ? 'TRUE' : 'FALSE'} />
                <DataRow label="Abstain Threshold" value={String(input.snapshot.configuration.abstain_threshold)} />
                <DataRow label="Auto-Execute Confidence" value={String(input.snapshot.configuration.auto_execute_confidence_threshold)} />
                {!isAdmin && (
                    <div className="pt-4 font-mono text-[11px] text-muted">
                        Admin role required for configuration changes.
                    </div>
                )}
            </ConsoleCard>
        </div>
    );
}

function renderAlertsTab(
    snapshot: ControlPlaneSnapshot,
    onRunAction: Parameters<typeof renderTab>[0]['onRunAction'],
    isAdmin: boolean,
) {
    return (
        <div className="space-y-4">
            {snapshot.alerts.length === 0 ? (
                <ConsoleCard title="Alert Center">
                    <div className="font-mono text-xs text-accent">No alerts are currently registered.</div>
                </ConsoleCard>
            ) : (
                snapshot.alerts.map((alert) => (
                    <ConsoleCard key={alert.id} title={`${alert.severity.toUpperCase()} • ${alert.source}`}>
                        <div className="space-y-2">
                            <div className="font-mono text-sm">{alert.title}</div>
                            <div className="font-mono text-xs text-muted">{alert.message}</div>
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                <DataCard label="Timestamp" value={formatTimestamp(alert.timestamp)} />
                                <DataCard label="Source Node" value={alert.node_id ?? 'NO DATA'} />
                                <DataCard label="Resolved" value={alert.resolved ? 'YES' : 'NO'} />
                            </div>
                            {!alert.resolved && (
                                <div className="pt-2">
                                    <TerminalButton
                                        variant="secondary"
                                        disabled={!isAdmin}
                                        onClick={() => void onRunAction({ action: 'resolve_alert', alert_id: alert.id })}
                                    >
                                        Resolve Alert
                                    </TerminalButton>
                                </div>
                            )}
                        </div>
                    </ConsoleCard>
                ))
            )}
        </div>
    );
}

function ControlActionButton({
    label,
    onClick,
    disabled,
    icon,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    icon?: ReactNode;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="w-full text-left border border-grid p-3 font-mono text-xs uppercase tracking-widest text-muted hover:text-foreground hover:border-muted disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
            {icon}
            {label}
        </button>
    );
}

function PipelineCard({ pipeline }: { pipeline: ControlPlanePipelineState }) {
    const tone = pipeline.status === 'FAILED'
        ? 'border-danger/30 bg-danger/5'
        : pipeline.status === 'INITIALIZING'
            ? 'border-[#ffcc00]/30 bg-[#ffcc00]/5'
            : 'border-accent/20';

    return (
        <div className={`border p-3 ${tone}`}>
            <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-xs uppercase tracking-widest">{pipeline.label}</div>
                <div className="font-mono text-[10px] uppercase tracking-widest">{pipeline.status}</div>
            </div>
            <div className="pt-3 space-y-2">
                <DataRow label="Last Success" value={formatTimestamp(pipeline.last_successful_event)} />
                <DataRow label="Error Logs" value={pipeline.error_logs.length > 0 ? pipeline.error_logs.join(' | ') : 'NONE'} />
            </div>
        </div>
    );
}

function DataCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="border border-grid p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">{label}</div>
            <div className="font-mono text-xs">{value}</div>
        </div>
    );
}

function formatTimestamp(value: string | null) {
    return value ? new Date(value).toLocaleString() : 'NO DATA';
}
