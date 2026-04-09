'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeveloperApiExplorer from '@/components/DeveloperApiExplorer';
import { ConsoleCard } from '@/components/ui/terminal';
import {
    ApiResponseError,
    extractEnvelopeData,
    extractApiErrorMessage,
    formatHttpStatus,
    requestJson,
    stringifyApiBody,
} from '@/lib/debugTools/client';
import { extractUuidFromText } from '@/lib/utils/uuid';
import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';

type DebugResourceState<T> = {
    value: T | null;
    status: 'idle' | 'loading' | 'ready' | 'error';
    errorMessage: string | null;
    hasFetched: boolean;
};

type DiagnosticActionState = {
    actionKey: string | null;
    actionLabel: string | null;
    status: 'idle' | 'running' | 'success' | 'error';
    statusCode: number | null;
    statusText: string | null;
    message: string | null;
    body: unknown;
};

const INITIAL_RESOURCE_STATE = {
    value: null,
    status: 'idle',
    errorMessage: null,
    hasFetched: false,
} satisfies DebugResourceState<unknown>;

const INITIAL_ACTION_STATE: DiagnosticActionState = {
    actionKey: null,
    actionLabel: null,
    status: 'idle',
    statusCode: null,
    statusText: null,
    message: null,
    body: null,
};

