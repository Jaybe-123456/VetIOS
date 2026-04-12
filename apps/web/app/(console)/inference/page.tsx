'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    ClinicWorkflowPanel,
    type WorkflowBenchmarkSnapshot,
    type WorkflowEpisodeDetail,
} from '@/components/ClinicWorkflowPanel';
import { TreatmentPathwaysPanel } from '@/components/TreatmentPathwaysPanel';
import { InferenceForm } from '@/components/InferenceForm';
import { NormalizedPreview } from '@/components/NormalizedPreview';
import { normalizeInferenceInput, type InputMode, type NormalizedInput } from '@/lib/input/inputNormalizer';
import { extractUuidFromText } from '@/lib/utils/uuid';
import { ShieldCheck, Activity, AlertTriangle, Brain, CheckCircle2, ChevronDown, ChevronUp, BarChart3, Binary, HeartPulse, Workflow } from 'lucide-react';
import { Container, PageHeader, ConsoleCard, DataRow, TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton, TerminalTabs } from '@/components/ui/terminal';
import { MetricCard } from '@/components/InferenceMetrics';
import { SystemLogConsole, type LogEntry } from '@/components/SystemLogConsole';

type InferenceTab = 'analysis' | 'vectors' | 'diagnostics' | 'pathways';

interface MLRiskData {
    risk_score: number;
    confidence: number;
    abstain: boolean;
    model_version: string;
    _fallback?: boolean;
    _reason?: string;
}

interface RiskModelOutputData {
    definition: string;
    catastrophic_deterioration_risk_6h: number;
    operative_urgency_risk: number;
    shock_risk: number;
    legacy_ml_operational_risk?: number | null;
}

interface UploadedArtifact {
    file_name: string;
    mime_type: string;
    size_bytes: number;
    content_base64: string;
}

interface OutcomeState {
    status: 'idle' | 'expanded' | 'submitting' | 'submitted' | 'error';
    evaluation?: {
        id: string;
        calibration_error: number | null;
        drift_score: number | null;
        outcome_alignment_delta: number | null;
    };
    outcomeEventId?: string;
    episodeId?: string;
    workflowEpisode?: WorkflowEpisodeDetail;
    benchmarkSnapshot?: WorkflowBenchmarkSnapshot | null;
    errorMessage?: string;
}

interface CireState {
    phi_hat: number;
    cps: number;
    safety_state: 'nominal' | 'warning' | 'critical' | 'blocked';
    reliability_badge: 'HIGH' | 'REVIEW' | 'CAUTION' | 'SUPPRESSED';
    input_quality: number;
    incident_id?: string | null;
}

interface InferenceState {
    status: 'idle' | 'previewing' | 'computing' | 'success' | 'error';
    eventId: string | null;
    requestPayload: Record<string, unknown> | null;
    responsePayload: Record<string, unknown> | null;
    probabilities: Array<{ label: string; value: number }>;
    explainability: {
        featureImportance: Array<{ feature: string; impact: number }>;
        severityFeatureImportance: Array<{ feature: string; impact: number }>;
    } | null;
    mlRisk: MLRiskData | null;
    riskModelOutput: RiskModelOutputData | null;
    riskAssessment: {
        severity_score: number;
        emergency_level: string;
    } | null;
    errorMessage: string | null;
    normalizedInput: NormalizedInput | null;
    diagnosticImages: UploadedArtifact[];
    labResults: UploadedArtifact[];
    cire: CireState | null;
    cireMessage: string | null;
    metrics: {
        inferenceTimeMs: number;
        confidenceHistory: { value: number }[];
        loadHistory: { value: number }[];
        tempHistory: { value: number }[];
    } | null;
    logs: LogEntry[];
}

