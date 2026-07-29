export interface AMRCalibrationDifferential {
    label: string;
    probability: number;
}

export function readAMRInferenceDifferentials(
    row: Record<string, unknown>,
): AMRCalibrationDifferential[] {
    const outputPayload = asRecord(row.output_payload);
    const diagnosis = asRecord(outputPayload.diagnosis);
    const candidates = Array.isArray(outputPayload.differentials) && outputPayload.differentials.length > 0
        ? outputPayload.differentials
        : Array.isArray(diagnosis.top_differentials)
            ? diagnosis.top_differentials
            : [];

    return candidates.flatMap((entry) => {
        const record = asRecord(entry);
        const label = readText(record.label)
            ?? readText(record.name)
            ?? readText(record.diagnosis)
            ?? readText(record.condition);
        const probability = readNumber(record.probability)
            ?? readNumber(record.p)
            ?? readNumber(record.confidence)
            ?? readNumber(record.confidence_score);

        return label && probability != null
            ? [{ label, probability: Math.max(0, Math.min(1, probability)) }]
            : [];
    });
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
