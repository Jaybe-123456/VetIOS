// ============================================================
// VetIOS GaaS — API Route Handlers
// POST /api/agent/run         — Start an agent run
// POST /api/agent/resume      — Resume after HITL interrupt
// GET  /api/agent/run/:id     — Get run status
// GET  /api/agent/interrupts  — List pending HITL interrupts
// POST /api/agent/interrupts/:id/resolve — Resolve interrupt
// POST /api/tenant            — Create tenant
// GET  /api/tenant/:id        — Get tenant config
// ============================================================

import type {
  AgentGoal,
  AgentPolicy,
  AgentRole,
  PatientContext,
  AgentRunResponse,
  AgentResumeResponse,
} from "../types/agent";
import { AgentRuntime } from "../agents/agent-runtime";
import { HITLManager, buildDecisionCard } from "../lib/hitl";

// ─── Default policies per role ───────────────────────────────
export const DEFAULT_POLICIES: Record<AgentRole, AgentPolicy> = {
  triage: {
    allowed_tools: ["run_inference", "fetch_patient_history", "send_alert", "query_drug_db"],
    confidence_threshold_for_escalation: 0.3,
    max_autonomous_actions: 5,
    require_human_approval_for: [],
    safe_terminal_states: ["triaged", "escalated_to_diagnostic", "triage_complete"],
  },
  diagnostic: {
    allowed_tools: ["run_inference", "run_simulation", "fetch_patient_history", "order_lab", "send_alert"],
    confidence_threshold_for_escalation: 0.5,
    max_autonomous_actions: 8,
    require_human_approval_for: ["order_lab"],
    safe_terminal_states: ["diagnosis_confirmed", "differential_produced", "escalated_to_treatment"],
  },
  treatment: {
    allowed_tools: [
      "query_drug_db", "run_inference", "record_outcome",
      "write_ehr", "send_alert", "schedule_followup",
    ],
    confidence_threshold_for_escalation: 0.6,
    max_autonomous_actions: 6,
    require_human_approval_for: ["write_ehr", "record_outcome"],
    safe_terminal_states: ["treatment_plan_approved", "escalated_to_compliance"],
  },
  compliance: {
    allowed_tools: ["fetch_patient_history", "send_alert"],
    confidence_threshold_for_escalation: 0.1,
    max_autonomous_actions: 3,
    require_human_approval_for: [],
    safe_terminal_states: ["compliant", "non_compliant_flagged"],
  },
  followup: {
    allowed_tools: ["schedule_followup", "send_alert", "fetch_patient_history"],
    confidence_threshold_for_escalation: 0.2,
    max_autonomous_actions: 4,
    require_human_approval_for: [],
    safe_terminal_states: ["followup_scheduled", "no_followup_required"],
  },
  billing: {
    allowed_tools: ["fetch_patient_history", "write_ehr"],
    confidence_threshold_for_escalation: 0.1,
    max_autonomous_actions: 3,
    require_human_approval_for: ["write_ehr"],
    safe_terminal_states: ["billing_complete"],
  },
};

// ─── Request/Response Shapes ─────────────────────────────────

export interface RunAgentRequest {
  tenant_id: string;
  agent_role: AgentRole;
  patient_context: PatientContext;
  goal?: Partial<AgentGoal>;
  policy_overrides?: Partial<AgentPolicy>;
}

export interface ResumeAgentRequest {
  run_id: string;
  interrupt_id: string;
  resolution: "approved" | "rejected" | "modified";
  resolved_by: string;
  modified_input?: Record<string, unknown>;
}

// ─── Route: POST /api/agent/run ──────────────────────────────
export async function handleRunAgent(
  req: RunAgentRequest,
  runtime: AgentRuntime
): Promise<AgentRunResponse> {
  const { tenant_id, agent_role, patient_context, goal, policy_overrides } = req;

  const basePolicy = DEFAULT_POLICIES[agent_role];
  const policy: AgentPolicy = { ...basePolicy, ...policy_overrides };

  const fullGoal: AgentGoal = {
    description: `Perform ${agent_role} assessment for patient ${patient_context.patient_id}`,
    success_criteria: ["Produce ranked differential", "All safe terminal criteria met"],
    max_steps: 10,
    ...goal,
  };

  const run = await runtime.startRun({
    tenant_id,
    agent_role,
    goal: fullGoal,
    policy,
    patient_context,
  });

  return {
    run_id: run.run_id,
    status: run.status,
    agent_role: run.agent_role,
    patient_id: run.patient_context.patient_id,
    steps_completed: run.steps.length,
    current_interrupt: run.current_interrupt,
    result: run.result,
    request_id: `req_${Date.now()}`,
  };
}

// ─── Route: POST /api/agent/resume ───────────────────────────
export async function handleResumeAgent(
  req: ResumeAgentRequest,
  runtime: AgentRuntime,
  hitlManager: HITLManager,
  runStore: Map<string, import("../types/agent").AgentRun>
): Promise<AgentResumeResponse> {
  const run = runStore.get(req.run_id);
  if (!run) throw new Error(`Run ${req.run_id} not found`);

  await hitlManager.resolve(
    req.interrupt_id,
    req.resolution,
    req.resolved_by,
    req.modified_input
  );

  const resumed = await runtime.resumeFromHITL(run, req.interrupt_id);
  runStore.set(run.run_id, resumed);

  return {
    run_id: resumed.run_id,
    status: resumed.status,
    resumed_at: new Date().toISOString(),
    request_id: `req_${Date.now()}`,
  };
}

// ─── Route: GET /api/agent/interrupts ────────────────────────
export async function handleListInterrupts(
  hitlManager: HITLManager
): Promise<{ interrupts: ReturnType<typeof buildDecisionCard>[]; count: number }> {
  const pending = await hitlManager.getPending();
  return {
    interrupts: pending.map(buildDecisionCard),
    count: pending.length,
  };
}

// ─── OpenAPI spec fragment for GaaS endpoints ────────────────
export const GAAS_OPENAPI_FRAGMENT = {
  paths: {
    "/api/agent/run": {
      post: {
        summary: "Start an agent run",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tenant_id", "agent_role", "patient_context"],
                properties: {
                  tenant_id: { type: "string" },
                  agent_role: {
                    type: "string",
                    enum: ["triage", "diagnostic", "treatment", "compliance", "followup", "billing"],
                  },
                  patient_context: {
                    type: "object",
                    required: ["patient_id", "species", "symptoms"],
                    properties: {
                      patient_id: { type: "string" },
                      species: { type: "string" },
                      breed: { type: "string" },
                      age_years: { type: "number" },
                      symptoms: { type: "array", items: { type: "string" } },
                      metadata: { type: "object" },
                    },
                  },
                  goal: { type: "object" },
                  policy_overrides: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Agent run started or completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    run_id: { type: "string" },
                    status: { type: "string" },
                    agent_role: { type: "string" },
                    patient_id: { type: "string" },
                    steps_completed: { type: "number" },
                    current_interrupt: { type: "object" },
                    result: { type: "object" },
                    request_id: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/agent/resume": {
      post: {
        summary: "Resume an agent run after HITL interrupt",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["run_id", "interrupt_id", "resolution", "resolved_by"],
                properties: {
                  run_id: { type: "string" },
                  interrupt_id: { type: "string" },
                  resolution: { type: "string", enum: ["approved", "rejected", "modified"] },
                  resolved_by: { type: "string" },
                  modified_input: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    "/api/agent/interrupts": {
      get: {
        summary: "List pending HITL interrupts requiring human review",
      },
    },
  },
};
