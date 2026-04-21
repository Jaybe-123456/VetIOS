// ============================================================
// VetIOS GaaS — Human-in-the-Loop (HITL) Interrupt Layer
// Structured pause/resume protocol for clinical safety.
// ============================================================

import type { HITLInterrupt, AgentRun, ToolCall } from "../types/agent";

export type HITLResolution = "approved" | "rejected" | "modified";

export interface HITLStore {
  create(interrupt: HITLInterrupt): Promise<HITLInterrupt>;
  get(interrupt_id: string): Promise<HITLInterrupt | null>;
  resolve(
    interrupt_id: string,
    resolution: HITLResolution,
    resolved_by: string,
    modified_input?: Record<string, unknown>
  ): Promise<HITLInterrupt>;
  listPending(tenant_id?: string): Promise<HITLInterrupt[]>;
}

// ─── In-memory HITL store (dev) ──────────────────────────────
export class InMemoryHITLStore implements HITLStore {
  private store = new Map<string, HITLInterrupt>();

  async create(interrupt: HITLInterrupt): Promise<HITLInterrupt> {
    this.store.set(interrupt.interrupt_id, interrupt);
    return interrupt;
  }

  async get(interrupt_id: string): Promise<HITLInterrupt | null> {
    return this.store.get(interrupt_id) ?? null;
  }

  async resolve(
    interrupt_id: string,
    resolution: HITLResolution,
    resolved_by: string,
    modified_input?: Record<string, unknown>
  ): Promise<HITLInterrupt> {
    const existing = this.store.get(interrupt_id);
    if (!existing) throw new Error(`Interrupt ${interrupt_id} not found`);
    const resolved: HITLInterrupt = {
      ...existing,
      resolved_at: new Date().toISOString(),
      resolution,
      resolved_by,
      modified_input,
    };
    this.store.set(interrupt_id, resolved);
    return resolved;
  }

  async listPending(): Promise<HITLInterrupt[]> {
    return Array.from(this.store.values()).filter((i) => !i.resolved_at);
  }
}

// ─── HITL Manager ────────────────────────────────────────────
export class HITLManager {
  constructor(
    private store: HITLStore,
    private notifier?: (interrupt: HITLInterrupt) => Promise<void>
  ) {}

  async raise(
    run: AgentRun,
    reason: string,
    pending_tool?: ToolCall
  ): Promise<HITLInterrupt> {
    const interrupt: HITLInterrupt = {
      interrupt_id: `hitl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      agent_run_id: run.run_id,
      reason,
      pending_tool,
      context_snapshot: {
        patient_id: run.patient_context.patient_id,
        agent_role: run.agent_role,
        steps_completed: run.steps.length,
        goal: run.goal.description,
        last_step: run.steps.at(-1),
      },
      created_at: new Date().toISOString(),
    };

    await this.store.create(interrupt);

    if (this.notifier) {
      await this.notifier(interrupt).catch((err) =>
        console.error("HITL notification failed:", err)
      );
    }

    return interrupt;
  }

  async resolve(
    interrupt_id: string,
    resolution: HITLResolution,
    resolved_by: string,
    modified_input?: Record<string, unknown>
  ): Promise<HITLInterrupt> {
    return this.store.resolve(interrupt_id, resolution, resolved_by, modified_input);
  }

  async getPending(tenant_id?: string): Promise<HITLInterrupt[]> {
    return this.store.listPending(tenant_id);
  }

  async waitForResolution(
    interrupt_id: string,
    poll_interval_ms = 2000,
    timeout_ms = 600_000 // 10 min default
  ): Promise<HITLInterrupt> {
    const deadline = Date.now() + timeout_ms;
    while (Date.now() < deadline) {
      const interrupt = await this.store.get(interrupt_id);
      if (!interrupt) throw new Error(`Interrupt ${interrupt_id} not found`);
      if (interrupt.resolved_at) return interrupt;
      await new Promise((r) => setTimeout(r, poll_interval_ms));
    }
    throw new Error(`HITL interrupt ${interrupt_id} timed out after ${timeout_ms}ms`);
  }
}

// ─── HITL Decision Card (JSON for UI rendering) ──────────────
export function buildDecisionCard(interrupt: HITLInterrupt): Record<string, unknown> {
  return {
    card_type: "hitl_decision",
    interrupt_id: interrupt.interrupt_id,
    agent_run_id: interrupt.agent_run_id,
    created_at: interrupt.created_at,
    reason: interrupt.reason,
    patient_id: (interrupt.context_snapshot as Record<string, unknown>)["patient_id"] as string,
    agent_role: (interrupt.context_snapshot as Record<string, unknown>)["agent_role"] as string,
    pending_action: interrupt.pending_tool
      ? {
          tool: interrupt.pending_tool.tool,
          input: interrupt.pending_tool.input,
          description: `Agent wants to call: ${interrupt.pending_tool.tool}`,
        }
      : null,
    available_actions: ["approved", "rejected", "modified"],
    context: interrupt.context_snapshot,
  };
}
