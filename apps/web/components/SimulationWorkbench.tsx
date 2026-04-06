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

export default function SimulationWorkbench() {
    const [mode, setMode] = useState<SimulationMode>('scenario_load');
    const [models, setModels] = useState<string[]>([]);
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

    useEffect(() => {
        void loadModels();
    }, []);

    useEffect(() => () => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
    }, []);

    async function loadModels() {
        setLoadingModels(true);
        setError(null);

        try {
            const { response, body } = await requestJson('/api/models/available');
            if (!response.ok) {
                throw new Error(extractApiErrorMessage(body, 'Failed to load available model versions.'));
            }
            const data = extractEnvelopeData<Array<{ model_version?: string }>>(body) ?? [];
            const resolvedModels = data
                .map((entry) => entry.model_version)
                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

            const nextModels = resolvedModels.length > 0 ? resolvedModels : ['gpt-4o-mini'];
            setModels(nextModels);
            setSelectedModelVersion((current) => current || nextModels[0] || 'gpt-4o-mini');
            setCandidateModelVersion((current) => current || nextModels[0] || 'gpt-4o-mini');
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Failed to load available model versions.');
            setModels(['gpt-4o-mini']);
        } finally {
            setLoadingModels(false);
        }
    }

    function startProgressStream(simulationId: string) {
        eventSourceRef.current?.close();
        const source = new EventSource(`/api/simulations/${simulationId}/progress`);
        eventSourceRef.current = source;

        source.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data) as SimulationProgress | null;
                setProgress(parsed);
                if (parsed?.status === 'completed' || parsed?.status === 'failed') {
                    source.close();
                    eventSourceRef.current = null;
                    setBusy(false);
                }
            } catch {
                setError('Failed to parse simulation progress payload.');
            }
        };

        source.onerror = () => {
            setError('Simulation progress stream disconnected.');
        };
    }

    async function submitSimulation() {
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
                                                <option key={model} value={model}>{model}</option>
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
                                            <option key={model} value={model}>{model}</option>
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
                                        <option key={model} value={model}>{model}</option>
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
