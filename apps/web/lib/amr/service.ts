import { screenSequenceLocally, type AMRScreenResult } from '@/lib/amr/screener';

export async function screenAMRSequence(input: {
    sequence: string;
    species: string;
}): Promise<AMRScreenResult> {
    const serviceUrl = process.env.QUANTUM_SERVICE_URL?.trim();
    if (!serviceUrl) {
        return screenSequenceLocally(input.sequence);
    }

    const timeoutMs = readPositiveInt(process.env.QUANTUM_SERVICE_TIMEOUT_MS, 10_000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
        return await response.json() as AMRScreenResult;
    } catch {
        return screenSequenceLocally(input.sequence);
    } finally {
        clearTimeout(timeout);
    }
}

function readPositiveInt(value: unknown, fallback: number): number {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : fallback;
}
