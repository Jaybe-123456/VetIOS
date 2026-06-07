'use client';

import type { ReactNode, ChangeEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CalendarClock, CheckCircle2, KeyRound, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react';
import {
    ConsoleCard,
    Container,
    DataRow,
    PageHeader,
    TerminalButton,
    TerminalInput,
    TerminalLabel,
} from '@/components/ui/terminal';
import type {
    NativeVendorConnectionRecord,
    NativeVendorSyncRunRecord,
    PassiveConnectorInstallationSnapshot,
    PassiveSignalOperationsSnapshot,
} from '@/lib/passiveSignals/service';

export default function PassiveSignalOperationsClient({
    initialSnapshot,
    tenantId,
}: {
    initialSnapshot: PassiveSignalOperationsSnapshot;
    tenantId: string;
}) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [refreshing, setRefreshing] = useState(false);
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);
    const [selectedMarketplaceId, setSelectedMarketplaceId] = useState(initialSnapshot.marketplace[0]?.id ?? '');
    const [selectedInstallationId, setSelectedInstallationId] = useState(initialSnapshot.installations[0]?.id ?? '');
    const [selectedNativeAdapterKey, setSelectedNativeAdapterKey] = useState(initialSnapshot.native_adapters[0]?.adapter_key ?? '');
    const [selectedNativeConnectionId, setSelectedNativeConnectionId] = useState(initialSnapshot.native_connections[0]?.id ?? '');
    const [actionState, setActionState] = useState<{ status: 'idle' | 'running' | 'success' | 'error'; message: string }>({
        status: 'idle',
        message: '',
    });
    const [installDraft, setInstallDraft] = useState({
        installation_name: '',
        vendor_account_ref: '',
        webhook_url: '',
        interval_hours: '',
    });
    const [configDraft, setConfigDraft] = useState({
        installation_name: '',
        vendor_account_ref: '',
        webhook_url: '',
        sync_mode: 'scheduled_pull',
        interval_hours: '',
        scheduler_enabled: 'true',
        status: 'active',
    });
    const [nativeDraft, setNativeDraft] = useState({
        vendor_account_ref: '',
        adapter_runtime_url: '',
        interval_hours: '',
        redirect_uri: '',
    });

    const selectedTemplate = useMemo(
        () => snapshot.marketplace.find((template) => template.id === selectedMarketplaceId) ?? snapshot.marketplace[0] ?? null,
        [selectedMarketplaceId, snapshot.marketplace],
    );
    const selectedInstallation = useMemo(
        () => snapshot.installations.find((installation) => installation.id === selectedInstallationId) ?? snapshot.installations[0] ?? null,
        [selectedInstallationId, snapshot.installations],
    );
    const selectedNativeAdapter = useMemo(
        () => snapshot.native_adapters.find((adapter) => adapter.adapter_key === selectedNativeAdapterKey) ?? snapshot.native_adapters[0] ?? null,
        [selectedNativeAdapterKey, snapshot.native_adapters],
    );
    const selectedNativeConnection = useMemo(
        () => snapshot.native_connections.find((connection) => connection.id === selectedNativeConnectionId) ?? snapshot.native_connections[0] ?? null,
        [selectedNativeConnectionId, snapshot.native_connections],
    );

    useEffect(() => {
        if (!selectedTemplate) return;
        setInstallDraft((current) => ({
            installation_name: current.installation_name || selectedTemplate.label,
            vendor_account_ref: current.vendor_account_ref,
            webhook_url: current.webhook_url,
            interval_hours: current.interval_hours || (selectedTemplate.default_interval_hours ? String(selectedTemplate.default_interval_hours) : ''),
        }));
    }, [selectedTemplate]);

    useEffect(() => {
        if (!selectedInstallation) return;
        setConfigDraft({
            installation_name: selectedInstallation.installation_name,
            vendor_account_ref: selectedInstallation.vendor_account_ref ?? '',
            webhook_url: selectedInstallation.webhook_url ?? '',
            sync_mode: selectedInstallation.sync_mode,
            interval_hours: selectedInstallation.scheduler.interval_hours ? String(selectedInstallation.scheduler.interval_hours) : '',
            scheduler_enabled: selectedInstallation.scheduler.enabled ? 'true' : 'false',
            status: selectedInstallation.status,
        });
    }, [selectedInstallation]);

