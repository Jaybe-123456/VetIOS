/**
 * GET /api/cron/active-learning-sweep
 *
 * Runs daily at 8am UTC (0 8 * * *).
 * Sweeps the active learning queue:
 *   1. Auto-resolve cases older than 30 days (model has since improved)
 *   2. Escalate high-priority cases older than 7 days to clinic admin
 *   3. Compute per-tenant queue health metrics
 *   4. Log learning velocity (cases reviewed / cases enqueued)
 *
 * Protected by CRON_SECRET.
 */

import { NextResponse } from 'next/server';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const CRON_CACHE_CONTROL = 'no-store';
const ACTIVE_LEARNING_SWEEP_LIMIT = 1000;

export async function GET(req: Request) {
  const requestId = `cron_al_${Date.now()}`;
  const startTime = Date.now();

  const _cronAuth = authorizeCronRequest(req, 'active-learning-sweep');
  if (!_cronAuth.authorized) {
    const res = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    withRequestHeaders(res.headers, requestId, startTime);
    res.headers.set('Cache-Control', CRON_CACHE_CONTROL);
    return res;
  }

  const supabase = getSupabaseServer();

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

  let autoResolved = 0;
  let escalated = 0;
  const errors: string[] = [];

  try {
    // ── 1. Auto-resolve cases older than 30 days ──
    const { data: staleRows, error: staleErr } = await supabase
      .from('active_learning_queue')
      .select('id')
      .eq('status', 'pending_review')
      .lt('created_at', thirtyDaysAgo)
      .limit(ACTIVE_LEARNING_SWEEP_LIMIT);

    if (staleErr) throw new Error(`Stale query failed: ${staleErr.message}`);

    if ((staleRows ?? []).length > 0) {
      const staleIds = (staleRows ?? []).map((r) => r.id);
      const { error: resolveErr } = await supabase
        .from('active_learning_queue')
        .update({
          status: 'auto_resolved',
          reviewed_at: now.toISOString(),
          assigned_to: 'system:auto_resolve',
        })
        .in('id', staleIds);

      if (resolveErr) errors.push(`Auto-resolve failed: ${resolveErr.message}`);
      else autoResolved = staleIds.length;
    }

    // ── 2. Escalate high-priority cases older than 7 days ──
    const { data: escalateRows, error: escalateQueryErr } = await supabase
      .from('active_learning_queue')
      .select('id, tenant_id, predicted_diagnosis, species, reason')
      .eq('status', 'pending_review')
      .in('priority', ['critical', 'high'])
      .lt('created_at', sevenDaysAgo)
      .limit(ACTIVE_LEARNING_SWEEP_LIMIT);

    if (escalateQueryErr) errors.push(`Escalate query failed: ${escalateQueryErr.message}`);

    if ((escalateRows ?? []).length > 0) {
      try {
        // Create platform alert for overdue high-priority cases
        await supabase.from('platform_alerts').upsert(
          (escalateRows ?? []).map((row) => ({
            alert_key: `al_overdue_${row.id}`,
            alert_type: 'active_learning_overdue',
            severity: 'warning',
            title: 'Active Learning Case Overdue',
            message: `High-priority case for ${row.species} (${row.predicted_diagnosis ?? 'unknown'}) has been pending review for >7 days. Labelling this case would improve model accuracy.`,
            metadata: {
              active_learning_case_id: row.id,
              tenant_id: row.tenant_id,
              reason: row.reason,
            },
            resolved: false,
            updated_at: now.toISOString(),
          })),
          { onConflict: 'alert_key' }
        );
        escalated += (escalateRows ?? []).length;
      } catch (e) {
        errors.push(`Escalate overdue active-learning alerts: ${String(e)}`);
      }
    }

    // ── 3. Compute queue health per tenant ──
    const { data: queueStats } = await supabase
      .from('active_learning_queue')
      .select('tenant_id, status, priority')
      .gte('created_at', sevenDaysAgo)
      .limit(ACTIVE_LEARNING_SWEEP_LIMIT);

    const tenantHealth: Record<string, { pending: number; reviewed: number; critical: number }> = {};
    for (const row of queueStats ?? []) {
      if (!tenantHealth[row.tenant_id]) {
        tenantHealth[row.tenant_id] = { pending: 0, reviewed: 0, critical: 0 };
      }
      if (row.status === 'pending_review') tenantHealth[row.tenant_id].pending++;
      if (row.status === 'reviewed') tenantHealth[row.tenant_id].reviewed++;
      if (row.priority === 'critical') tenantHealth[row.tenant_id].critical++;
    }

    // Compute overall learning velocity
    const totalPending = Object.values(tenantHealth).reduce((s, t) => s + t.pending, 0);
    const totalReviewed = Object.values(tenantHealth).reduce((s, t) => s + t.reviewed, 0);
    const learningVelocity = (totalPending + totalReviewed) > 0
      ? totalReviewed / (totalPending + totalReviewed)
      : 0;

    const latencyMs = Date.now() - startTime;

    const res = NextResponse.json({
      cron: {
        job: 'active-learning-sweep',
        schedule: '0 8 * * *',
        authorized_by: _cronAuth.method,
        ran_at: now.toISOString(),
      },
      summary: {
        auto_resolved_stale: autoResolved,
        escalated_overdue: escalated,
        tenant_count: Object.keys(tenantHealth).length,
        learning_velocity_7d: parseFloat(learningVelocity.toFixed(3)),
        total_pending_7d: totalPending,
        total_reviewed_7d: totalReviewed,
        latency_ms: latencyMs,
        errors: errors.length,
      },
      tenant_health: tenantHealth,
      errors: errors.slice(0, 10),
      request_id: requestId,
    });
    withRequestHeaders(res.headers, requestId, startTime);
    res.headers.set('Cache-Control', CRON_CACHE_CONTROL);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      {
        error: { code: 'cron_failed', message: err instanceof Error ? err.message : String(err) },
        cron: { job: 'active-learning-sweep' },
        request_id: requestId,
      },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    res.headers.set('Cache-Control', CRON_CACHE_CONTROL);
    return res;
  }
}






