/**
 * AI Provider Abstraction
 *
 * One function, no framework.
 * API routes call this module ONLY — no direct LLM calls in route handlers.
 *
 * Env var support:
 *   - OPENAI_API_KEY or AI_PROVIDER_API_KEY
 *   - AI_PROVIDER_BASE_URL (default: https://api.openai.com/v1)
 *   - AI_PROVIDER_DEFAULT_MODEL (default: gpt-4o-mini)
 */

export interface InferenceInput {
    model?: string;
    input_signature: Record<string, unknown>;
}

export interface InferenceOutput {
    output_payload: Record<string, unknown>;
    confidence_score: number | null;
    uncertainty_metrics: Record<string, unknown> | null;
    raw_content: string;
}

function getApiKey(): string {
    const key = process.env.OPENAI_API_KEY || process.env.AI_PROVIDER_API_KEY;
    if (!key) {
        throw new Error(
            'Missing AI provider key: set OPENAI_API_KEY or AI_PROVIDER_API_KEY.'
        );
    }
    return key;
}

function getBaseUrl(): string {
    return process.env.AI_PROVIDER_BASE_URL || 'https://api.openai.com/v1';
}

function getDefaultModel(): string {
    return process.env.AI_PROVIDER_DEFAULT_MODEL || 'gpt-4o-mini';
}

/**
 * Runs a single inference call against the configured AI provider.
 *
 * Rule: this is the ONLY module that touches the LLM.
 */
export async function runInference(input: InferenceInput): Promise<InferenceOutput> {
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();
    const model = input.model || getDefaultModel();

    const systemPrompt = `You are VetIOS Decision Intelligence, a clinical decision support system for veterinary medicine.
Respond ONLY with valid JSON. Include:
- "analysis": your clinical analysis
- "recommendations": array of recommended actions
- "confidence_score": number 0-1
- "uncertainty_notes": array of strings describing uncertainties`;

    const signatureOriginal = { ...input.input_signature };
    
    // Extract heavy attachments to prevent massive base64 strings from blowing up the text token context
    const images: any[] = Array.isArray(signatureOriginal.diagnostic_images) ? signatureOriginal.diagnostic_images : [];
    const docs: any[] = Array.isArray(signatureOriginal.lab_results) ? signatureOriginal.lab_results : [];
    
    delete signatureOriginal.diagnostic_images;
    delete signatureOriginal.lab_results;

    const userPromptText = JSON.stringify(signatureOriginal, null, 2);
    
    const userMessageContent: any[] = [
        { type: "text", text: userPromptText }
    ];

    for (const img of images) {
        if (img.content_base64 && img.mime_type) {
            userMessageContent.push({
                type: "image_url",
                image_url: {
                    url: `data:${img.mime_type};base64,${img.content_base64}`
                }
            });
        }
    }

    for (const doc of docs) {
        if (doc.content_base64) {
            try {
                // Decode documents and truncate to 5000 chars to avoid token limits
                const decodedText = Buffer.from(doc.content_base64, 'base64').toString('utf-8');
                userMessageContent.push({
                    type: "text", 
                    text: `\n--- Document: ${doc.file_name} ---\n${decodedText.substring(0, 5000)}...`
                });
            } catch (e) {
                console.warn("Failed to decode document base64");
            }
        }
    }

    let response: Response;
    try {
        response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessageContent },
                ],
                temperature: 0.3,
                max_tokens: 2048,
                response_format: { type: 'json_object' },
            }),
        });
    } catch (err) {
        throw new Error(
            `AI provider connection failed: ${err instanceof Error ? err.message : String(err)}`
        );
    }

    if (!response.ok) {
        const errorBody = await response.text();

        // Surface quota/billing errors cleanly
        if (response.status === 429) {
            throw new Error(
                `AI provider rate limited (429). You may have exceeded your quota. ` +
                `Provider response: ${errorBody}`
            );
        }
        if (response.status === 402 || errorBody.includes('billing')) {
            throw new Error(
                `AI provider billing error (${response.status}). ` +
                `Check your API key billing status. Provider response: ${errorBody}`
            );
        }

        throw new Error(
            `AI provider returned ${response.status}: ${errorBody}`
        );
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
