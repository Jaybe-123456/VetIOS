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
  getDiseasesForSymptoms(
    symptoms: string[],
    species?: string,
    breed?: string | null,
    biomarkers?: Record<string, number | string> | null
  ): Array<{ disease: VKGNode; matchedSymptoms: string[]; score: number }> {
    const symptomIds = symptoms.map((s) => `symptom:${s.toLowerCase().replace(/\s+/g, '_')}`);
    const diseaseScores = new Map<string, { disease: VKGNode; matched: Set<string>; totalWeight: number }>();

    // ── Hop 1: symptom → disease via reverseIndex (unchanged) ──
    for (const symId of symptomIds) {
      const inEdges = this.reverseIndex.get(symId) ?? [];
      for (const edge of inEdges) {
        if (edge.type !== 'presents_with') continue;
        const disease = this.nodes.get(edge.from);
        if (!disease || disease.type !== 'disease') continue;
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

    // ── Hop 2: pathogen chaining — shared pathogen boosts co-implicated diseases ──
    const pathogensSeen = new Set<string>();
    for (const did of diseaseScores.keys()) {
      for (const edge of this.adjacency.get(did) ?? []) {
        if (edge.type === 'caused_by') pathogensSeen.add(edge.to);
      }
    }
    if (pathogensSeen.size > 0) {
      for (const [did, cand] of diseaseScores) {
        for (const edge of this.adjacency.get(did) ?? []) {
          if (edge.type === 'caused_by' && pathogensSeen.has(edge.to)) {
            cand.totalWeight += 0.15;
          }
        }
      }
    }

    // ── Hop 3: breed predisposition boost ──
    if (breed) {
      const breedKey = `breed:${breed.toLowerCase().replace(/\s+/g, '_')}`;
      for (const [did, cand] of diseaseScores) {
        for (const edge of this.adjacency.get(did) ?? []) {
          if (edge.type === 'breed_predisposition' && edge.to === breedKey) {
            cand.totalWeight += edge.weight * 0.20;
          }
        }
      }
    }

    // ── Hop 4: biomarker/lab confirmation boost ──
    if (biomarkers && Object.keys(biomarkers).length > 0) {
      const biomarkerKeys = Object.keys(biomarkers).map((k) => k.toLowerCase());
      for (const [did, cand] of diseaseScores) {
        for (const edge of this.adjacency.get(did) ?? []) {
          if (edge.type !== 'associated_lab') continue;
          const labName = edge.to.replace('lab:', '').toLowerCase();
          if (biomarkerKeys.some((bk) => labName.includes(bk) || bk.includes(labName))) {
            cand.totalWeight += edge.weight * 0.25;
          }
        }
      }
    }

    // ── Hop 5: differential chaining — linked differentials get fractional propagation ──
    for (const [did, cand] of diseaseScores) {
      for (const edge of this.adjacency.get(did) ?? []) {
        if (edge.type === 'differentiates_from') {
          const linked = diseaseScores.get(edge.to);
          if (linked) linked.totalWeight += cand.totalWeight * 0.10;
        }
      }
    }

    return Array.from(diseaseScores.values())
      .map(({ disease, matched, totalWeight }) => ({
        disease,
        matchedSymptoms: Array.from(matched).map((id) =>
          id.replace('symptom:', '').replace(/_/g, ' ')
        ),
        score: Math.min(totalWeight / Math.max(symptomIds.length, 1), 1.0),
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

    // ── Canine Pancreatitis ──────────────────────────────────────
    const cPanc = 'disease:canine_pancreatitis';
    this.addNode({ id: cPanc, label: 'Canine Pancreatitis', type: 'disease', metadata: {} });
    for (const [sym, w] of [
      ['vomiting', 0.90], ['abdominal_pain', 0.88], ['lethargy', 0.75],
      ['anorexia', 0.80], ['diarrhoea', 0.60], ['dehydration', 0.65],
    ] as const) {
      this.addEdge({ from: cPanc, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['canine'] });
    }
    this.addEdge({ from: cPanc, to: 'lab:elevated_lipase', type: 'associated_lab', weight: 0.92, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cPanc, to: 'lab:spec_cpl_elevated', type: 'associated_lab', weight: 0.95, evidence: 'strong', species_scope: ['canine'] });
    const tPancFluid = 'treatment:panc_supportive_fluids';
    this.addNode({ id: tPancFluid, label: 'IV Fluid Support', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: cPanc, to: tPancFluid, type: 'treated_by', weight: 0.95, evidence: 'strong' });
    const dMaropitant = 'drug:maropitant';
    this.addNode({ id: dMaropitant, label: 'Maropitant', type: 'drug', metadata: {} });
    this.addEdge({ from: tPancFluid, to: dMaropitant, type: 'uses_drug', weight: 0.85, evidence: 'strong' });
    this.addEdge({ from: cPanc, to: 'breed:miniature_schnauzer', type: 'breed_predisposition', weight: 0.75, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cPanc, to: 'breed:yorkshire_terrier', type: 'breed_predisposition', weight: 0.55, evidence: 'moderate', species_scope: ['canine'] });

    // ── Feline FLUTD ─────────────────────────────────────────────
    const fFlutd = 'disease:feline_flutd';
    this.addNode({ id: fFlutd, label: 'Feline FLUTD', type: 'disease', metadata: {} });
    for (const [sym, w] of [
      ['dysuria', 0.92], ['haematuria', 0.85], ['pollakiuria', 0.80],
      ['stranguria', 0.78], ['periuria', 0.70], ['vocalisation_pain', 0.65],
    ] as const) {
      this.addEdge({ from: fFlutd, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['feline'] });
    }
    this.addEdge({ from: fFlutd, to: 'lab:crystalluria', type: 'associated_lab', weight: 0.80, evidence: 'moderate', species_scope: ['feline'] });
    this.addEdge({ from: fFlutd, to: 'lab:haematuria_ua', type: 'associated_lab', weight: 0.88, evidence: 'strong', species_scope: ['feline'] });
    const tFlutdAnalgesia = 'treatment:flutd_analgesia';
    this.addNode({ id: tFlutdAnalgesia, label: 'Analgesia + Antispasmodic', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: fFlutd, to: tFlutdAnalgesia, type: 'treated_by', weight: 0.90, evidence: 'strong' });
    const dPrazosin = 'drug:prazosin';
    this.addNode({ id: dPrazosin, label: 'Prazosin', type: 'drug', metadata: {} });
    this.addEdge({ from: tFlutdAnalgesia, to: dPrazosin, type: 'uses_drug', weight: 0.70, evidence: 'moderate' });
    this.addEdge({ from: fFlutd, to: 'breed:persian', type: 'breed_predisposition', weight: 0.60, evidence: 'moderate', species_scope: ['feline'] });
    this.addEdge({ from: fFlutd, to: 'breed:ragdoll', type: 'breed_predisposition', weight: 0.45, evidence: 'weak', species_scope: ['feline'] });

    // ── Canine Hypothyroidism ─────────────────────────────────────
    const cHypo = 'disease:canine_hypothyroidism';
    this.addNode({ id: cHypo, label: 'Canine Hypothyroidism', type: 'disease', metadata: {} });
    for (const [sym, w] of [
      ['lethargy', 0.85], ['weight_gain', 0.82], ['cold_intolerance', 0.70],
      ['alopecia', 0.75], ['bradycardia', 0.60], ['skin_thickening', 0.55],
    ] as const) {
      this.addEdge({ from: cHypo, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['canine'] });
    }
    this.addEdge({ from: cHypo, to: 'lab:low_t4', type: 'associated_lab', weight: 0.95, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cHypo, to: 'lab:elevated_cholesterol', type: 'associated_lab', weight: 0.70, evidence: 'moderate', species_scope: ['canine'] });
    const tLevo = 'treatment:levothyroxine_therapy';
    this.addNode({ id: tLevo, label: 'Levothyroxine Supplementation', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: cHypo, to: tLevo, type: 'treated_by', weight: 0.98, evidence: 'strong' });
    const dLevo = 'drug:levothyroxine';
    this.addNode({ id: dLevo, label: 'Levothyroxine', type: 'drug', metadata: {} });
    this.addEdge({ from: tLevo, to: dLevo, type: 'uses_drug', weight: 0.98, evidence: 'strong' });
    this.addEdge({ from: cHypo, to: 'breed:golden_retriever', type: 'breed_predisposition', weight: 0.70, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cHypo, to: 'breed:doberman_pinscher', type: 'breed_predisposition', weight: 0.65, evidence: 'strong', species_scope: ['canine'] });

    // ── Canine Diabetes Mellitus ──────────────────────────────────
    const cDm = 'disease:canine_diabetes_mellitus';
    this.addNode({ id: cDm, label: 'Canine Diabetes Mellitus', type: 'disease', metadata: {} });
    for (const [sym, w] of [
      ['polyuria', 0.92], ['polydipsia', 0.92], ['weight_loss', 0.85],
      ['polyphagia', 0.80], ['lethargy', 0.65], ['cataracts', 0.55],
    ] as const) {
      this.addEdge({ from: cDm, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['canine'] });
    }
    this.addEdge({ from: cDm, to: 'lab:hyperglycaemia', type: 'associated_lab', weight: 0.98, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cDm, to: 'lab:glucosuria', type: 'associated_lab', weight: 0.95, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cDm, to: 'lab:elevated_fructosamine', type: 'associated_lab', weight: 0.90, evidence: 'strong', species_scope: ['canine'] });
    const tInsulinC = 'treatment:canine_insulin_therapy';
    this.addNode({ id: tInsulinC, label: 'Insulin Therapy (Canine)', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: cDm, to: tInsulinC, type: 'treated_by', weight: 0.98, evidence: 'strong' });
    const dNph = 'drug:nph_insulin';
    this.addNode({ id: dNph, label: 'NPH Insulin', type: 'drug', metadata: {} });
    this.addEdge({ from: tInsulinC, to: dNph, type: 'uses_drug', weight: 0.90, evidence: 'strong' });
    this.addEdge({ from: cDm, to: 'breed:samoyed', type: 'breed_predisposition', weight: 0.70, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cDm, to: cHypo, type: 'differentiates_from', weight: 0.60, evidence: 'moderate' });

    // ── Feline Diabetes Mellitus ──────────────────────────────────
    const fDm = 'disease:feline_diabetes_mellitus';
    this.addNode({ id: fDm, label: 'Feline Diabetes Mellitus', type: 'disease', metadata: {} });
    for (const [sym, w] of [
      ['polyuria', 0.90], ['polydipsia', 0.90], ['weight_loss', 0.88],
      ['polyphagia', 0.82], ['lethargy', 0.60], ['plantigrade_stance', 0.55],
    ] as const) {
      this.addEdge({ from: fDm, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['feline'] });
    }
    this.addEdge({ from: fDm, to: 'lab:hyperglycaemia', type: 'associated_lab', weight: 0.98, evidence: 'strong', species_scope: ['feline'] });
    this.addEdge({ from: fDm, to: 'lab:glucosuria', type: 'associated_lab', weight: 0.95, evidence: 'strong', species_scope: ['feline'] });
    const tInsulinF = 'treatment:feline_insulin_therapy';
    this.addNode({ id: tInsulinF, label: 'Insulin Therapy (Feline)', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: fDm, to: tInsulinF, type: 'treated_by', weight: 0.98, evidence: 'strong' });
    const dGlargine = 'drug:glargine_insulin';
    this.addNode({ id: dGlargine, label: 'Glargine Insulin', type: 'drug', metadata: {} });
    this.addEdge({ from: tInsulinF, to: dGlargine, type: 'uses_drug', weight: 0.90, evidence: 'strong' });
    this.addEdge({ from: fDm, to: fHyper, type: 'differentiates_from', weight: 0.65, evidence: 'strong' });
    this.addEdge({ from: fDm, to: fCkd, type: 'differentiates_from', weight: 0.70, evidence: 'strong' });
    this.addEdge({ from: fDm, to: 'breed:burmese', type: 'breed_predisposition', weight: 0.80, evidence: 'strong', species_scope: ['feline'] });

    // ── Canine Addison's Disease ──────────────────────────────────
    const cAdd = 'disease:canine_addisons';
    this.addNode({ id: cAdd, label: "Canine Addison's Disease", type: 'disease', metadata: {} });
    for (const [sym, w] of [
      ['lethargy', 0.88], ['vomiting', 0.82], ['anorexia', 0.80],
      ['diarrhoea', 0.72], ['weakness', 0.78], ['collapse', 0.65],
      ['bradycardia', 0.60],
    ] as const) {
      this.addEdge({ from: cAdd, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['canine'] });
    }
    this.addEdge({ from: cAdd, to: 'lab:hyponatraemia', type: 'associated_lab', weight: 0.90, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cAdd, to: 'lab:hyperkalaemia', type: 'associated_lab', weight: 0.90, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cAdd, to: 'lab:low_cortisol', type: 'associated_lab', weight: 0.95, evidence: 'strong', species_scope: ['canine'] });
    const tDocp = 'treatment:docp_therapy';
    this.addNode({ id: tDocp, label: 'DOCP Mineralocorticoid Replacement', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: cAdd, to: tDocp, type: 'treated_by', weight: 0.98, evidence: 'strong' });
    const dDocp = 'drug:desoxycorticosterone';
    this.addNode({ id: dDocp, label: 'Desoxycorticosterone (DOCP)', type: 'drug', metadata: {} });
    this.addEdge({ from: tDocp, to: dDocp, type: 'uses_drug', weight: 0.95, evidence: 'strong' });
    this.addEdge({ from: cAdd, to: 'breed:standard_poodle', type: 'breed_predisposition', weight: 0.75, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cAdd, to: 'breed:portuguese_water_dog', type: 'breed_predisposition', weight: 0.70, evidence: 'strong', species_scope: ['canine'] });

    // ── Canine Cushing's Disease ──────────────────────────────────
    const cCush = 'disease:canine_cushings';
    this.addNode({ id: cCush, label: "Canine Cushing's Disease", type: 'disease', metadata: {} });
    for (const [sym, w] of [
      ['polyuria', 0.90], ['polydipsia', 0.90], ['polyphagia', 0.85],
      ['pot_belly', 0.80], ['alopecia', 0.78], ['panting', 0.72],
      ['muscle_wasting', 0.68],
    ] as const) {
      this.addEdge({ from: cCush, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['canine'] });
    }
    this.addEdge({ from: cCush, to: 'lab:elevated_alk_phos', type: 'associated_lab', weight: 0.90, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cCush, to: 'lab:elevated_cortisol', type: 'associated_lab', weight: 0.92, evidence: 'strong', species_scope: ['canine'] });
    const tTrilostane = 'treatment:trilostane_therapy';
    this.addNode({ id: tTrilostane, label: 'Trilostane Therapy', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: cCush, to: tTrilostane, type: 'treated_by', weight: 0.95, evidence: 'strong' });
    const dTrilostane = 'drug:trilostane';
    this.addNode({ id: dTrilostane, label: 'Trilostane', type: 'drug', metadata: {} });
    this.addEdge({ from: tTrilostane, to: dTrilostane, type: 'uses_drug', weight: 0.95, evidence: 'strong' });
    this.addEdge({ from: cCush, to: 'breed:poodle', type: 'breed_predisposition', weight: 0.70, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cCush, to: 'breed:dachshund', type: 'breed_predisposition', weight: 0.65, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cCush, to: cDm, type: 'differentiates_from', weight: 0.75, evidence: 'strong' });

    // ── Canine Kennel Cough ───────────────────────────────────────
    const cKc = 'disease:canine_kennel_cough';
    this.addNode({ id: cKc, label: 'Canine Kennel Cough', type: 'disease', metadata: {} });
    this.addNode({ id: 'pathogen:bordetella_bronchiseptica', label: 'Bordetella bronchiseptica', type: 'pathogen', metadata: {} });
    this.addNode({ id: 'pathogen:canine_parainfluenza_virus', label: 'Canine Parainfluenza Virus', type: 'pathogen', metadata: {} });
    this.addEdge({ from: cKc, to: 'pathogen:bordetella_bronchiseptica', type: 'caused_by', weight: 0.85, evidence: 'strong' });
    this.addEdge({ from: cKc, to: 'pathogen:canine_parainfluenza_virus', type: 'caused_by', weight: 0.70, evidence: 'strong' });
    for (const [sym, w] of [
      ['harsh_cough', 0.95], ['honking_cough', 0.90], ['retching', 0.75],
      ['nasal_discharge', 0.60], ['mild_fever', 0.50],
    ] as const) {
      this.addEdge({ from: cKc, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['canine'] });
    }
    const tDoxy = 'treatment:doxycycline_resp';
    this.addNode({ id: tDoxy, label: 'Doxycycline Course', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: cKc, to: tDoxy, type: 'treated_by', weight: 0.88, evidence: 'strong' });
    const dDoxy = 'drug:doxycycline';
    this.addNode({ id: dDoxy, label: 'Doxycycline', type: 'drug', metadata: {} });
    this.addEdge({ from: tDoxy, to: dDoxy, type: 'uses_drug', weight: 0.88, evidence: 'strong' });

    // ── Feline Upper Respiratory Infection ───────────────────────
    const fUri = 'disease:feline_uri';
    this.addNode({ id: fUri, label: 'Feline Upper Respiratory Infection', type: 'disease', metadata: {} });
    this.addNode({ id: 'pathogen:feline_herpesvirus_1', label: 'Feline Herpesvirus-1 (FHV-1)', type: 'pathogen', metadata: {} });
    this.addNode({ id: 'pathogen:feline_calicivirus', label: 'Feline Calicivirus (FCV)', type: 'pathogen', metadata: {} });
    this.addEdge({ from: fUri, to: 'pathogen:feline_herpesvirus_1', type: 'caused_by', weight: 0.80, evidence: 'strong' });
    this.addEdge({ from: fUri, to: 'pathogen:feline_calicivirus', type: 'caused_by', weight: 0.75, evidence: 'strong' });
    for (const [sym, w] of [
      ['sneezing', 0.92], ['nasal_discharge', 0.88], ['ocular_discharge', 0.82],
      ['conjunctivitis', 0.80], ['anorexia', 0.65], ['fever', 0.60],
      ['oral_ulcers', 0.55],
    ] as const) {
      this.addEdge({ from: fUri, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['feline'] });
    }
    const tFamciclovir = 'treatment:famciclovir_antiviral';
    this.addNode({ id: tFamciclovir, label: 'Famciclovir Antiviral', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: fUri, to: tFamciclovir, type: 'treated_by', weight: 0.80, evidence: 'strong' });
    const dFamciclovir = 'drug:famciclovir';
    this.addNode({ id: dFamciclovir, label: 'Famciclovir', type: 'drug', metadata: {} });
    this.addEdge({ from: tFamciclovir, to: dFamciclovir, type: 'uses_drug', weight: 0.80, evidence: 'strong' });

    // ── Equine Laminitis ─────────────────────────────────────────
    const eLam = 'disease:equine_laminitis';
    this.addNode({ id: eLam, label: 'Equine Laminitis', type: 'disease', metadata: {} });
    for (const [sym, w] of [
      ['forelimb_lameness', 0.92], ['digital_pulse', 0.90], ['hoof_heat', 0.88],
      ['weight_shifting', 0.85], ['reluctance_to_move', 0.82],
    ] as const) {
      this.addEdge({ from: eLam, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['equine'] });
    }
    this.addEdge({ from: eLam, to: 'lab:elevated_insulin', type: 'associated_lab', weight: 0.75, evidence: 'moderate', species_scope: ['equine'] });
    const tBute = 'treatment:phenylbutazone_laminitis';
    this.addNode({ id: tBute, label: 'Phenylbutazone Anti-Inflammatory', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: eLam, to: tBute, type: 'treated_by', weight: 0.90, evidence: 'strong' });
    const dBute = 'drug:phenylbutazone';
    this.addNode({ id: dBute, label: 'Phenylbutazone (Bute)', type: 'drug', metadata: {} });
    this.addEdge({ from: tBute, to: dBute, type: 'uses_drug', weight: 0.90, evidence: 'strong' });

    // ── Bovine Mastitis ──────────────────────────────────────────
    const bMast = 'disease:bovine_mastitis';
    this.addNode({ id: bMast, label: 'Bovine Mastitis', type: 'disease', metadata: {} });
    this.addNode({ id: 'pathogen:staphylococcus_aureus', label: 'Staphylococcus aureus', type: 'pathogen', metadata: {} });
    this.addNode({ id: 'pathogen:streptococcus_uberis', label: 'Streptococcus uberis', type: 'pathogen', metadata: {} });
    this.addEdge({ from: bMast, to: 'pathogen:staphylococcus_aureus', type: 'caused_by', weight: 0.80, evidence: 'strong' });
    this.addEdge({ from: bMast, to: 'pathogen:streptococcus_uberis', type: 'caused_by', weight: 0.75, evidence: 'strong' });
    for (const [sym, w] of [
      ['swollen_quarter', 0.95], ['milk_abnormality', 0.92], ['udder_heat', 0.88],
      ['reduced_milk_yield', 0.85], ['fever', 0.70],
    ] as const) {
      this.addEdge({ from: bMast, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['bovine'] });
    }
    this.addEdge({ from: bMast, to: 'lab:elevated_somatic_cell_count', type: 'associated_lab', weight: 0.95, evidence: 'strong', species_scope: ['bovine'] });
    const tIntramammary = 'treatment:intramammary_abx';
    this.addNode({ id: tIntramammary, label: 'Intramammary Antibiotic', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: bMast, to: tIntramammary, type: 'treated_by', weight: 0.92, evidence: 'strong' });
    const dCefquinome = 'drug:cefquinome';
    this.addNode({ id: dCefquinome, label: 'Cefquinome', type: 'drug', metadata: {} });
    this.addEdge({ from: tIntramammary, to: dCefquinome, type: 'uses_drug', weight: 0.85, evidence: 'strong' });

    // ── Canine Hip Dysplasia ─────────────────────────────────────
    const cHip = 'disease:canine_hip_dysplasia';
    this.addNode({ id: cHip, label: 'Canine Hip Dysplasia', type: 'disease', metadata: {} });
    for (const [sym, w] of [
      ['hindlimb_lameness', 0.90], ['reduced_exercise_tolerance', 0.82],
      ['pain_on_hip_extension', 0.88], ['muscle_atrophy_hindquarters', 0.75],
      ['bunny_hopping_gait', 0.70], ['stiffness_after_rest', 0.72],
    ] as const) {
      this.addEdge({ from: cHip, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['canine'] });
    }
    const tNsaid = 'treatment:nsaid_hip';
    this.addNode({ id: tNsaid, label: 'NSAID Analgesia', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: cHip, to: tNsaid, type: 'treated_by', weight: 0.88, evidence: 'strong' });
    const dMeloxicam = 'drug:meloxicam';
    this.addNode({ id: dMeloxicam, label: 'Meloxicam', type: 'drug', metadata: {} });
    this.addEdge({ from: tNsaid, to: dMeloxicam, type: 'uses_drug', weight: 0.85, evidence: 'strong' });
    this.addEdge({ from: cHip, to: 'breed:german_shepherd', type: 'breed_predisposition', weight: 0.85, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cHip, to: 'breed:labrador_retriever', type: 'breed_predisposition', weight: 0.80, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cHip, to: 'breed:rottweiler', type: 'breed_predisposition', weight: 0.75, evidence: 'strong', species_scope: ['canine'] });

    // ── Feline Infectious Peritonitis (FIP) ──────────────────────
    const fFip = 'disease:feline_fip';
    this.addNode({ id: fFip, label: 'Feline Infectious Peritonitis (FIP)', type: 'disease', metadata: {} });
    this.addNode({ id: 'pathogen:feline_coronavirus', label: 'Feline Coronavirus (FCoV→FIPV)', type: 'pathogen', metadata: {} });
    this.addEdge({ from: fFip, to: 'pathogen:feline_coronavirus', type: 'caused_by', weight: 0.98, evidence: 'strong' });
    for (const [sym, w] of [
      ['abdominal_effusion', 0.88], ['pleural_effusion', 0.75], ['fever', 0.85],
      ['weight_loss', 0.80], ['lethargy', 0.82], ['anorexia', 0.78],
    ] as const) {
      this.addEdge({ from: fFip, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['feline'] });
    }
    this.addEdge({ from: fFip, to: 'lab:low_albumin_globulin_ratio', type: 'associated_lab', weight: 0.90, evidence: 'strong', species_scope: ['feline'] });
    this.addEdge({ from: fFip, to: 'lab:positive_fip_pcr', type: 'associated_lab', weight: 0.92, evidence: 'strong', species_scope: ['feline'] });
    const tGs441524 = 'treatment:gs441524_antiviral';
    this.addNode({ id: tGs441524, label: 'GS-441524 Antiviral', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: fFip, to: tGs441524, type: 'treated_by', weight: 0.90, evidence: 'strong' });
    const dGs441524 = 'drug:gs441524';
    this.addNode({ id: dGs441524, label: 'GS-441524', type: 'drug', metadata: {} });
    this.addEdge({ from: tGs441524, to: dGs441524, type: 'uses_drug', weight: 0.90, evidence: 'strong' });
    this.addEdge({ from: fFip, to: 'breed:abyssinian', type: 'breed_predisposition', weight: 0.65, evidence: 'moderate', species_scope: ['feline'] });

    // ── Canine Lymphoma ──────────────────────────────────────────
    const cLymph = 'disease:canine_lymphoma';
    this.addNode({ id: cLymph, label: 'Canine Lymphoma', type: 'disease', metadata: {} });
    for (const [sym, w] of [
      ['peripheral_lymphadenopathy', 0.95], ['lethargy', 0.80], ['weight_loss', 0.75],
      ['anorexia', 0.70], ['vomiting', 0.50], ['diarrhoea', 0.45],
    ] as const) {
      this.addEdge({ from: cLymph, to: `symptom:${sym}`, type: 'presents_with', weight: w, evidence: 'strong', species_scope: ['canine'] });
    }
    this.addEdge({ from: cLymph, to: 'lab:hypercalcaemia', type: 'associated_lab', weight: 0.70, evidence: 'moderate', species_scope: ['canine'] });
    this.addEdge({ from: cLymph, to: 'lab:lymphocytosis', type: 'associated_lab', weight: 0.80, evidence: 'strong', species_scope: ['canine'] });
    const tChop = 'treatment:chop_protocol';
    this.addNode({ id: tChop, label: 'CHOP Chemotherapy Protocol', type: 'treatment_protocol', metadata: {} });
    this.addEdge({ from: cLymph, to: tChop, type: 'treated_by', weight: 0.95, evidence: 'strong' });
    const dVincristine = 'drug:vincristine';
    this.addNode({ id: dVincristine, label: 'Vincristine', type: 'drug', metadata: {} });
    const dCyclo = 'drug:cyclophosphamide';
    this.addNode({ id: dCyclo, label: 'Cyclophosphamide', type: 'drug', metadata: {} });
    this.addEdge({ from: tChop, to: dVincristine, type: 'uses_drug', weight: 0.95, evidence: 'strong' });
    this.addEdge({ from: tChop, to: dCyclo, type: 'uses_drug', weight: 0.95, evidence: 'strong' });
    this.addEdge({ from: cLymph, to: 'breed:golden_retriever', type: 'breed_predisposition', weight: 0.80, evidence: 'strong', species_scope: ['canine'] });
    this.addEdge({ from: cLymph, to: 'breed:rottweiler', type: 'breed_predisposition', weight: 0.65, evidence: 'moderate', species_scope: ['canine'] });
    this.addEdge({ from: cLymph, to: cCush, type: 'differentiates_from', weight: 0.55, evidence: 'moderate' });
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _vkg: VeterinaryKnowledgeGraph | null = null;
let _vkgHydrated = false;

export function getVKG(): VeterinaryKnowledgeGraph {
  if (!_vkg) _vkg = new VeterinaryKnowledgeGraph();
  return _vkg;
}

/**
 * Overlays Supabase vkg_nodes/vkg_edges onto the in-memory singleton.
 * Skips if already hydrated this process lifetime.
 * Non-blocking: call without await in the hot inference path.
 */
export async function hydrateVKGFromDatabase(
  supabase: import('@supabase/supabase-js').SupabaseClient
): Promise<void> {
  if (_vkgHydrated) return;
  _vkgHydrated = true;

  try {
    const vkg = getVKG();

    const { data: nodes, error: nodeErr } = await supabase
      .from('vkg_nodes')
      .select('id, label, type, species_scope, metadata');

    if (nodeErr) {
      console.error('[VKG] hydrateVKGFromDatabase: node fetch error', nodeErr.message);
      _vkgHydrated = false;
      return;
    }

    for (const n of nodes ?? []) {
      if (!vkg['nodes'].has(n.id)) {
        vkg['addNode']({
          id: n.id,
          label: n.label,
          type: n.type as VKGNode['type'],
          metadata: (n.metadata as Record<string, unknown>) ?? {},
        });
      }
    }

    const { data: edges, error: edgeErr } = await supabase
      .from('vkg_edges')
      .select('from_node, to_node, type, weight, evidence, species_scope');

    if (edgeErr) {
      console.error('[VKG] hydrateVKGFromDatabase: edge fetch error', edgeErr.message);
      return;
    }

    for (const e of edges ?? []) {
      const existing = (vkg['adjacency'].get(e.from_node) ?? [])
        .some((ex: VKGEdge) => ex.to === e.to_node && ex.type === e.type);
      if (!existing) {
        vkg['addEdge']({
          from: e.from_node,
          to: e.to_node,
          type: e.type as VKGEdge['type'],
          weight: e.weight,
          evidence: e.evidence as VKGEdge['evidence'],
          species_scope: e.species_scope ?? undefined,
        });
      }
    }

    console.log(`[VKG] hydrated: +${nodes?.length ?? 0} nodes, +${edges?.length ?? 0} edges from Supabase`);
  } catch (err) {
    console.error('[VKG] hydrateVKGFromDatabase: unexpected error', err);
    _vkgHydrated = false;
  }
}
