export type CireSafetyState = 'nominal' | 'review' | 'hold';

export interface Differential {
    label: string;
    p: number;
}

export interface CIRESignals {
    phi_hat: number;
    cps: number;
    safety_state: CireSafetyState;
}

export function computeCIRE(differentials: Differential[]): CIRESignals {
    if (differentials.length === 0) {
        return { phi_hat: 0, cps: 1, safety_state: 'hold' };
    }

    const probabilities = differentials.map((entry) => clampProbability(entry.p));
    const phiHat = probabilities[0] ?? 0;
    const cps = probabilities.length === 1
        ? 0
        : roundSignal(
            probabilities.reduce((sum, p) => {
                if (p <= 0) return sum;
                return sum - (p * Math.log(p));
            }, 0) / Math.log(probabilities.length),
        );

    const roundedPhiHat = roundSignal(phiHat);
    const safetyState: CireSafetyState =
        roundedPhiHat >= 0.6 && cps <= 0.4
            ? 'nominal'
            : roundedPhiHat >= 0.4 || cps <= 0.6
                ? 'review'
                : 'hold';

    return {
        phi_hat: roundedPhiHat,
        cps,
        safety_state: safetyState,
    };
}

function clampProbability(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function roundSignal(value: number): number {
    return Number(value.toFixed(4));
}
