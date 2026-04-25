/**
 * VetIOS Veterinary Knowledge Graph (VKG)
 *
 * Structured graph of veterinary clinical relationships:
 *   Disease → Symptom → Pathogen → Treatment → Drug →
 *   Contraindication → Species → Breed → Age → Lab Finding
 *
 * Replaces flat ontology look-ups with traversable relationship graphs.
 * Every inference call can now navigate relationships rather than
 * pattern-match against flat lists.
 *
 * Architecture: adjacency lists stored in-memory (hot path) + Supabase
 * persistence for the canonical ontology.
 */

// ─── Node Types ──────────────────────────────────────────────

export type VKGNodeType =
  | 'disease'
  | 'symptom'
  | 'pathogen'
  | 'drug'
  | 'treatment_protocol'
  | 'lab_finding'
  | 'species'
  | 'breed'
  | 'contraindication_condition';

export type VKGEdgeType =
  | 'presents_with'        // disease → symptom
  | 'caused_by'            // disease → pathogen
  | 'treated_by'           // disease → treatment_protocol
  | 'uses_drug'            // treatment_protocol → drug
  | 'contraindicated_in'   // drug → contraindication_condition
  | 'associated_lab'       // disease → lab_finding
  | 'affects_species'      // disease → species
  | 'breed_predisposition' // disease → breed
  | 'differentiates_from'  // disease → disease (differential)
  | 'progresses_to'        // disease → disease (progression)
  | 'synergistic_with'     // drug → drug
  | 'antagonistic_with';   // drug → drug

export interface VKGNode {
  id: string;
  type: VKGNodeType;
  label: string;
  metadata: Record<string, unknown>;
}

export interface VKGEdge {
  from: string;    // node id
  to: string;      // node id
  type: VKGEdgeType;
  weight: number;  // 0-1 clinical significance
  evidence: 'strong' | 'moderate' | 'weak' | 'anecdotal';
  species_scope?: string[];
}

export interface VKGPath {
  nodes: VKGNode[];
  edges: VKGEdge[];
  totalWeight: number;
  clinicalSignificance: 'high' | 'moderate' | 'low';
}

// ─── Knowledge Graph ─────────────────────────────────────────

export class VeterinaryKnowledgeGraph {
  private nodes = new Map<string, VKGNode>();
  private adjacency = new Map<string, VKGEdge[]>(); // from_id → edges
  private reverseIndex = new Map<string, VKGEdge[]>(); // to_id → edges (for reverse traversal)

  constructor() {
    this.seedCorpus();
  }

  // ─── Graph Construction ──────────────────────────────────

  addNode(node: VKGNode): void {
    this.nodes.set(node.id, node);
    if (!this.adjacency.has(node.id)) this.adjacency.set(node.id, []);
    if (!this.reverseIndex.has(node.id)) this.reverseIndex.set(node.id, []);
  }

  addEdge(edge: VKGEdge): void {
    const outEdges = this.adjacency.get(edge.from) ?? [];
    outEdges.push(edge);
    this.adjacency.set(edge.from, outEdges);

    const inEdges = this.reverseIndex.get(edge.to) ?? [];
    inEdges.push(edge);
    this.reverseIndex.set(edge.to, inEdges);
  }

  // ─── Traversal ───────────────────────────────────────────

  /**
   * Get all direct neighbours of a node by edge type.
   */
  neighbours(nodeId: string, edgeType?: VKGEdgeType): VKGNode[] {
    const edges = this.adjacency.get(nodeId) ?? [];
    const filtered = edgeType ? edges.filter((e) => e.type === edgeType) : edges;
    return filtered
      .sort((a, b) => b.weight - a.weight)
      .map((e) => this.nodes.get(e.to))
      .filter((n): n is VKGNode => n !== undefined);
  }

