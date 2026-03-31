'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Container, PageHeader, ConsoleCard, DataRow, TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton } from '@/components/ui/terminal';
import {
    ClinicWorkflowPanel,
    type WorkflowBenchmarkSnapshot,
    type WorkflowEpisodeDetail,
} from '@/components/ClinicWorkflowPanel';
import { TreatmentPathwaysPanel } from '@/components/TreatmentPathwaysPanel';
import { InferenceForm } from '@/components/InferenceForm';
import { NormalizedPreview } from '@/components/NormalizedPreview';
import { normalizeInferenceInput, type InputMode, type NormalizedInput } from '@/lib/input/inputNormalizer';
import { ShieldCheck, Activity, AlertTriangle, Brain, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

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
}

export default function InferenceConsole() {
    const router = useRouter();
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
    });

    const [inputMode, setInputMode] = useState<InputMode>('structured');
    const [outcomeState, setOutcomeState] = useState<OutcomeState>({ status: 'idle' });

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
        }));
        setOutcomeState({ status: 'idle' });

        try {
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

            const inferenceEventId = typeof result.inference_event_id === 'string' && result.inference_event_id.trim().length > 0
                ? result.inference_event_id
                : null;
            if (!inferenceEventId) {
                throw new Error('Inference succeeded but no inference_event_id was returned.');
            }

            const output = (result.output ?? result.prediction) as Record<string, unknown> | undefined;
            const diagnosis = output?.diagnosis as Record<string, unknown> | undefined;
            const riskAssessment = output?.risk_assessment as Record<string, unknown> | undefined;
            const riskModelOutput = output?.risk_model_output as Record<string, unknown> | undefined;
            
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

            setState({
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
            });
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown inference error.';
            setState(prev => ({ ...prev, status: 'error', errorMessage }));
        }
    }

    function handleCancelPreview() {
        setState(prev => ({ ...prev, status: 'idle', normalizedInput: null }));
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
            <PageHeader
                title="INFERENCE CONSOLE"
                description="Inject clinical context in any format — structured fields, natural language, or raw JSON — and generate probability vectors."
            />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 sm:gap-8 xl:gap-12">
                <div className="xl:border-r xl:border-grid xl:pr-12 space-y-4 sm:space-y-6">
                    <InferenceForm
                        onSubmit={handleSubmit}
                        isComputing={state.status === 'computing'}
                        inputMode={inputMode}
                        onModeChange={setInputMode}
                    />

                    {/* Normalized Preview (shown between form submit and API call) */}
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
                            {state.status === 'success' && 'VECTORS GENERATED'}
                        </div>
                    </ConsoleCard>

                    {state.status === 'success' && state.eventId && state.explainability && (
                        <div className="space-y-6 animate-in fade-in duration-500">
                            <ConsoleCard title="Event Identity">
                                <div className="font-mono text-2xl text-accent tracking-wider font-bold">
                                    {state.eventId}
                                </div>
                                <p className="text-[10px] text-muted uppercase mt-2 font-mono">
                                    Immutable Reference Hash. Copy this ID to attach outcomes or run adversarial simulations.
                                </p>
                            </ConsoleCard>


                            <div className="flex flex-col sm:flex-row gap-3">
                                <button
                                    type="button"
                                    onClick={handleExport}
                                    className="flex-1 border border-accent/50 bg-accent/10 text-accent font-mono text-xs uppercase tracking-wider py-3 hover:bg-accent/20 transition-colors"
                                >
                                    Export Analysis
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setOutcomeState(prev => ({
                                        ...prev,
                                        status: prev.status === 'expanded' ? 'idle' : prev.status === 'idle' ? 'expanded' : prev.status,
                                    }))}
                                    className={`flex-1 border font-mono text-xs uppercase tracking-wider py-3 transition-colors flex items-center justify-center gap-2 ${
                                        outcomeState.status === 'submitted'
                                            ? 'border-green-500/50 bg-green-500/10 text-green-400 cursor-default'
                                            : 'border-blue-400/50 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20'
                                    }`}
                                    disabled={outcomeState.status === 'submitted'}
                                >
                                    {outcomeState.status === 'submitted' ? (
                                        <><CheckCircle2 className="w-3.5 h-3.5" /> Ground Truth Confirmed</>
                                    ) : (
                                        <>Confirm Ground Truth {outcomeState.status === 'expanded' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</>
                                    )}
                                </button>
                            </div>

                            {/* ── Inline Ground Truth Form ─────────────────── */}
                            {(outcomeState.status === 'expanded' || outcomeState.status === 'submitting') && (
                                <ConsoleCard title="Attach Ground Truth" className="border-blue-400/30 animate-in slide-in-from-top duration-300">
                                    <form onSubmit={handleOutcomeSubmit} className="space-y-4">
                                        <div>
                                            <TerminalLabel htmlFor="gt-eventId">Inference Event ID</TerminalLabel>
                                            <TerminalInput
                                                id="gt-eventId"
                                                value={state.eventId || ''}
                                                disabled
                                                className="opacity-60"
                                            />
                                        </div>
                                        <div>
                                            <TerminalLabel htmlFor="gt-diagnosis">Actual Diagnosis</TerminalLabel>
                                            <TerminalInput
                                                id="gt-diagnosis"
                                                name="actualDiagnosis"
                                                placeholder="e.g. Pancreatitis, Parvoviral Enteritis"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <TerminalLabel htmlFor="gt-notes">Clinician Notes (optional)</TerminalLabel>
                                            <TerminalTextarea
                                                id="gt-notes"
                                                name="notes"
                                                placeholder="Additional context, lab confirmation, treatment response..."
                                                rows={2}
                                            />
                                        </div>
                                        <TerminalButton type="submit" disabled={outcomeState.status === 'submitting'}>
                                            {outcomeState.status === 'submitting' ? 'SUBMITTING...' : 'CONFIRM GROUND TRUTH'}
                                        </TerminalButton>
                                    </form>
                                </ConsoleCard>
                            )}

                            {/* ── Outcome Confirmation Result ─────────────── */}
                            {outcomeState.status === 'submitted' && outcomeState.evaluation && (
                                <ConsoleCard title="Feedback Loop — Evaluation Result" className="border-green-500/30 animate-in fade-in duration-500">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
                                        <div className="border border-accent/20 p-3">
                                            <div className="text-muted uppercase text-[9px] mb-1">Calibration Error</div>
                                            <div className="text-accent text-sm font-bold">
                                                {outcomeState.evaluation.calibration_error != null
                                                    ? `${(outcomeState.evaluation.calibration_error * 100).toFixed(2)}%`
                                                    : 'N/A'}
                                            </div>
                                        </div>
                                        <div className="border border-accent/20 p-3">
                                            <div className="text-muted uppercase text-[9px] mb-1">Drift Score</div>
                                            <div className="text-accent text-sm font-bold">
                                                {outcomeState.evaluation.drift_score != null
                                                    ? outcomeState.evaluation.drift_score.toFixed(3)
                                                    : 'Insufficient data'}
                                            </div>
                                        </div>
                                        <div className="border border-accent/20 p-3">
                                            <div className="text-muted uppercase text-[9px] mb-1">Outcome Alignment</div>
                                            <div className="text-accent text-sm font-bold">
                                                {outcomeState.evaluation.outcome_alignment_delta != null
                                                    ? `Δ ${(outcomeState.evaluation.outcome_alignment_delta * 100).toFixed(1)}%`
                                                    : 'N/A'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-3 text-[10px] text-muted font-mono">
                                        Outcome: <span className="text-accent">{outcomeState.outcomeEventId}</span>
                                        {' | '}Eval: <span className="text-accent">{outcomeState.evaluation.id}</span>
                                    </div>
                                </ConsoleCard>
                            )}

                            {outcomeState.status === 'error' && (
                                <div className="text-danger font-mono text-xs border border-danger p-3 bg-danger/5">
                                    ERR: {outcomeState.errorMessage}
                                </div>
                            )}

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

                            <ConsoleCard title="Probability Vectors (Top 3)">
                                <div className="space-y-4">
                                    {state.probabilities.map((p, i) => (
                                        <div key={i} className="flex flex-col gap-1">
                                            <div className="flex items-center justify-between font-mono text-xs">
                                                <span className={`${i === 0 ? 'text-accent' : 'text-muted'}`}>{p.label}</span>
                                                <span className={`${i === 0 ? 'text-accent' : 'text-muted'}`}>{(p.value * 100).toFixed(0)}%</span>
                                            </div>
                                            <div className="w-full h-1.5 bg-dim overflow-hidden">
                                                <div className={`h-full ${i === 0 ? 'bg-accent' : 'bg-muted'}`} style={{ width: `${p.value * 100}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ConsoleCard>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <ConsoleCard title="Diagnostic Feature Weights" className="border-muted/30">
                                    <div className="space-y-3">
                                        {state.explainability.featureImportance.length > 0 ? state.explainability.featureImportance.map((f, i) => (
                                            <div key={i} className="flex flex-col gap-1">
                                                <div className="flex justify-between font-mono text-[10px] uppercase text-muted">
                                                    <span>{f.feature}</span>
                                                    <span>{(f.impact * 100).toFixed(0)}</span>
                                                </div>
                                                <div className="w-full h-[2px] bg-dim flex">
                                                    <div className="bg-accent h-full" style={{ width: `${f.impact * 100}%`, opacity: f.impact }} />
                                                </div>
                                            </div>
                                        )) : <span className="font-mono text-xs text-muted">No diagnostic features weighted.</span>}
                                    </div>
                                </ConsoleCard>

                                <ConsoleCard title="Severity Feature Weights" className="border-muted/30">
                                    <div className="space-y-3">
                                        {state.explainability.severityFeatureImportance.length > 0 ? state.explainability.severityFeatureImportance.map((f, i) => (
                                            <div key={i} className="flex flex-col gap-1">
                                                <div className="flex justify-between font-mono text-[10px] uppercase text-muted">
                                                    <span>{f.feature}</span>
                                                    <span>{(f.impact * 100).toFixed(0)}</span>
                                                </div>
                                                <div className="w-full h-[2px] bg-dim flex">
                                                    <div className="bg-orange-500 h-full" style={{ width: `${f.impact * 100}%`, opacity: f.impact }} />
                                                </div>
                                            </div>
                                        )) : <span className="font-mono text-xs text-muted">No severity features weighted.</span>}
                                    </div>
                                </ConsoleCard>
                            </div>

                            {/* Risk Assessment Panel */}
                            {state.riskAssessment && (
                                <ConsoleCard title="Risk & Severity Assessment" className={`${state.riskAssessment.emergency_level === 'CRITICAL' ? 'border-red-500 bg-red-500/5' : state.riskAssessment.emergency_level === 'HIGH' ? 'border-orange-500 bg-orange-500/5' : 'border-accent/40'}`}>
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3">
                                            <AlertTriangle className={`w-5 h-5 ${state.riskAssessment.emergency_level === 'CRITICAL' || state.riskAssessment.emergency_level === 'HIGH' ? 'text-red-500' : 'text-accent'}`} />
                                            <span className="font-mono text-xs text-muted uppercase">Emergency Level: <strong className={state.riskAssessment.emergency_level === 'CRITICAL' || state.riskAssessment.emergency_level === 'HIGH' ? 'text-red-500' : 'text-accent'}>{state.riskAssessment.emergency_level}</strong></span>
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center justify-between font-mono text-xs">
                                                <span className="text-muted">Severity Score</span>
                                                <span className={`font-bold ${state.riskAssessment.severity_score > 0.7 ? 'text-red-400' :
                                                        state.riskAssessment.severity_score > 0.4 ? 'text-yellow-400' : 'text-green-400'
                                                    }`}>
                                                    {(state.riskAssessment.severity_score * 100).toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="w-full h-2 bg-dim overflow-hidden">
                                                <div
                                                    className={`h-full transition-all duration-700 ${state.riskAssessment.severity_score > 0.7 ? 'bg-red-400' :
                                                            state.riskAssessment.severity_score > 0.4 ? 'bg-yellow-400' : 'bg-green-400'
                                                        }`}
                                                    style={{ width: `${state.riskAssessment.severity_score * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </ConsoleCard>
                            )}

                            {state.riskModelOutput && state.mlRisk && (
                                <ConsoleCard title="Catastrophic Risk Model" className="border-accent/40">
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3">
                                            <Brain className="w-5 h-5 text-accent" />
                                            <span className="font-mono text-xs text-muted uppercase">Abdominal catastrophic deterioration model</span>
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center justify-between font-mono text-xs">
                                                <span className="text-muted">Catastrophic 6h Risk</span>
                                                <span className={`font-bold ${state.riskModelOutput.catastrophic_deterioration_risk_6h > 0.7 ? 'text-red-400' :
                                                        state.riskModelOutput.catastrophic_deterioration_risk_6h > 0.4 ? 'text-yellow-400' : 'text-green-400'
                                                    }`}>
                                                    {(state.riskModelOutput.catastrophic_deterioration_risk_6h * 100).toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="w-full h-2 bg-dim overflow-hidden">
                                                <div
                                                    className={`h-full transition-all duration-700 ${state.riskModelOutput.catastrophic_deterioration_risk_6h > 0.7 ? 'bg-red-400' :
                                                            state.riskModelOutput.catastrophic_deterioration_risk_6h > 0.4 ? 'bg-yellow-400' : 'bg-green-400'
                                                        }`}
                                                    style={{ width: `${state.riskModelOutput.catastrophic_deterioration_risk_6h * 100}%` }}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="font-mono">
                                                <span className="text-[10px] text-muted uppercase block">Operative Urgency</span>
                                                <span className="text-sm text-foreground">{(state.riskModelOutput.operative_urgency_risk * 100).toFixed(1)}%</span>
                                            </div>
                                            <div className="font-mono">
                                                <span className="text-[10px] text-muted uppercase block">Legacy ML Abstain</span>
                                                <span className="text-sm text-foreground">
                                                    {state.mlRisk.abstain ? 'YES — LOW CONFIDENCE' : 'NO — CONFIDENT'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="font-mono text-[10px] text-muted uppercase">
                                            Shock Risk: <span className="text-foreground normal-case">{(state.riskModelOutput.shock_risk * 100).toFixed(1)}%</span>
                                        </div>
                                        <div className="font-mono text-[10px] text-muted">
                                            {state.riskModelOutput.definition}
                                        </div>

                                        <div className="font-mono text-[10px] text-muted border-t border-grid pt-2">
                                            MODEL: {state.mlRisk.model_version}
                                            {state.mlRisk._reason && (
                                                <span className="ml-2 text-yellow-400/70">({state.mlRisk._reason})</span>
                                            )}
                                        </div>
                                    </div>
                                </ConsoleCard>
                            )}

                            <TreatmentPathwaysPanel
                                inferenceEventId={state.eventId}
                                diagnosisLabel={state.probabilities[0]?.label ?? null}
                            />
                        </div>
                    )}
                </div>
            </div>
        </Container>
    );
}
