'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    Clock3,
    RefreshCw,
    RotateCcw,
    Siren,
    TimerReset,
} from 'lucide-react';
import {
    ConsoleCard,
    Container,
    DataRow,
    PageHeader,
    TerminalButton,
} from '@/components/ui/terminal';
import type {
    ConnectorDeliveryAttemptRecord,
    OutboxEventRecord,
    OutboxQueueSnapshot,
    OutboxStatus,
} from '@/lib/eventPlane/outbox';

type StatusFilter = 'all' | OutboxStatus;

interface SchedulerConfig {
    cronPath: string;
    cronSchedule: string;
    batchSize: number;
    maxBatches: number;
    cronSecretConfigured: boolean;
}

export default function OutboxOperationsClient({
    initialSnapshot,
    tenantId,
    scheduler,
}: {
    initialSnapshot: OutboxQueueSnapshot;
    tenantId: string;
    scheduler: SchedulerConfig;
}) {
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('dead_letter');
    const [refreshing, setRefreshing] = useState(false);
    const [actionState, setActionState] = useState<{
        status: 'idle' | 'running' | 'success' | 'error';
        message: string;
    }>({
        status: 'idle',
        message: '',
    });

    const filteredEvents = useMemo(() => (
        statusFilter === 'all'
            ? snapshot.recent_events
            : snapshot.recent_events.filter((event) => event.status === statusFilter)
    ), [snapshot.recent_events, statusFilter]);

    async function refreshSnapshot(nextStatus: StatusFilter = statusFilter) {
        setRefreshing(true);
        try {
            const params = new URLSearchParams({
                limit: '60',
                tenant_id: tenantId,
            });

            const res = await fetch(`/api/platform/outbox?${params.toString()}`, { cache: 'no-store' });
            const data = await res.json() as { snapshot?: OutboxQueueSnapshot; error?: string };
            if (!res.ok || !data.snapshot) {
                throw new Error(data.error ?? 'Failed to load outbox snapshot.');
            }

            setSnapshot(data.snapshot);
            setStatusFilter(nextStatus);
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to refresh outbox snapshot.',
            });
        } finally {
            setRefreshing(false);
        }
    }

    async function runAction(body: Record<string, unknown>, successMessage: string) {
        setActionState({ status: 'running', message: 'Running outbox operation...' });
        try {
            const res = await fetch('/api/platform/outbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tenant_id: tenantId,
                    ...body,
                }),
            });
            const data = await res.json() as { snapshot?: OutboxQueueSnapshot; error?: string };
            if (!res.ok) {
                throw new Error(data.error ?? 'Outbox operation failed.');
            }
            if (data.snapshot) {
                setSnapshot(data.snapshot);
            } else {
                await refreshSnapshot(statusFilter);
            }
            setActionState({ status: 'success', message: successMessage });
        } catch (error) {
            setActionState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Outbox operation failed.',
            });
        }
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader
                title="OUTBOX OPERATIONS"
                description="Scheduled dispatch, retry control, and dead-letter recovery for VetIOS background delivery."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <SummaryCard icon={<Clock3 className="h-4 w-4" />} label="Pending" value={snapshot.counts.pending} tone="neutral" />
                <SummaryCard icon={<RefreshCw className="h-4 w-4" />} label="Retryable" value={snapshot.counts.retryable} tone="warning" />
                <SummaryCard icon={<CheckCircle2 className="h-4 w-4" />} label="Delivered" value={snapshot.counts.delivered} tone="success" />
                <SummaryCard icon={<Siren className="h-4 w-4" />} label="Dead Letter" value={snapshot.counts.dead_letter} tone={snapshot.counts.dead_letter > 0 ? 'danger' : 'neutral'} />
            </div>

            <ConsoleCard title="Dispatcher Control" className="mt-6">
                <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="space-y-3">
                        <div className="font-mono text-xs text-muted">
                            Automatic dispatch is scheduled through Vercel cron. This route is designed to keep async connector reconciliation moving without an operator button click.
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <TerminalButton variant="secondary" onClick={() => void refreshSnapshot(statusFilter)} disabled={refreshing}>
                                <RefreshCw className="mr-2 h-3 w-3" />
                                {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
                            </TerminalButton>
                            <TerminalButton onClick={() => void runAction({ action: 'dispatch', batch_size: scheduler.batchSize }, 'Manual dispatch completed.')}>
                                <RefreshCw className="mr-2 h-3 w-3" />
                                Dispatch Now
                            </TerminalButton>
                            <TerminalButton
                                variant="secondary"
                                onClick={() => void runAction({ action: 'requeue_dead_letters', limit: 25 }, 'Dead-letter events requeued.')}
                                disabled={snapshot.counts.dead_letter === 0}
                            >
                                <RotateCcw className="mr-2 h-3 w-3" />
                                Retry Dead Letters
                            </TerminalButton>
                            <TerminalButton
                                variant="secondary"
                                onClick={() => void runAction({ action: 'release_stale_processing', older_than_minutes: 5 }, 'Stale processing leases released.')}
                            >
                                <TimerReset className="mr-2 h-3 w-3" />
                                Release Stale Leases
                            </TerminalButton>
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
                        <ConsoleCard title="Scheduler Profile">
                            <DataRow label="Cron Route" value={scheduler.cronPath} />
                            <DataRow label="Schedule" value={scheduler.cronSchedule} />
                            <DataRow label="Batch Size" value={scheduler.batchSize} />
                            <DataRow label="Max Batches" value={scheduler.maxBatches} />
                            <DataRow label="CRON_SECRET" value={scheduler.cronSecretConfigured ? 'configured' : 'missing'} />
                        </ConsoleCard>
                    </div>
                </div>
                <ActionStatePanel state={actionState} />
            </ConsoleCard>

            <div className="mt-6 flex flex-wrap gap-2">
                {(['all', 'pending', 'processing', 'retryable', 'dead_letter', 'delivered'] as StatusFilter[]).map((filter) => (
                    <button
                        key={filter}
                        type="button"
                        onClick={() => void refreshSnapshot(filter)}
                        className={`border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                            statusFilter === filter
                                ? 'border-accent bg-accent/10 text-accent'
                                : 'border-grid text-muted hover:border-accent/40 hover:text-foreground'
                        }`}
                    >
                        {formatFilterLabel(filter)}
                    </button>
                ))}
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <ConsoleCard title={statusFilter === 'all' ? 'Recent Queue Events' : `${formatFilterLabel(statusFilter)} Events`}>
                    {filteredEvents.length === 0 ? (
                        <div className="font-mono text-xs text-muted">No queue events matched the current filter.</div>
                    ) : (
                        <div className="space-y-4">
                            {filteredEvents.map((event) => (
                                <EventRow
                                    key={event.id}
                                    event={event}
                                    onRetry={event.status === 'dead_letter'
                                        ? () => void runAction({ action: 'requeue_event', event_id: event.id }, `Requeued ${event.id}.`)
                                        : null}
                                />
                            ))}
                        </div>
                    )}
                </ConsoleCard>

                <ConsoleCard title="Recent Delivery Attempts">
                    {snapshot.recent_attempts.length === 0 ? (
                        <div className="font-mono text-xs text-muted">No delivery attempts recorded yet.</div>
                    ) : (
                        <div className="space-y-4">
                            {snapshot.recent_attempts.slice(0, 10).map((attempt) => (
                                <AttemptRow key={attempt.id} attempt={attempt} />
                            ))}
                        </div>
                    )}
                </ConsoleCard>
            </div>
        </Container>
    );
}

