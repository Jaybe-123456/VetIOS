import { computePerturbationScore } from '@/lib/integrity/perturbationScore';
import { estimateCapabilityPhis } from '@/lib/integrity/phiEstimators';
import {
    computeInstabilityMetrics,
    decorateCapabilitiesWithInstability,
    detectPreCliff,
} from '@/lib/integrity/instabilityDetector';
import { generateSafetyPolicy } from '@/lib/integrity/safetyPolicy';
import { classifyState, computeCollapseRisk } from '@/lib/integrity/stateClassifier';
import type {
    ClinicalIntegrityContext,
    ClinicalIntegrityEvaluation,
    ClinicalIntegrityInput,
} from '@/lib/integrity/types';

export function evaluateClinicalIntegrity(
    input: ClinicalIntegrityInput,
    context: ClinicalIntegrityContext = {},
): ClinicalIntegrityEvaluation {
    const perturbation = computePerturbationScore(
        input.inputSignature,
        input.contradictionAnalysis,
    );
    const baseCapabilities = estimateCapabilityPhis(input, perturbation);
    const globalPhi = roundMetric(
        baseCapabilities.length === 0
            ? 0
            : baseCapabilities.reduce((sum, capability) => sum + capability.phi, 0) / baseCapabilities.length,
    );
    const instability = computeInstabilityMetrics({
        input,
        perturbation,
        globalPhi,
        recentHistory: context.recentHistory,
    });
    const capabilities = decorateCapabilitiesWithInstability({
        input,
        perturbation,
        globalPhi,
        capabilities: baseCapabilities,
        instability,
        recentHistory: context.recentHistory,
    });
    const collapseRisk = computeCollapseRisk(globalPhi, perturbation.m, instability);
    const precliffDetected = detectPreCliff(instability, globalPhi);
    const state = classifyState({
        globalPhi,
        perturbationScoreM: perturbation.m,
        instability,
        collapseRisk,
        precliffDetected,
    });

    const integrity = {
        perturbation,
        global_phi: globalPhi,
        capabilities,
        instability,
        state,
        collapse_risk: collapseRisk,
        precliff_detected: precliffDetected,
    };

    return {
        integrity,
        safetyPolicy: generateSafetyPolicy(integrity, {
            inputSignature: input.inputSignature,
            outputPayload: input.outputPayload,
        }),
    };
}

function roundMetric(value: number) {
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
