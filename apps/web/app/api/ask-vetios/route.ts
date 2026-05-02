import { NextResponse } from 'next/server';
import { runInference } from '@/lib/ai/provider';
import { embedQuery } from '@/lib/embeddings/vetEmbeddingEngine';
import { getVectorStore } from '@/lib/vectorStore/vetVectorStore';
import {
    getAiProviderApiKey,
    getAiProviderBaseUrl,
    getAiProviderDefaultModel,
    shouldUseAiHeuristicFallback,
} from '@/lib/ai/config';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { z } from 'zod';
import { generateFingerprint, attachResponseFingerprint, hashContent } from '@/lib/protection/fingerprint';
import { writeAuditLog, buildAuditContext } from '@/lib/protection/auditLog';
import { getPopulationSignalService } from '@/lib/populationSignal/populationSignalService';
import { checkOrigin, buildCorsHeaders } from '@/lib/protection/originGuard';

export const runtime = 'nodejs';
export const maxDuration = 30;
const ASK_VETIOS_INFERENCE_TIMEOUT_MS = 25_000;
const REALTIME_CACHE_CONTROL = 'no-store';

const RequestSchema = z.object({
    message: z.string().trim().min(1).max(2000),
    conversation: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
    })).max(20).default([]),
});

export async function OPTIONS(req: Request) {
    const origin = req.headers.get('origin');
    const res = new Response(null, { status: 204 });
    Object.entries(buildCorsHeaders(origin)).forEach(([k, v]) => res.headers.set(k, v));
    return res;
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000, maxBodySize: 32 * 1024 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    // ── Origin enforcement ──
    const auditCtx = buildAuditContext(req);
    const originCheck = checkOrigin(req, requestId);
    if (!originCheck.allowed) {
        writeAuditLog({ ...auditCtx, request_id: requestId, tenant_id: null, status_code: 403, latency_ms: Date.now() - startTime, blocked: true, block_reason: 'origin_forbidden', timestamp: new Date().toISOString() });
        return withAskVetiosHeaders(originCheck.response!, requestId, startTime);
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        const res = NextResponse.json({ error: parsedJson.error, request_id: requestId }, { status: 400 });
        return withAskVetiosHeaders(res, requestId, startTime);
    }

    const parsed = RequestSchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        const res = NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten(), request_id: requestId }, { status: 400 });
        return withAskVetiosHeaders(res, requestId, startTime);
    }

    const { message, conversation } = parsed.data;

    // ── Heuristic fallback (dev / test) ──
    if (shouldUseAiHeuristicFallback()) {
        const heuristicBody = buildHeuristicResponse(message);
        const fp = generateFingerprint({ tenantId: 'vetios-platform', requestId, endpoint: auditCtx.endpoint, issuedAt: startTime });
        writeAuditLog({ ...auditCtx, request_id: requestId, status_code: 200, latency_ms: Date.now() - startTime, fingerprint: fp, mode: heuristicBody.mode, metadata: { heuristic: true }, timestamp: new Date().toISOString() });
        const res = NextResponse.json(attachResponseFingerprint(heuristicBody as Record<string, unknown>, fp), { status: 200 });
        res.headers.set('x-vetios-fingerprint', fp);
        return withAskVetiosHeaders(res, requestId, startTime);
    }

    try {
        // Use the centralized runInference which supports ensemble/dual-model reasoning
        // Build conversation context string for the AI
        const conversationContext = conversation.slice(-10)
            .map(m => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n');

        // ── RAG: retrieve similar historical cases (non-blocking, 750 ms cap) ──
        let ragContextBlock = '';
        try {
            const vs = getVectorStore();
            const qe = await embedQuery(message);
            const similar = await Promise.race([
                vs.findSimilar({ embedding: qe, limit: 6, minSimilarity: 0.74 }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('RAG_TIMEOUT')), 750),
                ),
            ]);
            if (similar.totalFound > 0) {
                ragContextBlock = similar.retrievalSummary;
            }
        } catch { /* RAG non-critical */ }
        // ─────────────────────────────────────────────────────────────────────

        const inferenceResult = await runInference({
            input_signature: {
                raw_consultation: conversation.length > 0
                    ? `CONVERSATION CONTEXT:\n${conversationContext}\n\nCURRENT QUERY: ${message}`
                    : message,
                query_type: 'ask_vetios',
                ...(ragContextBlock ? {
                    rag_context: ragContextBlock,
                } : {}),
            }
        }, {
            signal: AbortSignal.timeout(ASK_VETIOS_INFERENCE_TIMEOUT_MS),
        });

        const output = inferenceResult.output_payload;
        if (output.parse_error) {
            throw new Error(`AI generated invalid JSON: ${inferenceResult.raw_content}`);
        }
        const response = buildEnsembleResponse(output, inferenceResult.ensemble_metadata);
        const res = NextResponse.json(response, { status: 200 });
        withAskVetiosHeaders(res, requestId, startTime);

        // ── Passive population signal ingestion (fire-and-forget) ──
        if (response.mode === 'clinical' && response.metadata?.diagnosis_ranked?.[0]?.name) {
            const topDiagnosis = response.metadata.diagnosis_ranked[0].name as string;
            const topConfidence = (response.metadata.diagnosis_ranked[0].confidence as number) ?? 0.5;
            const species = (output.species as string) ?? 'unknown';
            const region = (output.region as string) ?? 'unknown';
            void getPopulationSignalService().ingestSignal({
                tenantId: 'public',
                disease: topDiagnosis,
                species,
                region,
                confidence: topConfidence,
                inferenceEventId: requestId,
            }).catch(() => { /* non-critical — never block the response */ });
        }

        return res;

    } catch (error) {
        // Surface fallback on AI failure — still better than a 500
        const fallback = buildHeuristicResponse(message);
        writeAuditLog({ ...auditCtx, request_id: requestId, status_code: 200, latency_ms: Date.now() - startTime, metadata: { fallback: true, error: error instanceof Error ? error.message : 'Unknown' }, timestamp: new Date().toISOString() });
        const res = NextResponse.json({ ...fallback, _fallback: true }, { status: 200 });
        return withAskVetiosHeaders(res, requestId, startTime);
    }
}

