// ============================================================
// VetIOS GaaS — Core Agent Types
// ============================================================

import type { TriageAssessment } from "../lib/triage-engine";

export type AgentStatus =
  | "idle"
  | "running"
  | "awaiting_human"
  | "completed"
  | "failed"
  | "escalated";

export type AgentRole =
  | "triage"
  | "diagnostic"
  | "treatment"
  | "compliance"
  | "followup"
  | "billing";

export type SafetyState = "nominal" | "caution" | "hold" | "escalate";

export type ToolName =
  | "run_inference"
  | "record_outcome"
  | "run_simulation"
  | "query_drug_db"
  | "order_lab"
  | "write_ehr"
  | "send_alert"
  | "schedule_followup"
  | "fetch_patient_history"
  | "query_vkg_differentials"
  | "query_vkg_path";

// ─── Agent Goal ──────────────────────────────────────────────
export interface AgentGoal {
  description: string;
  success_criteria: string[];
  max_steps: number;
  timeout_ms?: number;
}

// ─── Agent Policy ────────────────────────────────────────────
export interface AgentPolicy {
  allowed_tools: ToolName[];
  confidence_threshold_for_escalation: number; // 0-1
  max_autonomous_actions: number;
  require_human_approval_for: ToolName[];
  safe_terminal_states: string[];
}

// ─── Patient Context ─────────────────────────────────────────
export interface PatientContext {
  patient_id: string;
  species: string;
  breed?: string;
  age_years?: number;
  weight_kg?: number;
  symptoms: string[];
  metadata?: {
    labs?: Record<string, number>;
    hydration?: string;
    temperature?: number;
    heart_rate?: number;
    [key: string]: unknown;
  };
  triage_assessment?: TriageAssessment;
}

// ─── Memory Entry ────────────────────────────────────────────
export interface MemoryEntry {
  id: string;
  patient_id: string;
  type: "inference" | "outcome" | "note" | "treatment" | "lab" | "alert";
  timestamp: string;
  content: Record<string, unknown>;
  embedding_id?: string; // for vector retrieval
}

// ─── Tool Call ───────────────────────────────────────────────
export interface ToolCall {
  id: string;
  tool: ToolName;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: "pending" | "success" | "failed";
  latency_ms?: number;
  requires_approval?: boolean;
  approved_by?: string;
  approved_at?: string;
}

// ─── Agent Step ──────────────────────────────────────────────
export interface AgentStep {
  step_number: number;
  reasoning: string;
  tool_call?: ToolCall;
  observation?: string;
  safety_check: SafetyState;
  timestamp: string;
}

// ─── HITL Interrupt ──────────────────────────────────────────
export interface HITLInterrupt {
  interrupt_id: string;
  agent_run_id: string;
  reason: string;
  pending_tool?: ToolCall;
  context_snapshot: Record<string, unknown>;
  created_at: string;
  resolved_at?: string;
  resolution?: "approved" | "rejected" | "modified";
  resolved_by?: string;
  modified_input?: Record<string, unknown>;
}

// ─── Agent Run ───────────────────────────────────────────────
export interface AgentRun {
  run_id: string;
  tenant_id: string;
  agent_role: AgentRole;
  goal: AgentGoal;
  policy: AgentPolicy;
  patient_context: PatientContext;
  status: AgentStatus;
  steps: AgentStep[];
  memory_context: MemoryEntry[];
  current_interrupt?: HITLInterrupt;
  result?: {
    summary: string;
    actions_taken: string[];
    final_confidence?: number;
    escalated_to_human: boolean;
  };
  started_at: string;
  completed_at?: string;
  total_tokens_used?: number;
}

// ─── Agent Message (inter-agent) ─────────────────────────────
export interface AgentMessage {
  message_id: string;
  from_agent: AgentRole;
  to_agent: AgentRole;
  run_id: string;
  patient_id: string;
  type: "handoff" | "consultation" | "alert" | "result" | "triage_escalation";
  payload: Record<string, unknown>;
  timestamp: string;
  acknowledged?: boolean;
}

// ─── Tenant Config ───────────────────────────────────────────
export interface TenantConfig {
  tenant_id: string;
  name: string;
  active_agents: AgentRole[];
  default_policies: Record<AgentRole, AgentPolicy>;
  webhook_url?: string;
  alert_email?: string;
  created_at: string;
}

// ─── GaaS API Responses ──────────────────────────────────────
export interface AgentRunResponse {
  run_id: string;
  status: AgentStatus;
  agent_role: AgentRole;
  patient_id: string;
  steps_completed: number;
  current_interrupt?: HITLInterrupt;
  result?: AgentRun["result"];
  error?: string;
  request_id: string;
}

export interface AgentResumeResponse {
  run_id: string;
  status: AgentStatus;
  resumed_at: string;
  request_id: string;
}