  /**
   * Get all diseases associated with a symptom set.
   * Core differential generation function.
   */
  getDiseasesForSymptoms(symptoms: string[], species?: string): Array<{
    disease: VKGNode;
    matchedSymptoms: string[];
    score: number;
  }> {
    const symptomIds = symptoms.map((s) => `symptom:${s.toLowerCase().replace(/\s+/g, '_')}`);
    const diseaseScores = new Map<string, { disease: VKGNode; matched: Set<string>; totalWeight: number }>();

    for (const symId of symptomIds) {
      const inEdges = this.reverseIndex.get(symId) ?? [];
      for (const edge of inEdges) {
        if (edge.type !== 'presents_with') continue;
        const disease = this.nodes.get(edge.from);
        if (!disease || disease.type !== 'disease') continue;

        // Filter by species scope if specified
        if (species && edge.species_scope && edge.species_scope.length > 0) {
          if (!edge.species_scope.includes(species)) continue;
        }

        const existing = diseaseScores.get(edge.from) ?? {
          disease,
          matched: new Set<string>(),
          totalWeight: 0,
        };
        existing.matched.add(symId);
        existing.totalWeight += edge.weight;
        diseaseScores.set(edge.from, existing);
      }
    }

    return Array.from(diseaseScores.values())
      .map(({ disease, matched, totalWeight }) => ({
        disease,
        matchedSymptoms: Array.from(matched).map((id) =>
          id.replace('symptom:', '').replace(/_/g, ' ')
        ),
        score: totalWeight / Math.max(symptomIds.length, 1),
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Get all contraindications for a drug in a given species/condition context.
   */
  getDrugContraindications(drugId: string, species?: string): VKGNode[] {
    const edges = this.adjacency.get(`drug:${drugId}`) ?? [];
    return edges
      .filter((e) => {
        if (e.type !== 'contraindicated_in') return false;
        if (species && e.species_scope && !e.species_scope.includes(species)) return false;
        return true;
      })
      .sort((a, b) => b.weight - a.weight)
      .map((e) => this.nodes.get(e.to))
      .filter((n): n is VKGNode => n !== undefined);
  }

  /**
   * Find shortest path between two nodes using BFS.
   * Used to explain clinical reasoning: "Why is CKD likely given these symptoms?"
   */
  findPath(fromId: string, toId: string, maxDepth = 4): VKGPath | null {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return null;

    const queue: Array<{ id: string; path: string[]; edges: VKGEdge[] }> = [
      { id: fromId, path: [fromId], edges: [] },
    ];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.id === toId) {
        const nodes = current.path.map((id) => this.nodes.get(id)!).filter(Boolean);
        const totalWeight = current.edges.reduce((s, e) => s + e.weight, 0) / Math.max(current.edges.length, 1);
        return {
          nodes,
          edges: current.edges,
          totalWeight,
          clinicalSignificance: totalWeight > 0.7 ? 'high' : totalWeight > 0.4 ? 'moderate' : 'low',
        };
      }

      if (current.path.length >= maxDepth) continue;

      const outEdges = this.adjacency.get(current.id) ?? [];
      for (const edge of outEdges) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push({
            id: edge.to,
            path: [...current.path, edge.to],
            edges: [...current.edges, edge],
          });
        }
      }
    }

    return null;
  }

  /**
   * Get disease progression pathways.
   * "If untreated CKD stage 2, what does this progress to?"
   */
  getProgressionPathway(diseaseId: string): VKGNode[] {
    return this.neighbours(diseaseId, 'progresses_to');
  }

  /**
   * Get differentials for a disease — diseases to rule out.
   */
  getDifferentials(diseaseId: string, species?: string): VKGNode[] {
    const edges = this.adjacency.get(diseaseId) ?? [];
    return edges
      .filter((e) => {
        if (e.type !== 'differentiates_from') return false;
        if (species && e.species_scope && !e.species_scope.includes(species)) return false;
        return true;
      })
      .sort((a, b) => b.weight - a.weight)
      .map((e) => this.nodes.get(e.to))
      .filter((n): n is VKGNode => n !== undefined);
  }

  getNode(id: string): VKGNode | undefined {
    return this.nodes.get(id);
  }