export default function DebugToolsPanel({ isAdmin }: { isAdmin: boolean }) {
    const [latestInferenceEvent, setLatestInferenceEvent] = useState<DebugResourceState<string>>(
        INITIAL_RESOURCE_STATE as DebugResourceState<string>,
    );
    const [latestEvaluationEvent, setLatestEvaluationEvent] = useState<DebugResourceState<string>>(
        INITIAL_RESOURCE_STATE as DebugResourceState<string>,
    );
    const [datasetRows, setDatasetRows] = useState<DebugResourceState<number>>(
        INITIAL_RESOURCE_STATE as DebugResourceState<number>,
    );
    const [orphanEvents, setOrphanEvents] = useState<DebugResourceState<number>>(
        INITIAL_RESOURCE_STATE as DebugResourceState<number>,
    );
    const [actionState, setActionState] = useState<DiagnosticActionState>(INITIAL_ACTION_STATE);
    const [telemetryStreamStatus, setTelemetryStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
    const [telemetryStreamError, setTelemetryStreamError] = useState<string | null>(null);
    const [telemetryEvents, setTelemetryEvents] = useState<Array<Record<string, unknown>>>([]);
    const [orphanAnimationTick, setOrphanAnimationTick] = useState(0);
    const previousOrphanCountRef = useRef<number | null>(null);
    const telemetrySourceRef = useRef<EventSource | null>(null);

    const normalizedLatestInferenceEventId = useMemo(
        () => extractUuidFromText(latestInferenceEvent.value),
        [latestInferenceEvent.value],
    );

    const loadLatestInferenceEvent = useCallback(async () => {
        const shouldShowLoading = !latestInferenceEvent.hasFetched;
        if (shouldShowLoading) {
            setLatestInferenceEvent({
                value: null,
                status: 'loading',
                errorMessage: null,
                hasFetched: false,
            });
        }

        try {
            const { response, body } = await requestJson('/api/inference/latest');
            if (!response.ok) {
                throw new ApiResponseError(
                    response.status,
                    response.statusText,
                    body,
                    extractApiErrorMessage(body, 'Failed to load latest inference event.'),
                );
            }

            const eventId = getStringFromBody(body, 'event_id');
            setLatestInferenceEvent({
                value: eventId,
                status: 'ready',
                errorMessage: null,
                hasFetched: true,
            });
        } catch (error) {
            const message = error instanceof ApiResponseError
                ? extractApiErrorMessage(error.body, error.message)
                : error instanceof Error
                    ? error.message
                    : 'Network error while loading latest inference event.';
            setLatestInferenceEvent({
                value: null,
                status: 'error',
                errorMessage: message,
                hasFetched: true,
            });
        }
    }, [latestInferenceEvent.hasFetched]);

    const loadLatestEvaluationEvent = useCallback(async () => {
        const shouldShowLoading = !latestEvaluationEvent.hasFetched;
        if (shouldShowLoading) {
            setLatestEvaluationEvent({
                value: null,
                status: 'loading',
                errorMessage: null,
                hasFetched: false,
            });
        }

        try {
            const { response, body } = await requestJson('/api/evaluation/latest');
            if (!response.ok) {
                throw new ApiResponseError(
                    response.status,
                    response.statusText,
                    body,
                    extractApiErrorMessage(body, 'Failed to load latest evaluation event.'),
                );
            }

            const eventId = getStringFromBody(body, 'event_id');
            setLatestEvaluationEvent({
                value: eventId,
                status: 'ready',
                errorMessage: null,
                hasFetched: true,
            });
        } catch (error) {
            const message = error instanceof ApiResponseError
                ? extractApiErrorMessage(error.body, error.message)
                : error instanceof Error
                    ? error.message
                    : 'Network error while loading latest evaluation event.';
            setLatestEvaluationEvent({
                value: null,
                status: 'error',
                errorMessage: message,
                hasFetched: true,
            });
        }
    }, [latestEvaluationEvent.hasFetched]);

    const loadDatasetRows = useCallback(async () => {
        const shouldShowLoading = !datasetRows.hasFetched;
        if (shouldShowLoading) {
            setDatasetRows({
                value: null,
                status: 'loading',
                errorMessage: null,
                hasFetched: false,
            });
        }

        try {
            const { response, body } = await requestJson('/api/datasets/stats');
            if (!response.ok) {
                throw new ApiResponseError(
                    response.status,
                    response.statusText,
                    body,
                    extractApiErrorMessage(body, 'Failed to load dataset row count.'),
                );
            }

            const rowCount = getNumberFromBody(body, 'row_count');
            setDatasetRows({
                value: rowCount,
                status: 'ready',
                errorMessage: null,
                hasFetched: true,
            });
        } catch (error) {
            const message = error instanceof ApiResponseError
                ? extractApiErrorMessage(error.body, error.message)
                : error instanceof Error
                    ? error.message
                    : 'Network error while loading dataset row count.';
            setDatasetRows({
                value: null,
                status: 'error',
                errorMessage: message,
                hasFetched: true,
            });
        }
    }, [datasetRows.hasFetched]);

    const loadOrphanEvents = useCallback(async () => {
        const shouldShowLoading = !orphanEvents.hasFetched;
        if (shouldShowLoading) {
            setOrphanEvents({
                value: null,
                status: 'loading',
                errorMessage: null,
                hasFetched: false,
            });
        }

        try {
            const { response, body } = await requestJson('/api/events/orphans/count');
            if (!response.ok) {
                throw new ApiResponseError(
                    response.status,
                    response.statusText,
                    body,
                    extractApiErrorMessage(body, 'Failed to load orphan event count.'),
                );
            }

            const count = getNumberFromBody(body, 'count');
            setOrphanEvents({
                value: count,
                status: 'ready',
                errorMessage: null,
                hasFetched: true,
            });
        } catch (error) {
            const message = error instanceof ApiResponseError
                ? extractApiErrorMessage(error.body, error.message)
                : error instanceof Error
                    ? error.message
                    : 'Network error while loading orphan event count.';
            setOrphanEvents({
                value: null,
                status: 'error',
                errorMessage: message,
                hasFetched: true,
            });
        }
    }, [orphanEvents.hasFetched]);

    const refreshPrimaryCards = useCallback(async () => {
        await Promise.all([
            loadLatestInferenceEvent(),
            loadLatestEvaluationEvent(),
        ]);
    }, [loadLatestEvaluationEvent, loadLatestInferenceEvent]);

    const refreshAllMetrics = useCallback(async () => {
        await Promise.all([
            loadLatestInferenceEvent(),
            loadLatestEvaluationEvent(),
            loadDatasetRows(),
            loadOrphanEvents(),
        ]);
    }, [loadDatasetRows, loadLatestEvaluationEvent, loadLatestInferenceEvent, loadOrphanEvents]);

    useEffect(() => {
        void refreshAllMetrics();

        const interval = window.setInterval(() => {
            if (document.visibilityState !== 'visible') {
                return;
            }

            void refreshPrimaryCards();
        }, 30_000);

        const handleSimulationMetricsRefresh = () => {
            void refreshAllMetrics();
        };
        window.addEventListener('vetios:simulation-metrics-refresh', handleSimulationMetricsRefresh);

        return () => {
            window.clearInterval(interval);
            window.removeEventListener('vetios:simulation-metrics-refresh', handleSimulationMetricsRefresh);
        };
    }, [refreshAllMetrics, refreshPrimaryCards]);

    useEffect(() => () => {
        telemetrySourceRef.current?.close();
        telemetrySourceRef.current = null;
    }, []);

    useEffect(() => {
        if (orphanEvents.status !== 'ready' || orphanEvents.value == null) {
            return;
        }

        if (previousOrphanCountRef.current != null && previousOrphanCountRef.current !== orphanEvents.value) {
            setOrphanAnimationTick((current) => current + 1);
        }

        previousOrphanCountRef.current = orphanEvents.value;
    }, [orphanEvents.status, orphanEvents.value]);

    const actionButtons = useMemo(() => [
        {
            key: 'inference-test',
            label: 'Test Inference Endpoint',
            endpoint: '/api/inference/test',
            disabled: false,
        },
        {
            key: 'outcome-test',
            label: 'Test Outcome Creation',
            endpoint: '/api/outcome/test',
            disabled: !normalizedLatestInferenceEventId,
        },
        {
            key: 'diagnostic-run',
            label: 'Run System Diagnostic',
            endpoint: '/api/diagnostic/run',
            disabled: false,
        },
        {
            key: 'telemetry-test',
            label: 'Test Telemetry Stream',
            endpoint: '/api/telemetry/test',
            disabled: false,
        },
        {
            key: 'evaluation-test',
            label: 'Test Evaluation Creation',
            endpoint: '/api/evaluation/test',
            disabled: !normalizedLatestInferenceEventId,
        },
        {
            key: 'evaluation-backfill',
            label: 'Backfill Evaluations',
            endpoint: '/api/evaluation/backfill',
            disabled: !isAdmin,
        },
    ], [isAdmin, normalizedLatestInferenceEventId]);

    function openTelemetryStream() {
        telemetrySourceRef.current?.close();
        setTelemetryStreamStatus('connecting');
        setTelemetryStreamError(null);

        const source = new EventSource('/api/telemetry/stream');
        telemetrySourceRef.current = source;

        source.onopen = () => {
            setTelemetryStreamStatus('connected');
            setTelemetryStreamError(null);
        };

        source.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data) as Record<string, unknown>;
                setTelemetryEvents((current) => [parsed, ...current].slice(0, 100));
            } catch {
                setTelemetryEvents((current) => [{ raw: event.data }, ...current].slice(0, 100));
            }
        };

        source.onerror = () => {
            setTelemetryStreamStatus('error');
            setTelemetryStreamError('Telemetry stream disconnected.');
        };
    }

    async function handleDiagnosticAction(action: typeof actionButtons[number]) {
        if (actionState.status === 'running') {
            return;
        }

        if (action.key === 'telemetry-test') {
            openTelemetryStream();
        }

        setActionState({
            actionKey: action.key,
            actionLabel: action.label,
            status: 'running',
            statusCode: null,
            statusText: null,
            message: null,
            body: null,
        });

        try {
            const { response, body } = await requestJson(action.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            setActionState({
                actionKey: action.key,
                actionLabel: action.label,
                status: response.ok ? 'success' : 'error',
                statusCode: response.status,
                statusText: response.statusText,
                message: response.ok
                    ? null
                    : extractApiErrorMessage(body, `Request failed with ${response.status}.`),
                body,
            });
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'Network error while executing diagnostic action.';
            setActionState({
                actionKey: action.key,
                actionLabel: action.label,
                status: 'error',
                statusCode: null,
                statusText: null,
                message,
                body: { error: message },
            });
        } finally {
            await refreshAllMetrics();
        }
    }

    return (
        <div className="space-y-4">
            <ConsoleCard title="System Diagnostics">
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
                    <DebugDataCard
                        label="Latest Inference Event"
                        state={latestInferenceEvent}
                        value={latestInferenceEvent.value ?? 'No event recorded'}
                    />
                    <DebugDataCard
                        label="Latest Evaluation Event"
                        state={latestEvaluationEvent}
                        value={latestEvaluationEvent.value ?? 'No event recorded'}
                    />
                    <DebugDataCard
                        label="Dataset Rows"
                        state={datasetRows}
                        value={datasetRows.value != null ? String(datasetRows.value) : 'No rows recorded'}
                    />
                    <DebugDataCard
                        label="Orphan Events"
                        state={orphanEvents}
                        value={
                            orphanEvents.value != null
                                ? (
                                    <span
                                        key={orphanAnimationTick}
                                        className={orphanAnimationTick > 0 ? 'inline-block animate-pulse text-accent' : 'inline-block'}
                                    >
                                        {orphanEvents.value}
                                    </span>
                                )
                                : 'No orphan events'
                        }
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2 mt-4">
                    {actionButtons.map((action) => {
                        const isRunning = actionState.status === 'running' && actionState.actionKey === action.key;
                        const isDisabled = action.disabled || actionState.status === 'running';

                        return (
                            <button
                                key={action.key}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => void handleDiagnosticAction(action)}
                                className="w-full text-left border border-grid p-3 font-mono text-xs uppercase tracking-widest text-muted hover:text-foreground hover:border-muted disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isRunning ? <Activity className="w-3 h-3 animate-spin" /> : null}
                                {action.label}
                            </button>
                        );
                    })}
                </div>

                {latestInferenceEvent.value && !normalizedLatestInferenceEventId && (
                    <div className="mt-4 border border-yellow-500/30 bg-yellow-500/10 p-3 font-mono text-[11px] text-yellow-300">
                        The latest inference reference is not a canonical UUID. Outcome and evaluation test actions stay disabled until a fresh inference event is generated.
                    </div>
                )}

                <div className="mt-4 border border-grid bg-black/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-grid pb-3">
                        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                            Diagnostic Result
                        </div>
                        {actionState.statusCode != null && (
                            <StatusBadge
                                tone={actionState.status === 'success' ? 'success' : 'error'}
                                label={formatHttpStatus(actionState.statusCode, actionState.statusText)}
                            />
                        )}
                    </div>

                    {actionState.status === 'idle' && (
                        <div className="pt-4 font-mono text-xs text-muted">
                            No diagnostic action has been executed in this session yet.
                        </div>
                    )}

                    {actionState.status === 'running' && (
                        <div className="pt-4 font-mono text-xs text-yellow-300 flex items-center gap-2">
                            <Activity className="w-4 h-4 animate-spin" />
                            Running {actionState.actionLabel ?? 'diagnostic action'}...
                        </div>
                    )}

                    {actionState.status !== 'idle' && actionState.status !== 'running' && (
                        <div className="pt-4 space-y-3">
                            {actionState.message && (
                                <div className={`font-mono text-xs ${actionState.status === 'error' ? 'text-danger' : 'text-accent'}`}>
                                    {actionState.message}
                                </div>
                            )}
                            <pre className="max-h-[24rem] overflow-y-auto whitespace-pre-wrap break-words border border-grid bg-black p-3 font-mono text-[11px] text-foreground/80">
                                {stringifyApiBody(actionState.body)}
                            </pre>
                        </div>
                    )}
                </div>

                <div className="mt-4 border border-grid bg-black/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-grid pb-3">
                        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                            Live Telemetry Stream
                        </div>
                        <StatusBadge
                            tone={telemetryStreamStatus === 'connected' ? 'success' : 'error'}
                            label={
                                telemetryStreamStatus === 'connected'
                                    ? 'Connected'
                                    : telemetryStreamStatus === 'connecting'
                                        ? 'Connecting'
                                        : telemetryStreamStatus === 'error'
                                            ? 'Disconnected'
                                            : 'Idle'
                            }
                        />
                    </div>
                    <div className="pt-4 space-y-3">
                        {telemetryStreamError && (
                            <div className="font-mono text-xs text-danger">{telemetryStreamError}</div>
                        )}
                        <div className="max-h-[20rem] overflow-y-auto space-y-2">
                            {telemetryEvents.length === 0 ? (
                                <div className="font-mono text-xs text-muted">
                                    No live telemetry events captured in this session yet.
                                </div>
                            ) : telemetryEvents.map((event, index) => (
                                <pre
                                    key={`${String(event.telemetry_key ?? event.id ?? index)}`}
                                    className="border border-grid bg-black p-3 font-mono text-[11px] text-foreground/80 whitespace-pre-wrap break-words"
                                >
                                    {JSON.stringify(event, null, 2)}
                                </pre>
                            ))}
                        </div>
                    </div>
                </div>
            </ConsoleCard>

            <ConsoleCard title="Developer API Explorer">
                <DeveloperApiExplorer latestInferenceEventId={latestInferenceEvent.value} />
            </ConsoleCard>
        </div>
    );
}

