/**
 * VetIOS Population Disease Signal Intelligence
 *
 * Cross-clinic epidemiological aggregation layer.
 * Answers: "Is there an anomalous rise in parvovirus in East Africa this week?"
 *
 * Aggregates individual passive signals into population-level disease heatmaps,
 * outbreak detection, and geographic trend alerts.
 */

import { getSupabaseServer } from '@/lib/supabaseServer';

// ─── Types ───────────────────────────────────────────────────

export interface PopulationSignalPoint {
  disease: string;
  species: string;
  region: string;
  count: number;
  period: string;       // ISO week: "2026-W17"
  tenantCount: number;  // number of clinics reporting
  avgConfidence: number;
}

export interface OutbreakAlert {
  id: string;
  disease: string;
  species: string;
  region: string;
  alertType: 'rising' | 'threshold_exceeded' | 'novel_cluster' | 'geographic_spread';
  severity: 'watch' | 'warning' | 'alert' | 'emergency';
  baselineCount: number;
  currentCount: number;
  increasePercent: number;
  affectedClinics: number;
  firstDetected: string;
  lastUpdated: string;
  description: string;
  recommendedActions: string[];
}

export interface DiseaseHeatmapEntry {
  region: string;
  disease: string;
  species: string;
  normalizedRate: number;   // cases per 1000 clinic visits
  trend: 'rising' | 'stable' | 'falling';
  weeklyChange: number;     // percent
  lastPeriod: string;
}

export interface PopulationSurveillanceReport {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  totalSignals: number;
  totalClinics: number;
  activeAlerts: OutbreakAlert[];
  heatmap: DiseaseHeatmapEntry[];
  topDiseasesByRegion: Record<string, Array<{ disease: string; count: number }>>;
  novelClusters: Array<{ disease: string; region: string; firstSeen: string }>;
  summary: string;
}

// ─── Signal Aggregation Config ────────────────────────────────

const OUTBREAK_THRESHOLDS = {
  rising_threshold_pct: 50,      // 50% increase vs prior period = "rising"
  alert_threshold_pct: 100,      // 2x increase = "alert"
  emergency_threshold_pct: 300,  // 4x increase = "emergency"
  min_cases_for_alert: 3,        // ignore statistical noise < 3 cases
  lookback_weeks: 4,             // baseline period
};

const HIGH_PRIORITY_DISEASES = new Set([
  'canine parvovirus', 'parvovirus', 'rabies', 'distemper', 'foot and mouth disease',
  'avian influenza', 'brucellosis', 'leptospirosis', 'ehrlichiosis',
  'african swine fever', 'newcastle disease', 'east coast fever',
]);

// ─── Population Signal Service ────────────────────────────────

export class PopulationSignalService {
  private supabase = getSupabaseServer();

  /**
   * Ingest a new disease signal from a clinic inference event.
   * Called passively after every confirmed diagnosis.
   */
  async ingestSignal(params: {
    tenantId: string;
    disease: string;
    species: string;
    region: string;
    confidence: number;
    inferenceEventId: string;
  }): Promise<void> {
    const isoWeek = this.getISOWeek(new Date());

    const { error } = await this.supabase.from('population_disease_signals').upsert(
      {
        tenant_id: params.tenantId,
        disease: params.disease.toLowerCase().trim(),
        species: params.species.toLowerCase(),
        region: params.region.toLowerCase().trim(),
        period: isoWeek,
        inference_event_id: params.inferenceEventId,
        confidence: params.confidence,
        reported_at: new Date().toISOString(),
      },
      { onConflict: 'inference_event_id' }
    );

    if (error) throw new Error(`PopulationSignal ingest failed: ${error.message}`);
  }

