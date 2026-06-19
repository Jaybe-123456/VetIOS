import { NextResponse } from 'next/server';
import { AiProviderUnavailableError, runInference } from '@/lib/ai/provider';
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
import { parseAskVetIOSQuery } from '@vetios/ask-vetios';
import { getSupabaseServer, resolveSessionTenant } from '@/lib/supabaseServer';
import { answerRagQuery, type AnswerRagQueryInput } from '@/lib/agenticRag/service';
import { buildHeuristicResponse as buildAskVetiosHeuristicResponse, type AskVetiosHeuristicResponse } from '@/lib/askVetios/heuristicResponse';
import { buildAskVetiosIntake } from '@/lib/askVetios/intake';
import { buildAskVetiosCaseGraphSnapshot } from '@/lib/askVetios/caseGraph';
import { buildAskVetiosModelTrustSnapshot } from '@/lib/askVetios/modelTrust';
import { buildAskVetiosVeterinaryRetrievalSnapshot } from '@/lib/askVetios/veterinaryRetrieval';
import { buildAskVetiosWorkflowIntegrationSnapshot } from '@/lib/askVetios/workflowIntegration';
import {
    addAskVetiosBudgetHeaders,
    enforceAskVetiosTokenBudget,
} from '@/lib/askVetios/usageBudget';
import { recordProductUsageEvent } from '@/lib/billing/entitlements';

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
    const session = await resolveSessionTenant();

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
    const intake = buildAskVetiosIntake({ message, conversation });
    const tokenBudget = enforceAskVetiosTokenBudget({
        req,
        kind: 'chat',
        message,
        conversation,
    });
    if (!tokenBudget.allowed) {
        writeAuditLog({
            ...auditCtx,
            request_id: requestId,
            tenant_id: null,
            status_code: 429,
            latency_ms: Date.now() - startTime,
            blocked: true,
            block_reason: 'ask_vetios_token_budget_exceeded',
            metadata: {
                token_limit: tokenBudget.limit,
                token_remaining: tokenBudget.remaining,
                token_request: tokenBudget.requestedTokens,
                reset_at: new Date(tokenBudget.resetAt).toISOString(),
            },
            timestamp: new Date().toISOString(),
        });
        const res = NextResponse.json({
            error: 'token_budget_exceeded',
            message: `Ask Vetios token budget reached. Retry after ${Math.ceil(tokenBudget.retryAfterSeconds / 60)} minute(s), shorten the conversation, or start a new paid plan session.`,
            retry_after_seconds: tokenBudget.retryAfterSeconds,
            token_limit: tokenBudget.limit,
            token_remaining: tokenBudget.remaining,
            token_request: tokenBudget.requestedTokens,
            request_id: requestId,
        }, { status: 429 });
        addAskVetiosBudgetHeaders(res.headers, tokenBudget);
        return withAskVetiosHeaders(res, requestId, startTime);
    }

    // ── Heuristic fallback (dev / test) ──
    if (shouldUseAiHeuristicFallback()) {
        const agenticRagResult = await resolveAskVetiosAgenticRag(message, 1_100);
        const heuristicBody = withAskVetiosIntake(
            attachAgenticRagToHeuristicResponse(
                buildAskVetiosHeuristicResponse(message),
                agenticRagResult,
            ),
            intake,
        );
        const queryHistoryId = await logAskVetiosQuery(message, heuristicBody as unknown as Record<string, unknown>, startTime).catch(() => null);
        const fp = generateFingerprint({ tenantId: 'vetios-platform', requestId, endpoint: auditCtx.endpoint, issuedAt: startTime });
        writeAuditLog({ ...auditCtx, request_id: requestId, status_code: 200, latency_ms: Date.now() - startTime, fingerprint: fp, mode: heuristicBody.mode, metadata: { heuristic: true }, timestamp: new Date().toISOString() });
        const res = NextResponse.json(attachResponseFingerprint({ ...heuristicBody, query_history_id: queryHistoryId } as Record<string, unknown>, fp), { status: 200 });
        res.headers.set('x-vetios-fingerprint', fp);
        addAskVetiosBudgetHeaders(res.headers, tokenBudget);
        await recordAskVetiosUsage(session, requestId, heuristicBody.mode, true);
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
        const agenticRagResult = await resolveAskVetiosAgenticRag(message, 1_100);
        const agenticRagContextBlock = agenticRagResult?.citations.length
            ? formatAgenticRagPromptBlock(agenticRagResult)
            : '';
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
                ...(agenticRagContextBlock ? {
                    agentic_rag_context: agenticRagContextBlock,
                } : {}),
            }
        }, {
            signal: AbortSignal.timeout(ASK_VETIOS_INFERENCE_TIMEOUT_MS),
        });

        const output = inferenceResult.output_payload;
        if (output.parse_error) {
            throw new Error(`AI generated invalid JSON: ${inferenceResult.raw_content}`);
        }
        const response = withAskVetiosIntake(
            buildEnsembleResponse(output, inferenceResult.ensemble_metadata, agenticRagResult),
            intake,
        );
        const queryHistoryId = await logAskVetiosQuery(message, response, startTime).catch(() => null);
        const responseWithHistory = queryHistoryId ? { ...response, query_history_id: queryHistoryId } : response;
        const res = NextResponse.json(responseWithHistory, { status: 200 });
        addAskVetiosBudgetHeaders(res.headers, tokenBudget);
        withAskVetiosHeaders(res, requestId, startTime);

        // ── Passive population signal ingestion (fire-and-forget) ──
        const diagnosisRanked = Array.isArray(responseWithHistory.metadata?.diagnosis_ranked)
            ? responseWithHistory.metadata.diagnosis_ranked as Array<{ name?: unknown; confidence?: unknown }>
            : [];
        if (responseWithHistory.mode === 'clinical' && typeof diagnosisRanked[0]?.name === 'string') {
            const topDiagnosis = diagnosisRanked[0].name;
            const topConfidence = typeof diagnosisRanked[0].confidence === 'number' ? diagnosisRanked[0].confidence : 0.5;
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

        await recordAskVetiosUsage(session, requestId, responseWithHistory.mode, false);
        return res;

    } catch (error) {
        if (error instanceof AiProviderUnavailableError) {
            writeAuditLog({ ...auditCtx, request_id: requestId, status_code: 503, latency_ms: Date.now() - startTime, metadata: { error_code: error.errorCode }, timestamp: new Date().toISOString() });
            const res = NextResponse.json({
                error: 'inference_unavailable',
                error_code: error.errorCode,
                request_id: requestId,
            }, { status: 503 });
            res.headers.set('Retry-After', '5');
            addAskVetiosBudgetHeaders(res.headers, tokenBudget);
            return withAskVetiosHeaders(res, requestId, startTime);
        }

        // Surface fallback on AI failure — still better than a 500
        const fallback = withAskVetiosIntake(buildAskVetiosHeuristicResponse(message), intake);
        const queryHistoryId = await logAskVetiosQuery(message, fallback as unknown as Record<string, unknown>, startTime).catch(() => null);
        writeAuditLog({ ...auditCtx, request_id: requestId, status_code: 200, latency_ms: Date.now() - startTime, metadata: { fallback: true, error: error instanceof Error ? error.message : 'Unknown' }, timestamp: new Date().toISOString() });
        const res = NextResponse.json({ ...fallback, query_history_id: queryHistoryId, _fallback: true }, { status: 200 });
        addAskVetiosBudgetHeaders(res.headers, tokenBudget);
        await recordAskVetiosUsage(session, requestId, fallback.mode, true);
        return withAskVetiosHeaders(res, requestId, startTime);
    }
}

