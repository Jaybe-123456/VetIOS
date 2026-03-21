import { normalizeInferenceInput } from '@/lib/input/inputNormalizer';
import type { InputMode } from '@/lib/input/inputNormalizer';
import { extractClinicalSignals } from '@/lib/ai/clinicalSignals';
import { runInference } from '@/lib/ai/provider';
import { applyDiagnosticSafetyLayer, buildSeverityFeatureImportance } from '@/lib/ai/diagnosticSafety';
import { evaluateEmergencyRules } from '@/lib/ai/emergencyRules';
import { mlPredict } from '@/lib/ml/mlClient';

export interface OrchestratorParams {
    model: string;
    rawInput: string | Record<string, unknown>;
    inputMode: InputMode;
}

export async function runInferencePipeline({ model, rawInput, inputMode }: OrchestratorParams) {
    const pipelineTrace: Array<{ stage: string; status: 'completed'; detail?: string }> = [];
    let normalizedSig: Record<string, unknown>;

    if (typeof rawInput === 'string') {
        normalizedSig = normalizeInferenceInput(rawInput, inputMode) as unknown as Record<string, unknown>;
    } else if (rawInput.input_signature && typeof rawInput.input_signature === 'object') {
        normalizedSig = rawInput.input_signature as Record<string, unknown>;
    } else {
        normalizedSig = rawInput;
    }
    pipelineTrace.push({ stage: 'input_normalization', status: 'completed' });

    const inferenceResult = await runInference({
        model,
        input_signature: normalizedSig,
    });
    pipelineTrace.push({ stage: 'provider_inference', status: 'completed' });

    const payload = inferenceResult.output_payload;
    const contradiction = inferenceResult.contradiction_analysis;

    if (!payload.diagnosis || typeof payload.diagnosis !== 'object') {
        payload.diagnosis = {
            primary_condition_class: 'Idiopathic / Unknown',
            condition_class_probabilities: {},
            top_differentials: [],
            confidence_score: inferenceResult.confidence_score ?? 0.45,
            analysis: 'Deterministic diagnostic safety layer supplied the differential because provider output was incomplete.',
        };
    }
    if (!payload.risk_assessment || typeof payload.risk_assessment !== 'object') {
        payload.risk_assessment = {
            severity_score: 0.5,
            emergency_level: 'MODERATE',
        };
    }

    const diagnosis = payload.diagnosis as Record<string, unknown>;
    const risk = payload.risk_assessment as Record<string, unknown>;

    const species = typeof normalizedSig.species === 'string' ? normalizedSig.species : 'canine';
    const mlRisk = await mlPredict({
        decision_count: 1,
        override_count: 0,
        species,
    });

    if (!('_fallback' in mlRisk)) {
        const currentSeverity = typeof risk.severity_score === 'number' ? risk.severity_score : 0.5;
        risk.severity_score = (currentSeverity * 0.7) + (mlRisk.risk_score * 0.3);
    }

    const emergencyEval = evaluateEmergencyRules(normalizedSig);
    if (emergencyEval.emergency_rule_triggered) {
        const currentSeverity = typeof risk.severity_score === 'number' ? risk.severity_score : 0.5;
        risk.severity_score = Math.min(1.0, currentSeverity + emergencyEval.severity_boost);
        risk.emergency_level = elevateEmergencyLevel(String(risk.emergency_level), emergencyEval.emergency_level);
    }
    pipelineTrace.push({ stage: 'severity_computation', status: 'completed' });

    const safetyLayer = applyDiagnosticSafetyLayer({
        inputSignature: normalizedSig,
        diagnosis,
        contradiction,
        emergencyEval,
        modelVersion: model,
        existingDiagnosisFeatureImportance: payload.diagnosis_feature_importance as Record<string, unknown> | null,
        existingUncertaintyNotes: payload.uncertainty_notes,
    });
    pipelineTrace.push({ stage: 'contradiction_scoring', status: 'completed' });

    payload.diagnosis = safetyLayer.diagnosis;
    payload.diagnosis_feature_importance = safetyLayer.diagnosis_feature_importance;
    payload.severity_feature_importance =
        payload.severity_feature_importance && typeof payload.severity_feature_importance === 'object'
            ? payload.severity_feature_importance
            : buildSeverityFeatureImportance(extractClinicalSignals(normalizedSig));
    payload.uncertainty_notes = safetyLayer.uncertainty_notes;
    payload.contradiction_score = contradiction?.contradiction_score ?? 0;
    payload.contradiction_reasons = contradiction?.contradiction_reasons ?? [];
    payload.confidence_cap = safetyLayer.confidence_cap;
    payload.was_capped = safetyLayer.was_capped;
    payload.abstain_recommendation = safetyLayer.abstain_recommendation;
    payload.abstain_reason = safetyLayer.abstain_reason ?? null;
    payload.rule_overrides = safetyLayer.rule_overrides;
    payload.differential_spread = safetyLayer.differential_spread;
    payload.telemetry = safetyLayer.telemetry;
    payload.contradiction_analysis = {
        contradiction_score: contradiction?.contradiction_score ?? 0,
        contradiction_reasons: contradiction?.contradiction_reasons ?? [],
        is_plausible: contradiction?.is_plausible ?? true,
        confidence_cap: safetyLayer.confidence_cap,
        confidence_was_capped: safetyLayer.was_capped,
        original_confidence: contradiction?.original_confidence ?? inferenceResult.confidence_score ?? null,
        abstain: safetyLayer.abstain_recommendation,
    };
    const finalDiagnosis = payload.diagnosis as Record<string, unknown>;
    finalDiagnosis.primary_condition_class = resolveConditionClass(finalDiagnosis);
    risk.severity_score = resolveSeverityScore(risk);
    risk.emergency_level = resolveEmergencyLevel(risk);
    payload.pipeline_trace = [
        ...pipelineTrace,
        { stage: 'condition_classification', status: 'completed', detail: String(finalDiagnosis.primary_condition_class ?? 'Undifferentiated') },
        { stage: 'dataset_writeback_ready', status: 'completed' },
    ];
    (payload.telemetry as Record<string, unknown>).pipeline_stage_completion = payload.pipeline_trace;

    const finalConfidence = typeof finalDiagnosis.confidence_score === 'number' ? finalDiagnosis.confidence_score : null;

    const uncertaintyMetrics = {
        ...(inferenceResult.uncertainty_metrics ?? {}),
        contradiction_score: contradiction?.contradiction_score ?? 0,
        contradiction_triggers: contradiction?.contradiction_reasons ?? [],
        pre_cap_confidence: safetyLayer.telemetry.pre_cap_confidence ?? null,
        post_cap_confidence: safetyLayer.telemetry.post_cap_confidence ?? null,
        persistence_rule_triggers: safetyLayer.telemetry.persistence_rule_triggers ?? [],
        pipeline_stages: payload.pipeline_trace,
    };

    return {
        normalizedInput: normalizedSig,
        output_payload: payload,
        confidence_score: finalConfidence,
        uncertainty_metrics: uncertaintyMetrics,
        contradiction_analysis: payload.contradiction_analysis,
        mlRisk,
    };
}

