'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    ClinicWorkflowPanel,
    type WorkflowBenchmarkSnapshot,
    type WorkflowEpisodeDetail,
} from '@/components/ClinicWorkflowPanel';
import { TreatmentPathwaysPanel } from '@/components/TreatmentPathwaysPanel';
import { InferenceForm } from '@/components/InferenceForm';
import { NormalizedPreview } from '@/components/NormalizedPreview';
import { normalizeInferenceInput, type InputMode as BaseInputMode, type NormalizedInput } from '@/lib/input/inputNormalizer';
import { ASK_VETIOS_CASE_DRAFT_STORAGE_KEY, type AskVetiosCaseHandoffPayload } from '@/lib/askVetios/intake';
import type { EncounterPayloadV2, MMColour, Sex, Species, SystemPanel, TestValue } from '@vetios/inference-schema';

type InputMode = BaseInputMode | 'panels';
import { extractUuidFromText } from '@/lib/utils/uuid';
import { ShieldCheck, Activity, AlertTriangle, Brain, CheckCircle2, ChevronDown, ChevronUp, BarChart3, Binary, HeartPulse, Workflow } from 'lucide-react';
import { Container, PageHeader, ConsoleCard, DataRow, TerminalLabel, TerminalInput, TerminalTextarea, TerminalButton, TerminalTabs } from '@/components/ui/terminal';
import { MetricCard } from '@/components/InferenceMetrics';
import { SystemLogConsole, type LogEntry } from '@/components/SystemLogConsole';
import { isPopulatedPanelValue, panelsToDiagnosticTests } from '@/lib/inference/panel-diagnostics';
import { fetchWithTimeout } from '@/lib/http/clientRequest';

type InferenceTab = 'analysis' | 'vectors' | 'diagnostics' | 'intelligence' | 'pathways';

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
    safety_state: 'nominal' | 'review' | 'hold' | 'warning' | 'critical' | 'blocked';
    reliability_badge: 'HIGH' | 'REVIEW' | 'CAUTION' | 'SUPPRESSED';
    input_quality: number;
    incident_id?: string | null;
}

interface ExecutionTraceEvent {
    id: string;
    stage_key: string;
    stage_label: string;
    stage_status: 'completed' | 'skipped' | 'failed';
    latency_ms: number;
    model_name: string | null;
    model_version: string | null;
    ranker: 'classical' | 'quantum' | 'hybrid' | null;
    created_at: string;
    stage_metadata: Record<string, unknown>;
}

interface ReplayDriftResult {
    replay_event_id: string | null;
    replay_status: 'completed' | 'failed';
    original_top_label: string | null;
    replay_top_label: string | null;
    original_confidence: number | null;
    replay_confidence: number | null;
    top_label_changed: boolean;
    confidence_delta: number | null;
    distribution_drift: number | null;
    latency_ms: number;
    warnings: string[];
    error: string | null;
}

interface CounterfactualStabilityResult {
    session_id: string;
    stability_verdict: 'stable' | 'fragile' | 'unstable' | 'indeterminate';
    stability_score: number;
    baseline_primary: string;
    baseline_confidence: number;
    findings_challenged: number;
    diagnoses_tested: number;
    top_load_bearing_finding: string | null;
    top_cpg_scores: Array<{
        finding: string;
        diagnosis: string;
        cpg: number;
        probability_baseline: number;
        probability_counterfactual: number;
        diagnosis_dropped_out: boolean;
    }>;
    clinical_summary: string;
    latency_ms: number;
}

interface CalibrationSnapshotResult {
    id: string | null;
    top_label: string | null;
    top_confidence: number;
    phi_hat: number;
    contradiction_score: number;
    differential_count: number;
    differential_entropy: number;
    margin_top2: number;
    calibration_bucket: string;
    calibration_status: 'needs_outcome' | 'calibrated' | 'underconfident' | 'overconfident' | 'indeterminate';
    historical_sample_count: number;
    historical_mean_delta: number | null;
    expected_calibration_error: number | null;
    calibration_reliability_score: number;
    reliability_badge: 'HIGH' | 'REVIEW' | 'CAUTION' | 'SUPPRESSED';
    recommended_action: string;
    created_at: string | null;
}

interface ActionabilityGateResult {
    id: string | null;
    decision: 'actionable_with_confirmation' | 'review_before_action' | 'hold_for_evidence' | 'suppressed';
    actionability_score: number;
    recommended_next_step: string;
    top_label: string | null;
    top_confidence: number;
    phi_hat: number;
    reliability_badge: 'HIGH' | 'REVIEW' | 'CAUTION' | 'SUPPRESSED';
    calibration_status: CalibrationSnapshotResult['calibration_status'];
    historical_sample_count: number;
    contradiction_score: number;
    margin_top2: number;
    differential_entropy: number;
    abstain_recommendation: boolean;
    urgent_confirmatory_testing: boolean;
    required_confirmatory_tests: string[];
    blockers: string[];
    warnings: string[];
    created_at: string | null;
}

interface ReviewQueueEvent {
    id: string | null;
    review_status: 'queued' | 'acknowledged' | 'resolved' | 'dismissed';
    severity: 'routine' | 'review' | 'urgent' | 'critical';
    review_reason: string;
    source: string;
    top_label: string | null;
    top_confidence: number;
    phi_hat: number;
    actionability_score: number;
    blockers: string[];
    warnings: string[];
    recommended_next_step: string | null;
    reviewer_note: string | null;
    created_at: string | null;
}

interface ReviewQueueState {
    status: 'idle' | 'loading' | 'success' | 'missing' | 'error';
    events: ReviewQueueEvent[];
    errorMessage: string | null;
}

interface CorrectionData {
    hallucinated_signals_removed: string[];
    penalties_applied: string[];
    overrides_triggered: string[];
    ranking_shift_explanation: string;
    correction_applied: boolean;
}

interface MultisystemAssessmentData {
    dominant_system?: string;
    active_systems?: string[];
    system_scores?: Record<string, number>;
    species_gate?: string;
    airway_level?: string;
    interpretation?: string;
    uncertainty_notes?: string[];
}

interface ClinicalInfrastructureSnapshot {
    speciesGate: Array<{ label: string; value: string; tone?: 'accent' | 'warning' | 'danger' | 'muted' | 'cyan' | 'violet' }>;
    pathways: Array<{ system: string; score: number; findings: string[] }>;
    mechanisms: Array<{ system: string; mechanism: string; syndrome: string; score: number; reason: string }>;
    evidenceMap: Array<{
        condition: string;
        probability: number;
        range: string;
        density: number | null;
        supports: string[];
        contradicts: string[];
        missing: string[];
    }>;
    reliability: Array<{ label: string; value: string; score: number | null }>;
    nextQuestions: Array<{ prompt: string; reduction: number; resolves: string[]; reason: string }>;
    nextTests: Array<{ prompt: string; reduction: number; resolves: string[]; reason: string }>;
    surgicalPlan: Array<{ label: string; value: string; tone?: 'accent' | 'warning' | 'danger' | 'muted' | 'cyan' | 'violet' }>;
    orthopedicPlan: Array<{ label: string; value: string; tone?: 'accent' | 'warning' | 'danger' | 'muted' | 'cyan' | 'violet' }>;
    longitudinalPlan: Array<{ label: string; value: string; tone?: 'accent' | 'warning' | 'danger' | 'muted' | 'cyan' | 'violet' }>;
    counterfactuals: Array<{ scenario: string; forecast: string; risk: number | null }>;
    outcomeHooks: string[];
    explainability: string[];
    causalMemory: Array<{ label: string; value: string }>;
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
    correction: CorrectionData | null;
    multisystemAssessment: MultisystemAssessmentData | null;
    contradictionAnalysis: Record<string, unknown> | null;
    uncertaintyNotes: string[];
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
    executionTrace: ExecutionTraceEvent[];
    executionTraceMessage: string | null;
    metrics: {
        inferenceTimeMs: number;
        confidenceHistory: { value: number }[];
        loadHistory: { value: number }[];
        tempHistory: { value: number }[];
    } | null;
    logs: LogEntry[];
}

interface ReplayDriftState {
    status: 'idle' | 'running' | 'success' | 'error';
    result: ReplayDriftResult | null;
    errorMessage: string | null;
}

interface CounterfactualStabilityState {
    status: 'idle' | 'running' | 'success' | 'error';
    result: CounterfactualStabilityResult | null;
    errorMessage: string | null;
}

interface CalibrationSnapshotState {
    status: 'idle' | 'loading' | 'success' | 'missing' | 'error';
    result: CalibrationSnapshotResult | null;
    errorMessage: string | null;
}

interface ActionabilityGateState {
    status: 'idle' | 'loading' | 'success' | 'missing' | 'error';
    result: ActionabilityGateResult | null;
    errorMessage: string | null;
}

interface AskVetiosNormalizedHandoff {
    normalizedInput: NormalizedInput;
    requestPayload: Record<string, unknown>;
}

