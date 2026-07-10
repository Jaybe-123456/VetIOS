'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    Database,
    GitBranch,
    Lock,
    Play,
    RefreshCw,
    ShieldCheck,
    Unlock,
} from 'lucide-react';
import { ConsoleCard, Container, DataRow, PageHeader, TerminalButton } from '@/components/ui/terminal';

type ProviderConfigurationStatus = 'configured' | 'missing_url' | 'missing_credentials' | 'license_gated';

type ProviderRow = {
    provider_key: string;
    name: string;
    source_key: string;
    code_system: string;
    role: string;
    access: string;
    configuration_status: ProviderConfigurationStatus;
    configured: boolean;
    source_url: string;
    configured_source_url: string | null;
    release_url_env: string | null;
    required_env: string[];
    missing_env: string[];
    last_run_status: string;
    latest_release_at: string | null;
    source_hash: string | null;
    imported_rows: number;
    skipped_rows: number;
    raw_rows: number;
    parser_version: string;
    last_error_or_blocker: string | null;
    latest_audit_status: string | null;
    latest_audit_at: string | null;
    latest_ontology_coverage: {
        completion_status: string | null;
        imported_provider_count: number;
        missing_provider_count: number;
        coverage_score: number;
        provider_imported: boolean;
    };
    inference_expansion: {
        allowed: boolean;
        mode: 'active' | 'shadow' | 'blocked' | 'not_applicable';
        reason: string;
        source_attested_mappings: number;
        reviewer_verified_mappings: number;
        externally_verified_mappings: number;
    };
};

type OperationsSnapshot = {
    tenant_id: string;
    generated_at: string;
    providers: ProviderRow[];
    summary: {
        provider_count: number;
        configured_count: number;
        imported_provider_count: number;
        missing_provider_count: number;
        allowed_inference_expansion_count: number;
        latest_completion_status: string | null;
        latest_population_status: string | null;
        total_imported_rows: number;
        total_skipped_rows: number;
    };
    latest_completion: {
        completion_status: string | null;
        scoring_state: string | null;
        blockers: string[];
        warnings: string[];
        created_at: string | null;
    } | null;
    latest_population: {
        population_status: string | null;
        source_manifest_hash: string | null;
        created_at: string | null;
    } | null;
    query_errors: string[];
};

type OperationsResponse = {
    snapshot?: OperationsSnapshot;
    result?: unknown;
    error?: string;
    message?: string;
};

type RunMode = 'dry_run' | 'commit';

