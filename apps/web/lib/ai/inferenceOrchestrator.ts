import { InputMode, normalizeInferenceInput } from '@/lib/input/inputNormalizer';
import { runInference } from '@/lib/ai/provider';
import { detectContradictions } from '@/lib/ai/contradictionDetector';
import { evaluateEmergencyRules } from '@/lib/ai/emergencyRules';
import { mlPredict } from '@/lib/ml/mlClient';

export interface OrchestratorParams {
    model: string;
    rawInput: string | Record<string, unknown>;
    inputMode: InputMode;
}

export async function runInferencePipeline({ model, rawInput, inputMode }: OrchestratorParams) {
    let normalizedSig: Record<string, unknown>;
    
    // 1. Normalize Input
    if (typeof rawInput === 'string') {
        normalizedSig = normalizeInferenceInput(rawInput, inputMode) as unknown as Record<string, unknown>;
    } else {
        // Assume already structured by the frontend (except checking inner shape)
        if (rawInput.input_signature) {
            normalizedSig = rawInput.input_signature as Record<string, unknown>;
        } else {
            normalizedSig = rawInput;
        }
    }

    // 2. Contradiction Engine (now ran explicitly for payload metrics, though also embedded in runInference,
    //    we rely on the provider's enriched output)

    // 3. AI Inference
    const inferenceResult = await runInference({
        model,
        input_signature: normalizedSig,
    });

    const payload = inferenceResult.output_payload;
    const contradiction = inferenceResult.contradiction_analysis;

    // Set up safe default blocks if AI flaked
    if (!payload.diagnosis || typeof payload.diagnosis !== 'object') {
        payload.diagnosis = {
            primary_condition_class: 'Idiopathic / Unknown',
            condition_class_probabilities: {},
            top_differentials: [],
            confidence_score: inferenceResult.confidence_score ?? 0,
            analysis: 'Parsing failure or model issue.'
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

    // 4. ML Severity Model (External)
    const species = typeof normalizedSig.species === 'string' ? normalizedSig.species : 'canine';
    const mlRisk = await mlPredict({
        decision_count: 1,
        override_count: 0, 
        species,
    });

    // 5. Emergency Rule Engine
    const emergencyEval = evaluateEmergencyRules(normalizedSig);

    // 6. Apply Overrides
    
    // Apply ML adjustments
    if (!('_fallback' in mlRisk)) {
        // Blend AI severity with ML risk score softly
        const currentSeverity = typeof risk.severity_score === 'number' ? risk.severity_score : 0.5;
        risk.severity_score = (currentSeverity * 0.7) + (mlRisk.risk_score * 0.3);
    }

    // Apply Emergency Overrides
    const ruleOverrides: string[] = [];
    if (emergencyEval.emergency_rule_triggered) {
        ruleOverrides.push(...emergencyEval.emergency_rule_reasons);
        
        // Boost severity
        const currentSeverity = typeof risk.severity_score === 'number' ? risk.severity_score : 0.5;
        risk.severity_score = Math.min(1.0, currentSeverity + emergencyEval.severity_boost);
        
        // Force emergency level
        const levels = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
        const currentLevel = String(risk.emergency_level).toUpperCase();
        let currentIdx = levels.indexOf(currentLevel);
        if (currentIdx === -1) currentIdx = 1;
        
        const targetIdx = levels.indexOf(emergencyEval.emergency_level);
        if (targetIdx > currentIdx) {
            risk.emergency_level = emergencyEval.emergency_level;
        }

        // Promote differentials
        const diffs = Array.isArray(diagnosis.top_differentials) ? diagnosis.top_differentials : [];
        for (const pd of emergencyEval.promoted_differentials) {
            // Check if already in diffs
            const exists = diffs.some((d: any) => typeof d.name === 'string' && d.name.toLowerCase().includes(pd.toLowerCase()));
            if (!exists) {
                diffs.unshift({ name: pd, probability: 0.85 }); // Insert at top
                diagnosis.top_differentials = diffs;
            } else {
                // Boost existing
                for (const d of diffs) {
                    if (typeof d.name === 'string' && d.name.toLowerCase().includes(pd.toLowerCase())) {
                        d.probability = Math.min(1.0, (typeof d.probability === 'number' ? d.probability : 0) + 0.3);
                    }
                }
            }
        }
    }

    payload.rule_overrides = ruleOverrides;
    
    // 7. Abstention & Global Output Mappings
    if (contradiction?.abstain) {
        payload.abstain_recommendation = true;
    } else {
        payload.abstain_recommendation = false;
    }
    
    // Ensure feature mappings are populated
    if (!payload.diagnosis_feature_importance) payload.diagnosis_feature_importance = {};
    if (!payload.severity_feature_importance) payload.severity_feature_importance = {};
    if (typeof payload.contradiction_score === 'undefined') {
        payload.contradiction_score = contradiction?.contradiction_score ?? 0;
    }

    return {
        normalizedInput: normalizedSig,
        output_payload: payload,
        confidence_score: diagnosis.confidence_score as number,
        uncertainty_metrics: inferenceResult.uncertainty_metrics,
        contradiction_analysis: contradiction,
        mlRisk
    };
}
