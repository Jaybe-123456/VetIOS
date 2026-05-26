export interface WeightedCliqueNode {
  id: string;
  label: string;
  weight: number;
}

export interface WeightedCliqueEdge {
  from: string;
  to: string;
  weight: number;
  reasons?: string[];
}

export interface WeightedCliqueProblem {
  id: string;
  problem_type: 'maximum_weighted_clique';
  nodes: WeightedCliqueNode[];
  edges: WeightedCliqueEdge[];
}

export interface PennyLaneBraketConfig {
  enabled: boolean;
  deviceArn?: string;
  region?: string;
  s3Bucket?: string;
  shots?: number;
}

export interface PennyLaneBraketManifest {
  status: 'backend_ready' | 'backend_missing_config' | 'problem_not_ready';
  algorithm: 'gbs_maximum_weighted_clique';
  provider: 'pennylane_aws_braket';
  execution_mode: 'manifest_only';
  backend: {
    enabled: boolean;
    device_arn: string | null;
    region: string | null;
    s3_bucket: string | null;
    shots: number;
  };
  problem: WeightedCliqueProblem;
  matrices: {
    adjacency: number[][];
    node_weights: number[];
    edge_weights: number[][];
  };
  runner: {
    language: 'python';
    path: 'packages/quantum/python/pennylane_gbs_runner.py';
    required_packages: string[];
    entrypoint: 'run_gbs_maximum_weighted_clique';
  };
  gates: Array<{ name: string; pass: boolean; detail: string }>;
}

const DEFAULT_SHOTS = 1000;

export function createPennyLaneBraketManifest(
  problem: WeightedCliqueProblem,
  config: PennyLaneBraketConfig,
): PennyLaneBraketManifest {
  const matrices = buildMatrices(problem);
  const backendReady = Boolean(config.enabled && config.deviceArn && config.region);
  const problemReady = problem.nodes.length > 0 && problem.edges.length > 0;
  const shots = normalizeShots(config.shots);

  const gates = [
    {
      name: 'weighted_clique_problem',
      pass: problemReady,
      detail: problemReady
        ? `${problem.nodes.length} nodes and ${problem.edges.length} weighted edges prepared.`
        : 'At least one node and one weighted edge are required before a GBS experiment can run.',
    },
    {
      name: 'pennylane_braket_backend',
      pass: backendReady,
      detail: backendReady
        ? 'PennyLane/AWS Braket backend configuration is present.'
        : 'Set VETIOS_QUANTUM_BACKEND=pennylane_braket, PENNYLANE_BRAKET_DEVICE_ARN, and AWS_REGION to enable execution.',
    },
  ];

  return {
    status: !problemReady
      ? 'problem_not_ready'
      : backendReady
        ? 'backend_ready'
        : 'backend_missing_config',
    algorithm: 'gbs_maximum_weighted_clique',
    provider: 'pennylane_aws_braket',
    execution_mode: 'manifest_only',
    backend: {
      enabled: config.enabled,
      device_arn: config.deviceArn ?? null,
      region: config.region ?? null,
      s3_bucket: config.s3Bucket ?? null,
      shots,
    },
    problem,
    matrices,
    runner: {
      language: 'python',
      path: 'packages/quantum/python/pennylane_gbs_runner.py',
      required_packages: [
        'pennylane',
        'amazon-braket-pennylane-plugin',
        'amazon-braket-sdk',
      ],
      entrypoint: 'run_gbs_maximum_weighted_clique',
    },
    gates,
  };
}

function buildMatrices(problem: WeightedCliqueProblem): PennyLaneBraketManifest['matrices'] {
  const nodeIndex = new Map(problem.nodes.map((node, index) => [node.id, index]));
  const size = problem.nodes.length;
  const adjacency = squareMatrix(size);
  const edgeWeights = squareMatrix(size);

  for (const edge of problem.edges) {
    const from = nodeIndex.get(edge.from);
    const to = nodeIndex.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;

    const fromAdjacency = adjacency[from];
    const toAdjacency = adjacency[to];
    const fromEdgeWeights = edgeWeights[from];
    const toEdgeWeights = edgeWeights[to];
    if (!fromAdjacency || !toAdjacency || !fromEdgeWeights || !toEdgeWeights) continue;

    fromAdjacency[to] = 1;
    toAdjacency[from] = 1;
    fromEdgeWeights[to] = round(edge.weight);
    toEdgeWeights[from] = round(edge.weight);
  }

  return {
    adjacency,
    node_weights: problem.nodes.map((node) => round(node.weight)),
    edge_weights: edgeWeights,
  };
}

function squareMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
}

function normalizeShots(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SHOTS;
  return Math.max(100, Math.min(100_000, Math.floor(value)));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