async function recordAskVetiosUsage(
    session: Awaited<ReturnType<typeof resolveSessionTenant>>,
    requestId: string,
    mode: unknown,
    fallback: boolean,
) {
    if (!session) return;

    await recordProductUsageEvent({
        tenantId: session.tenantId,
        userId: session.userId,
        eventType: 'ask_vetios',
        source: 'ask_vetios',
        requestId,
        metadata: {
            mode: typeof mode === 'string' ? mode : null,
            fallback,
        },
    });
}

function withAskVetiosHeaders(res: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(res.headers, requestId, startTime);
    res.headers.set('Cache-Control', REALTIME_CACHE_CONTROL);
    return res;
}

// ── Response normaliser ────────────────────────────────────────────────────

async function resolveAskVetiosAgenticRag(
    message: string,
    timeoutMs: number,
): Promise<Awaited<ReturnType<typeof answerRagQuery>> | null> {
    try {
        return await Promise.race([
            answerRagQuery({
                tenantId: process.env.VETIOS_PUBLIC_RAG_TENANT_ID || 'public',
                actorKind: 'ask_vetios',
                client: getSupabaseServer(),
                question: message,
                limit: 4,
            } satisfies AnswerRagQueryInput),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AGENTIC_RAG_TIMEOUT')), timeoutMs),
            ),
        ]);
    } catch {
        return null;
    }
}

