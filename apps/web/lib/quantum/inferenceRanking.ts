import { GBSClient, type GBSRankResponse, type GBSRankRequest } from '@vetios/quantum';
import type { Differential } from '@/lib/cire';
import type { InputSignature } from '@/lib/vetios-inference';

export type InferenceRanker = 'classical' | 'quantum' | 'hybrid';

export interface QuantumInferenceResult {
    status: 'completed' | 'disabled' | 'unavailable' | 'insufficient_graph' | 'failed';
    backend: string | null;
    ranked_labels: string[];
    gbs: GBSRankResponse | null;
    latency_ms: number;
    anonymized_node_count: number;
    anonymized_edge_count: number;
    error?: string;
}

interface GraphPriorRecord {
    id?: string;
    label: string;
    display_name?: string;
    score: number;
    matched_symptoms: string[];
}

interface QuantumNodeMapping {
    syntheticId: string;
    label: string;
    displayName: string | null;
}

export async function runOptionalQuantumRanking(input: {
    enabledByRequest: boolean;
    inputSignature: InputSignature;
    classicalDifferentials?: Differential[];
}): Promise<{ ranker: InferenceRanker; quantumResult: QuantumInferenceResult | null }> {
    if (!input.enabledByRequest || process.env.QUANTUM_ENABLED !== 'true') {
        return { ranker: 'classical', quantumResult: null };
    }

    const serviceUrl = process.env.QUANTUM_SERVICE_URL?.trim();
    if (!serviceUrl) {
        return {
            ranker: 'classical',
            quantumResult: disabledResult('unavailable', 'QUANTUM_SERVICE_URL is not configured.'),
        };
    }

    const problem = buildAnonymizedGbsProblem(input.inputSignature);
    if (!problem) {
        return {
            ranker: 'classical',
            quantumResult: disabledResult('insufficient_graph', 'Graph priors did not contain enough candidates for GBS ranking.'),
        };
    }

    const timeoutMs = readPositiveInt(process.env.QUANTUM_SERVICE_TIMEOUT_MS, 10_000);
    const client = new GBSClient(serviceUrl, timeoutMs);
    const startedAt = Date.now();

    try {
        const available = await client.isAvailable();
        if (!available) {
            return {
                ranker: 'classical',
                quantumResult: {
                    status: 'unavailable',
                    backend: null,
                    ranked_labels: [],
                    gbs: null,
                    latency_ms: Date.now() - startedAt,
                    anonymized_node_count: problem.request.nodes.length,
                    anonymized_edge_count: problem.request.edges.length,
                    error: 'Quantum service health check failed.',
                },
            };
        }

        const response = await client.rank(problem.request);
        return {
            ranker: 'hybrid',
            quantumResult: {
                status: 'completed',
                backend: response.backend,
                ranked_labels: mapRankedNodeIds(response.ranked_node_ids, problem.mapping),
                gbs: response,
                latency_ms: Date.now() - startedAt,
                anonymized_node_count: problem.request.nodes.length,
                anonymized_edge_count: problem.request.edges.length,
            },
        };
    } catch (error) {
        return {
            ranker: 'classical',
            quantumResult: {
                status: 'failed',
                backend: null,
                ranked_labels: [],
                gbs: null,
                latency_ms: Date.now() - startedAt,
                anonymized_node_count: problem.request.nodes.length,
                anonymized_edge_count: problem.request.edges.length,
                error: error instanceof Error ? error.message : 'Quantum ranking failed.',
            },
        };
    }
}

export function buildAnonymizedGbsProblem(
    inputSignature: InputSignature,
): { request: GBSRankRequest; mapping: QuantumNodeMapping[] } | null {
    const priors = readGraphPriors(inputSignature.metadata?.graph_priors).slice(0, 10);
    if (priors.length < 2) return null;

    const maxScore = Math.max(...priors.map((prior) => prior.score), 0.0001);
    const mapping = priors.map((prior, index) => ({
        syntheticId: `qd_${index + 1}`,
        label: prior.label,
        displayName: prior.display_name ?? null,
    }));
    const nodes = priors.map((prior, index) => ({
        id: mapping[index]!.syntheticId,
        weight: round(Math.max(0.001, prior.score / maxScore)),
    }));
    const edges: GBSRankRequest['edges'] = [];

    for (let i = 0; i < priors.length; i += 1) {
        for (let j = i + 1; j < priors.length; j += 1) {
            const weight = sharedSymptomWeight(priors[i]!, priors[j]!);
            if (weight <= 0) continue;
            edges.push({
                source: mapping[i]!.syntheticId,
                target: mapping[j]!.syntheticId,
                weight,
            });
        }
    }

    return {
        request: { nodes, edges, top_k: Math.min(5, nodes.length) },
        mapping,
    };
}

function readGraphPriors(value: unknown): GraphPriorRecord[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry): GraphPriorRecord | null => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
            const record = entry as Record<string, unknown>;
            const label = readText(record.label);
            const score = readNumber(record.score);
            if (!label || score == null) return null;
            const matchedSymptoms = Array.isArray(record.matched_symptoms)
                ? record.matched_symptoms.filter((item): item is string => typeof item === 'string')
                : [];
            return {
                id: readText(record.id) ?? undefined,
                label,
                display_name: readText(record.display_name) ?? undefined,
                score,
                matched_symptoms: matchedSymptoms,
            };
        })
        .filter((entry): entry is GraphPriorRecord => entry != null);
}

function sharedSymptomWeight(left: GraphPriorRecord, right: GraphPriorRecord): number {
    const leftSymptoms = new Set(left.matched_symptoms);
    const rightSymptoms = new Set(right.matched_symptoms);
    if (leftSymptoms.size === 0 || rightSymptoms.size === 0) return 0;
    const shared = [...leftSymptoms].filter((symptom) => rightSymptoms.has(symptom)).length;
    const denominator = Math.max(leftSymptoms.size, rightSymptoms.size);
    return shared > 0 ? round(Math.max(0.05, shared / denominator)) : 0;
}

function mapRankedNodeIds(nodeIds: string[], mapping: QuantumNodeMapping[]): string[] {
    const labelByNode = new Map(mapping.map((entry) => [entry.syntheticId, entry.label]));
    return nodeIds
        .map((nodeId) => labelByNode.get(nodeId))
        .filter((label): label is string => Boolean(label));
}

function disabledResult(status: 'disabled' | 'unavailable' | 'insufficient_graph', error: string): QuantumInferenceResult {
    return {
        status,
        backend: null,
        ranked_labels: [],
        gbs: null,
        latency_ms: 0,
        anonymized_node_count: 0,
        anonymized_edge_count: 0,
        error,
    };
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readPositiveInt(value: unknown, fallback: number): number {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : fallback;
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}
