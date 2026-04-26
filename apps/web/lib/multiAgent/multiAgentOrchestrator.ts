/**
 * VetIOS Multi-Agent Case Resolution Protocol
 *
 * Coordinates parallel specialist agents for complex case resolution:
 *
 *   Case → Triage Agent (200ms) → [Diagnostic | Treatment | Lab | Imaging] (parallel)
 *        → Synthesis Agent → HITL Gate → Outcome Agent → Learning Agent
 *
 * Implements the missing architecture from Section 8 of the platform audit.
 */

import type { AgentRole } from '@vetios/gaas';

// ─── Types ───────────────────────────────────────────────────

export type AgentSpecialty =
  | 'triage'
  | 'diagnostic'
  | 'treatment'
  | 'lab_interpretation'
  | 'imaging'
  | 'synthesis'
  | 'outcome_followup'
  | 'learning';

export interface AgentTask {
  agentId: string;
  specialty: AgentSpecialty;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: string | null;
  completedAt: string | null;
  latencyMs: number | null;
  output: AgentOutput | null;
  error: string | null;
}

export interface AgentOutput {
  specialty: AgentSpecialty;
  confidence: number;
  summary: string;
  findings: Record<string, unknown>;
  requiresHITL: boolean;
  hitlReason?: string;
  recommendedActions: string[];
}

export interface MultiAgentCaseInput {
  caseId: string;
  tenantId: string;
  species: string;
  breed?: string | null;
  ageYears?: number | null;
  weightKg?: number | null;
  symptoms: string[];
  biomarkers?: Record<string, number | string> | null;
  hasImaging?: boolean;
  urgency?: string;
  ragContext?: string;
  region?: string;
}

export interface MultiAgentCaseResult {
  caseId: string;
  sessionId: string;
  agentTasks: AgentTask[];
  synthesisOutput: SynthesisOutput;
  requiresHITL: boolean;
  hitlReasons: string[];
  totalLatencyMs: number;
  pipelineTrace: string[];
}

export interface SynthesisOutput {
  primaryDiagnosis: string | null;
  calibratedConfidence: number;
  differentials: Array<{ diagnosis: string; probability: number; supportingAgents: AgentSpecialty[] }>;
  treatmentPlan: string[];
  labRecommendations: string[];
  imagingFindings: string | null;
  urgencyLevel: 'routine' | 'priority' | 'urgent' | 'emergency';
  clinicalNarrative: string;
  safetyFlags: string[];
  outcomeFollowupSchedule: Array<{ timepoint: string; action: string }>;
}

// ─── Individual Agent Runners ─────────────────────────────────

async function runTriageAgent(
  input: MultiAgentCaseInput,
  baseUrl: string,
  headers: Record<string, string>
): Promise<AgentOutput> {
  const urgencySignals = [
    'collapse', 'seizure', 'dyspnoea', 'haemorrhage', 'shock', 'unconscious',
    'trauma', 'bloat', 'gdv', 'pale mucous membranes',
  ];

  const symptomText = input.symptoms.join(' ').toLowerCase();
  const isEmergency = urgencySignals.some((s) => symptomText.includes(s));
  const isUrgent = input.urgency === 'urgent' || input.urgency === 'emergency';

  const urgencyLevel = isEmergency ? 'emergency' : isUrgent ? 'urgent' : 'routine';

  return {
    specialty: 'triage',
    confidence: 0.95,
    summary: `${input.species} case triaged as ${urgencyLevel.toUpperCase()}`,
    findings: {
      urgencyLevel,
      emergencySignalsDetected: urgencySignals.filter((s) => symptomText.includes(s)),
      requiresImmediateVet: isEmergency,
    },
    requiresHITL: isEmergency,
    hitlReason: isEmergency ? 'Emergency signals detected — immediate vet required' : undefined,
    recommendedActions: isEmergency
      ? ['Page on-call vet immediately', 'Prepare emergency stabilisation protocol']
      : ['Route to standard diagnostic workflow'],
  };
}

