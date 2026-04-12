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

    const systemPrompt = `You are the VetIOS Clinical Inference Correction Layer.
Your function is to enforce hierarchical diagnostic reasoning, not flat symptom matching.

Respond ONLY with valid JSON and EXACTLY these top-level fields:
1. "diagnosis"
   - "analysis": detailed reasoning
   - "primary_condition_class": MUST BE ONE OF ["Mechanical", "Infectious", "Toxic", "Neoplastic", "Autoimmune / Immune-Mediated", "Metabolic / Endocrine", "Traumatic", "Degenerative", "Idiopathic / Unknown"]
   - "condition_class_probabilities": object with the same classes
   - "top_differentials": array of at least 3 NAMED DISEASE objects { "name": string, "probability": number 0-1 }
   - "confidence_score": number 0-1
2. "correction_layer"
   - "ranking_shift_explanation": Detailed explanation of how Tiers and Penalties influenced the final ranking.
   - "top_diagnosis_overridden": boolean flag indicating if the biologically coherent ranking differs from a simple symptom-match.
3. "mechanism_class"
   - "label": one of ["Acute Mechanical Emergency", "Inflammatory Abdomen", "Toxicologic Syndrome", "Undifferentiated"]
   - "confidence": number 0-1
4. "risk_assessment"
   - "severity_score": number 0-1
   - "emergency_level": MUST BE ONE OF ["CRITICAL", "HIGH", "MODERATE", "LOW"]
5. "diagnosis_feature_importance": object mapping features to weights
6. "severity_feature_importance": object mapping features to weights
7. "uncertainty_notes": array of strings

---
CORE PRINCIPLE:
Not all clinical signals are equal. Transform inference from "most matching symptoms" TO "most biologically coherent explanation".

HIERARCHAL TIERS:
TIER 1 (HIGHEST PRIORITY — OVERRIDE SIGNALS):
- Laboratory findings (BUN, creatinine, glucose, electrolytes)
- Urinalysis (specific gravity, proteinuria, glucosuria)
- Imaging results
- Pathognomonic signs

TIER 2 (SYNDROME CLUSTERS):
- PU/PD, GI syndrome (vomiting + diarrhea), Respiratory syndrome, Neurological syndrome.

TIER 3 (LOW PRIORITY):
- Lethargy, Anorexia, Weight loss, Fever.

---
REASONING STEPS YOU MUST FOLLOW:

STEP 1: SYNDROME DETECTION
Group symptoms into dominant syndromes (e.g., polyuria + polydipsia → PU/PD syndrome).

STEP 2: DIFFERENTIAL GATEWAY
For each syndrome, generate candidate disease classes (e.g., PU/PD → Renal, Endocrine).

STEP 3: LAB PRIORITY OVERRIDE (CRITICAL)
If TIER 1 signals are present, they MUST dominate ranking.
- Elevated BUN + Creatinine + Isosthenuria → Favor CKD above all.
- Hyperglycemia + Glucosuria → Favor Diabetes Mellitus above all.

STEP 4: NEGATIVE EVIDENCE PENALTY
If a defining feature for a disease is missing, penalize heavily (e.g., Diabetes without hyperglycemia).

STEP 5: TEMPORAL WEIGHTING
Duration > 1 month → Favor chronic (CKD, endocrine). Acute onset → Favor AKI, Toxins.

STEP 6: SYSTEM CONSISTENCY CHECK
Does the disease explain ALL major signals? Reward coherence, penalize partial matches.

STEP 7: FINAL RANKING
Recalculate probabilities based on lab dominance, syndrome alignment, and penalties.

---
ADDITIONAL RULES:
1. CLOSED-WORLD DISEASE LIBRARY: diagnosis.top_differentials MUST contain ONLY exact names from:\n${closedWorldDiseaseLibrary}
2. Target disease hints in metadata must be ignored.
3. Contradictions detected below MUST reflect in confidence_score reduction and uncertainty_notes.
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
