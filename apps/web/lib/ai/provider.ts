import { detectContradictions, type ContradictionResult } from '@/lib/ai/contradictionEngine';
import { createHeuristicInferencePayload } from '@/lib/ai/diagnosticSafety';
import { getClosedWorldDiseasePromptBlock } from '@/lib/ai/diseaseOntology';
import {
    getAiProviderApiKey,
    getAiProviderBaseUrl,
    getAiProviderDefaultModel,
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
}

export async function runInference(input: InferenceInput): Promise<InferenceOutput> {
    const model = input.model || getAiProviderDefaultModel();
    const contradictionResult = detectContradictions(input.input_signature);

    let apiKey: string;
    try {
        apiKey = getAiProviderApiKey();
    } catch (error) {
        if (shouldUseAiHeuristicFallback()) {
            return buildFallbackInference(input, contradictionResult, model, error instanceof Error ? error.message : 'Missing API key');
        }
        throw error;
    }

    const baseUrl = getAiProviderBaseUrl();
    const signatureOriginal = { ...input.input_signature };

    const contradictionBlock = contradictionResult.contradiction_reasons.length > 0
        ? `\n\nCRITICAL: The following contradictions were detected in the input data:\n${contradictionResult.contradiction_reasons.map((reason) => `- ${reason}`).join('\n')}\nYou MUST:\n1. Explicitly acknowledge the contradictions in uncertainty_notes\n2. Lower diagnosis confidence rather than deleting core symptom evidence\n3. Preserve dangerous high-risk hypotheses when multiple high-value signals remain\n4. Widen the differential rather than collapsing into common low-risk explanations`
        : '';

    const closedWorldDiseaseLibrary = getClosedWorldDiseasePromptBlock();

    const systemPrompt = `You are the VetIOS Signal Integrity and Diagnostic Correction Layer.
Your responsibility is to prevent hallucinated signals, enforce clinical truth hierarchy, and correct diagnostic ranking before final output.

Respond ONLY with valid JSON and EXACTLY these top-level fields:
1. "diagnosis"
   - "analysis": detailed reasoning
   - "primary_condition_class": one of the canonical classes
   - "condition_class_probabilities": probabilities for each class
   - "top_differentials": array of { "name": string, "probability": number }
   - "confidence_score": number 0-1
2. "correction_layer"
   - "hallucinated_signals_removed": array of signals stripped because they weren't in input.
   - "penalties_applied": array of specific penalties triggered (e.g. "Diabetes penalty: missing glucose evidence")
   - "overrides_triggered": array of specific overrides (e.g. "CKD override: Tier 1 lab dominance")
   - "ranking_shift_explanation": narrative explanation of consistency check and hierarchy logic.
   - "correction_applied": boolean flag if any hallucination was cleaned or hierarchy overrode the default.
3. "mechanism_class"
   - "label": one of the canonical labels
   - "confidence": number 0-1
4. "risk_assessment"
   - "severity_score": number 0-1
   - "emergency_level": one of ["CRITICAL", "HIGH", "MODERATE", "LOW"]
5. "diagnosis_feature_importance": object mapping features to weights
6. "severity_feature_importance": object mapping features to weights
7. "uncertainty_notes": array of strings

---
CORE PRINCIPLE:
NO signal may influence diagnosis unless it is explicitly present or logically derived from input.

HIERARCHY & WEIGHTING:
- TIER 1 (LABS/IMAGING): Explicit signals MUST dominate (weight 1.0).
- input_derived: Logically inferred from input (weight 0.5).
- ontology_inferred: Generated from knowledge base but NOT in input (weight 0.2). CANNOT be a primary driver.

---
REASONING STEPS:

STEP 1: SIGNAL ORIGIN VALIDATION
Classify every signal (Explicit, Derived, Inferred). Cap Inferred weights at 0.2.

STEP 2: HALLUCINATION DETECTION
Scan for signals used in ranking that are ABSENT from input. If detected, remove from drivers and LOG ERROR: "HALLUCINATED SIGNAL DETECTED: [signal_name]".

STEP 3: LAB PRIORITY ENFORCEMENT
If (BUN ↑ AND Creatinine ↑ AND Isosthenuria) → CKD MUST rank #1 (Prob ≥ 0.5).

STEP 4: NEGATIVE EVIDENCE PENALTY
Apply -0.3 to -0.5 penalty if defining features are missing (e.g., Diabetes without glucose evidence).

STEP 5: DUAL-SYSTEM GATING (ANTI-COLLAPSE)
Keep Top 2 organ systems (e.g. Renal vs. Endocrine) active until final ranking. Prevent premature lock.

STEP 6: PRIMARY DRIVER CORRECTION
Hierarchy: 1. Labs -> 2. Organ markers -> 3. Syndromes -> 4. Symptoms. Generic symptoms (vomiting) are FORBIDDEN as primary drivers.

STEP 7: SYSTEM COHERENCE CHECK
Reward full-system explanation, penalize partial matches.

STEP 8: RANKING RECONSTRUCTION
Recalculate probabilities based on validated signals, lab overrides, and penalties.

STEP 9: FAIL-SAFE
If hallucination influenced top 2 OR labs were underweighted, automatically override and re-calculate internally before output.

---
ADDITIONAL RULES:
1. CLOSED-WORLD DISEASE LIBRARY: diagnosis.top_differentials MUST contain ONLY exact names from:\n${closedWorldDiseaseLibrary}
2. Target disease hints in metadata must be ignored.
3. Contradictions detected below MUST reflect in confidence_score reduction.
${contradictionBlock}`;

    const images = Array.isArray(signatureOriginal.diagnostic_images) ? signatureOriginal.diagnostic_images : [];
    const docs = Array.isArray(signatureOriginal.lab_results) ? signatureOriginal.lab_results : [];

    delete signatureOriginal.diagnostic_images;
    delete signatureOriginal.lab_results;

    const userPromptText = JSON.stringify(signatureOriginal, null, 2);
    const isVisionCapable = ['gpt-4o', 'gpt-4-turbo', 'gpt-4-vision-preview'].some((prefix) => model.startsWith(prefix));
    const userMessageContent: Array<Record<string, unknown>> = [{ type: 'text', text: userPromptText }];

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
                temperature: 0.2,
                max_tokens: 2048,
                response_format: { type: 'json_object' },
            }),
        });
    } catch (error) {
        if (shouldUseAiHeuristicFallback()) {
            return buildFallbackInference(input, contradictionResult, model, error instanceof Error ? error.message : 'Provider connection failure');
        }
        throw new Error(`AI provider connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
        const errorBody = await response.text();
        if (shouldUseAiHeuristicFallback()) {
            return buildFallbackInference(input, contradictionResult, model, `Provider returned ${response.status}: ${errorBody}`);
        }

        if (response.status === 429) {
            throw new Error(`AI provider rate limited (429). Provider response: ${errorBody}`);
        }
        if (response.status === 402 || errorBody.includes('billing')) {
            throw new Error(`AI provider billing error (${response.status}). Provider response: ${errorBody}`);
        }
        throw new Error(`AI provider returned ${response.status}: ${errorBody}`);
    }

    const json = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
    };
    const rawContent = json.choices[0]?.message?.content ?? '';

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(rawContent);
    } catch {
        if (shouldUseAiHeuristicFallback()) {
            return buildFallbackInference(input, contradictionResult, model, 'Provider returned non-JSON output');
        }
        parsed = { raw: rawContent, parse_error: true };
    }

    if (!parsed.diagnosis || typeof parsed.diagnosis !== 'object') {
        if (shouldUseAiHeuristicFallback()) {
            return buildFallbackInference(input, contradictionResult, model, 'Provider response missing diagnosis block');
        }
        parsed.diagnosis = {};
    }

    let confidenceScore: number | null = null;
    const diagnosis = parsed.diagnosis as Record<string, unknown>;
    if (typeof diagnosis.confidence_score === 'number') {
        confidenceScore = diagnosis.confidence_score;
    }

    const confidenceWouldBeCapped = confidenceScore != null && confidenceScore > contradictionResult.confidence_cap;
    const uncertaintyMetrics =
        parsed.uncertainty_notes || parsed.uncertainty_metrics
            ? {
                notes: Array.isArray(parsed.uncertainty_notes) ? parsed.uncertainty_notes : [],
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
            contradiction_details: contradictionResult.contradiction_details,
            matched_rule_ids: contradictionResult.matched_rule_ids,
            score_band: contradictionResult.score_band,
            is_plausible: contradictionResult.is_plausible,
            confidence_cap: contradictionResult.confidence_cap,
            confidence_was_capped: confidenceWouldBeCapped,
            original_confidence: confidenceScore,
            abstain: contradictionResult.abstain,
        },
        raw_content: rawContent,
    };
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