function DebugDataCard({
    label,
    state,
    value,
}: {
    label: string;
    state: DebugResourceState<string | number>;
    value: ReactNode;
}) {
    const isError = state.status === 'error';

    return (
        <div className={`border p-3 ${isError ? 'border-danger bg-danger/5' : 'border-grid'}`}>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">{label}</div>

            {state.status === 'loading' && !state.hasFetched ? (
                <div className="space-y-2 animate-pulse">
                    <div className="h-4 w-3/4 bg-grid/60" />
                    <div className="h-3 w-1/2 bg-grid/40" />
                </div>
            ) : isError ? (
                <div className="space-y-2">
                    <div className="font-mono text-xs uppercase tracking-widest text-danger">Unavailable</div>
                    <div className="font-mono text-[11px] text-danger/80 break-words">
                        {state.errorMessage ?? 'Unable to load this value.'}
                    </div>
                </div>
            ) : (
                <div className="font-mono text-xs break-all">{value}</div>
            )}
        </div>
    );
}

function StatusBadge({
    tone,
    label,
}: {
    tone: 'success' | 'error';
    label: string;
}) {
    return (
        <span
            className={`inline-flex items-center gap-1 border px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${
                tone === 'success'
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-danger text-danger bg-danger/10'
            }`}
        >
            {tone === 'success' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {label}
        </span>
    );
}

function getStringFromBody(body: unknown, key: string) {
    const resolved = extractEnvelopeData<Record<string, unknown> | null>(body);
    if (typeof resolved !== 'object' || resolved === null) {
        return null;
    }

    const value = resolved[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getNumberFromBody(body: unknown, key: string) {
    const resolved = extractEnvelopeData<Record<string, unknown> | null>(body);
    if (typeof resolved !== 'object' || resolved === null) {
        return null;
    }

    const value = resolved[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