function normalizeAskVetiosHandoff(payload: AskVetiosCaseHandoffPayload): AskVetiosNormalizedHandoff | null {
    const input = readRecord(payload.input);
    const signature = readRecord(input?.input_signature);
    if (!signature) return null;

    const metadata = readRecord(signature.metadata) ?? {};
    const history = readRecord(signature.history);
    const diagnosticTests = readRecord(signature.diagnostic_tests);
    const physicalExam = readRecord(signature.physical_exam);
    const model = readRecord(payload.model);
    const symptoms = readAskVetiosStringArray(signature.symptoms);
    const presentingSigns = readAskVetiosStringArray(signature.presenting_signs);
    const species = typeof signature.species === 'string' && signature.species.trim().length > 0
        ? signature.species.trim()
        : null;
    const breed = typeof signature.breed === 'string' && signature.breed.trim().length > 0
        ? signature.breed.trim()
        : null;
    const ageYears = typeof signature.age_years === 'number' && Number.isFinite(signature.age_years)
        ? signature.age_years
        : undefined;

    return {
        requestPayload: signature,
        normalizedInput: {
            species,
            breed,
            symptoms,
            presenting_signs: presentingSigns.length > 0 ? presentingSigns : symptoms,
            history: history ?? undefined,
            diagnostic_tests: diagnosticTests ?? undefined,
            physical_exam: physicalExam ?? undefined,
            region: typeof signature.region === 'string' ? signature.region : null,
            age_years: ageYears,
            metadata: {
                ...metadata,
                ask_vetios_handoff: true,
                ask_vetios_handoff_model: model,
            },
        },
    };
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readAskVetiosStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            .map((entry) => entry.trim())
        : [];
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
        correction: null,
        multisystemAssessment: null,
        contradictionAnalysis: null,
        uncertaintyNotes: [],
        mlRisk: null,
        riskModelOutput: null,
        riskAssessment: null,
        errorMessage: null,
        normalizedInput: null,
        diagnosticImages: [],
        labResults: [],
        cire: null,
        cireMessage: null,
        executionTrace: [],
        executionTraceMessage: null,
        metrics: null,
        logs: [],
    });
    const [replayDrift, setReplayDrift] = useState<ReplayDriftState>({
        status: 'idle',
        result: null,
        errorMessage: null,
    });
    const [counterfactualStability, setCounterfactualStability] = useState<CounterfactualStabilityState>({
        status: 'idle',
        result: null,
        errorMessage: null,
    });
    const [calibrationSnapshot, setCalibrationSnapshot] = useState<CalibrationSnapshotState>({
        status: 'idle',
        result: null,
        errorMessage: null,
    });
    const [actionabilityGate, setActionabilityGate] = useState<ActionabilityGateState>({
        status: 'idle',
        result: null,
        errorMessage: null,
    });
    const [reviewQueue, setReviewQueue] = useState<ReviewQueueState>({
        status: 'idle',
        events: [],
        errorMessage: null,
    });

    const [inputMode, setInputMode] = useState<InputMode>('structured');
    const [panelSpecies, setPanelSpecies] = useState<Species>('canine');
    const [activePanels, setActivePanels] = useState<SystemPanel[]>([]);
    const [outcomeState, setOutcomeState] = useState<OutcomeState>({ status: 'idle' });
    const riskModelDefinition = state.riskModelOutput?.definition?.toLowerCase() ?? '';
    const hasAbdominalRiskCalibration = Boolean(state.riskModelOutput) && !riskModelDefinition.includes('non-abdominal');
    const intelligenceSnapshot = buildClinicalInfrastructureSnapshot(state.responsePayload, state.requestPayload, state.cire);
    const latestReviewEvent = reviewQueue.events[0] ?? null;

    // ── File reader ──────────────────────────────────────────────────────────

    useEffect(() => {
        const source = new URLSearchParams(window.location.search).get('source');
        if (source !== 'ask-vetios') return;

        try {
            const storedDraft = window.localStorage.getItem(ASK_VETIOS_CASE_DRAFT_STORAGE_KEY);
            if (!storedDraft) return;

            const handoff = normalizeAskVetiosHandoff(JSON.parse(storedDraft) as AskVetiosCaseHandoffPayload);
            if (!handoff) {
                throw new Error('Invalid Ask VetIOS handoff payload');
            }

            setInputMode('json');
            setActiveTab('analysis');
            setState((previous) => ({
                ...previous,
                status: 'previewing',
                eventId: null,
                requestPayload: handoff.requestPayload,
                responsePayload: null,
                probabilities: [],
                explainability: null,
                correction: null,
                multisystemAssessment: null,
                contradictionAnalysis: null,
                uncertaintyNotes: [],
                mlRisk: null,
                riskModelOutput: null,
                riskAssessment: null,
                errorMessage: null,
                normalizedInput: handoff.normalizedInput,
                diagnosticImages: [],
                labResults: [],
                cire: null,
                cireMessage: null,
                executionTrace: [],
                executionTraceMessage: null,
                metrics: null,
                logs: [{
                    id: `ask-vetios-handoff-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    message: 'ASK VETIOS CASE DRAFT LOADED',
                }],
            }));
            window.localStorage.removeItem(ASK_VETIOS_CASE_DRAFT_STORAGE_KEY);
        } catch {
            setState((previous) => ({
                ...previous,
                status: 'error',
                errorMessage: 'Ask VetIOS case draft could not be loaded. Start a new inference manually.',
            }));
        }
    }, []);

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

    function mergeDiagnosticTests(
        base: Record<string, unknown> | undefined,
        structured: Record<string, unknown>,
    ): Record<string, unknown> | undefined {
        if (Object.keys(structured).length === 0) return base;
        if (!base) return structured;
        return mergeRecords(base, structured);
    }

    function mergeRecords(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
        const merged: Record<string, unknown> = { ...left };
        for (const [key, value] of Object.entries(right)) {
            const existing = merged[key];
            if (
                existing &&
                typeof existing === 'object' &&
                !Array.isArray(existing) &&
                value &&
                typeof value === 'object' &&
                !Array.isArray(value)
            ) {
                merged[key] = mergeRecords(existing as Record<string, unknown>, value as Record<string, unknown>);
            } else {
                merged[key] = value;
            }
        }
        return merged;
    }

    function buildEncounterPayloadV2(formData: FormData): EncounterPayloadV2 {
        const populatedPanels = activePanels.filter(panelHasPopulatedTests);
        if (populatedPanels.length === 0) {
            throw new Error('Add at least one populated diagnostic panel.');
        }

        const presentingComplaints = splitPanelList(readFormString(formData, 'panel_presenting_complaints'));
        if (presentingComplaints.length === 0) {
            throw new Error('Add at least one presenting complaint.');
        }

        const imaging: Record<string, TestValue> = {};
        for (const panel of populatedPanels) {
            if (panel.system !== 'imaging') continue;
            for (const [key, value] of Object.entries(panel.tests)) {
                if (isPopulatedPanelValue(value)) {
                    imaging[`${panel.panel}.${key}`] = value;
                }
            }
        }

        return {
            patient: {
                species: panelSpecies,
                breed: readFormString(formData, 'panel_breed'),
                weight_kg: readFormNumber(formData, 'panel_weight_kg'),
                age_years: readFormNumber(formData, 'panel_age_years'),
                sex: readPanelSex(formData.get('panel_sex')),
            },
            encounter: {
                presenting_complaints: presentingComplaints,
                vitals: {
                    temp_c: readFormNumber(formData, 'panel_temp_c'),
                    heart_rate_bpm: readFormInteger(formData, 'panel_hr'),
                    respiratory_rate_bpm: readFormInteger(formData, 'panel_rr'),
                    mm_colour: readMMColour(formData.get('panel_mm_colour')),
                    crt_seconds: readFormNumber(formData, 'panel_crt_seconds'),
                },
                history: {
                    duration_days: readFormInteger(formData, 'panel_duration_days'),
                    free_text: readFormString(formData, 'panel_history'),
                    medications: splitPanelList(readFormString(formData, 'panel_medications')),
                },
            },
            active_system_panels: populatedPanels,
            imaging,
            metadata: {
                encounter_id: createClientId(),
                timestamp: new Date().toISOString(),
                clinician_id: null,
                clinic_id: null,
            },
        };
    }

    function panelHasPopulatedTests(panel: SystemPanel): boolean {
        return Object.values(panel.tests).some(isPopulatedPanelValue);
    }

    function readFormString(formData: FormData, key: string): string {
        const value = formData.get(key);
        return typeof value === 'string' ? value.trim() : '';
    }

    function readFormNumber(formData: FormData, key: string): number | null {
        const raw = readFormString(formData, key);
        if (!raw) return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    function readFormInteger(formData: FormData, key: string): number | null {
        const value = readFormNumber(formData, key);
        return value == null ? null : Math.round(value);
    }

    function splitPanelList(value: string): string[] {
        return value
            .split(/[,;\n]/)
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    function readPanelSex(value: FormDataEntryValue | null): Sex {
        return value === 'male_intact'
            || value === 'male_neutered'
            || value === 'female_intact'
            || value === 'female_spayed'
            || value === 'unknown'
            ? value
            : 'unknown';
    }

    function readMMColour(value: FormDataEntryValue | null): MMColour | null {
        return value === 'pink'
            || value === 'pale'
            || value === 'white'
            || value === 'yellow'
            || value === 'brick_red'
            || value === 'cyanotic'
            || value === 'muddy'
            ? value
            : null;
    }

    function createClientId(): string {
        return typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `enc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }

    function createRequestId(): string {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }

        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
            const random = Math.floor(Math.random() * 16);
            const value = char === 'x' ? random : (random & 0x3) | 0x8;
            return value.toString(16);
        });
    }

    function readEncounterPayloadV2(value: unknown): EncounterPayloadV2 | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const record = value as Record<string, unknown>;
        if (
            !record.patient
            || typeof record.patient !== 'object'
            || !record.encounter
            || typeof record.encounter !== 'object'
            || !Array.isArray(record.active_system_panels)
            || !record.metadata
            || typeof record.metadata !== 'object'
        ) {
            return null;
        }
        return value as EncounterPayloadV2;
    }

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();

        try {
            const formData = new FormData(e.currentTarget);
            let rawInput = '';
            let diagnosticImages: UploadedArtifact[] = [];
            let labResults: UploadedArtifact[] = [];

            if (inputMode === 'panels') {
                const encounterPayload = buildEncounterPayloadV2(formData);
                const diagnosticTests = panelsToDiagnosticTests(encounterPayload.active_system_panels) as Record<string, unknown>;
                const normalizedWithPanels: NormalizedInput = {
                    species: encounterPayload.patient.species,
                    breed: encounterPayload.patient.breed || null,
                    symptoms: encounterPayload.encounter.presenting_complaints,
                    presenting_signs: encounterPayload.encounter.presenting_complaints,
                    diagnostic_tests: diagnosticTests,
                    history: {
                        duration_days: encounterPayload.encounter.history.duration_days,
                        free_text: encounterPayload.encounter.history.free_text,
                        medications: encounterPayload.encounter.history.medications,
                    },
                    physical_exam: {
                        temp_c: encounterPayload.encounter.vitals.temp_c,
                        heart_rate_bpm: encounterPayload.encounter.vitals.heart_rate_bpm,
                        respiratory_rate_bpm: encounterPayload.encounter.vitals.respiratory_rate_bpm,
                        mm_colour: encounterPayload.encounter.vitals.mm_colour,
                        crt_seconds: encounterPayload.encounter.vitals.crt_seconds,
                    },
                    region: null,
                    age_years: encounterPayload.patient.age_years ?? undefined,
                    weight_kg: encounterPayload.patient.weight_kg ?? undefined,
                    metadata: {
                        schema_version: 'v2',
                        encounter_payload_v2: encounterPayload,
                        diagnostic_tests: diagnosticTests,
                    },
                };

                setState(prev => ({
                    ...prev,
                    status: 'previewing',
                    normalizedInput: normalizedWithPanels,
                    diagnosticImages: [],
                    labResults: [],
                    errorMessage: null,
                    cire: null,
                    cireMessage: null,
                    executionTrace: [],
                    executionTraceMessage: null,
                }));
                setOutcomeState({ status: 'idle' });
                setReplayDrift({ status: 'idle', result: null, errorMessage: null });
                setCounterfactualStability({ status: 'idle', result: null, errorMessage: null });
                setCalibrationSnapshot({ status: 'idle', result: null, errorMessage: null });
                setActionabilityGate({ status: 'idle', result: null, errorMessage: null });
                setReviewQueue({ status: 'idle', events: [], errorMessage: null });
                return;
            }

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
            const normalized = normalizeInferenceInput(rawInput, inputMode as BaseInputMode);
            const structuredDiagnosticTests = inputMode === 'structured'
                ? panelsToDiagnosticTests(activePanels.filter(panelHasPopulatedTests)) as Record<string, unknown>
                : {};
            const mergedDiagnosticTests = mergeDiagnosticTests(normalized.diagnostic_tests, structuredDiagnosticTests);
            const normalizedWithDiagnostics: NormalizedInput = mergedDiagnosticTests
                ? {
                    ...normalized,
                    diagnostic_tests: mergedDiagnosticTests,
                    metadata: {
                        ...normalized.metadata,
                        diagnostic_tests: mergedDiagnosticTests,
                    },
                }
                : normalized;

            setState(prev => ({
                ...prev,
                status: 'previewing',
                normalizedInput: normalizedWithDiagnostics,
                diagnosticImages,
                labResults,
                errorMessage: null,
                cire: null,
                cireMessage: null,
                executionTrace: [],
                executionTraceMessage: null,
            }));
            setOutcomeState({ status: 'idle' });
            setReplayDrift({ status: 'idle', result: null, errorMessage: null });
            setCounterfactualStability({ status: 'idle', result: null, errorMessage: null });
            setCalibrationSnapshot({ status: 'idle', result: null, errorMessage: null });
            setActionabilityGate({ status: 'idle', result: null, errorMessage: null });
            setReviewQueue({ status: 'idle', events: [], errorMessage: null });
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
            executionTrace: [],
            executionTraceMessage: null,
            logs: [{
                id: Math.random().toString(16).slice(2),
                timestamp: new Date().toLocaleTimeString(),
                level: 'info',
                message: 'INITIALIZING INFERENCE KERNEL...'
            }],
        }));
        setOutcomeState({ status: 'idle' });
        setReplayDrift({ status: 'idle', result: null, errorMessage: null });
        setCounterfactualStability({ status: 'idle', result: null, errorMessage: null });
        setCalibrationSnapshot({ status: 'idle', result: null, errorMessage: null });
        setActionabilityGate({ status: 'idle', result: null, errorMessage: null });
        setReviewQueue({ status: 'idle', events: [], errorMessage: null });

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
            const diagnosticImages = state.diagnosticImages.length > 0
                ? state.diagnosticImages
                : Array.isArray(finalInput.diagnostic_images)
                    ? finalInput.diagnostic_images
                    : [];
            const labResults = state.labResults.length > 0
                ? state.labResults
                : Array.isArray(finalInput.lab_results)
                    ? finalInput.lab_results
                    : [];
            const v1RequestBody = {
                request_id: createRequestId(),
                model: {
                    name: "VetIOS Diagnostics",
                    version: "latest"
                },
                input: {
                    input_signature: {
                        species: finalInput.species,
                        breed: finalInput.breed,
                        symptoms: finalInput.symptoms,
                        presenting_signs: finalInput.presenting_signs,
                        diagnostic_tests: finalInput.diagnostic_tests,
                        history: finalInput.history,
                        preventive_history: finalInput.preventive_history,
                        physical_exam: finalInput.physical_exam,
                        region: finalInput.region,
                        weight_kg: finalInput.weight_kg,
                        metadata,
                        diagnostic_images: diagnosticImages,
                        lab_results: labResults,
                    }
                }
            };
            const data = v1RequestBody;
            const requestPayloadForState = v1RequestBody.input.input_signature as Record<string, unknown>;

            const startTime = performance.now();
            const res = await fetchWithTimeout('/api/inference', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify(data)
            }, {
                timeoutMs: 28_000,
                timeoutMessage: 'Inference did not return within 28 seconds. Retry with a smaller payload or check the network connection.',
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
                throw new Error(formatApiError(result, `Inference computation failed (HTTP ${res.status})`) + requestIdSuffix);
            }

            const inferenceEventId = extractUuidFromText(result.inference_event_id);
            if (!inferenceEventId) {
                throw new Error('Inference succeeded but returned an invalid inference_event_id.');
            }
            const traceResult = await fetchInferenceExecutionTrace(inferenceEventId);
            if (traceResult.message) {
                pushLog(`TRACE LEDGER: ${traceResult.message}`, 'warn');
            }
            const calibrationResult = await fetchInferenceCalibrationSnapshot(inferenceEventId);
            if (calibrationResult.message) {
                pushLog(`CALIBRATION SNAPSHOT: ${calibrationResult.message}`, calibrationResult.snapshot ? 'info' : 'warn');
            }
            const actionabilityResult = await fetchInferenceActionabilityGate(inferenceEventId);
            if (actionabilityResult.message) {
                pushLog(`ACTIONABILITY GATE: ${actionabilityResult.message}`, actionabilityResult.gate ? 'info' : 'warn');
            }
            const reviewQueueResult = await fetchInferenceReviewQueue(inferenceEventId);
            if (reviewQueueResult.message) {
                pushLog(`REVIEW QUEUE: ${reviewQueueResult.message}`, reviewQueueResult.events.length > 0 ? 'info' : 'warn');
            }

            const dataPayload = result.data && typeof result.data === 'object'
                ? result.data as Record<string, unknown>
                : null;
            const rawCire = result.cire && typeof result.cire === 'object'
                ? result.cire as Record<string, unknown>
                : null;
            const cire = rawCire
                ? normalizeCireState(rawCire)
                : null;
            const fullOutput = result.output_payload && typeof result.output_payload === 'object'
                ? result.output_payload as Record<string, unknown>
                : dataPayload?.output_payload && typeof dataPayload.output_payload === 'object'
                    ? dataPayload.output_payload as Record<string, unknown>
                    : null;
            const apiDifferentials = Array.isArray(dataPayload?.differentials)
                ? dataPayload.differentials as Array<{ label?: string; p?: number }>
                : [];
            const apiConfidence = typeof dataPayload?.confidence_score === 'number'
                ? dataPayload.confidence_score
                : apiDifferentials[0]?.p ?? 0;
            const fullDiagnosis = fullOutput?.diagnosis && typeof fullOutput.diagnosis === 'object'
                ? fullOutput.diagnosis as Record<string, unknown>
                : {};
            const fullTopDifferentials = Array.isArray(fullDiagnosis.top_differentials)
                ? fullDiagnosis.top_differentials
                : null;
            const output = {
                ...(fullOutput ?? {}),
                confidence_score: apiConfidence,
                differentials: apiDifferentials,
                diagnosis: {
                    ...fullDiagnosis,
                    top_differentials: fullTopDifferentials ?? apiDifferentials.map((entry, index) => ({
                            name: entry.label ?? 'Unknown',
                            probability: typeof entry.p === 'number' ? entry.p : 0,
                            rank: index + 1,
                        })),
                },
            } as Record<string, unknown>;
            const diagnosis = output?.diagnosis as Record<string, unknown> | undefined;
            const riskAssessment = output?.risk_assessment as Record<string, unknown> | undefined;
            const riskModelOutput = output?.risk_model_output as Record<string, unknown> | undefined;
            
            pushLog('VECTORS GENERATED SUCCESSFULLY', 'success');
            pushLog('COMPUTING CIRE RELIABILITY...', 'info');

            const diffs = Array.isArray(diagnosis?.top_differentials) ? diagnosis.top_differentials : [];
            const mappedProbabilities = diffs.map((d: any) => ({
                label: d.name || d.condition || d.label || 'Unknown',
                value: typeof d.probability === 'number' ? d.probability : 0,
            }));

            const diagFeatures = output?.diagnosis_feature_importance as Record<string, number> || {};
            const sevFeatures = output?.severity_feature_importance as Record<string, number> || {};

            const mapFeatures = (featObj: Record<string, number>) => 
                Object.entries(featObj)
                    .map(([k, v]) => ({ feature: k, impact: typeof v === 'number' ? v : Number(v) || 0 }))
                    .sort((a, b) => b.impact - a.impact);

            const generateFlatHistory = (value: number) =>
                Array.from({ length: 20 }, () => ({ value }));

            pushLog('INFERENCE PIPELINE COMPLETE', 'success');

            setState(prev => ({
                ...prev,
                status: 'success',
                eventId: inferenceEventId,
                requestPayload: requestPayloadForState,
                responsePayload: output ?? null,
                probabilities: mappedProbabilities.length > 0 ? mappedProbabilities : [
                    { label: 'Unknown', value: 0 }
                ],
                explainability: {
                    featureImportance: mapFeatures(diagFeatures),
                    severityFeatureImportance: mapFeatures(sevFeatures),
                },
                correction: (output?.correction_layer && typeof output.correction_layer === 'object')
                    ? output.correction_layer as CorrectionData
                    : null,
                multisystemAssessment: output?.multisystem_assessment && typeof output.multisystem_assessment === 'object'
                    ? output.multisystem_assessment as MultisystemAssessmentData
                    : null,
                contradictionAnalysis: output?.contradiction_analysis && typeof output.contradiction_analysis === 'object'
                    ? output.contradiction_analysis as Record<string, unknown>
                    : null,
                uncertaintyNotes: Array.isArray(output?.uncertainty_notes)
                    ? output.uncertainty_notes.filter((entry): entry is string => typeof entry === 'string')
                    : [],
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
                cireMessage: null,
                executionTrace: traceResult.events,
                executionTraceMessage: traceResult.message,
                metrics: {
                    inferenceTimeMs: Math.round(measuredLatencyMs),
                    confidenceHistory: generateFlatHistory(apiConfidence),
                    loadHistory: generateFlatHistory(cire?.phi_hat ?? 0),
                    tempHistory: generateFlatHistory(cire?.cps ?? 0),
                },
            }));
            setCalibrationSnapshot({
                status: calibrationResult.snapshot ? 'success' : 'missing',
                result: calibrationResult.snapshot,
                errorMessage: calibrationResult.message,
            });
            setActionabilityGate({
                status: actionabilityResult.gate ? 'success' : 'missing',
                result: actionabilityResult.gate,
                errorMessage: actionabilityResult.message,
            });
            setReviewQueue({
                status: reviewQueueResult.events.length > 0 ? 'success' : reviewQueueResult.message ? 'missing' : 'missing',
                events: reviewQueueResult.events,
                errorMessage: reviewQueueResult.message,
            });
            setActiveTab('vectors');
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown inference error.';
            setState(prev => ({ ...prev, status: 'error', errorMessage }));
        }
    }

    function handleCancelPreview() {
        setState(prev => ({
            ...prev,
            status: 'idle',
            normalizedInput: null,
            cire: null,
            cireMessage: null,
            executionTrace: [],
            executionTraceMessage: null,
        }));
        setCounterfactualStability({ status: 'idle', result: null, errorMessage: null });
        setCalibrationSnapshot({ status: 'idle', result: null, errorMessage: null });
        setActionabilityGate({ status: 'idle', result: null, errorMessage: null });
        setReviewQueue({ status: 'idle', events: [], errorMessage: null });
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

    async function handleReplayDriftCheck() {
        if (!state.eventId || replayDrift.status === 'running') return;
        setReplayDrift({ status: 'running', result: null, errorMessage: null });
        try {
            const response = await fetchWithTimeout(`/api/inference/${encodeURIComponent(state.eventId)}/replay`, {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
            }, {
                timeoutMs: 20_000,
                timeoutMessage: 'Replay drift check did not return within 20 seconds.',
            });
            const text = await response.text();
            let payload: unknown;
            try {
                payload = JSON.parse(text);
            } catch {
                throw new Error(`Replay API returned non-JSON HTTP ${response.status}.`);
            }

            const record = asRecord(payload);
            const result = normalizeReplayDriftResult(record?.data);
            if (!response.ok && !result) {
                throw new Error(formatApiError(payload, `Replay drift check failed (HTTP ${response.status})`));
            }

            setReplayDrift({
                status: result?.replay_status === 'completed' ? 'success' : 'error',
                result,
                errorMessage: result?.error ?? (!response.ok ? formatApiError(payload, 'Replay drift check failed.') : null),
            });
        } catch (error) {
            setReplayDrift({
                status: 'error',
                result: null,
                errorMessage: error instanceof Error ? error.message : 'Replay drift check failed.',
            });
        }
    }

    async function handleCounterfactualStabilityCheck() {
        if (!state.eventId || counterfactualStability.status === 'running') return;
        setCounterfactualStability({ status: 'running', result: null, errorMessage: null });
        try {
            const response = await fetchWithTimeout(`/api/inference/${encodeURIComponent(state.eventId)}/counterfactual`, {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
            }, {
                timeoutMs: 20_000,
                timeoutMessage: 'Counterfactual stability check did not return within 20 seconds.',
            });
            const text = await response.text();
            let payload: unknown;
            try {
                payload = JSON.parse(text);
            } catch {
                throw new Error(`Counterfactual API returned non-JSON HTTP ${response.status}.`);
            }

            if (!response.ok) {
                throw new Error(formatApiError(payload, `Counterfactual stability check failed (HTTP ${response.status})`));
            }

            const result = normalizeCounterfactualStabilityResult(asRecord(payload)?.data);
            if (!result) {
                throw new Error('Counterfactual stability check returned an invalid payload.');
            }

            setCounterfactualStability({ status: 'success', result, errorMessage: null });
        } catch (error) {
            setCounterfactualStability({
                status: 'error',
                result: null,
                errorMessage: error instanceof Error ? error.message : 'Counterfactual stability check failed.',
            });
        }
    }

    async function handleCalibrationSnapshotRefresh() {
        if (!state.eventId || calibrationSnapshot.status === 'loading') return;
        setCalibrationSnapshot({ status: 'loading', result: calibrationSnapshot.result, errorMessage: null });
        const result = await fetchInferenceCalibrationSnapshot(state.eventId);
        setCalibrationSnapshot({
            status: result.snapshot ? 'success' : result.message ? 'error' : 'missing',
            result: result.snapshot,
            errorMessage: result.message,
        });
    }

    async function handleActionabilityGateRefresh() {
        if (!state.eventId || actionabilityGate.status === 'loading') return;
        setActionabilityGate({ status: 'loading', result: actionabilityGate.result, errorMessage: null });
        const result = await fetchInferenceActionabilityGate(state.eventId);
        setActionabilityGate({
            status: result.gate ? 'success' : result.message ? 'error' : 'missing',
            result: result.gate,
            errorMessage: result.message,
        });
    }

    async function handleReviewQueueRefresh() {
        if (!state.eventId || reviewQueue.status === 'loading') return;
        setReviewQueue({ status: 'loading', events: reviewQueue.events, errorMessage: null });
        const result = await fetchInferenceReviewQueue(state.eventId);
        setReviewQueue({
            status: result.events.length > 0 ? 'success' : result.message ? 'missing' : 'missing',
            events: result.events,
            errorMessage: result.message,
        });
    }

    async function handleReviewQueueAction(action: 'queue' | 'acknowledge' | 'resolve' | 'dismiss') {
        if (!state.eventId || reviewQueue.status === 'loading') return;
        setReviewQueue({ status: 'loading', events: reviewQueue.events, errorMessage: null });
        const result = await postInferenceReviewQueueAction(state.eventId, action);
        if (result.event) {
            const refreshed = await fetchInferenceReviewQueue(state.eventId);
            setReviewQueue({
                status: refreshed.events.length > 0 ? 'success' : refreshed.message ? 'missing' : 'missing',
                events: refreshed.events.length > 0 ? refreshed.events : [result.event],
                errorMessage: refreshed.message,
            });
            return;
        }
        setReviewQueue({
            status: 'error',
            events: reviewQueue.events,
            errorMessage: result.message ?? 'Review queue action failed.',
        });
    }

    async function handleCireOverride() {
        if (!state.cire?.incident_id) return;
        const confirmed = window.confirm('Log a CIRE override for this suppressed inference and continue with manual review?');
        if (!confirmed) return;

        try {
            const response = await fetchWithTimeout(`/api/cire/incidents/${state.cire.incident_id}/resolve`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify({
                    override_action: true,
                    resolution_notes: 'Operator override from inference console',
                }),
            }, {
                timeoutMs: 12_000,
                timeoutMessage: 'CIRE override logging timed out. Check the network before retrying.',
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
        const response = await fetchWithTimeout(`/api/episodes/${episodeId}?limit=20`, {
            credentials: 'same-origin',
            cache: 'no-store',
        }, {
            timeoutMs: 10_000,
            timeoutMessage: 'Episode workflow loading timed out. The outcome was saved, but workflow details may need a refresh.',
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
        const actualDiagnosis = String(formData.get('actualDiagnosis') ?? '').trim();
        const data = {
            request_id: createRequestId(),
            inference_event_id: state.eventId,
            outcome: {
                type: 'confirmed_diagnosis',
                payload: {
                    label: actualDiagnosis,
                    confidence: 1,
                    actual_diagnosis: actualDiagnosis,
                    notes: formData.get('notes'),
                },
                timestamp: new Date().toISOString(),
            },
        };

        try {
            const res = await fetchWithTimeout('/api/outcome', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify(data),
            }, {
                timeoutMs: 15_000,
                timeoutMessage: 'Outcome submission timed out. Check the case before submitting again to avoid duplicates.',
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
                throw new Error(formatApiError(result, 'Failed to attach outcome'));
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
                    { id: 'intelligence', label: 'Intelligence', icon: <HeartPulse className="w-4 h-4" /> },
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
                                species={panelSpecies}
                                onSpeciesChange={setPanelSpecies}
                                activePanels={activePanels}
                                onActivePanelsChange={setActivePanels}
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
                                <ConsoleCard title="CIRE RELIABILITY">
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
                                                <span className={`flex items-center gap-2 ${cireTone(state.cire.reliability_badge)}`}>
                                                    <CireReliabilityGlyph badge={state.cire.reliability_badge} />
                                                    {cireBadgeLabel(state.cire.reliability_badge)}
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
                                        <TerminalButton onClick={() => window.open('/dashboard?tab=cire', '_self')}>
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
                                        label="Phi Hat" 
                                        value={state.cire ? state.cire.phi_hat.toFixed(2) : '--'} 
                                        sparklineData={state.metrics?.loadHistory}
                                        color="#00ff9d"
                                    />
                                    <MetricCard 
                                        label="CPS" 
                                        value={state.cire ? state.cire.cps.toFixed(2) : '--'} 
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
                                                    <div className="flex items-center justify-between font-mono text-xs sm:text-sm gap-2">
                                                        <span className={`flex items-center gap-2 min-w-0 ${i === 0 ? 'text-accent font-bold' : 'text-foreground/70'}`}>
                                                            {state.cire ? (
                                                                <span className="shrink-0" title={`CIRE ${state.cire.reliability_badge}`}>
                                                                    <CireReliabilityGlyph badge={state.cire.reliability_badge} />
                                                                </span>
                                                            ) : null}
                                                            <span className="truncate">{p.label}</span>
                                                        </span>
                                                        <span className={`shrink-0 ${i === 0 ? 'text-accent font-bold' : 'text-muted'}`}>
                                                            {(p.value * 100).toFixed(0)}%
                                                        </span>
                                                    </div>
                                                    <div className="w-full h-2 bg-dim border border-grid overflow-hidden">
                                                        <div 
                                                            className={`h-full transition-all duration-1000 ${i === 0 ? 'bg-accent' : 'bg-[hsl(0_0%_46%)]'}`}
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
                                    <ConsoleCard title="Feedback Loop — Evaluation Result" className="border-accent/30 animate-in fade-in duration-500">
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
                                    <ConsoleCard title="Attach Ground Truth" className="border-accent/30 animate-in slide-in-from-top duration-300">
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
                                <ConsoleCard title="Execution Trace Ledger" className="border-accent/25">
                                    {state.executionTrace.length > 0 ? (
                                        <div className="space-y-2">
                                            {state.executionTrace.map((event, index) => (
                                                <div
                                                    key={event.id || `${event.stage_key}-${index}`}
                                                    className="grid grid-cols-[36px,1fr,88px,74px] gap-3 items-center border border-grid bg-black/20 px-3 py-2 font-mono text-[11px]"
                                                >
                                                    <span className="text-muted tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                                                    <div className="min-w-0">
                                                        <div className="truncate text-foreground">{event.stage_label || formatReadableLabel(event.stage_key)}</div>
                                                        <div className="truncate text-[9px] uppercase tracking-widest text-muted">
                                                            {event.stage_key}
                                                            {event.ranker ? ` // ${event.ranker}` : ''}
                                                        </div>
                                                    </div>
                                                    <span className={`uppercase tracking-widest text-[10px] ${traceStatusClass(event.stage_status)}`}>
                                                        {event.stage_status}
                                                    </span>
                                                    <span className="text-right text-accent tabular-nums">{event.latency_ms}ms</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-muted font-mono text-xs border border-dashed border-grid p-4">
                                            {state.executionTraceMessage ?? 'No execution trace rows have been recorded for this inference event yet.'}
                                        </div>
                                    )}
                                </ConsoleCard>

                                <ConsoleCard title="Replay Drift Check" className="border-accent/25">
                                    <div className="grid grid-cols-1 lg:grid-cols-[1fr,220px] gap-4 items-start">
                                        <div className="space-y-3">
                                            <p className="font-mono text-[11px] leading-relaxed text-muted">
                                                Rerun this stored inference through the deterministic core without creating a new clinical case, then compare top diagnosis, confidence, and distribution drift against the original event.
                                            </p>
                                            {replayDrift.result && (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
                                                    <DataRow
                                                        label="Top Label"
                                                        value={`${formatNullableLabel(replayDrift.result.original_top_label)} -> ${formatNullableLabel(replayDrift.result.replay_top_label)}`}
                                                        tone={replayDrift.result.top_label_changed ? 'warning' : 'accent'}
                                                    />
                                                    <DataRow
                                                        label="Confidence Delta"
                                                        value={formatPercentNumber(replayDrift.result.confidence_delta)}
                                                        tone={(replayDrift.result.confidence_delta ?? 0) > 0.1 ? 'warning' : 'accent'}
                                                    />
                                                    <DataRow
                                                        label="Distribution Drift"
                                                        value={formatPercentNumber(replayDrift.result.distribution_drift)}
                                                        tone={(replayDrift.result.distribution_drift ?? 0) > 0.15 ? 'warning' : 'accent'}
                                                    />
                                                    <DataRow
                                                        label="Replay Latency"
                                                        value={`${replayDrift.result.latency_ms}ms`}
                                                        tone="cyan"
                                                    />
                                                </div>
                                            )}
                                            {replayDrift.errorMessage && (
                                                <div className="border border-yellow-400/30 bg-yellow-400/5 p-3 font-mono text-[11px] text-yellow-300">
                                                    {replayDrift.errorMessage}
                                                </div>
                                            )}
                                            {replayDrift.result?.warnings.length ? (
                                                <div className="border border-grid bg-black/20 p-3 font-mono text-[11px] text-muted space-y-1">
                                                    {replayDrift.result.warnings.map((warning, index) => (
                                                        <div key={index}>- {warning}</div>
                                                    ))}
                                                </div>
                                            ) : null}
                                        </div>
                                        <TerminalButton
                                            type="button"
                                            variant="secondary"
                                            onClick={handleReplayDriftCheck}
                                            disabled={!state.eventId || replayDrift.status === 'running'}
                                        >
                                            {replayDrift.status === 'running' ? 'Replaying...' : 'Run Replay'}
                                        </TerminalButton>
                                    </div>
                                </ConsoleCard>

                                <ConsoleCard title="Calibration Snapshot Ledger" className="border-accent/25">
                                    <div className="grid grid-cols-1 lg:grid-cols-[1fr,220px] gap-4 items-start">
                                        <div className="space-y-3">
                                            <p className="font-mono text-[11px] leading-relaxed text-muted">
                                                Persisted calibration seal for this inference: confidence bucket, label calibration history, contradiction pressure, phi reliability, and top-two margin.
                                            </p>
                                            {calibrationSnapshot.result ? (
                                                <div className="space-y-3">
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
                                                        <DataRow
                                                            label="Badge"
                                                            value={`${calibrationSnapshot.result.reliability_badge} // ${formatReadableLabel(calibrationSnapshot.result.calibration_status)}`}
                                                            tone={calibrationBadgeTone(calibrationSnapshot.result.reliability_badge)}
                                                        />
                                                        <DataRow
                                                            label="Top Label"
                                                            value={`${formatNullableLabel(calibrationSnapshot.result.top_label)} · ${formatPercentNumber(calibrationSnapshot.result.top_confidence)}`}
                                                            tone="accent"
                                                        />
                                                        <DataRow
                                                            label="Outcome Samples"
                                                            value={`${calibrationSnapshot.result.historical_sample_count} for label`}
                                                            tone={calibrationSnapshot.result.historical_sample_count >= 5 ? 'accent' : 'warning'}
                                                        />
                                                        <DataRow
                                                            label="Expected Error"
                                                            value={calibrationSnapshot.result.expected_calibration_error == null ? 'Awaiting outcomes' : formatPercentNumber(calibrationSnapshot.result.expected_calibration_error)}
                                                            tone={(calibrationSnapshot.result.expected_calibration_error ?? 0) > 0.12 ? 'warning' : 'accent'}
                                                        />
                                                        <DataRow
                                                            label="Top-2 Margin"
                                                            value={formatPercentNumber(calibrationSnapshot.result.margin_top2)}
                                                            tone={calibrationSnapshot.result.margin_top2 < 0.12 ? 'warning' : 'cyan'}
                                                        />
                                                        <DataRow
                                                            label="Entropy"
                                                            value={formatPercentNumber(calibrationSnapshot.result.differential_entropy)}
                                                            tone={calibrationSnapshot.result.differential_entropy > 0.68 ? 'warning' : 'cyan'}
                                                        />
                                                    </div>
                                                    <p className="font-mono text-[11px] leading-relaxed text-foreground/80">
                                                        {calibrationSnapshot.result.recommended_action}
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="border border-dashed border-grid p-4 font-mono text-[11px] text-muted">
                                                    {calibrationSnapshot.errorMessage ?? 'No calibration snapshot has been loaded for this event yet.'}
                                                </div>
                                            )}
                                            {calibrationSnapshot.errorMessage && calibrationSnapshot.result && (
                                                <div className="border border-yellow-400/30 bg-yellow-400/5 p-3 font-mono text-[11px] text-yellow-300">
                                                    {calibrationSnapshot.errorMessage}
                                                </div>
                                            )}
                                        </div>
                                        <TerminalButton
                                            type="button"
                                            variant="secondary"
                                            onClick={handleCalibrationSnapshotRefresh}
                                            disabled={!state.eventId || calibrationSnapshot.status === 'loading'}
                                        >
                                            {calibrationSnapshot.status === 'loading' ? 'Loading...' : 'Refresh Seal'}
                                        </TerminalButton>
                                    </div>
                                </ConsoleCard>

                                <ConsoleCard title="Clinical Actionability Gate" className="border-accent/25">
                                    <div className="grid grid-cols-1 lg:grid-cols-[1fr,220px] gap-4 items-start">
                                        <div className="space-y-3">
                                            <p className="font-mono text-[11px] leading-relaxed text-muted">
                                                Final action/review/hold decision derived from confidence, CIRE, calibration, contradiction pressure, differential spread, and confirmatory-test requirements.
                                            </p>
                                            {actionabilityGate.result ? (
                                                <div className="space-y-3">
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
                                                        <DataRow
                                                            label="Decision"
                                                            value={`${formatReadableLabel(actionabilityGate.result.decision)} · ${formatPercentNumber(actionabilityGate.result.actionability_score)}`}
                                                            tone={actionabilityDecisionTone(actionabilityGate.result.decision)}
                                                        />
                                                        <DataRow
                                                            label="Reliability"
                                                            value={`${actionabilityGate.result.reliability_badge} // ${formatReadableLabel(actionabilityGate.result.calibration_status)}`}
                                                            tone={calibrationBadgeTone(actionabilityGate.result.reliability_badge)}
                                                        />
                                                        <DataRow
                                                            label="Top Label"
                                                            value={`${formatNullableLabel(actionabilityGate.result.top_label)} · ${formatPercentNumber(actionabilityGate.result.top_confidence)}`}
                                                            tone="accent"
                                                        />
                                                        <DataRow
                                                            label="Contradiction"
                                                            value={formatPercentNumber(actionabilityGate.result.contradiction_score)}
                                                            tone={actionabilityGate.result.contradiction_score >= 0.65 ? 'danger' : actionabilityGate.result.contradiction_score >= 0.35 ? 'warning' : 'accent'}
                                                        />
                                                    </div>
                                                    <p className="font-mono text-[11px] leading-relaxed text-foreground/80">
                                                        {actionabilityGate.result.recommended_next_step}
                                                    </p>
                                                    {(actionabilityGate.result.blockers.length > 0 || actionabilityGate.result.warnings.length > 0) && (
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                            <div className="border border-grid bg-black/20 p-3">
                                                                <div className="mb-2 text-[10px] uppercase tracking-widest text-red-300">Blockers</div>
                                                                <ul className="space-y-1 font-mono text-[11px] text-muted">
                                                                    {(actionabilityGate.result.blockers.length ? actionabilityGate.result.blockers : ['None']).map((item, index) => (
                                                                        <li key={`blocker-${index}`}>- {item}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                            <div className="border border-grid bg-black/20 p-3">
                                                                <div className="mb-2 text-[10px] uppercase tracking-widest text-yellow-300">Warnings</div>
                                                                <ul className="space-y-1 font-mono text-[11px] text-muted">
                                                                    {(actionabilityGate.result.warnings.length ? actionabilityGate.result.warnings : ['None']).map((item, index) => (
                                                                        <li key={`warning-${index}`}>- {item}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {actionabilityGate.result.required_confirmatory_tests.length > 0 && (
                                                        <div className="border border-green-400/20 bg-green-400/5 p-3">
                                                            <div className="mb-2 text-[10px] uppercase tracking-widest text-green-300">Confirmatory Tests</div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {actionabilityGate.result.required_confirmatory_tests.slice(0, 6).map((test, index) => (
                                                                    <span key={`${test}-${index}`} className="border border-green-400/20 px-2 py-1 font-mono text-[10px] text-green-200">
                                                                        {test}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="border border-dashed border-grid p-4 font-mono text-[11px] text-muted">
                                                    {actionabilityGate.errorMessage ?? 'No actionability gate row has been loaded for this event yet.'}
                                                </div>
                                            )}
                                            {actionabilityGate.errorMessage && actionabilityGate.result && (
                                                <div className="border border-yellow-400/30 bg-yellow-400/5 p-3 font-mono text-[11px] text-yellow-300">
                                                    {actionabilityGate.errorMessage}
                                                </div>
                                            )}
                                        </div>
                                        <TerminalButton
                                            type="button"
                                            variant="secondary"
                                            onClick={handleActionabilityGateRefresh}
                                            disabled={!state.eventId || actionabilityGate.status === 'loading'}
                                        >
                                            {actionabilityGate.status === 'loading' ? 'Loading...' : 'Refresh Gate'}
                                        </TerminalButton>
                                    </div>
                                </ConsoleCard>

                                <ConsoleCard title="Clinical Review Queue" className="border-accent/20">
                                    <div className="grid grid-cols-1 lg:grid-cols-[1fr,260px] gap-4 items-start">
                                        <div className="space-y-3">
                                            <p className="font-mono text-[11px] leading-relaxed text-muted">
                                                Append-only review workflow for inferences the gate marks as review, hold, or suppressed. Status changes are recorded as new events.
                                            </p>
                                            {latestReviewEvent ? (
                                                <div className="space-y-3">
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
                                                        <DataRow
                                                            label="Latest Status"
                                                            value={formatReadableLabel(latestReviewEvent.review_status)}
                                                            tone={reviewStatusTone(latestReviewEvent.review_status)}
                                                        />
                                                        <DataRow
                                                            label="Severity"
                                                            value={formatReadableLabel(latestReviewEvent.severity)}
                                                            tone={reviewSeverityTone(latestReviewEvent.severity)}
                                                        />
                                                        <DataRow
                                                            label="Top Label"
                                                            value={`${formatNullableLabel(latestReviewEvent.top_label)} - ${formatPercentNumber(latestReviewEvent.top_confidence)}`}
                                                            tone="accent"
                                                        />
                                                        <DataRow
                                                            label="Source"
                                                            value={formatReadableLabel(latestReviewEvent.source)}
                                                            tone="muted"
                                                        />
                                                    </div>
                                                    <p className="font-mono text-[11px] leading-relaxed text-foreground/85">
                                                        {latestReviewEvent.review_reason}
                                                    </p>
                                                    {latestReviewEvent.recommended_next_step && (
                                                        <p className="font-mono text-[11px] leading-relaxed text-muted">
                                                            {latestReviewEvent.recommended_next_step}
                                                        </p>
                                                    )}
                                                    {reviewQueue.events.length > 1 && (
                                                        <div className="border border-grid bg-black/20 p-3">
                                                            <div className="mb-2 text-[10px] uppercase tracking-widest text-muted">Recent Review Events</div>
                                                            <div className="space-y-1 font-mono text-[11px] text-foreground/80">
                                                                {reviewQueue.events.slice(0, 4).map((event, index) => (
                                                                    <div key={event.id ?? `${event.review_status}-${index}`} className="flex flex-wrap justify-between gap-2 border-b border-grid/60 pb-1 last:border-b-0">
                                                                        <span>{formatReadableLabel(event.review_status)} / {formatReadableLabel(event.severity)}</span>
                                                                        <span className="text-muted">{event.created_at ? new Date(event.created_at).toLocaleString() : 'No timestamp'}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="border border-dashed border-grid p-4 font-mono text-[11px] text-muted">
                                                    {reviewQueue.errorMessage ?? 'No clinical review queue event has been recorded for this inference yet.'}
                                                </div>
                                            )}
                                            {reviewQueue.errorMessage && latestReviewEvent && (
                                                <div className="border border-yellow-400/30 bg-yellow-400/5 p-3 font-mono text-[11px] text-yellow-300">
                                                    {reviewQueue.errorMessage}
                                                </div>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 gap-2">
                                            <TerminalButton
                                                type="button"
                                                variant="secondary"
                                                onClick={handleReviewQueueRefresh}
                                                disabled={!state.eventId || reviewQueue.status === 'loading'}
                                            >
                                                {reviewQueue.status === 'loading' ? 'Loading...' : 'Refresh Queue'}
                                            </TerminalButton>
                                            <TerminalButton
                                                type="button"
                                                variant="secondary"
                                                onClick={() => handleReviewQueueAction('queue')}
                                                disabled={!state.eventId || !actionabilityGate.result || reviewQueue.status === 'loading'}
                                            >
                                                Queue Review
                                            </TerminalButton>
                                            <TerminalButton
                                                type="button"
                                                variant="secondary"
                                                onClick={() => handleReviewQueueAction('acknowledge')}
                                                disabled={!state.eventId || !latestReviewEvent || reviewQueue.status === 'loading'}
                                            >
                                                Acknowledge
                                            </TerminalButton>
                                            <TerminalButton
                                                type="button"
                                                variant="primary"
                                                onClick={() => handleReviewQueueAction('resolve')}
                                                disabled={!state.eventId || !latestReviewEvent || reviewQueue.status === 'loading'}
                                            >
                                                Resolve
                                            </TerminalButton>
                                        </div>
                                    </div>
                                </ConsoleCard>

                                <ConsoleCard title="Counterfactual Stability Challenge" className="border-accent/25">
                                    <div className="grid grid-cols-1 lg:grid-cols-[1fr,220px] gap-4 items-start">
                                        <div className="space-y-3">
                                            <p className="font-mono text-[11px] leading-relaxed text-muted">
                                                Remove structured findings one at a time, rerun the deterministic clinical engine, and measure which findings carry the diagnosis.
                                            </p>
                                            {counterfactualStability.result && (
                                                <div className="space-y-3">
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
                                                        <DataRow
                                                            label="Stability"
                                                            value={`${counterfactualStability.result.stability_verdict.toUpperCase()} (${formatPercentNumber(counterfactualStability.result.stability_score)})`}
                                                            tone={counterfactualVerdictTone(counterfactualStability.result.stability_verdict)}
                                                        />
                                                        <DataRow
                                                            label="Baseline"
                                                            value={`${formatReadableLabel(counterfactualStability.result.baseline_primary)} · ${formatPercentNumber(counterfactualStability.result.baseline_confidence)}`}
                                                            tone="accent"
                                                        />
                                                        <DataRow
                                                            label="Findings"
                                                            value={`${counterfactualStability.result.findings_challenged} challenged`}
                                                            tone="cyan"
                                                        />
                                                        <DataRow
                                                            label="Load Bearing"
                                                            value={counterfactualStability.result.top_load_bearing_finding ?? 'None'}
                                                            tone={counterfactualStability.result.top_load_bearing_finding ? 'warning' : 'accent'}
                                                        />
                                                    </div>
                                                    <p className="font-mono text-[11px] leading-relaxed text-foreground/80">
                                                        {counterfactualStability.result.clinical_summary}
                                                    </p>
                                                    {counterfactualStability.result.top_cpg_scores.length > 0 && (
                                                        <div className="space-y-2">
                                                            {counterfactualStability.result.top_cpg_scores.slice(0, 3).map((score, index) => (
                                                                <div key={`${score.finding}-${score.diagnosis}-${index}`} className="grid grid-cols-[1fr,70px] gap-3 border border-grid bg-black/20 px-3 py-2 font-mono text-[11px]">
                                                                    <div className="min-w-0">
                                                                        <div className="truncate text-foreground">{score.finding}</div>
                                                                        <div className="truncate text-[9px] uppercase tracking-widest text-muted">
                                                                            {formatReadableLabel(score.diagnosis)}
                                                                            {score.diagnosis_dropped_out ? ' // DROPPED OUT' : ''}
                                                                        </div>
                                                                    </div>
                                                                    <span className="text-right text-yellow-300 tabular-nums">{formatPercentNumber(Math.abs(score.cpg))}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {counterfactualStability.errorMessage && (
                                                <div className="border border-yellow-400/30 bg-yellow-400/5 p-3 font-mono text-[11px] text-yellow-300">
                                                    {counterfactualStability.errorMessage}
                                                </div>
                                            )}
                                        </div>
                                        <TerminalButton
                                            type="button"
                                            variant="secondary"
                                            onClick={handleCounterfactualStabilityCheck}
                                            disabled={!state.eventId || counterfactualStability.status === 'running'}
                                        >
                                            {counterfactualStability.status === 'running' ? 'Challenging...' : 'Run Challenge'}
                                        </TerminalButton>
                                    </div>
                                </ConsoleCard>

                                {state.multisystemAssessment && (
                                    <ConsoleCard title="Multisystem Inference Run" className="border-accent/25">
                                        <div className="grid grid-cols-1 md:grid-cols-[1fr,1.4fr] gap-5">
                                            <div className="space-y-3 font-mono text-xs">
                                                <DataRow label="Dominant System" value={formatSystemLabel(state.multisystemAssessment.dominant_system)} />
                                                <DataRow label="Species Gate" value={formatSystemLabel(state.multisystemAssessment.species_gate)} />
                                                <DataRow label="Airway Level" value={formatSystemLabel(state.multisystemAssessment.airway_level)} />
                                                <div className="pt-2 text-[10px] uppercase tracking-widest text-muted">
                                                    {state.multisystemAssessment.interpretation ?? 'Multisystem routing completed.'}
                                                </div>
                                            </div>
                                            <div className="space-y-3">
                                                {Object.entries(state.multisystemAssessment.system_scores ?? {})
                                                    .filter(([, score]) => Number.isFinite(score))
                                                    .slice(0, 8)
                                                    .map(([system, score]) => (
                                                        <div key={system} className="flex flex-col gap-1">
                                                            <div className="flex justify-between font-mono text-[10px] uppercase">
                                                                <span className="text-foreground/70">{formatSystemLabel(system)}</span>
                                                                <span className="text-accent">{Number(score).toFixed(2)}</span>
                                                            </div>
                                                            <div className="w-full h-[2px] bg-dim">
                                                                <div className="bg-accent h-full" style={{ width: `${Math.min(100, Number(score) * 20)}%` }} />
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                        {state.uncertaintyNotes.length > 0 && (
                                            <div className="mt-5 border border-grid bg-black/20 p-3 font-mono text-[11px] text-muted space-y-2">
                                                {state.uncertaintyNotes.slice(0, 4).map((note, index) => (
                                                    <div key={index}>- {note}</div>
                                                ))}
                                            </div>
                                        )}
                                    </ConsoleCard>
                                )}

                                {state.contradictionAnalysis && (
                                    <ConsoleCard title="Contradiction & Plausibility Guard" className="border-accent/25">
                                        <div className="grid grid-cols-1 md:grid-cols-[160px,1fr] gap-4 font-mono text-xs">
                                            <div>
                                                <div className="text-muted uppercase tracking-widest text-[10px] mb-1">Contradiction Score</div>
                                                <div className="text-2xl text-yellow-400">
                                                    {((readNumber(state.contradictionAnalysis.contradiction_score) ?? 0) * 100).toFixed(0)}%
                                                </div>
                                            </div>
                                            <div className="space-y-2 text-[11px] text-muted">
                                                {(Array.isArray(state.contradictionAnalysis.contradiction_reasons)
                                                    ? state.contradictionAnalysis.contradiction_reasons
                                                    : []
                                                ).slice(0, 4).map((reason, index) => (
                                                    <div key={index}>- {String(reason)}</div>
                                                ))}
                                                {(!Array.isArray(state.contradictionAnalysis.contradiction_reasons) || state.contradictionAnalysis.contradiction_reasons.length === 0) && (
                                                    <div>No hard contradictions detected in the top differential set.</div>
                                                )}
                                            </div>
                                        </div>
                                    </ConsoleCard>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <ConsoleCard title="Diagnostic Feature Weights" className="border-muted/30">
                                        <div className="space-y-3">
                                            {state.explainability?.featureImportance.slice(0, 8).map((f, i) => (
                                                <div key={i} className="flex flex-col gap-1">
                                                    <div className="flex justify-between font-mono text-[10px] uppercase">
                                                        <span className="text-foreground/70">{f.feature}</span>
                                                        <span className="text-foreground">{(f.impact * 100).toFixed(0)}</span>
                                                    </div>
                                                    <div className="w-full h-[2px] bg-dim">
                                                        <div className="bg-accent h-full" style={{ width: `${f.impact * 100}%` }} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </ConsoleCard>

                                    <ConsoleCard title="Severity Feature Weights" className="border-muted/30">
                                        <div className="space-y-3">
                                            {state.explainability?.severityFeatureImportance.slice(0, 8).map((f, i) => (
                                                <div key={i} className="flex flex-col gap-1">
                                                    <div className="flex justify-between font-mono text-[10px] uppercase">
                                                        <span className="text-foreground/70">{f.feature}</span>
                                                        <span className="text-foreground">{(f.impact * 100).toFixed(0)}</span>
                                                    </div>
                                                    <div className="w-full h-[2px] bg-dim">
                                                        <div className="bg-orange-500 h-full" style={{ width: `${f.impact * 100}%` }} />
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
                                            <p className="mt-4 text-[10px] text-muted font-mono uppercase truncate">
                                                {state.riskModelOutput.definition}
                                            </p>
                                        </ConsoleCard>
                                    )}
                                </div>

                                {state.correction && (
                                    <ConsoleCard 
                                        title="Signal Integrity — Diagnostic Correction Log" 
                                        className={`mt-6 border-l-4 ${state.correction.correction_applied ? 'border-l-orange-500' : 'border-l-accent'}`}
                                    >
                                        <div className="space-y-6">
                                            {state.correction.correction_applied && (
                                                <div className="flex items-center gap-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded">
                                                    <ShieldCheck className="w-5 h-5 text-orange-500" />
                                                    <div className="font-mono text-[11px] text-orange-400 uppercase tracking-widest">
                                                        INTEGRITY FAIL-SAFE TRIGGERED: Biologically coherent ranking enforced.
                                                    </div>
                                                </div>
                                            )}

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                {/* Hallucination Detection */}
                                                <div className="space-y-3">
                                                    <div className="font-mono text-[10px] text-muted uppercase tracking-widest flex items-center gap-2">
                                                        <Activity className="w-3 h-3" />
                                                        Hallucination Scan
                                                    </div>
                                                    <div className="min-h-[100px] bg-black/20 border border-grid p-3 text-[11px] font-mono">
                                                        {state.correction.hallucinated_signals_removed.length > 0 ? (
                                                            <div className="space-y-2">
                                                                <div className="text-danger flex items-center gap-2">
                                                                    <AlertTriangle className="w-3 h-3" />
                                                                    STRIPPED SIGNALS:
                                                                </div>
                                                                {state.correction.hallucinated_signals_removed.map((s, i) => (
                                                                    <div key={i} className="pl-5 text-danger">- {s}</div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="text-muted flex items-center gap-2 italic">
                                                                <CheckCircle2 className="w-3 h-3" />
                                                                No hallucinated signals detected in driver set.
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Penalties & Logic */}
                                                <div className="space-y-3">
                                                    <div className="font-mono text-[10px] text-muted uppercase tracking-widest flex items-center gap-2">
                                                        <Binary className="w-3 h-3" />
                                                        Rule Enforcement
                                                    </div>
                                                    <div className="min-h-[100px] bg-black/20 border border-grid p-3 text-[11px] font-mono space-y-2">
                                                        {state.correction.penalties_applied.length > 0 && (
                                                            <div className="text-orange-400/80">
                                                                {state.correction.penalties_applied.map((p, i) => (
                                                                    <div key={i}>• {p}</div>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {state.correction.overrides_triggered.length > 0 && (
                                                            <div className="text-accent">
                                                                {state.correction.overrides_triggered.map((o, i) => (
                                                                    <div key={i}>↑ {o}</div>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {state.correction.penalties_applied.length === 0 && state.correction.overrides_triggered.length === 0 && (
                                                            <div className="text-muted italic">
                                                                All hierarchy rules satisfied.
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div className="bg-black/20 p-4 border border-grid">
                                                <div className="font-mono text-[10px] text-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                                                    <Brain className="w-3 h-3" />
                                                    Hierarchical Reasoning Analysis
                                                </div>
                                                <p className="font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
                                                    {state.correction.ranking_shift_explanation}
                                                </p>
                                            </div>

                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="p-2 border border-grid bg-dim/30 rounded text-center">
                                                    <div className="text-[8px] uppercase tracking-widest text-muted mb-1">Signal Origin</div>
                                                    <div className="text-[10px] font-mono text-accent">WEIGHTED TIERING</div>
                                                </div>
                                                <div className="p-2 border border-grid bg-dim/30 rounded text-center">
                                                    <div className="text-[8px] uppercase tracking-widest text-muted mb-1">Gating Mode</div>
                                                    <div className="text-[10px] font-mono text-accent">DUAL-SYSTEM</div>
                                                </div>
                                                <div className="p-2 border border-grid bg-dim/30 rounded text-center">
                                                    <div className="text-[8px] uppercase tracking-widest text-muted mb-1">Coherence</div>
                                                    <div className="text-[10px] font-mono text-green-400">PASSED</div>
                                                </div>
                                            </div>
                                        </div>
                                    </ConsoleCard>
                                )}
                            </>
                        )}
                    </div>
                )}

                {activeTab === 'intelligence' && (
                    <div className="max-w-6xl mx-auto space-y-6">
                        {state.status !== 'success' ? (
                            <div className="text-muted font-mono text-xs text-center py-12 border border-dashed border-grid">
                                AWAITING CLINICAL INTELLIGENCE OUTPUT...
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.2fr] gap-6">
                                    <ConsoleCard title="Clinical Context & Species Gate" className="border-accent/30">
                                        <div className="space-y-1">
                                            {intelligenceSnapshot.speciesGate.map((row) => (
                                                <DataRow key={row.label} label={row.label} value={row.value} tone={row.tone} />
                                            ))}
                                        </div>
                                    </ConsoleCard>

                                    <ConsoleCard title="Pathophysiology Routing" className="border-accent/25">
                                        <div className="space-y-4">
                                            {intelligenceSnapshot.pathways.length > 0 ? intelligenceSnapshot.pathways.slice(0, 5).map((pathway) => (
                                                <div key={pathway.system} className="space-y-2">
                                                    <div className="flex justify-between gap-3 font-mono text-xs uppercase">
                                                        <span className="text-foreground">{pathway.system}</span>
                                                        <span className="text-accent">{pathway.score.toFixed(2)}</span>
                                                    </div>
                                                    <div className="h-2 border border-grid bg-dim overflow-hidden">
                                                        <div className="h-full bg-accent" style={{ width: `${Math.min(100, pathway.score * 20)}%` }} />
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {pathway.findings.slice(0, 5).map((finding) => (
                                                            <span key={`${pathway.system}-${finding}`} className="border border-grid bg-black/20 px-2 py-1 font-mono text-[10px] uppercase text-muted">
                                                                {finding}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )) : (
                                                <div className="font-mono text-xs text-muted">No pathway routing was returned for this case.</div>
                                            )}
                                        </div>
                                    </ConsoleCard>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <ConsoleCard title="Mechanism & Differential Graph" className="border-accent/25">
                                        <div className="space-y-4">
                                            {intelligenceSnapshot.mechanisms.length > 0 ? intelligenceSnapshot.mechanisms.slice(0, 5).map((entry) => (
                                                <div key={`${entry.system}-${entry.mechanism}-${entry.score}`} className="border border-grid bg-black/20 p-3">
                                                    <div className="flex justify-between gap-3 font-mono text-[11px] uppercase">
                                                        <span className="text-accent">{entry.system}</span>
                                                        <span className="text-muted">{(entry.score * 100).toFixed(0)}%</span>
                                                    </div>
                                                    <div className="mt-2 font-mono text-xs text-foreground">{entry.mechanism}</div>
                                                    <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">{entry.syndrome}</div>
                                                    <p className="mt-3 text-xs leading-relaxed text-muted">{entry.reason}</p>
                                                </div>
                                            )) : (
                                                <div className="font-mono text-xs text-muted">No mechanism analysis was returned for this case.</div>
                                            )}
                                        </div>
                                    </ConsoleCard>

                                    <ConsoleCard title="Evidence Mapping" className="border-accent/25">
                                        <div className="space-y-4">
                                            {intelligenceSnapshot.evidenceMap.slice(0, 4).map((entry) => (
                                                <div key={entry.condition} className="border border-grid bg-black/20 p-3">
                                                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] uppercase">
                                                        <span className="text-foreground">{entry.condition}</span>
                                                        <span className="text-accent">{(entry.probability * 100).toFixed(0)}% {entry.range}</span>
                                                    </div>
                                                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
                                                        <EvidenceColumn title="For" items={entry.supports} tone="text-accent" />
                                                        <EvidenceColumn title="Against" items={entry.contradicts} tone="text-danger" />
                                                        <EvidenceColumn title="Missing" items={entry.missing} tone="text-yellow-300" />
                                                    </div>
                                                </div>
                                            ))}
                                            {intelligenceSnapshot.evidenceMap.length === 0 ? (
                                                <div className="font-mono text-xs text-muted">No ranked evidence map was returned for this case.</div>
                                            ) : null}
                                        </div>
                                    </ConsoleCard>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-[1.1fr,0.9fr] gap-6">
                                    <ConsoleCard title="Diagnostic Planning & Information Gain" className="border-accent/30">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <PlanningColumn title="Next Best Questions" items={intelligenceSnapshot.nextQuestions} />
                                            <PlanningColumn title="Next Best Tests" items={intelligenceSnapshot.nextTests} />
                                        </div>
                                    </ConsoleCard>

                                    <ConsoleCard title="Reliability Breakdown" className="border-accent/30">
                                        <div className="space-y-3">
                                            {intelligenceSnapshot.reliability.map((row) => (
                                                <div key={row.label} className="space-y-1">
                                                    <div className="flex justify-between gap-3 font-mono text-[10px] uppercase">
                                                        <span className="text-muted">{row.label}</span>
                                                        <span className="text-accent">{row.value}</span>
                                                    </div>
                                                    {row.score != null ? (
                                                        <div className="h-1.5 bg-dim border border-grid overflow-hidden">
                                                            <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, row.score * 100))}%` }} />
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    </ConsoleCard>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    <ConsoleCard title="Surgical Intelligence" className="border-accent/25">
                                        {intelligenceSnapshot.surgicalPlan.map((row) => (
                                            <DataRow key={row.label} label={row.label} value={row.value} tone={row.tone} />
                                        ))}
                                    </ConsoleCard>

                                    <ConsoleCard title="Orthopedic Intelligence" className="border-accent/25">
                                        {intelligenceSnapshot.orthopedicPlan.map((row) => (
                                            <DataRow key={row.label} label={row.label} value={row.value} tone={row.tone} />
                                        ))}
                                    </ConsoleCard>

                                    <ConsoleCard title="Longitudinal Intelligence" className="border-accent/25">
                                        {intelligenceSnapshot.longitudinalPlan.map((row) => (
                                            <DataRow key={row.label} label={row.label} value={row.value} tone={row.tone} />
                                        ))}
                                    </ConsoleCard>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-[1fr,1fr] gap-6">
                                    <ConsoleCard title="Counterfactual Outcome Trees" className="border-accent/25">
                                        <div className="space-y-3">
                                            {intelligenceSnapshot.counterfactuals.map((entry) => (
                                                <div key={entry.scenario} className="border border-grid bg-black/20 p-3">
                                                    <div className="flex justify-between gap-3 font-mono text-[11px] uppercase">
                                                        <span className="text-foreground">{entry.scenario}</span>
                                                        <span className={entry.risk != null && entry.risk >= 0.65 ? 'text-danger' : 'text-accent'}>
                                                            {entry.risk == null ? 'Tracked' : `${(entry.risk * 100).toFixed(0)}% risk`}
                                                        </span>
                                                    </div>
                                                    <p className="mt-2 text-xs leading-relaxed text-muted">{entry.forecast}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </ConsoleCard>

                                    <ConsoleCard title="Causal Memory & Outcome Learning" className="border-accent/30">
                                        <div className="space-y-4">
                                            <div className="space-y-1">
                                                {intelligenceSnapshot.causalMemory.map((row) => (
                                                    <DataRow key={row.label} label={row.label} value={row.value} />
                                                ))}
                                            </div>
                                            <div className="border border-grid bg-black/20 p-3">
                                                <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Outcome Hooks</div>
                                                <div className="space-y-2 font-mono text-[11px] text-muted">
                                                    {intelligenceSnapshot.outcomeHooks.map((hook) => (
                                                        <div key={hook}>- {hook}</div>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="border border-grid bg-black/20 p-3">
                                                <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Explainability</div>
                                                <div className="space-y-2 font-mono text-[11px] text-muted">
                                                    {intelligenceSnapshot.explainability.slice(0, 5).map((line) => (
                                                        <div key={line}>- {line}</div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </ConsoleCard>
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

function EvidenceColumn({ title, items, tone }: { title: string; items: string[]; tone: string }) {
    return (
        <div className="min-w-0">
            <div className={`mb-2 font-mono text-[10px] uppercase tracking-widest ${tone}`}>{title}</div>
            <div className="space-y-1 font-mono text-[10px] text-muted">
                {items.length > 0 ? items.slice(0, 4).map((item) => (
                    <div key={item} className="truncate" title={item}>- {item}</div>
                )) : (
                    <div className="italic">None recorded</div>
                )}
            </div>
        </div>
    );
}

function PlanningColumn({
    title,
    items,
}: {
    title: string;
    items: Array<{ prompt: string; reduction: number; resolves: string[]; reason: string }>;
}) {
    return (
        <div className="space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted">{title}</div>
            {items.length > 0 ? items.slice(0, 4).map((item) => (
                <div key={`${title}-${item.prompt}`} className="border border-grid bg-black/20 p-3">
                    <div className="flex justify-between gap-3 font-mono text-[11px] uppercase">
                        <span className="text-foreground">{item.prompt}</span>
                        <span className="text-accent">{(item.reduction * 100).toFixed(0)}%</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted">{item.reason}</p>
                    {item.resolves.length > 0 ? (
                        <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted">
                            Resolves: {item.resolves.slice(0, 2).join(', ')}
                        </div>
                    ) : null}
                </div>
            )) : (
                <div className="border border-grid bg-black/20 p-3 font-mono text-xs text-muted">
                    No information-gain item returned.
                </div>
            )}
        </div>
    );
}

function buildClinicalInfrastructureSnapshot(
    outputPayload: Record<string, unknown> | null,
    requestPayload: Record<string, unknown> | null,
    cire: CireState | null,
): ClinicalInfrastructureSnapshot {
    const output = outputPayload ?? {};
    const clinicalIntelligence = asRecord(output.clinical_intelligence) ?? {};
    const speciesValidation = asRecord(output.species_validation)
        ?? asRecord(clinicalIntelligence.species_validation)
        ?? {};
    const diagnosis = asRecord(output.diagnosis) ?? {};
    const riskAssessment = asRecord(output.risk_assessment) ?? {};
    const riskModelOutput = asRecord(output.risk_model_output) ?? {};
    const reliability = asRecord(output.reliability_breakdown)
        ?? asRecord(clinicalIntelligence.reliability_breakdown)
        ?? {};
    const informationGain = asRecord(output.information_gain_engine)
        ?? asRecord(clinicalIntelligence.information_gain_engine)
        ?? {};
    const causalMemory = asRecord(output.causal_memory_update)
        ?? asRecord(clinicalIntelligence.causal_memory_update)
        ?? {};
    const topDifferentials = readRecordArray(diagnosis.top_differentials)
        .concat(readRecordArray(output.differentials))
        .filter((entry, index, entries) => {
            const label = readString(entry.condition) ?? readString(entry.name) ?? readString(entry.label) ?? `entry_${index}`;
            return entries.findIndex((candidate) => (
                readString(candidate.condition)
                ?? readString(candidate.name)
                ?? readString(candidate.label)
                ?? ''
            ) === label) === index;
        });
    const top = topDifferentials[0] ?? {};
    const topLabel = readString(top.condition) ?? readString(top.name) ?? readString(top.label) ?? 'Undetermined';
    const topProbability = readNumber(top.probability) ?? readNumber(top.p) ?? readNumber(output.confidence_score) ?? 0;
    const emergencyLevel = readString(riskAssessment.emergency_level) ?? 'ROUTINE';
    const severityScore = readNumber(riskAssessment.severity_score) ?? topProbability;
    const operativeRisk = readNumber(riskModelOutput.operative_urgency_risk) ?? severityScore;
    const catastrophicRisk = readNumber(riskModelOutput.catastrophic_deterioration_risk_6h) ?? severityScore;
    const requestSpecies = readString(requestPayload?.species) ?? 'unknown';
    const canonicalSpecies = readString(speciesValidation.canonical_species) ?? requestSpecies;
    const eligibleSpecies = readStringArray(speciesValidation.eligible_species).join(', ') || canonicalSpecies;
    const excludedSpecies = readStringArray(speciesValidation.excluded_species);
    const surgicalSignal = inferSurgicalSignal(topLabel, emergencyLevel, operativeRisk);
    const orthopedicSignal = inferOrthopedicSignal(topLabel);
    const chronicSignal = inferLongitudinalSignal(topLabel);

    return {
        speciesGate: [
            { label: 'Input Species', value: formatReadableLabel(requestSpecies), tone: 'muted' },
            { label: 'Canonical Species', value: formatReadableLabel(canonicalSpecies), tone: 'accent' },
            { label: 'Eligible Disease Space', value: formatReadableLabel(eligibleSpecies), tone: 'accent' },
            { label: 'Excluded Species', value: excludedSpecies.length > 0 ? excludedSpecies.map(formatReadableLabel).join(', ') : 'None', tone: 'warning' },
            { label: 'Gate', value: readString(speciesValidation.gate) ?? 'species gate applied before scoring', tone: 'cyan' },
        ],
        pathways: readRecordArray(output.pathway_analysis ?? clinicalIntelligence.pathway_analysis).map((entry) => ({
            system: formatReadableLabel(readString(entry.system) ?? 'unknown'),
            score: readNumber(entry.score) ?? 0,
            findings: readRecordArray(entry.contributing_findings)
                .map((finding) => readString(finding.finding))
                .filter((finding): finding is string => Boolean(finding)),
        })),
        mechanisms: readRecordArray(output.mechanism_analysis ?? clinicalIntelligence.mechanism_analysis).map((entry) => ({
            system: formatReadableLabel(readString(entry.system) ?? 'unknown'),
            mechanism: readString(entry.mechanism) ?? 'undifferentiated mechanism',
            syndrome: readString(entry.syndrome) ?? 'unclassified syndrome',
            score: readNumber(entry.score) ?? 0,
            reason: readString(entry.reason) ?? 'Mechanism routed from the current differential set.',
        })),
        evidenceMap: topDifferentials.slice(0, 6).map((entry) => {
            const interval = asRecord(entry.probability_interval);
            const low = readNumber(interval?.low);
            const high = readNumber(interval?.high);
            const label = readString(entry.condition) ?? readString(entry.name) ?? readString(entry.label) ?? 'Unknown';
            return {
                condition: formatReadableLabel(label),
                probability: readNumber(entry.probability) ?? readNumber(entry.p) ?? 0,
                range: low != null && high != null ? `(${formatPercentNumber(low)}-${formatPercentNumber(high)})` : '',
                density: readNumber(entry.evidence_density),
                supports: readEvidenceLabels(entry.supporting_evidence),
                contradicts: readEvidenceLabels(entry.contradicting_evidence),
                missing: readEvidenceLabels(entry.missing_evidence),
            };
        }),
        reliability: [
            reliabilityRow('Input Completeness', reliability.input_completeness),
            reliabilityRow('Species Confidence', reliability.species_confidence),
            reliabilityRow('Evidence Density', reliability.evidence_density),
            reliabilityRow('Diagnostic Separation', reliability.diagnostic_separation),
            reliabilityRow('Ontology Match', reliability.ontology_match),
            reliabilityRow('Contradiction Burden', reliability.contradiction_burden),
            reliabilityRow('Composite Reliability', reliability.composite_reliability_score ?? cire?.phi_hat),
        ],
        nextQuestions: readRecommendations(informationGain.next_best_questions),
        nextTests: readRecommendations(informationGain.next_best_tests),
        surgicalPlan: [
            { label: 'Need For Surgery', value: surgicalSignal.need, tone: surgicalSignal.need === 'Likely' ? 'danger' : surgicalSignal.need === 'Possible' ? 'warning' : 'muted' },
            { label: 'Urgency Score', value: formatPercentNumber(operativeRisk), tone: operativeRisk >= 0.65 ? 'danger' : operativeRisk >= 0.4 ? 'warning' : 'accent' },
            { label: 'Procedure', value: surgicalSignal.procedure, tone: surgicalSignal.need === 'Likely' ? 'danger' : 'muted' },
            { label: 'Hospitalization', value: surgicalSignal.hospitalization, tone: 'cyan' },
            { label: 'Expected Outcome', value: surgicalSignal.outcome, tone: 'accent' },
        ],
        orthopedicPlan: [
            { label: 'Ortho Case', value: orthopedicSignal.detected ? 'Detected' : 'Not primary', tone: orthopedicSignal.detected ? 'cyan' : 'muted' },
            { label: 'Classification', value: orthopedicSignal.classification, tone: orthopedicSignal.detected ? 'accent' : 'muted' },
            { label: 'Implant/Support', value: orthopedicSignal.implant, tone: orthopedicSignal.detected ? 'cyan' : 'muted' },
            { label: 'Healing Probability', value: formatPercentNumber(orthopedicSignal.healingProbability), tone: 'accent' },
            { label: 'Rehabilitation', value: orthopedicSignal.rehabilitation, tone: 'violet' },
        ],
        longitudinalPlan: [
            { label: 'Trajectory Type', value: chronicSignal.trajectory, tone: chronicSignal.detected ? 'violet' : 'muted' },
            { label: 'Disease Velocity', value: chronicSignal.velocity, tone: chronicSignal.velocity === 'High' ? 'danger' : chronicSignal.velocity === 'Moderate' ? 'warning' : 'accent' },
            { label: 'Treatment Response Window', value: chronicSignal.responseWindow, tone: 'cyan' },
            { label: 'Follow-up Anchor', value: chronicSignal.followUp, tone: 'accent' },
            { label: 'Deviation Watch', value: chronicSignal.deviationWatch, tone: 'warning' },
        ],
        counterfactuals: [
            {
                scenario: 'No intervention',
                forecast: catastrophicRisk >= 0.65
                    ? 'Deterioration risk is high if the current pathway is not acted on.'
                    : 'Monitor closely; current evidence does not imply immediate collapse, but uncertainty remains outcome-sensitive.',
                risk: catastrophicRisk,
            },
            {
                scenario: 'Confirmatory diagnostics completed',
                forecast: 'Missing evidence would narrow the probability interval and recalibrate the top differential set.',
                risk: Math.max(0.05, 1 - topProbability),
            },
            {
                scenario: 'Alternative differential is correct',
                forecast: topDifferentials[1]
                    ? `${formatReadableLabel(readString(topDifferentials[1].condition) ?? readString(topDifferentials[1].name) ?? readString(topDifferentials[1].label) ?? 'Second differential')} becomes the active care pathway.`
                    : 'No strong alternative was returned; collect additional evidence before closing the case.',
                risk: readNumber(topDifferentials[1]?.probability) ?? readNumber(topDifferentials[1]?.p) ?? null,
            },
            {
                scenario: 'Outcome submitted',
                forecast: 'The case becomes a causal memory node and recalibrates future confidence, near-miss, and treatment-response estimates.',
                risk: null,
            },
        ],
        outcomeHooks: readStringArray(output.outcome_learning_hooks ?? clinicalIntelligence.outcome_learning_hooks)
            .concat(['Confirm the actual diagnosis, diagnostics, treatment response, and follow-up trajectory after case closure.'])
            .filter((hook, index, hooks) => hooks.indexOf(hook) === index)
            .slice(0, 5),
        explainability: readStringArray(output.explainability_report ?? clinicalIntelligence.explainability_report)
            .concat(readStringArray(output.uncertainty_notes))
            .filter((line, index, lines) => lines.indexOf(line) === index)
            .slice(0, 8),
        causalMemory: [
            { label: 'Memory Event', value: readString(causalMemory.event) ?? 'awaiting_outcome_validation' },
            { label: 'Learning Key', value: formatReadableLabel(readString(causalMemory.learning_key) ?? topLabel) },
            { label: 'Update Policy', value: readString(causalMemory.update_policy) ?? 'Update confidence once outcome ground truth is submitted.' },
        ],
    };
}

async function fetchInferenceExecutionTrace(
    inferenceEventId: string,
): Promise<{ events: ExecutionTraceEvent[]; message: string | null }> {
    try {
        const response = await fetchWithTimeout(`/api/inference/${encodeURIComponent(inferenceEventId)}/trace`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
        }, {
            timeoutMs: 4_000,
            timeoutMessage: 'Trace ledger did not respond within 4 seconds.',
        });
        const text = await response.text();
        let payload: unknown;
        try {
            payload = JSON.parse(text);
        } catch {
            return {
                events: [],
                message: `Trace API returned non-JSON HTTP ${response.status}.`,
            };
        }

        if (!response.ok) {
            return {
                events: [],
                message: formatApiError(payload, `Trace ledger unavailable (HTTP ${response.status})`),
            };
        }

        const record = asRecord(payload);
        const events = readRecordArray(record?.data)
            .map(normalizeExecutionTraceEvent)
            .filter((event): event is ExecutionTraceEvent => Boolean(event));

        return { events, message: events.length > 0 ? null : 'Trace ledger returned no rows for this event.' };
    } catch (error) {
        return {
            events: [],
            message: error instanceof Error ? error.message : 'Trace ledger request failed.',
        };
    }

}

async function fetchInferenceCalibrationSnapshot(
    inferenceEventId: string,
): Promise<{ snapshot: CalibrationSnapshotResult | null; message: string | null }> {
    try {
        const response = await fetchWithTimeout(`/api/inference/${encodeURIComponent(inferenceEventId)}/calibration`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
        }, {
            timeoutMs: 4_000,
            timeoutMessage: 'Calibration snapshot did not respond within 4 seconds.',
        });
        const text = await response.text();
        let payload: unknown;
        try {
            payload = JSON.parse(text);
        } catch {
            return {
                snapshot: null,
                message: `Calibration snapshot API returned non-JSON HTTP ${response.status}.`,
            };
        }

        if (!response.ok) {
            return {
                snapshot: null,
                message: formatApiError(payload, `Calibration snapshot unavailable (HTTP ${response.status})`),
            };
        }

        const snapshot = normalizeCalibrationSnapshotResult(asRecord(payload)?.data);
        return {
            snapshot,
            message: snapshot ? null : 'No calibration snapshot row has been recorded for this inference event yet.',
        };
    } catch (error) {
        return {
            snapshot: null,
            message: error instanceof Error ? error.message : 'Calibration snapshot request failed.',
        };
    }
}

async function fetchInferenceActionabilityGate(
    inferenceEventId: string,
): Promise<{ gate: ActionabilityGateResult | null; message: string | null }> {
    try {
        const response = await fetchWithTimeout(`/api/inference/${encodeURIComponent(inferenceEventId)}/actionability`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
        }, {
            timeoutMs: 4_000,
            timeoutMessage: 'Actionability gate did not respond within 4 seconds.',
        });
        const text = await response.text();
        let payload: unknown;
        try {
            payload = JSON.parse(text);
        } catch {
            return {
                gate: null,
                message: `Actionability gate API returned non-JSON HTTP ${response.status}.`,
            };
        }

        if (!response.ok) {
            return {
                gate: null,
                message: formatApiError(payload, `Actionability gate unavailable (HTTP ${response.status})`),
            };
        }

        const gate = normalizeActionabilityGateResult(asRecord(payload)?.data);
        return {
            gate,
            message: gate ? null : 'No actionability gate row has been recorded for this inference event yet.',
        };
    } catch (error) {
        return {
            gate: null,
            message: error instanceof Error ? error.message : 'Actionability gate request failed.',
        };
    }
}

async function fetchInferenceReviewQueue(
    inferenceEventId: string,
): Promise<{ events: ReviewQueueEvent[]; message: string | null }> {
    try {
        const response = await fetchWithTimeout(`/api/inference/${encodeURIComponent(inferenceEventId)}/review`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
        }, {
            timeoutMs: 4_000,
            timeoutMessage: 'Clinical review queue did not respond within 4 seconds.',
        });
        const text = await response.text();
        let payload: unknown;
        try {
            payload = JSON.parse(text);
        } catch {
            return {
                events: [],
                message: `Clinical review queue API returned non-JSON HTTP ${response.status}.`,
            };
        }

        if (!response.ok) {
            return {
                events: [],
                message: formatApiError(payload, `Clinical review queue unavailable (HTTP ${response.status})`),
            };
        }

        const record = asRecord(payload);
        const events = Array.isArray(record?.data)
            ? record.data.map(normalizeReviewQueueEvent).filter((entry): entry is ReviewQueueEvent => Boolean(entry))
            : [];
        return {
            events,
            message: events.length > 0 ? null : readString(record?.message) ?? 'No clinical review queue events have been recorded for this inference yet.',
        };
    } catch (error) {
        return {
            events: [],
            message: error instanceof Error ? error.message : 'Clinical review queue request failed.',
        };
    }
}

async function postInferenceReviewQueueAction(
    inferenceEventId: string,
    action: 'queue' | 'acknowledge' | 'resolve' | 'dismiss',
): Promise<{ event: ReviewQueueEvent | null; message: string | null }> {
    try {
        const response = await fetchWithTimeout(`/api/inference/${encodeURIComponent(inferenceEventId)}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            body: JSON.stringify({ action }),
        }, {
            timeoutMs: 6_000,
            timeoutMessage: 'Clinical review queue update did not respond within 6 seconds.',
        });
        const text = await response.text();
        let payload: unknown;
        try {
            payload = JSON.parse(text);
        } catch {
            return {
                event: null,
                message: `Clinical review queue API returned non-JSON HTTP ${response.status}.`,
            };
        }

        if (!response.ok) {
            return {
                event: null,
                message: formatApiError(payload, `Clinical review queue update failed (HTTP ${response.status})`),
            };
        }

        const event = normalizeReviewQueueEvent(asRecord(payload)?.data);
        return {
            event,
            message: event ? null : 'Clinical review queue update returned an invalid event.',
        };
    } catch (error) {
        return {
            event: null,
            message: error instanceof Error ? error.message : 'Clinical review queue update failed.',
        };
    }
}

function normalizeExecutionTraceEvent(value: Record<string, unknown>): ExecutionTraceEvent | null {
    const stageKey = readString(value.stage_key);
    if (!stageKey) return null;
    return {
        id: readString(value.id) ?? stageKey,
        stage_key: stageKey,
        stage_label: readString(value.stage_label) ?? formatReadableLabel(stageKey),
        stage_status: value.stage_status === 'completed' || value.stage_status === 'skipped' || value.stage_status === 'failed'
            ? value.stage_status
            : 'failed',
        latency_ms: Math.max(0, Math.round(readNumber(value.latency_ms) ?? 0)),
        model_name: readString(value.model_name),
        model_version: readString(value.model_version),
        ranker: value.ranker === 'classical' || value.ranker === 'quantum' || value.ranker === 'hybrid' ? value.ranker : null,
        created_at: readString(value.created_at) ?? '',
        stage_metadata: asRecord(value.stage_metadata) ?? {},
    };
}

function traceStatusClass(status: ExecutionTraceEvent['stage_status']) {
    if (status === 'completed') return 'text-green-400';
    if (status === 'skipped') return 'text-yellow-400';
    return 'text-red-400';
}

function normalizeActionabilityGateResult(value: unknown): ActionabilityGateResult | null {
    const record = asRecord(value);
    if (!record) return null;
    const decision = record.decision;
    const badge = record.reliability_badge;
    const calibrationStatus = record.calibration_status;
    if (
        decision !== 'actionable_with_confirmation'
        && decision !== 'review_before_action'
        && decision !== 'hold_for_evidence'
        && decision !== 'suppressed'
    ) {
        return null;
    }
    if (badge !== 'HIGH' && badge !== 'REVIEW' && badge !== 'CAUTION' && badge !== 'SUPPRESSED') {
        return null;
    }
    if (
        calibrationStatus !== 'needs_outcome'
        && calibrationStatus !== 'calibrated'
        && calibrationStatus !== 'underconfident'
        && calibrationStatus !== 'overconfident'
        && calibrationStatus !== 'indeterminate'
    ) {
        return null;
    }
    return {
        id: readString(record.id),
        decision,
        actionability_score: readNumber(record.actionability_score) ?? 0,
        recommended_next_step: readString(record.recommended_next_step) ?? 'Clinician review required before action.',
        top_label: readString(record.top_label),
        top_confidence: readNumber(record.top_confidence) ?? 0,
        phi_hat: readNumber(record.phi_hat) ?? 0,
        reliability_badge: badge,
        calibration_status: calibrationStatus,
        historical_sample_count: Math.max(0, Math.round(readNumber(record.historical_sample_count) ?? 0)),
        contradiction_score: readNumber(record.contradiction_score) ?? 0,
        margin_top2: readNumber(record.margin_top2) ?? 0,
        differential_entropy: readNumber(record.differential_entropy) ?? 0,
        abstain_recommendation: record.abstain_recommendation === true,
        urgent_confirmatory_testing: record.urgent_confirmatory_testing === true,
        required_confirmatory_tests: readStringArray(record.required_confirmatory_tests),
        blockers: readStringArray(record.blockers),
        warnings: readStringArray(record.warnings),
        created_at: readString(record.created_at),
    };
}

function normalizeReviewQueueEvent(value: unknown): ReviewQueueEvent | null {
    const record = asRecord(value);
    if (!record) return null;
    const status = record.review_status;
    const severity = record.severity;
    if (status !== 'queued' && status !== 'acknowledged' && status !== 'resolved' && status !== 'dismissed') {
        return null;
    }
    if (severity !== 'routine' && severity !== 'review' && severity !== 'urgent' && severity !== 'critical') {
        return null;
    }
    return {
        id: readString(record.id),
        review_status: status,
        severity,
        review_reason: readString(record.review_reason) ?? 'Clinical review requested.',
        source: readString(record.source) ?? 'actionability_gate',
        top_label: readString(record.top_label),
        top_confidence: readNumber(record.top_confidence) ?? 0,
        phi_hat: readNumber(record.phi_hat) ?? 0,
        actionability_score: readNumber(record.actionability_score) ?? 0,
        blockers: readStringArray(record.blockers),
        warnings: readStringArray(record.warnings),
        recommended_next_step: readString(record.recommended_next_step),
        reviewer_note: readString(record.reviewer_note),
        created_at: readString(record.created_at),
    };
}

function normalizeCalibrationSnapshotResult(value: unknown): CalibrationSnapshotResult | null {
    const record = asRecord(value);
    if (!record) return null;
    const badge = record.reliability_badge;
    const status = record.calibration_status;
    if (badge !== 'HIGH' && badge !== 'REVIEW' && badge !== 'CAUTION' && badge !== 'SUPPRESSED') {
        return null;
    }
    if (status !== 'needs_outcome' && status !== 'calibrated' && status !== 'underconfident' && status !== 'overconfident' && status !== 'indeterminate') {
        return null;
    }
    return {
        id: readString(record.id),
        top_label: readString(record.top_label),
        top_confidence: readNumber(record.top_confidence) ?? 0,
        phi_hat: readNumber(record.phi_hat) ?? 0,
        contradiction_score: readNumber(record.contradiction_score) ?? 0,
        differential_count: Math.max(0, Math.round(readNumber(record.differential_count) ?? 0)),
        differential_entropy: readNumber(record.differential_entropy) ?? 0,
        margin_top2: readNumber(record.margin_top2) ?? 0,
        calibration_bucket: readString(record.calibration_bucket) ?? '0.0-0.1',
        calibration_status: status,
        historical_sample_count: Math.max(0, Math.round(readNumber(record.historical_sample_count) ?? 0)),
        historical_mean_delta: readNumber(record.historical_mean_delta),
        expected_calibration_error: readNumber(record.expected_calibration_error),
        calibration_reliability_score: readNumber(record.calibration_reliability_score) ?? 0,
        reliability_badge: badge,
        recommended_action: readString(record.recommended_action) ?? 'Continue outcome monitoring.',
        created_at: readString(record.created_at),
    };
}

function normalizeReplayDriftResult(value: unknown): ReplayDriftResult | null {
    const record = asRecord(value);
    if (!record) return null;
    const status = record.replay_status === 'completed' || record.replay_status === 'failed'
        ? record.replay_status
        : null;
    if (!status) return null;

    return {
        replay_event_id: readString(record.replay_event_id),
        replay_status: status,
        original_top_label: readString(record.original_top_label),
        replay_top_label: readString(record.replay_top_label),
        original_confidence: readNumber(record.original_confidence),
        replay_confidence: readNumber(record.replay_confidence),
        top_label_changed: record.top_label_changed === true,
        confidence_delta: readNumber(record.confidence_delta),
        distribution_drift: readNumber(record.distribution_drift),
        latency_ms: Math.max(0, Math.round(readNumber(record.latency_ms) ?? 0)),
        warnings: readStringArray(record.warnings),
        error: readString(record.error),
    };
}

function normalizeCounterfactualStabilityResult(value: unknown): CounterfactualStabilityResult | null {
    const record = asRecord(value);
    if (!record) return null;
    const verdict = record?.stability_verdict;
    if (verdict !== 'stable' && verdict !== 'fragile' && verdict !== 'unstable' && verdict !== 'indeterminate') {
        return null;
    }
    return {
        session_id: readString(record.session_id) ?? '',
        stability_verdict: verdict,
        stability_score: readNumber(record.stability_score) ?? 0,
        baseline_primary: readString(record.baseline_primary) ?? 'unknown',
        baseline_confidence: readNumber(record.baseline_confidence) ?? 0,
        findings_challenged: readNumber(record.findings_challenged) ?? 0,
        diagnoses_tested: readNumber(record.diagnoses_tested) ?? 0,
        top_load_bearing_finding: readString(record.top_load_bearing_finding),
        top_cpg_scores: readRecordArray(record.top_cpg_scores).map((score) => ({
            finding: readString(score.finding) ?? 'unknown_finding',
            diagnosis: readString(score.diagnosis) ?? 'unknown',
            cpg: readNumber(score.cpg) ?? 0,
            probability_baseline: readNumber(score.probability_baseline) ?? 0,
            probability_counterfactual: readNumber(score.probability_counterfactual) ?? 0,
            diagnosis_dropped_out: score.diagnosis_dropped_out === true,
        })),
        clinical_summary: readString(record.clinical_summary) ?? 'Counterfactual challenge completed.',
        latency_ms: Math.max(0, Math.round(readNumber(record.latency_ms) ?? 0)),
    };
}

function counterfactualVerdictTone(
    verdict: CounterfactualStabilityResult['stability_verdict'],
): 'accent' | 'warning' | 'danger' | 'muted' {
    if (verdict === 'stable') return 'accent';
    if (verdict === 'fragile') return 'warning';
    if (verdict === 'unstable') return 'danger';
    return 'muted';
}

function calibrationBadgeTone(
    badge: CalibrationSnapshotResult['reliability_badge'],
): 'accent' | 'warning' | 'danger' | 'muted' {
    if (badge === 'HIGH') return 'accent';
    if (badge === 'REVIEW') return 'warning';
    if (badge === 'CAUTION') return 'warning';
    return 'danger';
}

function actionabilityDecisionTone(
    decision: ActionabilityGateResult['decision'],
): 'accent' | 'warning' | 'danger' | 'muted' {
    if (decision === 'actionable_with_confirmation') return 'accent';
    if (decision === 'review_before_action') return 'warning';
    if (decision === 'hold_for_evidence') return 'warning';
    return 'danger';
}

function reviewStatusTone(
    status: ReviewQueueEvent['review_status'],
): 'accent' | 'warning' | 'danger' | 'muted' {
    if (status === 'resolved' || status === 'dismissed') return 'accent';
    if (status === 'acknowledged') return 'warning';
    return 'warning';
}

function reviewSeverityTone(
    severity: ReviewQueueEvent['severity'],
): 'accent' | 'warning' | 'danger' | 'muted' {
    if (severity === 'critical') return 'danger';
    if (severity === 'urgent' || severity === 'review') return 'warning';
    return 'muted';
}

function formatNullableLabel(value: string | null): string {
    return value ? formatReadableLabel(value) : 'Not returned';
}

function cireBadgeLabel(badge: CireState['reliability_badge']) {
    if (badge === 'HIGH') return 'HIGH';
    if (badge === 'REVIEW') return 'REVIEW';
    if (badge === 'CAUTION') return 'CAUTION';
    return 'SUPPRESSED';
}

function normalizeCireState(value: Record<string, unknown>): CireState {
    const phiHat = readNumber(value.phi_hat) ?? 0;
    const cps = readNumber(value.cps) ?? 1;
    const safetyState = readCireSafetyState(value.safety_state);

    return {
        phi_hat: phiHat,
        cps,
        safety_state: safetyState,
        reliability_badge: safetyState === 'nominal'
            ? 'HIGH'
            : safetyState === 'review' || safetyState === 'warning'
                ? 'REVIEW'
                : safetyState === 'hold' || safetyState === 'critical'
                    ? 'CAUTION'
                    : 'SUPPRESSED',
        input_quality: Math.max(0, Math.min(1, 1 - cps)),
        incident_id: typeof value.incident_id === 'string' ? value.incident_id : null,
    };
}

function readCireSafetyState(value: unknown): CireState['safety_state'] {
    return value === 'nominal'
        || value === 'review'
        || value === 'hold'
        || value === 'warning'
        || value === 'critical'
        || value === 'blocked'
        ? value
        : 'hold';
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value)
        ? value.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry))
        : [];
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => typeof entry === 'string' ? entry.trim() : null)
        .filter((entry): entry is string => Boolean(entry));
}

function readEvidenceLabels(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => {
            if (typeof entry === 'string') return entry;
            const record = asRecord(entry);
            return readString(record?.finding)
                ?? readString(record?.label)
                ?? readString(record?.test)
                ?? readString(record?.reason);
        })
        .filter((entry): entry is string => Boolean(entry))
        .map(formatReadableLabel)
        .filter((entry, index, entries) => entries.indexOf(entry) === index);
}

function readRecommendations(value: unknown): Array<{ prompt: string; reduction: number; resolves: string[]; reason: string }> {
    return readRecordArray(value).map((entry) => ({
        prompt: formatReadableLabel(readString(entry.prompt) ?? 'Collect additional evidence'),
        reduction: readNumber(entry.expected_uncertainty_reduction) ?? 0,
        resolves: readStringArray(entry.resolves).map(formatReadableLabel),
        reason: readString(entry.reason) ?? 'Targets a missing evidence branch in the active differential set.',
    }));
}

function reliabilityRow(label: string, value: unknown): { label: string; value: string; score: number | null } {
    const score = readNumber(value);
    return {
        label,
        value: score == null ? 'Not returned' : formatPercentNumber(score),
        score,
    };
}

function formatPercentNumber(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return 'N/A';
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatReadableLabel(value: string): string {
    return value
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map((word) => {
            if (/^[A-Z0-9]{2,6}$/.test(word)) return word;
            if (['ivdd', 'gdv', 'ckd', 'cire', 'pcr', 'cbc'].includes(word.toLowerCase())) return word.toUpperCase();
            return `${word[0]?.toUpperCase() ?? ''}${word.slice(1).toLowerCase()}`;
        })
        .join(' ');
}

function inferSurgicalSignal(label: string, emergencyLevel: string, operativeRisk: number) {
    const normalized = label.toLowerCase();
    const likely = /gdv|volvulus|pyometra|foreign body|obstruction|torsion|hernia|rupture|trauma|fracture|cruciate|luxating|ivdd|tumou?r|splenic/i.test(normalized)
        || emergencyLevel === 'CRITICAL'
        || operativeRisk >= 0.7;
    const possible = likely || operativeRisk >= 0.4 || emergencyLevel === 'HIGH' || emergencyLevel === 'REVIEW';
    return {
        need: likely ? 'Likely' : possible ? 'Possible' : 'Not primary',
        procedure: inferProcedure(label),
        hospitalization: likely ? '24-72h estimate pending diagnostics' : possible ? 'Observation or referral-dependent' : 'Outpatient or medical pathway likely',
        outcome: likely ? 'Outcome depends on timing, stabilization, and complication control' : 'Expected outcome primarily follows medical response and diagnostics',
    };
}

function inferProcedure(label: string): string {
    const normalized = label.toLowerCase();
    if (/gdv|volvulus/.test(normalized)) return 'Emergency gastropexy and gastric decompression';
    if (/pyometra/.test(normalized)) return 'Ovariohysterectomy after stabilization';
    if (/foreign body|obstruction/.test(normalized)) return 'Exploratory laparotomy or endoscopic retrieval';
    if (/splenic|torsion/.test(normalized)) return 'Exploratory surgery with splenic assessment';
    if (/hernia/.test(normalized)) return 'Hernia repair after stabilization';
    if (/rupture/.test(normalized)) return 'Emergency repair and contamination control';
    if (/fracture/.test(normalized)) return 'Fracture stabilization planning';
    if (/cruciate/.test(normalized)) return 'Stifle stabilization assessment';
    if (/luxating patella|patella/.test(normalized)) return 'Patellar stabilization assessment';
    if (/ivdd|spinal/.test(normalized)) return 'Neurologic localization and decompression assessment';
    if (/tumou?r|mass/.test(normalized)) return 'Resection planning after staging';
    return 'No specific surgical procedure inferred';
}

function inferOrthopedicSignal(label: string) {
    const normalized = label.toLowerCase();
    const detected = /fracture|femur|tibia|radius|ulna|humerus|pelvis|vertebra|dysplasia|patella|cruciate|ivdd|spinal|atlantoaxial|lameness|orthopedic/.test(normalized);
    return {
        detected,
        classification: detected ? inferOrthopedicClassification(label) : 'No orthopedic primary pathway',
        implant: detected ? inferOrthopedicImplant(label) : 'Not applicable',
        healingProbability: detected ? 0.72 : 0.5,
        rehabilitation: detected ? 'Restricted activity, serial reassessment, and staged rehabilitation' : 'No orthopedic rehabilitation plan generated',
    };
}

function inferOrthopedicClassification(label: string): string {
    const normalized = label.toLowerCase();
    if (/fracture/.test(normalized)) return 'Fracture pathway - classify by bone, location, openness, displacement, and articular involvement';
    if (/cruciate/.test(normalized)) return 'Stifle instability pathway';
    if (/patella/.test(normalized)) return 'Patellar luxation pathway';
    if (/dysplasia/.test(normalized)) return 'Developmental joint disease pathway';
    if (/ivdd|spinal/.test(normalized)) return 'Spinal neurologic pathway';
    return 'Orthopedic pathway';
}

function inferOrthopedicImplant(label: string): string {
    const normalized = label.toLowerCase();
    if (/fracture/.test(normalized)) return 'Plate, screw, pin, external fixator, or hybrid fixation based on imaging';
    if (/cruciate/.test(normalized)) return 'TPLO, TTA, or extracapsular stabilization assessment';
    if (/patella/.test(normalized)) return 'Trochlear block recession, tibial crest transposition, soft tissue balancing';
    if (/ivdd|spinal/.test(normalized)) return 'Surgical decompression assessment if neurologic grade warrants';
    return 'Procedure-specific implant planning pending imaging';
}

function inferLongitudinalSignal(label: string) {
    const normalized = label.toLowerCase();
    const detected = /ckd|renal|diabetes|heart|cardiac|cancer|neoplas|arthritis|chronic|endocrine|cushing|addison|thyroid/.test(normalized);
    return {
        detected,
        trajectory: detected ? 'Longitudinal disease trajectory' : 'Single-encounter trajectory',
        velocity: /acute|crisis|shock|sepsis|rupture|gdv|volvulus/.test(normalized) ? 'High' : detected ? 'Moderate' : 'Low',
        responseWindow: detected ? 'Reassess trend after treatment interval and objective monitoring' : 'Reassess after diagnostic confirmation or symptom change',
        followUp: detected ? 'Trend labs, imaging, symptoms, medications, and owner-reported function' : 'Attach outcome and follow-up if the case evolves',
        deviationWatch: detected ? 'Compare progression against similar cases once outcome history accumulates' : 'Watch for unexpected deterioration or non-response',
    };
}

function formatApiError(result: unknown, fallback: string): string {
    if (!result || typeof result !== 'object') return fallback;
    const record = result as Record<string, unknown>;
    const error = record.error;
    const detail = typeof record.detail === 'string' ? record.detail : null;
    if (typeof error === 'string') return detail ? `${error}: ${detail}` : error;
    if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string') return detail ? `${message}: ${detail}` : message;
    }
    return detail ?? fallback;
}

function formatSystemLabel(value: unknown): string {
    return typeof value === 'string' && value.trim().length > 0
        ? value.replace(/_/g, ' ').toUpperCase()
        : 'UNKNOWN';
}

function CireReliabilityGlyph({ badge }: { badge: CireState['reliability_badge'] }) {
    const common = 'shrink-0';
    if (badge === 'HIGH') {
        return (
            <svg className={`${common} text-emerald-400`} width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <circle cx="8" cy="8" r="6" fill="currentColor" />
            </svg>
        );
    }
    if (badge === 'REVIEW') {
        return (
            <svg className={`${common} text-amber-400`} width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path fill="currentColor" d="M8 2l5 6-5 6-5-6z" />
            </svg>
        );
    }
    if (badge === 'CAUTION') {
        return (
            <svg className={`${common} text-orange-500`} width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path fill="currentColor" d="M8 1L15 14H1z" />
            </svg>
        );
    }
    return (
        <svg className={`${common} text-red-500`} width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path stroke="currentColor" strokeWidth="2" fill="none" d="M4 4l8 8M12 4l-8 8" />
        </svg>
    );
}

function cireTone(badge: CireState['reliability_badge']) {
    if (badge === 'HIGH') return 'text-accent';
    if (badge === 'REVIEW') return 'text-yellow-400';
    if (badge === 'CAUTION') return 'text-orange-500';
    return 'text-danger';
}
