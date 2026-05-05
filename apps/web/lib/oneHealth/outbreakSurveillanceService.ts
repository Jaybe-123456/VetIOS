/**
 * VetIOS Tier 2 — Outbreak Surveillance Service
 *
 * Wraps the existing PopulationSignalEngine and adds the One Health
 * cross-species dimension. Answers:
 *   "Are multiple species in the same region showing the same pathogen?"
 *   "Has the WHO notification threshold been crossed this week?"
 *   "Is this a novel host species for this pathogen?"
 *
 * Connects to:
 *   lib/epidemiology/populationSignalEngine.ts  — base signal computation
 *   lib/oneHealth/zoonoticBridgeEngine.ts        — zoonotic risk enrichment
 *   one_health_signals                           — source of cross-species signals
 *   zoonotic_bridge_alerts                       — output alerts
 */

import { PopulationSignalEngine } from '@/lib/epidemiology/populationSignalEngine';
import {
  getZoonoticBridgeEngine,
  ZOONOTIC_PATHOGEN_REGISTRY,
  type ZoonoticRiskLevel,
} from '@/lib/oneHealth/zoonoticBridgeEngine';
import { getSupabaseServer } from '@/lib/supabaseServer';

// ─── Types ───────────────────────────────────────────────────

export interface OneHealthSurveillanceReport {
  generatedAt: string;
  isoWeek: string;
  region: string | null;

  // Base epidemiology (from PopulationSignalEngine)
  totalCasesThisWeek: number;
  singleSpeciesAlerts: number;

  // One Health layer
  crossSpeciesClusters: CrossSpeciesCluster[];
  zoonoticAlerts: ZoonoticBridgeAlertSummary[];
  whoNotificationWarranted: boolean;
  whoNotificationPathogens: string[];

  summary: string;
}

export interface CrossSpeciesCluster {
  pathogen: string;
  affectedSpecies: string[];
  region: string | null;
  totalCases: number;
  riskLevel: ZoonoticRiskLevel;
  isoWeek: string;
  // Plain English interpretation
  interpretation: string;
}

export interface ZoonoticBridgeAlertSummary {
  pathogen: string;
  animalSpecies: string[];
  region: string | null;
  caseCount: number;
  riskLevel: ZoonoticRiskLevel;
  alertType: string;
  title: string;
  description: string;
  recommendedActions: string[];
  whoNotificationWarranted: boolean;
}

// ─── Outbreak Surveillance Service ───────────────────────────

export class OutbreakSurveillanceService {
  private supabase = getSupabaseServer();
  private populationEngine = new PopulationSignalEngine();
  private zoonoticEngine = getZoonoticBridgeEngine();

  /**
   * Run a full One Health surveillance sweep for a region and week.
   * Returns base epidemiology + cross-species clusters + zoonotic alerts.
   */
  async runSurveillanceSweep(
    region: string | null = null,
    isoWeek: string = this.currentIsoWeek()
  ): Promise<OneHealthSurveillanceReport> {
    // Step 1: Base epidemiology from existing engine
    const baseReport = await this.populationEngine.computeSignals(undefined, region ?? undefined);

    // Step 2: Cross-species signals from one_health_signals
    const regionalSignals = await this.zoonoticEngine.getRegionalSignals(
      region, isoWeek, ['high', 'moderate', 'low']
    );

    // Step 3: Find cross-species clusters
    // A cluster = same pathogen in 2+ species in the same region this week
    const crossSpeciesClusters = this.identifyCrossSpeciesClusters(regionalSignals, isoWeek);

    // Step 4: Generate zoonotic alerts
    const zoonoticAlerts = await this.generateZoonoticAlerts(
      crossSpeciesClusters, region, isoWeek
    );

    // Step 5: WHO notification check
    const whoPathogens: string[] = [];
    for (const cluster of crossSpeciesClusters) {
      const pathogenKey = Object.keys(ZOONOTIC_PATHOGEN_REGISTRY).find(
        k => ZOONOTIC_PATHOGEN_REGISTRY[k].label === cluster.pathogen
      );
      if (pathogenKey) {
        const { thresholdCrossed } = await this.zoonoticEngine.checkWhoThreshold(
          pathogenKey, region, isoWeek
        );
        if (thresholdCrossed) whoPathogens.push(cluster.pathogen);
      }
    }

    // Step 6: Persist alerts
    await this.persistAlerts(zoonoticAlerts, region, isoWeek);

    const report: OneHealthSurveillanceReport = {
      generatedAt: new Date().toISOString(),
      isoWeek,
      region,
      totalCasesThisWeek: baseReport.totalCasesThisWeek,
      singleSpeciesAlerts: baseReport.outbreakAlerts.length,
      crossSpeciesClusters,
      zoonoticAlerts,
      whoNotificationWarranted: whoPathogens.length > 0,
      whoNotificationPathogens: whoPathogens,
      summary: this.buildSummary(baseReport.totalCasesThisWeek, crossSpeciesClusters, zoonoticAlerts, whoPathogens, region),
    };

    return report;
  }

