// ============================================================
// VetIOS GaaS — Agent Runtime Engine
// Orchestrates goal-directed, multi-step autonomous execution
// on top of VetIOS inference/outcome/simulation primitives.
// ============================================================

import type {
  AgentRun,
  AgentStep,
  AgentGoal,
  AgentPolicy,
  AgentRole,
  PatientContext,
  ToolCall,
  SafetyState,
} from "../types/agent";
import type { MemoryStoreAdapter } from "../lib/memory-store";
import { buildMemoryContext } from "../lib/memory-store";
import type { ToolExecutor } from "../lib/tool-registry";
import type { HITLManager } from "../lib/hitl";
import { getTriageEngine } from "../lib/triage-engine";

// ─── Planner Response ────────────────────────────────────────
interface PlannerOutput {
  reasoning: string;
  next_tool?: {
    name: string;
    input: Record<string, unknown>;
  };
  is_complete: boolean;
  completion_summary?: string;
  safety_assessment: SafetyState;
  needs_human_review: boolean;
  human_review_reason?: string;
}

// ─── Runtime Config ──────────────────────────────────────────
export interface AgentRuntimeConfig {
  vetiosBaseUrl: string;
  authToken: string;
  openaiCompatibleUrl?: string;
  plannerModel?: string;
}

// ─── Agent Runtime ───────────────────────────────────────────
export class AgentRuntime {
  constructor(
    private config: AgentRuntimeConfig,
    private memoryStore: MemoryStoreAdapter,
    private toolExecutor: ToolExecutor,
    private hitlManager: HITLManager
  ) {}

  async startRun(params: {
    tenant_id: string;
    agent_role: AgentRole;
    goal: AgentGoal;
    policy: AgentPolicy;
    patient_context: PatientContext;
  }): Promise<AgentRun> {
    const run: AgentRun = {
      run_id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenant_id: params.tenant_id,
      agent_role: params.agent_role,
      goal: params.goal,
      policy: params.policy,
      patient_context: params.patient_context,
      status: "running",
      steps: [],
      memory_context: [],
      started_at: new Date().toISOString(),
    };

    // Load longitudinal memory context
    const { summary, relevant_entries } = await buildMemoryContext(
      this.memoryStore,
      params.patient_context.patient_id,
      params.goal.description
    );
    run.memory_context = relevant_entries;

    // Execute the agent loop
    return this.executeLoop(run, summary);
  }

