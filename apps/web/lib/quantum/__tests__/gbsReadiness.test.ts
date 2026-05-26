import { afterEach, describe, expect, it } from 'vitest';

import { buildGbsReadinessProblem } from '../gbsReadiness';

const envSnapshot = {
  VETIOS_QUANTUM_BACKEND: process.env.VETIOS_QUANTUM_BACKEND,
  PENNYLANE_BRAKET_DEVICE_ARN: process.env.PENNYLANE_BRAKET_DEVICE_ARN,
  PENNYLANE_BRAKET_SHOTS: process.env.PENNYLANE_BRAKET_SHOTS,
  AWS_REGION: process.env.AWS_REGION,
  AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION,
  BRAKET_S3_BUCKET: process.env.BRAKET_S3_BUCKET,
};

describe('GBS readiness problem builder', () => {
  afterEach(() => {
    restoreEnv('VETIOS_QUANTUM_BACKEND', envSnapshot.VETIOS_QUANTUM_BACKEND);
    restoreEnv('PENNYLANE_BRAKET_DEVICE_ARN', envSnapshot.PENNYLANE_BRAKET_DEVICE_ARN);
    restoreEnv('PENNYLANE_BRAKET_SHOTS', envSnapshot.PENNYLANE_BRAKET_SHOTS);
    restoreEnv('AWS_REGION', envSnapshot.AWS_REGION);
    restoreEnv('AWS_DEFAULT_REGION', envSnapshot.AWS_DEFAULT_REGION);
    restoreEnv('BRAKET_S3_BUCKET', envSnapshot.BRAKET_S3_BUCKET);
  });

  it('returns a PennyLane/AWS Braket manifest with a classical baseline when backend is not configured', () => {
    delete process.env.VETIOS_QUANTUM_BACKEND;
    delete process.env.PENNYLANE_BRAKET_DEVICE_ARN;
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;

    const result = buildGbsReadinessProblem({
      species: 'canine',
      symptoms: ['vomiting', 'lethargy', 'dehydration'],
    });

    expect(result.problem_type).toBe('maximum_weighted_clique');
    expect(result.backend).toBe('classical_baseline');
    expect(result.quantum_backend).toBe('not_configured');
    expect(result.experiment.status).toBe('backend_missing_config');
    expect(result.experiment.algorithm).toBe('gbs_maximum_weighted_clique');
    expect(result.experiment.matrices.adjacency).toHaveLength(result.graph.nodes.length);
    expect(result.baseline_solution.diagnoses.length).toBeGreaterThan(0);
  });

  it('marks the quantum backend ready when PennyLane/AWS Braket config is present', () => {
    process.env.VETIOS_QUANTUM_BACKEND = 'pennylane_braket';
    process.env.PENNYLANE_BRAKET_DEVICE_ARN = 'arn:aws:braket:::device/qpu/xanadu/example';
    process.env.AWS_REGION = 'us-east-1';
    process.env.PENNYLANE_BRAKET_SHOTS = '2500';

    const result = buildGbsReadinessProblem({
      species: 'canine',
      symptoms: ['vomiting', 'lethargy', 'dehydration'],
    });

    expect(result.quantum_backend).toBe('pennylane_aws_braket');
    expect(result.readiness.status).toBe('problem_ready_backend_configured');
    expect(result.experiment.status).toBe('backend_ready');
    expect(result.experiment.backend.shots).toBe(2500);
    expect(result.readiness.gates.find((gate) => gate.name === 'quantum_backend')?.pass).toBe(true);
  });
});

function restoreEnv(key: keyof typeof envSnapshot, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