  // ─── Private helpers ──────────────────────────────────────

  private identifyCrossSpeciesClusters(
    signals: Array<{ pathogen: string; species: string; count: number; riskLevel: string }>,
    isoWeek: string
  ): CrossSpeciesCluster[] {
    // Group by pathogen
    const byPathogen = new Map<string, Array<{ species: string; count: number; riskLevel: string }>>();
    for (const s of signals) {
      if (!s.pathogen) continue;
      const existing = byPathogen.get(s.pathogen) ?? [];
      existing.push({ species: s.species, count: s.count, riskLevel: s.riskLevel });
      byPathogen.set(s.pathogen, existing);
    }

    const clusters: CrossSpeciesCluster[] = [];
    for (const [pathogen, speciesData] of byPathogen) {
      if (speciesData.length < 2) continue; // need 2+ species for a cross-species cluster

      const uniqueSpecies = [...new Set(speciesData.map(s => s.species))];
      if (uniqueSpecies.length < 2) continue;

      const totalCases = speciesData.reduce((sum, s) => sum + s.count, 0);
      const topRisk = speciesData.reduce((top, s) =>
        riskRank(s.riskLevel as ZoonoticRiskLevel) > riskRank(top.riskLevel as ZoonoticRiskLevel) ? s : top
      );

      clusters.push({
        pathogen,
        affectedSpecies: uniqueSpecies,
        region: null, // region is filtered upstream
        totalCases,
        riskLevel: topRisk.riskLevel as ZoonoticRiskLevel,
        isoWeek,
        interpretation: this.buildClusterInterpretation(pathogen, uniqueSpecies, totalCases, topRisk.riskLevel as ZoonoticRiskLevel),
      });
    }

    return clusters.sort((a, b) => riskRank(b.riskLevel) - riskRank(a.riskLevel));
  }

  private async generateZoonoticAlerts(
    clusters: CrossSpeciesCluster[],
    region: string | null,
    isoWeek: string
  ): Promise<ZoonoticBridgeAlertSummary[]> {
    const alerts: ZoonoticBridgeAlertSummary[] = [];

    for (const cluster of clusters) {
      if (cluster.riskLevel === 'none') continue;

      const pathogenKey = Object.keys(ZOONOTIC_PATHOGEN_REGISTRY).find(
        k => ZOONOTIC_PATHOGEN_REGISTRY[k].label === cluster.pathogen
      );
      const profile = pathogenKey ? ZOONOTIC_PATHOGEN_REGISTRY[pathogenKey] : null;

      const { thresholdCrossed, caseCount, threshold } = pathogenKey
        ? await this.zoonoticEngine.checkWhoThreshold(pathogenKey, region, isoWeek)
        : { thresholdCrossed: false, caseCount: cluster.totalCases, threshold: 999 };

      const alertType = thresholdCrossed ? 'who_threshold'
        : cluster.affectedSpecies.length >= 3 ? 'novel_host'
        : 'zoonotic_cluster';

      const severity = cluster.riskLevel === 'high' && thresholdCrossed ? 'emergency'
        : cluster.riskLevel === 'high' ? 'alert'
        : cluster.riskLevel === 'moderate' ? 'warning'
        : 'watch';

      alerts.push({
        pathogen: cluster.pathogen,
        animalSpecies: cluster.affectedSpecies,
        region,
        caseCount,
        riskLevel: cluster.riskLevel,
        alertType,
        title: `${cluster.pathogen} detected across ${cluster.affectedSpecies.join(' + ')}${region ? ` in ${region}` : ''}`,
        description: cluster.interpretation + (thresholdCrossed
          ? ` WHO notification threshold (${threshold} cases) has been crossed.`
          : ''),
        recommendedActions: this.buildRecommendedActions(cluster, thresholdCrossed, profile),
        whoNotificationWarranted: thresholdCrossed,
      });
    }

    return alerts;
  }

