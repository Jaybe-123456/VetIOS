// ============================================================
// VetIOS GaaS — Platform Bootstrap
// Wire together all GaaS layers on top of the VetIOS runtime.
// ============================================================

import { AgentRuntime, type AgentRuntimeConfig } from "./agents/agent-runtime";
import { InMemoryStore, SupabaseMemoryStore } from "./lib/memory-store";
import { ToolRegistry, ToolExecutor, buildDefaultTools } from "./lib/tool-registry";
import { HITLManager, InMemoryHITLStore } from "./lib/hitl";
import { InProcessMessageBus, AgentCoordinator } from "./lib/coordination";
import { TenantProvisioner, InMemoryTenantStore, UsageMeter } from "./lib/tenant";
import type { AgentRun } from "./types/agent";

// Re-export API route handlers and types for consumers
export {
  executeRunAgent,
  handleRunAgent,
  handleResumeAgent,
  handleListInterrupts,
  isAgentRole,
  toAgentRunResponse,
  type RunAgentRequest,
  type ResumeAgentRequest,
} from "./api/routes";
export type {
  AgentRun,
  AgentRunResponse,
  AgentResumeResponse,
  AgentRole,
  AgentStatus,
  HITLInterrupt,
  PatientContext,
  TenantConfig,
} from "./types/agent";

export interface GaaSPlatformConfig {
  vetiosBaseUrl: string;
  authToken: string;
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  notifyOnHITL?: (interrupt: import("./types/agent").HITLInterrupt) => Promise<void>;
}

export interface GaaSPlatform {
  runtime: AgentRuntime;
  hitlManager: HITLManager;
  coordinator: AgentCoordinator;
  tenantProvisioner: TenantProvisioner;
  usageMeter: UsageMeter;
  runStore: Map<string, AgentRun>;
}

export function bootstrapGaaSPlatform(config: GaaSPlatformConfig): GaaSPlatform {
  // ─── Memory Layer ────────────────────────────────────────
  const memoryStore =
    config.supabaseUrl && config.supabaseServiceKey
      ? new SupabaseMemoryStore(config.supabaseUrl, config.supabaseServiceKey)
      : new InMemoryStore();

  // ─── Tool Layer ──────────────────────────────────────────
  const toolRegistry = new ToolRegistry();
  const defaultTools = buildDefaultTools(config.vetiosBaseUrl, config.authToken);
  defaultTools.forEach((tool) => toolRegistry.register(tool));

  const toolExecutor = new ToolExecutor(toolRegistry, config.vetiosBaseUrl, config.authToken);

  // ─── HITL Layer ──────────────────────────────────────────
  const hitlStore = new InMemoryHITLStore();
  const hitlManager = new HITLManager(hitlStore, config.notifyOnHITL);

  // ─── Coordination Layer ──────────────────────────────────
  const messageBus = new InProcessMessageBus();
  const coordinator = new AgentCoordinator(messageBus);

  // ─── Agent Runtime ───────────────────────────────────────
  const runtimeConfig: AgentRuntimeConfig = {
    vetiosBaseUrl: config.vetiosBaseUrl,
    authToken: config.authToken,
  };

  const runtime = new AgentRuntime(runtimeConfig, memoryStore, toolExecutor, hitlManager);

  // ─── Tenant Layer ────────────────────────────────────────
  const tenantStore = new InMemoryTenantStore();
  const tenantProvisioner = new TenantProvisioner(tenantStore);

  // ─── Usage Metering ──────────────────────────────────────
  const usageMeter = new UsageMeter();

  // ─── Run Store (in-memory; swap with DB in prod) ─────────
  const runStore = new Map<string, AgentRun>();

  return {
    runtime,
    hitlManager,
    coordinator,
    tenantProvisioner,
    usageMeter,
    runStore,
  };
}

// ─── Quick-start example ─────────────────────────────────────
export async function quickStartExample(): Promise<void> {
  const platform = bootstrapGaaSPlatform({
    vetiosBaseUrl: "https://api.vetios.tech/v1",
    authToken: process.env.VETIOS_AUTH_TOKEN ?? "your_token_here",
    notifyOnHITL: async (interrupt) => {
      console.log("⚠️  HITL Interrupt raised:", interrupt.interrupt_id);
      console.log("   Reason:", interrupt.reason);
      console.log("   Patient:", (interrupt.context_snapshot as Record<string, unknown>)["patient_id"] as string);
    },
  });

  // Provision a tenant
  const tenant = await platform.tenantProvisioner.provision({
    name: "Nairobi Veterinary Clinic",
    active_agents: ["triage", "diagnostic", "treatment"],
    alert_email: "vet@clinic.co.ke",
  });

  console.log("Tenant provisioned:", tenant.tenant_id);

  // Start a diagnostic agent run
  const { handleRunAgent } = await import("./api/routes");
  const result = await handleRunAgent(
    {
      tenant_id: tenant.tenant_id,
      agent_role: "diagnostic",
      patient_context: {
        patient_id: "patient_001",
        species: "canine",
        breed: "mixed",
        age_years: 3,
        symptoms: ["vomiting", "lethargy"],
        metadata: {
          labs: { wbc: 4.1, pcv: 29 },
          hydration: "low",
        },
      },
      goal: {
        description: "Produce ranked differential diagnosis for presenting symptoms",
        max_steps: 8,
      },
    },
    platform.runtime
  );

  // Store run for later resume operations
    platform.runStore.set(result.run_id, result as unknown as import("./types/agent").AgentRun);
  platform.usageMeter.record({
    tenant_id: tenant.tenant_id,
    event_type: "agent_run",
    agent_role: "diagnostic",
    timestamp: new Date().toISOString(),
  });

  console.log("\nAgent run result:");
  console.log("  Status:", result.status);
  console.log("  Steps:", result.steps_completed);
  if (result.current_interrupt) {
    console.log("  Awaiting human review:", result.current_interrupt.interrupt_id);
  }
  if (result.result) {
    console.log("  Summary:", result.result.summary);
  }
}
