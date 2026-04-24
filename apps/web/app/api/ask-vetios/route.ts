import { NextResponse } from 'next/server';
import { runInference } from '@/lib/ai/provider';
import {
    shouldUseAiHeuristicFallback,
    getAiProviderApiKey,
    getAiProviderBaseUrl,
    getAiProviderDefaultModel,
} from '@/lib/ai/config';

// ── Query intent classifier ───────────────────────────────────────────────────
type QueryIntent = 'clinical' | 'educational' | 'general';

function classifyIntent(message: string): QueryIntent {
    const lower = message.toLowerCase().trim();

    // Educational / research indicators
    const educationalPatterns = [
        /^what (is|are|causes?|does)/i,
        /^how does/i,
        /^explain/i,
        /^describe/i,
        /^tell me about/i,
        /^give me (information|details|an overview|a summary)/i,
        /^(overview|summary|definition) of/i,
        /(mechanism|pathogenesis|pathophysiology|etiology|epidemiology|transmission|classification|structure|taxonomy)/i,
        /(research|study|studies|literature|evidence)/i,
        /(vaccine|vaccination|immunology|immunity)/i,
        /(virus|bacteria|parasite|fungus|prion).*(structure|genome|protein|replication)/i,
    ];

    if (educationalPatterns.some(p => p.test(lower))) return 'educational';

    // Clinical indicators — patient-specific
    const clinicalPatterns = [
        /(my (dog|cat|patient|animal)|the (dog|cat|patient|animal))/i,
        /(presenting|presents? with|complaining of|symptoms?|signs?|history of)/i,
        /(vomiting|diarrhea|lethargy|anorexia|seizure|cough|discharge|lameness|polyuria|polydipsia)/i,
        /(lab(s|oratory)?|bloodwork|CBC|chemistry|urinalysis|radiograph|ultrasound|biopsy)/i,
        /(diagnos[ei]|differential|rule out|treatment plan|prognosis)/i,
        /\d+\s*(year|month|week|day)[\s-]?old/i,
    ];

    if (clinicalPatterns.some(p => p.test(lower))) return 'clinical';

    // Lean educational for named diseases without clinical context
    const namedDiseaseWithNoPatient = /(distemper|parvovirus|leptospirosis|brucellosis|heartworm|ehrlichia|babesia|toxoplasma|ringworm|mange|rabies|kennel cough|bordetella|pancreatitis|lymphoma|cushing|addison|diabetes)/i;
    if (namedDiseaseWithNoPatient.test(lower)) return 'educational';

    return 'general';
}

// ── Educational AI response ───────────────────────────────────────────────────
async function handleEducationalQuery(message: string): Promise<NextResponse> {
    let apiKey: string;
    try {
        apiKey = getAiProviderApiKey();
    } catch {
        // No AI key — return a structured fallback
        return NextResponse.json({
            content: "Ask VetIOS can answer research and educational questions when an AI provider is configured. Please ensure AI_PROVIDER_API_KEY or OPENAI_API_KEY is set in the environment.",
            metadata: {
                query_type: 'educational',
                diagnosis_ranked: [],
                urgency_level: 'info',
                recommended_tests: [],
                explanation: 'AI provider not configured.',
            },
        });
    }

    const baseUrl = getAiProviderBaseUrl();
    const model = getAiProviderDefaultModel();

    const systemPrompt = `You are VetIOS — the most advanced veterinary intelligence platform available. You combine the depth of a veterinary research database with the clarity of an expert clinician.

RESPONSE FORMAT RULES (follow exactly):
- Use markdown formatting: ## for major sections, ### for subsections, **bold** for key terms, *italic* for Latin names
- Start each major ## section with a relevant emoji prefix (🧬 for genetics/structure, 🌍 for epidemiology, ⚡ for pathogenesis, 🦠 for microbiology, 🩺 for clinical signs, 🔍 for diagnosis, 💊 for treatment, 🛡️ for prevention, 🧠 for neurology/CNS, 📊 for prognosis, 💡 for key takeaways)
- Use bullet points (- item) for lists
- Use nested bullets (  - subitem) for sub-points
- Use **bold** to highlight the single most important phrase per sentence
- Use 👉 prefix for critical insight callouts
- End with a ## 💡 Key Takeaways section with 3-5 bullet points
- Be thorough and research-level — this is a professional veterinary intelligence platform
- Do NOT add disclaimers or say "consult a vet" unless it's genuinely urgent
- Do NOT refuse educational questions or ask for patient data — answer from knowledge

STYLE: Like a brilliant professor who is also a clinician — precise, rich, organised, and deeply informative.`;

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message },
            ],
            temperature: 0.4,
            max_tokens: 2048,
        }),
    });

    if (!res.ok) {
        const err = await res.text().catch(() => '');
        return NextResponse.json({
            content: `AI provider error (${res.status}). Please check your API key and try again.`,
            metadata: { query_type: 'educational', diagnosis_ranked: [], urgency_level: 'info', recommended_tests: [], explanation: err },
        }, { status: 500 });
    }

    const json = await res.json() as { choices: Array<{ message: { content: string } }> };
    const answer = json.choices[0]?.message?.content ?? 'No response received.';

    return NextResponse.json({
        content: answer,
        metadata: {
            query_type: 'educational',
            diagnosis_ranked: [],
            urgency_level: 'info',
            recommended_tests: [],
            explanation: 'Educational query answered from VetIOS knowledge base.',
        },
    });
}

