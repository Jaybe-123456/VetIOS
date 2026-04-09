'use client';

import { useEffect, useRef, useState } from 'react';
import { ConsoleCard, Container, PageHeader, TerminalButton, TerminalInput, TerminalLabel, TerminalTextarea } from '@/components/ui/terminal';
import { extractApiErrorMessage, extractEnvelopeData, requestJson } from '@/lib/debugTools/client';

type SimulationMode = 'scenario_load' | 'adversarial' | 'regression';

type SimulationProgress = {
    id?: string;
    status?: string;
    completed?: number;
    total?: number;
    summary?: Record<string, unknown>;
    error_message?: string | null;
};

type ModelOption = {
    model_version?: string;
    model_name?: string | null;
    lifecycle_status?: string | null;
    registry_role?: string | null;
    source?: 'registry' | 'inference';
    preferred?: boolean;
};

const DEFAULT_PROMPT_DISTRIBUTION = JSON.stringify([
    { prompt: 'Dog with persistent vomiting, lethargy, abdominal discomfort', weight: 0.5 },
    { prompt: 'Cat with cough, fever, fast breathing, appetite loss', weight: 0.3 },
    { prompt: 'Dog with diarrhea, dehydration, weakness, pale gums', weight: 0.2 },
], null, 2);

const ADVERSARIAL_CATEGORIES = [
    'jailbreak',
    'injection',
    'gibberish',
    'extreme_length',
    'multilingual',
    'sensitive_topic',
] as const;

const STREAM_FALLBACK_MESSAGE = 'Live progress stream interrupted. Switching to polling.';
const FALLBACK_MODEL_OPTION: ModelOption = {
    model_version: 'gpt-4o-mini',
    source: 'inference',
    preferred: false,
};