function attachAgenticRagToHeuristicResponse(
    response: AskVetiosHeuristicResponse,
    agenticRagResult: Awaited<ReturnType<typeof answerRagQuery>> | null,
): AskVetiosHeuristicResponse {
    return {
        ...response,
        metadata: buildAskVetiosMetadata(response.metadata as Record<string, unknown> | null, agenticRagResult),
    };
}

type AskVetiosResponseBody = {
    mode: string;
    topic?: string;
    content: string;
    metadata?: unknown;
};

function withAskVetiosIntake<T extends AskVetiosResponseBody>(
    response: T,
    intake: ReturnType<typeof buildAskVetiosIntake>,
): T {
    const currentMetadata = asRecord(response.metadata);
    const redFlags = mergeStrings(readStringArray(currentMetadata.red_flags), intake.case_draft.red_flags);
    const clinicalSigns = mergeStrings(readStringArray(currentMetadata.clinical_signs), intake.case_draft.clinical_signs);
    const nextMetadata: Record<string, unknown> = {
        ...currentMetadata,
        case_draft: intake.case_draft,
        intake_status: intake.status,
        intake_readiness_score: intake.readiness_score,
        missing_fields: intake.missing_fields,
        follow_up_questions: intake.follow_up_questions,
        safety_notice: intake.safety_notice,
        case_handoff: intake.case_handoff,
    };

    if (clinicalSigns.length > 0) {
        nextMetadata.clinical_signs = clinicalSigns;
    }

    if (redFlags.length > 0) {
        nextMetadata.red_flags = redFlags;
        if (!nextMetadata.urgency_level || nextMetadata.urgency_level === 'low') {
            nextMetadata.urgency_level = 'emergency';
        }
    }
    const caseGraphSnapshot = buildAskVetiosCaseGraphSnapshot({
        intake,
        responseMetadata: nextMetadata,
    });
    nextMetadata.case_graph_snapshot = caseGraphSnapshot;
    nextMetadata.case_graph_status = caseGraphSnapshot.status;
    const veterinaryRetrievalSnapshot = buildAskVetiosVeterinaryRetrievalSnapshot({
        mode: response.mode,
        metadata: nextMetadata,
        intake,
    });
    nextMetadata.veterinary_retrieval_snapshot = veterinaryRetrievalSnapshot;
    nextMetadata.veterinary_retrieval_status = veterinaryRetrievalSnapshot.status;
    const modelTrustSnapshot = buildAskVetiosModelTrustSnapshot({
        mode: response.mode,
        metadata: nextMetadata,
        intake,
        caseGraphSnapshot,
    });
    nextMetadata.model_trust_snapshot = modelTrustSnapshot;
    nextMetadata.model_trust_status = modelTrustSnapshot.status;
    const workflowIntegrationSnapshot = buildAskVetiosWorkflowIntegrationSnapshot({
        mode: response.mode,
        metadata: nextMetadata,
        intake,
        caseGraphSnapshot,
    });
    nextMetadata.workflow_integration_snapshot = workflowIntegrationSnapshot;
    nextMetadata.workflow_integration_status = workflowIntegrationSnapshot.status;

    return {
        ...response,
        metadata: nextMetadata,
    } as T;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function mergeStrings(...groups: string[][]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    groups.flat().forEach((item) => {
        const normalized = item.trim();
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) return;
        seen.add(key);
        merged.push(normalized);
    });
    return merged;
}