function SummaryCard({
    icon,
    label,
    value,
    tone,
}: {
    icon: ReactNode;
    label: string;
    value: number;
    tone: 'neutral' | 'warning' | 'danger' | 'success';
}) {
    const toneClasses = tone === 'success'
        ? 'border-accent/25 text-accent'
        : tone === 'warning'
            ? 'border-warning/30 text-warning'
            : tone === 'danger'
                ? 'border-danger/30 text-danger'
                : 'border-grid text-foreground';

    return (
        <ConsoleCard className={toneClasses}>
            <div className="flex items-center justify-between">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
                <div>{icon}</div>
            </div>
            <div className="font-mono text-3xl">{value}</div>
        </ConsoleCard>
    );
}

function EventRow({
    event,
    onRetry,
}: {
    event: OutboxEventRecord;
    onRetry: (() => void) | null;
}) {
    return (
        <div className={`border p-4 ${
            event.status === 'dead_letter'
                ? 'border-danger/20 bg-danger/5'
                : event.status === 'retryable'
                    ? 'border-warning/20 bg-warning/5'
                    : event.status === 'delivered'
                        ? 'border-accent/20 bg-accent/5'
                        : 'border-grid'
        }`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="font-mono text-sm text-foreground">{event.topic}</div>
                    <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                        {event.handler_key} · {event.status} · {event.id}
                    </div>
                </div>
                {onRetry ? (
                    <TerminalButton variant="secondary" onClick={onRetry}>
                        <RotateCcw className="mr-2 h-3 w-3" />
                        Retry
                    </TerminalButton>
                ) : null}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Attempts" value={`${event.attempt_count}/${event.max_attempts}`} />
                <DataRow label="Available At" value={formatTimestamp(event.available_at)} />
                <DataRow label="Created" value={formatTimestamp(event.created_at)} />
                <DataRow label="Last Error" value={event.last_error ?? 'none'} />
            </div>
        </div>
    );
}

function AttemptRow({ attempt }: { attempt: ConnectorDeliveryAttemptRecord }) {
    return (
        <div className="border border-grid p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="font-mono text-sm text-foreground">{attempt.handler_key}</div>
                    <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                        attempt {attempt.attempt_no} · {attempt.outbox_event_id}
                    </div>
                </div>
                <div className={`font-mono text-[11px] uppercase tracking-[0.18em] ${
                    attempt.status === 'succeeded'
                        ? 'text-accent'
                        : attempt.status === 'processing'
                            ? 'text-warning'
                            : 'text-danger'
                }`}>
                    {attempt.status}
                </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
                <DataRow label="Worker" value={attempt.worker_id ?? 'unknown'} />
                <DataRow label="Started" value={formatTimestamp(attempt.started_at)} />
                <DataRow label="Finished" value={attempt.finished_at ? formatTimestamp(attempt.finished_at) : 'in flight'} />
                <DataRow label="Error" value={attempt.error_message ?? 'none'} />
            </div>
        </div>
    );
}

function ActionStatePanel({
    state,
}: {
    state: {
        status: 'idle' | 'running' | 'success' | 'error';
        message: string;
    };
}) {
    if (state.status === 'idle' || !state.message) {
        return null;
    }

    const tone = state.status === 'error'
        ? 'border-danger/30 bg-danger/10 text-danger'
        : state.status === 'success'
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-warning/30 bg-warning/10 text-warning';

    return (
        <div className={`mt-4 border px-4 py-3 font-mono text-xs ${tone}`}>
            {state.message}
        </div>
    );
}

function formatFilterLabel(filter: StatusFilter): string {
    return filter === 'all' ? 'All Events' : filter.replace('_', ' ');
}

function formatTimestamp(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
