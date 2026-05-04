/**
 * VetIOS Tier 4 — Counterfactual Diagnostic Agent
 *
 * Specialist agent that runs after the diagnostic agent in
 * MultiAgentOrchestrator. Challenges findings, computes CPG scores,
 * returns stability verdict to synthesis.
 *
 * Connects to:
 *   lib/counterfactual/evidenceChallenger.ts  — CPG computation
 *   lib/multiAgent/multiAgentOrchestrator.ts  — AgentOutput
 *   lib/causal/causalEngine.ts                — risk-prioritised challenging
 *   lib/inference/types.ts                    — InferenceRequest
 */

import { getEvidenceChallenger } from '@/lib/counterfactual/evidenceChallenger';
import { getCausalEngine } from '@/lib/causal/causalEngine';
import type { AgentOutput, MultiAgentCaseInput } from '@/lib/multiAgent/multiAgentOrchestrator';
import type { InferenceRequest } from '@/lib/inference/types';
import type { ChallengerResult } from '@/lib/counterfactual/evidenceChallenger';

function buildInferenceRequest(input: MultiAgentCaseInput): InferenceRequest {
  return {
    species: input.species,
    breed: input.breed ?? undefined,
    age_years: input.ageYears ?? undefined,
    weight_kg: input.weightKg ?? undefined,
    region: input.region ?? undefined,
    presenting_signs: input.symptoms,
    symptom_vector: input.symptoms,
    diagnostic_tests: input.biomarkers
      ? { biochemistry: Object.fromEntries(Object.entries(input.biomarkers).map(([k, v]) => [k, v])) as import('@/lib/inference/types').BiochemistryPanel }
      : undefined,
  };
}

function buildRecommendedActions(result: ChallengerResult): string[] {
  const actions: string[] = [];

  if (result.stabilityVerdict === 'unstable') {
    actions.push(`Confirm "${result.topLoadBearingFinding}" — diagnosis depends on it`);
    actions.push('Run confirmatory tests before committing to treatment');
  } else if (result.stabilityVerdict === 'fragile') {
    actions.push(`Verify "${result.topLoadBearingFinding}" — high diagnostic sensitivity`);
    actions.push('Re-evaluate if this finding changes clinically');
  } else if (result.stabilityVerdict === 'stable') {
    actions.push('Diagnosis well-supported across multiple findings');
    actions.push('Proceed with treatment plan with confidence');
  }

  const criticalFindings = [...new Set(
    result.cpgScores.filter((s) => s.diagnosisDroppedOut).map((s) => s.finding)
  )].slice(0, 2);
  if (criticalFindings.length > 0) {
    actions.push(`Do not miss: ${criticalFindings.join(', ')}`);
  }

  return actions.slice(0, 4);
}

export async function runCounterfactualChallengerAgent(
  input: MultiAgentCaseInput,
  diagnosticPrimaryDiagnosis: string | null,
  sessionId: string,
  tenantId: string
): Promise<AgentOutput> {
  try {
    const request = buildInferenceRequest(input);

    let causalRiskNote = '';
    if (diagnosticPrimaryDiagnosis) {
      try {
        const ctx = await getCausalEngine().getCausalContext(diagnosticPrimaryDiagnosis, input.species);
        if (ctx.deteriorationRiskFactors.length > 0) {
          causalRiskNote = ` Causal risk factors: ${ctx.deteriorationRiskFactors.slice(0, 2).join(', ')}.`;
        }
      } catch { /* non-fatal */ }
    }

    const result = await getEvidenceChallenger().challenge({
      tenantId,
      caseId: input.caseId,
      inferenceEventId: null,
      multiAgentSessionId: sessionId,
      request,
      maxDiagnosesToChallenge: 3,
    });

    const requiresHITL = result.stabilityVerdict === 'unstable' || result.stabilityVerdict === 'fragile';
    const hitlReason = requiresHITL
      ? result.stabilityVerdict === 'unstable'
        ? `Diagnosis UNSTABLE — changes when "${result.topLoadBearingFinding}" is removed. Vet confirmation required.`
        : `Diagnosis FRAGILE — confidence drops >30% on key finding removal. Vet review recommended.`
      : undefined;

    return {
      specialty: 'counterfactual_challenger' as AgentOutput['specialty'],
      confidence: result.stabilityScore,
      summary: result.clinicalSummary + causalRiskNote,
      findings: {
        stabilityVerdict: result.stabilityVerdict,
        stabilityScore: result.stabilityScore,
        topLoadBearingFinding: result.topLoadBearingFinding,
        findingschallenged: result.findingschallenged,
        diagnosesTested: result.diagnosesTested,
        cpgScores: result.cpgScores.slice(0, 10),
        reasoningTrace: result.reasoningTrace,
        latencyMs: result.latencyMs,
      },
      requiresHITL,
      hitlReason,
      recommendedActions: buildRecommendedActions(result),
    };
  } catch (err) {
    return {
      specialty: 'counterfactual_challenger' as AgentOutput['specialty'],
      confidence: 0.5,
      summary: 'Counterfactual challenger error — stability unknown',
      findings: { error: String(err) },
      requiresHITL: false,
      recommendedActions: ['Manual review of diagnostic stability recommended'],
    };
  }
}
