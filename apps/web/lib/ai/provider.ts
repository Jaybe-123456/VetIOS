import { detectContradictions, type ContradictionResult } from '@/lib/ai/contradictionEngine';
import { createHeuristicInferencePayload } from '@/lib/ai/diagnosticSafety';
import { getClosedWorldDiseasePromptBlock } from '@/lib/ai/diseaseOntology';
import {
    getAiProviderApiKey,
    getAiProviderBaseUrl,
    getAiProviderDefaultModel,
    getHfProviderApiKey,
    getHfProviderBaseUrl,
    getHfProviderModel,
    isHfEnabled,
    shouldUseAiHeuristicFallback,
} from '@/lib/ai/config';

export interface InferenceInput {
    model?: string;
    input_signature: Record<string, unknown>;
}

export interface InferenceOutput {
    output_payload: Record<string, unknown>;
    confidence_score: number | null;
    uncertainty_metrics: Record<string, unknown> | null;
    contradiction_analysis: (ContradictionResult & {
        confidence_was_capped: boolean;
        original_confidence: number | null;
    }) | null;
    raw_content: string;
    ensemble_metadata?: {
        openai_status: 'success' | 'failed' | 'disabled';
        hf_status: 'success' | 'failed' | 'disabled';
        hf_raw_output?: string;
    };
}

export async function runInference(input: InferenceInput): Promise<InferenceOutput> {
    const primaryModel = input.model || getAiProviderDefaultModel();
    const contradictionResult = detectContradictions(input.input_signature);

    if (shouldUseAiHeuristicFallback()) {
        return buildFallbackInference(input, contradictionResult, primaryModel, 'Heuristic fallback enabled');
    }

    const closedWorldDiseaseLibrary = getClosedWorldDiseasePromptBlock();
    const signatureOriginal = { ...input.input_signature };
    const contradictionBlock = contradictionResult.contradiction_reasons.length > 0
        ? `\n\nCRITICAL: The following contradictions were detected in the input data:\n${contradictionResult.contradiction_reasons.map((reason) => `- ${reason}`).join('\n')}\nYou MUST:\n1. Explicitly acknowledge the contradictions in uncertainty_notes\n2. Lower diagnosis confidence rather than deleting core symptom evidence\n3. Preserve dangerous high-risk hypotheses when multiple high-value signals remain\n4. Widen the differential rather than collapsing into common low-risk explanations`
        : '';

    const systemPrompt = `You are VetIOS, a veterinary clinical intelligence assistant.
Your responsibility is to provide either structured clinical diagnostic reasoning or high-level educational clinical knowledge.

STEP 1: INTENT CLASSIFICATION
First, classify the user's intent:
- "clinical": User describes a patient with symptoms (species, age, signs).
- "educational": User asks what a disease/condition is, its mechanism, epidemiology, treatment, etc.
- "operational": User asks about VetIOS platform features.

STEP 2: RESPONSE MODES

--- MODE A: CLINICAL ---
Trigger: User provides patient data or symptoms.
Respond with ONLY a valid JSON object:
{
  "mode": "clinical",
  "diagnosis_ranked": [
    { "name": string, "probability": number, "reasoning": string }
  ],
  "urgency_level": "low" | "moderate" | "high" | "emergency",
  "recommended_tests": string[],
  "explanation": string
}

--- MODE B: EDUCATIONAL ---
Trigger: User asks for a definition, mechanism, classification, or research-level overview.
Respond with ONLY a valid JSON object:
{
  "mode": "educational",
  "answer": string 
}

--- MODE C: OPERATIONAL ---
Trigger: User asks how to use the site.
Respond with ONLY a valid JSON object:
{
  "mode": "operational",
  "answer": "Instructions on navigating VetIOS."
}

--- CORE PRINCIPLES ---
- Never return a differential diagnosis structure for educational queries.
- All clinical diagnosis names in MODE A must come from this library:
${closedWorldDiseaseLibrary}
- Reflect detected contradictions in confidence scores:
${contradictionBlock}`;

    // Prepare User Message Content (Images/Docs)
    const images = Array.isArray(signatureOriginal.diagnostic_images) ? signatureOriginal.diagnostic_images : [];
    const docs = Array.isArray(signatureOriginal.lab_results) ? signatureOriginal.lab_results : [];
    delete signatureOriginal.diagnostic_images;
    delete signatureOriginal.lab_results;

    const userPromptText = JSON.stringify(signatureOriginal, null, 2);
    const isVisionCapable = ['gpt-4o', 'gpt-4-turbo', 'gpt-4-vision-preview'].some((prefix) => primaryModel.startsWith(prefix));
    const userMessageContent: any[] = [{ type: 'text', text: userPromptText }];

    for (const image of images) {
        const img = image as Record<string, unknown>;
        const mimeType = typeof img.mime_type === 'string' ? img.mime_type : '';
        const contentBase64 = typeof img.content_base64 === 'string' ? img.content_base64 : null;

        if (contentBase64 && mimeType.startsWith('image/') && isVisionCapable) {
            userMessageContent.push({
                type: 'image_url',
                image_url: {
                    url: `data:${mimeType};base64,${contentBase64}`,
                },
            });
            continue;
        }

        if (contentBase64 && !mimeType.startsWith('image/')) {
            try {
                const decodedText = Buffer.from(contentBase64, 'base64').toString('utf-8');
                userMessageContent.push({
                    type: 'text',
                    text: `\n--- Attached File: ${String(img.file_name ?? 'unknown')} (${mimeType || 'unknown'}) ---\n${decodedText.substring(0, 5000)}`,
                });
            } catch {
                userMessageContent.push({
                    type: 'text',
                    text: `\n[Attached File: ${String(img.file_name ?? 'unknown')} (${mimeType || 'unknown'}) - binary content omitted]`,
                });
            }
        }
    }

    for (const document of docs) {
        const doc = document as Record<string, unknown>;
        const contentBase64 = typeof doc.content_base64 === 'string' ? doc.content_base64 : null;
        if (!contentBase64) continue;
        try {
            const decodedText = Buffer.from(contentBase64, 'base64').toString('utf-8');
            userMessageContent.push({
                type: 'text',
                text: `\n--- Document: ${String(doc.file_name ?? 'unknown')} ---\n${decodedText.substring(0, 5000)}`,
            });
        } catch {
            userMessageContent.push({
                type: 'text',
                text: `\n[Document: ${String(doc.file_name ?? 'unknown')} - binary content omitted]`,
            });
        }
    }

    const primaryRequest = performApiRequest(
        getAiProviderBaseUrl(),
        getAiProviderApiKey(),
        primaryModel,
        systemPrompt,
        userMessageContent
    );

    let hfRequest: Promise<any> | null = null;
    if (isHfEnabled()) {
        const hfBaseUrl = getHfProviderBaseUrl();
        const hfApiKey = getHfProviderApiKey();
        const hfModel = getHfProviderModel();
        if (hfBaseUrl && hfApiKey) {
            hfRequest = performApiRequest(hfBaseUrl, hfApiKey, hfModel, systemPrompt, userMessageContent);
        }
    }

    // Execute concurrently
    const [primaryResult, hfResult] = await Promise.all([
        primaryRequest.catch(err => ({ error: err.message })),
        hfRequest ? hfRequest.catch(err => ({ error: err.message })) : Promise.resolve(null)
    ]);

    if ('error' in primaryResult) {
        return buildFallbackInference(input, contradictionResult, primaryModel, `Primary AI failed: ${primaryResult.error}`);
    }

    const rawContent = primaryResult.choices[0]?.message?.content ?? '';
    let parsed: Record<string, any>;
    try {
        parsed = JSON.parse(rawContent);
    } catch {
        parsed = { raw: rawContent, parse_error: true };
    }

    // Inject HF validation if available
    let ensembleMeta: InferenceOutput['ensemble_metadata'] = {
        openai_status: 'success',
        hf_status: isHfEnabled() ? (hfResult && !('error' in hfResult) ? 'success' : 'failed') : 'disabled'
    };

    if (hfResult && !('error' in hfResult)) {
        ensembleMeta.hf_raw_output = hfResult.choices[0]?.message?.content;
        // Optional: Perform cross-model comparison or merge results
        if (parsed.mode === 'clinical' && ensembleMeta.hf_raw_output) {
            try {
                const hfParsed = JSON.parse(ensembleMeta.hf_raw_output);
                parsed.custom_model_validation = hfParsed.diagnosis_ranked?.[0] || null;
            } catch { /* ignore HF parse errors */ }
        }
    }

    const confidenceScore = (parsed.diagnosis as any)?.confidence_score ?? null;

    return {
        output_payload: parsed,
        confidence_score: confidenceScore,
        uncertainty_metrics: parsed.uncertainty_notes ? { notes: parsed.uncertainty_notes } : null,
        contradiction_analysis: {
            ...contradictionResult,
            confidence_was_capped: confidenceScore != null && confidenceScore > contradictionResult.confidence_cap,
            original_confidence: confidenceScore,
        } as any,
        raw_content: rawContent,
        ensemble_metadata: ensembleMeta
    };
}

