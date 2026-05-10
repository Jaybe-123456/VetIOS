import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { ingestRagDocument, listRagDocuments } from '@/lib/agenticRag/service';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RequestSchema = z.object({
    source: z.object({
        id: z.string().uuid().optional(),
        external_key: z.string().trim().min(1).max(120).optional(),
        name: z.string().trim().min(1).max(240).optional(),
        source_type: z.string().trim().max(80).optional(),
        authority_tier: z.string().trim().max(80).optional(),
        species_scope: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
        medicine_domain: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
        url: z.string().trim().max(500).optional().nullable(),
        license: z.string().trim().max(240).optional().nullable(),
        attribution: z.string().trim().max(500).optional().nullable(),
        ingestion_policy: z.record(z.string(), z.unknown()).optional(),
        refresh_policy: z.record(z.string(), z.unknown()).optional(),
    }).refine((value) => value.id || value.name, {
        message: 'source.id or source.name is required.',
    }),
    document: z.object({
        title: z.string().trim().min(1).max(300),
        document_type: z.string().trim().min(1).max(80).default('text'),
        language: z.string().trim().min(2).max(12).default('en'),
        content_text: z.string().max(1_200_000).optional(),
        content_url: z.string().trim().max(500).optional(),
        fetch_url: z.boolean().default(false),
        metadata: z.record(z.string(), z.unknown()).default({}),
    }),
    chunking: z.object({
        maxTokens: z.number().int().min(120).max(1200).optional(),
        overlapTokens: z.number().int().min(0).max(400).optional(),
        maxChunks: z.number().int().min(1).max(200).optional(),
    }).optional(),
});

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 60, windowMs: 60_000, selfProtection: true });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['rag:read'] });
    if (auth.error || !auth.actor) {
        return withHeaders(NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }), requestId, startTime);
    }

    const documents = await listRagDocuments(supabase, auth.actor.tenantId);
    return withHeaders(NextResponse.json({ documents, request_id: requestId }), requestId, startTime);
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 12, windowMs: 60_000, maxBodySize: 2 * 1024 * 1024, selfProtection: true });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, { client: supabase, requiredScopes: ['rag:write'] });
    if (auth.error || !auth.actor) {
        return withHeaders(NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }), requestId, startTime);
    }

    const json = await safeJson(req);
    if (!json.ok) {
        return withHeaders(NextResponse.json({ error: json.error, request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const parsed = RequestSchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    try {
        const result = await ingestRagDocument({
            tenantId: auth.actor.tenantId,
            actorLabel: auth.actor.principalLabel ?? auth.actor.userId,
            client: supabase,
            source: parsed.data.source,
            document: parsed.data.document,
            chunking: parsed.data.chunking,
        });
        return withHeaders(NextResponse.json({ ...result, request_id: requestId }, { status: 201 }), requestId, startTime);
    } catch (error) {
        return withHeaders(NextResponse.json({
            error: 'rag_ingest_failed',
            detail: error instanceof Error ? error.message : 'Unknown RAG ingest failure',
            request_id: requestId,
        }, { status: 400 }), requestId, startTime);
    }
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
