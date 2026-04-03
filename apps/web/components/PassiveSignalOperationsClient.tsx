'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarClock, KeyRound, PlugZap, RefreshCw } from 'lucide-react';
import {
    ConsoleCard,
    Container,
    DataRow,
    PageHeader,
    TerminalButton,
    TerminalInput,
    TerminalLabel,
} from '@/components/ui/terminal';
import type { PassiveSignalOperationsSnapshot, PassiveConnectorInstallationSnapshot } from '@/lib/passiveSignals/service';

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

    const selectedTemplate = useMemo(
        () => snapshot.marketplace.find((template) => template.id === selectedMarketplaceId) ?? snapshot.marketplace[0] ?? null,
        [selectedMarketplaceId, snapshot.marketplace],
    );
    const selectedInstallation = useMemo(
        () => snapshot.installations.find((installation) => installation.id === selectedInstallationId) ?? snapshot.installations[0] ?? null,
        [selectedInstallationId, snapshot.installations],
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

    async function refreshSnapshot() {
        setRefreshing(true);
        try {
            const res = await fetch('/api/platform/passive-signals', { cache: 'no-store' });
            const data = await res.json() as { snapshot?: PassiveSignalOperationsSnapshot; error?: string };
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
            const data = await res.json() as { snapshot?: PassiveSignalOperationsSnapshot; error?: string; generated_api_key?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Passive-signal operation failed.');
            }
            setSnapshot(data.snapshot);
            setGeneratedKey(typeof data.generated_api_key === 'string' ? data.generated_api_key : null);
            setActionState({ status: 'success', message: successMessage });
        } catch (error) {
            setActionState({ status: 'error', message: error instanceof Error ? error.message : 'Passive-signal operation failed.' });
        }
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader
                title="PASSIVE SIGNAL OPS"
                description="Install connector marketplace packs, switch from legacy shared-secret ingest to installation credentials, and run scheduled syncs through the passive signal engine."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <SummaryCard icon={<PlugZap className="h-4 w-4" />} label="Marketplace Packs" value={snapshot.summary.marketplace_templates} />
                <SummaryCard icon={<KeyRound className="h-4 w-4" />} label="Active Installs" value={snapshot.summary.active_installations} />
                <SummaryCard icon={<CalendarClock className="h-4 w-4" />} label="Scheduled Syncs" value={snapshot.summary.scheduled_installations} />
                <SummaryCard icon={<Activity className="h-4 w-4" />} label="Recent Failures" value={snapshot.summary.recent_failed_syncs} tone={snapshot.summary.recent_failed_syncs > 0 ? 'warning' : 'neutral'} />
            </div>

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
                        <Select value={selectedMarketplaceId} onChange={(event) => setSelectedMarketplaceId(event.target.value)}>
                            {snapshot.marketplace.map((template) => (
                                <option key={template.id} value={template.id}>{template.label}</option>
                            ))}
                        </Select>
                    </Field>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <Field label="Installation Name"><TerminalInput value={installDraft.installation_name} onChange={(event) => setInstallDraft((current) => ({ ...current, installation_name: event.target.value }))} /></Field>
                        <Field label="Vendor Account Ref"><TerminalInput value={installDraft.vendor_account_ref} onChange={(event) => setInstallDraft((current) => ({ ...current, vendor_account_ref: event.target.value }))} /></Field>
                        <Field label="Webhook URL"><TerminalInput value={installDraft.webhook_url} onChange={(event) => setInstallDraft((current) => ({ ...current, webhook_url: event.target.value }))} /></Field>
                        <Field label="Interval Hours"><TerminalInput value={installDraft.interval_hours} onChange={(event) => setInstallDraft((current) => ({ ...current, interval_hours: event.target.value }))} /></Field>
                    </div>
                    {selectedTemplate ? (
                        <div className="mt-4 border border-grid p-4">
                            <div className="font-mono text-sm text-foreground">{selectedTemplate.label}</div>
                            <div className="mt-2 font-mono text-xs text-muted">{selectedTemplate.summary}</div>
                            <div className="mt-3 grid gap-2 md:grid-cols-2">
                                <DataRow label="Vendor" value={selectedTemplate.vendor_name} />
                                <DataRow label="Sync mode" value={selectedTemplate.sync_mode} />
                                <DataRow label="Auth" value={selectedTemplate.auth_strategy} />
                                <DataRow label="Schedule" value={selectedTemplate.sample_schedule ?? 'MANUAL'} />
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
                        <Select value={selectedInstallationId} onChange={(event) => setSelectedInstallationId(event.target.value)}>
                            {snapshot.installations.map((installation) => (
                                <option key={installation.id} value={installation.id}>{installation.installation_name}</option>
                            ))}
                        </Select>
                    </Field>
                    {selectedInstallation ? (
                        <>
                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <Field label="Installation Name"><TerminalInput value={configDraft.installation_name} onChange={(event) => setConfigDraft((current) => ({ ...current, installation_name: event.target.value }))} /></Field>
                                <Field label="Vendor Account Ref"><TerminalInput value={configDraft.vendor_account_ref} onChange={(event) => setConfigDraft((current) => ({ ...current, vendor_account_ref: event.target.value }))} /></Field>
                                <Field label="Webhook URL"><TerminalInput value={configDraft.webhook_url} onChange={(event) => setConfigDraft((current) => ({ ...current, webhook_url: event.target.value }))} /></Field>
                                <Field label="Sync Mode">
                                    <Select value={configDraft.sync_mode} onChange={(event) => setConfigDraft((current) => ({ ...current, sync_mode: event.target.value }))}>
                                        <option value="scheduled_pull">scheduled_pull</option>
                                        <option value="webhook_push">webhook_push</option>
                                        <option value="manual_file_drop">manual_file_drop</option>
                                    </Select>
                                </Field>
                                <Field label="Interval Hours"><TerminalInput value={configDraft.interval_hours} onChange={(event) => setConfigDraft((current) => ({ ...current, interval_hours: event.target.value }))} /></Field>
                                <Field label="Scheduler Enabled">
                                    <Select value={configDraft.scheduler_enabled} onChange={(event) => setConfigDraft((current) => ({ ...current, scheduler_enabled: event.target.value }))}>
                                        <option value="true">true</option>
                                        <option value="false">false</option>
                                    </Select>
                                </Field>
                                <Field label="Status">
                                    <Select value={configDraft.status} onChange={(event) => setConfigDraft((current) => ({ ...current, status: event.target.value }))}>
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
        </Container>
    );
}

function SummaryCard({ icon, label, value, tone = 'neutral' }: { icon: ReactNode; label: string; value: number; tone?: 'neutral' | 'warning' }) {
    return (
        <ConsoleCard className={tone === 'warning' ? 'border-warning/30 text-warning' : undefined}>
            <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
                <div>{icon}</div>
            </div>
            <div className="font-mono text-3xl">{value}</div>
        </ConsoleCard>
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
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{installation.installation_name}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {installation.vendor_name ?? 'NO VENDOR'} / {installation.sync_mode} / {installation.status}
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
    return (
        <div className="border border-grid p-4">
            <div className="font-mono text-sm text-foreground">{attempt.connector_installation_id ?? 'NO INSTALLATION'}</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {attempt.status} / attempt {attempt.attempt_no}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Started" value={formatTimestamp(attempt.started_at)} />
                <DataRow label="Finished" value={formatTimestamp(attempt.finished_at)} />
                <DataRow label="Handler" value={attempt.handler_key} />
                <DataRow label="Error" value={attempt.error_message ?? 'NO ERROR'} />
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

function formatTimestamp(value: string | null): string {
    if (!value) return 'NO DATA';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
