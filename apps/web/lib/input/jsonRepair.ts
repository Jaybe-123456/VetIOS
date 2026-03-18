/**
 * Attempts to repair common JSON mistakes so they can be parsed.
 * Never throws — returns the original string if repair fails.
 */
export function repairJson(raw: string): string {
    let s = raw.trim();

    // 1. Replace single quotes with double quotes (but not inside strings)
    s = s.replace(/'/g, '"');

    // 2. Add quotes around unquoted keys:  { species: "dog" } → { "species": "dog" }
    s = s.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

    // 3. Remove trailing commas before } or ]
    s = s.replace(/,\s*([}\]])/g, '$1');

    // 4. Balance braces / brackets
    const opens = (s.match(/{/g) || []).length;
    const closes = (s.match(/}/g) || []).length;
    if (opens > closes) s += '}'.repeat(opens - closes);

    const openBrackets = (s.match(/\[/g) || []).length;
    const closeBrackets = (s.match(/]/g) || []).length;
    if (openBrackets > closeBrackets) s += ']'.repeat(openBrackets - closeBrackets);

    return s;
}

/**
 * Try to parse JSON, repairing it if the first attempt fails.
 * Returns null if both attempts fail.
 */
export function safeParseJson(raw: string): Record<string, unknown> | null {
    // Attempt 1: raw parse
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
        return null;
    } catch {
        // continue
    }

    // Attempt 2: repaired parse
    try {
        const repaired = repairJson(raw);
        const parsed = JSON.parse(repaired);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
        return null;
    } catch {
        return null;
    }
}