async function performApiRequest(baseUrl: string, apiKey: string, model: string, systemPrompt: string, userContent: any[]): Promise<any> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent },
            ],
            temperature: 0.1, // Lower temperature for more consistent clinical results
            max_tokens: 2048,
            response_format: { type: 'json_object' },
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error (${response.status}): ${error}`);
    }

    return response.json();
}

function buildFallbackInference(
    input: InferenceInput,
    contradictionResult: ReturnType<typeof detectContradictions>,
    model: string,
    reason: string,
): InferenceOutput {
    const outputPayload = createHeuristicInferencePayload({
        inputSignature: input.input_signature,
        contradiction: contradictionResult,
        modelVersion: model,
        fallbackReason: reason,
    });

    const diagnosis = outputPayload.diagnosis as Record<string, unknown>;
    const confidenceScore = typeof diagnosis.confidence_score === 'number' ? diagnosis.confidence_score : null;

    return {
        output_payload: outputPayload,
        confidence_score: confidenceScore,
        uncertainty_metrics: {
            notes: Array.isArray(outputPayload.uncertainty_notes) ? outputPayload.uncertainty_notes : [],
            fallback_reason: reason,
            fallback_mode: 'deterministic_heuristic',
        },
        contradiction_analysis: {
            contradiction_score: contradictionResult.contradiction_score,
            contradiction_reasons: contradictionResult.contradiction_reasons,
            contradiction_details: contradictionResult.contradiction_details,
            matched_rule_ids: contradictionResult.matched_rule_ids,
            score_band: contradictionResult.score_band,
            is_plausible: contradictionResult.is_plausible,
            confidence_cap: contradictionResult.confidence_cap,
            confidence_was_capped: confidenceScore != null && confidenceScore > contradictionResult.confidence_cap,
            original_confidence: confidenceScore,
            abstain: contradictionResult.abstain,
        },
        raw_content: JSON.stringify({ fallback_reason: reason }),
    };
}