export default function IngestionOperationsConsoleClient() {
    const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [runningProvider, setRunningProvider] = useState<string | null>(null);
    const [runMode, setRunMode] = useState<RunMode | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<string | null>(null);

    const refresh = useCallback(async (initial = false) => {
        if (initial) {
            setLoading(true);
        } else {
            setRefreshing(true);
        }
        try {
            const response = await fetch('/api/ontology/global-one-health/operations', {
                cache: 'no-store',
            });
            const payload = await response.json() as OperationsResponse;
            if (!response.ok || !payload.snapshot) {
                throw new Error(payload.message ?? payload.error ?? 'Failed to load ingestion operations.');
            }
            setSnapshot(payload.snapshot);
            setError(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Failed to load ingestion operations.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void refresh(true);
    }, [refresh]);

    const runProvider = useCallback(async (provider: ProviderRow, mode: RunMode) => {
        if (mode === 'commit') {
            const confirmed = window.confirm(`Commit ontology ingestion for ${provider.provider_key}?`);
            if (!confirmed) return;
        }

        setRunningProvider(provider.provider_key);
        setRunMode(mode);
        setLastResult(null);
        try {
            const response = await fetch('/api/ontology/global-one-health/operations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({
                    action: 'run_provider',
                    provider_key: provider.provider_key,
                    dry_run: mode === 'dry_run',
                }),
            });
            const payload = await response.json() as OperationsResponse;
            if (!response.ok || !payload.snapshot) {
                throw new Error(payload.message ?? payload.error ?? 'Provider run failed.');
            }
            setSnapshot(payload.snapshot);
            setLastResult(`${provider.provider_key} ${mode === 'dry_run' ? 'dry-run' : 'commit'} accepted`);
            setError(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Provider run failed.');
        } finally {
            setRunningProvider(null);
            setRunMode(null);
        }
    }, []);

    const providerGroups = useMemo(() => {
        const rows = snapshot?.providers ?? [];
        return {
            configured: rows.filter((provider) => provider.configured),
            blocked: rows.filter((provider) => !provider.configured),
        };
    }, [snapshot]);

    return (
        <Container className="pb-10">
            <PageHeader
                title="INGESTION OPERATIONS"
                description="Operational control for official ontology providers, source manifests, parser runs, and inference-expansion gates."
            />

            <div className="mb-5 flex flex-wrap items-center gap-2">
                <TerminalButton onClick={() => void refresh(false)} disabled={refreshing || loading}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? 'REFRESHING' : 'REFRESH'}
                </TerminalButton>
                {snapshot && (
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                        tenant {shortHash(snapshot.tenant_id)} · {new Date(snapshot.generated_at).toLocaleString()}
                    </span>
                )}
                {lastResult && (
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
                        {lastResult}
                    </span>
                )}
            </div>

            {error && (
                <div className="mb-5 border border-danger/50 bg-danger/10 p-4 font-mono text-[12px] uppercase tracking-[0.12em] text-danger">
                    {error}
                </div>
            )}

            {loading && !snapshot ? (
                <ConsoleCard title="Provider State">
                    <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-muted">LOADING PROVIDERS...</div>
                </ConsoleCard>
            ) : snapshot ? (
                <>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5 mb-5">
                        <Metric label="Configured" value={`${snapshot.summary.configured_count}/${snapshot.summary.provider_count}`} tone="accent" icon={<CheckCircle2 className="h-4 w-4" />} />
                        <Metric label="Imported" value={`${snapshot.summary.imported_provider_count}`} tone="accent" icon={<Database className="h-4 w-4" />} />
                        <Metric label="Missing" value={`${snapshot.summary.missing_provider_count}`} tone="warning" icon={<AlertTriangle className="h-4 w-4" />} />
                        <Metric label="Rows" value={snapshot.summary.total_imported_rows.toLocaleString()} tone="accent" icon={<GitBranch className="h-4 w-4" />} />
                        <Metric label="Expansion" value={`${snapshot.summary.allowed_inference_expansion_count}`} tone={snapshot.summary.allowed_inference_expansion_count > 0 ? 'accent' : 'muted'} icon={<ShieldCheck className="h-4 w-4" />} />
                    </div>

                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                        <div className="space-y-4">
                            {snapshot.providers.map((provider) => (
                                <ProviderCard
                                    key={provider.provider_key}
                                    provider={provider}
                                    running={runningProvider === provider.provider_key}
                                    runMode={runMode}
                                    onRun={runProvider}
                                />
                            ))}
                        </div>

                        <div className="space-y-4">
                            <ConsoleCard title="Coverage">
                                <DataRow label="Completion" value={snapshot.summary.latest_completion_status ?? 'NO SNAPSHOT'} tone={statusTone(snapshot.summary.latest_completion_status)} />
                                <DataRow label="Population" value={snapshot.summary.latest_population_status ?? 'NO SNAPSHOT'} tone={statusTone(snapshot.summary.latest_population_status)} />
                                <DataRow label="Imported Providers" value={snapshot.summary.imported_provider_count} tone="accent" />
                                <DataRow label="Missing Providers" value={snapshot.summary.missing_provider_count} tone={snapshot.summary.missing_provider_count > 0 ? 'warning' : 'accent'} />
                                <DataRow label="Skipped Rows" value={snapshot.summary.total_skipped_rows.toLocaleString()} tone={snapshot.summary.total_skipped_rows > 0 ? 'warning' : 'muted'} />
                                <DataRow label="Scoring" value={snapshot.latest_completion?.scoring_state ?? 'BLOCKED'} tone={snapshot.latest_completion?.scoring_state === 'outcome_validated_active' ? 'accent' : 'warning'} />
                            </ConsoleCard>

                            <ConsoleCard title="Configured Providers">
                                <ProviderList rows={providerGroups.configured} empty="NO CONFIGURED PROVIDERS" />
                            </ConsoleCard>

                            <ConsoleCard title="Blocked Providers">
                                <ProviderList rows={providerGroups.blocked} empty="NO BLOCKED PROVIDERS" />
                            </ConsoleCard>

                            <ConsoleCard title="Query Health">
                                {snapshot.query_errors.length > 0 ? (
                                    <div className="space-y-2">
                                        {snapshot.query_errors.map((queryError) => (
                                            <div key={queryError} className="font-mono text-[11px] text-danger break-words">
                                                {queryError}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">NO QUERY ERRORS</div>
                                )}
                            </ConsoleCard>
                        </div>
                    </div>
                </>
            ) : null}
        </Container>
    );
}

function ProviderCard({
    provider,
    running,
    runMode,
    onRun,
}: {
    provider: ProviderRow;
    running: boolean;
    runMode: RunMode | null;
    onRun: (provider: ProviderRow, mode: RunMode) => void;
}) {
    return (
        <ConsoleCard className="accent-line-top">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] uppercase tracking-[0.16em] text-foreground">
                            {provider.name}
                        </span>
                        <StatusBadge label={provider.configuration_status} tone={configurationTone(provider.configuration_status)} />
                        <StatusBadge label={provider.last_run_status} tone={statusTone(provider.last_run_status)} />
                        <StatusBadge
                            label={provider.inference_expansion.allowed ? 'EXPANSION ALLOWED' : provider.inference_expansion.mode}
                            tone={provider.inference_expansion.allowed ? 'accent' : provider.inference_expansion.mode === 'shadow' ? 'warning' : 'muted'}
                            icon={provider.inference_expansion.allowed ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        />
                    </div>
                    <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted break-all">
                        {provider.provider_key} · {provider.code_system} · {provider.role}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    <TerminalButton
                        variant="secondary"
                        onClick={() => void onRun(provider, 'dry_run')}
                        disabled={running}
                    >
                        <Play className="mr-2 h-4 w-4" />
                        {running && runMode === 'dry_run' ? 'RUNNING' : 'DRY RUN'}
                    </TerminalButton>
                    <TerminalButton
                        onClick={() => void onRun(provider, 'commit')}
                        disabled={running}
                    >
                        <Database className="mr-2 h-4 w-4" />
                        {running && runMode === 'commit' ? 'COMMITTING' : 'COMMIT'}
                    </TerminalButton>
                </div>
            </div>

            <div className="grid gap-x-6 md:grid-cols-2 xl:grid-cols-3">
                <DataRow label="Source URL" value={provider.source_url} tone={provider.configured ? 'accent' : 'warning'} />
                <DataRow label="Source Hash" value={provider.source_hash ? shortHash(provider.source_hash) : 'NO HASH'} tone={provider.source_hash ? 'accent' : 'muted'} />
                <DataRow label="Parser" value={provider.parser_version} tone={provider.parser_version === 'not_observed' ? 'muted' : 'accent'} />
                <DataRow label="Imported Rows" value={provider.imported_rows.toLocaleString()} tone={provider.imported_rows > 0 ? 'accent' : 'muted'} />
                <DataRow label="Skipped Rows" value={provider.skipped_rows.toLocaleString()} tone={provider.skipped_rows > 0 ? 'warning' : 'muted'} />
                <DataRow label="Raw Rows" value={provider.raw_rows.toLocaleString()} tone={provider.raw_rows > 0 ? 'accent' : 'muted'} />
                <DataRow label="Last Run" value={provider.latest_release_at ? new Date(provider.latest_release_at).toLocaleString() : 'NO RELEASE'} tone={provider.latest_release_at ? 'accent' : 'muted'} />
                <DataRow label="Audit" value={provider.latest_audit_status ?? 'NO AUDIT'} tone={statusTone(provider.latest_audit_status)} />
                <DataRow label="Coverage" value={provider.latest_ontology_coverage.provider_imported ? 'IMPORTED' : 'MISSING'} tone={provider.latest_ontology_coverage.provider_imported ? 'accent' : 'warning'} />
                <DataRow label="Expansion Gate" value={provider.inference_expansion.reason} tone={provider.inference_expansion.allowed ? 'accent' : 'warning'} />
                <DataRow label="Mappings" value={`source ${provider.inference_expansion.source_attested_mappings} / reviewer ${provider.inference_expansion.reviewer_verified_mappings} / external ${provider.inference_expansion.externally_verified_mappings}`} tone={provider.inference_expansion.allowed ? 'accent' : 'muted'} />
                <DataRow label="Blocker" value={provider.last_error_or_blocker ?? 'NONE'} tone={provider.last_error_or_blocker ? 'warning' : 'accent'} />
            </div>
        </ConsoleCard>
    );
}

function Metric({
    label,
    value,
    tone,
    icon,
}: {
    label: string;
    value: string;
    tone: 'accent' | 'warning' | 'danger' | 'muted';
    icon: React.ReactNode;
}) {
    return (
        <div className="console-card-glass p-4">
            <div className="mb-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                <span>{label}</span>
                <span className={toneText(tone)}>{icon}</span>
            </div>
            <div className={`font-mono text-2xl font-bold ${toneText(tone)}`}>{value}</div>
        </div>
    );
}

function ProviderList({ rows, empty }: { rows: ProviderRow[]; empty: string }) {
    if (rows.length === 0) {
        return <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{empty}</div>;
    }
    return (
        <div className="space-y-2">
            {rows.map((provider) => (
                <div key={provider.provider_key} className="flex items-center justify-between gap-3 border border-grid bg-black/20 p-2">
                    <div className="min-w-0">
                        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-foreground truncate">
                            {provider.provider_key}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                            {provider.last_run_status}
                        </div>
                    </div>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${provider.configured ? 'bg-accent' : 'bg-[#ffcc00]'}`} />
                </div>
            ))}
        </div>
    );
}

function StatusBadge({
    label,
    tone,
    icon,
}: {
    label: string;
    tone: 'accent' | 'warning' | 'danger' | 'muted';
    icon?: React.ReactNode;
}) {
    return (
        <span className={`inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${badgeTone(tone)}`}>
            {icon}
            {label.replace(/_/g, ' ')}
        </span>
    );
}

function configurationTone(status: ProviderConfigurationStatus) {
    if (status === 'configured') return 'accent' as const;
    if (status === 'license_gated') return 'warning' as const;
    return 'danger' as const;
}

function statusTone(status: string | null | undefined) {
    if (!status) return 'muted' as const;
    if (['imported', 'partial', 'ready', 'configured', 'ingested', 'public_sources_populated'].includes(status)) {
        return 'accent' as const;
    }
    if (['dry_run', 'requires_credentials', 'requires_source_release', 'license_gated', 'foundation', 'blocked_pending_review'].includes(status)) {
        return 'warning' as const;
    }
    if (['failed', 'blocked', 'missing_url', 'missing_credentials'].includes(status)) return 'danger' as const;
    return 'muted' as const;
}

function badgeTone(tone: 'accent' | 'warning' | 'danger' | 'muted') {
    if (tone === 'accent') return 'border-accent/50 bg-accent/10 text-accent';
    if (tone === 'warning') return 'border-[#ffcc00]/50 bg-[#ffcc00]/10 text-[#ffcc00]';
    if (tone === 'danger') return 'border-danger/50 bg-danger/10 text-danger';
    return 'border-grid bg-black/20 text-muted';
}

function toneText(tone: 'accent' | 'warning' | 'danger' | 'muted') {
    if (tone === 'accent') return 'text-accent';
    if (tone === 'warning') return 'text-[#ffcc00]';
    if (tone === 'danger') return 'text-danger';
    return 'text-muted';
}

function shortHash(value: string) {
    if (value.length <= 16) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
}