function elevateEmergencyLevel(currentRaw: string, target: string): string {
    const levels = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
    const current = currentRaw.toUpperCase();
    return levels.indexOf(target) > levels.indexOf(current) ? target : current;
}

function resolveConditionClass(diagnosis: Record<string, unknown>): string {
    const explicit = normalizeConditionClass(
        typeof diagnosis.primary_condition_class === 'string'
            ? diagnosis.primary_condition_class
            : typeof diagnosis.condition_class === 'string'
                ? diagnosis.condition_class
                : highestProbabilityClass(diagnosis.condition_class_probabilities),
    );
    if (explicit && explicit !== 'Undifferentiated') {
        return explicit;
    }

    return inferConditionClassFromDiagnosis(extractTopDiagnosis(diagnosis)) ?? explicit ?? 'Undifferentiated';
}

function resolveSeverityScore(risk: Record<string, unknown>): number {
    const explicit = typeof risk.severity_score === 'number'
        ? risk.severity_score
        : typeof risk.severity_score === 'string'
            ? Number(risk.severity_score)
            : null;
    if (typeof explicit === 'number' && Number.isFinite(explicit)) {
        return Math.max(0, Math.min(1, explicit));
    }

    return severityScoreFromEmergencyLevel(resolveEmergencyLevel(risk));
}