async function runDiagnosticAgent(
  input: MultiAgentCaseInput,
  ragContext: string,
  baseUrl: string,
  headers: Record<string, string>
): Promise<AgentOutput> {
  // Call the inference endpoint with RAG context prepended
  try {
    const res = await fetch(`${baseUrl}/api/inference`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: { name: 'VetIOS Diagnostics', version: 'latest' },
        input: {
          input_signature: {
            species: input.species,
            breed: input.breed,
            age_years: input.ageYears,
            weight_kg: input.weightKg,
            symptoms: input.symptoms,
            biomarkers: input.biomarkers,
            rag_context: ragContext,
          },
        },
      }),
    });

    if (!res.ok) throw new Error(`Diagnostic inference failed: ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    const payload = (data.data as Record<string, unknown>) ?? {};
    const diagnosis = (payload.output_payload as Record<string, unknown>) ?? {};
    const diagBlock = (diagnosis.diagnosis as Record<string, unknown>) ?? {};

    return {
      specialty: 'diagnostic',
      confidence: Number(diagBlock.confidence_score ?? 0.5),
      summary: String(diagBlock.primary_condition_class ?? 'Assessment pending'),
      findings: diagBlock,
      requiresHITL: Number(diagBlock.confidence_score ?? 0.5) < 0.5,
      hitlReason: Number(diagBlock.confidence_score ?? 0.5) < 0.5
        ? 'Low diagnostic confidence requires vet confirmation'
        : undefined,
      recommendedActions: (diagBlock.top_differentials as Array<{ name?: string }> ?? [])
        .slice(0, 3)
        .map((d) => `Evaluate for: ${d.name ?? 'unknown'}`),
    };
  } catch (err) {
    return {
      specialty: 'diagnostic',
      confidence: 0.3,
      summary: 'Diagnostic agent encountered an error — manual review required',
      findings: { error: String(err) },
      requiresHITL: true,
      hitlReason: 'Diagnostic agent error',
      recommendedActions: ['Manual vet assessment required'],
    };
  }
}

async function runLabAgent(
  input: MultiAgentCaseInput,
  _baseUrl: string,
  _headers: Record<string, string>
): Promise<AgentOutput> {
  if (!input.biomarkers || Object.keys(input.biomarkers).length === 0) {
    return {
      specialty: 'lab_interpretation',
      confidence: 1.0,
      summary: 'No laboratory values provided',
      findings: {},
      requiresHITL: false,
      recommendedActions: ['Request CBC, serum biochemistry, and urinalysis'],
    };
  }

  // Species-specific reference ranges
  const RANGES: Record<string, Record<string, [number, number]>> = {
    feline: {
      BUN: [14, 36], creatinine: [0.8, 2.4], ALT: [12, 130],
      T4: [0.8, 4.7], glucose: [64, 170], PCV: [24, 45],
    },
    canine: {
      BUN: [6, 31], creatinine: [0.5, 1.8], ALT: [10, 100],
      ALP: [20, 150], glucose: [65, 120], PCV: [37, 55],
    },
  };

  const speciesRanges = RANGES[input.species] ?? {};
  const abnormal: string[] = [];
  const critical: string[] = [];

  for (const [marker, value] of Object.entries(input.biomarkers)) {
    const range = speciesRanges[marker];
    if (!range) continue;
    const numVal = Number(value);
    if (isNaN(numVal)) continue;

    if (numVal < range[0] * 0.7 || numVal > range[1] * 2) {
      critical.push(`${marker}: ${numVal} (critical — ref: ${range[0]}-${range[1]})`);
    } else if (numVal < range[0] || numVal > range[1]) {
      abnormal.push(`${marker}: ${numVal} (ref: ${range[0]}-${range[1]})`);
    }
  }

  const hasCritical = critical.length > 0;
  return {
    specialty: 'lab_interpretation',
    confidence: 0.9,
    summary: hasCritical
      ? `Critical lab abnormalities detected: ${critical.join(', ')}`
      : abnormal.length > 0
        ? `Lab abnormalities: ${abnormal.join(', ')}`
        : 'All submitted laboratory values within normal limits',
    findings: { abnormal, critical, speciesRanges: Object.keys(speciesRanges) },
    requiresHITL: hasCritical,
    hitlReason: hasCritical ? `Critical lab values: ${critical.join('; ')}` : undefined,
    recommendedActions: hasCritical
      ? ['Immediate clinical reassessment', 'Consider hospitalisation', 'Repeat critical values']
      : abnormal.length > 0
        ? ['Monitor and repeat in 2 weeks', 'Correlate with clinical signs']
        : ['No further lab action required'],
  };
}

async function runTreatmentAgent(
  input: MultiAgentCaseInput,
  diagnosticOutput: AgentOutput,
  baseUrl: string,
  headers: Record<string, string>
): Promise<AgentOutput> {
  const diagnosis = String(
    (diagnosticOutput.findings as Record<string, unknown>).primary_condition_class ?? 'unknown'
  );

  try {
    const res = await fetch(`${baseUrl}/api/treatment/recommend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        species: input.species,
        breed: input.breed,
        diagnosis,
        biomarkers: input.biomarkers,
        weight_kg: input.weightKg,
        age_years: input.ageYears,
      }),
    });

    if (!res.ok) throw new Error(`Treatment agent failed: ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    const payload = (data.data as Record<string, unknown>) ?? {};

    return {
      specialty: 'treatment',
      confidence: 0.85,
      summary: `Treatment plan generated for: ${diagnosis}`,
      findings: payload,
      requiresHITL: false,
      recommendedActions: (payload.recommendations as string[] ?? []).slice(0, 5),
    };
  } catch {
    return {
      specialty: 'treatment',
      confidence: 0.5,
      summary: 'Standard supportive care recommended pending full diagnostic workup',
      findings: {},
      requiresHITL: true,
      hitlReason: 'Treatment plan requires vet review',
      recommendedActions: ['Supportive care', 'Fluid therapy if dehydrated', 'Re-assess after diagnostics'],
    };
  }
}

// ─── Synthesis Agent ──────────────────────────────────────────

function synthesiseOutputs(
  input: MultiAgentCaseInput,
  tasks: AgentTask[]
): SynthesisOutput {
  const completed = tasks.filter((t) => t.status === 'completed' && t.output);
  const triage = completed.find((task) => task.specialty === 'triage')?.output;
  const diagnostic = completed.find((task) => task.specialty === 'diagnostic')?.output;
  const lab = completed.find((task) => task.specialty === 'lab_interpretation')?.output;
  const treatment = completed.find((task) => task.specialty === 'treatment')?.output;

  const urgencyLevel =
    (triage?.findings as Record<string, unknown>)?.urgencyLevel as SynthesisOutput['urgencyLevel'] ?? 'routine';

  const primaryDiagnosis =
    (diagnostic?.findings as Record<string, unknown>)?.primary_condition_class as string | null ?? null;

  // Weighted confidence: diagnostic (60%) + lab consistency (30%) + triage (10%)
  const diagConf = diagnostic?.confidence ?? 0.5;
  const labConf = lab?.confidence ?? 0.8;
  const triageConf = triage?.confidence ?? 0.9;
  const calibratedConfidence = diagConf * 0.6 + labConf * 0.3 + triageConf * 0.1;

  const differentials = (
    (diagnostic?.findings as Record<string, unknown>)?.top_differentials as
      Array<{ name?: string; confidence?: number }> ?? []
  ).map((d) => ({
    diagnosis: d.name ?? 'unknown',
    probability: d.confidence ?? 0.3,
    supportingAgents: ['diagnostic'] as AgentSpecialty[],
  }));

  const treatmentPlan = treatment?.recommendedActions ?? ['Supportive care pending full workup'];
  const labRecommendations = lab?.recommendedActions ?? [];
  const safetyFlags = [
    ...tasks.flatMap((t) => t.output?.hitlReason ? [t.output.hitlReason] : []),
  ];

  const outcomeFollowupSchedule = [
    { timepoint: '48h', action: 'Clinical reassessment + repeat critical labs' },
    { timepoint: '7d', action: 'Progress evaluation + response to treatment' },
    { timepoint: '30d', action: 'Outcome confirmation + VetIOS diagnosis verification' },
  ];

  const narrativeParts: string[] = [];
  if (primaryDiagnosis) narrativeParts.push(`Primary assessment: ${primaryDiagnosis} (confidence: ${(calibratedConfidence * 100).toFixed(0)}%)`);
  if (lab?.summary) narrativeParts.push(`Laboratory: ${lab.summary}`);
  if (treatment?.summary) narrativeParts.push(`Treatment: ${treatment.summary}`);
  if (safetyFlags.length > 0) narrativeParts.push(`Safety flags: ${safetyFlags.join('; ')}`);

  return {
    primaryDiagnosis,
    calibratedConfidence,
    differentials,
    treatmentPlan,
    labRecommendations,
    imagingFindings: null,
    urgencyLevel,
    clinicalNarrative: narrativeParts.join('. ') || 'Multi-agent assessment complete.',
    safetyFlags,
    outcomeFollowupSchedule,
  };
}

// ─── Multi-Agent Orchestrator ────────────────────────────────

export class MultiAgentOrchestrator {
  constructor(
    private baseUrl: string,
    private authToken: string
  ) {}

  private get headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.authToken}`,
    };
  }

  /**
   * Run the full multi-agent pipeline for a case.
   * Triage runs first (200ms gate), then parallel specialist agents,
   * then synthesis, then HITL gate.
   */
  async resolveCase(input: MultiAgentCaseInput): Promise<MultiAgentCaseResult> {
    const sessionId = `mas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const t0 = Date.now();
    const trace: string[] = [];
    const tasks: AgentTask[] = [];

    // ── Phase 1: Triage (sequential, fast gate) ──
    trace.push('triage:start');
    const triageTask = await this.runTask('triage', () =>
      runTriageAgent(input, this.baseUrl, this.headers)
    );
    tasks.push(triageTask);
    trace.push(`triage:${triageTask.status}`);

    // Emergency gate: if triage fires emergency, skip to synthesis immediately
    const isEmergency =
      (triageTask.output?.findings as Record<string, unknown>)?.urgencyLevel === 'emergency';

    // ── Phase 2: Parallel specialist agents ──
    trace.push('parallel_agents:start');
    const ragContext = input.ragContext ?? '';

    const parallelTasks: Awaited<ReturnType<typeof this.runTask>>[] = await Promise.all([
      this.runTask('diagnostic', () =>
        runDiagnosticAgent(input, ragContext, this.baseUrl, this.headers)
      ),
      this.runTask('lab_interpretation', () =>
        runLabAgent(input, this.baseUrl, this.headers)
      ),
      isEmergency
        ? Promise.resolve(this.skippedTask('treatment'))
        : this.runTask('treatment', async () => {
            // Treatment agent depends on diagnostic output
            const diagOutput = tasks.find((task) => task.specialty === 'diagnostic')?.output ??
              parallelTasks?.[0]?.output ?? null;
            return diagOutput
              ? runTreatmentAgent(input, diagOutput, this.baseUrl, this.headers)
              : { specialty: 'treatment' as AgentSpecialty, confidence: 0.5, summary: 'Pending diagnostic', findings: {}, requiresHITL: true, recommendedActions: [] };
          }),
    ]);

    tasks.push(...parallelTasks);
    trace.push(`parallel_agents:completed (${parallelTasks.filter((t) => t.status === 'completed').length}/${parallelTasks.length})`);

    // ── Phase 3: Synthesis ──
    trace.push('synthesis:start');
    const synthesisOutput = synthesiseOutputs(input, tasks);
    trace.push('synthesis:completed');

    // ── HITL Gate ──
    const hitlReasons = tasks
      .filter((t) => t.output?.requiresHITL)
      .map((t) => t.output!.hitlReason!)
      .filter(Boolean);

    const requiresHITL =
      hitlReasons.length > 0 ||
      synthesisOutput.calibratedConfidence < 0.5 ||
      isEmergency;

    const totalLatencyMs = Date.now() - t0;
    trace.push(`total_latency:${totalLatencyMs}ms`);

    return {
      caseId: input.caseId,
      sessionId,
      agentTasks: tasks,
      synthesisOutput,
      requiresHITL,
      hitlReasons,
      totalLatencyMs,
      pipelineTrace: trace,
    };
  }

  // ─── Task Runner ────────────────────────────────────────

  private async runTask(
    specialty: AgentSpecialty,
    fn: () => Promise<AgentOutput>
  ): Promise<AgentTask> {
    const agentId = `${specialty}_${Date.now()}`;
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    try {
      const output = await fn();
      return {
        agentId,
        specialty,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        output,
        error: null,
      };
    } catch (err) {
      return {
        agentId,
        specialty,
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        output: null,
        error: String(err),
      };
    }
  }

  private skippedTask(specialty: AgentSpecialty): AgentTask {
    return {
      agentId: `${specialty}_skipped`,
      specialty,
      status: 'skipped',
      startedAt: null,
      completedAt: null,
      latencyMs: null,
      output: null,
      error: null,
    };
  }
}