// ── Main route handler ────────────────────────────────────────────────────────
export async function POST(req: Request) {
    try {
        const { message } = await req.json() as { message: string };
        if (!message?.trim()) {
            return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
        }

        const intent = classifyIntent(message);

        // ── Educational / research queries → knowledge mode ───────────────────
        if (intent === 'educational' || intent === 'general') {
            return handleEducationalQuery(message);
        }

        // ── Clinical queries → diagnostic pipeline ────────────────────────────
        if (!shouldUseAiHeuristicFallback()) {
            const inferenceResult = await runInference({
                input_signature: {
                    raw_consultation: message,
                    platform_context: 'Ask VetIOS Assistant',
                },
            });

            const diagnosis = inferenceResult.output_payload.diagnosis as Record<string, unknown> | undefined;
            const riskAssessment = inferenceResult.output_payload.risk_assessment as Record<string, unknown> | undefined;
            const outputPayload = inferenceResult.output_payload as Record<string, unknown>;

            return NextResponse.json({
                content: (diagnosis?.analysis as string) || inferenceResult.raw_content,
                metadata: {
                    query_type: 'clinical',
                    diagnosis_ranked: (diagnosis?.top_differentials as unknown[]) || [],
                    urgency_level: ((riskAssessment?.emergency_level as string) ?? 'medium').toLowerCase(),
                    recommended_tests: (outputPayload.recommended_tests as unknown[]) || [],
                    explanation: (diagnosis?.ranking_shift_explanation as string) || 'Clinical analysis complete.',
                },
            });
        }

        // ── Heuristic fallback (dev/bypass mode) ─────────────────────────────
        await new Promise(resolve => setTimeout(resolve, 800));
        const lower = message.toLowerCase();

        if (lower.includes('vomit') || lower.includes('lethargy') || lower.includes('anorexia')) {
            return NextResponse.json({
                content: 'The combination of GI signs and systemic lethargy is clinically significant. Differential priority shifts toward metabolic and obstructive etiologies.',
                metadata: {
                    query_type: 'clinical',
                    diagnosis_ranked: [
                        { disease: 'Acute Gastroenteritis', probability: 0.45 },
                        { disease: 'Pancreatitis', probability: 0.35 },
                        { disease: 'Foreign Body Obstruction', probability: 0.15 },
                        { disease: 'Chronic Kidney Disease', probability: 0.05 },
                    ],
                    urgency_level: 'medium',
                    recommended_tests: ['Abdominal Radiographs', 'Spec cPL Test', 'Chemistry Panel', 'Urinalysis'],
                    explanation: 'Acute onset GI distress with lethargy requires imaging to rule out surgical emergencies.',
                },
            });
        }

        if (lower.includes('drinking') || lower.includes('urination') || lower.includes('pu/pd')) {
            return NextResponse.json({
                content: 'PU/PD suggests endocrine or renal dysfunction. Immediate evaluation of urine specific gravity is recommended.',
                metadata: {
                    query_type: 'clinical',
                    diagnosis_ranked: [
                        { disease: 'Diabetes Mellitus', probability: 0.40 },
                        { disease: 'Hyperadrenocorticism', probability: 0.30 },
                        { disease: 'Chronic Kidney Disease', probability: 0.25 },
                    ],
                    urgency_level: 'low',
                    recommended_tests: ['Blood Glucose Curve', 'ACTH Stim', 'Urinalysis (SG & Sediment)'],
                    explanation: 'Endocrine signaling disruption is highly likely.',
                },
            });
        }

        // Generic fallback for unrecognised clinical queries
        return handleEducationalQuery(message);
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to process request.', detail: error instanceof Error ? error.message : 'Unknown error.' },
            { status: 500 }
        );
    }
}