  getStats(): { nodeCount: number; edgeCount: number; nodeTypes: Record<string, number> } {
    const nodeTypes: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
    }
    const edgeCount = Array.from(this.adjacency.values()).reduce((s, e) => s + e.length, 0);
    return { nodeCount: this.nodes.size, edgeCount, nodeTypes };
  }

  // ─── Corpus Seed ─────────────────────────────────────────

  /**
   * Seeds the canonical veterinary clinical ontology.
   * This is the foundation of the VetIOS Ontology Standard.
   * Production: loaded from Supabase vkg_nodes / vkg_edges tables.
   */
  private seedCorpus(): void {
    // ── Species ──
    for (const s of ['feline', 'canine', 'equine', 'bovine', 'avian', 'exotic']) {
      this.addNode({ id: `species:${s}`, type: 'species', label: s, metadata: {} });
    }

    // ── Core Feline Diseases ──
    const felineDiseases = [
      { id: 'disease:feline_ckd', label: 'Feline Chronic Kidney Disease', stage: '2-4' },
      { id: 'disease:feline_hyperthyroidism', label: 'Feline Hyperthyroidism' },
      { id: 'disease:feline_diabetes', label: 'Feline Diabetes Mellitus' },
      { id: 'disease:feline_hepatic_lipidosis', label: 'Feline Hepatic Lipidosis' },
      { id: 'disease:feline_pancreatitis', label: 'Feline Pancreatitis' },
      { id: 'disease:feline_lymphoma', label: 'Feline Lymphoma' },
      { id: 'disease:feline_asthma', label: 'Feline Asthma' },
      { id: 'disease:feline_uri', label: 'Feline Upper Respiratory Infection' },
    ];

    for (const d of felineDiseases) {
      this.addNode({ id: d.id, type: 'disease', label: d.label, metadata: { ...d } });
    }

    // ── Core Canine Diseases ──
    const canineDiseases = [
      { id: 'disease:canine_parvovirus', label: 'Canine Parvovirus' },
      { id: 'disease:canine_distemper', label: 'Canine Distemper' },
      { id: 'disease:canine_pancreatitis', label: 'Canine Pancreatitis' },
      { id: 'disease:canine_diabetes', label: 'Canine Diabetes Mellitus' },
      { id: 'disease:canine_cushings', label: "Canine Cushing's Disease" },
      { id: 'disease:canine_addisons', label: "Canine Addison's Disease" },
      { id: 'disease:canine_bloat', label: 'Canine Gastric Dilatation-Volvulus' },
      { id: 'disease:canine_lymphoma', label: 'Canine Lymphoma' },
      { id: 'disease:canine_ehrlichia', label: 'Canine Ehrlichiosis' },
    ];

    for (const d of canineDiseases) {
      this.addNode({ id: d.id, type: 'disease', label: d.label, metadata: { ...d } });
    }

    // ── Symptoms ──
    const symptoms = [
      'weight_loss', 'polyuria', 'polydipsia', 'vomiting', 'lethargy',
      'anorexia', 'diarrhoea', 'jaundice', 'ascites', 'dyspnoea',
      'pale_mucous_membranes', 'haematuria', 'melena', 'polyphagia',
      'muscle_wasting', 'dehydration', 'hypothermia', 'hyperthermia',
      'haemorrhagic_diarrhoea', 'ataxia', 'seizures', 'collapse',
      'coughing', 'nasal_discharge', 'ocular_discharge', 'sneezing',
      'abdominal_pain', 'abdominal_distension', 'weakness', 'tachycardia',
    ];

    for (const s of symptoms) {
      this.addNode({
        id: `symptom:${s}`,
        type: 'symptom',
        label: s.replace(/_/g, ' '),
        metadata: {},
      });
    }

    // ── Lab Findings ──
    const labFindings = [
      { id: 'lab:elevated_bun', label: 'Elevated BUN' },
      { id: 'lab:elevated_creatinine', label: 'Elevated Creatinine' },
      { id: 'lab:elevated_alt', label: 'Elevated ALT' },
      { id: 'lab:elevated_alp', label: 'Elevated ALP' },
      { id: 'lab:elevated_t4', label: 'Elevated T4' },
      { id: 'lab:elevated_glucose', label: 'Elevated Glucose' },
      { id: 'lab:glucosuria', label: 'Glucosuria' },
      { id: 'lab:low_pcv', label: 'Low PCV / Anaemia' },
      { id: 'lab:thrombocytopenia', label: 'Thrombocytopenia' },
      { id: 'lab:elevated_lipase', label: 'Elevated Lipase' },
      { id: 'lab:hypokalaemia', label: 'Hypokalaemia' },
      { id: 'lab:hypercalcaemia', label: 'Hypercalcaemia' },
      { id: 'lab:low_albumin', label: 'Low Albumin / Hypoalbuminaemia' },
      { id: 'lab:leucopenia', label: 'Leucopenia' },
      { id: 'lab:leucocytosis', label: 'Leucocytosis' },
    ];

    for (const l of labFindings) {
      this.addNode({ id: l.id, type: 'lab_finding', label: l.label, metadata: {} });
    }

    // ── Drugs ──
    const drugs = [
      { id: 'drug:meloxicam', label: 'Meloxicam (NSAID)' },
      { id: 'drug:prednisolone', label: 'Prednisolone' },
      { id: 'drug:dexamethasone', label: 'Dexamethasone' },
      { id: 'drug:enrofloxacin', label: 'Enrofloxacin' },
      { id: 'drug:amoxicillin_clavulanate', label: 'Amoxicillin-Clavulanate' },
      { id: 'drug:insulin_glargine', label: 'Insulin Glargine' },
      { id: 'drug:methimazole', label: 'Methimazole' },
      { id: 'drug:amlodipine', label: 'Amlodipine' },
      { id: 'drug:benazepril', label: 'Benazepril (ACE inhibitor)' },
      { id: 'drug:furosemide', label: 'Furosemide' },
      { id: 'drug:maropitant', label: 'Maropitant (Cerenia)' },
      { id: 'drug:metronidazole', label: 'Metronidazole' },
      { id: 'drug:sucralfate', label: 'Sucralfate' },
      { id: 'drug:omeprazole', label: 'Omeprazole' },
    ];

    for (const d of drugs) {
      this.addNode({ id: d.id, type: 'drug', label: d.label, metadata: {} });
    }

    // ── Contraindication Conditions ──
    const conditions = [
      { id: 'cond:renal_impairment', label: 'Renal Impairment / CKD' },
      { id: 'cond:hepatic_impairment', label: 'Hepatic Impairment' },
      { id: 'cond:gi_ulceration', label: 'GI Ulceration' },
      { id: 'cond:pregnancy', label: 'Pregnancy' },
      { id: 'cond:bleeding_disorder', label: 'Bleeding Disorder / Coagulopathy' },
      { id: 'cond:diabetes', label: 'Diabetes Mellitus' },
      { id: 'cond:hypoadrenocorticism', label: 'Hypoadrenocorticism' },
      { id: 'cond:hypertension', label: 'Systemic Hypertension' },
      { id: 'cond:juvenile', label: 'Growing Juvenile (< 12 months)' },
    ];

    for (const c of conditions) {
      this.addNode({ id: c.id, type: 'contraindication_condition', label: c.label, metadata: {} });
    }

    // ─── Edges: Feline CKD relationships ──────────────────

    const fCkd = 'disease:feline_ckd';
    const sCkdSymptoms = [
      ['weight_loss', 0.95], ['polyuria', 0.90], ['polydipsia', 0.88],
      ['vomiting', 0.75], ['lethargy', 0.80], ['anorexia', 0.70],
      ['dehydration', 0.65], ['muscle_wasting', 0.60],
    ] as const;
    for (const [sym, w] of sCkdSymptoms) {
      this.addEdge({ from: fCkd, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['feline'] });
    }
    this.addEdge({ from: fCkd, to: 'lab:elevated_bun', type: 'associated_lab', weight: 0.95, evidence: 'strong', species_scope: ['feline'] });
    this.addEdge({ from: fCkd, to: 'lab:elevated_creatinine', type: 'associated_lab', weight: 0.95, evidence: 'strong', species_scope: ['feline'] });
    this.addEdge({ from: fCkd, to: 'lab:hypokalaemia', type: 'associated_lab', weight: 0.60, evidence: 'moderate', species_scope: ['feline'] });
    this.addEdge({ from: fCkd, to: 'disease:feline_hyperthyroidism', type: 'differentiates_from', weight: 0.80, evidence: 'strong', species_scope: ['feline'] });
    this.addEdge({ from: fCkd, to: 'disease:feline_diabetes', type: 'differentiates_from', weight: 0.60, evidence: 'moderate', species_scope: ['feline'] });

    // ─── Edges: Drug contraindications ────────────────────

    this.addEdge({ from: 'drug:meloxicam', to: 'cond:renal_impairment', type: 'contraindicated_in', weight: 0.95, evidence: 'strong', species_scope: ['feline', 'canine'] });
    this.addEdge({ from: 'drug:meloxicam', to: 'cond:gi_ulceration', type: 'contraindicated_in', weight: 0.90, evidence: 'strong' });
    this.addEdge({ from: 'drug:meloxicam', to: 'cond:bleeding_disorder', type: 'contraindicated_in', weight: 0.85, evidence: 'strong' });
    this.addEdge({ from: 'drug:enrofloxacin', to: 'cond:juvenile', type: 'contraindicated_in', weight: 0.90, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: 'drug:prednisolone', to: 'cond:diabetes', type: 'contraindicated_in', weight: 0.80, evidence: 'strong' });
    this.addEdge({ from: 'drug:prednisolone', to: 'cond:gi_ulceration', type: 'contraindicated_in', weight: 0.75, evidence: 'strong' });
    this.addEdge({ from: 'drug:furosemide', to: 'cond:hypoadrenocorticism', type: 'contraindicated_in', weight: 0.85, evidence: 'strong' });

    // ─── Edges: Drug synergies / antagonisms ──────────────

    this.addEdge({ from: 'drug:meloxicam', to: 'drug:prednisolone', type: 'antagonistic_with', weight: 0.90, evidence: 'strong' });
    this.addEdge({ from: 'drug:benazepril', to: 'drug:furosemide', type: 'synergistic_with', weight: 0.80, evidence: 'moderate' });

    // ─── Edges: Canine Parvovirus ─────────────────────────

    const cParvo = 'disease:canine_parvovirus';
    const parvoSymptoms = [
      ['haemorrhagic_diarrhoea', 0.95], ['vomiting', 0.90], ['lethargy', 0.88],
      ['anorexia', 0.85], ['dehydration', 0.82], ['hypothermia', 0.65],
      ['pale_mucous_membranes', 0.60],
    ] as const;
    for (const [sym, w] of parvoSymptoms) {
      this.addEdge({ from: cParvo, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['canine'] });
    }
    this.addEdge({ from: cParvo, to: 'lab:leucopenia', type: 'associated_lab', weight: 0.90, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cParvo, to: 'lab:thrombocytopenia', type: 'associated_lab', weight: 0.70, evidence: 'moderate', species_scope: ['canine'] });

    // ─── Edges: Feline Hyperthyroidism ─────────────────────

    const fHyper = 'disease:feline_hyperthyroidism';
    for (const [sym, w] of [
      ['weight_loss', 0.92], ['polyphagia', 0.85], ['polyuria', 0.70],
      ['polydipsia', 0.68], ['vomiting', 0.55], ['diarrhoea', 0.50],
      ['tachycardia', 0.75],
    ] as const) {
      this.addEdge({ from: fHyper, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['feline'] });
    }
    this.addEdge({ from: fHyper, to: 'lab:elevated_t4', type: 'associated_lab', weight: 0.98, evidence: 'strong', species_scope: ['feline'] });
    this.addEdge({ from: fHyper, to: 'lab:elevated_alt', type: 'associated_lab', weight: 0.65, evidence: 'moderate', species_scope: ['feline'] });
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _vkg: VeterinaryKnowledgeGraph | null = null;

export function getVKG(): VeterinaryKnowledgeGraph {
  if (!_vkg) _vkg = new VeterinaryKnowledgeGraph();
  return _vkg;
}
