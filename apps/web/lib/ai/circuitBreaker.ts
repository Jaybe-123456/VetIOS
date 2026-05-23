type AiCircuitState = 'closed' | 'open' | 'half_open';

interface CircuitEntry {
    state: AiCircuitState;
    failureCount: number;
    lastFailureAt: number;
    halfOpenProbes: number;
}

interface CircuitConfig {
    failureThreshold: number;
    cooldownMs: number;
    halfOpenMaxProbes: number;
}

const DEFAULT_CONFIG: CircuitConfig = {
    failureThreshold: 5,
    cooldownMs: 30_000,
    halfOpenMaxProbes: 1,
};

const globalForCircuits = globalThis as typeof globalThis & {
    __vetiosAiProviderCircuits?: Map<string, CircuitEntry>;
};

const circuits = globalForCircuits.__vetiosAiProviderCircuits ?? new Map<string, CircuitEntry>();
globalForCircuits.__vetiosAiProviderCircuits = circuits;

export class AiCircuitBreakerOpenError extends Error {
    constructor(readonly provider: string) {
        super(`Circuit breaker open for AI provider "${provider}".`);
        this.name = 'AiCircuitBreakerOpenError';
    }
}

export async function runWithAiCircuitBreaker<T>(
    provider: string,
    operation: () => Promise<T>,
): Promise<T> {
    const config = getCircuitConfig();
    acquireCircuitPermission(provider, config);

    try {
        const result = await operation();
        recordCircuitSuccess(provider);
        return result;
    } catch (error) {
        recordCircuitFailure(provider, config);
        throw error;
    }
}

export function getAiCircuitState(provider: string): AiCircuitState {
    return getCircuit(provider).state;
}

function acquireCircuitPermission(provider: string, config: CircuitConfig) {
    const circuit = getCircuit(provider);
    const now = Date.now();

    if (circuit.state === 'open') {
        if (now - circuit.lastFailureAt >= config.cooldownMs) {
            circuit.state = 'half_open';
            circuit.halfOpenProbes = 0;
        } else {
            throw new AiCircuitBreakerOpenError(provider);
        }
    }

    if (circuit.state === 'half_open') {
        if (circuit.halfOpenProbes >= config.halfOpenMaxProbes) {
            throw new AiCircuitBreakerOpenError(provider);
        }
        circuit.halfOpenProbes += 1;
    }
}

function recordCircuitSuccess(provider: string) {
    const circuit = getCircuit(provider);
    circuit.state = 'closed';
    circuit.failureCount = 0;
    circuit.halfOpenProbes = 0;
}

function recordCircuitFailure(provider: string, config: CircuitConfig) {
    const circuit = getCircuit(provider);
    circuit.failureCount += 1;
    circuit.lastFailureAt = Date.now();

    if (circuit.state === 'half_open' || circuit.failureCount >= config.failureThreshold) {
        circuit.state = 'open';
        circuit.halfOpenProbes = 0;
    }
}

function getCircuit(provider: string): CircuitEntry {
    const key = provider.trim().toLowerCase() || 'unknown';
    let circuit = circuits.get(key);
    if (!circuit) {
        circuit = {
            state: 'closed',
            failureCount: 0,
            lastFailureAt: 0,
            halfOpenProbes: 0,
        };
        circuits.set(key, circuit);
    }
    return circuit;
}

function getCircuitConfig(): CircuitConfig {
    return {
        failureThreshold: readPositiveInteger(process.env.AI_PROVIDER_CIRCUIT_FAILURE_THRESHOLD, DEFAULT_CONFIG.failureThreshold),
        cooldownMs: readPositiveInteger(process.env.AI_PROVIDER_CIRCUIT_COOLDOWN_MS, DEFAULT_CONFIG.cooldownMs),
        halfOpenMaxProbes: readPositiveInteger(process.env.AI_PROVIDER_CIRCUIT_HALF_OPEN_PROBES, DEFAULT_CONFIG.halfOpenMaxProbes),
    };
}

function readPositiveInteger(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed);
        }
    }
    return fallback;
}
