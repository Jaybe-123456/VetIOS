// ============================================================
// VetIOS GaaS — Tenant Management Layer
// Multi-tenant provisioning, agent config, and monitoring.
// ============================================================

import type { TenantConfig, AgentRole, AgentPolicy } from "../types/agent";
import { DEFAULT_POLICIES } from "../api/routes";

export interface TenantStore {
  create(config: TenantConfig): Promise<TenantConfig>;
  get(tenant_id: string): Promise<TenantConfig | null>;
  update(tenant_id: string, patch: Partial<TenantConfig>): Promise<TenantConfig>;
  list(): Promise<TenantConfig[]>;
  delete(tenant_id: string): Promise<void>;
}

// ─── In-memory tenant store (dev) ────────────────────────────
export class InMemoryTenantStore implements TenantStore {
  private store = new Map<string, TenantConfig>();

  async create(config: TenantConfig): Promise<TenantConfig> {
    this.store.set(config.tenant_id, config);
    return config;
  }

  async get(tenant_id: string): Promise<TenantConfig | null> {
    return this.store.get(tenant_id) ?? null;
  }

  async update(tenant_id: string, patch: Partial<TenantConfig>): Promise<TenantConfig> {
    const existing = this.store.get(tenant_id);
    if (!existing) throw new Error(`Tenant ${tenant_id} not found`);
    const updated = { ...existing, ...patch };
    this.store.set(tenant_id, updated);
    return updated;
  }

  async list(): Promise<TenantConfig[]> {
    return Array.from(this.store.values());
  }

  async delete(tenant_id: string): Promise<void> {
    this.store.delete(tenant_id);
  }
}

// ─── Tenant Provisioner ──────────────────────────────────────
export class TenantProvisioner {
  constructor(private store: TenantStore) {}

  async provision(params: {
    name: string;
    active_agents?: AgentRole[];
    policy_overrides?: Partial<Record<AgentRole, Partial<AgentPolicy>>>;
    webhook_url?: string;
    alert_email?: string;
  }): Promise<TenantConfig> {
    const tenant_id = `tenant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const active_agents: AgentRole[] = params.active_agents ?? ["triage", "diagnostic"];

    const default_policies = Object.fromEntries(
      active_agents.map((role) => [
        role,
        { ...DEFAULT_POLICIES[role], ...(params.policy_overrides?.[role] ?? {}) },
      ])
    ) as Record<AgentRole, AgentPolicy>;

    const config: TenantConfig = {
      tenant_id,
      name: params.name,
      active_agents,
      default_policies,
      webhook_url: params.webhook_url,
      alert_email: params.alert_email,
      created_at: new Date().toISOString(),
    };

    return this.store.create(config);
  }

  async addAgent(tenant_id: string, role: AgentRole, policy?: Partial<AgentPolicy>): Promise<TenantConfig> {
    const tenant = await this.store.get(tenant_id);
    if (!tenant) throw new Error(`Tenant ${tenant_id} not found`);

    const merged_policy = { ...DEFAULT_POLICIES[role], ...(policy ?? {}) };
    return this.store.update(tenant_id, {
      active_agents: [...new Set([...tenant.active_agents, role])],
      default_policies: { ...tenant.default_policies, [role]: merged_policy },
    });
  }

  async removeAgent(tenant_id: string, role: AgentRole): Promise<TenantConfig> {
    const tenant = await this.store.get(tenant_id);
    if (!tenant) throw new Error(`Tenant ${tenant_id} not found`);
    const { [role]: _, ...remaining_policies } = tenant.default_policies;
    return this.store.update(tenant_id, {
      active_agents: tenant.active_agents.filter((a) => a !== role),
      default_policies: remaining_policies as Record<AgentRole, AgentPolicy>,
    });
  }

  async getPolicy(tenant_id: string, role: AgentRole): Promise<AgentPolicy> {
    const tenant = await this.store.get(tenant_id);
    if (!tenant) throw new Error(`Tenant ${tenant_id} not found`);
    return tenant.default_policies[role] ?? DEFAULT_POLICIES[role];
  }
}

// ─── Usage Metering (GaaS billing hook) ──────────────────────
export interface UsageEvent {
  tenant_id: string;
  event_type: "agent_run" | "tool_call" | "hitl_interrupt" | "memory_read" | "memory_write";
  agent_role?: AgentRole;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export class UsageMeter {
  private events: UsageEvent[] = [];

  record(event: UsageEvent): void {
    this.events.push(event);
  }

  getUsage(tenant_id: string, since?: string): UsageEvent[] {
    return this.events
      .filter((e) => e.tenant_id === tenant_id)
      .filter((e) => !since || e.timestamp >= since);
  }

  summarize(tenant_id: string): Record<string, number> {
    const events = this.getUsage(tenant_id);
    return events.reduce<Record<string, number>>((acc, e) => {
      acc[e.event_type] = (acc[e.event_type] ?? 0) + 1;
      return acc;
    }, {});
  }
}
