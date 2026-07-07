import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveClinicalApiActor } from '@/lib/auth/machineAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import { safeJson } from '@/lib/http/safeJson';
import {
    buildGlobalOntologyCompletionSnapshot,
    recordGlobalOntologyCompletionSnapshot,
} from '@/lib/inference/globalOntologyCompletionSnapshot';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CompletionSnapshotSchema = z.object({
    request_id: z.string().trim().min(1).max(160).optional(),
    observed_at: z.string().datetime().optional(),
    dry_run: z.boolean().optional().default(false),
});

export async function GET(req: Request) {
    return runCompletionSnapshot(req, { dryRunDefault: true });
}

export async function POST(req: Request) {
    return runCompletionSnapshot(req, { dryRunDefault: false });
}

async function runCompletionSnapshot(req: Request, options: { dryRunDefault: boolean }) {
    const guard = await apiGuard(req, {
        maxRequests: 20,
        windowMs: 60_000,
        maxBodySize: 64 * 1024,
        selfProtection: true,
    });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const supabase = getSupabaseServer();
    const auth = await resolveClinicalApiActor(req, {
        client: supabase,
        requiredScopes: ['rag:write'],
    });
    if (auth.error || !auth.actor) {
        return withHeaders(
            NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: auth.error?.status ?? 401 }),
            requestId,
            startTime,
        );
    }

    let payload: z.infer<typeof CompletionSnapshotSchema> = {
        dry_run: options.dryRunDefault,
    };
    if (req.method === 'POST') {
        const json = await safeJson(req);
        if (!json.ok) {
            return withHeaders(
                NextResponse.json({ error: json.error, request_id: requestId }, { status: 400 }),
                requestId,
                startTime,
            );
        }
        const parsed = CompletionSnapshotSchema.safeParse(json.data);
        if (!parsed.success) {
            return withHeaders(
                NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten(), request_id: requestId }, { status: 400 }),
                requestId,
                startTime,
            );
        }
        payload = parsed.data;
    }

    const completionRequestId = payload.request_id ?? `global_ontology_completion:${requestId}`;
    const { snapshot, query_errors } = await buildGlobalOntologyCompletionSnapshot(
        supabase as unknown as Parameters<typeof buildGlobalOntologyCompletionSnapshot>[0],
        {
            tenantId: auth.actor.tenantId,
            requestId: completionRequestId,
            observedAt: payload.observed_at ?? null,
        },
    );

    if (payload.dry_run) {
        return withHeaders(
            NextResponse.json({
                status: 'dry_run',
                request_id: requestId,
                completion_request_id: completionRequestId,
                snapshot,
                query_errors,
                writes_committed: false,
            }),
            requestId,
            startTime,
        );
    }

    const write = await recordGlobalOntologyCompletionSnapshot(
        supabase as unknown as Parameters<typeof recordGlobalOntologyCompletionSnapshot>[0],
        snapshot,
    );

    return withHeaders(
        NextResponse.json({
            status: write.error ? 'failed' : snapshot.completion_status,
            request_id: requestId,
            completion_request_id: completionRequestId,
            completion_snapshot_event_id: write.id,
            snapshot,
            query_errors,
            writes_committed: write.error === null,
            error: write.error,
        }, { status: write.error ? 500 : 201 }),
        requestId,
        startTime,
    );
}

function withHeaders(response: NextResponse, requestId: string, startTime: number): NextResponse {
    withRequestHeaders(response.headers, requestId, startTime);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
