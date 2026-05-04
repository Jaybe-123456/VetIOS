/**
 * VetIOS Tier 4 — Evidence Challenger
 *
 * Counterfactual Probability Gap (CPG) computation.
 * Removes clinical findings one at a time, reruns inference engine,
 * measures how much each finding supports each diagnosis.
 *
 * CPG(finding, diagnosis) = P(diagnosis | all) − P(diagnosis | all \ {finding})
 *
 * Connects to:
 *   apps/web/lib/inference/engine.ts   — runClinicalInferenceEngine() synchronous
 *   apps/web/lib/inference/types.ts    — InferenceRequest, DifferentialEntry
 *   counterfactual_diagnostic_sessions — persisted session records
 *   cpg_finding_scores                 — persisted CPG results
 */

import { runClinicalInferenceEngine } from '@/lib/inference/engine';
import type { InferenceRequest, DifferentialEntry } from '@/lib/inference/types';
import { getSupabaseServer } from '@/lib/supabaseServer';

export type FindingType =
  | 'presenting_sign'
  | 'diagnostic_test'
  | 'physical_exam'
  | 'history';

export type StabilityVerdict =
  | 'stable'
  | 'fragile'
  | 'unstable'
  | 'indeterminate';

export interface FindingCPGScore {
  finding: string;
  findingType: FindingType;
  diagnosis: string;
  diagnosisRankBaseline: number;
  probabilityBaseline: number;
  probabilityCounterfactual: number;
  cpg: number;
  rankAfterRemoval: number | null;
  rankDelta: number | null;
  diagnosisDroppedOut: boolean;
}

export interface ChallengerResult {
  sessionId: string;
  baselinePrimary: string;
  baselineConfidence: number;
  baselineDifferentials: DifferentialEntry[];
  findingschallenged: number;
  diagnosesTested: number;
  stabilityVerdict: StabilityVerdict;
  stabilityScore: number;
  topLoadBearingFinding: string | null;
  cpgScores: FindingCPGScore[];
  reasoningTrace: string[];
  latencyMs: number;
  clinicalSummary: string;
}

export interface ChallengerInput {
  tenantId: string;
  caseId: string;
  inferenceEventId: string | null;
  multiAgentSessionId: string;
  request: InferenceRequest;
  maxDiagnosesToChallenge?: number;
  minFindingsToChallenge?: number;
}

interface ChallengableFinding {
  finding: string;
  findingType: FindingType;
  remove: (req: InferenceRequest) => InferenceRequest;
}

function extractChallengableFindings(req: InferenceRequest): ChallengableFinding[] {
  const findings: ChallengableFinding[] = [];

  for (const sign of req.presenting_signs ?? []) {
    findings.push({
      finding: sign,
      findingType: 'presenting_sign',
      remove: (r) => ({
        ...r,
        presenting_signs: (r.presenting_signs ?? []).filter((s) => s !== sign),
        symptom_vector: (r.symptom_vector ?? []).filter((s) => s !== sign),
      }),
    });
  }

  const dt = req.diagnostic_tests;
  if (dt?.serology) {
    for (const key of Object.keys(dt.serology)) {
      findings.push({
        finding: `serology.${key}`,
        findingType: 'diagnostic_test',
        remove: (r) => ({
          ...r,
          diagnostic_tests: r.diagnostic_tests ? {
            ...r.diagnostic_tests,
            serology: Object.fromEntries(
              Object.entries(r.diagnostic_tests.serology ?? {}).filter(([k]) => k !== key)
            ),
          } : undefined,
        }),
      });
    }
  }

  if (dt?.biochemistry) {
    for (const key of Object.keys(dt.biochemistry)) {
      findings.push({
        finding: `biochemistry.${key}`,
        findingType: 'diagnostic_test',
        remove: (r) => ({
          ...r,
          diagnostic_tests: r.diagnostic_tests ? {
            ...r.diagnostic_tests,
            biochemistry: Object.fromEntries(
              Object.entries(r.diagnostic_tests.biochemistry ?? {}).filter(([k]) => k !== key)
            ),
          } : undefined,
        }),
      });
    }
  }

  if (req.physical_exam) {
    for (const key of Object.keys(req.physical_exam)) {
      findings.push({
        finding: `physical_exam.${key}`,
        findingType: 'physical_exam',
        remove: (r) => ({
          ...r,
          physical_exam: r.physical_exam
            ? Object.fromEntries(Object.entries(r.physical_exam).filter(([k]) => k !== key))
            : undefined,
        }),
      });
    }
  }

  return findings;
}

