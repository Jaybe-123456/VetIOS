import { getVKG } from '@/lib/vkg/veterinaryKnowledgeGraph';

export interface QuantumReadinessInput {
  symptoms: string[];
  species?: string;
  breed?: string | null;
  biomarkers?: Record<string, number | string> | null;
  maxCandidates?: number;
}

export interface QuantumReadinessNode {
  id: string;
  label: string;
  score: number;
  matched_symptoms: string[];
}

export interface QuantumReadinessEdge {
  from: string;
  to: string;
  weight: number;
  reasons: string[];
}

export interface QuantumReadinessResult {
  problem_type: 'maximum_weighted_clique';
  hardware_target: 'gbs_compatible';
  backend: 'classical_baseline';
  quantum_backend: 'not_configured';
  graph: {
    nodes: QuantumReadinessNode[];
    edges: QuantumReadinessEdge[];
    density: number;
  };
  baseline_solution: {
    method: 'exact_small_graph';
    node_ids: string[];
    diagnoses: string[];
    score: number;
  };
  readiness: {
    status: 'insufficient_graph_signal' | 'problem_ready_backend_missing';
    gates: Array<{ name: string; pass: boolean; detail: string }>;
  };
}

const DEFAULT_MAX_CANDIDATES = 12;
const MAX_CANDIDATES = 16;

export function buildGbsReadinessProblem(input: QuantumReadinessInput): QuantumReadinessResult {
  const symptoms = input.symptoms.map((symptom) => symptom.trim()).filter(Boolean);
  const maxCandidates = clampInteger(input.maxCandidates ?? DEFAULT_MAX_CANDIDATES, 1, MAX_CANDIDATES);
  const vkg = getVKG();

  const candidates = vkg
    .getDiseasesForSymptoms(symptoms, input.species, input.breed ?? null, input.biomarkers ?? null)
    .slice(0, maxCandidates);

  const nodes: QuantumReadinessNode[] = candidates.map(({ disease, matchedSymptoms, score }) => ({
    id: disease.id,
    label: disease.label,
    score: round(score),
    matched_symptoms: matchedSymptoms,
  }));

  const edges = buildEdges(nodes, input.species);
  const baseline = solveBaseline(nodes, edges);
  const possibleEdges = nodes.length > 1 ? (nodes.length * (nodes.length - 1)) / 2 : 0;
  const density = possibleEdges === 0 ? 0 : round(edges.length / possibleEdges);

  const gates = [
    {
      name: 'vkg_candidates',
      pass: nodes.length > 0,
      detail: nodes.length > 0
        ? `${nodes.length} VKG disease candidates found.`
        : 'No VKG disease candidates matched the submitted symptoms.',
    },
    {
      name: 'optimization_edges',
      pass: edges.length > 0,
      detail: edges.length > 0
        ? `${edges.length} weighted diagnostic relationships prepared.`
        : 'No shared symptom or differential relationships were found between candidates.',
    },
    {
      name: 'quantum_backend',
      pass: false,
      detail: 'No PennyLane, AWS Braket, or Jiuzhang backend is configured; returning the local classical baseline.',
    },
  ];

  return {
    problem_type: 'maximum_weighted_clique',
    hardware_target: 'gbs_compatible',
    backend: 'classical_baseline',
    quantum_backend: 'not_configured',
    graph: { nodes, edges, density },
    baseline_solution: baseline,
    readiness: {
      status: nodes.length > 0 && edges.length > 0
        ? 'problem_ready_backend_missing'
        : 'insufficient_graph_signal',
      gates,
    },
  };
}

function buildEdges(nodes: QuantumReadinessNode[], species?: string): QuantumReadinessEdge[] {
  const vkg = getVKG();
  const edges: QuantumReadinessEdge[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const left = nodes[i];
      const right = nodes[j];
      const sharedSymptoms = intersection(left.matched_symptoms, right.matched_symptoms);
      const differentialRelationship = areDifferentialPair(left.id, right.id, species);
      const weight = round(Math.min(1, sharedSymptoms.length * 0.15 + (differentialRelationship ? 0.35 : 0)));

      if (weight <= 0) continue;

      const reasons: string[] = [];
      if (sharedSymptoms.length > 0) {
        reasons.push(`shared symptoms: ${sharedSymptoms.join(', ')}`);
      }
      if (differentialRelationship) {
        reasons.push('VKG differentiates these diagnoses');
      }

      edges.push({ from: left.id, to: right.id, weight, reasons });
    }
  }

  function areDifferentialPair(leftId: string, rightId: string, currentSpecies?: string): boolean {
    const leftDifferentials = vkg.getDifferentials(leftId, currentSpecies).map((node) => node.id);
    if (leftDifferentials.includes(rightId)) return true;
    return vkg.getDifferentials(rightId, currentSpecies).some((node) => node.id === leftId);
  }

  return edges;
}

function solveBaseline(
  nodes: QuantumReadinessNode[],
  edges: QuantumReadinessEdge[],
): QuantumReadinessResult['baseline_solution'] {
  if (nodes.length === 0) {
    return { method: 'exact_small_graph', node_ids: [], diagnoses: [], score: 0 };
  }

  const edgeWeights = new Map(edges.map((edge) => [edgeKey(edge.from, edge.to), edge.weight]));
  return solveExact(nodes, edgeWeights);
}

function solveExact(
  nodes: QuantumReadinessNode[],
  edgeWeights: Map<string, number>,
): QuantumReadinessResult['baseline_solution'] {
  let bestNodeIds: string[] = [];
  let bestScore = 0;
  const totalMasks = 2 ** nodes.length;

  for (let mask = 1; mask < totalMasks; mask += 1) {
    const selected = nodes.filter((_, index) => (mask & (1 << index)) !== 0);
    if (!isClique(selected, edgeWeights)) continue;

    const score = scoreClique(selected, edgeWeights);
    if (score > bestScore) {
      bestScore = score;
      bestNodeIds = selected.map((node) => node.id);
    }
  }

  return formatBaseline('exact_small_graph', bestNodeIds, nodes, bestScore);
}

function isClique(nodes: QuantumReadinessNode[], edgeWeights: Map<string, number>): boolean {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (!edgeWeights.has(edgeKey(nodes[i].id, nodes[j].id))) return false;
    }
  }
  return true;
}

function scoreClique(nodes: QuantumReadinessNode[], edgeWeights: Map<string, number>): number {
  let score = nodes.reduce((sum, node) => sum + node.score, 0);
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      score += edgeWeights.get(edgeKey(nodes[i].id, nodes[j].id)) ?? 0;
    }
  }
  return round(score);
}

function formatBaseline(
  method: 'exact_small_graph',
  nodeIds: string[],
  nodes: QuantumReadinessNode[],
  score: number,
): QuantumReadinessResult['baseline_solution'] {
  const selected = nodeIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is QuantumReadinessNode => node !== undefined);

  return {
    method,
    node_ids: nodeIds,
    diagnoses: selected.map((node) => node.label),
    score: round(score),
  };
}

function edgeKey(left: string, right: string): string {
  return [left, right].sort().join('::');
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((item) => rightSet.has(item)))];
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
