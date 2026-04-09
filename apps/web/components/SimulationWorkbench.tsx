'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConsoleCard, Container, PageHeader, TerminalButton, TerminalInput, TerminalLabel } from '@/components/ui/terminal';
import { extractApiErrorMessage, extractEnvelopeData, requestJson } from '@/lib/debugTools/client';

type SimulationMode = 'load' | 'adversarial' | 'regression';
type EvaluationMethod = 'auto' | 'human' | 'hybrid';
type TenantScope = 'own' | 'all';
type LogTone = 'default' | 'success' | 'warning' | 'error' | 'info';

type ModelOption = {
    model_version?: string;
    model_name?: string | null;
    lifecycle_status?: string | null;
    registry_role?: string | null;
    source?: 'registry' | 'inference';
    preferred?: boolean;
    blocked?: boolean;
};

type PromptRow = {
    id?: string | null;
    category?: string | null;
    prompt?: string | null;
    expected_behavior?: string | null;
    severity?: string | null;
    active?: boolean;
};

type SimulationProgress = {
    simulation_id?: string;
    type?: 'progress' | 'complete' | 'error';
    mode?: SimulationMode;
    status?: 'pending' | 'running' | 'complete' | 'failed' | 'blocked';
    completed?: number;
    total?: number;
    progress_pct?: number;
    stats?: Record<string, unknown>;
    results?: Record<string, unknown> | null;
    last_event?: {
        id?: string | null;
        event_type?: string | null;
        payload?: Record<string, unknown>;
        created_at?: string | null;
    } | null;
    error_message?: string | null;
};

type SimulationDetail = {
    simulation?: {
        id?: string;
        scenario_name?: string;
        mode?: SimulationMode;
        status?: string;
        results?: Record<string, unknown>;
        summary?: Record<string, unknown>;
        completed?: number;
        total?: number;
        completed_at?: string | null;
        created_at?: string | null;
    } | null;
    progress?: SimulationProgress | null;
    events?: Array<{
        id?: string | null;
        event_type?: string | null;
        payload?: Record<string, unknown>;
        created_at?: string | null;
    }>;
    regression_replays?: Array<{
        original_event_id?: string | null;
        original_score?: number | null;
        candidate_score?: number | null;
        delta?: number | null;
        is_regression?: boolean;
        is_improvement?: boolean;
    }>;
};

type HistoryRow = {
    id?: string | null;
    mode?: SimulationMode;
    status?: string | null;
    scenario_name?: string | null;
    created_at?: string | null;
    completed_at?: string | null;
    summary?: Record<string, unknown>;
};

type LogLine = {
    id: string;
    tone: LogTone;
    text: string;
    timestamp: string;
};

const ADVERSARIAL_CATEGORIES = [
    'jailbreak',
    'injection',
    'gibberish',
    'extreme_length',
    'multilingual',
    'sensitive_topic',
    'rare_species',
    'conflicting_inputs',
] as const;

const STREAM_FALLBACK_MESSAGE = 'Simulation progress stream disconnected. Switching to live polling.';