export default function InferenceConsole() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<InferenceTab>('analysis');
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
    const [state, setState] = useState<InferenceState>({
        status: 'idle',
        eventId: null,
        requestPayload: null,
        responsePayload: null,
        probabilities: [],
        explainability: null,
        mlRisk: null,
        riskModelOutput: null,
        riskAssessment: null,
        errorMessage: null,
        normalizedInput: null,
        diagnosticImages: [],
        labResults: [],
        cire: null,
        cireMessage: null,
        metrics: null,
        logs: [],
    });

    const [inputMode, setInputMode] = useState<InputMode>('structured');
    const [outcomeState, setOutcomeState] = useState<OutcomeState>({ status: 'idle' });
    const riskModelDefinition = state.riskModelOutput?.definition?.toLowerCase() ?? '';
    const hasAbdominalRiskCalibration = Boolean(state.riskModelOutput) && !riskModelDefinition.includes('non-abdominal');

    // ── File reader ──────────────────────────────────────────────────────────

    async function readFilesAsBase64(files: FormDataEntryValue[]): Promise<UploadedArtifact[]> {
        const validFiles = files.filter((entry): entry is File => entry instanceof File && entry.size > 0);

        return Promise.all(
            validFiles.map((file) => new Promise<UploadedArtifact>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const dataUrl = reader.result as string;
                    const base64 = dataUrl.split(',')[1] || '';
                    resolve({
                        file_name: file.name,
                        mime_type: file.type || 'application/octet-stream',
                        size_bytes: file.size,
                        content_base64: base64,
                    });
                };
                reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
                reader.readAsDataURL(file);
            }))
        );
    }

    // ── Step 1: Normalize & Preview ──────────────────────────────────────────

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();

        try {
            const formData = new FormData(e.currentTarget);
            let rawInput = '';
            let diagnosticImages: UploadedArtifact[] = [];
            let labResults: UploadedArtifact[] = [];

            if (inputMode === 'structured') {
                // Build text from structured fields
                const species = formData.get('species')?.toString().trim() || '';
                const breed = formData.get('breed')?.toString().trim() || '';
                const symptoms = formData.get('symptoms')?.toString().trim() || '';
                const metadata = formData.get('metadata')?.toString().trim() || '';

                // Combine into a structured text for the normalizer
                const parts: string[] = [];
                if (species) parts.push(`Species: ${species}`);
                if (breed) parts.push(`Breed: ${breed}`);
                if (symptoms) parts.push(`Symptoms: ${symptoms}`);
                if (metadata) parts.push(metadata);
                rawInput = parts.join(' | ');

                // Read files
                diagnosticImages = await readFilesAsBase64(formData.getAll('diagnostic-img'));
                labResults = await readFilesAsBase64(formData.getAll('lab-results'));
            } else if (inputMode === 'freetext') {
                rawInput = formData.get('freetext-input')?.toString().trim() || '';
            } else if (inputMode === 'json') {
                rawInput = formData.get('json-input')?.toString().trim() || '';
            }

            if (!rawInput) {
                setState(prev => ({ ...prev, status: 'error', errorMessage: 'No input provided.' }));
                return;
            }

            // Run normalizer
            const normalized = normalizeInferenceInput(rawInput, inputMode);

            setState(prev => ({
                ...prev,
                status: 'previewing',
                normalizedInput: normalized,
                diagnosticImages,
                labResults,
                errorMessage: null,
                cire: null,
                cireMessage: null,
            }));
            setOutcomeState({ status: 'idle' });
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Normalization failed.';
            setState(prev => ({ ...prev, status: 'error', errorMessage }));
        }
    }

    // ── Step 2: User confirms preview → call API ─────────────────────────────

    async function handleConfirmSubmit(finalInput: NormalizedInput) {
        setState(prev => ({
            ...prev,
            status: 'computing',
            normalizedInput: finalInput,
            errorMessage: null,
            logs: [{
                id: Math.random().toString(16).slice(2),
                timestamp: new Date().toLocaleTimeString(),
                level: 'info',
                message: 'INITIALIZING INFERENCE KERNEL...'
            }],
        }));
        setOutcomeState({ status: 'idle' });

        const pushLog = (message: string, level: LogEntry['level'] = 'info') => {
            setState(prev => ({
                ...prev,
                logs: [...prev.logs, {
                    id: Math.random().toString(16).slice(2),
                    timestamp: new Date().toLocaleTimeString(),
                    level,
                    message
                }]
            }));
        };

        try {
            pushLog('INPUT NORMALIZATION COMPLETE');
            pushLog('GENERATING ROUTING PLAN...');
            // ...
            const metadata = {
                ...(finalInput.metadata ?? {}),
                model_family: (finalInput.metadata as Record<string, unknown> | undefined)?.model_family ?? 'diagnostics',
                route_hint: (finalInput.metadata as Record<string, unknown> | undefined)?.route_hint ?? 'clinical_diagnosis',
            };
            const data = {
                model: {
                    name: "gpt-4o-mini",
                    version: "1.0.0"
                },
                input: {
                    input_signature: {
                        species: finalInput.species,
                        breed: finalInput.breed,
                        symptoms: finalInput.symptoms,
                        metadata,
                        diagnostic_images: state.diagnosticImages,
                        lab_results: state.labResults,
                    }
                }
            };

            const startTime = performance.now();
            const res = await fetch('/api/inference', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify(data)
            });

            const textResult = await res.text();
            let result;
            try {
                result = JSON.parse(textResult);
            } catch {
                throw new Error(`Server returned HTTP ${res.status} without JSON. The request likely timed out or the API crashed before it could finish cleanly.`);
            }
            const measuredLatencyMs = performance.now() - startTime;

            if (!res.ok) {
                if (res.status === 401) {
                    const authMessage = typeof result.error === 'string'
                        ? result.error
                        : 'Session expired. Sign in again to continue.';
                    setState(prev => ({ ...prev, status: 'error', errorMessage: authMessage }));
                    router.push('/login?next=%2Finference');
                    return;
                }

                const requestIdSuffix = typeof result.request_id === 'string' ? ` [request_id=${result.request_id}]` : '';
                throw new Error((result.error || `Inference computation failed (HTTP ${res.status})`) + requestIdSuffix);
            }

            const inferenceEventId = extractUuidFromText(result.inference_event_id);
            if (!inferenceEventId) {
                throw new Error('Inference succeeded but returned an invalid inference_event_id.');
            }

            const cire = result.cire && typeof result.cire === 'object'
                ? result.cire as CireState
                : null;
            const dataPayload = result.data && typeof result.data === 'object'
                ? result.data as Record<string, unknown>
                : null;
            const output = (
                dataPayload?.output
                ?? result.output
                ?? result.prediction
            ) as Record<string, unknown> | undefined;
            const diagnosis = output?.diagnosis as Record<string, unknown> | undefined;
            const riskAssessment = output?.risk_assessment as Record<string, unknown> | undefined;
            const riskModelOutput = output?.risk_model_output as Record<string, unknown> | undefined;
            
            pushLog('VECTORS GENERATED SUCCESSFULLY', 'success');
            pushLog('COMPUTING CIRE RELIABILITY...', 'info');

            const diffs = Array.isArray(diagnosis?.top_differentials) ? diagnosis.top_differentials : [];
            const mappedProbabilities = diffs.map((d: any) => ({
                label: d.name || 'Unknown',
                value: typeof d.probability === 'number' ? d.probability : 0,
            }));

            const diagFeatures = output?.diagnosis_feature_importance as Record<string, number> || {};
            const sevFeatures = output?.severity_feature_importance as Record<string, number> || {};

            const mapFeatures = (featObj: Record<string, number>) => 
                Object.entries(featObj)
                    .map(([k, v]) => ({ feature: k, impact: typeof v === 'number' ? v : Number(v) || 0 }))
                    .sort((a, b) => b.impact - a.impact);

            // Simulate metric history
            const generateHistory = (base: number, variance: number) => 
                Array.from({ length: 20 }, () => ({ value: base + (Math.random() - 0.5) * variance }));

            pushLog('INFERENCE PIPELINE COMPLETE', 'success');

            setState(prev => ({
                ...prev,
                status: 'success',
                eventId: inferenceEventId,
                requestPayload: data.input.input_signature as Record<string, unknown>,
                responsePayload: output ?? null,
                probabilities: mappedProbabilities.length > 0 ? mappedProbabilities : [
                    { label: 'Unknown', value: 0 }
                ],
                explainability: {
                    featureImportance: mapFeatures(diagFeatures),
                    severityFeatureImportance: mapFeatures(sevFeatures),
                },
                mlRisk: result.ml_risk || null,
                riskModelOutput: riskModelOutput ? {
                    definition: typeof riskModelOutput.definition === 'string' ? riskModelOutput.definition : '',
                    catastrophic_deterioration_risk_6h: typeof riskModelOutput.catastrophic_deterioration_risk_6h === 'number' ? riskModelOutput.catastrophic_deterioration_risk_6h : 0,
                    operative_urgency_risk: typeof riskModelOutput.operative_urgency_risk === 'number' ? riskModelOutput.operative_urgency_risk : 0,
                    shock_risk: typeof riskModelOutput.shock_risk === 'number' ? riskModelOutput.shock_risk : 0,
                    legacy_ml_operational_risk: typeof riskModelOutput.legacy_ml_operational_risk === 'number' ? riskModelOutput.legacy_ml_operational_risk : null,
                } : null,
                riskAssessment: riskAssessment ? {
                    severity_score: typeof riskAssessment.severity_score === 'number' ? riskAssessment.severity_score : 0,
                    emergency_level: typeof riskAssessment.emergency_level === 'string' ? riskAssessment.emergency_level : 'UNKNOWN',
                } : null,
                errorMessage: null,
                normalizedInput: finalInput,
                diagnosticImages: [],
                labResults: [],
                cire,
                cireMessage: result.error?.message ?? null,
                metrics: {
                    inferenceTimeMs: Math.round(measuredLatencyMs),
                    confidenceHistory: generateHistory(result.confidence_score || 0.85, 0.1),
                    loadHistory: generateHistory(70, 20),
                    tempHistory: generateHistory(65, 5),
                },
            }));
            setActiveTab('vectors');
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown inference error.';
            setState(prev => ({ ...prev, status: 'error', errorMessage }));
        }
    }

    function handleCancelPreview() {
        setState(prev => ({ ...prev, status: 'idle', normalizedInput: null, cire: null, cireMessage: null }));
    }

    async function handleCopyEventId() {
        if (!state.eventId) return;
        try {
            await navigator.clipboard.writeText(state.eventId);
            setCopyStatus('copied');
            window.setTimeout(() => setCopyStatus('idle'), 2000);
        } catch {
            setCopyStatus('error');
            window.setTimeout(() => setCopyStatus('idle'), 2000);
        }
    }

    async function handleCireOverride() {
        if (!state.cire?.incident_id) return;
        const confirmed = window.confirm('Log a CIRE override for this suppressed inference and continue with manual review?');
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cire/incidents/${state.cire.incident_id}/resolve`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify({
                    override_action: true,
                    resolution_notes: 'Operator override from inference console',
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error?.message || 'Failed to log override.');
            }

            setState((previous) => ({
                ...previous,
                cireMessage: 'Override logged to audit trail. Proceed with manual review.',
            }));
        } catch (error) {
            setState((previous) => ({
                ...previous,
                cireMessage: error instanceof Error ? error.message : 'Failed to log override.',
            }));
        }
    }

    async function loadEpisodeWorkflow(episodeId: string): Promise<WorkflowEpisodeDetail> {
        const response = await fetch(`/api/episodes/${episodeId}?limit=20`, {
            credentials: 'same-origin',
            cache: 'no-store',
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to load episode workflow.');
        }
        return result as WorkflowEpisodeDetail;
    }

    // ── Ground Truth / Outcome Attachment ──────────────────────────────────────

    async function handleOutcomeSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!state.eventId) return;

        setOutcomeState(prev => ({ ...prev, status: 'submitting' }));

        const formData = new FormData(e.currentTarget);
        const data = {
            inference_event_id: state.eventId,
            outcome: {
                type: 'clinical_diagnosis',
                payload: {
                    actual_diagnosis: formData.get('actualDiagnosis'),
                    notes: formData.get('notes'),
                },
                timestamp: new Date().toISOString(),
            },
        };

        try {
            const res = await fetch('/api/outcome', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify(data),
            });

            const result = await res.json();
            if (!res.ok) {
                if (res.status === 401) {
                    setOutcomeState({
                        status: 'error',
                        errorMessage: typeof result.error === 'string'
                            ? result.error
                            : 'Session expired. Sign in again to attach the outcome.',
                    });
                    router.push('/login?next=%2Finference');
                    return;
                }
                throw new Error(result.error || 'Failed to attach outcome');
            }

            const episodeId = typeof result.episode_id === 'string' ? result.episode_id : undefined;
            let workflowEpisode: WorkflowEpisodeDetail | undefined;
            if (episodeId) {
                try {
                    workflowEpisode = await loadEpisodeWorkflow(episodeId);
                } catch (workflowError) {
                    console.warn('Failed to load episode workflow after outcome submission:', workflowError);
                }
            }

            setOutcomeState({
                status: 'submitted',
                outcomeEventId: result.outcome_event_id,
                evaluation: result.evaluation || undefined,
                episodeId,
                workflowEpisode,
                benchmarkSnapshot: (result.benchmark_snapshot && typeof result.benchmark_snapshot === 'object')
                    ? result.benchmark_snapshot as WorkflowBenchmarkSnapshot
                    : null,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            setOutcomeState({ status: 'error', errorMessage: msg });
        }
    }

    // ── Export ────────────────────────────────────────────────────────────────

    function handleExport() {
        if (!state.eventId || !state.requestPayload || !state.responsePayload) return;

        const examinationBundle = {
            inference_event_id: state.eventId,
            captured_at: new Date().toISOString(),
            examination_input: state.requestPayload,
            analysis_output: state.responsePayload,
            probabilities: state.probabilities,
            explainability: state.explainability,
            ml_risk: state.mlRisk,
        };

        const blob = new Blob([JSON.stringify(examinationBundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vetios-examination-${state.eventId}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <Container className="max-w-7xl">
            <TerminalTabs
                tabs={[
                    { id: 'analysis', label: 'Analysis', icon: <Binary className="w-4 h-4" /> },
                    { id: 'vectors', label: 'Vectors', icon: <BarChart3 className="w-4 h-4" /> },
                    { id: 'diagnostics', label: 'Diagnostics', icon: <Brain className="w-4 h-4" /> },
                    { id: 'pathways', label: 'Pathways', icon: <Workflow className="w-4 h-4" /> },
                ]}
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />

            <div className="animate-scale-in">
                {activeTab === 'analysis' && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 sm:gap-8 xl:gap-12">
                        <div className="xl:border-r xl:border-grid xl:pr-12 space-y-4 sm:space-y-6">
                            <InferenceForm
                                onSubmit={handleSubmit}
                                isComputing={state.status === 'computing'}
                                inputMode={inputMode}
                                onModeChange={setInputMode}
                            />

                            {state.status === 'previewing' && state.normalizedInput && (
                                <NormalizedPreview
                                    normalized={state.normalizedInput}
                                    onConfirm={handleConfirmSubmit}
                                    onCancel={handleCancelPreview}
                                />
                            )}
                        </div>

                        <div className="space-y-4 sm:space-y-6">
                            <ConsoleCard title="Execution Status">
                                <div className={`p-3 sm:p-4 border font-mono text-xs sm:text-sm flex items-center gap-2 sm:gap-3 ${state.status === 'idle' ? 'border-muted text-muted' :
                                    state.status === 'previewing' ? 'border-blue-400 text-blue-400 bg-blue-400/5' :
                                        state.status === 'computing' ? 'border-accent text-accent animate-pulse bg-accent/5' :
                                            state.status === 'error' ? 'border-danger text-danger bg-danger/5' :
                                                'border-accent text-accent'
                                    }`}>
                                    {state.status === 'idle' && <AlertTriangle className="w-4 h-4" />}
                                    {state.status === 'previewing' && <Activity className="w-4 h-4" />}
                                    {state.status === 'computing' && <Activity className="w-4 h-4 animate-spin" />}
                                    {state.status === 'error' && <AlertTriangle className="w-4 h-4" />}
                                    {state.status === 'success' && <ShieldCheck className="w-4 h-4" />}

                                    {state.status === 'idle' && 'AWAITING VECTORS...'}
                                    {state.status === 'previewing' && 'INPUT NORMALIZED — REVIEW & CONFIRM'}
                                    {state.status === 'computing' && 'CALCULATING PROBABILITIES...'}
                                    {state.status === 'error' && `ERR: ${state.errorMessage}`}
                                    {state.status === 'success' && (state.cire?.safety_state === 'blocked' ? 'OUTPUT SUPPRESSED BY CIRE' : 'VECTORS GENERATED')}
                                </div>
                            </ConsoleCard>

                            {state.cire && (
                                <ConsoleCard title="CIRE Reliability">
                                    <div className="grid grid-cols-[88px,1fr] gap-4 items-center">
                                        <div className="relative w-[88px] h-[88px] rounded-full border border-accent/30 flex items-center justify-center">
                                            <div
                                                className={`absolute inset-2 rounded-full border-2 ${state.cire.safety_state === 'blocked' ? 'border-danger' : state.cire.safety_state === 'critical' ? 'border-orange-500' : state.cire.safety_state === 'warning' ? 'border-yellow-400' : 'border-accent'}`}
                                                style={{
                                                    clipPath: `inset(${Math.max(0, 100 - (state.cire.phi_hat * 100))}% 0 0 0)`,
                                                    opacity: 0.2 + (state.cire.phi_hat * 0.8),
                                                }}
                                            />
                                            <div className="font-mono text-xs text-accent">
                                                {state.cire.phi_hat.toFixed(2)}
                                            </div>
                                        </div>
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between gap-3 font-mono text-xs uppercase tracking-widest">
                                                <span className="text-muted">Badge</span>
                                                <span className={cireTone(state.cire.reliability_badge)}>
                                                    {renderCireBadge(state.cire.reliability_badge)}
                                                </span>
                                            </div>
                                            <div>
                                                <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted">
                                                    <span>CPS</span>
                                                    <span>{(state.cire.cps * 100).toFixed(1)}%</span>
                                                </div>
                                                <div className="mt-2 h-2 bg-dim border border-grid overflow-hidden">
                                                    <div
                                                        className={state.cire.safety_state === 'blocked' ? 'h-full bg-danger' : state.cire.safety_state === 'critical' ? 'h-full bg-orange-500' : state.cire.safety_state === 'warning' ? 'h-full bg-yellow-400' : 'h-full bg-accent'}
                                                        style={{ width: `${Math.min(100, state.cire.cps * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <DataRow label="Input Quality" value={`${(state.cire.input_quality * 100).toFixed(1)}%`} />
                                            <DataRow label="Safety State" value={state.cire.safety_state.toUpperCase()} />
                                        </div>
                                    </div>
                                </ConsoleCard>
                            )}

                            {state.status === 'success' && (
                                <div className="p-6 border border-accent/20 bg-accent/5 text-center space-y-4 animate-in fade-in zoom-in duration-500">
                                    <div className="flex justify-center">
                                        <div className="w-12 h-12 rounded-full border border-accent flex items-center justify-center text-accent">
                                            <CheckCircle2 className="w-6 h-6" />
                                        </div>
                                    </div>
                                    <h3 className="font-mono text-sm uppercase tracking-widest text-accent">
                                        {state.cire?.safety_state === 'blocked' ? 'Inference Suppressed' : 'Inference Complete'}
                                    </h3>
                                    <p className="text-xs text-muted font-mono">
                                        {state.cire?.safety_state === 'blocked'
                                            ? 'CIRE suppressed the output and logged an incident for manual review.'
                                            : 'Statistical vectors and diagnostic weights are now available for review.'}
                                    </p>
                                    <button
                                        onClick={() => setActiveTab('vectors')}
                                        className="inline-block border border-accent px-6 py-2 font-mono text-xs uppercase tracking-widest text-accent hover:bg-accent/10 transition-colors"
                                    >
                                        View Results
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'vectors' && (
                    <div className="animate-scale-in max-w-5xl mx-auto space-y-6">
                        {state.status !== 'success' && state.status !== 'computing' ? (
                            <div className="text-muted font-mono text-xs text-center py-24 border border-dashed border-grid">
                                AWAITING GENERATED VECTORS...
                            </div>
                        ) : state.cire?.safety_state === 'blocked' ? (
                            <ConsoleCard title="Inference Output Suppressed" className="border-danger bg-danger/5 max-w-4xl mx-auto">
                                <div className="space-y-4 font-mono text-xs text-danger">
                                    <div className="text-sm uppercase tracking-[0.2em]">Inference output suppressed</div>
                                    <p>
                                        Collapse proximity score: {state.cire.cps.toFixed(3)}. Input quality score: {state.cire.input_quality.toFixed(3)}.
                                        {state.cire.incident_id ? ` Incident ${state.cire.incident_id} logged.` : ''}
                                    </p>
                                    {state.cireMessage ? (
                                        <div className="border border-danger/40 bg-black/20 p-3 text-[11px]">
                                            {state.cireMessage}
                                        </div>
                                    ) : null}
                                    <div className="flex flex-wrap gap-3">
                                        <TerminalButton onClick={() => window.open('/dashboard', '_self')}>
                                            Review Incident
                                        </TerminalButton>
                                        <TerminalButton variant="danger" onClick={handleCireOverride}>
                                            Override - Proceed Anyway
                                        </TerminalButton>
                                    </div>
                                </div>
                            </ConsoleCard>
                        ) : (
                            <div className="space-y-6">
                                {/* Top: Metrics Row */}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <MetricCard 
                                        label="Inference Time" 
                                        value={state.metrics?.inferenceTimeMs || '--'} 
                                        unit="ms"
                                        color="#00ff9d"
                                    />
                                    <MetricCard 
                                        label="Confidence" 
                                        value={state.responsePayload?.confidence_score ? (Number(state.responsePayload.confidence_score) * 100).toFixed(0) : '--'} 
                                        unit="%"
                                        sparklineData={state.metrics?.confidenceHistory}
                                        color="#00ff9d"
                                    />
                                    <MetricCard 
                                        label="GPU Load" 
                                        value={state.metrics ? state.metrics.loadHistory[state.metrics.loadHistory.length - 1].value.toFixed(0) : '--'} 
                                        unit="%"
                                        sparklineData={state.metrics?.loadHistory}
                                        color="#3b82f6"
                                    />
                                    <MetricCard 
                                        label="Temperature" 
                                        value={state.metrics ? state.metrics.tempHistory[state.metrics.tempHistory.length - 1].value.toFixed(1) : '--'} 
                                        unit="°C"
                                        sparklineData={state.metrics?.tempHistory}
                                        color="#ef4444"
                                    />
                                </div>

                                {/* Middle: Inference Output */}
                                <ConsoleCard title="Inference Output">
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between">
                                            <div className="font-mono text-xs uppercase tracking-widest text-muted">Diagnosis Probability</div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                                                <span className="font-mono text-[10px] text-accent uppercase tracking-widest">Live Result</span>
                                            </div>
                                        </div>
                                        
                                        <div className="space-y-5">
                                            {state.probabilities.map((p, i) => (
                                                <div key={i} className="flex flex-col gap-2">
                                                    <div className="flex items-center justify-between font-mono text-xs sm:text-sm">
                                                        <span className={`${i === 0 ? 'text-accent font-bold' : 'text-foreground/70'}`}>
                                                            {p.label}
                                                        </span>
                                                        <span className={`${i === 0 ? 'text-accent font-bold' : 'text-muted'}`}>
                                                            {(p.value * 100).toFixed(0)}%
                                                        </span>
                                                    </div>
                                                    <div className="w-full h-2 bg-dim border border-grid overflow-hidden">
                                                        <div 
                                                            className={`h-full transition-all duration-1000 ${i === 0 ? 'bg-accent' : 'bg-muted'}`} 
                                                            style={{ width: `${p.value * 100}%` }} 
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </ConsoleCard>

                                {/* Ground Truth Context */}
                                {outcomeState.status === 'submitted' && outcomeState.evaluation && (
                                    <ConsoleCard title="Feedback Loop — Evaluation Result" className="border-green-500/30 animate-in fade-in duration-500">
                                        <div className="grid grid-cols-3 gap-3 font-mono text-xs text-center text-accent">
                                            <div className="border border-grid bg-black/20 p-3">
                                                <div className="text-muted uppercase text-[9px] mb-1">Calibration</div>
                                                <div className="text-sm font-bold">{outcomeState.evaluation.calibration_error != null ? `${(outcomeState.evaluation.calibration_error * 100).toFixed(1)}%` : 'N/A'}</div>
                                            </div>
                                            <div className="border border-grid bg-black/20 p-3">
                                                <div className="text-muted uppercase text-[9px] mb-1">Drift</div>
                                                <div className="text-sm font-bold">{outcomeState.evaluation.drift_score?.toFixed(3) ?? 'N/A'}</div>
                                            </div>
                                            <div className="border border-grid bg-black/20 p-3">
                                                <div className="text-muted uppercase text-[9px] mb-1">Alignment</div>
                                                <div className="text-sm font-bold">{outcomeState.evaluation.outcome_alignment_delta != null ? `Δ${(outcomeState.evaluation.outcome_alignment_delta * 100).toFixed(1)}%` : 'N/A'}</div>
                                            </div>
                                        </div>
                                    </ConsoleCard>
                                )}

                                {(outcomeState.status === 'expanded' || outcomeState.status === 'submitting') && (
                                    <ConsoleCard title="Attach Ground Truth" className="border-blue-400/30 animate-in slide-in-from-top duration-300">
                                        <form onSubmit={handleOutcomeSubmit} className="space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <TerminalLabel htmlFor="gt-eventId">Inference Event ID</TerminalLabel>
                                                    <TerminalInput id="gt-eventId" value={state.eventId || ''} disabled className="opacity-60" />
                                                </div>
                                                <div>
                                                    <TerminalLabel htmlFor="gt-diagnosis">Actual Diagnosis</TerminalLabel>
                                                    <TerminalInput id="gt-diagnosis" name="actualDiagnosis" placeholder="e.g. Pancreatitis" required />
                                                </div>
                                            </div>
                                            <div>
                                                <TerminalLabel htmlFor="gt-notes">Clinical Notes</TerminalLabel>
                                                <TerminalTextarea id="gt-notes" name="notes" placeholder="Enter findings to improve model accuracy..." rows={3} />
                                            </div>
                                            <TerminalButton type="submit" disabled={outcomeState.status === 'submitting'}>
                                                {outcomeState.status === 'submitting' ? 'SUBMITTING...' : 'CONFIRM GROUND TRUTH'}
                                            </TerminalButton>
                                        </form>
                                    </ConsoleCard>
                                )}

                                {/* Bottom: System Logs */}
                                <SystemLogConsole logs={state.logs} />

                                {/* Actions Shell */}
                                <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-grid">
                                    <div className="flex items-center gap-2">
                                        {/* Copy ID "Tab" Style */}
                                        <button 
                                            onClick={handleCopyEventId}
                                            className={`h-10 px-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest border transition-all ${
                                                copyStatus === 'copied' 
                                                ? 'bg-accent/20 border-accent text-accent' 
                                                : 'bg-dim border-grid text-muted hover:border-accent hover:text-accent'
                                            }`}
                                        >
                                            <Binary className="w-3.5 h-3.5" />
                                            {copyStatus === 'copied' ? 'Copied ID' : 'Copy Event ID'}
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        {/* Conspicuous Green Export */}
                                        <button 
                                            onClick={handleExport}
                                            className="h-10 px-6 font-mono text-[10px] uppercase tracking-[0.2em] border border-green-500/50 bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-all flex items-center gap-2"
                                        >
                                            <Workflow className="w-3.5 h-3.5" />
                                            Export Analysis
                                        </button>

                                        <TerminalButton 
                                            onClick={() => setOutcomeState(prev => ({
                                                ...prev,
                                                status: prev.status === 'expanded' ? 'idle' : prev.status === 'idle' ? 'expanded' : prev.status,
                                            }))}
                                            disabled={outcomeState.status === 'submitted'}
                                        >
                                            {outcomeState.status === 'submitted' ? (
                                                <span className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" /> Ground Truth Confirmed</span>
                                            ) : (
                                                <span className="flex items-center gap-2">Confirm {outcomeState.status === 'expanded' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
                                            )}
                                        </TerminalButton>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'diagnostics' && (
                    <div className="max-w-4xl mx-auto space-y-6">
                        {state.status !== 'success' ? (
                            <div className="text-muted font-mono text-xs text-center py-12 border border-dashed border-grid">
                                AWAITING GENERATED DIAGNOSTICS...
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <ConsoleCard title="Diagnostic Feature Weights" className="border-muted/30">
                                        <div className="space-y-3">
                                            {state.explainability?.featureImportance.slice(0, 8).map((f, i) => (
                                                <div key={i} className="flex flex-col gap-1">
                                                    <div className="flex justify-between font-mono text-[10px] uppercase text-muted">
                                                        <span>{f.feature}</span>
                                                        <span>{(f.impact * 100).toFixed(0)}</span>
                                                    </div>
                                                    <div className="w-full h-[2px] bg-dim">
                                                        <div className="bg-accent h-full" style={{ width: `${f.impact * 100}%`, opacity: f.impact }} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </ConsoleCard>

                                    <ConsoleCard title="Severity Feature Weights" className="border-muted/30">
                                        <div className="space-y-3">
                                            {state.explainability?.severityFeatureImportance.slice(0, 8).map((f, i) => (
                                                <div key={i} className="flex flex-col gap-1">
                                                    <div className="flex justify-between font-mono text-[10px] uppercase text-muted">
                                                        <span>{f.feature}</span>
                                                        <span>{(f.impact * 100).toFixed(0)}</span>
                                                    </div>
                                                    <div className="w-full h-[2px] bg-dim">
                                                        <div className="bg-orange-500 h-full" style={{ width: `${f.impact * 100}%`, opacity: f.impact }} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </ConsoleCard>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {state.riskAssessment && (
                                        <ConsoleCard title="Risk & Severity Assessment" className={`${state.riskAssessment.emergency_level === 'CRITICAL' ? 'border-red-500 bg-red-500/5' : 'border-accent'}`}>
                                            <div className="flex items-center gap-3 mb-4">
                                                <AlertTriangle className={`w-5 h-5 ${state.riskAssessment.emergency_level === 'CRITICAL' ? 'text-red-500' : 'text-accent'}`} />
                                                <span className="font-mono text-xs text-muted uppercase">Level: <strong className="text-accent">{state.riskAssessment.emergency_level}</strong></span>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <div className="flex justify-between font-mono text-xs mb-1">
                                                    <span className="text-muted">Severity Score</span>
                                                    <span className="text-accent">{((state.riskAssessment.severity_score ?? 0) * 100).toFixed(1)}%</span>
                                                </div>
                                                <div className="w-full h-2 bg-dim">
                                                    <div className="h-full bg-accent" style={{ width: `${(state.riskAssessment.severity_score ?? 0) * 100}%` }} />
                                                </div>
                                            </div>
                                        </ConsoleCard>
                                    )}

                                    {state.riskModelOutput && (
                                        <ConsoleCard title="Acute Deterioration Risk" className="border-accent">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex justify-between font-mono text-xs mb-1">
                                                    <span className="text-muted">Catastrophic 6h Risk</span>
                                                    <span className="text-accent">{(state.riskModelOutput.catastrophic_deterioration_risk_6h * 100).toFixed(1)}%</span>
                                                </div>
                                                <div className="w-full h-2 bg-dim">
                                                    <div className="h-full bg-accent" style={{ width: `${state.riskModelOutput.catastrophic_deterioration_risk_6h * 100}%` }} />
                                                </div>
                                            </div>
                                            <p className="mt-4 text-[10px] text-muted font-mono uppercase truncate opacity-50">
                                                {state.riskModelOutput.definition}
                                            </p>
                                        </ConsoleCard>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {activeTab === 'pathways' && (
                    <div className="max-w-4xl mx-auto space-y-6">
                        {state.status !== 'success' ? (
                            <div className="text-muted font-mono text-xs text-center py-12 border border-dashed border-grid">
                                AWAITING DIAGNOSTIC PATHWAYS...
                            </div>
                        ) : state.eventId && (
                            <>
                                <TreatmentPathwaysPanel
                                    inferenceEventId={state.eventId}
                                    diagnosisLabel={state.probabilities[0]?.label ?? null}
                                />

                                {outcomeState.status === 'submitted' && outcomeState.workflowEpisode && (
                                    <ClinicWorkflowPanel
                                        episodeDetail={outcomeState.workflowEpisode}
                                        benchmarkSnapshot={outcomeState.benchmarkSnapshot ?? null}
                                        onEpisodeRefresh={(workflowEpisode) => setOutcomeState((current) => ({
                                            ...current,
                                            workflowEpisode,
                                        }))}
                                    />
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </Container>
    );
}

function renderCireBadge(badge: CireState['reliability_badge']) {
    if (badge === 'HIGH') return 'GREEN CIRCLE  HIGH';
    if (badge === 'REVIEW') return 'AMBER DIAMOND  REVIEW';
    if (badge === 'CAUTION') return 'RED TRIANGLE  CAUTION';
    return 'RED X BLOCK  SUPPRESSED';
}

function cireTone(badge: CireState['reliability_badge']) {
    if (badge === 'HIGH') return 'text-accent';
    if (badge === 'REVIEW') return 'text-yellow-400';
    if (badge === 'CAUTION') return 'text-orange-500';
    return 'text-danger';
}
