export interface PharmacophoreInput {
  id: string;
  type: 'HA' | 'HD' | 'NC' | 'AR';
  position: [number, number, number];
  is_protein: boolean;
}

export interface QIVSRequest {
  drug_smiles: string;
  pathogen_label: string;
  tau_flexibility?: number;
  epsilon_interaction?: number;
  n_samples?: number;
  n_iterations?: number;
  pharmacophores?: {
    receptor: PharmacophoreInput[];
    ligand: PharmacophoreInput[];
  };
}

export interface QIVSResponse {
  drug_smiles_hash: string;
  pathogen_label: string;
  big_node_count: number;
  big_edge_count: number;
  tau_flexibility: number;
  epsilon_interaction: number;
  max_clique_nodes: string[];
  max_clique_weight: number;
  binding_pose: {
    contacts: Array<{
      contact_id: string;
      protein_point: string;
      ligand_point: string;
      interaction_type: string;
      contact_weight: number;
    }>;
    n_contacts: number;
  };
  gbs_samples_used: number;
  gbs_backend: string;
  classical_max_weight: number;
  quantum_advantage: number;
  confidence_score: number;
  algorithm_version: string;
  paper_doi: string;
  latency_ms: number;
}

export interface RNAFoldRequest {
  sequence: string;
  pathogen_label: string;
  region?: string;
  reference_structure?: string;
  n_samples?: number;
  n_iterations?: number;
}

export interface RNAFoldResponse {
  sequence_hash: string;
  sequence_length: number;
  pathogen_label: string;
  region?: string | null;
  wfsg_node_count: number;
  wfsg_edge_count: number;
  predicted_stems: Array<{ start5: number; start3: number; length: number }>;
  secondary_structure: string;
  max_clique_weight: number;
  mcc_score?: number | null;
  gbs_backend: string;
  quantum_advantage: number;
  algorithm_version: string;
  paper_doi: string;
  latency_ms: number;
}

export class QIVSClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 45_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async screenDrug(request: QIVSRequest): Promise<QIVSResponse> {
    return this.post<QIVSResponse>('/qivs/screen', request);
  }

  async foldRNA(request: RNAFoldRequest): Promise<RNAFoldResponse> {
    return this.post<RNAFoldResponse>('/rna/fold', request);
  }

  async isAvailable(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 2_000));
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Quantum service error ${response.status}: ${JSON.stringify(error)}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