function getDifferentialMap(differentials: DifferentialEntry[]): Map<string, DifferentialEntry> {
  const map = new Map<string, DifferentialEntry>();
  for (const d of differentials) {
    const key = d.condition_id ?? d.condition ?? d.name ?? '';
    if (key) map.set(key, d);
  }
  return map;
}

function computeStability(
  baselinePrimary: string,
  cpgScores: FindingCPGScore[]
): { verdict: StabilityVerdict; score: number } {
  if (cpgScores.length === 0) return { verdict: 'indeterminate', score: 0.5 };

  const primaryDropped = cpgScores.some(
    (s) => s.diagnosis === baselinePrimary && s.diagnosisDroppedOut
  );
  if (primaryDropped) return { verdict: 'unstable', score: 0.15 };

  const primaryScores = cpgScores.filter((s) => s.diagnosis === baselinePrimary);
  const maxCpg = Math.max(...primaryScores.map((s) => Math.abs(s.cpg)), 0);
  if (maxCpg > 0.30) return { verdict: 'fragile', score: 0.45 };

  return { verdict: 'stable', score: Math.min(1 - maxCpg * 2, 1.0) };
}

function buildClinicalSummary(
  baselinePrimary: string,
  verdict: StabilityVerdict,
  stabilityScore: number,
  topLoadBearing: string | null,
  cpgScores: FindingCPGScore[],
  findingschallenged: number,
  diagnosesTested: number
): string {
  const labels: Record<StabilityVerdict, string> = {
    stable: 'STABLE — diagnosis is robust across all finding removals',
    fragile: 'FRAGILE — diagnosis is sensitive to one or more key findings',
    unstable: 'UNSTABLE — diagnosis changes when key findings are removed',
    indeterminate: 'INDETERMINATE — insufficient findings to challenge',
  };

  const parts: string[] = [`Diagnostic stability: ${labels[verdict]}.`];

  if (topLoadBearing) {
    const top = cpgScores.find(
      (s) => s.finding === topLoadBearing && s.diagnosis === baselinePrimary
    );
    if (top) {
      parts.push(
        `Most load-bearing finding: "${topLoadBearing}" ` +
        `(CPG=${top.cpg.toFixed(2)}, shifts confidence by ${(Math.abs(top.cpg) * 100).toFixed(0)}%).`
      );
    }
  }

  const dropouts = [...new Set(cpgScores.filter((s) => s.diagnosisDroppedOut).map((s) => s.finding))];
  if (dropouts.length > 0) {
    parts.push(
      `${dropouts.length} finding(s) are critical — removal causes a diagnosis to leave top 5: ` +
      dropouts.slice(0, 3).join(', ') + '.'
    );
  }

  parts.push(
    `${findingschallenged} finding(s) challenged across ${diagnosesTested} diagnosis/diagnoses. ` +
    `Stability score: ${(stabilityScore * 100).toFixed(0)}/100.`
  );

  return parts.join(' ');
}

export class EvidenceChallenger {
  private supabase = getSupabaseServer();

