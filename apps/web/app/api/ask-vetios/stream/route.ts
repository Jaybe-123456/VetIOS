import { POST as runAskVetios } from '../route';
import { apiGuard } from '@/lib/http/apiGuard';
import { buildHeuristicResponse } from '@/lib/askVetios/heuristicResponse';
import {
    buildAskVetiosSpeculativeDraft,
    shouldEmitAskVetiosSpeculativeDraft,
} from '@/lib/askVetios/speculativeDraft';

export const runtime = 'nodejs';
export const maxDuration = 30;

type AskVetiosStreamPayload = {
    mode?: string;
    content?: string;
    topic?: string;
    metadata?: unknown;
    query_history_id?: string | null;
    error?: string;
    message?: string;
    request_id?: string;
};

const encoder = new TextEncoder();

export async function POST(req: Request) {
    const guardRequest = req.clone();
    const draftRequest = req.clone();
    const finalRequest = req.clone();
    const guard = await apiGuard(guardRequest, { maxRequests: 30, windowMs: 60_000, maxBodySize: 32 * 1024 });
    if (guard.blocked) return guard.response!;

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            void streamAskVetiosResponse(finalRequest, draftRequest, controller);
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store, no-transform',
            'X-Accel-Buffering': 'no',
        },
    });
}

async function streamAskVetiosResponse(
    finalRequest: Request,
    draftRequest: Request,
    controller: ReadableStreamDefaultController<Uint8Array>,
) {
    const startedAt = Date.now();
    let draftEmitted = false;
    try {
        writeEvent(controller, {
            type: 'start',
            speculative_draft_enabled: shouldEmitAskVetiosSpeculativeDraft(),
        });
        draftEmitted = await tryWriteSpeculativeDraft(draftRequest, controller, startedAt);

        const response = await runAskVetios(finalRequest);
        const payload = await readPayload(response);
        const requestId = response.headers.get('x-request-id') ?? payload.request_id ?? null;
        const tokenHeaders = readTokenHeaders(response.headers);

        if (!response.ok || payload.error) {
            writeEvent(controller, {
                type: 'error',
                status: response.status,
                error: payload.error ?? 'ask_vetios_failed',
                message: payload.message ?? payload.error ?? `Ask Vetios failed with HTTP ${response.status}.`,
                request_id: requestId,
                token_budget: tokenHeaders,
            });
            return;
        }

        const content = typeof payload.content === 'string' ? payload.content : '';
        const finalMetadata = {
            ...asRecord(payload.metadata),
            speculative_status: draftEmitted ? 'final_replaced_draft' : 'final',
            speculative_draft_replaced: draftEmitted,
        };
        writeEvent(controller, {
            type: 'metadata',
            mode: payload.mode ?? 'general',
            topic: payload.topic,
            metadata: finalMetadata,
            query_history_id: payload.query_history_id ?? null,
            request_id: requestId,
            token_budget: tokenHeaders,
        });

        for (const chunk of chunkText(content)) {
            writeEvent(controller, { type: 'chunk', content: chunk });
            await sleep(8);
        }

        writeEvent(controller, {
            type: 'done',
            mode: payload.mode ?? 'general',
            topic: payload.topic,
            metadata: finalMetadata,
            query_history_id: payload.query_history_id ?? null,
            request_id: requestId,
            token_budget: tokenHeaders,
        });
    } catch (error) {
        writeEvent(controller, {
            type: 'error',
            status: 500,
            error: 'stream_failed',
            message: error instanceof Error ? error.message : 'Ask Vetios stream failed.',
        });
    } finally {
        controller.close();
    }
}

async function tryWriteSpeculativeDraft(
    req: Request,
    controller: ReadableStreamDefaultController<Uint8Array>,
    startedAt: number,
): Promise<boolean> {
    if (!shouldEmitAskVetiosSpeculativeDraft()) return false;
    const payload = await readDraftRequestPayload(req);
    if (!payload?.message) return false;

    const heuristic = buildHeuristicResponse(payload.message);
    const draft = buildAskVetiosSpeculativeDraft(heuristic, Date.now() - startedAt);
    writeEvent(controller, {
        type: 'draft',
        mode: draft.mode,
        topic: draft.topic,
        content: draft.content,
        metadata: draft.metadata,
        draft_latency_ms: draft.metadata.draft_latency_ms,
    });
    return true;
}

async function readDraftRequestPayload(req: Request): Promise<{ message: string } | null> {
    try {
        const payload = await req.json() as { message?: unknown };
        const message = typeof payload.message === 'string' ? payload.message.trim() : '';
        return message.length > 0 ? { message } : null;
    } catch {
        return null;
    }
}

async function readPayload(response: Response): Promise<AskVetiosStreamPayload> {
    try {
        return await response.json() as AskVetiosStreamPayload;
    } catch {
        return {
            error: 'invalid_stream_payload',
            message: 'Ask Vetios returned a response that could not be decoded.',
        };
    }
}

function writeEvent(controller: ReadableStreamDefaultController<Uint8Array>, value: Record<string, unknown>) {
    controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function chunkText(text: string): string[] {
    const tokens = text.match(/\S+\s*/g) ?? [];
    if (tokens.length === 0 && text.length > 0) return [text];
    const chunks: string[] = [];
    for (let index = 0; index < tokens.length; index += 10) {
        chunks.push(tokens.slice(index, index + 10).join(''));
    }
    return chunks;
}

function readTokenHeaders(headers: Headers) {
    return {
        limit: headers.get('x-vetios-token-limit'),
        remaining: headers.get('x-vetios-token-remaining'),
        reset: headers.get('x-vetios-token-reset'),
        requested: headers.get('x-vetios-token-request'),
    };
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
