import { createHash } from 'crypto';
import {
    normalizeFasta,
    screenSequenceLocally,
    type AMRScreenResult,
} from '@/lib/amr/screener';

export async function screenAMRSequence(input: {
    sequence: string;
    species: string;
}): Promise<AMRScreenResult> {
    const configuredServiceUrl = process.env.AMR_GENOMIC_SCREENING_SERVICE_URL?.trim();
    const legacyQuantumServiceUrl = process.env.QUANTUM_SERVICE_URL?.trim();
    const serviceUrl = configuredServiceUrl ?? legacyQuantumServiceUrl;
    if (!serviceUrl) {
        return screenSequenceLocally(input.sequence);
    }

    const computationClass = configuredServiceUrl
        ? 'classical_heuristic' as const
        : 'quantum_experimental' as const;
    const timeoutMs = readPositiveInt(
        process.env.AMR_GENOMIC_SCREENING_TIMEOUT_MS
            ?? process.env.QUANTUM_SERVICE_TIMEOUT_MS,
        10_000,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
        const response = await fetch(`${serviceUrl.replace(/\/+$/, '')}/amr/screen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`AMR screening service returned ${response.status}`);
        }
        const payload = await response.json() as unknown;
        return normalizeRemoteScreenResult({
            payload,
            sequence: input.sequence,
            computationClass,
            latencyMs: Date.now() - startedAt,
        });
    } catch {
        const fallback = screenSequenceLocally(input.sequence);
        return {
            ...fallback,
            warnings: [...fallback.warnings, 'remote_screening_unavailable_local_fallback_used'],
        };
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeRemoteScreenResult(input: {
    payload: unknown;
    sequence: string;
    computationClass: 'classical_heuristic' | 'quantum_experimental';
    latencyMs: number;
}): AMRScreenResult {
    if (!isRecord(input.payload)) throw new Error('AMR screening response is invalid.');
    const expectedSequenceHash = createHash('sha256')
        .update(normalizeFasta(input.sequence))
        .digest('hex');
    const sequenceHash = readText(input.payload.sequence_hash);
    if (sequenceHash !== expectedSequenceHash) {
        throw new Error('AMR screening response sequence hash does not match the request.');
    }
    const genes = readStringArray(input.payload.resistance_genes, 2_000);
    const classes = readStringArray(input.payload.resistance_classes, 500);
    const noveltyScore = readProbability(input.payload.novel_pattern_score);
    const backend = readText(input.payload.quantum_backend)
        ?? readText(input.payload.backend);
    const databaseVersions = readStringMap(input.payload.reference_database_versions);
    const cardVersion = readText(input.payload.card_db_version);
    if (cardVersion) databaseVersions.card = cardVersion;

    return {
        sequence_hash: sequenceHash,
        resistance_genes: genes,
        resistance_classes: classes,
        novel_pattern_score: noveltyScore,
        quantum_backend: input.computationClass === 'quantum_experimental'
            ? backend ?? 'unreported_quantum_backend'
            : null,
        card_db_version: cardVersion,
        reference_database_versions: databaseVersions,
        algorithm_id: readText(input.payload.algorithm_id) ?? 'external_amr_screening_service',
        algorithm_version: readText(input.payload.algorithm_version) ?? 'unreported',
        computation_class: input.computationClass,
        validation_status: 'unvalidated',
        clinical_use_allowed: false,
        warnings: [
            'research_screening_only',
            'external_pipeline_not_attested',
            'phenotypic_ast_required',
            ...(input.computationClass === 'quantum_experimental'
                ? ['experimental_quantum_result_clinically_excluded']
                : []),
        ],
        latency_ms: input.latencyMs,
    };
}

function readPositiveInt(value: unknown, fallback: number): number {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function readStringArray(value: unknown, maxItems: number): string[] {
    if (!Array.isArray(value) || value.length > maxItems) {
        throw new Error('AMR screening response contains an invalid evidence list.');
    }
    const normalized = value.map(readText);
    if (normalized.some((item) => item == null)) {
        throw new Error('AMR screening response contains a non-text evidence item.');
    }
    return Array.from(new Set(normalized as string[])).sort();
}

function readProbability(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error('AMR screening response novelty score is invalid.');
    }
    return value;
}

function readStringMap(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value)
            .map(([key, version]) => [key.trim(), readText(version)] as const)
            .filter((entry): entry is readonly [string, string] =>
                Boolean(entry[0] && entry[1]),
            )
            .sort(([left], [right]) => left.localeCompare(right)),
    );
}
