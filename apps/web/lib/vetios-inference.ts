import type { SupabaseClient } from '@supabase/supabase-js';
import { computeCIRE, type CIRESignals, type Differential } from '@/lib/cire';
import {
    createSupabaseClinicalCaseStore,
    ensureCanonicalClinicalCase,
    finalizeClinicalCaseAfterInference,
} from '@/lib/clinicalCases/clinicalCaseManager';
import { runInference as runAiProviderInference } from '@/lib/ai/provider';
import { SupabaseWriteError, readErrorCode } from '@/lib/api/corePipeline';
import { runClinicalInferenceEngine } from '@/lib/inference/engine';
import type { ClinicalInferenceEngineResult } from '@/lib/inference/engine';

export interface InputSignature {
    species: string;
    symptoms: string[];
    breed?: string;
    metadata?: {
        age_years?: number;
        labs?: Record<string, number>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface InferenceModelDescriptor {
    name: string;
    version: string;
}

export interface RunInferenceOptions {
    inputSignature: InputSignature;
    model: InferenceModelDescriptor;
    tenantId: string;
    requestId: string;
    supabase: SupabaseClient;
    persist?: boolean;
    userId?: string | null;
    clinicId?: string | null;
    requestedCaseId?: string | null;
    sourceModule?: string | null;
    simulationId?: string | null;
    isSynthetic?: boolean;
    simulationAgentIndex?: number | null;
    simulationRequestIndex?: number | null;
    parentInferenceEventId?: string | null;
}

export interface RunInferenceResult {
    inference_event_id: string | null;
    clinical_case_id: string | null;
    data: {
        confidence_score: number;
        differentials: Differential[];
    };
    cire: CIRESignals;
    meta: {
        tenant_id: string;
        request_id: string;
    };
    output_payload: Record<string, unknown>;
    latency_ms: number;
}

interface ModelOutput {
    differentials: Differential[];
    primary_confidence: number;
}

export async function runInference(options: RunInferenceOptions): Promise<RunInferenceResult> {
    const startTime = Date.now();
    const clinicalOutput = runClinicalInferenceEngine(options.inputSignature);
    const engineDifferentials = mapClinicalDifferentials(clinicalOutput);
    const calibratedDifferentials = await applyLabelCalibration(
        options.supabase,
        options.tenantId,
        engineDifferentials,
    );
    const cire = computeCIRE(calibratedDifferentials);
    const confidenceScore = calibratedDifferentials[0]?.p
        ?? clampProbability(clinicalOutput.confidence);
    const outputPayload = buildOutputPayload(calibratedDifferentials, confidenceScore, cire, clinicalOutput);
    await attachVisionInferenceIfPresent(outputPayload, options);
    const latencyMs = Date.now() - startTime;
    const persistenceResult = options.persist === false
        ? null
        : await persistInferenceEvent(options.supabase, {
            tenantId: options.tenantId,
            requestId: options.requestId,
            userId: options.userId ?? null,
            clinicId: options.clinicId ?? null,
            requestedCaseId: options.requestedCaseId ?? null,
            model: options.model,
            inputSignature: options.inputSignature,
            differentials: calibratedDifferentials,
            confidenceScore,
            cire,
            latencyMs,
            outputPayload,
            sourceModule: options.sourceModule,
            simulationId: options.simulationId,
            isSynthetic: options.isSynthetic,
            simulationAgentIndex: options.simulationAgentIndex,
            simulationRequestIndex: options.simulationRequestIndex,
            parentInferenceEventId: options.parentInferenceEventId,
        });

    return {
        inference_event_id: persistenceResult?.inferenceEventId ?? null,
        clinical_case_id: persistenceResult?.clinicalCaseId ?? null,
        data: {
            confidence_score: confidenceScore,
            differentials: calibratedDifferentials,
        },
        cire,
        meta: {
            tenant_id: options.tenantId,
            request_id: options.requestId,
        },
        output_payload: outputPayload,
        latency_ms: latencyMs,
    };
}

async function attachVisionInferenceIfPresent(
    outputPayload: Record<string, unknown>,
    options: RunInferenceOptions,
): Promise<void> {
    const imageCount = countDiagnosticImages(options.inputSignature);
    if (imageCount === 0) {
        return;
    }

    const model = resolveVisionModel(options.model);
    try {
        const result = await runAiProviderInference({
            model,
            input_signature: buildVisionInputSignature(options.inputSignature),
        });
        outputPayload.vision_inference = {
            status: 'completed',
            model,
            image_count: imageCount,
            output_payload: result.output_payload,
            confidence_score: result.confidence_score,
            uncertainty_metrics: result.uncertainty_metrics,
            contradiction_analysis: result.contradiction_analysis,
            ensemble_metadata: result.ensemble_metadata ?? null,
        };
    } catch (error) {
        outputPayload.vision_inference = {
            status: 'failed',
            model,
            image_count: imageCount,
            error: error instanceof Error ? error.message : 'Vision provider failed.',
        };
    }
}

function buildVisionInputSignature(inputSignature: InputSignature): Record<string, unknown> {
    const metadata = asRecord(inputSignature.metadata);
    return {
        ...inputSignature,
        raw_consultation: [
            buildDiagnosticPrompt(inputSignature),
            '',
            'Interpret the attached diagnostic image(s) as clinical evidence. Return JSON and include visual findings, image quality limitations, and how the image changes the differential diagnosis.',
        ].join('\n'),
        query_type: 'clinical',
        metadata: {
            ...metadata,
            model_family: 'vision',
            route_hint: 'image_diagnostic_review',
        },
    };
}

function countDiagnosticImages(inputSignature: InputSignature): number {
    const images = Array.isArray(inputSignature.diagnostic_images)
        ? inputSignature.diagnostic_images
        : [];
    return images.filter((entry) => {
        const record = asRecord(entry);
        const mimeType = readText(record.mime_type) ?? '';
        const contentBase64 = readText(record.content_base64);
        return Boolean(contentBase64 && mimeType.startsWith('image/'));
    }).length;
}

function resolveVisionModel(model: InferenceModelDescriptor): string {
    const configured = readText(process.env.AI_PROVIDER_VISION_MODEL)
        ?? readText(process.env.OPENAI_VISION_MODEL);
    if (configured) return configured;

    const requested = readText(model.version) ?? readText(model.name);
    if (requested && (requested.startsWith('gpt-4o') || requested.toLowerCase().includes('vision'))) {
        return requested;
    }

    return 'gpt-4o';
}

export function buildDiagnosticPrompt(inputSignature: InputSignature): string {
    const metadata = asRecord(inputSignature.metadata);
    const labs = asRecord(metadata.labs);
    const ageYears = readNumber(metadata.age_years);

    return [
        'You are a veterinary diagnostic AI. Given the clinical input below, return ONLY a JSON object with this exact shape:',
        '{ "differentials": [{ "label": string, "p": number }], "primary_confidence": number }',
        'Rules: labels are snake_case, probabilities sum to <=1, return at most 5 differentials, ordered by descending p.',
        '',
        `Species: ${inputSignature.species}`,
        `Breed: ${readText(inputSignature.breed) ?? 'unknown'}`,
        `Symptoms: ${inputSignature.symptoms.join(', ')}`,
        `Labs: ${Object.keys(labs).length > 0 ? JSON.stringify(labs) : 'none'}`,
        `Age: ${ageYears ?? 'unknown'} years`,
    ].join('\n');
}

export function parseModelOutput(modelOutputText: string): ModelOutput {
    const parsed = parseJsonObject(modelOutputText);
    if (!isRecord(parsed) || !Array.isArray(parsed.differentials)) {
        throw new Error('unparseable output');
    }

    const differentials = parsed.differentials
        .map((entry) => normalizeDifferential(entry))
        .filter((entry): entry is Differential => entry != null)
        .sort((left, right) => right.p - left.p)
        .slice(0, 5);

    if (differentials.length === 0) {
        throw new Error('unparseable output');
    }

    const primaryConfidence = clampProbability(readNumber(parsed.primary_confidence) ?? differentials[0].p);

    return {
        differentials,
        primary_confidence: primaryConfidence,
    };
}

async function applyLabelCalibration(
    supabase: SupabaseClient,
    tenantId: string,
    differentials: Differential[],
): Promise<Differential[]> {
    const labels = differentials.map((entry) => entry.label);
    if (labels.length === 0) return differentials;

    const { data, error } = await supabase
        .from('label_calibration')
        .select('label, mean_delta')
        .eq('tenant_id', tenantId)
        .in('label', labels);

    if (error) {
        if (!isMissingColumnError(error.message)) {
            console.warn('Label calibration lookup failed; continuing without calibration.', error);
            return differentials;
        }

        return applyOutcomePayloadCalibration(supabase, tenantId, differentials);
    }

    const calibrationMap = Object.fromEntries(
        (data ?? []).map((entry) => [
            String((entry as Record<string, unknown>).label),
            readNumber((entry as Record<string, unknown>).mean_delta) ?? 0,
        ]),
    );

    return renormalizeDifferentials(differentials
        .map((entry) => ({
            ...entry,
            p: clampProbability(entry.p + clampCalibrationDelta(calibrationMap[entry.label] ?? 0)),
        }))
        .sort((left, right) => right.p - left.p));
}

async function persistInferenceEvent(
    supabase: SupabaseClient,
    input: {
        tenantId: string;
        requestId: string;
        userId?: string | null;
        clinicId?: string | null;
        requestedCaseId?: string | null;
        model: InferenceModelDescriptor;
        inputSignature: InputSignature;
        differentials: Differential[];
        confidenceScore: number;
        cire: CIRESignals;
        latencyMs: number;
        outputPayload: Record<string, unknown>;
        sourceModule?: string | null;
        simulationId?: string | null;
        isSynthetic?: boolean;
        simulationAgentIndex?: number | null;
        simulationRequestIndex?: number | null;
        parentInferenceEventId?: string | null;
    },
): Promise<{ inferenceEventId: string; clinicalCaseId: string | null }> {
    const observedAt = new Date().toISOString();
    const metadata = asRecord(input.inputSignature.metadata);
    const simulationId = input.simulationId ?? readText(metadata.simulation_id);
    const sourceModule = input.sourceModule ?? (simulationId ? 'simulation_api' : 'clinical_api');
    const caseStore = createSupabaseClinicalCaseStore(supabase);
    const clinicalCase = await ensureCanonicalClinicalCase(caseStore, {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        clinicId: input.clinicId ?? null,
        requestedCaseId: resolveRequestedCaseId(input.inputSignature, input.requestedCaseId),
        sourceModule,
        inputSignature: input.inputSignature,
        observedAt,
    });
    const enrichedOutputPayload: Record<string, unknown> = {
        ...input.outputPayload,
        calibration: {
            adjusted: true,
            source: 'vetios_inference',
        },
    };
    const uncertaintyMetrics = {
        cps: input.cire.cps,
        safety_state: input.cire.safety_state,
        phi_hat: input.cire.phi_hat,
        cire: input.cire,
        differentials: input.differentials,
    };

    const isSynthetic = input.isSynthetic ?? (metadata.is_synthetic === true || Boolean(simulationId));
    const topDiagnosis = input.differentials[0]?.label ?? null;
    const contradiction = asRecord(enrichedOutputPayload.contradiction_analysis);
    const contradictionScore = readNumber(enrichedOutputPayload.contradiction_score)
        ?? readNumber(contradiction.contradiction_score);

    const payload: Record<string, unknown> = {
        tenant_id: input.tenantId,
        request_id: input.requestId,
        user_id: input.userId ?? null,
        clinic_id: input.clinicId ?? null,
        case_id: clinicalCase.id,
        input_signature: input.inputSignature,
        model_name: input.model.name,
        model_version: input.model.version,
        confidence_score: input.confidenceScore,
        inference_latency_ms: input.latencyMs,
        output_payload: enrichedOutputPayload,
        uncertainty_metrics: uncertaintyMetrics,
        source_module: sourceModule,
        species: readText(input.inputSignature.species),
        top_diagnosis: topDiagnosis,
        contradiction_score: contradictionScore,
        region: readText(input.inputSignature.region) ?? readText(metadata.region) ?? readText(metadata.region_code),
        parent_inference_event_id: input.parentInferenceEventId ?? readText(metadata.parent_inference_event_id),
    };

    if (simulationId) {
        payload.simulation_id = simulationId;
        payload.is_synthetic = isSynthetic;
        payload.simulation_agent_index = input.simulationAgentIndex ?? readNumber(metadata.simulation_agent_index);
        payload.simulation_request_index = input.simulationRequestIndex
            ?? readNumber(metadata.simulation_request_index)
            ?? readNumber(metadata.simulation_step);
    }

    const inferenceEventId = await insertInferenceEvent(supabase, payload, {
        requireSimulationProvenance: Boolean(simulationId),
    });

    await finalizeClinicalCaseAfterInference(caseStore, clinicalCase, inferenceEventId, {
        observedAt,
        userId: input.userId ?? null,
        sourceModule,
        outputPayload: enrichedOutputPayload,
        confidenceScore: input.confidenceScore,
        modelVersion: input.model.version,
        syncMode: 'live',
    });

    return { inferenceEventId, clinicalCaseId: clinicalCase.id };
}

function resolveRequestedCaseId(inputSignature: InputSignature, explicitCaseId?: string | null): string | null {
    const metadata = asRecord(inputSignature.metadata);
    return readText(explicitCaseId)
        ?? readText(inputSignature.case_id)
        ?? readText(inputSignature.clinical_case_id)
        ?? readText(metadata.case_id)
        ?? readText(metadata.clinical_case_id)
        ?? readText(metadata.source_case_reference);
}

const OPTIONAL_INFERENCE_COLUMNS = [
    'source_module',
    'species',
    'top_diagnosis',
    'contradiction_score',
    'region',
    'parent_inference_event_id',
    'simulation_id',
    'is_synthetic',
    'simulation_agent_index',
    'simulation_request_index',
] as const;

async function insertInferenceEvent(
    supabase: SupabaseClient,
    payload: Record<string, unknown>,
    options: { requireSimulationProvenance: boolean },
): Promise<string> {
    const requiredSimulationColumns = new Set(options.requireSimulationProvenance
        ? ['simulation_id', 'is_synthetic']
        : []);
    const optionalColumns = new Set<string>(OPTIONAL_INFERENCE_COLUMNS);
    let nextPayload = { ...payload };

    for (;;) {
        const { data, error } = await supabase
            .from('ai_inference_events')
            .insert(nextPayload)
            .select('id')
            .single();

        if (!error && data?.id) {
            return String(data.id);
        }

        if (!error) {
            throw new SupabaseWriteError(
                'Failed to persist inference event: Unknown error',
                'ai_inference_event_insert_failed',
                error,
            );
        }

        const missingColumn = resolveMissingColumn(error.message ?? '', nextPayload, optionalColumns);
        if (!missingColumn) {
            throw new SupabaseWriteError(
                `Failed to persist inference event: ${error.message}`,
                readErrorCode(error, 'ai_inference_event_insert_failed'),
                error,
            );
        }

        if (requiredSimulationColumns.has(missingColumn)) {
            throw new Error(
                `Failed to persist simulation provenance: ai_inference_events.${missingColumn} is missing. Apply the simulation closed-loop migration before running synthetic inference.`,
            );
        }

        nextPayload = { ...nextPayload };
        delete nextPayload[missingColumn];
    }
}

function resolveMissingColumn(
    message: string,
    payload: Record<string, unknown>,
    optionalColumns: Set<string>,
) {
    if (!isMissingColumnError(message)) return null;
    for (const column of Object.keys(payload)) {
        if (!optionalColumns.has(column)) continue;
        if (
            message.includes(`'${column}' column`) ||
            message.includes(`column ai_inference_events.${column}`) ||
            message.includes(`column public.ai_inference_events.${column}`) ||
            message.includes(`'${column}'`)
        ) {
            return column;
        }
    }
    return null;
}

function buildOutputPayload(
    differentials: Differential[],
    confidenceScore: number,
    cire: CIRESignals,
    clinicalOutput?: ClinicalInferenceEngineResult,
): Record<string, unknown> {
    const topDifferentials = clinicalOutput?.diagnosis.top_differentials ?? differentials.map((entry, index) => ({
        rank: index + 1,
        condition: entry.label,
        name: entry.label,
        probability: entry.p,
        confidence: entry.p >= 0.75 ? 'high' : entry.p >= 0.3 ? 'moderate' : 'low',
        determination_basis: 'symptom_scoring',
        supporting_evidence: [],
        contradicting_evidence: [],
        clinical_urgency: 'routine',
    }));

    return {
        differentials,
        primary_confidence: confidenceScore,
        confidence_score: confidenceScore,
        cire,
        inference_engine: 'clinical_deterministic_multisystem_v1',
        clinical_output: clinicalOutput ?? null,
        inference_explanation: clinicalOutput?.inference_explanation ?? null,
        ground_truth_summary: clinicalOutput?.ground_truth_summary ?? null,
        treatment_plans: clinicalOutput?.treatment_plans ?? {},
        diagnosis_feature_importance: clinicalOutput?.diagnosis_feature_importance ?? clinicalOutput?.feature_importance ?? {},
        feature_importance: clinicalOutput?.feature_importance ?? {},
        contradiction_analysis: clinicalOutput?.contradiction_analysis ?? null,
        contradiction_score: clinicalOutput?.contradiction_score ?? 0,
        abstain_recommendation: clinicalOutput?.abstain_recommendation ?? false,
        abstain_reason: clinicalOutput?.abstain_reason ?? null,
        competitive_differential: clinicalOutput?.competitive_differential ?? false,
        urgent_confirmatory_testing: clinicalOutput?.urgent_confirmatory_testing ?? false,
        uncertainty_notes: clinicalOutput?.uncertainty_notes ?? [],
        differential_spread: clinicalOutput?.differential_spread ?? null,
        multisystem_assessment: clinicalOutput ? buildMultisystemAssessment(clinicalOutput) : null,
        diagnosis: {
            ...(clinicalOutput?.diagnosis ?? {}),
            confidence_score: confidenceScore,
            top_differentials: topDifferentials,
        },
        risk_assessment: {
            severity_score: clinicalOutput?.differentials.some((entry) => entry.clinical_urgency === 'urgent' || entry.clinical_urgency === 'immediate')
                ? 0.82
                : clinicalOutput?.competitive_differential || clinicalOutput?.urgent_confirmatory_testing
                    ? 0.62
                    : 0.35,
            emergency_level: clinicalOutput?.differentials.some((entry) => entry.clinical_urgency === 'immediate')
                ? 'CRITICAL'
                : clinicalOutput?.differentials.some((entry) => entry.clinical_urgency === 'urgent')
                    ? 'HIGH'
                    : clinicalOutput?.competitive_differential || clinicalOutput?.urgent_confirmatory_testing
                        ? 'REVIEW'
                        : 'ROUTINE',
        },
    };
}

async function applyOutcomePayloadCalibration(
    supabase: SupabaseClient,
    tenantId: string,
    differentials: Differential[],
): Promise<Differential[]> {
    const { data, error } = await supabase
        .from('clinical_outcome_events')
        .select('outcome_payload')
        .eq('tenant_id', tenantId)
        .limit(500);

    if (error) {
        console.warn('Outcome payload calibration lookup failed; continuing without calibration.', error);
        return differentials;
    }

    const stats = new Map<string, { total: number; count: number }>();
    for (const row of data ?? []) {
        const payload = asRecord((row as Record<string, unknown>).outcome_payload);
        const label = readText(payload.label);
        const calibrationDelta = readNumber(payload.calibration_delta);
        if (!label || calibrationDelta == null) continue;

        const entry = stats.get(label) ?? { total: 0, count: 0 };
        entry.total += calibrationDelta;
        entry.count += 1;
        stats.set(label, entry);
    }

    return renormalizeDifferentials(differentials
        .map((entry) => {
            const stat = stats.get(entry.label);
            const meanDelta = stat && stat.count > 0 ? stat.total / stat.count : 0;
            return {
                ...entry,
                p: clampProbability(entry.p + clampCalibrationDelta(meanDelta)),
            };
        })
        .sort((left, right) => right.p - left.p));
}

function normalizeDifferential(value: unknown): Differential | null {
    if (!isRecord(value)) return null;

    const label = readText(value.label);
    const probability = readNumber(value.p);
    if (!label || probability == null) return null;

    return {
        label,
        p: clampProbability(probability),
    };
}

function parseJsonObject(value: string): unknown {
    const trimmed = value.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');

    try {
        return JSON.parse(trimmed);
    } catch {
        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace < 0 || lastBrace <= firstBrace) {
            throw new Error('unparseable output');
        }
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
}

function clampProbability(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}

function clampCalibrationDelta(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-0.08, Math.min(0.08, value));
}

function renormalizeDifferentials(entries: Differential[]): Differential[] {
    const positive = entries.filter((entry) => entry.p > 0);
    const total = positive.reduce((sum, entry) => sum + entry.p, 0);
    if (total <= 0) return positive;
    return positive
        .map((entry) => ({
            ...entry,
            p: clampProbability(entry.p / total),
        }))
        .sort((left, right) => right.p - left.p)
        .slice(0, 8);
}

function mapClinicalDifferentials(output: ClinicalInferenceEngineResult): Differential[] {
    return renormalizeDifferentials(output.differentials.map((entry) => ({
        label: entry.condition,
        p: clampProbability(entry.probability),
    })));
}

function buildMultisystemAssessment(output: ClinicalInferenceEngineResult) {
    const clusterEntries = Object.entries(output.cluster_scores ?? {})
        .filter(([, score]) => typeof score === 'number' && Number.isFinite(score))
        .sort((left, right) => Number(right[1]) - Number(left[1]));
    const dominant = clusterEntries[0]?.[0] ?? 'unknown';

    return {
        dominant_system: dominant,
        active_systems: clusterEntries
            .filter(([, score]) => Number(score) > 0)
            .map(([system]) => system),
        system_scores: Object.fromEntries(clusterEntries.map(([system, score]) => [system, Number(Number(score).toFixed(3))])),
        species_gate: output.species_gate,
        airway_level: output.airway_level,
        condition_class_probabilities: output.diagnosis.condition_class_probabilities,
        uncertainty_notes: output.uncertainty_notes,
        interpretation: buildMultisystemInterpretation(dominant, output),
    };
}

function buildMultisystemInterpretation(
    dominant: string,
    output: ClinicalInferenceEngineResult,
): string {
    if (output.abstain_recommendation) {
        return 'Clinical contradictions require manual review before committing to a primary diagnosis.';
    }
    if (output.competitive_differential || output.urgent_confirmatory_testing) {
        return 'Multiple plausible systems remain active; confirmatory diagnostics should resolve the top competing branches.';
    }
    if (dominant === 'unknown') {
        return 'No dominant system could be established from the captured signals.';
    }
    return `${dominant.replace(/_/g, ' ')} signals dominate the current inference while lower-supported systems are retained as monitored alternatives.`;
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingColumnError(message: string): boolean {
    return message.includes('schema cache')
        || message.includes('column')
        || message.includes('Could not find the');
}