function buildEnsembleResponse(
    data: Record<string, unknown>,
    _ensembleMetadata: unknown,
    agenticRagResult?: Awaited<ReturnType<typeof answerRagQuery>> | null,
) {
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
                metadata: buildAskVetiosMetadata(null, agenticRagResult),
            };
        }

        // Genuine operational query — return general mode
        return {
            mode: 'general',
            content: 'I can help you navigate VetIOS or answer any veterinary question. What would you like to know?',
            metadata: buildAskVetiosMetadata(null, agenticRagResult),
        };
    }

    if (mode === 'clinical') {
        const diagnosis = (data.diagnosis as Record<string, unknown>) || data;
        return {
            mode: 'clinical',
            content: (data.summary as string) || (diagnosis.analysis as string) || 'Clinical assessment complete.',
            metadata: buildAskVetiosMetadata({
                diagnosis_ranked: (data.diagnosis_ranked as Array<{name: string; confidence: number; reasoning: string}>) ||
                    (diagnosis.top_differentials as Array<{name: string; confidence: number; reasoning: string}>) || [],
                urgency_level: (data.urgency_level as string) || 'low',
                recommended_tests: (data.recommended_tests as string[]) || [],
                red_flags: (data.red_flags as string[]) || [],
                explanation: (data.explanation as string) || '',
            }, agenticRagResult),
        };
    }

    return {
        mode: 'general',
        content: (data.answer as string) || (data.content as string) || 'How can I assist you today?',
        metadata: buildAskVetiosMetadata(null, agenticRagResult),
    };
}

function buildAskVetiosMetadata(
    base: Record<string, unknown> | null,
    agenticRagResult?: Awaited<ReturnType<typeof answerRagQuery>> | null,
) {
    if (!agenticRagResult) {
        return base;
    }
    return {
        ...(base ?? {}),
        rag_citations: agenticRagResult.citations,
        rag_retrieval_stats: agenticRagResult.retrieval_stats,
        rag_plan: agenticRagResult.plan,
        rag_grounded: agenticRagResult.evaluation.grounded,
        rag_evaluation_warnings: agenticRagResult.evaluation.warnings,
        rag_query_id: agenticRagResult.query_id,
    };
}