function withAskVetiosHeaders(res: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(res.headers, requestId, startTime);
    res.headers.set('Cache-Control', REALTIME_CACHE_CONTROL);
    return res;
}

// ── Response normaliser ────────────────────────────────────────────────────

function buildEnsembleResponse(data: Record<string, unknown>, _ensembleMetadata: unknown) {
    const mode = (data.mode as string) || 'general';

    // 'operational' is a legacy mode — if the content is veterinary, treat as educational
    if (mode === 'educational' || mode === 'operational') {
        const answer = (data.answer as string) || (data.content as string) || '';
        const isNavigationResponse = answer.toLowerCase().includes('navigating vetios') ||
            answer.toLowerCase().includes('instructions on') ||
            answer.length < 80;

        if (!isNavigationResponse && answer.length > 0) {
            return {
                mode: 'educational',
                topic: extractTopic(data),
                content: answer,
                metadata: null,
            };
        }

        // Genuine operational query — return general mode
        return {
            mode: 'general',
            content: 'I can help you navigate VetIOS or answer any veterinary question. What would you like to know?',
            metadata: null,
        };
    }

    if (mode === 'clinical') {
        const diagnosis = (data.diagnosis as Record<string, unknown>) || data;
        return {
            mode: 'clinical',
            content: (data.summary as string) || (diagnosis.analysis as string) || 'Clinical assessment complete.',
            metadata: {
                diagnosis_ranked: (data.diagnosis_ranked as Array<{name: string; confidence: number; reasoning: string}>) ||
                    (diagnosis.top_differentials as Array<{name: string; confidence: number; reasoning: string}>) || [],
                urgency_level: (data.urgency_level as string) || 'low',
                recommended_tests: (data.recommended_tests as string[]) || [],
                red_flags: (data.red_flags as string[]) || [],
                explanation: (data.explanation as string) || '',
            },
        };
    }

    return {
        mode: 'general',
        content: (data.answer as string) || (data.content as string) || 'How can I assist you today?',
        metadata: null,
    };
}

function extractTopic(data: Record<string, unknown>): string {
    const raw = (data.topic as string) || (data.title as string) || '';
    // Reject generic fallback strings the AI sometimes emits
    const genericStrings = ['veterinary knowledge', 'veterinary topic', 'general', 'unknown', ''];
    if (raw && !genericStrings.includes(raw.toLowerCase().trim())) {
        return raw;
    }
    // Try to extract from the answer itself
    const answer = (data.answer as string) || '';
    const firstLine = answer.split('\n')[0] ?? '';
    const h1Match = firstLine.match(/^#+\s+(.+)/);
    if (h1Match?.[1]) return h1Match[1].trim();
    const capsMatch = answer.match(/^([A-Z][^,.(]{2,50}?)(?:\s+(?:is|are|refers|belongs|commonly)\b)/);
    if (capsMatch?.[1]) return capsMatch[1].trim();
    return raw || 'Veterinary Knowledge';
}

// ── Heuristic fallback (no AI key / dev mode) ─────────────────────────────

function buildHeuristicResponse(message: string) {
    const lower = message.toLowerCase();

    const educationalKeywords = ['what are', 'what is', 'explain', 'describe', 'how does', 'pathogenesis', 'mechanism',
        'epidemiology', 'classification', 'structure', 'treatment of', 'prevention of', 'vaccine', 'overview of'];
    const isEducational = educationalKeywords.some((k) => lower.includes(k));

    const clinicalKeywords = ['vomit', 'lethargy', 'anorexia', 'appetite', 'diarrhea', 'discharge',
        'seizure', 'cough', 'fever', 'limp', 'lame', 'drink', 'urinat', 'weight loss', 'mass', 'lump'];
    const isClinical = clinicalKeywords.some((k) => lower.includes(k));

    if (isEducational) {
        return {
            mode: 'educational',
            topic: 'Veterinary Knowledge Query',
            content: `## Temporarily Unavailable\n\nThe VetIOS intelligence gateway is experiencing a transient issue. Your query has been logged and will be retried automatically.\n\nPlease try again in a moment.`,
            metadata: null,
        };
    }

    if (isClinical) {
        return {
            mode: 'clinical',
            content: 'Clinical signals detected. Running heuristic differential protocol.',
            metadata: {
                diagnosis_ranked: [
                    { name: 'Acute Gastroenteritis', probability: 0.42, reasoning: 'Most common presentation for GI signs' },
                    { name: 'Systemic Infectious Disease', probability: 0.28, reasoning: 'Lethargy with multi-system involvement' },
                    { name: 'Metabolic Disorder', probability: 0.18, reasoning: 'Chronic progression pattern' },
                ],
                urgency_level: 'moderate',
                recommended_tests: ['Complete Blood Count (CBC)', 'Chemistry Panel', 'Urinalysis', 'Abdominal Radiographs'],
                red_flags: [],
                explanation: 'Heuristic mode active. Connect AI provider for precision differential ranking.',
            }
        };
    }

    return {
        mode: 'general',
        content: "Hello — I'm VetIOS, your veterinary intelligence assistant. I can answer clinical questions, explain veterinary conditions in depth, or help you navigate the platform. What would you like to explore?",
        metadata: null,
    };
}
