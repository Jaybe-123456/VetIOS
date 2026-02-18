/**
 * @vetios/ai-core — Circuit Breaker
 *
 * Implements the circuit breaker pattern for external AI provider calls.
 * Tracks failures per provider and prevents cascading failures by
 * temporarily disabling a provider after a failure threshold is reached.
 *
 * States:
 *   CLOSED   → Normal operation, requests pass through.
 *   OPEN     → Provider disabled, requests fail immediately.
 *   HALF_OPEN → Single probe request allowed to test recovery.
 */

import { createLogger } from '@vetios/logger';

const logger = createLogger({ module: 'ai-core.circuit-breaker' });

export enum CircuitState {
    CLOSED = 'CLOSED',
    OPEN = 'OPEN',
    HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
    /** Number of consecutive failures before opening the circuit. Default: 5 */
    failureThreshold: number;
    /** Milliseconds before an OPEN circuit transitions to HALF_OPEN. Default: 30000 */
    cooldownMs: number;
    /** Maximum number of concurrent half-open probe requests. Default: 1 */
    halfOpenMaxProbes: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    cooldownMs: 30_000,
    halfOpenMaxProbes: 1,
};

interface CircuitStateData {
    state: CircuitState;
    failureCount: number;
    lastFailureAt: number;
    halfOpenProbes: number;
}

export class CircuitBreakerOpenError extends Error {
    constructor(public readonly provider: string) {
        super(`Circuit breaker OPEN for provider "${provider}". Request rejected.`);
        this.name = 'CircuitBreakerOpenError';
    }
}

export class CircuitBreaker {
    private circuits: Map<string, CircuitStateData> = new Map();
    private config: CircuitBreakerConfig;

    constructor(config?: Partial<CircuitBreakerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    private getCircuit(provider: string): CircuitStateData {
        let circuit = this.circuits.get(provider);
        if (!circuit) {
            circuit = {
                state: CircuitState.CLOSED,
                failureCount: 0,
                lastFailureAt: 0,
                halfOpenProbes: 0,
            };
            this.circuits.set(provider, circuit);
        }
        return circuit;
    }

    /**
     * Check if a request to the given provider is allowed.
     * Throws CircuitBreakerOpenError if the circuit is OPEN and cooldown has not elapsed.
     */
    canRequest(provider: string): boolean {
        const circuit = this.getCircuit(provider);

        switch (circuit.state) {
            case CircuitState.CLOSED:
                return true;

            case CircuitState.OPEN: {
                const elapsed = Date.now() - circuit.lastFailureAt;
                if (elapsed >= this.config.cooldownMs) {
                    // Transition to HALF_OPEN
                    circuit.state = CircuitState.HALF_OPEN;
                    circuit.halfOpenProbes = 0;
                    logger.info('Circuit transitioned to HALF_OPEN', { provider, elapsed_ms: elapsed });
                    return true;
                }
                return false;
            }

            case CircuitState.HALF_OPEN:
                return circuit.halfOpenProbes < this.config.halfOpenMaxProbes;
        }
    }

    /**
     * Must be called before making a request. Throws if the circuit is open.
     */
    acquirePermission(provider: string): void {
        if (!this.canRequest(provider)) {
            throw new CircuitBreakerOpenError(provider);
        }

        const circuit = this.getCircuit(provider);
        if (circuit.state === CircuitState.HALF_OPEN) {
            circuit.halfOpenProbes++;
        }
    }

    /**
     * Record a successful response from the provider.
     * Resets the circuit to CLOSED.
     */
    recordSuccess(provider: string): void {
        const circuit = this.getCircuit(provider);
        if (circuit.state !== CircuitState.CLOSED) {
            logger.info('Circuit breaker reset to CLOSED', { provider, previousState: circuit.state });
        }
        circuit.state = CircuitState.CLOSED;
        circuit.failureCount = 0;
        circuit.halfOpenProbes = 0;
    }

    /**
     * Record a failed response from the provider.
     * Increments failure count and potentially opens the circuit.
     */
    recordFailure(provider: string): void {
        const circuit = this.getCircuit(provider);
        circuit.failureCount++;
        circuit.lastFailureAt = Date.now();

        if (circuit.state === CircuitState.HALF_OPEN) {
            // Probe failed — re-open the circuit
            circuit.state = CircuitState.OPEN;
            logger.warn('Half-open probe failed, circuit re-opened', {
                provider,
                failureCount: circuit.failureCount,
            });
            return;
        }

        if (circuit.failureCount >= this.config.failureThreshold) {
            circuit.state = CircuitState.OPEN;
            logger.warn('Circuit breaker OPENED', {
                provider,
                failureCount: circuit.failureCount,
                cooldownMs: this.config.cooldownMs,
            });
        }
    }

    /**
     * Returns the current state of a provider's circuit.
     */
    getState(provider: string): CircuitState {
        return this.getCircuit(provider).state;
    }

    /**
     * Manually reset a provider's circuit to CLOSED.
     */
    reset(provider: string): void {
        this.circuits.delete(provider);
        logger.info('Circuit breaker manually reset', { provider });
    }
}
