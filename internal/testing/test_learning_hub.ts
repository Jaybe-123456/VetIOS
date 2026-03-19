/**
 * Test Script for the Outcome Learning Hub
 * 
 * Simulates:
 * 1. An original inference event dropping.
 * 2. The clinician attaching a ground-truth "expert" outcome a day later.
 * 3. Validating the full 5-stage learning pipeline execution.
 */

import { routeReinforcement } from '../../apps/web/lib/learning/reinforcementRouter';
import { logModelImprovementAudit } from '../../apps/web/lib/learning/modelImprover';
import { generateClusterSignature } from '../../apps/web/lib/learning/errorClustering';

async function simulateOutcomeInjection() {
    console.log("=== VETIOS OUTCOME LEARNING HUB TEST ===");

    // Scenario: Dog comes in with GDV. 
    // Model predicts Infectious (Parvo) with 85% confidence. High error!
    
    // 1. The Expert Outcome
    const outcomePayload = {
        primary_condition_class: 'Mechanical',
        diagnosis: 'gdv',
        severity_score: 0.95,
        emergency_level: 'CRITICAL',
        label_type: 'expert'
    };

    // 2. The Original Inference
    const originalPrediction = {
        primary_condition_class: 'Infectious',
        diagnosis: 'parvovirus',
        severity_score: 0.4,
        confidence_score: 0.85,
        had_contradictions: true,
        features: { "lethargy": 0.5, "vomiting": 0.8 }
    };

    console.log("\n[1] Error Clustering:");
    const signature = generateClusterSignature(
        originalPrediction.primary_condition_class,
        outcomePayload.primary_condition_class,
        outcomePayload.severity_score - originalPrediction.severity_score,
        originalPrediction.had_contradictions
    );
    console.log(` -> Signature generated: "${signature}"`);

    console.log("\n[2] Reinforcement Router:");
    const calibrationError = Math.abs(originalPrediction.confidence_score - 0.0); // 0.85 error
    
    // We mock the DB client here just to observe the routing logic
    const mockClient = { from: () => ({ insert: async (data: any) => { 
        console.log(" -> Routing reinforcement payload:", JSON.stringify(data, null, 2));
        return { error: null };
    }})} as any;

    const reinforcementResult = await routeReinforcement(mockClient, {
        tenant_id: 'test-tenant',
        inference_event_id: 'inf-1234',
        label_type: outcomePayload.label_type,
        predicted_diagnosis: originalPrediction.diagnosis,
        predicted_class: originalPrediction.primary_condition_class,
        actual_diagnosis: outcomePayload.diagnosis,
        actual_class: outcomePayload.primary_condition_class,
        predicted_severity: originalPrediction.severity_score,
        actual_severity: outcomePayload.severity_score,
        calibration_error: calibrationError,
        extracted_features: originalPrediction.features
    });

    console.log(` -> Lanes Triggered: Diag: ${reinforcementResult.diagnostic_updates_applied}, Sev: ${reinforcementResult.severity_updates_applied}, Cal: ${reinforcementResult.calibration_updates_applied}`);

    console.log("\n[3] Model Improvement Audit (Before vs After):");
    const mockAuditClient = { from: () => ({ insert: async (data: any) => { 
        console.log(" -> Audit tracked: Improvement Delta:", data.improvement_delta);
        return { data: { id: 'audit-1' }, error: null };
    }})} as any;

    await logModelImprovementAudit(mockAuditClient, {
        tenant_id: 'test-tenant',
        inference_event_id: 'inf-1234',
        pre_update_prediction: originalPrediction,
        pre_confidence: originalPrediction.confidence_score,
        reinforcement_applied: true,
        actual_correctness: 0, 
        calibration_improvement: calibrationError
    });

    console.log("\n=== TEST COMPLETE ===");
}

simulateOutcomeInjection();
