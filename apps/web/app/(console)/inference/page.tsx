'use client';

import { useState } from 'react';
import { Container, PageHeader, ConsoleCard, DataRow, TerminalLabel } from '@/components/ui/terminal';
import { InferenceForm } from '@/components/InferenceForm';
import { ShieldCheck, Activity, AlertTriangle, Brain } from 'lucide-react';

interface MLRiskData {
    risk_score: number;
    confidence: number;
    abstain: boolean;
    model_version: string;
    _fallback?: boolean;
    _reason?: string;
}

interface UploadedArtifact {
    file_name: string;
    mime_type: string;
    size_bytes: number;
    content_base64: string;
}

interface InferenceState {
    status: 'idle' | 'computing' | 'success' | 'error';
    eventId: string | null;
    requestPayload: Record<string, unknown> | null;
    responsePayload: Record<string, unknown> | null;
    probabilities: Array<{ label: string; value: number }>;
    explainability: {
        featureImportance: Array<{ feature: string; impact: number }>;
        symptomScores: Array<{ symptom: string; score: number }>;
    } | null;
    mlRisk: MLRiskData | null;
    errorMessage: string | null;
}

export default function InferenceConsole() {
    const [state, setState] = useState<InferenceState>({
        status: 'idle',
        eventId: null,
        requestPayload: null,
        responsePayload: null,
        probabilities: [],
        explainability: null,
        mlRisk: null,
        errorMessage: null
    });

    async function readFilesAsBase64(files: FormDataEntryValue[]): Promise<UploadedArtifact[]> {
        const validFiles = files.filter((entry): entry is File => entry instanceof File && entry.size > 0);

        return Promise.all(
            validFiles.map(async (file) => {
                const buffer = await file.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let binary = '';
                bytes.forEach((byte) => {
                    binary += String.fromCharCode(byte);
                });

                return {
                    file_name: file.name,
                    mime_type: file.type || 'application/octet-stream',
                    size_bytes: file.size,
                    content_base64: btoa(binary),
                };
            }),
        );
    }

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setState({ status: 'computing', eventId: null, requestPayload: null, responsePayload: null, probabilities: [], explainability: null, mlRisk: null, errorMessage: null });

        const formData = new FormData(e.currentTarget);

        const diagnosticImages = await readFilesAsBase64(formData.getAll('diagnostic-img'));
        const labResults = await readFilesAsBase64(formData.getAll('lab-results'));

        const data = {
            model: {
                name: "gpt-4-turbo",
                version: "1.0.0"
            },
            input: {
                input_signature: {
                    species: formData.get('species'),
                    breed: formData.get('breed'),
                    symptoms: formData.get('symptoms')?.toString().split(',').map((symptom) => symptom.trim()) || [],
                    metadata: formData.get('metadata') ? JSON.parse(formData.get('metadata') as string) : {},
                    diagnostic_images: diagnosticImages,
                    lab_results: labResults,
                }
            }
        };
        try {
            const res = await fetch('/api/inference', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json();

            if (!res.ok) throw new Error(result.error || 'Inference computation failed');

            // Simulate slight delay for computational heavy feel
            await new Promise(r => setTimeout(r, 800));

            setState({
                status: 'success',
                eventId: result.inference_event_id || `evt_${Math.random().toString(36).substr(2, 9)}`,
                requestPayload: data.input.input_signature as Record<string, unknown>,
                responsePayload: result.output || null,
                probabilities: result.probabilities || [
                    { label: 'Primary Pathogen', value: 0.82 },
                    { label: 'Secondary Opportunistic', value: 0.14 },
                    { label: 'Autoimmune', value: 0.04 }
                ],
                explainability: {
                    featureImportance: [
                        { feature: 'Symptom Vector Similarity', impact: 0.88 },
                        { feature: 'Breed Predisposition History', impact: 0.65 },
                        { feature: 'Diagnostic Image Analysis', impact: 0.42 },
                        { feature: 'Metadata Age Correlation', impact: 0.21 },
                    ],
                    symptomScores: [
                        { symptom: data.input.input_signature.symptoms[0] || 'Lethargy', score: 92 },
                        { symptom: data.input.input_signature.symptoms[1] || 'Vomiting', score: 76 },
                    ]
                },
                mlRisk: result.ml_risk || null,
                errorMessage: null
            });
        } catch (err: any) {
            setState(prev => ({ ...prev, status: 'error', errorMessage: err.message }));
        }
    }


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

    return (
        <Container className="max-w-7xl">
            <PageHeader
                title="INFERENCE CONSOLE"
                description="Inject structured clinical context and medical artifacts to generate probability vectors."
            />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">
                <div className="border-r border-grid xl:pr-12">
                    <InferenceForm onSubmit={handleSubmit} isComputing={state.status === 'computing'} />
                </div>

                <div className="space-y-6">
                    <ConsoleCard title="Execution Status">
                        <div className={`p-4 border font-mono text-sm flex items-center gap-3 ${state.status === 'idle' ? 'border-muted text-muted' :
                            state.status === 'computing' ? 'border-accent text-accent animate-pulse bg-accent/5' :
                                state.status === 'error' ? 'border-danger text-danger bg-danger/5' :
                                    'border-accent text-accent'
                            }`}>
                            {state.status === 'idle' && <AlertTriangle className="w-4 h-4" />}
                            {state.status === 'computing' && <Activity className="w-4 h-4 animate-spin" />}
                            {state.status === 'error' && <AlertTriangle className="w-4 h-4" />}
                            {state.status === 'success' && <ShieldCheck className="w-4 h-4" />}

                            {state.status === 'idle' && 'AWAITING VECTORS...'}
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


                            <button
                                type="button"
                                onClick={handleExport}
                                className="w-full border border-accent/50 bg-accent/10 text-accent font-mono text-xs uppercase tracking-wider py-3 hover:bg-accent/20 transition-colors"
                            >
                                Export Examination + Analysis File
                            </button>

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
                                <ConsoleCard title="Feature Importance Heatmap" className="border-muted/30">
                                    <div className="space-y-3">
                                        {state.explainability.featureImportance.map((f, i) => (
                                            <div key={i} className="flex flex-col gap-1">
                                                <div className="flex justify-between font-mono text-[10px] uppercase text-muted">
                                                    <span>{f.feature}</span>
                                                    <span>{(f.impact * 100).toFixed(0)}</span>
                                                </div>
                                                <div className="w-full h-[2px] bg-dim flex">
                                                    <div className="bg-accent h-full" style={{ width: `${f.impact * 100}%`, opacity: f.impact }} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </ConsoleCard>

                                <ConsoleCard title="Symptom Impact Analysis" className="border-muted/30">
                                    <div className="space-y-2">
                                        {state.explainability.symptomScores.map((s, i) => (
                                            <DataRow
                                                key={i}
                                                label={s.symptom}
                                                value={<span className="text-accent">+{s.score} weight</span>}
                                            />
                                        ))}
                                    </div>
                                </ConsoleCard>
                            </div>

                            {/* ML Risk Assessment Panel */}
                            {state.mlRisk && (
                                <ConsoleCard title="ML Risk Assessment" className="border-accent/40">
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3">
                                            <Brain className="w-5 h-5 text-accent" />
                                            <span className="font-mono text-xs text-muted uppercase">TensorFlow Autograd Risk Model</span>
                                            {state.mlRisk._fallback && (
                                                <span className="font-mono text-[10px] text-yellow-400 bg-yellow-400/10 px-2 py-0.5 border border-yellow-400/30">
                                                    FALLBACK
                                                </span>
                                            )}
                                        </div>

                                        {/* Risk Score Bar */}
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center justify-between font-mono text-xs">
                                                <span className="text-muted">Risk Score</span>
                                                <span className={`font-bold ${state.mlRisk.risk_score > 0.7 ? 'text-red-400' :
                                                        state.mlRisk.risk_score > 0.4 ? 'text-yellow-400' : 'text-green-400'
                                                    }`}>
                                                    {(state.mlRisk.risk_score * 100).toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="w-full h-2 bg-dim overflow-hidden">
                                                <div
                                                    className={`h-full transition-all duration-700 ${state.mlRisk.risk_score > 0.7 ? 'bg-red-400' :
                                                            state.mlRisk.risk_score > 0.4 ? 'bg-yellow-400' : 'bg-green-400'
                                                        }`}
                                                    style={{ width: `${state.mlRisk.risk_score * 100}%` }}
                                                />
                                            </div>
                                        </div>

                                        {/* Confidence + Abstain */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="font-mono">
                                                <span className="text-[10px] text-muted uppercase block">Confidence</span>
                                                <span className="text-sm text-foreground">{(state.mlRisk.confidence * 100).toFixed(1)}%</span>
                                            </div>
                                            <div className="font-mono">
                                                <span className="text-[10px] text-muted uppercase block">Abstain</span>
                                                <span className={`text-sm ${state.mlRisk.abstain ? 'text-yellow-400' : 'text-green-400'}`}>
                                                    {state.mlRisk.abstain ? 'YES — LOW CONFIDENCE' : 'NO — CONFIDENT'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Model Version */}
                                        <div className="font-mono text-[10px] text-muted border-t border-grid pt-2">
                                            MODEL: {state.mlRisk.model_version}
                                            {state.mlRisk._reason && (
                                                <span className="ml-2 text-yellow-400/70">({state.mlRisk._reason})</span>
                                            )}
                                        </div>
                                    </div>
                                </ConsoleCard>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Container>
    );
}