  private async executeLoop(run: AgentRun, memory_summary: string): Promise<AgentRun> {
    const maxSteps = run.goal.max_steps;

    while (run.steps.length < maxSteps && run.status === "running") {
      // Autonomous Triage: auto-run assessment after first step
      if (run.agent_role === "triage" && run.steps.length >= 1 && !run.patient_context.triage_assessment) {
        const engine = getTriageEngine();
        run.patient_context.triage_assessment = engine.assess(run.patient_context);
      }

      const plannerOutput = await this.callPlanner(run, memory_summary);

      const step: AgentStep = {
        step_number: run.steps.length + 1,
        reasoning: plannerOutput.reasoning,
        safety_check: plannerOutput.safety_assessment,
        timestamp: new Date().toISOString(),
      };

      // Safety hold
      if (plannerOutput.safety_assessment === "hold" || plannerOutput.safety_assessment === "escalate") {
        run.steps.push({ ...step, observation: "Safety check triggered escalation." });
        const interrupt = await this.hitlManager.raise(
          run,
          `Safety state: ${plannerOutput.safety_assessment}. ${plannerOutput.human_review_reason ?? ""}`,
          undefined
        );
        run.current_interrupt = interrupt;
        run.status = "awaiting_human";
        return run;
      }

      // Human review required before this action
      if (plannerOutput.needs_human_review && plannerOutput.next_tool) {
        const pendingCall: ToolCall = {
          id: `tc_${Date.now()}`,
          tool: plannerOutput.next_tool.name as import("../types/agent").ToolName,
          input: plannerOutput.next_tool.input,
          status: "pending",
          requires_approval: true,
        };
        run.steps.push({ ...step, tool_call: pendingCall, observation: "Awaiting human approval." });
        const interrupt = await this.hitlManager.raise(
          run,
          plannerOutput.human_review_reason ?? "Action requires human review",
          pendingCall
        );
        run.current_interrupt = interrupt;
        run.status = "awaiting_human";
        return run;
      }

      // Execute tool if planned
      if (plannerOutput.next_tool) {
        const toolCall: ToolCall = {
          id: `tc_${Date.now()}`,
          tool: plannerOutput.next_tool.name as import("../types/agent").ToolName,
          input: plannerOutput.next_tool.input,
          status: "pending",
        };

        // Check if policy requires approval for this specific tool
        if (run.policy.require_human_approval_for.includes(toolCall.tool)) {
          run.steps.push({ ...step, tool_call: toolCall, observation: "Tool requires policy approval." });
          const interrupt = await this.hitlManager.raise(
            run,
            `Policy requires approval for: ${toolCall.tool}`,
            toolCall
          );
          run.current_interrupt = interrupt;
          run.status = "awaiting_human";
          return run;
        }

        const executedCall = await this.toolExecutor.execute(toolCall, run.policy);
        step.tool_call = executedCall;
        step.observation = JSON.stringify(executedCall.output ?? {}, null, 2).slice(0, 500);

        // Persist significant outcomes to memory
        if (executedCall.status === "success") {
          await this.persistToMemory(run, executedCall);
        }
      }

      run.steps.push(step);

      // Check completion
      if (plannerOutput.is_complete) {
        run.status = "completed";
        run.result = {
          summary: plannerOutput.completion_summary ?? "Agent completed successfully.",
          actions_taken: run.steps
            .filter((s) => s.tool_call?.status === "success")
            .map((s) => s.tool_call!.tool),
          final_confidence: this.extractFinalConfidence(run),
          escalated_to_human: false,
        };
        run.completed_at = new Date().toISOString();
        return run;
      }
    }

    // Max steps reached
    if (run.steps.length >= maxSteps) {
      run.status = "completed";
      run.result = {
        summary: `Reached maximum steps (${maxSteps}). Partial completion.`,
        actions_taken: run.steps
          .filter((s) => s.tool_call?.status === "success")
          .map((s) => s.tool_call!.tool),
        escalated_to_human: false,
      };
      run.completed_at = new Date().toISOString();
    }

    return run;
  }

  async resumeFromHITL(run: AgentRun, interrupt_id: string): Promise<AgentRun> {
    const interrupt = await this.hitlManager.resolve(interrupt_id, "approved", "system_resume");

    if (interrupt.resolution === "rejected") {
      run.status = "completed";
      run.result = {
        summary: "Run terminated: human rejected the pending action.",
        actions_taken: run.steps
          .filter((s) => s.tool_call?.status === "success")
          .map((s) => s.tool_call!.tool),
        escalated_to_human: true,
      };
      return run;
    }

    // Apply modified input if provided
    const lastStep = run.steps.at(-1);
    if (lastStep?.tool_call && interrupt.resolution === "modified" && interrupt.modified_input) {
      lastStep.tool_call.input = interrupt.modified_input;
    }

    run.status = "running";
    run.current_interrupt = undefined;

    // Execute pending tool call if it was the hold reason
    if (lastStep?.tool_call?.status === "pending") {
      const executed = await this.toolExecutor.execute(lastStep.tool_call, run.policy);
      executed.approved_by = interrupt.resolved_by ?? undefined;
      executed.approved_at = interrupt.resolved_at ?? undefined;
      lastStep.tool_call = executed;
      lastStep.observation = JSON.stringify(executed.output ?? {}, null, 2).slice(0, 500);
      await this.persistToMemory(run, executed);
    }

    const summary = await this.memoryStore.summarize(run.patient_context.patient_id);
    return this.executeLoop(run, summary);
  }

