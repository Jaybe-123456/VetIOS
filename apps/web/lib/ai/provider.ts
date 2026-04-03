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

    const systemPrompt = `You are VetIOS Decision Intelligence, a probabilistic clinical reasoning engine for veterinary medicine.
Respond ONLY with valid JSON and EXACTLY these top-level fields:
1. "diagnosis"
   - "analysis": detailed reasoning
   - "primary_condition_class": MUST BE ONE OF ["Mechanical", "Infectious", "Toxic", "Neoplastic", "Autoimmune / Immune-Mediated", "Metabolic / Endocrine", "Traumatic", "Degenerative", "Idiopathic / Unknown"]
   - "condition_class_probabilities": object with the same classes
   - "top_differentials": array of at least 3 NAMED DISEASE objects { "name": string, "probability": number 0-1 }
   - "confidence_score": number 0-1
2. "mechanism_class"
   - "label": one of ["Acute Mechanical Emergency", "Inflammatory Abdomen", "Toxicologic Syndrome", "Undifferentiated"]
   - "confidence": number 0-1
3. "risk_assessment"
   - "severity_score": number 0-1
   - "emergency_level": MUST BE ONE OF ["CRITICAL", "HIGH", "MODERATE", "LOW"]
   - optional "catastrophic_deterioration_risk_6h": number 0-1
   - optional "operative_urgency_risk": number 0-1
   - optional "shock_risk": number 0-1
4. "diagnosis_feature_importance": object mapping features to weights
5. "severity_feature_importance": object mapping features to weights
6. "uncertainty_notes": array of strings

RULES:
1. Target disease hints must be ignored diagnostically.
2. Diagnosis confidence and severity must remain independent.
3. Contradictions lower confidence and widen uncertainty; they do not overwrite symptom truth.
4. CLOSED-WORLD DISEASE LIBRARY: diagnosis.top_differentials MUST contain ONLY exact disease names from the following canonical library. If the evidence is weak, choose the closest supported names from this library rather than inventing or paraphrasing a disease.\n${closedWorldDiseaseLibrary}
5. Before finalizing the differential, explicitly review these clinical domains whenever the evidence suggests them: nutritional, infectious, endocrine, neurologic, toxic, metabolic, and parasitic. If the library lacks a precise nutritional match, say so in uncertainty_notes instead of collapsing by default into endocrine or metabolic disease.
6. Tier 1 features MUST outrank generic distractors:
   - Tier 1: unproductive retching, abdominal distension, myoclonus, honking cough, ocular+nasal discharge clusters, collapse with a strong emergency pattern.
   - Tier 2: dyspnea, tachycardia, pale mucous membranes, vomiting, diarrhea, fever.
   - Tier 3: lethargy, anorexia, weakness if isolated.
7. Generic distractors must not erase structural emergencies like GDV.
8. If multiple high-risk abdominal emergency signals cluster, retain GDV or another named abdominal emergency in the leading differential set.
9. NEVER place generic mechanism labels such as "Acute Mechanical Emergency" inside diagnosis.top_differentials. Those belong only in mechanism_class.
10. If honking cough or upper-airway infectious anchors are present, retain clinically dominant airway diagnoses in the leading differential set.
11. It is acceptable to keep emergency_level=CRITICAL even when diagnosis confidence is low.
12. Endocrine overlap rule: shared PU/PD/polyphagia or lethargy must NOT by themselves decide between Hyperadrenocorticism and Diabetes Mellitus.
13. Diabetes Mellitus should be strongly favored only when significant hyperglycemia clusters with glucosuria; ketonuria or weight loss further strengthen it.
14. If glucosuria is absent, explicitly lower Diabetes Mellitus ranking even if polyuria, polydipsia, or mild hyperglycemia are present.
15. Hyperadrenocorticism should be boosted by marked ALP elevation, pot-bellied appearance, panting, alopecia, chronic gradual onset, hypercholesterolemia, supportive ACTH stimulation testing, or dilute urine without glucosuria.
16. If a classic GDV pattern is present, strongly favor GDV above simple gastric dilatation and above benign vomiting syndromes.
17. If input_signature.metadata.signal_weight_profile is present, preserve its red_flag and emergency_override signals as dominant evidence anchors; contextual signals modify interpretation but must not erase those anchors.${contradictionBlock}`;

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