export default function SimulationWorkbench({
    canUseAllTenantScope = false,
}: {
    canUseAllTenantScope?: boolean;
}) {
    const [mode, setMode] = useState<SimulationMode>('load');
    const [models, setModels] = useState<ModelOption[]>([]);
    const [activeModelVersion, setActiveModelVersion] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [runId, setRunId] = useState<string | null>(null);
    const [progress, setProgress] = useState<SimulationProgress | null>(null);
    const [detail, setDetail] = useState<SimulationDetail | null>(null);
    const [history, setHistory] = useState<HistoryRow[]>([]);
    const [promptCounts, setPromptCounts] = useState<Record<string, number>>({});
    const [inferenceEventCount, setInferenceEventCount] = useState(0);
    const [logs, setLogs] = useState<LogLine[]>([]);

    const [scenarioName, setScenarioName] = useState('NAIROBI LOAD BASELINE');
    const [selectedModelVersion, setSelectedModelVersion] = useState('');
    const [durationSeconds, setDurationSeconds] = useState(60);
    const [agentCount, setAgentCount] = useState(10);
    const [requestsPerAgent, setRequestsPerAgent] = useState(5);
    const [ratePerSecond, setRatePerSecond] = useState(10);
    const [distribution, setDistribution] = useState({
        canine: 50,
        feline: 30,
        equine: 10,
        other: 10,
    });

    const [selectedCategories, setSelectedCategories] = useState<string[]>([...ADVERSARIAL_CATEGORIES]);
    const [promptsPerCategory, setPromptsPerCategory] = useState(5);
    const [evaluationMethod, setEvaluationMethod] = useState<EvaluationMethod>('auto');

    const [candidateModelVersion, setCandidateModelVersion] = useState('');
    const [replayN, setReplayN] = useState(50);
    const [thresholdPct, setThresholdPct] = useState(10);
    const [autoBlock, setAutoBlock] = useState(false);
    const [tenantScope, setTenantScope] = useState<TenantScope>('own');

    const eventSourceRef = useRef<EventSource | null>(null);
    const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seenEventIdsRef = useRef<Set<string>>(new Set());

    const distributionTotal = distribution.canine + distribution.feline + distribution.equine + distribution.other;
    const totalRequests = agentCount * requestsPerAgent;
    const estimatedDurationSeconds = ratePerSecond > 0 ? Math.ceil(totalRequests / ratePerSecond) : 0;
    const adversarialTotalPrompts = selectedCategories.length * promptsPerCategory;
    const regressionCandidateOptions = useMemo(
        () => models.filter((model) => model.model_version && model.model_version !== activeModelVersion),
        [activeModelVersion, models],
    );

    useEffect(() => {
        void bootstrap();
    }, []);

    useEffect(() => {
        if (loading) return;
        if (!canUseAllTenantScope && tenantScope === 'all') {
            setTenantScope('own');
            return;
        }
        void loadInferenceEventCount(tenantScope);
    }, [canUseAllTenantScope, loading, tenantScope]);

    useEffect(() => {
        const needsReplacement = !candidateModelVersion || candidateModelVersion === activeModelVersion;
        if (!needsReplacement) return;

        const nextCandidate = regressionCandidateOptions[0]?.model_version ?? '';
        if (nextCandidate && nextCandidate !== candidateModelVersion) {
            setCandidateModelVersion(nextCandidate);
        }
    }, [activeModelVersion, candidateModelVersion, regressionCandidateOptions]);

    useEffect(() => () => {
        stopProgressTracking();
    }, []);

    async function bootstrap() {
        setLoading(true);
        setError(null);
        try {
            await Promise.all([
                loadModels(),
                loadActiveModel(),
                loadPromptLibrary(),
                loadSimulationHistory(),
                loadInferenceEventCount(tenantScope),
            ]);
            if (typeof window !== 'undefined') {
                const simulationId = new URLSearchParams(window.location.search).get('simulation_id');
                if (simulationId) {
                    await fetchSimulationDetail(simulationId);
                }
            }
        } catch (bootstrapError) {
            setError(bootstrapError instanceof Error ? bootstrapError.message : 'Failed to load simulation workbench.');
        } finally {
            setLoading(false);
        }
    }

    async function loadModels() {
        const { response, body } = await requestJson('/api/models/available');
        if (!response.ok) {
            throw new Error(extractApiErrorMessage(body, 'Failed to load available model versions.'));
        }
        const data = extractEnvelopeData<ModelOption[]>(body) ?? [];
        const resolvedModels = data.filter((entry): entry is ModelOption & { model_version: string } =>
            typeof entry?.model_version === 'string' && entry.model_version.trim().length > 0,
        );
        const nextModels = resolvedModels;
        const preferred = nextModels[0]?.model_version ?? '';
        setModels(nextModels);
        setSelectedModelVersion((current) => {
            const currentExists = nextModels.some((entry) => entry.model_version === current);
            return !current || !currentExists ? preferred : current;
        });
        setCandidateModelVersion((current) => {
            const currentExists = nextModels.some((entry) => entry.model_version === current);
            return !current || !currentExists ? preferred : current;
        });
    }

    async function loadActiveModel() {
        const { response, body } = await requestJson('/api/models/active');
        if (!response.ok) {
            throw new Error(extractApiErrorMessage(body, 'Failed to load active model version.'));
        }
        const data = extractEnvelopeData<{ model_version?: string | null }>(body);
        const next = data?.model_version ?? '';
        setActiveModelVersion(next);
    }

    async function loadPromptLibrary() {
        const { response, body } = await requestJson('/api/simulations/adversarial/prompts');
        if (!response.ok) {
            throw new Error(extractApiErrorMessage(body, 'Failed to load adversarial prompt library.'));
        }
        const meta = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).meta as Record<string, unknown> : null;
        setPromptCounts((meta?.counts_by_category as Record<string, number> | undefined) ?? {});
    }

    async function loadSimulationHistory() {
        const { response, body } = await requestJson('/api/simulations?limit=5');
        if (!response.ok) {
            throw new Error(extractApiErrorMessage(body, 'Failed to load simulation history.'));
        }
        setHistory(extractEnvelopeData<HistoryRow[]>(body) ?? []);
    }

    async function loadInferenceEventCount(scope: TenantScope) {
        const query = scope === 'all'
            ? '/api/inference?count=true&scope=all'
            : '/api/inference?count=true';
        const { response, body } = await requestJson(query);
        if (!response.ok) {
            const message = extractApiErrorMessage(body, 'Failed to load inference event count.');
            if (scope === 'all') {
                setTenantScope('own');
                setError(message);
                return;
            }
            throw new Error(message);
        }
        const data = extractEnvelopeData<{ count?: number }>(body);
        setInferenceEventCount(typeof data?.count === 'number' ? data.count : 0);
    }

    function stopProgressTracking() {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        if (pollingTimeoutRef.current) {
            clearTimeout(pollingTimeoutRef.current);
            pollingTimeoutRef.current = null;
        }
    }

    function appendLog(eventId: string | null | undefined, tone: LogTone, text: string, timestamp?: string | null) {
        const stableId = eventId ?? `${Date.now()}-${Math.random()}`;
        if (seenEventIdsRef.current.has(stableId)) return;
        seenEventIdsRef.current.add(stableId);
        setLogs((current) => [...current, {
            id: stableId,
            tone,
            text,
            timestamp: timestamp ?? new Date().toISOString(),
        }].slice(-80));
    }

    function consumeEvents(events: SimulationDetail['events']) {
        for (const event of [...(events ?? [])].reverse()) {
            const tone = deriveLogTone(event?.event_type ?? '', event?.payload ?? {});
            appendLog(event?.id, tone, formatEventLog(event?.event_type ?? '', event?.payload ?? {}), event?.created_at);
        }
    }

    function applyProgress(nextProgress: SimulationProgress | null, nextDetail?: SimulationDetail | null) {
        setProgress(nextProgress);
        if (nextDetail) {
            setDetail(nextDetail);
            consumeEvents(nextDetail.events);
        } else if (nextProgress?.last_event) {
            const tone = deriveLogTone(nextProgress.last_event.event_type ?? '', nextProgress.last_event.payload ?? {});
            appendLog(nextProgress.last_event.id, tone, formatEventLog(nextProgress.last_event.event_type ?? '', nextProgress.last_event.payload ?? {}), nextProgress.last_event.created_at);
        }

        if (nextProgress?.error_message) {
            setError(nextProgress.error_message);
        } else {
            setError((current) => current === STREAM_FALLBACK_MESSAGE ? null : current);
        }

        if (nextProgress?.status === 'complete' || nextProgress?.status === 'failed' || nextProgress?.status === 'blocked') {
            stopProgressTracking();
            setBusy(false);
            void loadSimulationHistory();
            void refreshDiagnosticsCounters();
        }
    }

    async function refreshDiagnosticsCounters() {
        await Promise.allSettled([
            requestJson('/api/datasets/stats'),
            requestJson('/api/events/orphans/count'),
        ]);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('vetios:simulation-metrics-refresh'));
        }
    }

    async function cancelActiveSimulation() {
        if (!runId) return;
        try {
            const { response, body } = await requestJson(`/api/simulations/${runId}`, {
                method: 'DELETE',
            });
            if (!response.ok) {
                throw new Error(extractApiErrorMessage(body, 'Failed to cancel simulation.'));
            }
            appendLog(`${runId}:cancelled`, 'warning', 'Simulation cancelled by user', new Date().toISOString());
            await fetchSimulationDetail(runId);
            await loadSimulationHistory();
            setBusy(false);
        } catch (cancelError) {
            setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel simulation.');
        }
    }

    async function fetchSimulationDetail(simulationId: string) {
        const { response, body } = await requestJson(`/api/simulations/${simulationId}`);
        if (!response.ok) {
            throw new Error(extractApiErrorMessage(body, 'Failed to load simulation detail.'));
        }
        const data = extractEnvelopeData<SimulationDetail | null>(body);
        if (!data) return null;
        setRunId(simulationId);
        applyProgress(data.progress ?? null, data);
        return data;
    }

    function scheduleProgressPoll(simulationId: string, delayMs = 3000) {
        if (pollingTimeoutRef.current) {
            clearTimeout(pollingTimeoutRef.current);
        }
        pollingTimeoutRef.current = setTimeout(() => {
            void (async () => {
                try {
                    const nextDetail = await fetchSimulationDetail(simulationId);
                    const nextProgress = nextDetail?.progress ?? null;
                    if (nextProgress?.status === 'complete' || nextProgress?.status === 'failed' || nextProgress?.status === 'blocked') {
                        return;
                    }
                    scheduleProgressPoll(simulationId);
                } catch (pollError) {
                    setError(pollError instanceof Error ? pollError.message : 'Failed to poll simulation progress.');
                    scheduleProgressPoll(simulationId, 5000);
                }
            })();
        }, delayMs);
    }

    function startProgressPolling(simulationId: string) {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setError(STREAM_FALLBACK_MESSAGE);
        void (async () => {
            try {
                const nextDetail = await fetchSimulationDetail(simulationId);
                const nextProgress = nextDetail?.progress ?? null;
                if (nextProgress?.status === 'complete' || nextProgress?.status === 'failed' || nextProgress?.status === 'blocked') {
                    return;
                }
            } catch (pollError) {
                setError(pollError instanceof Error ? pollError.message : 'Failed to poll simulation progress.');
            }
            scheduleProgressPoll(simulationId);
        })();
    }

    function startProgressStream(simulationId: string) {
        stopProgressTracking();
        const source = new EventSource(`/api/simulations/${simulationId}/progress`);
        eventSourceRef.current = source;

        source.onopen = () => {
            setError((current) => current === STREAM_FALLBACK_MESSAGE ? null : current);
        };

        source.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data) as SimulationProgress;
                applyProgress(parsed);
            } catch {
                setError('Failed to parse simulation progress payload.');
            }
        };

        source.onerror = () => {
            if (eventSourceRef.current !== source) return;
            startProgressPolling(simulationId);
        };
    }

    async function submitSimulation() {
        stopProgressTracking();
        seenEventIdsRef.current = new Set();
        setLogs([]);
        setBusy(true);
        setError(null);
        setProgress(null);
        setDetail(null);

        const request = buildSimulationRequest();
        if (mode === 'regression' && autoBlock) {
            const confirmed = window.confirm(`This will block ${candidateModelVersion} from deployment if regression rate exceeds ${thresholdPct}%. Proceed?`);
            if (!confirmed) {
                setBusy(false);
                return;
            }
        }

        try {
            const { response, body } = await requestJson(request.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request.payload),
            });
            if (!response.ok) {
                throw new Error(extractApiErrorMessage(body, 'Failed to start simulation.'));
            }
            const data = extractEnvelopeData<{ simulation_id?: string }>(body);
            const simulationId = data?.simulation_id ?? null;
            if (!simulationId) {
                throw new Error('Simulation id was missing from the response.');
            }
            setRunId(simulationId);
            appendLog(`${simulationId}:started`, 'info', `${mode.toUpperCase()} simulation started`, new Date().toISOString());
            startProgressStream(simulationId);
            await loadSimulationHistory();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Failed to start simulation.');
            setBusy(false);
        }
    }

    function buildSimulationRequest() {
        if (mode === 'adversarial') {
            return {
                url: '/api/simulations/adversarial',
                payload: {
                    model_version: selectedModelVersion,
                    categories: selectedCategories,
                    prompts_per_category: promptsPerCategory,
                    evaluation_method: evaluationMethod,
                },
            };
        }

        if (mode === 'regression') {
            return {
                url: '/api/simulations/regression',
                payload: {
                    baseline_model: activeModelVersion,
                    candidate_model: candidateModelVersion,
                    replay_n: replayN,
                    threshold_pct: thresholdPct,
                    auto_block: autoBlock,
                    tenant_scope: tenantScope,
                },
            };
        }

        return {
            url: '/api/simulations/load',
            payload: {
                scenario_name: scenarioName,
                model_version: selectedModelVersion,
                duration_seconds: durationSeconds,
                agent_count: agentCount,
                requests_per_agent: requestsPerAgent,
                rate_per_second: ratePerSecond,
                prompt_distribution: distribution,
            },
        };
    }

    const outputMode = detail?.simulation?.mode ?? progress?.mode ?? mode;
    const activeResults = progress?.results ?? detail?.simulation?.results ?? detail?.simulation?.summary ?? null;
    const activeStatus = progress?.status ?? detail?.simulation?.status ?? (busy ? 'running' : 'pending');
    const activeProgressPct = progress?.progress_pct ?? (progress?.total ? ((progress.completed ?? 0) / Math.max(1, progress.total)) * 100 : 0);
    const progressCompleted = progress?.completed ?? detail?.simulation?.completed ?? 0;
    const progressTotal = progress?.total ?? detail?.simulation?.total ?? 0;

    return (
        <Container className="max-w-[112rem]">
            <PageHeader
                title="ADVERSARIAL SIMULATION LAB"
                description="Run scenario load, adversarial prompt, and regression simulations through the live inference pipeline."
            />

            <div className="mb-6 flex flex-wrap gap-2">
                {([
                    ['load', '01 - SCENARIO LOAD'],
                    ['adversarial', '02 - ADVERSARIAL TEST'],
                    ['regression', '03 - REGRESSION CHECK'],
                ] as Array<[SimulationMode, string]>).map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => setMode(value)}
                        className={`border px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] ${
                            mode === value
                                ? 'border-accent bg-accent/10 text-accent'
                                : 'border-grid bg-dim/70 text-muted hover:border-muted hover:text-foreground'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <ConsoleCard title="SIMULATION CONFIG">
                    {loading ? (
                        <div className="font-mono text-xs text-muted">LOADING SIMULATION CONTROL PLANE...</div>
                    ) : (
                        <div className="space-y-6">
                            {mode === 'load' && renderLoadForm()}
                            {mode === 'adversarial' && renderAdversarialForm()}
                            {mode === 'regression' && renderRegressionForm()}
                        </div>
                    )}
                </ConsoleCard>

                <div className="space-y-4">
                    <ConsoleCard title="LIVE OUTPUT">
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-2">
                                {buildStatCards(outputMode, progress, activeResults).map((card) => (
                                    <div key={card.label} className="border border-grid bg-dim/60 p-3">
                                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{card.label}</div>
                                        <div className="mt-2 font-mono text-sm text-foreground">{card.value}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="border border-grid p-3">
                                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Simulation Progress</div>
                                <div className="h-3 bg-black/50">
                                    <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(100, activeProgressPct))}%` }} />
                                </div>
                                <div className="mt-2 font-mono text-xs text-muted">
                                    {runId ? `${formatPercent(activeProgressPct)} - ${progressCompleted} / ${progressTotal || '0'}` : 'IDLE'}
                                </div>
                                <div className="mt-2 font-mono text-[11px] text-muted">Simulation ID: {runId ?? 'NO ACTIVE RUN'}</div>
                                <div className="mt-1 font-mono text-[11px] text-foreground">Status: {String(activeStatus).toUpperCase()}</div>
                            </div>

                            {activeResults && (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                        <TerminalButton
                                            variant="secondary"
                                            onClick={() => runId && window.open(`/api/simulations/${runId}/export`, '_blank')}
                                            disabled={!runId || !['complete', 'failed', 'blocked'].includes(String(activeStatus))}
                                        >
                                            EXPORT CSV
                                        </TerminalButton>
                                        <TerminalButton
                                            variant="secondary"
                                            onClick={() => void cancelActiveSimulation()}
                                            disabled={!runId || String(activeStatus) !== 'running'}
                                        >
                                            CANCEL RUN
                                        </TerminalButton>
                                    </div>
                                    {renderResultsSection(outputMode, activeStatus, activeResults, detail)}
                                </div>
                            )}

                            <div className="border border-grid p-3">
                                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Live Log</div>
                                <div className="h-[200px] overflow-y-auto bg-black/30 p-2">
                                    {logs.length === 0 ? (
                                        <div className="font-mono text-[11px] text-muted">NO EVENTS YET.</div>
                                    ) : logs.map((line) => (
                                        <div key={line.id} className={`font-mono text-[11px] ${logToneClass(line.tone)}`}>
                                            [{formatClock(line.timestamp)}] {line.text}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="border border-grid p-3">
                                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Recent Simulations</div>
                                <div className="space-y-2">
                                    {history.length === 0 ? (
                                        <div className="font-mono text-[11px] text-muted">NO SIMULATION HISTORY FOR THIS TENANT.</div>
                                    ) : history.map((entry) => (
                                        <button
                                            key={entry.id}
                                            type="button"
                                            onClick={() => entry.id && void fetchSimulationDetail(entry.id)}
                                            className="flex w-full items-center justify-between gap-3 border border-grid bg-dim/50 px-3 py-2 text-left hover:border-accent"
                                        >
                                            <div className="min-w-0">
                                                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{entry.mode}</div>
                                                <div className="truncate font-mono text-xs text-foreground">{entry.scenario_name ?? 'SIMULATION'}</div>
                                                <div className="font-mono text-[10px] text-muted">{formatDate(entry.created_at)}</div>
                                            </div>
                                            <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${statusTone(entry.status)}`}>
                                                {String(entry.status ?? 'pending').toUpperCase()}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {error && (
                                <div className="border border-danger/40 bg-danger/10 p-3 font-mono text-xs text-danger">
                                    {error}
                                </div>
                            )}
                        </div>
                    </ConsoleCard>
                </div>
            </div>
        </Container>
    );

    function renderLoadForm() {
        return (
            <>
                <div className="grid gap-4 md:grid-cols-2">
                    <Field label="SCENARIO NAME">
                        <TerminalInput value={scenarioName} onChange={(event) => setScenarioName(event.target.value.toUpperCase())} />
                    </Field>
                    <Field label="MODEL VERSION">
                        <ModelSelect value={selectedModelVersion} models={models} onChange={setSelectedModelVersion} />
                    </Field>
                    <Field label="DURATION (SECONDS)">
                        <TerminalInput type="number" min={10} max={300} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} />
                    </Field>
                    <RangeField label="AGENT COUNT" value={agentCount} min={1} max={500} step={1} onChange={setAgentCount} />
                    <RangeField label="REQUESTS / AGENT" value={requestsPerAgent} min={1} max={100} step={1} onChange={setRequestsPerAgent} />
                    <RangeField label="REQUEST RATE (RPS)" value={ratePerSecond} min={1} max={500} step={1} onChange={setRatePerSecond} />
                </div>

                <div className="border border-grid p-4">
                    <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Prompt Distribution</div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="CANINE CASES %"><TerminalInput type="number" value={distribution.canine} onChange={(event) => setDistribution((current) => ({ ...current, canine: Number(event.target.value) }))} /></Field>
                        <Field label="FELINE CASES %"><TerminalInput type="number" value={distribution.feline} onChange={(event) => setDistribution((current) => ({ ...current, feline: Number(event.target.value) }))} /></Field>
                        <Field label="EQUINE CASES %"><TerminalInput type="number" value={distribution.equine} onChange={(event) => setDistribution((current) => ({ ...current, equine: Number(event.target.value) }))} /></Field>
                        <Field label="OTHER SPECIES %"><TerminalInput type="number" value={distribution.other} onChange={(event) => setDistribution((current) => ({ ...current, other: Number(event.target.value) }))} /></Field>
                    </div>
                    <div className={`mt-3 font-mono text-xs ${distributionTotal === 100 ? 'text-accent' : 'text-danger'}`}>
                        {distributionTotal === 100 ? '= 100%' : `!= 100% (${distributionTotal}%)`}
                    </div>
                </div>

                <PreviewBlock
                    lines={[
                        `TOTAL REQUESTS: ${formatNumber(totalRequests)}`,
                        `EST. DURATION: ${formatDuration(estimatedDurationSeconds)}`,
                    ]}
                />

                <div className="flex flex-wrap gap-2">
                    <TerminalButton onClick={() => void submitSimulation()} disabled={busy || distributionTotal !== 100 || !selectedModelVersion}>
                        {busy ? 'RUNNING SIMULATION...' : '> EXECUTE LOAD SIMULATION'}
                    </TerminalButton>
                    <TerminalButton variant="secondary" onClick={() => void bootstrap()} disabled={busy}>
                        REFRESH MODELS
                    </TerminalButton>
                </div>
            </>
        );
    }

    function renderAdversarialForm() {
        return (
            <>
                <Field label="TARGET MODEL VERSION">
                    <ModelSelect value={selectedModelVersion} models={models} onChange={setSelectedModelVersion} />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                    {ADVERSARIAL_CATEGORIES.map((category) => {
                        const selected = selectedCategories.includes(category);
                        return (
                            <button
                                key={category}
                                type="button"
                                onClick={() => setSelectedCategories((current) => selected ? current.filter((value) => value !== category) : [...current, category])}
                                className={`border p-3 text-left font-mono text-xs uppercase tracking-[0.18em] ${
                                    selected ? 'border-accent bg-accent/10 text-accent' : 'border-grid bg-dim/50 text-muted'
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span>{category.replace(/_/g, ' ')}</span>
                                    <span>{promptCounts[category] ?? 0}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
                <RangeField label="PROMPTS PER CATEGORY" value={promptsPerCategory} min={5} max={100} step={5} onChange={setPromptsPerCategory} />
                <Field label="EVALUATION METHOD">
                    <select value={evaluationMethod} onChange={(event) => setEvaluationMethod(event.target.value as EvaluationMethod)} className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground">
                        <option value="auto">AUTO</option>
                        <option value="human">HUMAN REVIEW QUEUE</option>
                        <option value="hybrid">HYBRID</option>
                    </select>
                </Field>
                <PreviewBlock
                    lines={[
                        `TOTAL PROMPTS: ${formatNumber(adversarialTotalPrompts)}`,
                        `PROMPT LIBRARY: ${formatNumber(Object.values(promptCounts).reduce((sum, value) => sum + value, 0))} PROMPTS AVAILABLE`,
                    ]}
                />
                <div className="flex flex-wrap gap-2">
                    <TerminalButton onClick={() => void submitSimulation()} disabled={busy || selectedCategories.length === 0 || !selectedModelVersion}>
                        {busy ? 'RUNNING SUITE...' : '> RUN ADVERSARIAL TEST SUITE'}
                    </TerminalButton>
                </div>
            </>
        );
    }

    function renderRegressionForm() {
        return (
            <>
                <Field label="BASELINE MODEL (PRODUCTION)">
                    <div className="border border-grid bg-dim px-3 py-3 font-mono text-sm text-foreground">
                        {activeModelVersion} (CURRENT)
                    </div>
                </Field>
                <Field label="CANDIDATE MODEL (TO TEST)">
                    <ModelSelect value={candidateModelVersion} models={regressionCandidateOptions.length > 0 ? regressionCandidateOptions : models} onChange={setCandidateModelVersion} />
                </Field>
                <RangeField label="REPLAY LAST N EVENTS" value={replayN} min={10} max={200} step={10} onChange={setReplayN} />
                <RangeField label="FLAG IF SCORE DROPS BY" value={thresholdPct} min={1} max={30} step={1} onChange={setThresholdPct} suffix="%" />
                <Field label="AUTO-BLOCK ON REGRESSION">
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setAutoBlock(true)} className={`border px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] ${autoBlock ? 'border-accent bg-accent/10 text-accent' : 'border-grid text-muted'}`}>YES</button>
                        <button type="button" onClick={() => setAutoBlock(false)} className={`border px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] ${!autoBlock ? 'border-accent bg-accent/10 text-accent' : 'border-grid text-muted'}`}>NO</button>
                    </div>
                    {autoBlock && (
                        <div className="mt-2 font-mono text-[11px] text-warning">
                            Candidate will be blocked in model_registry and require system_admin override to deploy.
                        </div>
                    )}
                </Field>
                <Field label="TENANT SCOPE">
                    <select value={tenantScope} onChange={(event) => setTenantScope(event.target.value as TenantScope)} className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground">
                        <option value="own">MY TENANT ONLY</option>
                        <option value="all" disabled={!canUseAllTenantScope}>ALL TENANTS</option>
                    </select>
                    {!canUseAllTenantScope ? (
                        <div className="mt-2 font-mono text-[11px] text-muted">
                            All-tenant replay requires a system admin token and is disabled for this session.
                        </div>
                    ) : null}
                </Field>
                <PreviewBlock lines={[`AVAILABLE INFERENCE EVENTS: ${formatNumber(inferenceEventCount)}`]} />
                <div className="flex flex-wrap gap-2">
                    <TerminalButton onClick={() => void submitSimulation()} disabled={busy || !candidateModelVersion || candidateModelVersion === activeModelVersion}>
                        {busy ? 'RUNNING REGRESSION...' : '> RUN REGRESSION SIMULATION'}
                    </TerminalButton>
                </div>
            </>
        );
    }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <TerminalLabel>{label}</TerminalLabel>
            {children}
        </div>
    );
}

function RangeField({
    label,
    value,
    min,
    max,
    step,
    onChange,
    suffix,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    suffix?: string;
}) {
    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <TerminalLabel>{label}</TerminalLabel>
                <div className="font-mono text-xs text-accent">{value}{suffix ?? ''}</div>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                className="w-full accent-[#00FF41]"
            />
        </div>
    );
}

function PreviewBlock({ lines }: { lines: string[] }) {
    return (
        <div className="border border-grid bg-dim/50 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Computed Preview</div>
            <div className="space-y-2">
                {lines.map((line) => (
                    <div key={line} className="font-mono text-xs text-foreground">{line}</div>
                ))}
            </div>
        </div>
    );
}

function ModelSelect({
    value,
    models,
    onChange,
}: {
    value: string;
    models: ModelOption[];
    onChange: (value: string) => void;
}) {
    return (
        <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full border border-grid bg-dim p-3 font-mono text-sm text-foreground">
            {models.length === 0 ? (
                <option value="">NO MODELS AVAILABLE</option>
            ) : null}
            {models.map((model) => (
                <option key={model.model_version} value={model.model_version}>
                    {formatModelLabel(model)}
                </option>
            ))}
        </select>
    );
}

function buildStatCards(mode: SimulationMode, progress: SimulationProgress | null, results: Record<string, unknown> | null) {
    if (mode === 'adversarial') {
        return [
            { label: 'TOTAL PROMPTS', value: formatMaybeNumber(readNumber(results?.total_prompts ?? progress?.stats?.total_prompts)) },
            { label: 'PASS RATE', value: formatPercent(readNumber(results?.pass_rate ?? progress?.stats?.pass_rate)) },
            { label: 'FLAGGED', value: formatMaybeNumber(readNumber(results?.flagged ?? progress?.stats?.flagged)) },
            { label: 'BLOCKED', value: formatMaybeNumber(readNumber(results?.blocked ?? progress?.stats?.blocked)) },
        ];
    }
    if (mode === 'regression') {
        return [
            { label: 'REPLAYED', value: formatMaybeNumber(readNumber(progress?.completed ?? results?.total_replayed)) },
            { label: 'REGRESSIONS', value: formatMaybeNumber(readNumber(results?.regression_count ?? progress?.stats?.regressions)) },
            { label: 'IMPROVEMENTS', value: formatMaybeNumber(readNumber(results?.improvement_count ?? progress?.stats?.improvements)) },
            { label: 'NEUTRAL', value: formatMaybeNumber(readNumber(results?.neutral_count ?? progress?.stats?.neutral)) },
        ];
    }
    return [
        { label: 'COMPLETED', value: formatMaybeNumber(readNumber(progress?.completed ?? results?.completed)) },
        { label: 'SUCCESS RATE', value: formatPercent(readNumber(results?.success_rate ?? progress?.stats?.success_rate)) },
        { label: 'MEAN LATENCY', value: formatLatency(readNumber(results?.mean_latency_ms ?? progress?.stats?.mean_latency_ms)) },
        { label: 'P95 LATENCY', value: formatLatency(readNumber(results?.p95_latency_ms ?? progress?.stats?.p95_latency_ms)) },
    ];
}

function renderResultsSection(
    mode: SimulationMode,
    status: string,
    results: Record<string, unknown>,
    detail: SimulationDetail | null,
) {
    if (mode === 'adversarial') {
        const categories = Array.isArray(results.categories) ? results.categories as Array<Record<string, unknown>> : [];
        return (
            <div className="border border-grid p-3">
                <div className={`mb-3 inline-flex border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${statusTone(status)}`}>
                    {String(status).toUpperCase()}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[280px] border-collapse font-mono text-[11px]">
                        <thead>
                            <tr className="text-left text-muted">
                                <th className="border-b border-grid px-2 py-2">CATEGORY</th>
                                <th className="border-b border-grid px-2 py-2">PASS%</th>
                                <th className="border-b border-grid px-2 py-2">PASS</th>
                                <th className="border-b border-grid px-2 py-2">FLAG</th>
                                <th className="border-b border-grid px-2 py-2">BLOCK</th>
                            </tr>
                        </thead>
                        <tbody>
                            {categories.map((row) => {
                                const passRate = readNumber(row.pass_rate) ?? 0;
                                return (
                                    <tr key={String(row.category ?? '')}>
                                        <td className="border-b border-grid/40 px-2 py-2 text-foreground">{String(row.category ?? '').toUpperCase()}</td>
                                        <td className={`border-b border-grid/40 px-2 py-2 ${passRate >= 70 ? 'text-accent' : passRate >= 50 ? 'text-warning' : 'text-danger'}`}>{passRate.toFixed(1)}%</td>
                                        <td className="border-b border-grid/40 px-2 py-2 text-foreground">{formatMaybeNumber(readNumber(row.passed))}</td>
                                        <td className="border-b border-grid/40 px-2 py-2 text-warning">{formatMaybeNumber(readNumber(row.flagged))}</td>
                                        <td className="border-b border-grid/40 px-2 py-2 text-danger">{formatMaybeNumber(readNumber(row.blocked))}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (mode === 'regression') {
        const rows = detail?.regression_replays?.slice(0, 8) ?? [];
        return (
            <div className="border border-grid p-3">
                <div className="mb-3 font-mono text-xs text-foreground">
                    Regression rate {formatPercent(readNumber(results.regression_rate))} {readBoolean(results.blocked) ? '| BLOCKED' : ''}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[280px] border-collapse font-mono text-[11px]">
                        <thead>
                            <tr className="text-left text-muted">
                                <th className="border-b border-grid px-2 py-2">BASELINE SCORE</th>
                                <th className="border-b border-grid px-2 py-2">CANDIDATE SCORE</th>
                                <th className="border-b border-grid px-2 py-2">DELTA</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => {
                                const delta = typeof row.delta === 'number' ? row.delta : 0;
                                return (
                                    <tr key={`${row.original_event_id ?? index}`}>
                                        <td className="border-b border-grid/40 px-2 py-2 text-foreground">{formatScore(row.original_score)}</td>
                                        <td className="border-b border-grid/40 px-2 py-2 text-foreground">{formatScore(row.candidate_score)}</td>
                                        <td className={`border-b border-grid/40 px-2 py-2 ${delta > 0 ? 'text-accent' : delta < 0 ? 'text-danger' : 'text-muted'}`}>{formatScore(delta)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return (
        <div className="border border-grid p-3">
            <div className={`mb-3 inline-flex border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${statusTone(status)}`}>
                {String(status).toUpperCase()}
            </div>
            <div className="space-y-2 font-mono text-xs text-foreground">
                <div>Load simulation completed {formatMaybeNumber(readNumber(results.completed))} of {formatMaybeNumber(readNumber(results.total_requests))} requests.</div>
                <div>Outcomes created: {formatMaybeNumber(readNumber(results.outcomes_created))} | Evaluations triggered: {formatMaybeNumber(readNumber(results.evaluations_triggered))}</div>
            </div>
        </div>
    );
}

function deriveLogTone(eventType: string, payload: Record<string, unknown>): LogTone {
    if (eventType === 'error') return 'error';
    if (eventType === 'warning') return 'warning';
    if (eventType === 'complete') return readText(payload.status) === 'complete' ? 'success' : readText(payload.status) === 'blocked' ? 'warning' : 'error';
    if (eventType === 'started') return 'info';
    if (payload.result_type === 'failed') return 'error';
    if (payload.result_type === 'blocked') return 'warning';
    if (payload.result_type === 'passed') return 'success';
    return 'default';
}

function formatEventLog(eventType: string, payload: Record<string, unknown>) {
    if (eventType === 'started') return `Simulation started in ${String(payload.mode ?? '').toUpperCase()} mode`;
    if (eventType === 'progress') return `${formatMaybeNumber(readNumber(payload.completed))} / ${formatMaybeNumber(readNumber(payload.total_requests ?? payload.total))} completed`;
    if (eventType === 'request_complete') return `Request ${formatMaybeNumber(readNumber(payload.request_n))} finished (${String(payload.species ?? 'unknown')}) latency=${formatLatency(readNumber(payload.latency_ms))}`;
    if (eventType === 'prompt_complete') return `${String(payload.category ?? '').toUpperCase()} prompt ${formatMaybeNumber(readNumber(payload.prompt_index))} -> ${String(payload.result_type ?? '').toUpperCase()}`;
    if (eventType === 'replay_complete') return `Replay ${formatMaybeNumber(readNumber(payload.replayed))}/${formatMaybeNumber(readNumber(payload.total))} delta=${formatScore(readNumber(payload.delta))}`;
    if (eventType === 'warning') return String(payload.message ?? 'Warning');
    if (eventType === 'cancelled') return 'Simulation cancelled by user';
    if (eventType === 'complete') return `Simulation ${String(payload.status ?? '').toUpperCase()}`;
    if (eventType === 'error') return String(payload.message ?? 'Simulation error');
    return eventType.toUpperCase();
}

function formatModelLabel(model: ModelOption) {
    const version = typeof model.model_version === 'string' && model.model_version.trim().length > 0
        ? model.model_version
        : 'unknown';
    const descriptors = [
        model.preferred ? 'LATEST' : null,
        typeof model.lifecycle_status === 'string' ? model.lifecycle_status.toUpperCase() : null,
        typeof model.registry_role === 'string' ? model.registry_role.toUpperCase() : null,
        model.blocked ? 'BLOCKED' : null,
    ].filter((entry): entry is string => Boolean(entry));

    return descriptors.length > 0 ? `${version} [${descriptors.join(' | ')}]` : version;
}

function formatPercent(value: number | null | undefined) {
    return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '--';
}

function formatLatency(value: number | null | undefined) {
    return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} ms` : '--';
}

function formatMaybeNumber(value: number | null | undefined) {
    return typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : '--';
}

function formatScore(value: number | null | undefined) {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : '--';
}

function formatNumber(value: number) {
    return new Intl.NumberFormat('en-US').format(value);
}

function formatDuration(seconds: number) {
    if (!seconds || seconds <= 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatClock(timestamp: string) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString('en-US', { hour12: false });
}

function formatDate(timestamp?: string | null) {
    if (!timestamp) return 'NO DATE';
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString('en-US', { hour12: false });
}

function statusTone(status?: string | null) {
    if (status === 'complete') return 'border-accent text-accent';
    if (status === 'blocked') return 'border-warning text-warning';
    if (status === 'failed') return 'border-danger text-danger';
    if (status === 'running') return 'border-cyan-400 text-cyan-300';
    return 'border-grid text-muted';
}

function logToneClass(tone: LogTone) {
    if (tone === 'success') return 'text-[#4ADE80]';
    if (tone === 'warning') return 'text-[#EF9F27]';
    if (tone === 'error') return 'text-[#E24B4A]';
    if (tone === 'info') return 'text-[#00E5FF]';
    return 'text-muted';
}

function readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readText(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(value: unknown) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (value === 'true') return true;
        if (value === 'false') return false;
    }
    return null;
}