  private async callPlanner(run: AgentRun, memory_summary: string): Promise<PlannerOutput> {
    const systemPrompt = buildPlannerSystemPrompt(run.agent_role, run.policy);
    const userPrompt = buildPlannerUserPrompt(run, memory_summary);

    const res = await fetch(`${this.config.vetiosBaseUrl}/api/agent/plan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.authToken}`,
      },
      body: JSON.stringify({
        model: { name: "VetIOS Diagnostics", version: "latest" },
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      // Fallback: safe terminal state
      return {
        reasoning: "Planner API unavailable. Escalating to human review.",
        is_complete: false,
        safety_assessment: "hold",
        needs_human_review: true,
        human_review_reason: "Planner unreachable",
      };
    }

    const data = await res.json();
    return parsePlannerResponse(data);
  }

  private async persistToMemory(run: AgentRun, call: ToolCall): Promise<void> {
    if (call.status !== "success") return;
    const memType =
      call.tool === "run_inference"
        ? "inference"
        : call.tool === "record_outcome"
        ? "outcome"
        : call.tool === "order_lab"
        ? "lab"
        : call.tool === "send_alert"
        ? "alert"
        : "note";

    await this.memoryStore.append({
      patient_id: run.patient_context.patient_id,
      type: memType,
      timestamp: new Date().toISOString(),
      content: {
        run_id: run.run_id,
        agent_role: run.agent_role,
        tool: call.tool,
        input: call.input,
        output: call.output,
      },
    });
  }

  private extractFinalConfidence(run: AgentRun): number | undefined {
    const inferenceSteps = run.steps.filter(
      (s) => s.tool_call?.tool === "run_inference" && s.tool_call.status === "success"
    );
    const last = inferenceSteps.at(-1);
    const output = last?.tool_call?.output as Record<string, unknown> | undefined;
    const data = output?.["data"] as Record<string, unknown> | undefined;
    return data?.["confidence_score"] as number | undefined;
  }
}

// ─── Prompt builders ─────────────────────────────────────────
function buildPlannerSystemPrompt(role: AgentRole, policy: AgentPolicy): string {
  return `You are a VetIOS ${role} agent operating within a closed-loop veterinary intelligence system.

Your role: ${getRoleDescription(role)}

You have access to these tools: ${policy.allowed_tools.join(", ")}

Safety rules:
- If confidence is below ${policy.confidence_threshold_for_escalation}, flag for human review
- You may perform at most ${policy.max_autonomous_actions} autonomous actions
- Tools requiring human approval: ${policy.require_human_approval_for.join(", ")}
- Safe terminal states: ${policy.safe_terminal_states.join(", ")}

Always respond with valid JSON matching the PlannerOutput schema.`;
}

function buildPlannerUserPrompt(run: AgentRun, memory_summary: string): string {
  const triage = run.patient_context.triage_assessment;
  const triageWarning = (triage && (triage.level === "CRITICAL" || triage.level === "URGENT")) 
    ? `[SYSTEM ESCALATION WARNING]: Triage engine assessed patient as ${triage.level} (Score ${triage.score}). Recommended: ${triage.recommended_actions.join("; ")}. You MUST consider escalating this case or firing critical alerts.`
    : undefined;

  return JSON.stringify({
    goal: run.goal,
    patient_context: run.patient_context,
    triage_warning: triageWarning,
    memory_summary,
    recent_memory: run.memory_context.slice(-5),
    steps_so_far: run.steps.length,
    previous_steps: run.steps.slice(-3).map((s) => ({
      step: s.step_number,
      reasoning: s.reasoning,
      tool_used: s.tool_call?.tool,
      observation: s.observation,
    })),
    instructions:
      "Decide the next action. Return JSON with: reasoning, next_tool (optional), is_complete, completion_summary (if done), safety_assessment, needs_human_review, human_review_reason (if needed).",
  });
}

function getRoleDescription(role: AgentRole): string {
  const descriptions: Record<AgentRole, string> = {
    triage: "Assess incoming cases, gather initial clinical signals, and route to the appropriate specialist agent.",
    diagnostic: "Analyze clinical signals, run inference, rank differential diagnoses, and achieve confident identification.",
    treatment: "Recommend treatment protocols, check drug interactions, and coordinate care plans.",
    compliance: "Ensure all clinical actions meet regulatory and safety requirements before execution.",
    followup: "Schedule follow-up appointments, monitor recovery, and close the care loop.",
    billing: "Generate accurate billing records from confirmed diagnoses and treatment actions.",
  };
  return descriptions[role];
}

function parsePlannerResponse(data: unknown): PlannerOutput {
  try {
    const text =
      typeof data === "string"
        ? data
        : ((data as Record<string, unknown>)?.["choices"] as Array<Record<string, unknown>>)?.[0]?.["message"] as string
          ?? ((data as Record<string, unknown>)?.["content"] as Array<Record<string, unknown>>)?.[0]?.["text"] as string
          ?? "";

    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned) as PlannerOutput;
  } catch {
    return {
      reasoning: "Could not parse planner response. Defaulting to safe state.",
      is_complete: false,
      safety_assessment: "hold",
      needs_human_review: true,
      human_review_reason: "Planner response parse failure",
    };
  }
}
