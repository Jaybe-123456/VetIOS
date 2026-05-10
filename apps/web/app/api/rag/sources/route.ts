import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { safeJson } from '@/lib/http/safeJson';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { listRagSources } from '@/lib/agenticRag/service';
import {
    normalizeAuthorityTier,
    normalizeRagSourceType,
    normalizeStringList,
    validatePublicSourceUrl,
} from '@/lib/agenticRag/sourcePolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SourceSchema = z.object({
    external_key: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().min(1).max(240),
    source_type: z.string().trim().min(1).max(80).default('other'),
    authority_tier: z.string().trim().min(1).max(80).default('unverified'),
    species_scope: z.array(z.string().trim().min(1).max(80)).max(24).default([]),
    medicine_domain: z.array(z.string().trim().min(1).max(80)).max(24).default([]),
    url: z.string().trim().max(500).optional().nullable(),
    license: z.string().trim().max(240).optional().nullable(),
    attribution: z.string().trim().max(500).optional().nullable(),
    ingestion_policy: z.record(z.string(), z.unknown()).default({}),
    refresh_policy: z.record(z.string(), z.unknown()).default({}),
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

    const sources = await listRagSources(supabase, auth.actor.tenantId);
    return withHeaders(NextResponse.json({ sources, request_id: requestId }), requestId, startTime);
}

export async function POST(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 30, windowMs: 60_000, maxBodySize: 64 * 1024, selfProtection: true });
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

    const parsed = SourceSchema.safeParse(json.data);
    if (!parsed.success) {
        return withHeaders(NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const url = validatePublicSourceUrl(parsed.data.url);
    if (!url.ok) {
        return withHeaders(NextResponse.json({ error: 'invalid_source_url', detail: url.error, request_id: requestId }, { status: 400 }), requestId, startTime);
    }

    const { data, error } = await supabase
        .from('rag_sources')
        .insert({
            tenant_id: auth.actor.tenantId,
            external_key: parsed.data.external_key ?? null,
            name: parsed.data.name,
            source_type: normalizeRagSourceType(parsed.data.source_type),
            authority_tier: normalizeAuthorityTier(parsed.data.authority_tier),
            species_scope: normalizeStringList(parsed.data.species_scope),
            medicine_domain: normalizeStringList(parsed.data.medicine_domain),
            url: url.url,
            license: parsed.data.license ?? null,
            attribution: parsed.data.attribution ?? null,
            ingestion_policy: {
                trusted_public_source: url.trusted,
                ...parsed.data.ingestion_policy,
            },
            refresh_policy: parsed.data.refresh_policy,
            status: 'active',
        })
        .select('*')
        .single();

    if (error || !data) {
        return withHeaders(NextResponse.json({ error: 'source_create_failed', detail: error?.message, request_id: requestId }, { status: 500 }), requestId, startTime);
    }

    return withHeaders(NextResponse.json({ source: data, request_id: requestId }, { status: 201 }), requestId, startTime);
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
