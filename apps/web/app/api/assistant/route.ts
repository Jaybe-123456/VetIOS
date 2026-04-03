import { NextResponse } from 'next/server';
import { z } from 'zod';
import { answerAssistantQuery } from '@/lib/assistant/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { formatZodErrors } from '@/lib/http/schemas';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { resolveSessionTenant } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 30;

const AssistantRequestSchema = z.object({
    message: z.string().trim().min(1).max(1200),
    pathname: z.string().trim().min(1).max(200),
    visited_paths: z.array(z.string().trim().min(1).max(200)).max(24).default([]),
    conversation: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
    })).max(10).default([]),
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, {
        maxRequests: 20,
        windowMs: 60_000,
        maxBodySize: 64 * 1024,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const session = await resolveSessionTenant();
    if (!session) {
        const response = NextResponse.json(
            { error: 'Session expired. Sign in again to use VetIOS Guide.', request_id: requestId },
            { status: 401 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const parsedJson = await safeJson(req);
    if (!parsedJson.ok) {
        const response = NextResponse.json(
            { error: parsedJson.error, request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    const parsed = AssistantRequestSchema.safeParse(parsedJson.data);
    if (!parsed.success) {
        const response = NextResponse.json(
            { error: formatZodErrors(parsed.error), request_id: requestId },
            { status: 400 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }

    try {
        const user = (await session.supabase.auth.getUser()).data.user ?? null;
        const reply = await answerAssistantQuery({
            message: parsed.data.message,
            pathname: parsed.data.pathname,
            visitedPaths: parsed.data.visited_paths,
            conversation: parsed.data.conversation,
            tenantId: session.tenantId,
            userEmail: user?.email ?? null,
        });

        const response = NextResponse.json({
            ...reply,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    } catch (error) {
        const response = NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Unable to process assistant request.',
                request_id: requestId,
            },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        return response;
    }
}
