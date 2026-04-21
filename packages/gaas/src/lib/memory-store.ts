// ============================================================
// VetIOS GaaS — Longitudinal Patient Memory Store
// Persists patient history across agent sessions.
// Built on top of the existing Supabase layer.
// ============================================================

import type { MemoryEntry, PatientContext } from "../types/agent";

export interface MemoryQueryOptions {
  limit?: number;
  type?: MemoryEntry["type"];
  since?: string; // ISO timestamp
  until?: string; // ISO timestamp
}

export interface MemoryStoreAdapter {
  get(patient_id: string, options?: MemoryQueryOptions): Promise<MemoryEntry[]>;
  append(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry>;
  search(patient_id: string, query: string, top_k?: number): Promise<MemoryEntry[]>;
  summarize(patient_id: string): Promise<string>;
  clear(patient_id: string): Promise<void>;
}

// ─── In-memory adapter (development / testing) ───────────────
export class InMemoryStore implements MemoryStoreAdapter {
  private store = new Map<string, MemoryEntry[]>();

  async get(patient_id: string, opts: MemoryQueryOptions = {}): Promise<MemoryEntry[]> {
    let entries = this.store.get(patient_id) ?? [];

    if (opts.type) {
      entries = entries.filter((e) => e.type === opts.type);
    }
    if (opts.since) {
      entries = entries.filter((e) => e.timestamp >= opts.since!);
    }
    if (opts.until) {
      entries = entries.filter((e) => e.timestamp <= opts.until!);
    }

    return entries.slice(-(opts.limit ?? 50));
  }

  async append(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry> {
    const full: MemoryEntry = {
      ...entry,
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    };
    const existing = this.store.get(entry.patient_id) ?? [];
    this.store.set(entry.patient_id, [...existing, full]);
    return full;
  }

  async search(patient_id: string, query: string, top_k = 5): Promise<MemoryEntry[]> {
    // Naive keyword search for dev mode — swap with vector search in production
    const entries = this.store.get(patient_id) ?? [];
    const tokens = query.toLowerCase().split(" ");
    const scored = entries.map((entry) => {
      const text = JSON.stringify(entry.content).toLowerCase();
      const score = tokens.filter((t) => text.includes(t)).length;
      return { entry, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, top_k)
      .map((s) => s.entry);
  }

  async summarize(patient_id: string): Promise<string> {
    const entries = this.store.get(patient_id) ?? [];
    if (!entries.length) return "No prior history.";

    const grouped = entries.reduce<Record<string, MemoryEntry[]>>((acc, e) => {
      acc[e.type] = [...(acc[e.type] ?? []), e];
      return acc;
    }, {});

    const lines: string[] = [`Patient ${patient_id} — ${entries.length} memory entries`];
    for (const [type, items] of Object.entries(grouped)) {
      lines.push(`  ${type}: ${items.length} records (latest: ${items.at(-1)?.timestamp})`);
    }
    return lines.join("\n");
  }

  async clear(patient_id: string): Promise<void> {
    this.store.delete(patient_id);
  }
}

// ─── Supabase adapter (production) ───────────────────────────
export class SupabaseMemoryStore implements MemoryStoreAdapter {
  constructor(
    private supabaseUrl: string,
    private serviceKey: string
  ) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
    };
  }

  async get(patient_id: string, opts: MemoryQueryOptions = {}): Promise<MemoryEntry[]> {
    const params = new URLSearchParams({ patient_id, order: "timestamp.asc" });
    if (opts.type) params.set("type", `eq.${opts.type}`);
    if (opts.since) params.set("timestamp", `gte.${opts.since}`);
    if (opts.limit) params.set("limit", String(opts.limit));

    const res = await fetch(
      `${this.supabaseUrl}/rest/v1/patient_memory?${params}`,
      { headers: this.headers() }
    );
    if (!res.ok) throw new Error(`Memory fetch failed: ${res.status}`);
    return res.json();
  }

  async append(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry> {
    const res = await fetch(`${this.supabaseUrl}/rest/v1/patient_memory`, {
      method: "POST",
      headers: { ...this.headers(), Prefer: "return=representation" },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error(`Memory append failed: ${res.status}`);
    const rows = await res.json();
    return rows[0];
  }

  async search(patient_id: string, query: string, top_k = 5): Promise<MemoryEntry[]> {
    // Uses Supabase pgvector full-text search endpoint
    const res = await fetch(`${this.supabaseUrl}/rest/v1/rpc/search_patient_memory`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ p_patient_id: patient_id, p_query: query, p_limit: top_k }),
    });
    if (!res.ok) throw new Error(`Memory search failed: ${res.status}`);
    return res.json();
  }

  async summarize(patient_id: string): Promise<string> {
    const entries = await this.get(patient_id, { limit: 100 });
    if (!entries.length) return "No prior history.";

    const counts = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});

    const countStr = Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    return `Patient ${patient_id}: ${countStr} across ${entries.length} total records.`;
  }

  async clear(patient_id: string): Promise<void> {
    await fetch(
      `${this.supabaseUrl}/rest/v1/patient_memory?patient_id=eq.${patient_id}`,
      { method: "DELETE", headers: this.headers() }
    );
  }
}

// ─── Memory context builder (for agent prompt injection) ──────
export async function buildMemoryContext(
  store: MemoryStoreAdapter,
  patient_id: string,
  current_query: string
): Promise<{ summary: string; relevant_entries: MemoryEntry[] }> {
  const [summary, relevant_entries] = await Promise.all([
    store.summarize(patient_id),
    store.search(patient_id, current_query, 8),
  ]);
  return { summary, relevant_entries };
}