interface PassiveSignalActionResponse {
    snapshot?: PassiveSignalOperationsSnapshot;
    error?: string;
    generated_api_key?: string;
    native_authorization_state?: string;
    native_authorization_url?: string | null;
}

    async function refreshSnapshot() {
        setRefreshing(true);
        try {
            const res = await fetch('/api/platform/passive-signals', { cache: 'no-store' });
            const data = await res.json() as PassiveSignalActionResponse;
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Failed to refresh passive-signal snapshot.');
            }
            setSnapshot(data.snapshot);
        } catch (error) {
            setActionState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to refresh passive-signal snapshot.' });
        } finally {
            setRefreshing(false);
        }
    }

    async function runAction(body: Record<string, unknown>, successMessage: string) {
        setActionState({ status: 'running', message: 'Running passive-signal operation...' });
        setGeneratedKey(null);
        try {
            const res = await fetch('/api/platform/passive-signals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = (await res.json()) as PassiveSignalActionResponse;
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Passive-signal operation failed.');
            }
            setSnapshot(data.snapshot);
            setGeneratedKey(typeof data.generated_api_key === 'string' ? data.generated_api_key : null);
            const nativeAuth = typeof data.native_authorization_url === 'string'
                ? ` Authorization URL: ${data.native_authorization_url}`
                : typeof data.native_authorization_state === 'string'
                    ? ` Authorization state: ${data.native_authorization_state}`
                    : '';
            setActionState({ status: 'success', message: `${successMessage}${nativeAuth}` });
        } catch (error) {
            setActionState({ status: 'error', message: error instanceof Error ? error.message : 'Passive-signal operation failed.' });
        }
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader
                title="PASSIVE SIGNAL OPS"
                description="Install connector marketplace packs, create native vendor connections, switch from legacy shared-secret ingest to installation credentials, and run scheduled syncs through the passive signal engine."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
                <SummaryCard icon={<PlugZap className="h-4 w-4" />} label="Marketplace Packs" value={snapshot.summary.marketplace_templates} />
                <SummaryCard icon={<PlugZap className="h-4 w-4" />} label="Native Adapters" value={snapshot.summary.native_adapter_templates} />
                <SummaryCard icon={<KeyRound className="h-4 w-4" />} label="Active Installs" value={snapshot.summary.active_installations} />
                <SummaryCard icon={<KeyRound className="h-4 w-4" />} label="Native Active" value={snapshot.summary.native_active_connections} />
                <SummaryCard icon={<CalendarClock className="h-4 w-4" />} label="Scheduled Syncs" value={snapshot.summary.scheduled_installations} />
                <SummaryCard icon={<Activity className="h-4 w-4" />} label="Recent Failures" value={snapshot.summary.recent_failed_syncs} tone={snapshot.summary.recent_failed_syncs > 0 ? 'warning' : 'neutral'} />
            </div>

            <ConsoleCard title="Passive Signal Readiness" className="mt-6">
                <div className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
                    <div className="border border-accent/20 bg-accent/[0.03] p-4 rounded-sm">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-accent" />
                            <div className="font-mono text-sm font-medium text-white">Network intake coverage</div>
                        </div>
                        <div className="mt-4 grid gap-0">
                            <DataRow label="Ready Types" value={`${snapshot.readiness.ready_connector_types}/${snapshot.readiness.required_connector_types}`} tone="accent" />
                            <DataRow label="Quiet Types" value={snapshot.readiness.quiet_connector_types} tone={snapshot.readiness.quiet_connector_types > 0 ? 'warning' : 'muted'} />
                            <DataRow label="Stale Types" value={snapshot.readiness.stale_connector_types} tone={snapshot.readiness.stale_connector_types > 0 ? 'warning' : 'muted'} />
                            <DataRow label="Missing Types" value={snapshot.readiness.missing_connector_types} tone={snapshot.readiness.missing_connector_types > 0 ? 'danger' : 'muted'} />
                            <DataRow label="Signals 24h" value={snapshot.readiness.recent_signals_24h} />
                            <DataRow label="Signals 7d" value={snapshot.readiness.recent_signals_7d} />
                        </div>
                    </div>

                    <div className="border border-white/10 bg-white/[0.02] p-4 rounded-sm">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-accent" />
                            <div className="font-mono text-sm font-medium text-white">Privacy contract</div>
                        </div>
                        <div className="mt-3 grid gap-2">
                            {snapshot.readiness.privacy_contract.map((item) => (
                                <div key={item} className="flex gap-2 font-mono text-xs leading-5 text-white/65">
                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                                    <span>{item}</span>
                                </div>
                            ))}
                            {snapshot.readiness.privacy_contract.length === 0 ? (
                                <div className="font-mono text-xs text-muted">No passive-signal privacy contract has been published for this tenant.</div>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    {snapshot.readiness.coverage.map((row) => (
                        <CoverageRow key={row.connector_type} row={row} />
                    ))}
                    {snapshot.readiness.coverage.length === 0 ? (
                        <div className="font-mono text-xs text-muted">No connector types are configured for readiness tracking.</div>
                    ) : null}
                </div>
            </ConsoleCard>

            <ConsoleCard title="Passive Connector Control" className="mt-6">
                <div className="flex flex-wrap items-center gap-2">
                    <TerminalButton variant="secondary" onClick={() => void refreshSnapshot()} disabled={refreshing}>
                        <RefreshCw className="mr-2 h-3 w-3" />
                        {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
                    </TerminalButton>
                    <TerminalButton variant="secondary" onClick={() => void runAction({ action: 'run_due_syncs' }, 'Queued all due passive connector syncs.')}>
                        <CalendarClock className="mr-2 h-3 w-3" />
                        Run Due Syncs
                    </TerminalButton>
                    <TerminalButton variant="secondary" onClick={() => void runAction({ action: 'run_due_native_vendor_syncs' }, 'Queued all due native vendor syncs.')}>
                        <CalendarClock className="mr-2 h-3 w-3" />
                        Run Native Due
                    </TerminalButton>
                    <div className="font-mono text-xs text-muted">Tenant: {tenantId}</div>
                </div>
                <ActionStatePanel state={actionState} />
                {generatedKey ? (
                    <div className="mt-4 border border-warning/30 bg-warning/10 px-4 py-3 font-mono text-xs text-warning">
                        Generated connector API key: {generatedKey}
                    </div>
                ) : null}
            </ConsoleCard>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Install Marketplace Connector">
                    <Field label="Marketplace Pack">
                        <Select value={selectedMarketplaceId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedMarketplaceId(event.target.value)}>
                            {snapshot.marketplace.map((template) => (
                                <option key={template.id} value={template.id}>{template.label}</option>
                            ))}
                        </Select>
                    </Field>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <Field label="Installation Name"><TerminalInput value={installDraft.installation_name} onChange={(event: ChangeEvent<HTMLInputElement>) => setInstallDraft((current) => ({ ...current, installation_name: event.target.value }))} /></Field>
                        <Field label="Vendor Account Ref"><TerminalInput value={installDraft.vendor_account_ref} onChange={(event: ChangeEvent<HTMLInputElement>) => setInstallDraft((current) => ({ ...current, vendor_account_ref: event.target.value }))} /></Field>
                        <Field label="Webhook URL"><TerminalInput value={installDraft.webhook_url} onChange={(event: ChangeEvent<HTMLInputElement>) => setInstallDraft((current) => ({ ...current, webhook_url: event.target.value }))} /></Field>
                        <Field label="Interval Hours"><TerminalInput value={installDraft.interval_hours} onChange={(event: ChangeEvent<HTMLInputElement>) => setInstallDraft((current) => ({ ...current, interval_hours: event.target.value }))} /></Field>
                    </div>
                    {selectedTemplate ? (
                        <div className="mt-4 border border-accent/30 bg-accent/5 p-4 rounded-sm">
                            <div className="font-mono text-sm text-white font-medium">{selectedTemplate.label}</div>
                            <div className="mt-1.5 font-mono text-xs text-white/60 leading-5">{selectedTemplate.summary}</div>
                            <div className="mt-3 grid gap-0 md:grid-cols-2">
                                <DataRow label="Vendor" value={selectedTemplate.vendor_name} tone="accent" />
                                <DataRow label="Sync mode" value={selectedTemplate.sync_mode} />
                                <DataRow label="Auth" value={selectedTemplate.auth_strategy} />
                                <DataRow label="Schedule" value={selectedTemplate.sample_schedule ?? 'MANUAL'} tone="accent" />
                            </div>
                        </div>
                    ) : null}
                    <div className="pt-4">
                        <TerminalButton
                            onClick={() => selectedTemplate && void runAction({
                                action: 'install_marketplace_connector',
                                marketplace_id: selectedTemplate.id,
                                installation_name: installDraft.installation_name,
                                vendor_account_ref: installDraft.vendor_account_ref,
                                webhook_url: installDraft.webhook_url,
                                interval_hours: installDraft.interval_hours,
                            }, 'Marketplace connector installed and credential issued.')}
                            disabled={!selectedTemplate}
                        >
                            Install Connector
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Configure Installation">
                    <Field label="Connector Installation">
                        <Select value={selectedInstallationId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedInstallationId(event.target.value)}>
                            {snapshot.installations.map((installation) => (
                                <option key={installation.id} value={installation.id}>{installation.installation_name}</option>
                            ))}
                        </Select>
                    </Field>
                    {selectedInstallation ? (
                        <>
                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <Field label="Installation Name"><TerminalInput value={configDraft.installation_name} onChange={(event: ChangeEvent<HTMLInputElement>) => setConfigDraft((current) => ({ ...current, installation_name: event.target.value }))} /></Field>
                                <Field label="Vendor Account Ref"><TerminalInput value={configDraft.vendor_account_ref} onChange={(event: ChangeEvent<HTMLInputElement>) => setConfigDraft((current) => ({ ...current, vendor_account_ref: event.target.value }))} /></Field>
                                <Field label="Webhook URL"><TerminalInput value={configDraft.webhook_url} onChange={(event: ChangeEvent<HTMLInputElement>) => setConfigDraft((current) => ({ ...current, webhook_url: event.target.value }))} /></Field>
                                <Field label="Sync Mode">
                                    <Select value={configDraft.sync_mode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setConfigDraft((current) => ({ ...current, sync_mode: event.target.value }))}>
                                        <option value="scheduled_pull">scheduled_pull</option>
                                        <option value="webhook_push">webhook_push</option>
                                        <option value="manual_file_drop">manual_file_drop</option>
                                    </Select>
                                </Field>
                                <Field label="Interval Hours"><TerminalInput value={configDraft.interval_hours} onChange={(event: ChangeEvent<HTMLInputElement>) => setConfigDraft((current) => ({ ...current, interval_hours: event.target.value }))} /></Field>
                                <Field label="Scheduler Enabled">
                                    <Select value={configDraft.scheduler_enabled} onChange={(event: ChangeEvent<HTMLSelectElement>) => setConfigDraft((current) => ({ ...current, scheduler_enabled: event.target.value }))}>
                                        <option value="true">true</option>
                                        <option value="false">false</option>
                                    </Select>
                                </Field>
                                <Field label="Status">
                                    <Select value={configDraft.status} onChange={(event: ChangeEvent<HTMLSelectElement>) => setConfigDraft((current) => ({ ...current, status: event.target.value }))}>
                                        <option value="active">active</option>
                                        <option value="paused">paused</option>
                                        <option value="revoked">revoked</option>
                                    </Select>
                                </Field>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                                <TerminalButton onClick={() => void runAction({
                                    action: 'update_connector_installation',
                                    connector_installation_id: selectedInstallation.id,
                                    ...configDraft,
                                }, 'Connector installation updated.')}>
                                    Save Connector Config
                                </TerminalButton>
                                <TerminalButton variant="secondary" onClick={() => void runAction({
                                    action: 'run_connector_sync',
                                    connector_installation_id: selectedInstallation.id,
                                }, 'Connector sync queued and dispatched.')}>
                                    Run Sync Now
                                </TerminalButton>
                            </div>
                        </>
                    ) : (
                        <div className="mt-4 font-mono text-xs text-muted">No connector installations yet.</div>
                    )}
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
                <ConsoleCard title="Native Vendor Adapter">
                    <Field label="Native Adapter">
                        <Select value={selectedNativeAdapterKey} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedNativeAdapterKey(event.target.value)}>
                            {snapshot.native_adapters.map((adapter) => (
                                <option key={adapter.adapter_key} value={adapter.adapter_key}>{adapter.display_name}</option>
                            ))}
                        </Select>
                    </Field>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <Field label="Vendor Account Ref"><TerminalInput value={nativeDraft.vendor_account_ref} onChange={(event: ChangeEvent<HTMLInputElement>) => setNativeDraft((current) => ({ ...current, vendor_account_ref: event.target.value }))} /></Field>
                        <Field label="Adapter Runtime URL"><TerminalInput value={nativeDraft.adapter_runtime_url} onChange={(event: ChangeEvent<HTMLInputElement>) => setNativeDraft((current) => ({ ...current, adapter_runtime_url: event.target.value }))} /></Field>
                        <Field label="Interval Hours"><TerminalInput value={nativeDraft.interval_hours} onChange={(event: ChangeEvent<HTMLInputElement>) => setNativeDraft((current) => ({ ...current, interval_hours: event.target.value }))} /></Field>
                        <Field label="Redirect URI"><TerminalInput value={nativeDraft.redirect_uri} onChange={(event: ChangeEvent<HTMLInputElement>) => setNativeDraft((current) => ({ ...current, redirect_uri: event.target.value }))} placeholder="/api/signals/connect/native/callback" /></Field>
                    </div>
                    {selectedNativeAdapter ? (
                        <div className="mt-4 border border-accent/30 bg-accent/5 p-4 rounded-sm">
                            <div className="font-mono text-sm text-white font-medium">{selectedNativeAdapter.display_name}</div>
                            <div className="mt-1.5 font-mono text-xs text-white/60 leading-5">{selectedNativeAdapter.summary}</div>
                            <div className="mt-3 grid gap-0 md:grid-cols-2">
                                <DataRow label="Vendor" value={selectedNativeAdapter.vendor_name} tone="accent" />
                                <DataRow label="Auth" value={selectedNativeAdapter.auth_protocol} />
                                <DataRow label="Readiness" value={selectedNativeAdapter.readiness} />
                                <DataRow label="Types" value={selectedNativeAdapter.supported_connector_types.join(', ')} />
                            </div>
                        </div>
                    ) : null}
                    <div className="pt-4">
                        <TerminalButton
                            onClick={() => selectedNativeAdapter && void runAction({
                                action: 'create_native_vendor_connection',
                                adapter_key: selectedNativeAdapter.adapter_key,
                                vendor_account_ref: nativeDraft.vendor_account_ref,
                                adapter_runtime_url: nativeDraft.adapter_runtime_url,
                                interval_hours: nativeDraft.interval_hours,
                                redirect_uri: nativeDraft.redirect_uri,
                            }, 'Native vendor connection created.')}
                            disabled={!selectedNativeAdapter}
                        >
                            Create Native Connection
                        </TerminalButton>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Native Connection Sync">
                    <Field label="Native Connection">
                        <Select value={selectedNativeConnectionId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedNativeConnectionId(event.target.value)}>
                            {snapshot.native_connections.map((connection) => (
                                <option key={connection.id} value={connection.id}>{connection.vendor_name} / {connection.adapter_key}</option>
                            ))}
                        </Select>
                    </Field>
                    {selectedNativeConnection ? (
                        <>
                            <div className="mt-4 border border-accent/30 bg-accent/5 p-4 rounded-sm">
                                <DataRow label="Status" value={selectedNativeConnection.status} tone={selectedNativeConnection.status === 'active' ? 'accent' : 'warning'} />
                                <DataRow label="Runtime URL" value={selectedNativeConnection.adapter_runtime_url ? 'CONFIGURED' : 'MISSING'} tone={selectedNativeConnection.adapter_runtime_url ? 'accent' : 'warning'} />
                                <DataRow label="Next Sync" value={formatTimestamp(selectedNativeConnection.next_sync_at)} />
                                <DataRow label="Last Sync" value={selectedNativeConnection.last_sync_status ?? 'NO DATA'} />
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                                <TerminalButton variant="secondary" onClick={() => void runAction({
                                    action: 'queue_native_vendor_sync',
                                    native_connection_id: selectedNativeConnection.id,
                                    reason: 'manual',
                                }, 'Native vendor sync queued.')}>
                                    Queue Native Sync
                                </TerminalButton>
                            </div>
                        </>
                    ) : (
                        <div className="mt-4 font-mono text-xs text-muted">No native vendor connections yet.</div>
                    )}
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <ConsoleCard title="Installed Connectors">
                    <div className="space-y-4">
                        {snapshot.installations.map((installation) => (
                            <InstallationRow key={installation.id} installation={installation} />
                        ))}
                        {snapshot.installations.length === 0 && (
                            <div className="font-mono text-xs text-muted">No passive connector installations have been provisioned yet.</div>
                        )}
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Recent Sync Deliveries">
                    <div className="space-y-4">
                        {snapshot.recent_delivery_attempts.map((attempt) => (
                            <AttemptRow key={attempt.id} attempt={attempt} />
                        ))}
                        {snapshot.recent_delivery_attempts.length === 0 && (
                            <div className="font-mono text-xs text-muted">No connector webhook deliveries have been attempted yet.</div>
                        )}
                    </div>
                </ConsoleCard>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <ConsoleCard title="Native Vendor Connections">
                    <div className="space-y-4">
                        {snapshot.native_connections.map((connection) => (
                            <NativeConnectionRow key={connection.id} connection={connection} />
                        ))}
                        {snapshot.native_connections.length === 0 && (
                            <div className="font-mono text-xs text-muted">No native vendor connections have been provisioned yet.</div>
                        )}
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Native Sync Runs">
                    <div className="space-y-4">
                        {snapshot.recent_native_sync_runs.map((run) => (
                            <NativeSyncRunRow key={run.id} run={run} />
                        ))}
                        {snapshot.recent_native_sync_runs.length === 0 && (
                            <div className="font-mono text-xs text-muted">No native vendor sync runs have been queued yet.</div>
                        )}
                    </div>
                </ConsoleCard>
            </div>
        </Container>
    );
}

function SummaryCard({ icon, label, value, tone = 'neutral' }: { icon: ReactNode; label: string; value: number; tone?: 'neutral' | 'warning' }) {
    return (
        <ConsoleCard className={tone === 'warning' ? 'border-warning/30' : 'border-accent/20'}>
            <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">{label}</div>
                <div className={tone === 'warning' ? 'text-warning' : 'text-accent'}>{icon}</div>
            </div>
            <div className={`font-mono text-3xl font-bold ${tone === 'warning' && value > 0 ? 'text-warning' : 'text-white'}`}>{value}</div>
        </ConsoleCard>
    );
}

function CoverageRow({ row }: { row: PassiveSignalOperationsSnapshot['readiness']['coverage'][number] }) {
    const tone = coverageTone(row.status);
    return (
        <div className={`border p-4 rounded-sm ${coverageBorderClass(row.status)}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="font-mono text-sm font-medium text-white">{row.label}</div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">{row.connector_type}</div>
                </div>
                <span className={`inline-flex items-center gap-1 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${coverageBadgeClass(row.status)}`}>
                    {row.status === 'stale' || row.status === 'missing' ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                    {row.status}
                </span>
            </div>
            <div className="mt-3 grid gap-x-4 gap-y-0 md:grid-cols-2">
                <DataRow label="Installs" value={row.installed_connectors} tone={row.installed_connectors > 0 ? 'accent' : 'muted'} />
                <DataRow label="Sources" value={row.active_sources} tone={row.active_sources > 0 ? 'accent' : 'muted'} />
                <DataRow label="Events 24h" value={row.recent_events_24h} />
                <DataRow label="Events 7d" value={row.recent_events_7d} />
                <DataRow label="Last Event" value={formatTimestamp(row.last_observed_at)} tone={row.last_observed_at ? tone : 'muted'} />
                <DataRow label="Last Sync" value={formatTimestamp(row.last_synced_at)} tone={row.last_synced_at ? tone : 'muted'} />
            </div>
            <div className="mt-3 border-t border-white/10 pt-3 font-mono text-xs leading-5 text-white/60">
                {row.operator_note}
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return <div><TerminalLabel>{label}</TerminalLabel>{children}</div>;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return <select {...props} className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground" />;
}

function InstallationRow({ installation }: { installation: PassiveConnectorInstallationSnapshot }) {
    return (
        <div className="border border-accent/20 bg-accent/[0.03] p-4 rounded-sm">
            <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                <div className="font-mono text-sm text-white font-medium">{installation.installation_name}</div>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent/80 border border-accent/20 bg-accent/10 px-2 py-0.5 rounded-full">{installation.vendor_name ?? 'NO VENDOR'}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/60 border border-white/10 px-2 py-0.5 rounded-full">{installation.sync_mode}</span>
                <span className={`font-mono text-[10px] uppercase tracking-[0.18em] border px-2 py-0.5 rounded-full ${installation.status === 'active' ? 'text-accent border-accent/30 bg-accent/10' : 'text-white/40 border-white/10'}`}>{installation.status}</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Marketplace" value={installation.marketplace_template?.label ?? 'CUSTOM'} />
                <DataRow label="Scheduler" value={installation.scheduler.enabled ? 'ON' : 'OFF'} />
                <DataRow label="Next Sync" value={formatTimestamp(installation.scheduler.next_sync_at)} />
                <DataRow label="Last Sync" value={formatTimestamp(installation.scheduler.last_sync_requested_at)} />
            </div>
        </div>
    );
}

function AttemptRow({ attempt }: { attempt: PassiveSignalOperationsSnapshot['recent_delivery_attempts'][number] }) {
    const isOk = attempt.status === 'succeeded';
    return (
        <div className={`border p-4 rounded-sm ${isOk ? 'border-accent/20 bg-accent/[0.03]' : 'border-warning/20 bg-warning/[0.03]'}`}>
            <div className="flex items-center gap-2 mb-2">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOk ? 'bg-accent' : 'bg-warning'}`} />
                <div className="font-mono text-sm text-white font-medium truncate">{attempt.connector_installation_id ?? 'NO INSTALLATION'}</div>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
                <span className={`font-mono text-[10px] uppercase tracking-[0.18em] border px-2 py-0.5 rounded-full ${isOk ? 'text-accent border-accent/30 bg-accent/10' : 'text-warning border-warning/30 bg-warning/10'}`}>{attempt.status}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50 border border-white/10 px-2 py-0.5 rounded-full">attempt {attempt.attempt_no}</span>
            </div>
            <div className="mt-3 grid gap-x-6 gap-y-1 grid-cols-1 md:grid-cols-2 min-w-0">
                <DataRow label="Started" value={formatTimestamp(attempt.started_at)} />
                <DataRow label="Finished" value={formatTimestamp(attempt.finished_at)} />
                <div className="md:col-span-2 border-t border-muted/10 pt-1">
                    <DataRow label="Handler" value={attempt.handler_key} />
                </div>
                <div className="md:col-span-2">
                    <DataRow label="Error" value={attempt.error_message ?? 'NO ERROR'} />
                </div>
            </div>
        </div>
    );
}

function NativeConnectionRow({ connection }: { connection: NativeVendorConnectionRecord }) {
    const isActive = connection.status === 'active';
    return (
        <div className={`border p-4 rounded-sm ${isActive ? 'border-accent/20 bg-accent/[0.03]' : 'border-warning/20 bg-warning/[0.03]'}`}>
            <div className="flex items-center gap-2 mb-2">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-accent' : 'bg-warning'}`} />
                <div className="font-mono text-sm text-white font-medium">{connection.vendor_name}</div>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
                <span className={`font-mono text-[10px] uppercase tracking-[0.18em] border px-2 py-0.5 rounded-full ${isActive ? 'text-accent border-accent/30 bg-accent/10' : 'text-warning border-warning/30 bg-warning/10'}`}>{connection.status}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/60 border border-white/10 px-2 py-0.5 rounded-full">{connection.auth_protocol}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/60 border border-white/10 px-2 py-0.5 rounded-full">{connection.sync_mode}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
                <DataRow label="Adapter" value={connection.adapter_key} />
                <DataRow label="Runtime" value={connection.adapter_runtime_url ? 'CONFIGURED' : 'MISSING'} tone={connection.adapter_runtime_url ? 'accent' : 'warning'} />
                <DataRow label="Next Sync" value={formatTimestamp(connection.next_sync_at)} />
                <DataRow label="Last Authorized" value={formatTimestamp(connection.last_authorized_at)} />
            </div>
        </div>
    );
}

function NativeSyncRunRow({ run }: { run: NativeVendorSyncRunRecord }) {
    const isQueued = run.status === 'queued' || run.status === 'running';
    const isOk = run.status === 'succeeded';
    return (
        <div className={`border p-4 rounded-sm ${isOk ? 'border-accent/20 bg-accent/[0.03]' : isQueued ? 'border-warning/20 bg-warning/[0.03]' : 'border-danger/20 bg-danger/[0.03]'}`}>
            <div className="flex items-center gap-2 mb-2">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOk ? 'bg-accent' : isQueued ? 'bg-warning' : 'bg-danger'}`} />
                <div className="font-mono text-sm text-white font-medium">{run.adapter_key}</div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
                <DataRow label="Status" value={run.status} tone={isOk ? 'accent' : isQueued ? 'warning' : 'danger'} />
                <DataRow label="Reason" value={run.run_reason} />
                <DataRow label="Events" value={run.events_ingested} />
                <DataRow label="Requested" value={formatTimestamp(run.requested_at)} />
                <DataRow label="Outbox" value={run.outbox_event_id ? 'QUEUED' : 'NO RUNTIME'} tone={run.outbox_event_id ? 'accent' : 'warning'} />
                <DataRow label="Error" value={run.error_message ?? 'NO ERROR'} />
            </div>
        </div>
    );
}

function ActionStatePanel({ state }: { state: { status: 'idle' | 'running' | 'success' | 'error'; message: string } }) {
    if (state.status === 'idle' || !state.message) return null;
    const tone = state.status === 'error'
        ? 'border-danger/30 bg-danger/10 text-danger'
        : state.status === 'success'
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-warning/30 bg-warning/10 text-warning';
    return <div className={`mt-4 border px-4 py-3 font-mono text-xs ${tone}`}>{state.message}</div>;
}

function coverageTone(status: PassiveSignalOperationsSnapshot['readiness']['coverage'][number]['status']): 'accent' | 'warning' | 'danger' | 'muted' {
    if (status === 'ready') return 'accent';
    if (status === 'stale' || status === 'quiet') return 'warning';
    if (status === 'missing') return 'danger';
    return 'muted';
}

function coverageBorderClass(status: PassiveSignalOperationsSnapshot['readiness']['coverage'][number]['status']): string {
    if (status === 'ready') return 'border-accent/25 bg-accent/[0.03]';
    if (status === 'stale' || status === 'quiet') return 'border-warning/25 bg-warning/[0.03]';
    return 'border-danger/25 bg-danger/[0.03]';
}

function coverageBadgeClass(status: PassiveSignalOperationsSnapshot['readiness']['coverage'][number]['status']): string {
    if (status === 'ready') return 'border-accent/30 bg-accent/10 text-accent';
    if (status === 'stale' || status === 'quiet') return 'border-warning/30 bg-warning/10 text-warning';
    return 'border-danger/30 bg-danger/10 text-danger';
}

function formatTimestamp(value: string | null): string {
    if (!value) return 'NO DATA';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
