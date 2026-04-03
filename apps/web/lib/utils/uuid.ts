const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UUID_EMBEDDED_PATTERN =
    /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

export function normalizeUuid(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function extractUuidFromText(value: unknown): string | null {
    const direct = normalizeUuid(value);
    if (direct) return direct;
    if (typeof value !== 'string') return null;

    const match = value.trim().toLowerCase().match(UUID_EMBEDDED_PATTERN);
    return match?.[1] ?? null;
}

export function isUuid(value: unknown): boolean {
    return normalizeUuid(value) != null;
}
