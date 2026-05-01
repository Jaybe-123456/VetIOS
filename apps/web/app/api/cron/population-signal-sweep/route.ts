/**
 * GET /api/cron/population-signal-sweep
 *
 * Runs every 4 hours by Vercel cron.
 * Aggregates cross-clinic disease signals and runs outbreak detection:
 *   1. Run outbreak detection across all regions
 *   2. Escalate emergency/alert-severity outbreaks to platform alerts
 *   3. Build updated heatmap snapshot
 *   4. Log surveillance telemetry
 *
 * Protected by CRON_SECRET.
 */

import { NextResponse } from 'next/server';
import { withRequestHeaders } from '@/lib/http/requestId';
import { getPopulationSignalEngine } from '@/lib/epidemiology/populationSignalEngine';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { authorizeCronRequest, buildCronExecutionRecord } from '@/lib/http/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const CRON_CACHE_CONTROL = 'no-store';
const POPULATION_SWEEP_QUERY_LIMIT = 1000;

export async function GET(req: Request) {
  const requestId = `cron_popsig_${Date.now()}`;
  const startTime = Date.now();

  const _cronAuth = authorizeCronRequest(req, 'population-signal-sweep');
  if (!_cronAuth.authorized) {
    const res = NextResponse.json({ error: 'Unauthorized', request_id: requestId }, { status: 401 });
    withRequestHeaders(res.headers, requestId, startTime);
    res.headers.set('Cache-Control', CRON_CACHE_CONTROL);
    return res;
  }

  const supabase = getSupabaseServer();
  const service = getPopulationSignalEngine();

  try {
    // ── Run outbreak detection ──
    const snapshot = await service.computeSignals(undefined, undefined, POPULATION_SWEEP_QUERY_LIMIT);
    const alerts = snapshot.outbreakAlerts;

    const emergencyAlerts = alerts.filter((a) => a.alertLevel === 'alert');
    const activeAlerts = alerts.filter((a) => a.alertLevel !== 'watch');

    // ── Escalate emergency alerts to platform_alerts table ──
    if (emergencyAlerts.length > 0) {
      await supabase.from('platform_alerts').upsert(
        emergencyAlerts.map((alert) => ({
          alert_key: `outbreak_${alert.disease}_${alert.region}`.toLowerCase().replace(/\s+/g, '_'),
          alert_type: 'population_outbreak_emergency',
          severity: 'critical',
          title: `⚠ OUTBREAK: ${alert.disease} in ${alert.region}`,
          message: alert.description,
          metadata: {
            disease: alert.disease,
            species: alert.species,
            region: alert.region,
            increase_percent: alert.anomalyScore,
            affected_clinics: alert.caseCount,
            current_count: alert.caseCount,
            baseline_count: 0,
          },
          resolved: false,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'alert_key' }
      );
    }

    // ── Build heatmap snapshot for telemetry ──
    const heatmap = snapshot.topDiseases;

    const latencyMs = Date.now() - startTime;

    const res = NextResponse.json({
      cron: {
        job: 'population-signal-sweep',
        schedule: '0 */4 * * *',
        authorized_by: _cronAuth.method,
        ran_at: new Date().toISOString(),
      },
      summary: {
        total_alerts_detected: alerts.length,
        emergency_alerts: emergencyAlerts.length,
        active_alerts: activeAlerts.length,
        watch_alerts: alerts.length - activeAlerts.length,
        heatmap_entries: heatmap.length,
        total_cases_this_week: snapshot.totalCasesThisWeek,
        latency_ms: latencyMs,
      },
      emergency_alerts: emergencyAlerts.map((a) => ({
        disease: a.disease,
        region: a.region,
        severity: a.alertLevel,
        anomaly_score: a.anomalyScore,
      })),
      request_id: requestId,
    });
    withRequestHeaders(res.headers, requestId, startTime);
    res.headers.set('Cache-Control', CRON_CACHE_CONTROL);
    return res;
  } catch (err) {
    const res = NextResponse.json(
      {
        error: { code: 'cron_failed', message: err instanceof Error ? err.message : String(err) },
        cron: { job: 'population-signal-sweep' },
        request_id: requestId,
      },
      { status: 500 }
    );
    withRequestHeaders(res.headers, requestId, startTime);
    res.headers.set('Cache-Control', CRON_CACHE_CONTROL);
    return res;
  }
}






