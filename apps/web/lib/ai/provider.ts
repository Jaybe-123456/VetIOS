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
    contradiction_analysis: {
        contradiction_score: number;
        contradiction_reasons: string[];
        is_plausible: boolean;
        confidence_cap: number;
        confidence_was_capped: boolean;
        original_confidence: number | null;
        abstain: boolean;
    } | null;
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

    // ── Contradiction Detection ──────────────────────────────────────────
    const { detectContradictions } = await import('./contradictionDetector');
    const contradictionResult = detectContradictions(input.input_signature);

    // Build contradiction context for the prompt
    const contradictionBlock = contradictionResult.contradiction_reasons.length > 0
        ? `\n\nCRITICAL — The following contradictions were detected in the input data:\n${contradictionResult.contradiction_reasons.map(c => `- ${c}`).join('\n')}\nYou MUST:\n1. Acknowledge these contradictions in your analysis\n2. LOWER your diagnosis.confidence_score accordingly (cap: ${contradictionResult.confidence_cap})\n3. Widen your differential diagnosis spread`
        : '';

    const systemPrompt = `You are VetIOS Decision Intelligence, a probabilistic clinical reasoning engine for veterinary medicine.
You MUST reason across the FULL clinical picture.

Respond ONLY with valid JSON. You MUST structure your output with EXACTLY these fields:
1. "diagnosis": an object containing:
    - "analysis": detailed clinical analysis explaining your reasoning chain
    - "primary_condition_class": string MUST BE EXACTLY ONE OF ["Mechanical", "Infectious", "Toxic", "Neoplastic", "Autoimmune / Immune-Mediated", "Metabolic / Endocrine", "Traumatic", "Degenerative", "Idiopathic / Unknown"]
    - "condition_class_probabilities": object mapping each of the above classes to a probability (must sum to ~1.0)
    - "top_differentials": array of objects, each with { "name": string, "probability": number 0-1 } — MUST include at least 3
    - "confidence_score": number 0-1 — your overall certainty in the top diagnosis.
2. "risk_assessment": an object containing:
    - "severity_score": number 0-1 — independent of diagnosis certainty. Even unknown/uncertain diagnoses can be highly severe.
    - "emergency_level": string MUST BE ONE OF ["CRITICAL", "HIGH", "MODERATE", "LOW"]
3. "diagnosis_feature_importance": object mapping key symptoms/features to their weight (0-1) driving the diagnosis.
4. "severity_feature_importance": object mapping key symptoms/features to their weight (0-1) driving the severity.
5. "uncertainty_notes": array of strings describing specific ambiguities or missing data.

RULES:
1. Do NOT force conditions into Infectious if they are Mechanical (e.g., GDV) or Toxic.
2. Diagnosis confidence and Risk/Severity MUST be evaluated independently. LOW diagnosis confidence ≠ LOW severity. HIGH severity must trigger for critical signs (dyspnea, collapse, acute abdomen) even if diagnosis is unknown.
3. If metadata is biologically impossible, you MUST LOWER diagnosis_confidence.
4. NEVER lock onto a single diagnosis with >70% confidence when multiple differential signals exist.
5. If a "target_disease" field is present in the input, IGNORE it for diagnostic purposes.${contradictionBlock}`;

    const signatureOriginal = { ...input.input_signature };
    
    // Extract heavy attachments to prevent massive base64 strings from blowing up the text token context
    const images: any[] = Array.isArray(signatureOriginal.diagnostic_images) ? signatureOriginal.diagnostic_images : [];
    const docs: any[] = Array.isArray(signatureOriginal.lab_results) ? signatureOriginal.lab_results : [];
    
    delete signatureOriginal.diagnostic_images;
    delete signatureOriginal.lab_results;

    const userPromptText = JSON.stringify(signatureOriginal, null, 2);
    
    // Only vision-capable models can accept image_url content blocks
    const VISION_MODELS = ['gpt-4o', 'gpt-4-turbo', 'gpt-4-vision-preview'];
    const isVisionCapable = VISION_MODELS.some(vm => model.startsWith(vm));

    const userMessageContent: any[] = [
        { type: "text", text: userPromptText }
    ];

    for (const img of images) {
        const isActualImage = typeof img.mime_type === 'string' && img.mime_type.startsWith('image/');

        if (img.content_base64 && isActualImage && isVisionCapable) {
            // Vision model + actual image: send as image_url
            userMessageContent.push({
                type: "image_url",
                image_url: {
                    url: `data:${img.mime_type};base64,${img.content_base64}`
                }
            });
        } else if (img.content_base64 && !isActualImage) {
            // Non-image file (PDF, etc.) uploaded via images field: try to decode as text
            try {
                const decodedText = Buffer.from(img.content_base64, 'base64').toString('utf-8');
                userMessageContent.push({
                    type: "text",
                    text: `\n--- Attached File: ${img.file_name || 'unknown'} (${img.mime_type}) ---\n${decodedText.substring(0, 5000)}`
                });
            } catch {
                userMessageContent.push({
                    type: "text",
                    text: `\n[Attached File: ${img.file_name || 'unknown'} (${img.mime_type || 'unknown type'}, ${img.size_bytes ? Math.round(img.size_bytes / 1024) + 'KB' : 'unknown size'}) — binary content, not decodable as text]`
                });
            }
        } else if (img.file_name) {
            // Non-vision model with image: describe as text metadata
            userMessageContent.push({
                type: "text",
                text: `\n[Attached Image: ${img.file_name} (${img.mime_type || 'unknown type'}, ${img.size_bytes ? Math.round(img.size_bytes / 1024) + 'KB' : 'unknown size'})]`
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

    // Extract confidence from new schema mapping
    let confidenceScore = null;
    if (parsed.diagnosis && typeof parsed.diagnosis === 'object') {
        const diag = parsed.diagnosis as Record<string, unknown>;
        if (typeof diag.confidence_score === 'number') {
            confidenceScore = diag.confidence_score;
        }
    }

    // ── Apply Contradiction Confidence Cap ────────────────────────────────
    const originalConfidence = confidenceScore;
    let confidenceWasCapped = false;
    if (confidenceScore != null && contradictionResult.confidence_cap < 1.0) {
        if (confidenceScore > contradictionResult.confidence_cap) {
            confidenceScore = contradictionResult.confidence_cap;
            confidenceWasCapped = true;
        }
    }
    // Also inject capped confidence back into parsed output
    if (confidenceWasCapped) {
        if (!parsed.diagnosis || typeof parsed.diagnosis !== 'object') {
            parsed.diagnosis = {};
        }
        (parsed.diagnosis as Record<string, unknown>).confidence_score = confidenceScore;
        parsed.confidence_was_capped = true;
        parsed.original_confidence = originalConfidence;
        parsed.confidence_cap_reason = contradictionResult.contradiction_reasons;
    }

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
        contradiction_analysis: {
            contradiction_score: contradictionResult.contradiction_score,
            contradiction_reasons: contradictionResult.contradiction_reasons,
            is_plausible: contradictionResult.is_plausible,
            confidence_cap: contradictionResult.confidence_cap,
            confidence_was_capped: confidenceWasCapped,
            original_confidence: originalConfidence,
            abstain: contradictionResult.abstain,
        },
        raw_content: rawContent,
    };
}
