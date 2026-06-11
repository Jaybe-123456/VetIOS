import type { AskVetiosHeuristicResponse } from './heuristicResponse';

type DraftMetadata = Record<string, unknown>;

export interface AskVetiosSpeculativeDraft {
    mode: AskVetiosHeuristicResponse['mode'];
    topic?: string;
    content: string;
    metadata: DraftMetadata;
}

export function shouldEmitAskVetiosSpeculativeDraft(env: NodeJS.ProcessEnv = process.env): boolean {
    const value = env.VETIOS_ASK_SPECULATIVE_DRAFT_ENABLED;
    return value !== 'false' && value !== '0';
}

export function buildAskVetiosSpeculativeDraft(
    heuristic: AskVetiosHeuristicResponse,
    draftLatencyMs: number,
): AskVetiosSpeculativeDraft {
    const metadata = asRecord(heuristic.metadata);
    const baseMetadata = {
        ...metadata,
        speculative_draft: true,
        speculative_status: 'draft',
        speculative_strategy: 'application_level_heuristic_draft',
        draft_latency_ms: draftLatencyMs,
    };

    if (heuristic.mode === 'clinical') {
        return {
            mode: heuristic.mode,
            topic: heuristic.topic,
            content: buildClinicalDraftContent(heuristic.content, metadata),
            metadata: baseMetadata,
        };
    }

    if (heuristic.content && !isUnavailableContent(heuristic.content)) {
        return {
            mode: heuristic.mode,
            topic: heuristic.topic,
            content: [
                'Speculative draft while VetIOS verifies sources and final reasoning.',
                '',
                heuristic.content,
            ].join('\n'),
            metadata: baseMetadata,
        };
    }

    return {
        mode: heuristic.mode,
        topic: heuristic.topic,
        content: [
            'Speculative draft: VetIOS is retrieving indexed evidence and checking final reasoning.',
            '',
            'The final grounded answer will replace this draft automatically.',
        ].join('\n'),
        metadata: baseMetadata,
    };
}

function buildClinicalDraftContent(content: string, metadata: DraftMetadata): string {
    const lines = [
        'Speculative clinical draft while VetIOS verifies citations and final model reasoning.',
        '',
        content,
    ];

    const differentials = Array.isArray(metadata.diagnosis_ranked)
        ? metadata.diagnosis_ranked.slice(0, 3)
        : [];
    if (differentials.length > 0) {
        lines.push('', 'Top provisional differentials:');
        differentials.forEach((entry, index) => {
            const record = asRecord(entry);
            const name = readString(record.name) ?? 'Differential';
            const confidence = readConfidence(record.confidence);
            const reasoning = readString(record.reasoning);
            const confidenceText = confidence === null ? '' : ` (${Math.round(confidence * 100)}%)`;
            lines.push(`${String(index + 1).padStart(2, '0')}. ${name}${confidenceText}${reasoning ? ` - ${reasoning}` : ''}`);
        });
    }

    const tests = Array.isArray(metadata.recommended_tests)
        ? metadata.recommended_tests.slice(0, 4).map((item) => readString(item)).filter(Boolean)
        : [];
    if (tests.length > 0) {
        lines.push('', 'Diagnostics to confirm:');
        tests.forEach((test) => lines.push(`- ${test}`));
    }

    const redFlags = Array.isArray(metadata.red_flags)
        ? metadata.red_flags.slice(0, 3).map((item) => readString(item)).filter(Boolean)
        : [];
    if (redFlags.length > 0) {
        lines.push('', 'Urgency flags:');
        redFlags.forEach((flag) => lines.push(`- ${flag}`));
    }

    lines.push('', 'This draft is provisional and will be replaced by the final grounded response.');
    return lines.join('\n');
}

function isUnavailableContent(content: string): boolean {
    return /temporarily unavailable|transient issue|try again/i.test(content);
}

function asRecord(value: unknown): DraftMetadata {
    return typeof value === 'object' && value !== null ? value as DraftMetadata : {};
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readConfidence(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return clampConfidence(value);
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? clampConfidence(parsed) : null;
    }
    return null;
}

function clampConfidence(value: number): number {
    if (value > 1) return Math.max(0, Math.min(1, value / 100));
    return Math.max(0, Math.min(1, value));
}
