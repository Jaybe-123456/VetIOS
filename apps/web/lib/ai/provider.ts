/**
 * AI Provider Abstraction
 *
 * One function, no framework.
 * API routes call this module ONLY — no direct LLM calls in route handlers.
 *
 * Uses fetch against OpenAI-compatible chat completions endpoint.
 * Configurable base URL via AI_PROVIDER_BASE_URL env var.
 */

export interface InferenceInput {
    model: string;
    input_signature: Record<string, unknown>;
}

export interface InferenceOutput {
    output_payload: Record<string, unknown>;
    confidence_score: number | null;
    uncertainty_metrics: Record<string, unknown> | null;
    raw_content: string;
}

/**
 * Runs a single inference call against the configured AI provider.
 *
 * Rule: this is the ONLY module that touches the LLM.
 */
export async function runInference(input: InferenceInput): Promise<InferenceOutput> {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.AI_PROVIDER_BASE_URL || 'https://api.openai.com/v1';

    if (!apiKey) {
        throw new Error('Missing OPENAI_API_KEY environment variable.');
    }

    const systemPrompt = `You are VetIOS Decision Intelligence, a clinical decision support system for veterinary medicine.
Respond ONLY with valid JSON. Include:
- "analysis": your clinical analysis
- "recommendations": array of recommended actions
- "confidence_score": number 0-1
- "uncertainty_notes": array of strings describing uncertainties`;

    const userPrompt = JSON.stringify(input.input_signature, null, 2);

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: input.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 2048,
            response_format: { type: 'json_object' },
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`AI provider returned ${response.status}: ${errorBody}`);
    }

    const json = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        model: string;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const choice = json.choices[0];
    if (!choice) {
        throw new Error('AI provider returned empty choices array.');
    }

    const rawContent = choice.message.content;

    // Parse the JSON output
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(rawContent);
    } catch {
        parsed = { raw: rawContent, parse_error: true };
    }

    const confidenceScore =
        typeof parsed.confidence_score === 'number' ? parsed.confidence_score : null;

    const uncertaintyMetrics =
        parsed.uncertainty_notes || parsed.uncertainty_metrics
            ? {
                notes: parsed.uncertainty_notes ?? [],
                ...(typeof parsed.uncertainty_metrics === 'object'
                    ? (parsed.uncertainty_metrics as Record<string, unknown>)
                    : {}),
            }
            : null;

    return {
        output_payload: parsed,
        confidence_score: confidenceScore,
        uncertainty_metrics: uncertaintyMetrics,
        raw_content: rawContent,
    };
}
