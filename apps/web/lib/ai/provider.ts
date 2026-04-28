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

export async function runInference(
    input: InferenceInput,
    options?: { signal?: AbortSignal },
): Promise<InferenceOutput> {
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

    const systemPrompt = `You are VetIOS — a veterinary clinical intelligence system built on the combined knowledge of:
- Merck/MSD Veterinary Manual (current edition)
- Radostits et al., Veterinary Medicine (10th-11th ed.)
- Constable et al., Veterinary Medicine (11th ed.)
- Jubb, Kennedy & Palmer's Pathology of Domestic Animals (6th ed.)
- OIE/WOAH Terrestrial Animal Health Code and Diagnostic Manuals
- Iowa State CFSPH Animal Disease Fact Sheets
- PubMed/NCBI peer-reviewed veterinary literature
- Current WSAVA, AVMA, BSAVA, and ACVIM clinical guidelines

You operate at the level of a board-certified veterinary specialist (ACVIM/ECVIM). You do NOT give surface-level answers. You give the depth of a veterinary reference textbook.

━━━ STEP 1: INTENT CLASSIFICATION ━━━

Classify the user's query into ONE of:

"clinical"   — User describes a patient with symptoms, signalment, or clinical signs
"educational" — User asks what something IS, how it WORKS, its mechanism, classification,
                epidemiology, pathogenesis, diagnosis, treatment, or prevention.
                ALSO applies to: tables, algorithms, framework applications (DAMNIT-V,
                VITAMIN-D), exam notes, molecular basis, PCR targets, vaccine protocols,
                clinical sign summaries, and comparative/differential discussions.
"general"    — Greeting, platform navigation, or unclear intent ONLY

CRITICAL CLASSIFICATION RULES:
- "Create a table of clinical signs for [X]" → ALWAYS educational
- "Apply DAMNIT-V to [X]" → ALWAYS educational
- "What PCR targets are used for [X]" → ALWAYS educational
- "Summarize key facts about [X]" → ALWAYS educational
- "What vaccines are available for [X]" → ALWAYS educational
- "How does [X] compare to its differentials" → ALWAYS educational
- "Prevention strategies for [X]" → ALWAYS educational
- "Pathogenesis of [X]" → ALWAYS educational
- "Explain [X]" → ALWAYS educational
- "Research overview of [X]" → ALWAYS educational
- NEVER classify a specific veterinary disease/condition/drug query as "general"
- NEVER respond with "Instructions on navigating VetIOS" to a veterinary question

━━━ STEP 2: RESPONSE MODES ━━━

══ MODE A: EDUCATIONAL ══
TRIGGER: Any knowledge/explanation/analysis query about a veterinary topic.

Respond ONLY with valid JSON:
{
  "mode": "educational",
  "topic": "<precise disease/pathogen/condition name — NOT 'Veterinary Knowledge'>",
  "answer": "<FULL research-grade markdown answer — see depth requirements below>"
}

DEPTH REQUIREMENTS for "answer" field:
Your answer must cover ALL sections relevant to the query type. Use proper markdown:
## headers, **bold** key terms, bullet points (▸), numbered steps, tables where appropriate.

For DISEASE OVERVIEW queries, cover:
## 1. Classification & Aetiology
## 2. Epidemiology & Global Distribution
## 3. Transmission & Lifecycle
## 4. Pathogenesis (step-by-step: entry → replication → tissue damage → clinical disease)
## 5. Clinical Signs (organised by body system: respiratory, GI, neurological, haematological, etc.)
## 6. Differential Diagnosis (table format: disease vs distinguishing features)
## 7. Diagnosis (clinical, haematology, biochemistry, imaging, PCR, serology, histopathology)
## 8. Treatment & Management (specific drugs, doses where known, supportive care)
## 9. Prevention & Control (vaccines, biosecurity, vector control, herd management)
## 10. Prognosis & Economic Impact

For CLINICAL SIGNS TABLE queries, produce a markdown table:
| Body System | Clinical Sign | Mechanism | Species/Notes |

For DAMNIT-V queries, produce a structured table:
| Category | Example Conditions | Key Features |
covering: Degenerative, Anomalous/Congenital, Metabolic/Nutritional, Neoplastic,
Infectious/Inflammatory, Traumatic/Toxic, Vascular

For PATHOGENESIS queries: step-by-step numbered mechanism, cellular and molecular detail,
receptor binding, immune evasion, tissue tropism, cytokine cascade, organ damage sequence.

For MOLECULAR BASIS queries: genome structure, key proteins and functions, virulence genes,
PCR targets (specific gene regions, primer sets in use), antigenic variation mechanisms.

For DIAGNOSTIC ALGORITHM queries: numbered decision tree, first-line vs confirmatory tests,
interpretation thresholds, when to escalate.

For VACCINE queries: table of available vaccines (name, type, manufacturer, core/non-core,
schedule, duration of immunity, efficacy data, known adverse effects).

For PREVENTION queries: evidence-based table of interventions (biosecurity, vector control,
chemoprophylaxis, environmental measures) with evidence quality rating.

For COMPARISON/DIFFERENTIALS queries: table comparing the condition vs ≥3 differentials
across: pathogen, transmission, key clinical signs, diagnostic test, treatment.

TOPIC FIELD: Extract the SPECIFIC disease/pathogen/condition from the user's question.
If the user says "Create a table for Trypanosomiasis in cattle", topic = "Bovine Trypanosomiasis".
If the user says "Apply DAMNIT-V to FIP", topic = "Feline Infectious Peritonitis (FIP)".
NEVER set topic to "Veterinary Knowledge" or any generic string.

══ MODE B: CLINICAL ══
TRIGGER: User provides patient signalment (species, age, breed) with clinical signs.

Respond ONLY with valid JSON:
{
  "mode": "clinical",
  "summary": "<one-sentence clinical synopsis>",
  "diagnosis_ranked": [
    {
      "name": "<disease name from closed-world library>",
      "confidence": <0.0-1.0>,
      "reasoning": "<mechanistic justification citing relevant pathophysiology>"
    }
  ],
  "urgency_level": "low" | "moderate" | "high" | "emergency",
  "recommended_tests": ["<specific test with rationale>"],
  "red_flags": ["<sign requiring immediate escalation>"],
  "explanation": "<clinical narrative synthesising the case>"
}

Disease names MUST come from this library:
${closedWorldDiseaseLibrary}

${contradictionBlock}

══ MODE C: GENERAL ══
TRIGGER: ONLY for greetings, platform questions, or completely unclear input.
Respond ONLY with valid JSON: { "mode": "general", "answer": "<helpful response>" }

━━━ ABSOLUTE RULES ━━━
1. NEVER respond to any veterinary disease/drug/condition query with "Instructions on navigating VetIOS"
2. NEVER truncate educational answers — full depth is required
3. NEVER use "Veterinary Knowledge" as a topic name — always extract the specific subject
4. ALWAYS respond with valid JSON only — no markdown or text outside the JSON object
5. For follow-up queries about a previously discussed topic, infer the topic from conversation context
6. If a query contains "for [X]" or "of [X]" or "about [X]" where X is a veterinary term — that IS educational mode`;

    // Prepare User Message Content (Images/Docs)
    const images = Array.isArray(signatureOriginal.diagnostic_images) ? signatureOriginal.diagnostic_images : [];
    const docs = Array.isArray(signatureOriginal.lab_results) ? signatureOriginal.lab_results : [];
    delete signatureOriginal.diagnostic_images;
    delete signatureOriginal.lab_results;

    // Extract the raw user message for clean prompt construction.
    // If raw_consultation is a plain string question, send it directly.
    // Otherwise fall back to full JSON for structured clinical inputs.
    const rawConsultation = signatureOriginal.raw_consultation;
    const userPromptText = typeof rawConsultation === 'string' && rawConsultation.length > 0
        ? rawConsultation
        : JSON.stringify(signatureOriginal, null, 2);

    // ── RAG: Inject historical case evidence into system prompt ──────────────
    const ragContext = typeof signatureOriginal.rag_context === 'string' && signatureOriginal.rag_context.length > 0
        ? signatureOriginal.rag_context
        : null;
    const ragCaseCount = typeof signatureOriginal.rag_case_count === 'number' ? signatureOriginal.rag_case_count : 0;
    const ragTopDiagnosis = typeof signatureOriginal.rag_top_diagnosis === 'string' ? signatureOriginal.rag_top_diagnosis : null;
    const ragBlock = ragContext
        ? `\n\n━━━ RETRIEVED CLINICAL EVIDENCE ━━━\n` +
          `The VetIOS network has retrieved ${ragCaseCount} similar historical cases.\n` +
          (ragTopDiagnosis ? `Most frequent confirmed diagnosis in similar cases: ${ragTopDiagnosis}\n` : '') +
          `Evidence summary: ${ragContext}\n` +
          `INSTRUCTION: When relevant, cite this evidence in your clinical reasoning using phrases like ` +
          `"In similar network cases..." or "Historical VetIOS data shows...". ` +
          `This is real clinical data from the VetIOS network, not hypothetical examples.\n` +
          `━━━ END RETRIEVED EVIDENCE ━━━`
        : '';
    const enrichedSystemPrompt = ragBlock ? systemPrompt + ragBlock : systemPrompt;
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
        enrichedSystemPrompt,
        userMessageContent,
        options?.signal,
    );

    let hfRequest: Promise<any> | null = null;
    if (isHfEnabled()) {
        const hfBaseUrl = getHfProviderBaseUrl();
        const hfApiKey = getHfProviderApiKey();
        const hfModel = getHfProviderModel();
        if (hfBaseUrl && hfApiKey) {
            hfRequest = performApiRequest(hfBaseUrl, hfApiKey, hfModel, enrichedSystemPrompt, userMessageContent, options?.signal);
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

async function performApiRequest(
    baseUrl: string,
    apiKey: string,
    model: string,
    systemPrompt: string,
    userContent: any[],
    signal?: AbortSignal,
): Promise<any> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        signal,
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
