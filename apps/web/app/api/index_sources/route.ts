import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ingestIndexSourceDataset } from '@/lib/agenticRag/sourceBundle';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DocumentSchema = z.object({
    title: z.string().trim().min(1).max(300),
    text: z.string().max(1_200_000).optional(),
    content_text: z.string().max(1_200_000).optional(),
    url: z.string().trim().max(500).optional().nullable(),
    species: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
    domain: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
    authority: z.string().trim().max(80).optional(),
    source_type: z.string().trim().max(80).optional(),
    document_type: z.string().trim().max(80).optional(),
    language: z.string().trim().min(2).max(12).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    fetch_url: z.boolean().optional(),
}).refine((value) => value.text || value.content_text || (value.fetch_url && value.url), {
    message: 'Each document requires text/content_text, or fetch_url with a public HTTPS url.',
});

const SourceBundleSchema = z.object({
    source_name: z.string().trim().min(1).max(240),
    source_type: z.string().trim().max(80).optional(),
    authority: z.string().trim().max(80).optional(),
    species_scope: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
    domain_scope: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
    url: z.string().trim().max(500).optional().nullable(),
    license: z.string().trim().max(240).optional().nullable(),
    attribution: z.string().trim().max(500).optional().nullable(),
    documents: z.array(DocumentSchema).min(1).max(200),
});

const DatasetSchema = z.object({
    dataset_name: z.string().trim().min(1).max(160).optional(),
    sources: z.array(SourceBundleSchema).min(1).max(25),
}).refine((value) => value.sources.reduce((sum, source) => sum + source.documents.length, 0) <= 500, {
    message: 'A single dataset run can index at most 500 documents.',
});

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 3, windowMs: 60_000, maxBodySize: 50 * 1024 * 1024, selfProtection: true });
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

    const parsed = DatasetSchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const result = await ingestIndexSourceDataset({
        client: supabase,
        tenantId: auth.actor.tenantId,
        actorLabel: auth.actor.principalLabel ?? auth.actor.userId ?? auth.actor.authMode,
        dataset: parsed.data,
    });

    return withHeaders(NextResponse.json({
        ...result,
        request_id: requestId,
    }, { status: result.errors.length > 0 ? 207 : 201 }), requestId, startTime);
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