function formatAgenticRagPromptBlock(result: Awaited<ReturnType<typeof answerRagQuery>>): string {
    const lines = [
        '=== VetIOS AGENTIC DOCUMENT RAG CONTEXT ===',
        'Use only these cited passages for document-grounded claims. Do not invent citations.',
    ];
    for (const citation of result.citations.slice(0, 4)) {
        lines.push(`[${citation.index}] ${citation.title} // ${citation.source_name} // ${citation.authority_tier}`);
        lines.push(citation.quote);
    }
    lines.push('=== END AGENTIC DOCUMENT RAG CONTEXT ===');
    return lines.join('\n');
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

async function logAskVetiosQuery(
    message: string,
    response: Record<string, unknown>,
    startTime: number,
): Promise<string | null> {
    if (process.env.VETIOS_ASK_QUERY_HISTORY_ENABLED === 'false') return null;
    try {
        const parsed = parseAskVetIOSQuery(message);
        const responseSections = inferResponseSections(response, parsed.query_type);
        const caseGraphSnapshot = readCaseGraphSnapshot(response);
        const row: Record<string, unknown> = {
            tenant_id: null,
            query_text: message,
            parsed_query: parsed,
            species: parsed.species === 'unknown' ? null : parsed.species,
            condition: parsed.condition,
            query_type: parsed.query_type,
            response_sections: responseSections,
            images_resolved: 0,
            papers_returned: 0,
            response_latency_ms: Date.now() - startTime,
        };
        if (caseGraphSnapshot) {
            row.case_graph_snapshot = caseGraphSnapshot;
            row.case_graph_status = readString(caseGraphSnapshot.status) ?? 'draft';
        }
        const modelTrustSnapshot = readModelTrustSnapshot(response);
        if (modelTrustSnapshot) {
            row.model_trust_snapshot = modelTrustSnapshot;
            row.model_trust_status = readString(modelTrustSnapshot.status) ?? 'needs_review';
        }
        const veterinaryRetrievalSnapshot = readVeterinaryRetrievalSnapshot(response);
        if (veterinaryRetrievalSnapshot) {
            row.veterinary_retrieval_snapshot = veterinaryRetrievalSnapshot;
            row.veterinary_retrieval_status = readString(veterinaryRetrievalSnapshot.status) ?? 'ungrounded';
        }
        const workflowIntegrationSnapshot = readWorkflowIntegrationSnapshot(response);
        if (workflowIntegrationSnapshot) {
            row.workflow_integration_snapshot = workflowIntegrationSnapshot;
            row.workflow_integration_status = readString(workflowIntegrationSnapshot.status) ?? 'needs_intake';
        }

        const client = getSupabaseServer();
        let { data, error } = await client
            .from('ask_vetios_queries')
            .insert(row)
            .select('id')
            .single();
        if (error && isMissingAskVetiosMoatColumns(error)) {
            delete row.case_graph_snapshot;
            delete row.case_graph_status;
            delete row.model_trust_snapshot;
            delete row.model_trust_status;
            delete row.veterinary_retrieval_snapshot;
            delete row.veterinary_retrieval_status;
            delete row.workflow_integration_snapshot;
            delete row.workflow_integration_status;
            const retry = await client
                .from('ask_vetios_queries')
                .insert(row)
                .select('id')
                .single();
            data = retry.data;
            error = retry.error;
        }
        if (error || !data?.id) return null;
        return String(data.id);
    } catch {
        return null;
    }
}

function inferResponseSections(response: Record<string, unknown>, queryType: string) {
    const sections = new Set<string>();
    if (queryType === 'disease_overview' || response.mode === 'educational') sections.add('disease_overview');
    if (queryType === 'clinical_images') sections.add('clinical_images');
    if (queryType === 'drug_dose') sections.add('drug_panel');
    if (queryType === 'research') sections.add('research_sources');
    if (response.mode === 'clinical') sections.add('diagnosis_support');
    return Array.from(sections);
}

function readCaseGraphSnapshot(response: Record<string, unknown>): Record<string, unknown> | null {
    const metadata = asRecord(response.metadata);
    const snapshot = asRecord(metadata.case_graph_snapshot);
    return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function readModelTrustSnapshot(response: Record<string, unknown>): Record<string, unknown> | null {
    const metadata = asRecord(response.metadata);
    const snapshot = asRecord(metadata.model_trust_snapshot);
    return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function readVeterinaryRetrievalSnapshot(response: Record<string, unknown>): Record<string, unknown> | null {
    const metadata = asRecord(response.metadata);
    const snapshot = asRecord(metadata.veterinary_retrieval_snapshot);
    return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function readWorkflowIntegrationSnapshot(response: Record<string, unknown>): Record<string, unknown> | null {
    const metadata = asRecord(response.metadata);
    const snapshot = asRecord(metadata.workflow_integration_snapshot);
    return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function isMissingAskVetiosMoatColumns(error: { code?: string; message?: string }): boolean {
    const message = error.message?.toLowerCase() ?? '';
    return error.code === '42703'
        || error.code === 'PGRST204'
        || message.includes('case_graph_snapshot')
        || message.includes('case_graph_status')
        || message.includes('model_trust_snapshot')
        || message.includes('model_trust_status')
        || message.includes('veterinary_retrieval_snapshot')
        || message.includes('veterinary_retrieval_status')
        || message.includes('workflow_integration_snapshot')
        || message.includes('workflow_integration_status')
        || message.includes('schema cache');
}