export default function SimulationWorkbench() {
    const [mode, setMode] = useState<SimulationMode>('scenario_load');
    const [models, setModels] = useState<ModelOption[]>([]);
    const [loadingModels, setLoadingModels] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [runId, setRunId] = useState<string | null>(null);
    const [progress, setProgress] = useState<SimulationProgress | null>(null);
    const [busy, setBusy] = useState(false);
    const [scenarioName, setScenarioName] = useState('Baseline clinic load');
    const [agentCount, setAgentCount] = useState(10);
    const [requestsPerAgent, setRequestsPerAgent] = useState(5);
    const [requestRatePerSecond, setRequestRatePerSecond] = useState(2);
    const [durationSeconds, setDurationSeconds] = useState(30);
    const [promptDistribution, setPromptDistribution] = useState(DEFAULT_PROMPT_DISTRIBUTION);
    const [selectedModelVersion, setSelectedModelVersion] = useState('gpt-4o-mini');
    const [selectedCategories, setSelectedCategories] = useState<string[]>(['jailbreak', 'injection']);
    const [candidateModelVersion, setCandidateModelVersion] = useState('gpt-4o-mini');
    const eventSourceRef = useRef<EventSource | null>(null);
    const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        void loadModels();
    }, []);

    useEffect(() => () => {
        stopProgressTracking();
    }, []);

    async function loadModels() {
        setLoadingModels(true);
        setError(null);

        try {
            const { response, body } = await requestJson('/api/models/available');
            if (!response.ok) {
                throw new Error(extractApiErrorMessage(body, 'Failed to load available model versions.'));
            }
            const data = extractEnvelopeData<ModelOption[]>(body) ?? [];
            const resolvedModels = data.filter((entry): entry is ModelOption & { model_version: string } =>
                typeof entry?.model_version === 'string' && entry.model_version.trim().length > 0,
            );

            const nextModels: ModelOption[] = resolvedModels.length > 0
                ? resolvedModels
                : [FALLBACK_MODEL_OPTION];
            const preferredModelVersion = nextModels[0]?.model_version ?? 'gpt-4o-mini';
            setModels(nextModels);
            setSelectedModelVersion(preferredModelVersion);
            setCandidateModelVersion(preferredModelVersion);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Failed to load available model versions.');
            setModels([FALLBACK_MODEL_OPTION]);
        } finally {
            setLoadingModels(false);
        }
    }

    function stopProgressTracking() {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        if (pollingTimeoutRef.current) {
            clearTimeout(pollingTimeoutRef.current);
            pollingTimeoutRef.current = null;
        }
    }

    function applyProgressUpdate(nextProgress: SimulationProgress | null) {
        setProgress(nextProgress);
        if (typeof nextProgress?.error_message === 'string' && nextProgress.error_message.trim().length > 0) {
            setError(nextProgress.error_message);
        } else {
            setError((current) => current === STREAM_FALLBACK_MESSAGE ? null : current);
        }

        if (nextProgress?.status === 'completed' || nextProgress?.status === 'failed') {
            stopProgressTracking();
            setBusy(false);
        }
    }

    async function fetchProgressSnapshot(simulationId: string) {
        const { response, body } = await requestJson(`/api/simulations/${simulationId}`);
        if (!response.ok) {
            throw new Error(extractApiErrorMessage(body, 'Failed to load simulation status.'));
        }
        const data = extractEnvelopeData<SimulationProgress | null>(body);
        applyProgressUpdate(data ?? null);
        return data ?? null;
    }

    function scheduleProgressPoll(simulationId: string, delayMs = 3000) {
        if (pollingTimeoutRef.current) {
            clearTimeout(pollingTimeoutRef.current);
        }
        pollingTimeoutRef.current = setTimeout(() => {
            void (async () => {
                try {
                    const nextProgress = await fetchProgressSnapshot(simulationId);
                    if (nextProgress?.status === 'completed' || nextProgress?.status === 'failed') {
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
                const nextProgress = await fetchProgressSnapshot(simulationId);
                if (nextProgress?.status === 'completed' || nextProgress?.status === 'failed') {
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
                const parsed = JSON.parse(event.data) as SimulationProgress | null;
                applyProgressUpdate(parsed);
            } catch {
                setError('Failed to parse simulation progress payload.');
            }
        };

        source.onerror = () => {
            if (eventSourceRef.current !== source) {
                return;
            }
            startProgressPolling(simulationId);
        };
    }

    async function submitSimulation() {
        stopProgressTracking();
        setBusy(true);
        setError(null);
        setProgress(null);

        let payload: Record<string, unknown>;
        if (mode === 'adversarial') {
            payload = {
                mode,
                scenario_name: 'Adversarial test',
                model_version: selectedModelVersion,
                categories: selectedCategories,
            };
        } else if (mode === 'regression') {
            payload = {
                mode,
                scenario_name: 'Regression check',
                candidate_model_version: candidateModelVersion,
            };
        } else {
            payload = {
                mode,
                scenario_name: scenarioName,
                agent_count: agentCount,
                requests_per_agent: requestsPerAgent,
                request_rate_per_second: requestRatePerSecond,
                model_version: selectedModelVersion,
                prompt_distribution: safeParsePromptDistribution(promptDistribution),
                duration_seconds: durationSeconds,
            };
        }

        try {
            const { response, body } = await requestJson('/api/simulations/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                throw new Error(extractApiErrorMessage(body, 'Failed to start simulation.'));
            }
            const data = extractEnvelopeData<Record<string, unknown>>(body);
            const simulationId = typeof data?.id === 'string' ? data.id : null;
            if (!simulationId) {
                throw new Error('Simulation id was missing from the response.');
            }
            setRunId(simulationId);
            startProgressStream(simulationId);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Failed to start simulation.');
            setBusy(false);
        }
    }

    const progressCompleted = progress?.completed ?? 0;
    const progressTotal = progress?.total ?? 0;
    const progressPercent = progressTotal > 0 ? Math.min(100, Math.round((progressCompleted / progressTotal) * 100)) : 0;

    return (
        <Container>
            <PageHeader
                title="SIMULATION WORKBENCH"
                description="Run scenario load, adversarial prompt, and regression simulations through the live inference pipeline."
            />

            <div className="flex flex-wrap gap-2 mb-6">
                {([
                    ['scenario_load', 'Scenario Load'],
                    ['adversarial', 'Adversarial Test'],
                    ['regression', 'Regression Check'],
                ] as Array<[SimulationMode, string]>).map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => setMode(value)}
                        className={`px-3 py-2 border font-mono text-xs uppercase tracking-widest ${
                            mode === value
                                ? 'border-accent text-accent bg-accent/10'
                                : 'border-grid text-muted hover:border-muted hover:text-foreground'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <ConsoleCard title="Simulation Config" className="xl:col-span-2">
                    <div className="space-y-4">
                        {loadingModels ? (
                            <div className="font-mono text-xs text-muted">Loading available models...</div>
                        ) : mode === 'scenario_load' ? (
                            <>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <div>
                                        <TerminalLabel>Scenario Name</TerminalLabel>
                                        <TerminalInput value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} />
                                    </div>
                                    <div>
                                        <TerminalLabel>Model Version</TerminalLabel>
                                        <select
                                            value={selectedModelVersion}
                                            onChange={(event) => setSelectedModelVersion(event.target.value)}
                                            className="w-full bg-dim border border-grid p-3 font-mono text-sm text-foreground"
                                        >
                                            {models.map((model) => (
                                                <option key={model.model_version} value={model.model_version}>
                                                    {formatModelLabel(model)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <TerminalLabel>Agent Count</TerminalLabel>
                                        <TerminalInput type="number" value={agentCount} onChange={(event) => setAgentCount(Number(event.target.value))} />
                                    </div>
                                    <div>
                                        <TerminalLabel>Requests Per Agent</TerminalLabel>
                                        <TerminalInput type="number" value={requestsPerAgent} onChange={(event) => setRequestsPerAgent(Number(event.target.value))} />
                                    </div>
                                    <div>
                                        <TerminalLabel>Rate / second</TerminalLabel>
                                        <TerminalInput type="number" step="0.1" value={requestRatePerSecond} onChange={(event) => setRequestRatePerSecond(Number(event.target.value))} />
                                    </div>
                                    <div>
                                        <TerminalLabel>Duration Seconds</TerminalLabel>
                                        <TerminalInput type="number" value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} />
                                    </div>
                                </div>
                                <div>
                                    <TerminalLabel>Prompt Distribution JSON</TerminalLabel>
                                    <TerminalTextarea rows={10} value={promptDistribution} onChange={(event) => setPromptDistribution(event.target.value)} />
                                </div>
                            </>
                        ) : mode === 'adversarial' ? (
                            <>
                                <div>
                                    <TerminalLabel>Model Version</TerminalLabel>
                                    <select
                                        value={selectedModelVersion}
                                        onChange={(event) => setSelectedModelVersion(event.target.value)}
                                        className="w-full bg-dim border border-grid p-3 font-mono text-sm text-foreground"
                                    >
                                        {models.map((model) => (
                                            <option key={model.model_version} value={model.model_version}>
                                                {formatModelLabel(model)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {ADVERSARIAL_CATEGORIES.map((category) => (
                                        <label key={category} className="flex items-center gap-3 border border-grid p-3 font-mono text-xs">
                                            <input
                                                type="checkbox"
                                                checked={selectedCategories.includes(category)}
                                                onChange={(event) => {
                                                    setSelectedCategories((current) => event.target.checked
                                                        ? [...current, category]
                                                        : current.filter((value) => value !== category));
                                                }}
                                            />
                                            {category}
                                        </label>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div>
                                <TerminalLabel>Candidate Model Version</TerminalLabel>
                                <select
                                    value={candidateModelVersion}
                                    onChange={(event) => setCandidateModelVersion(event.target.value)}
                                    className="w-full bg-dim border border-grid p-3 font-mono text-sm text-foreground"
                                >
                                    {models.map((model) => (
                                        <option key={model.model_version} value={model.model_version}>
                                            {formatModelLabel(model)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <TerminalButton onClick={() => void submitSimulation()} disabled={busy || loadingModels}>
                                {busy ? 'Running Simulation...' : 'Run Simulation'}
                            </TerminalButton>
                            <TerminalButton variant="secondary" onClick={() => void loadModels()} disabled={busy}>
                                Refresh Models
                            </TerminalButton>
                        </div>
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Live Progress">
                    <div className="space-y-4">
                        <div className="font-mono text-xs text-muted">
                            Simulation ID: {runId ?? 'No active run'}
                        </div>
                        <div className="border border-grid p-3">
                            <div className="h-3 bg-black/40">
                                <div className="h-full bg-accent transition-all" style={{ width: `${progressPercent}%` }} />
                            </div>
                            <div className="mt-2 font-mono text-xs text-muted">
                                {progressCompleted} / {progressTotal} completed
                            </div>
                        </div>
                        <div className="space-y-2">
                            <StatRow label="Status" value={String(progress?.status ?? (busy ? 'running' : 'idle')).toUpperCase()} />
                            <StatRow label="Success Rate" value={formatMetric(progress?.summary?.success_rate)} />
                            <StatRow label="Mean Latency" value={formatLatency(progress?.summary?.mean_latency_ms)} />
                            <StatRow label="P95 Latency" value={formatLatency(progress?.summary?.p95_latency_ms)} />
                        </div>
                        {error && (
                            <div className="border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-danger">
                                {error}
                            </div>
                        )}
                        {!error && progress?.error_message && (
                            <div className="border border-danger/30 bg-danger/10 p-3 font-mono text-xs text-danger">
                                {progress.error_message}
                            </div>
                        )}
                    </div>
                </ConsoleCard>

                <ConsoleCard title="Results Summary" className="xl:col-span-3">
                    <pre className="max-h-[24rem] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">
                        {JSON.stringify(progress?.summary ?? {}, null, 2)}
                    </pre>
                </ConsoleCard>
            </div>
        </Container>
    );
}

function StatRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-grid/40 pb-2 font-mono text-xs">
            <span className="text-muted">{label}</span>
            <span>{value}</span>
        </div>
    );
}

function safeParsePromptDistribution(value: string) {
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function formatMetric(value: unknown) {
    return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'NO DATA';
}

function formatLatency(value: unknown) {
    return typeof value === 'number' ? `${value.toFixed(1)} ms` : 'NO DATA';
}

function formatModelLabel(model: ModelOption) {
    const version = typeof model.model_version === 'string' && model.model_version.trim().length > 0
        ? model.model_version
        : 'unknown';
    const descriptors = [
        model.preferred ? 'LATEST' : null,
        typeof model.lifecycle_status === 'string' ? model.lifecycle_status.toUpperCase() : null,
        typeof model.registry_role === 'string' ? model.registry_role.toUpperCase() : null,
    ].filter((entry): entry is string => Boolean(entry));

    return descriptors.length > 0
        ? `${version} [${descriptors.join(' · ')}]`
        : version;
}
