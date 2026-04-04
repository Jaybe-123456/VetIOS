'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Clock3,
    Loader2,
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
    OutboxDeliveryAttempt,
    OutboxEventListItem,
    OutboxSnapshot,
    OutboxStatus,
} from '@/lib/outbox/types';

type StatusFilter = 'all' | Exclude<OutboxStatus, 'processing'>;

interface SchedulerConfig {
    cronPath: string;
    cronSchedule: string;
    batchSize: number;
    maxBatches: number;
    cronSecretConfigured: boolean;
}

interface AttemptState {
    loading: boolean;
    attempts: OutboxDeliveryAttempt[];
    error: string | null;
}

export default function OutboxOperationsClient({
    initialSnapshot,
    initialEvents,
    scheduler,
}: {
    initialSnapshot: OutboxSnapshot;
    initialEvents: OutboxEventListItem[];
    scheduler: SchedulerConfig;
}) {
    const [snapshot, setSnapshot] = useState<OutboxSnapshot>(() => normalizeSnapshot(initialSnapshot));
    const [events, setEvents] = useState<OutboxEventListItem[]>(() => normalizeEventList(initialEvents));
    const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');
    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
    const [attemptStates, setAttemptStates] = useState<Record<string, AttemptState>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isDispatching, setIsDispatching] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [isReleasing, setIsReleasing] = useState(false);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
    const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

    useEffect(() => {
        void refreshAll('all', { quiet: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void refreshAll(selectedStatus, { quiet: true });
            }
        }, 30_000);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void refreshAll(selectedStatus, { quiet: true });
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStatus]);

    async function refreshAll(nextStatus: StatusFilter = selectedStatus, options: { quiet?: boolean } = {}) {
        if (!options.quiet) {
            setIsLoading(true);
        }

        try {
            const [snapshotRes, eventsRes] = await Promise.all([
                fetch('/api/outbox/snapshot', { cache: 'no-store' }),
                fetch(buildEventsPath(nextStatus), { cache: 'no-store' }),
            ]);

            const snapshotData = await snapshotRes.json() as { snapshot?: unknown; error?: string };
            const eventsData = await eventsRes.json() as { events?: unknown; error?: string };
            if (!snapshotRes.ok || !snapshotData.snapshot) {
                throw new Error(snapshotData.error ?? 'Failed to load outbox snapshot.');
            }
            if (!eventsRes.ok || !eventsData.events) {
                throw new Error(eventsData.error ?? 'Failed to load outbox events.');
            }

            setSnapshot(normalizeSnapshot(snapshotData.snapshot));
            setEvents(normalizeEventList(eventsData.events));
            setSelectedStatus(nextStatus);
            setLastRefreshed(new Date());
        } catch (error) {
            if (!options.quiet) {
                setNotice({
                    tone: 'error',
                    message: error instanceof Error ? error.message : 'Failed to refresh outbox state.',
                });
            }
        } finally {
            if (!options.quiet) {
                setIsLoading(false);
            }
        }
    }

    async function loadAttempts(eventId: string) {
        setAttemptStates((current) => ({
            ...current,
            [eventId]: {
                loading: true,
                attempts: current[eventId]?.attempts ?? [],
                error: null,
            },
        }));

        try {
            const res = await fetch(`/api/outbox/events/${eventId}/attempts`, { cache: 'no-store' });
            const data = await res.json() as { attempts?: unknown; error?: string };
            if (!res.ok || !data.attempts) {
                throw new Error(data.error ?? 'Failed to load delivery attempts.');
            }

            setAttemptStates((current) => ({
                ...current,
                [eventId]: {
                    loading: false,
                    attempts: normalizeAttemptList(data.attempts),
                    error: null,
                },
            }));
        } catch (error) {
            setAttemptStates((current) => ({
                ...current,
                [eventId]: {
                    loading: false,
                    attempts: current[eventId]?.attempts ?? [],
                    error: error instanceof Error ? error.message : 'Failed to load delivery attempts.',
                },
            }));
        }
    }

    async function handleToggleEvent(eventId: string) {
        const nextExpanded = expandedEventId === eventId ? null : eventId;
        setExpandedEventId(nextExpanded);
        if (nextExpanded && !attemptStates[eventId]) {
            await loadAttempts(eventId);
        }
    }

    async function runDispatch() {
        setIsDispatching(true);
        try {
            const res = await fetch('/api/outbox/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ batchSize: scheduler.batchSize }),
            });
            const data = await res.json() as {
                result?: {
                    dispatched: number;
                    delivered: number;
                    failed: number;
                    deadLettered: number;
                };
                error?: string;
            };
            if (!res.ok || !data.result) {
                throw new Error(data.error ?? 'Dispatch failed.');
            }

            setNotice({
                tone: 'success',
                message: `Dispatched ${data.result.dispatched} events. Delivered ${data.result.delivered}; failed ${data.result.failed}; dead-lettered ${data.result.deadLettered}.`,
            });
            await refreshAll(selectedStatus, { quiet: true });
            setLastRefreshed(new Date());
        } catch (error) {
            setNotice({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Dispatch failed.',
            });
        } finally {
            setIsDispatching(false);
        }
    }

    async function runRetryDeadLetters() {
        setIsRetrying(true);
        try {
            const res = await fetch('/api/outbox/retry-dead-letters', { method: 'POST' });
            const data = await res.json() as { reset?: number; error?: string };
            if (!res.ok || typeof data.reset !== 'number') {
                throw new Error(data.error ?? 'Retry dead letters failed.');
            }

            setNotice({
                tone: 'success',
                message: `Reset ${data.reset} dead-letter events back to retryable.`,
            });
            await refreshAll(selectedStatus, { quiet: true });
            setLastRefreshed(new Date());
        } catch (error) {
            setNotice({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Retry dead letters failed.',
            });
        } finally {
            setIsRetrying(false);
        }
    }

    async function runReleaseStaleLeases() {
        setIsReleasing(true);
        try {
            const res = await fetch('/api/outbox/release-stale-leases', { method: 'POST' });
            const data = await res.json() as { released?: number; error?: string };
            if (!res.ok || typeof data.released !== 'number') {
                throw new Error(data.error ?? 'Release stale leases failed.');
            }

            setNotice({
                tone: 'success',
                message: `Released ${data.released} stale processing leases.`,
            });
            await refreshAll(selectedStatus, { quiet: true });
            setLastRefreshed(new Date());
        } catch (error) {
            setNotice({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Release stale leases failed.',
            });
        } finally {
            setIsReleasing(false);
        }
    }

    return (
        <Container className="max-w-[1600px]">
            <PageHeader
                title="OUTBOX OPERATIONS"
                description="Scheduled dispatch, retry control, and dead-letter recovery for VetIOS background delivery."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <SummaryCard icon={<Clock3 className="h-4 w-4" />} label="Pending" value={snapshot.pending} tone="neutral" />
                <SummaryCard icon={<RefreshCw className="h-4 w-4" />} label="Retryable" value={snapshot.retryable} tone="warning" />
                <SummaryCard icon={<CheckCircle2 className="h-4 w-4" />} label="Delivered" value={snapshot.delivered} tone="success" />
                <SummaryCard icon={<Siren className="h-4 w-4" />} label="Dead Letter" value={snapshot.deadLetter} tone={snapshot.deadLetter > 0 ? 'danger' : 'neutral'} />
            </div>

            <ConsoleCard title="Dispatcher Control" className="mt-6">
                <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="space-y-3">
                        <div className="font-mono text-xs text-muted">
                            Automatic dispatch is scheduled through Vercel cron. Operators can manually drain the queue, rearm dead letters, or release stale processing leases from this surface.
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <TerminalButton variant="secondary" onClick={() => void refreshAll(selectedStatus)} disabled={isLoading}>
                                <RefreshCw className="mr-2 h-3 w-3" />
                                {isLoading ? 'Refreshing...' : 'Refresh Snapshot'}
                            </TerminalButton>
                            <TerminalButton onClick={() => void runDispatch()} disabled={isDispatching}>
                                {isDispatching ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
                                {isDispatching ? 'Dispatching...' : 'Dispatch Now'}
                            </TerminalButton>
                            <TerminalButton
                                variant="secondary"
                                onClick={() => void runRetryDeadLetters()}
                                disabled={isRetrying || snapshot.deadLetter === 0}
                            >
                                {isRetrying ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-2 h-3 w-3" />}
                                Retry Dead Letters
                            </TerminalButton>
                            <TerminalButton
                                variant="secondary"
                                onClick={() => void runReleaseStaleLeases()}
                                disabled={isReleasing}
                            >
                                {isReleasing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <TimerReset className="mr-2 h-3 w-3" />}
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
                            <DataRow label="Last Refreshed" value={lastRefreshed ? formatTimestamp(lastRefreshed) : 'initial state'} />
                        </ConsoleCard>
                    </div>
                </div>
            </ConsoleCard>

            <div className="mt-6 flex flex-wrap gap-2">
                {(['all', 'pending', 'retryable', 'dead_letter', 'delivered'] as StatusFilter[]).map((filter) => (
                    <button
                        key={filter}
                        type="button"
                        onClick={() => void refreshAll(filter)}
                        className={`border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                            selectedStatus === filter
                                ? 'border-accent bg-accent/10 text-accent'
                                : 'border-grid text-muted hover:border-accent/40 hover:text-foreground'
                        }`}
                    >
                        {formatFilterLabel(filter)}
                    </button>
                ))}
            </div>

            <div className="mt-6 grid gap-6">
                <ConsoleCard title={selectedStatus === 'all' ? 'Recent Queue Events' : `${formatFilterLabel(selectedStatus)} Events`}>
                    {events.length === 0 ? (
                        <div className="font-mono text-xs text-muted">No queue events matched the current filter.</div>
                    ) : (
                        <div className="space-y-4">
                            {events.map((event) => (
                                <EventRow
                                    key={event.id}
                                    event={event}
                                    expanded={expandedEventId === event.id}
                                    attemptState={attemptStates[event.id] ?? null}
                                    onToggle={() => void handleToggleEvent(event.id)}
                                />
                            ))}
                        </div>
                    )}
                </ConsoleCard>
            </div>

            <ActionToast notice={notice} onDismiss={() => setNotice(null)} />
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
    expanded,
    attemptState,
    onToggle,
}: {
    event: OutboxEventListItem;
    expanded: boolean;
    attemptState: AttemptState | null;
    onToggle: () => void;
}) {
    return (
        <div className={`border ${
            event.status === 'dead_letter'
                ? 'border-danger/25 bg-danger/5'
                : event.status === 'retryable' || event.status === 'processing'
                    ? 'border-warning/25 bg-warning/5'
                    : event.status === 'delivered'
                        ? 'border-accent/25 bg-accent/5'
                        : 'border-grid'
        }`}>
            <button
                type="button"
                onClick={onToggle}
                className="w-full p-4 text-left"
            >
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="font-mono text-sm text-foreground">{event.aggregateType}</div>
                            <StatusBadge status={event.status} />
                            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{event.eventName}</div>
                        </div>
                        <div className="grid gap-2 text-left md:grid-cols-2 xl:grid-cols-3">
                            <DataRow label="Event ID" value={truncateId(event.id)} />
                            <DataRow label="Aggregate ID" value={event.aggregateId} />
                            <DataRow label="Attempts" value={`${event.attemptCount}/${event.maxAttempts}`} />
                            <DataRow label="Created" value={formatTimestamp(event.createdAt)} />
                            <DataRow label="Last Attempt" value={event.lastAttemptedAt ? formatTimestamp(event.lastAttemptedAt) : 'never'} />
                            <DataRow label="Attempt History" value={String(event.deliveryAttemptCount)} />
                        </div>
                    </div>
                    <div className="mt-1 text-muted">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>
                </div>
            </button>

            {expanded ? (
                <div className="border-t border-grid/60 px-4 pb-4">
                    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                        <ConsoleCard title="Payload" className="bg-transparent">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-muted">
                                {JSON.stringify(event.payload, null, 2)}
                            </pre>
                        </ConsoleCard>

                        <ConsoleCard title="Delivery Attempts" className="bg-transparent">
                            {attemptState?.loading ? (
                                <div className="flex items-center gap-2 font-mono text-xs text-muted">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Loading attempt history...
                                </div>
                            ) : attemptState?.error ? (
                                <div className="font-mono text-xs text-danger">{attemptState.error}</div>
                            ) : attemptState && attemptState.attempts.length > 0 ? (
                                <div className="space-y-3">
                                    {attemptState.attempts.map((attempt) => (
                                        <div key={attempt.id} className="border border-grid p-3">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                                                    {formatTimestamp(attempt.attemptedAt)}
                                                </div>
                                                <div className={`font-mono text-[11px] uppercase tracking-[0.18em] ${
                                                    attempt.success ? 'text-accent' : 'text-danger'
                                                }`}>
                                                    {attempt.success ? 'success' : 'failed'}
                                                </div>
                                            </div>
                                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                                                <DataRow label="Status Code" value={attempt.statusCode ?? 'n/a'} />
                                                <DataRow label="Duration" value={attempt.durationMs != null ? `${attempt.durationMs} ms` : 'n/a'} />
                                                <DataRow label="Error" value={attempt.errorDetail ?? 'none'} />
                                                <DataRow label="Response" value={attempt.responseBody ?? 'none'} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="font-mono text-xs text-muted">No delivery attempts recorded yet for this event.</div>
                            )}
                        </ConsoleCard>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function StatusBadge({ status }: { status: OutboxStatus }) {
    const classes = status === 'pending'
        ? 'border-blue-400/30 text-blue-300'
        : status === 'processing'
            ? 'border-amber-400/30 text-amber-300'
            : status === 'retryable'
                ? 'border-warning/30 text-warning'
                : status === 'dead_letter'
                    ? 'border-danger/30 text-danger'
                    : 'border-accent/30 text-accent';

    return (
        <span className={`inline-flex border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${classes}`}>
            {status.replace('_', ' ')}
        </span>
    );
}

function ActionToast({
    notice,
    onDismiss,
}: {
    notice: { tone: 'success' | 'error'; message: string } | null;
    onDismiss: () => void;
}) {
    useEffect(() => {
        if (!notice) return undefined;
        const timeout = window.setTimeout(onDismiss, 4_500);
        return () => window.clearTimeout(timeout);
    }, [notice, onDismiss]);

    if (!notice) {
        return null;
    }

    return (
        <div className={`fixed bottom-6 right-6 z-50 max-w-md border px-4 py-3 font-mono text-xs shadow-[0_0_18px_rgba(0,0,0,0.35)] ${
            notice.tone === 'success'
                ? 'border-accent/40 bg-black text-accent'
                : 'border-danger/40 bg-black text-danger'
        }`}>
            <div className="flex items-start gap-3">
                {notice.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertTriangle className="mt-0.5 h-4 w-4" />}
                <div>{notice.message}</div>
            </div>
        </div>
    );
}

function buildEventsPath(status: StatusFilter): string {
    const params = new URLSearchParams({
        limit: '50',
        offset: '0',
    });
    if (status !== 'all') {
        params.set('status', status);
    }
    return `/api/outbox/events?${params.toString()}`;
}

function normalizeSnapshot(value: unknown): OutboxSnapshot {
    const source = isRecord(value) ? value : {};
    return {
        pending: readNumber(source.pending),
        processing: readNumber(source.processing),
        retryable: readNumber(source.retryable),
        deadLetter: readNumber(source.deadLetter),
        delivered: readNumber(source.delivered),
        total: readNumber(source.total),
    };
}

function normalizeEventList(value: unknown): OutboxEventListItem[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => normalizeEvent(entry))
        .filter((entry): entry is OutboxEventListItem => entry !== null);
}

function normalizeEvent(value: unknown): OutboxEventListItem | null {
    if (!isRecord(value)) return null;
    const id = readText(value.id);
    const aggregateType = readText(value.aggregateType);
    const aggregateId = readText(value.aggregateId);
    const eventName = readText(value.eventName);
    const createdAt = readDate(value.createdAt);
    if (!id || !aggregateType || !aggregateId || !eventName || !createdAt) {
        return null;
    }

    return {
        id,
        aggregateType,
        aggregateId,
        eventName,
        payload: isRecord(value.payload) ? value.payload : {},
        status: normalizeStatus(value.status),
        attemptCount: readNumber(value.attemptCount),
        maxAttempts: readNumber(value.maxAttempts),
        lastAttemptedAt: readDate(value.lastAttemptedAt),
        nextRetryAt: readDate(value.nextRetryAt),
        leasedUntil: readDate(value.leasedUntil),
        leasedBy: readText(value.leasedBy),
        errorDetail: readText(value.errorDetail),
        createdAt,
        deliveredAt: readDate(value.deliveredAt),
        metadata: isRecord(value.metadata) ? value.metadata : {},
        deliveryAttemptCount: readNumber(value.deliveryAttemptCount),
    };
}

function normalizeAttemptList(value: unknown): OutboxDeliveryAttempt[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => normalizeAttempt(entry))
        .filter((entry): entry is OutboxDeliveryAttempt => entry !== null);
}

function normalizeAttempt(value: unknown): OutboxDeliveryAttempt | null {
    if (!isRecord(value)) return null;
    const id = readText(value.id);
    const eventId = readText(value.eventId);
    const attemptedAt = readDate(value.attemptedAt);
    if (!id || !eventId || !attemptedAt) {
        return null;
    }

    return {
        id,
        eventId,
        attemptedAt,
        success: Boolean(value.success),
        statusCode: readNullableNumber(value.statusCode),
        responseBody: readText(value.responseBody),
        errorDetail: readText(value.errorDetail),
        durationMs: readNullableNumber(value.durationMs),
    };
}

function normalizeStatus(value: unknown): OutboxStatus {
    return value === 'pending' || value === 'processing' || value === 'retryable' || value === 'dead_letter' || value === 'delivered'
        ? value
        : 'pending';
}

function formatFilterLabel(filter: StatusFilter): string {
    return filter === 'all'
        ? 'All'
        : filter === 'dead_letter'
            ? 'Dead Letter'
            : filter.replace('_', ' ');
}

function truncateId(value: string): string {
    return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function formatTimestamp(value: Date): string {
    return Number.isNaN(value.getTime()) ? 'n/a' : value.toLocaleString();
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
    }
    return 0;
}

function readNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function readDate(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}
