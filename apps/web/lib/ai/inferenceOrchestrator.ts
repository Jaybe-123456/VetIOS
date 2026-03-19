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
    let normalizedSig: Record<string, unknown>;

    if (typeof rawInput === 'string') {
        normalizedSig = normalizeInferenceInput(rawInput, inputMode) as unknown as Record<string, unknown>;
    } else if (rawInput.input_signature && typeof rawInput.input_signature === 'object') {
        normalizedSig = rawInput.input_signature as Record<string, unknown>;
    } else {
        normalizedSig = rawInput;
    }

    const inferenceResult = await runInference({
        model,
        input_signature: normalizedSig,
    });

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

    const safetyLayer = applyDiagnosticSafetyLayer({
        inputSignature: normalizedSig,
        diagnosis,
        contradiction,
        emergencyEval,
        modelVersion: model,
        existingDiagnosisFeatureImportance: payload.diagnosis_feature_importance as Record<string, unknown> | null,
        existingUncertaintyNotes: payload.uncertainty_notes,
    });

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
    const finalConfidence = typeof finalDiagnosis.confidence_score === 'number' ? finalDiagnosis.confidence_score : null;

    const uncertaintyMetrics = {
        ...(inferenceResult.uncertainty_metrics ?? {}),
        contradiction_score: contradiction?.contradiction_score ?? 0,
        contradiction_triggers: contradiction?.contradiction_reasons ?? [],
        pre_cap_confidence: safetyLayer.telemetry.pre_cap_confidence ?? null,
        post_cap_confidence: safetyLayer.telemetry.post_cap_confidence ?? null,
        persistence_rule_triggers: safetyLayer.telemetry.persistence_rule_triggers ?? [],
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
