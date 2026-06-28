import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    authorizeCronRequest,
    buildCronExecutionRecord,
} from '@/lib/http/cronAuth';
import { apiGuard } from '@/lib/http/apiGuard';
import { withRequestHeaders } from '@/lib/http/requestId';
import {
    buildAskVetiosAiSecurityRedTeamSuite,
    type AskVetiosAiSecurityRedTeamCase,
} from '@/lib/askVetios/aiSecurityRedTeam';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const guard = await apiGuard(req, { maxRequests: 10, windowMs: 60_000 });
    if (guard.blocked) return guard.response!;
    const { requestId, startTime } = guard;

    const cronAuth = authorizeCronRequest(req, 'ai-security-red-team');
    if (!cronAuth.authorized) {
        const res = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
        withRequestHeaders(res.headers, requestId, startTime);
        return res;
    }

    const url = new URL(req.url);
    const tenantId = normalizeUuid(url.searchParams.get('tenant_id'));
    const suiteId = normalizeText(url.searchParams.get('suite_id'));
    const generatedAt = normalizeText(url.searchParams.get('generated_at')) ?? new Date().toISOString();
    const suite = buildAskVetiosAiSecurityRedTeamSuite({
        tenantId,
        suiteId,
        generatedAt,
    });
    const client = getSupabaseServer();
    const persisted = [];

    for (const testCase of suite.cases) {
        persisted.push(await persistAiSecurityRedTeamCase(client, testCase));
    }

    const response = NextResponse.json({
        cron: {
            ...buildCronExecutionRecord('ai-security-red-team', cronAuth, requestId),
            schedule: '55 2 * * *',
            tenant_id: tenantId,
        },
        suite: {
            suite_id: suite.suite_id,
            generated_at: suite.generated_at,
            summary: suite.summary,
            privacy_contract: suite.privacy_contract,
        },
        persistence: {
            inserted: persisted.filter((entry) => entry.status === 'inserted').length,
            skipped_existing: persisted.filter((entry) => entry.status === 'skipped_existing').length,
            failed: persisted.filter((entry) => entry.status === 'failed').length,
            cases: persisted,
        },
        request_id: requestId,
    });
    withRequestHeaders(response.headers, requestId, startTime);
    return response;
}

async function persistAiSecurityRedTeamCase(
    client: SupabaseClient,
    testCase: AskVetiosAiSecurityRedTeamCase,
): Promise<{
    case_id: string;
    test_case_type: string;
    request_id: string;
    status: 'inserted' | 'skipped_existing' | 'failed';
    id: string | null;
    error: string | null;
}> {
    const { data, error } = await client
        .from('ai_security_test_events')
        .insert(testCase.draft)
        .select('id')
        .single();

    if (!error && data?.id) {
        return {
            case_id: testCase.case_id,
            test_case_type: testCase.test_case_type,
            request_id: testCase.draft.request_id,
            status: 'inserted',
            id: String(data.id),
            error: null,
        };
    }

    if (error?.code === '23505') {
        return {
            case_id: testCase.case_id,
            test_case_type: testCase.test_case_type,
            request_id: testCase.draft.request_id,
            status: 'skipped_existing',
            id: null,
            error: null,
        };
    }

    return {
        case_id: testCase.case_id,
        test_case_type: testCase.test_case_type,
        request_id: testCase.draft.request_id,
        status: 'failed',
        id: null,
        error: error?.message ?? 'unknown persistence failure',
    };
}

function normalizeUuid(value: string | null): string | null {
    const normalized = value?.trim();
    return normalized && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
        ? normalized
        : null;
}

function normalizeText(value: string | null): string | null {
    return value && value.trim().length > 0 ? value.trim() : null;
}