  /**
   * Run outbreak detection across all regions.
   * Compares current period against 4-week baseline.
   * Should be called by the cron/passive-signal-sync route.
   */
  async detectOutbreaks(): Promise<OutbreakAlert[]> {
    const currentWeek = this.getISOWeek(new Date());
    const priorWeeks = this.getPriorWeeks(OUTBREAK_THRESHOLDS.lookback_weeks);

    // ── Current period counts ──
    const { data: currentData, error: currErr } = await this.supabase
      .from('population_disease_signals')
      .select('disease, species, region, tenant_id, confidence')
      .eq('period', currentWeek);

    if (currErr) throw new Error(`Outbreak detection current query failed: ${currErr.message}`);

    // ── Baseline counts ──
    const { data: baselineData, error: baseErr } = await this.supabase
      .from('population_disease_signals')
      .select('disease, species, region, period, tenant_id')
      .in('period', priorWeeks);

    if (baseErr) throw new Error(`Outbreak detection baseline query failed: ${baseErr.message}`);

    // ── Aggregate ──
    const currentCounts = this.aggregateSignals(currentData ?? []);
    const baselineCounts = this.aggregateSignals(baselineData ?? []);

    const alerts: OutbreakAlert[] = [];

    for (const [key, current] of currentCounts.entries()) {
      if (current.count < OUTBREAK_THRESHOLDS.min_cases_for_alert) continue;

      const baseline = baselineCounts.get(key);
      const baselineWeeklyAvg = baseline ? baseline.count / OUTBREAK_THRESHOLDS.lookback_weeks : 0;

      if (baselineWeeklyAvg === 0) {
        // Novel cluster — disease not seen in baseline period
        if (current.count >= OUTBREAK_THRESHOLDS.min_cases_for_alert) {
          const [disease, species, region] = key.split('::');
          alerts.push(this.buildAlert({
            disease, species, region,
            alertType: 'novel_cluster',
            severity: HIGH_PRIORITY_DISEASES.has(disease) ? 'emergency' : 'warning',
            baselineCount: 0,
            currentCount: current.count,
            increasePercent: 100,
            affectedClinics: current.tenantCount,
          }));
        }
        continue;
      }

      const increasePercent = ((current.count - baselineWeeklyAvg) / baselineWeeklyAvg) * 100;

      if (increasePercent < OUTBREAK_THRESHOLDS.rising_threshold_pct) continue;

      const [disease, species, region] = key.split('::');

      let severity: OutbreakAlert['severity'] = 'watch';
      let alertType: OutbreakAlert['alertType'] = 'rising';

      if (increasePercent >= OUTBREAK_THRESHOLDS.emergency_threshold_pct) {
        severity = HIGH_PRIORITY_DISEASES.has(disease) ? 'emergency' : 'alert';
        alertType = 'threshold_exceeded';
      } else if (increasePercent >= OUTBREAK_THRESHOLDS.alert_threshold_pct) {
        severity = HIGH_PRIORITY_DISEASES.has(disease) ? 'alert' : 'warning';
        alertType = 'threshold_exceeded';
      } else {
        severity = 'watch';
        alertType = 'rising';
      }

      alerts.push(this.buildAlert({
        disease, species, region,
        alertType,
        severity,
        baselineCount: Math.round(baselineWeeklyAvg),
        currentCount: current.count,
        increasePercent,
        affectedClinics: current.tenantCount,
      }));
    }

    // Persist alerts
    if (alerts.length > 0) {
      await this.persistAlerts(alerts);
    }

    return alerts.sort((a, b) => {
      const severityOrder = { emergency: 0, alert: 1, warning: 2, watch: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Build the disease heatmap for a given region/period.
   */
  async buildHeatmap(region?: string, weeks = 2): Promise<DiseaseHeatmapEntry[]> {
    const periods = this.getPriorWeeks(weeks);
    const currentWeek = this.getISOWeek(new Date());

    const query = this.supabase
      .from('population_disease_signals')
      .select('disease, species, region, period, tenant_id, confidence')
      .in('period', [...periods, currentWeek]);

    if (region) query.ilike('region', `%${region}%`);

    const { data, error } = await query;
    if (error) throw new Error(`Heatmap query failed: ${error.message}`);

    const signals = data ?? [];
    const byKey = new Map<string, {
      current: number; prior: number; tenants: Set<string>;
    }>();

    for (const s of signals) {
      const key = `${s.disease}::${s.species}::${s.region}`;
      const existing = byKey.get(key) ?? { current: 0, prior: 0, tenants: new Set() };
      existing.tenants.add(s.tenant_id);
      if (s.period === currentWeek) existing.current++;
      else existing.prior++;
      byKey.set(key, existing);
    }

    const entries: DiseaseHeatmapEntry[] = [];
    for (const [key, counts] of byKey.entries()) {
      const [disease, species, reg] = key.split('::');
      const totalCount = counts.current + counts.prior;
      const clinicVisitEstimate = counts.tenants.size * 50 * weeks; // rough estimate
      const normalizedRate = (totalCount / Math.max(clinicVisitEstimate, 1)) * 1000;

      const weeklyChange = counts.prior > 0
        ? ((counts.current - counts.prior) / counts.prior) * 100
        : 100;

      entries.push({
        region: reg,
        disease,
        species,
        normalizedRate,
        trend: weeklyChange > 15 ? 'rising' : weeklyChange < -15 ? 'falling' : 'stable',
        weeklyChange,
        lastPeriod: currentWeek,
      });
    }

    return entries.sort((a, b) => b.normalizedRate - a.normalizedRate);
  }

  /**
   * Generate a full population surveillance report.
   */
  async generateSurveillanceReport(): Promise<PopulationSurveillanceReport> {
    const now = new Date();
    const currentWeek = this.getISOWeek(now);

    const [alerts, heatmap] = await Promise.all([
      this.detectOutbreaks(),
      this.buildHeatmap(),
    ]);

    // Count totals
    const { count: totalSignals } = await this.supabase
      .from('population_disease_signals')
      .select('*', { count: 'exact', head: true })
      .eq('period', currentWeek);

    const { data: clinicData } = await this.supabase
      .from('population_disease_signals')
      .select('tenant_id')
      .eq('period', currentWeek);

    const totalClinics = new Set((clinicData ?? []).map((r) => r.tenant_id)).size;

    // Top diseases by region
    const topDiseasesByRegion: Record<string, Array<{ disease: string; count: number }>> = {};
    for (const entry of heatmap) {
      if (!topDiseasesByRegion[entry.region]) topDiseasesByRegion[entry.region] = [];
      topDiseasesByRegion[entry.region].push({ disease: entry.disease, count: Math.round(entry.normalizedRate) });
    }

    // Novel clusters
    const novelClusters = alerts
      .filter((a) => a.alertType === 'novel_cluster')
      .map((a) => ({ disease: a.disease, region: a.region, firstSeen: a.firstDetected }));

    const activeAlerts = alerts.filter((a) => a.severity !== 'watch');
    const summary = this.buildSurveillanceSummary(activeAlerts, totalSignals ?? 0, totalClinics);

    // Calculate period boundaries
    const periodStart = this.weekStart(now).toISOString().split('T')[0];
    const periodEnd = new Date(this.weekStart(now).getTime() + 6 * 86400000).toISOString().split('T')[0];

    return {
      generatedAt: now.toISOString(),
      periodStart,
      periodEnd,
      totalSignals: totalSignals ?? 0,
      totalClinics,
      activeAlerts,
      heatmap: heatmap.slice(0, 50),
      topDiseasesByRegion,
      novelClusters,
      summary,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────

  private aggregateSignals(
    signals: Array<{ disease: string; species: string; region: string; tenant_id: string; confidence?: number }>
  ): Map<string, { count: number; tenantCount: number; avgConfidence: number }> {
    const map = new Map<string, { count: number; tenants: Set<string>; confidenceSum: number }>();

    for (const s of signals) {
      const key = `${s.disease}::${s.species}::${s.region}`;
      const existing = map.get(key) ?? { count: 0, tenants: new Set(), confidenceSum: 0 };
      existing.count++;
      existing.tenants.add(s.tenant_id);
      existing.confidenceSum += s.confidence ?? 0;
      map.set(key, existing);
    }

    const result = new Map<string, { count: number; tenantCount: number; avgConfidence: number }>();
    for (const [key, val] of map.entries()) {
      result.set(key, {
        count: val.count,
        tenantCount: val.tenants.size,
        avgConfidence: val.count > 0 ? val.confidenceSum / val.count : 0,
      });
    }
    return result;
  }

  private buildAlert(params: {
    disease: string; species: string; region: string;
    alertType: OutbreakAlert['alertType']; severity: OutbreakAlert['severity'];
    baselineCount: number; currentCount: number; increasePercent: number; affectedClinics: number;
  }): OutbreakAlert {
    const actions: string[] = [];
    if (params.severity === 'emergency' || params.severity === 'alert') {
      actions.push('Notify regional veterinary authority');
      actions.push('Increase surveillance in affected region');
      actions.push('Verify vaccination status of at-risk patients');
    }
    if (HIGH_PRIORITY_DISEASES.has(params.disease)) {
      actions.push('Consider mandatory reporting to national animal disease authority');
    }
    actions.push('Continue passive signal monitoring with weekly updates');

    return {
      id: `alert_${params.disease.replace(/\s/g, '_')}_${params.region.replace(/\s/g, '_')}_${Date.now()}`,
      disease: params.disease,
      species: params.species,
      region: params.region,
      alertType: params.alertType,
      severity: params.severity,
      baselineCount: params.baselineCount,
      currentCount: params.currentCount,
      increasePercent: Math.round(params.increasePercent),
      affectedClinics: params.affectedClinics,
      firstDetected: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      description: `${params.disease} in ${params.species} in ${params.region}: ${params.currentCount} cases this week vs ${params.baselineCount} weekly baseline (+${Math.round(params.increasePercent)}%, ${params.affectedClinics} clinic${params.affectedClinics !== 1 ? 's' : ''}).`,
      recommendedActions: actions,
    };
  }

  private async persistAlerts(alerts: OutbreakAlert[]): Promise<void> {
    const { error } = await this.supabase
      .from('population_outbreak_alerts')
      .upsert(
        alerts.map((a) => ({
          alert_id: a.id,
          disease: a.disease,
          species: a.species,
          region: a.region,
          alert_type: a.alertType,
          severity: a.severity,
          baseline_count: a.baselineCount,
          current_count: a.currentCount,
          increase_percent: a.increasePercent,
          affected_clinics: a.affectedClinics,
          description: a.description,
          first_detected: a.firstDetected,
          last_updated: a.lastUpdated,
        })),
        { onConflict: 'alert_id' }
      );

    if (error) console.error('Failed to persist outbreak alerts:', error.message);
  }

  private getISOWeek(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
  }

  private getPriorWeeks(count: number): string[] {
    const weeks: string[] = [];
    for (let i = 1; i <= count; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      weeks.push(this.getISOWeek(d));
    }
    return weeks;
  }

  private weekStart(date: Date): Date {
    const d = new Date(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private buildSurveillanceSummary(
    alerts: OutbreakAlert[],
    totalSignals: number,
    totalClinics: number
  ): string {
    const parts: string[] = [`${totalSignals} disease signals from ${totalClinics} clinics this period.`];
    if (alerts.length === 0) {
      parts.push('No active outbreak alerts.');
    } else {
      const emergencies = alerts.filter((a) => a.severity === 'emergency');
      if (emergencies.length > 0) {
        parts.push(`⚠ EMERGENCY: ${emergencies.map((a) => `${a.disease} in ${a.region}`).join(', ')}.`);
      }
      const warnings = alerts.filter((a) => a.severity === 'warning' || a.severity === 'alert');
      if (warnings.length > 0) {
        parts.push(`Active alerts: ${warnings.map((a) => `${a.disease} (${a.region}, +${a.increasePercent}%)`).join('; ')}.`);
      }
    }
    return parts.join(' ');
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _service: PopulationSignalService | null = null;

export function getPopulationSignalService(): PopulationSignalService {
  if (!_service) _service = new PopulationSignalService();
  return _service;
}
