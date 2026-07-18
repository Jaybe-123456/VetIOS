import { evalDraftJsonSchema, finalizeEvalSpec, parseEvalDraft } from './eval-schema.js';
import type { EvalSpec, OutcomeReceipt } from './types.js';

export const responsesEndpoint = 'https://api.openai.com/v1/responses';

export function buildGpt56ResponsesRequest(receipt: OutcomeReceipt): Record<string, unknown> {
    return {
        model: 'gpt-5.6',
        store: false,
        reasoning: { effort: 'high' },
        instructions: [
            'You are the ProofLoop evaluation compiler for a high-stakes AI release process.',
            'Use only facts present in the signed Outcome Receipt.',
            'Convert the verified discrepancy into a minimal executable regression specification.',
            'Do not invent evidence, diagnoses, populations, or clinical claims.',
            'The specification is reviewed and executed by deterministic code; it does not itself approve a release.',
        ].join(' '),
        input: JSON.stringify({ outcome_receipt: receipt }),
        text: {
            format: {
                type: 'json_schema',
                name: 'proofloop_eval_draft',
                strict: true,
                schema: evalDraftJsonSchema,
            },
        },
        max_output_tokens: 4000,
    };
}

function extractResponseText(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('GPT-5.6 returned a non-object response.');
    }
    const response = payload as { output_text?: unknown; output?: unknown };
    if (typeof response.output_text === 'string' && response.output_text.length > 0) {
        return response.output_text;
    }
    if (Array.isArray(response.output)) {
        for (const item of response.output) {
            if (typeof item !== 'object' || item === null) continue;
            const content = (item as { content?: unknown }).content;
            if (!Array.isArray(content)) continue;
            for (const part of content) {
                if (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string') {
                    return (part as { text: string }).text;
                }
            }
        }
    }
    throw new Error('GPT-5.6 response did not contain output text.');
}

export async function generateEvalWithGpt56(options: {
    receipt: OutcomeReceipt;
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
}): Promise<EvalSpec> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const endpoint = `${(options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/u, '')}/responses`;
    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildGpt56ResponsesRequest(options.receipt)),
    });
    if (!response.ok) {
        const body = (await response.text()).slice(0, 1200);
        throw new Error(`GPT-5.6 Responses API failed with ${response.status}: ${body}`);
    }
    const payload = await response.json() as { id?: unknown };
    const draft = parseEvalDraft(JSON.parse(extractResponseText(payload)) as unknown);
    return finalizeEvalSpec(draft, options.receipt, {
        mode: 'gpt-5.6',
        model: 'gpt-5.6',
        response_id: typeof payload.id === 'string' ? payload.id : null,
    });
}
