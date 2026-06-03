export interface GBSRankRequest {
  nodes: Array<{ id: string; weight: number }>;
  edges: Array<{ source: string; target: string; weight: number }>;
  top_k?: number;
  n_samples?: number;
  n_iterations?: number;
}

export interface GBSRankResponse {
  ranked_node_ids: string[];
  clique_weight: number;
  samples_used: number;
  backend: string;
  latency_ms: number;
  classical_max_weight?: number;
  quantum_advantage?: number;
}

export class GBSClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 10_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async rank(request: GBSRankRequest): Promise<GBSRankResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/rank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`GBS service returned ${response.status}`);
      }
      return await response.json() as GBSRankResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 2_000));
      try {
        const response = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
        return response.ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }
}