function resolveEmergencyLevel(risk: Record<string, unknown>): string {
    const explicit = typeof risk.emergency_level === 'string' ? risk.emergency_level.trim().toUpperCase() : null;
    if (explicit === 'CRITICAL' || explicit === 'HIGH' || explicit === 'MODERATE' || explicit === 'LOW') {
        return explicit;
    }

    const severity = typeof risk.severity_score === 'number'
        ? risk.severity_score
        : typeof risk.severity_score === 'string'
            ? Number(risk.severity_score)
            : null;

    if (typeof severity === 'number' && Number.isFinite(severity)) {
        return severity >= 0.85
            ? 'CRITICAL'
            : severity >= 0.6
                ? 'HIGH'
                : severity >= 0.3
                    ? 'MODERATE'
                    : 'LOW';
    }

    return 'MODERATE';
}

function severityScoreFromEmergencyLevel(level: string): number {
    if (level === 'CRITICAL') return 0.95;
    if (level === 'HIGH') return 0.72;
    if (level === 'LOW') return 0.2;
    return 0.42;
}

function extractTopDiagnosis(diagnosis: Record<string, unknown>): string | null {
    const topDifferentials = Array.isArray(diagnosis.top_differentials) ? diagnosis.top_differentials : [];
    const top = topDifferentials[0];
    if (typeof top === 'object' && top !== null) {
        const record = top as Record<string, unknown>;
        if (typeof record.name === 'string' && record.name.trim()) return record.name.trim();
        if (typeof record.diagnosis === 'string' && record.diagnosis.trim()) return record.diagnosis.trim();
    }

    if (typeof diagnosis.top_diagnosis === 'string' && diagnosis.top_diagnosis.trim()) return diagnosis.top_diagnosis.trim();
    if (typeof diagnosis.predicted_diagnosis === 'string' && diagnosis.predicted_diagnosis.trim()) return diagnosis.predicted_diagnosis.trim();
    return null;
}

function normalizeConditionClass(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    const lower = normalized.toLowerCase();
    if (lower === 'idiopathic / unknown' || lower === 'idiopathic' || lower === 'unknown') {
        return 'Undifferentiated';
    }
    return normalized;
}

function highestProbabilityClass(value: unknown): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    let winner: string | null = null;
    let best = Number.NEGATIVE_INFINITY;
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const score = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : null;
        if (score == null || !Number.isFinite(score) || score <= best) continue;
        winner = key;
        best = score;
    }
    return winner;
}

function inferConditionClassFromDiagnosis(value: string | null): string | null {
    const normalized = (value ?? '').toLowerCase();
    if (!normalized) return null;
    if (
        normalized.includes('gdv') ||
        normalized.includes('dilatation') ||
        normalized.includes('volvulus') ||
        normalized.includes('obstruction') ||
        normalized.includes('tracheal collapse')
    ) {
        return 'Mechanical';
    }
    if (
        normalized.includes('herpesvirus') ||
        normalized.includes('tracheobronchitis') ||
        normalized.includes('viral') ||
        normalized.includes('bacterial') ||
        normalized.includes('infection') ||
        normalized.includes('parvo') ||
        normalized.includes('distemper') ||
        normalized.includes('rhinotracheitis') ||
        normalized.includes('kennel cough')
    ) {
        return 'Infectious';
    }
    if (normalized.includes('bronchitis') || normalized.includes('pancreatitis')) {
        return 'Inflammatory';
    }
    if (normalized.includes('toxic')) {
        return 'Toxicology';
    }
    return null;
}
