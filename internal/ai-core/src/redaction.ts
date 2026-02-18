/**
 * @vetios/ai-core — PII/PHI Redaction
 *
 * Strips personally identifiable information (PII) and protected health information (PHI)
 * from text before sending to external LLM providers.
 *
 * The redaction is reversible: a token map is generated during redaction,
 * allowing reconstruction of the original text in the response.
 */

export interface RedactionResult {
    redactedText: string;
    tokenMap: Map<string, string>;
}

interface RedactionPattern {
    name: string;
    pattern: RegExp;
    replacement: (index: number) => string;
}

const REDACTION_PATTERNS: RedactionPattern[] = [
    {
        name: 'email',
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        replacement: (i) => `[EMAIL_${i}]`,
    },
    {
        name: 'phone',
        pattern: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
        replacement: (i) => `[PHONE_${i}]`,
    },
    {
        name: 'ssn',
        pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
        replacement: (i) => `[SSN_${i}]`,
    },
    {
        name: 'address',
        pattern: /\b\d{1,5}\s[\w\s]{1,30}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|court|ct|lane|ln|way|place|pl)\.?\b/gi,
        replacement: (i) => `[ADDRESS_${i}]`,
    },
    {
        name: 'credit_card',
        pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
        replacement: (i) => `[CC_${i}]`,
    },
];

/**
 * Additional name patterns: strips common name patterns like "Owner: John Smith".
 * These are context-specific to veterinary records where owner names appear.
 */
const OWNER_NAME_PATTERNS: RedactionPattern[] = [
    {
        name: 'owner_label',
        pattern: /(?:owner|client|guardian|parent|contact)\s*[:]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/gi,
        replacement: (i) => `[OWNER_${i}]`,
    },
];

/**
 * Redacts PII/PHI from the given text and returns a token map for reconstruction.
 *
 * @param text - Raw text potentially containing PII/PHI
 * @param includeOwnerNames - Whether to redact owner name patterns (default: true)
 * @returns RedactionResult with redacted text and token map
 */
export function redactPII(text: string, includeOwnerNames = true): RedactionResult {
    const tokenMap = new Map<string, string>();
    let redacted = text;
    let globalIndex = 0;

    const patterns = includeOwnerNames
        ? [...REDACTION_PATTERNS, ...OWNER_NAME_PATTERNS]
        : REDACTION_PATTERNS;

    for (const { pattern, replacement } of patterns) {
        // Reset regex state for global patterns
        const regex = new RegExp(pattern.source, pattern.flags);

        redacted = redacted.replace(regex, (match) => {
            const token = replacement(globalIndex++);
            tokenMap.set(token, match);
            return token;
        });
    }

    return { redactedText: redacted, tokenMap };
}

/**
 * Reconstructs the original text from a redacted response using the token map.
 * This is used to restore PII in the AI response before storing or displaying it.
 *
 * @param redactedText - Text containing redaction tokens
 * @param tokenMap - Map from redaction tokens to original values
 * @returns Reconstructed text with original PII values
 */
export function restorePII(redactedText: string, tokenMap: Map<string, string>): string {
    let restored = redactedText;

    for (const [token, original] of tokenMap) {
        // Use split/join to handle all occurrences without regex escaping issues
        restored = restored.split(token).join(original);
    }

    return restored;
}

/**
 * Checks if a text contains any patterns that look like PII.
 * Useful as a pre-flight check before deciding whether redaction is needed.
 */
export function containsPII(text: string): boolean {
    for (const { pattern } of REDACTION_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        if (regex.test(text)) return true;
    }
    return false;
}
