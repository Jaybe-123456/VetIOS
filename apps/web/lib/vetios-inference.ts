import type { SupabaseClient } from '@supabase/supabase-js';
import { computeCIRE, type CIRESignals, type Differential } from '@/lib/cire';
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
}

export interface RunInferenceResult {
    inference_event_id: string | null;
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
    const latencyMs = Date.now() - startTime;
    const outputPayload = buildOutputPayload(calibratedDifferentials, confidenceScore, cire, clinicalOutput);
    const inferenceEventId = options.persist === false
        ? null
        : await persistInferenceEvent(options.supabase, {
            tenantId: options.tenantId,
            model: options.model,
            inputSignature: options.inputSignature,
            differentials: calibratedDifferentials,
            confidenceScore,
            cire,
            latencyMs,
            outputPayload,
        });

    return {
        inference_event_id: inferenceEventId,
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
        model: InferenceModelDescriptor;
        inputSignature: InputSignature;
        differentials: Differential[];
        confidenceScore: number;
        cire: CIRESignals;
        latencyMs: number;
        outputPayload: Record<string, unknown>;
    },
): Promise<string> {
    const enrichedOutputPayload = {
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

    const { data, error } = await supabase
        .from('ai_inference_events')
        .insert({
            tenant_id: input.tenantId,
            input_signature: input.inputSignature,
            model_name: input.model.name,
            model_version: input.model.version,
            confidence_score: input.confidenceScore,
            inference_latency_ms: input.latencyMs,
            output_payload: enrichedOutputPayload,
            uncertainty_metrics: uncertaintyMetrics,
        })
        .select('id')
        .single();

    if (error && !isMissingColumnError(error.message)) {
        throw new Error(`Failed to persist inference event: ${error.message}`);
    }

    if (!error && data?.id) {
        return String(data.id);
    }

    const fallbackInsert = await supabase
        .from('ai_inference_events')
        .insert({
            tenant_id: input.tenantId,
            input_signature: input.inputSignature,
            model_name: input.model.name,
            model_version: input.model.version,
            confidence_score: input.confidenceScore,
            inference_latency_ms: input.latencyMs,
            output_payload: enrichedOutputPayload,
            uncertainty_metrics: uncertaintyMetrics,
        })
        .select('id')
        .single();

    if (fallbackInsert.error || !fallbackInsert.data?.id) {
        throw new Error(`Failed to persist inference event: ${fallbackInsert.error?.message ?? 'Unknown error'}`);
    }

    return String(fallbackInsert.data.id);
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
