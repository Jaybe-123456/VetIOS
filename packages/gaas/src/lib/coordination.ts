// ============================================================
// VetIOS GaaS — Multi-Agent Coordination Protocol
// Message bus and handoff schema for specialist agents.
// ============================================================

import type { AgentMessage, AgentRole, AgentRun, TenantConfig } from "../types/agent";
import { getTriageEngine, type TriageAssessment } from "./triage-engine";
import type { NotificationDispatcher } from "./notification-dispatcher";

export type MessageHandler = (message: AgentMessage) => Promise<void>;

export interface MessageBus {
  publish(message: AgentMessage): Promise<void>;
  subscribe(agent_role: AgentRole, handler: MessageHandler): void;
  unsubscribe(agent_role: AgentRole): void;
  getQueue(agent_role: AgentRole): Promise<AgentMessage[]>;
}

// ─── In-process message bus (dev / single-node) ──────────────
export class InProcessMessageBus implements MessageBus {
  private handlers = new Map<AgentRole, MessageHandler>();
  private queues = new Map<AgentRole, AgentMessage[]>();

  async publish(message: AgentMessage): Promise<void> {
    const queue = this.queues.get(message.to_agent) ?? [];
    this.queues.set(message.to_agent, [...queue, message]);

    const handler = this.handlers.get(message.to_agent);
    if (handler) {
      await handler(message).catch((err) =>
        console.error(`Agent message handler error (${message.to_agent}):`, err)
      );
    }
  }

  subscribe(agent_role: AgentRole, handler: MessageHandler): void {
    this.handlers.set(agent_role, handler);
  }

  unsubscribe(agent_role: AgentRole): void {
    this.handlers.delete(agent_role);
  }

  async getQueue(agent_role: AgentRole): Promise<AgentMessage[]> {
    return this.queues.get(agent_role) ?? [];
  }
}

// ─── Coordinator — manages agent handoffs ────────────────────
export class AgentCoordinator {
  constructor(
    private bus: MessageBus,
    private notificationDispatcher?: NotificationDispatcher
  ) {}

  // Triage → Diagnostic handoff
  async handoffToDiagnostic(
    from_run: AgentRun,
    triage_summary: string
  ): Promise<void> {
    await this.bus.publish({
      message_id: `msg_${Date.now()}`,
      from_agent: "triage",
      to_agent: "diagnostic",
      run_id: from_run.run_id,
      patient_id: from_run.patient_context.patient_id,
      type: "handoff",
      payload: {
        patient_context: from_run.patient_context,
        triage_summary,
        triage_steps: from_run.steps.length,
        memory_ids: from_run.memory_context.map((m) => m.id),
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Autonomous Triage Routing
  async triageAndRoute(
    from_run: AgentRun,
    tenant_config: TenantConfig
  ): Promise<{ assessment: TriageAssessment; dispatched: boolean }> {
    const engine = getTriageEngine();
    const assessment = engine.assess(from_run.patient_context);
    
    let dispatched = false;

    // Persist triage assessment in patient context
    from_run.patient_context.triage_assessment = assessment;

    if (assessment.requires_immediate_notification && this.notificationDispatcher) {
      await this.notificationDispatcher.dispatchTriageAlert(
        tenant_config,
        from_run.patient_context.patient_id,
        assessment,
        { run_id: from_run.run_id }
      );
      dispatched = true;

      // Broadcast escalation internal message
      await this.bus.publish({
        message_id: `msg_${Date.now()}_escalation`,
        from_agent: "triage",
        to_agent: "diagnostic",
        run_id: from_run.run_id,
        patient_id: from_run.patient_context.patient_id,
        type: "triage_escalation",
        payload: { assessment },
        timestamp: new Date().toISOString(),
      });
    }

    // Still handoff to diagnostic, but with urgency
    await this.handoffToDiagnostic(
      from_run,
      `Triage Level: ${assessment.level} (Score: ${assessment.score}). ${
        dispatched ? "CRITICAL ALERT DISPATCHED." : ""
      }`
    );

    return { assessment, dispatched };
  }

  // Diagnostic → Treatment handoff
  async handoffToTreatment(
    from_run: AgentRun,
    top_diagnosis: string,
    confidence: number,
    differentials: Array<{ label: string; confidence: number }>
  ): Promise<void> {
    await this.bus.publish({
      message_id: `msg_${Date.now()}`,
      from_agent: "diagnostic",
      to_agent: "treatment",
      run_id: from_run.run_id,
      patient_id: from_run.patient_context.patient_id,
      type: "handoff",
      payload: {
        patient_context: from_run.patient_context,
        top_diagnosis,
        confidence,
        differentials,
        inference_event_ids: from_run.steps
          .flatMap((s) => (s.tool_call?.tool === "run_inference" ? [s.tool_call.output] : []))
          .map((o: any) => o?.inference_event_id),
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Any agent → Compliance consultation
  async consultCompliance(
    from_run: AgentRun,
    action_description: string,
    regulatory_concern: string
  ): Promise<void> {
    await this.bus.publish({
      message_id: `msg_${Date.now()}`,
      from_agent: from_run.agent_role,
      to_agent: "compliance",
      run_id: from_run.run_id,
      patient_id: from_run.patient_context.patient_id,
      type: "consultation",
      payload: {
        action_description,
        regulatory_concern,
        requesting_agent: from_run.agent_role,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Diagnostic/Treatment → Followup scheduling
  async scheduleFollowup(
    from_run: AgentRun,
    reason: string,
    days_from_now: number
  ): Promise<void> {
    await this.bus.publish({
      message_id: `msg_${Date.now()}`,
      from_agent: from_run.agent_role,
      to_agent: "followup",
      run_id: from_run.run_id,
      patient_id: from_run.patient_context.patient_id,
      type: "handoff",
      payload: { reason, days_from_now, patient_context: from_run.patient_context },
      timestamp: new Date().toISOString(),
    });
  }

  // Any agent → critical alert broadcast
  async broadcastAlert(
    from_run: AgentRun,
    severity: "info" | "warning" | "critical",
    message: string
  ): Promise<void> {
    const targets: AgentRole[] = ["triage", "diagnostic", "compliance"];
    await Promise.all(
      targets.map((to_agent) =>
        this.bus.publish({
          message_id: `msg_${Date.now()}_${to_agent}`,
          from_agent: from_run.agent_role,
          to_agent,
          run_id: from_run.run_id,
          patient_id: from_run.patient_context.patient_id,
          type: "alert",
          payload: { severity, message, broadcast: true },
          timestamp: new Date().toISOString(),
        })
      )
    );
  }
}

// ─── Agent workflow graph ─────────────────────────────────────
// Defines legal handoff paths between agents
export const AGENT_WORKFLOW_GRAPH: Record<AgentRole, AgentRole[]> = {
  triage: ["diagnostic", "compliance"],
  diagnostic: ["treatment", "compliance", "followup"],
  treatment: ["compliance", "followup", "billing"],
  compliance: [],
  followup: ["billing"],
  billing: [],
};

export function canHandoff(from: AgentRole, to: AgentRole): boolean {
  return AGENT_WORKFLOW_GRAPH[from]?.includes(to) ?? false;
}
