import { NextResponse } from 'next/server';
import { mapCaseSummary, type CaseSummary } from '@/lib/cases/caseWorkflow';
import { buildOpenCaseClosureDigest } from '@/lib/cases/caseClosureMetrics';
import { authorizeCronRequest } from '@/lib/http/cronAuth';
import { withRequestHeaders } from '@/lib/http/requestId';
import { createPlatformAlert } from '@/lib/platform/alerts';
import { getSupabaseServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const CASE_SCAN_LIMIT = 5000;
const DIGEST_ITEM_LIMIT = 12;
const OVERDUE_HOURS = 24;

export async function GET(req: Request) {
    const requestId = `cron_case_closure_${Date.now()}`;
    const startTime = Date.now();
    const cronAuth = authorizeCronRequest(req, 'case-closure-digest');

    if (!cronAuth.authorized) {
        const response = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
        withRequestHeaders(response.headers, requestId, startTime);
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }

    const supabase = getSupabaseServer();
    const now = new Date();

    try {
        const { data, error } = await supabase
            .from('clinical_cases')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(CASE_SCAN_LIMIT);

        if (error) {
            throw new Error(`Failed to load clinical cases for closure digest: ${error.message}`);
        }

        const casesByTenant = groupCasesByTenant((data ?? []).map((row) => mapCaseSummary(row as Record<string, unknown>)));
        const tenantSummaries: Array<Record<string, unknown>> = [];
        const errors: string[] = [];

        for (const [tenantId, tenantCases] of casesByTenant) {
            const digest = buildOpenCaseClosureDigest(tenantCases, {
                now,
                overdueHours: OVERDUE_HOURS,
                limit: DIGEST_ITEM_LIMIT,
            });

            if (digest.metrics.open_cases === 0) {
                tenantSummaries.push({
                    tenant_id: tenantId,
                    open_cases: 0,
                    closed_cases: digest.metrics.closed_cases,
                    closure_rate: digest.metrics.closure_rate,
                    alert_written: false,
                });
                continue;
            }

            try {
                await createPlatformAlert(supabase, {
                    alertKey: `case_closure_digest:${tenantId}:${now.toISOString().slice(0, 10)}`,
                    tenantId,
                    type: 'case_closure_digest',
                    severity: digest.metrics.overdue_open_cases > 0 ? 'medium' : 'low',
                    title: 'Daily case closure digest',
                    message: [
                        `${digest.metrics.open_cases} open case${digest.metrics.open_cases === 1 ? '' : 's'} need outcome closure.`,
                        `${digest.metrics.overdue_open_cases} are older than ${OVERDUE_HOURS} hours.`,
                        `Inferred closure rate is ${(digest.metrics.inferred_closure_rate * 100).toFixed(0)}%.`,
                    ].join(' '),
                    metadata: {
                        generated_at: digest.generated_at,
                        overdue_hours: digest.overdue_hours,
                        metrics: digest.metrics,
                        open_cases_to_close: digest.items,
                        truncated: digest.truncated,
                    },
                });
            } catch (error) {
                errors.push(`${tenantId}: ${error instanceof Error ? error.message : 'alert write failed'}`);
            }

            tenantSummaries.push({
                tenant_id: tenantId,
                open_cases: digest.metrics.open_cases,
                overdue_open_cases: digest.metrics.overdue_open_cases,
                inferred_closure_rate: digest.metrics.inferred_closure_rate,
                closure_rate: digest.metrics.closure_rate,
                digest_items: digest.items.length,
                alert_written: true,
            });
        }

        const response = NextResponse.json({
            cron: {
                job: 'case-closure-digest',
                authorized_by: cronAuth.method,
                ran_at: now.toISOString(),
            },
            summary: {
                scanned_cases: data?.length ?? 0,
                tenant_count: casesByTenant.size,
                alerts_attempted: tenantSummaries.filter((entry) => entry.alert_written).length,
                errors: errors.length,
                latency_ms: Date.now() - startTime,
            },
            tenants: tenantSummaries,
            errors,
            request_id: requestId,
        });
        withRequestHeaders(response.headers, requestId, startTime);
        response.headers.set('Cache-Control', 'no-store');
        return response;
    } catch (error) {
        const response = NextResponse.json(
            {
                error: {
                    code: 'cron_failed',
                    message: error instanceof Error ? error.message : String(error),
                },
                cron: { job: 'case-closure-digest' },
                request_id: requestId,
            },
            { status: 500 },
        );
        withRequestHeaders(response.headers, requestId, startTime);
        response.headers.set('Cache-Control', 'no-store');
        return response;
    }
}

function groupCasesByTenant(cases: CaseSummary[]): Map<string, CaseSummary[]> {
    const groups = new Map<string, CaseSummary[]>();
    for (const clinicalCase of cases) {
        if (!clinicalCase.tenant_id || clinicalCase.tenant_id === 'undefined') continue;
        const existing = groups.get(clinicalCase.tenant_id) ?? [];
        existing.push(clinicalCase);
        groups.set(clinicalCase.tenant_id, existing);
    }
    return groups;
}