  private async persistAlerts(
    alerts: ZoonoticBridgeAlertSummary[],
    region: string | null,
    isoWeek: string
  ): Promise<void> {
    if (alerts.length === 0) return;

    try {
      const rows = alerts.map(a => ({
        pathogen: a.pathogen,
        animal_species: a.animalSpecies,
        region,
        iso_week: isoWeek,
        alert_type: a.alertType,
        severity: a.whoNotificationWarranted ? 'emergency'
          : a.riskLevel === 'high' ? 'alert'
          : a.riskLevel === 'moderate' ? 'warning' : 'watch',
        zoonotic_risk_level: a.riskLevel,
        animal_case_count: a.caseCount,
        affected_clinic_count: 0,
        title: a.title,
        description: a.description,
        recommended_actions: a.recommendedActions,
        who_notification_warranted: a.whoNotificationWarranted,
        first_detected_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }));

      await this.supabase.from('zoonotic_bridge_alerts').insert(rows);
    } catch (err) {
      console.error('[OutbreakSurveillanceService] persistAlerts failed:', err);
    }
  }

  private buildClusterInterpretation(
    pathogen: string,
    species: string[],
    totalCases: number,
    riskLevel: ZoonoticRiskLevel
  ): string {
    const speciesList = species.join(' and ');
    const riskNote = riskLevel === 'high'
      ? ' This is a HIGH zoonotic risk pathogen — human exposure risk is significant.'
      : riskLevel === 'moderate'
      ? ' Moderate zoonotic risk — veterinary staff should take precautions.'
      : ' Low zoonotic risk — monitor but standard precautions sufficient.';

    return `${pathogen} detected in ${speciesList} (${totalCases} total cases this week).${riskNote}`;
  }

  private buildRecommendedActions(
    cluster: CrossSpeciesCluster,
    thresholdCrossed: boolean,
    profile: typeof ZOONOTIC_PATHOGEN_REGISTRY[string] | null
  ): string[] {
    const actions: string[] = [];

    if (thresholdCrossed) {
      actions.push('Notify regional veterinary authority immediately');
      actions.push('Consider WHO/FAO notification via national focal point');
    }

    if (cluster.riskLevel === 'high') {
      actions.push('Enhanced PPE for all staff handling affected animals');
      actions.push('Isolate affected animals and restrict movement');
    }

    if (profile?.pathway === 'waterborne') {
      actions.push('Issue water safety advisory for affected region');
    }

    if (profile?.pathway === 'foodborne') {
      actions.push('Alert food safety authority — check supply chain');
    }

    actions.push(`Increase surveillance frequency for ${cluster.pathogen} in ${cluster.affectedSpecies.join(', ')}`);

    return actions.slice(0, 4);
  }

  private buildSummary(
    totalCases: number,
    clusters: CrossSpeciesCluster[],
    alerts: ZoonoticBridgeAlertSummary[],
    whoPathogens: string[],
    region: string | null
  ): string {
    const parts: string[] = [];
    const loc = region ? ` in ${region}` : ' across the network';

    parts.push(`${totalCases} total cases this week${loc}.`);

    if (clusters.length > 0) {
      parts.push(`${clusters.length} cross-species cluster(s) detected: ` +
        clusters.map(c => `${c.pathogen} (${c.affectedSpecies.join('+')})`).slice(0, 3).join(', ') + '.');
    } else {
      parts.push('No cross-species clusters detected this week.');
    }

    if (whoPathogens.length > 0) {
      parts.push(`⚠ WHO notification threshold crossed for: ${whoPathogens.join(', ')}.`);
    }

    if (alerts.length === 0) {
      parts.push('No zoonotic alerts active.');
    } else {
      const high = alerts.filter(a => a.riskLevel === 'high').length;
      parts.push(`${alerts.length} zoonotic alert(s) active${high > 0 ? `, ${high} high-risk` : ''}.`);
    }

    return parts.join(' ');
  }

  private currentIsoWeek(): string {
    const d = new Date();
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
}

function riskRank(level: ZoonoticRiskLevel): number {
  return { high: 3, moderate: 2, low: 1, none: 0 }[level];
}

// ─── Singleton ────────────────────────────────────────────────
let _service: OutbreakSurveillanceService | null = null;
export function getOutbreakSurveillanceService(): OutbreakSurveillanceService {
  if (!_service) _service = new OutbreakSurveillanceService();
  return _service;
}