  async challenge(input: ChallengerInput): Promise<ChallengerResult> {
    const t0 = Date.now();
    const trace: string[] = [];
    const maxDx = input.maxDiagnosesToChallenge ?? 3;

    trace.push('baseline:start');
    const baselineResult = runClinicalInferenceEngine(input.request);
    const baselineDifferentials = baselineResult.differentials.slice(0, 5);
    const baselinePrimary =
      baselineDifferentials[0]?.condition ??
      baselineDifferentials[0]?.name ?? 'unknown';
    const baselineConfidence = baselineDifferentials[0]?.probability ?? 0;
    const baselineMap = getDifferentialMap(baselineDifferentials);
    trace.push(`baseline:complete primary=${baselinePrimary} conf=${baselineConfidence.toFixed(2)}`);

    const findings = extractChallengableFindings(input.request);
    trace.push(`findings_extracted:${findings.length}`);

    if (findings.length < (input.minFindingsToChallenge ?? 1)) {
      const verdict = 'indeterminate' as StabilityVerdict;
      const score = 0.5;
      return {
        sessionId: input.multiAgentSessionId,
        baselinePrimary,
        baselineConfidence,
        baselineDifferentials,
        findingschallenged: 0,
        diagnosesTested: 0,
        stabilityVerdict: verdict,
        stabilityScore: score,
        topLoadBearingFinding: null,
        cpgScores: [],
        reasoningTrace: trace,
        latencyMs: Date.now() - t0,
        clinicalSummary: buildClinicalSummary(baselinePrimary, verdict, score, null, [], 0, 0),
      };
    }

    const cpgScores: FindingCPGScore[] = [];
    const targetDiagnoses = baselineDifferentials.slice(0, maxDx);

    for (const f of findings) {
      const edited = f.remove(input.request);
      if ((edited.presenting_signs ?? []).length === 0) continue;

      const editedResult = runClinicalInferenceEngine(edited);
      const editedMap = getDifferentialMap(editedResult.differentials);

      for (const dx of targetDiagnoses) {
        const dxKey = dx.condition_id ?? dx.condition ?? dx.name ?? '';
        if (!dxKey) continue;

        const baselineEntry = baselineMap.get(dxKey);
        const editedEntry = editedMap.get(dxKey);
        const probBaseline = baselineEntry?.probability ?? 0;
        const probCf = editedEntry?.probability ?? 0;

        cpgScores.push({
          finding: f.finding,
          findingType: f.findingType,
          diagnosis: dx.condition ?? dx.name ?? dxKey,
          diagnosisRankBaseline: baselineEntry?.rank ?? 1,
          probabilityBaseline: probBaseline,
          probabilityCounterfactual: probCf,
          cpg: probBaseline - probCf,
          rankAfterRemoval: editedEntry?.rank ?? null,
          rankDelta: editedEntry?.rank != null ? editedEntry.rank - (baselineEntry?.rank ?? 1) : null,
          diagnosisDroppedOut: !editedEntry && probBaseline > 0.05,
        });
      }
      trace.push(`challenged:${f.finding}`);
    }

    const { verdict, score } = computeStability(baselinePrimary, cpgScores);
    const primaryCpgs = cpgScores
      .filter((s) => s.diagnosis === baselinePrimary)
      .sort((a, b) => Math.abs(b.cpg) - Math.abs(a.cpg));
    const topLoadBearing = primaryCpgs[0]?.finding ?? null;
    const latencyMs = Date.now() - t0;

    trace.push(`stability:${verdict} score=${score.toFixed(2)} latency=${latencyMs}ms`);

    const result: ChallengerResult = {
      sessionId: input.multiAgentSessionId,
      baselinePrimary,
      baselineConfidence,
      baselineDifferentials,
      findingschallenged: findings.length,
      diagnosesTested: targetDiagnoses.length,
      stabilityVerdict: verdict,
      stabilityScore: score,
      topLoadBearingFinding: topLoadBearing,
      cpgScores,
      reasoningTrace: trace,
      latencyMs,
      clinicalSummary: buildClinicalSummary(
        baselinePrimary, verdict, score, topLoadBearing,
        cpgScores, findings.length, targetDiagnoses.length
      ),
    };

    void this.persistSession(input, result);
    return result;
  }

  private async persistSession(input: ChallengerInput, result: ChallengerResult): Promise<void> {
    try {
      const { data: session, error: sessionErr } = await this.supabase
        .from('counterfactual_diagnostic_sessions')
        .insert({
          tenant_id: input.tenantId,
          case_id: input.caseId,
          inference_event_id: input.inferenceEventId,
          session_id: input.multiAgentSessionId,
          species: input.request.species,
          breed: input.request.breed ?? null,
          age_years: input.request.age_years ?? null,
          baseline_primary: result.baselinePrimary,
          baseline_confidence: result.baselineConfidence,
          baseline_differential_count: result.baselineDifferentials.length,
          findings_challenged: result.findingschallenged,
          diagnoses_tested: result.diagnosesTested,
          stability_verdict: result.stabilityVerdict,
          stability_score: result.stabilityScore,
          top_load_bearing_finding: result.topLoadBearingFinding,
          reasoning_trace: result.reasoningTrace,
          latency_ms: result.latencyMs,
          computed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (sessionErr || !session) return;

      const rows = result.cpgScores.map((s) => ({
        session_id: (session as Record<string, unknown>).id as string,
        tenant_id: input.tenantId,
        finding: s.finding,
        finding_type: s.findingType,
        diagnosis: s.diagnosis,
        diagnosis_rank_baseline: s.diagnosisRankBaseline,
        probability_baseline: s.probabilityBaseline,
        probability_counterfactual: s.probabilityCounterfactual,
        cpg: s.cpg,
        rank_after_removal: s.rankAfterRemoval,
        rank_delta: s.rankDelta,
        diagnosis_dropped_out: s.diagnosisDroppedOut,
        created_at: new Date().toISOString(),
      }));

      if (rows.length > 0) {
        await this.supabase.from('cpg_finding_scores').insert(rows);
      }
    } catch (err) {
      console.error('[EvidenceChallenger] persist failed:', err);
    }
  }
}

let _challenger: EvidenceChallenger | null = null;
export function getEvidenceChallenger(): EvidenceChallenger {
  if (!_challenger) _challenger = new EvidenceChallenger();
  return _challenger;
}
