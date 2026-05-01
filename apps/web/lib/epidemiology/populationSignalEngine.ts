/**
 * VetIOS Population Signal Engine - Phase 3
 */
import { getSupabaseServer } from '@/lib/supabaseServer';

export interface PopulationSignal {
  disease: string; species: string; region: string | null;
  caseCount: number; weekOverWeekChange: number; anomalyScore: number;
  isAnomaly: boolean; alertLevel: 'normal' | 'watch' | 'warning' | 'alert';
}
export interface OutbreakAlert {
  disease: string; species: string; region: string | null;
  caseCount: number; anomalyScore: number;
  alertLevel: 'watch' | 'warning' | 'alert';
  detectedAt: string; description: string;
}
export interface EpidemiologySnapshot {
  signals: PopulationSignal[]; outbreakAlerts: OutbreakAlert[];
  totalCasesThisWeek: number;
  topDiseases: Array<{ disease: string; count: number; trend: 'rising' | 'stable' | 'falling' }>;
  generatedAt: string;
}
const POPULATION_SWEEP_QUERY_LIMIT = 1000;

export class PopulationSignalEngine {
  private supabase = getSupabaseServer();

  async computeSignals(species?: string, region?: string, limit = POPULATION_SWEEP_QUERY_LIMIT): Promise<EpidemiologySnapshot> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const { data: cw } = await this.supabase.from('ai_inference_events')
      .select('top_diagnosis, species, region, created_at')
      .gte('created_at', weekAgo.toISOString()).not('top_diagnosis', 'is', null)
      .limit(limit);
    const { data: bl } = await this.supabase.from('ai_inference_events')
      .select('top_diagnosis, species, region, created_at')
      .gte('created_at', monthAgo.toISOString()).lt('created_at', weekAgo.toISOString())
      .not('top_diagnosis', 'is', null)
      .limit(limit);
    const cur = (cw ?? []).filter(r => !species || r.species === species);
    const base = (bl ?? []).filter(r => !species || r.species === species);
    const cc = this.agg(cur); const bc = this.agg(base);
    const avg: Record<string, number> = {};
    for (const [k, v] of Object.entries(bc)) avg[k] = v / 3;
    const signals: PopulationSignal[] = [];
    const alerts: OutbreakAlert[] = [];
    for (const [key, count] of Object.entries(cc)) {
      const [disease, sp, reg] = key.split('::');
      if (region && reg !== region) continue;
      const b2 = avg[key] ?? 0.5;
      const as2 = Math.round((count / b2) * 100) / 100;
      const wow = Math.round(((count - b2) / b2) * 100);
      const al = as2 >= 3 ? 'alert' : as2 >= 2 ? 'warning' : as2 >= 1.5 ? 'watch' : 'normal';
      signals.push({ disease, species: sp, region: reg || null, caseCount: count,
        weekOverWeekChange: wow, anomalyScore: as2, isAnomaly: as2 >= 1.5, alertLevel: al });
      if (al !== 'normal' && count >= 3) {
        alerts.push({ disease, species: sp, region: reg || null, caseCount: count,
          anomalyScore: as2, alertLevel: al as 'watch' | 'warning' | 'alert',
          detectedAt: now.toISOString(),
          description: disease + ' in ' + sp + ': ' + wow + '% above baseline this week' + (reg ? ' in ' + reg : '') + '.' });
      }
    }
    const dm: Record<string, number> = {};
    for (const r of cur) { if (r.top_diagnosis) dm[r.top_diagnosis] = (dm[r.top_diagnosis] ?? 0) + 1; }
    const topDiseases = Object.entries(dm).sort(([,a],[,b]) => b-a).slice(0,10).map(([disease, count]) => {
      const bk = Object.keys(bc).find(k => k.startsWith(disease + '::'));
      const bv = bk ? (avg[bk] ?? 0) : 0;
      const trend = count > bv*1.1 ? 'rising' : count < bv*0.9 ? 'falling' : 'stable';
      return { disease, count, trend } as { disease: string; count: number; trend: 'rising' | 'stable' | 'falling' };
    });
    return { signals: signals.sort((a,b) => b.anomalyScore-a.anomalyScore),
      outbreakAlerts: alerts.sort((a,b) => b.anomalyScore-a.anomalyScore),
      totalCasesThisWeek: cur.length, topDiseases, generatedAt: now.toISOString() };
  }

  async getAccuracyScorecard(): Promise<Array<{
    species: string; diagnosis: string; totalInferences: number; confirmedCorrect: number;
    accuracyRate: number; avgConfidence: number;
    sampleSize: 'insufficient' | 'small' | 'adequate' | 'large';
  }>> {
    const { data } = await this.supabase.from('ai_inference_events')
      .select('species, top_diagnosis, confidence_score, outcome_confirmed, confirmed_diagnosis')
      .not('top_diagnosis', 'is', null)
      .limit(500);
    const map: Record<string, { total: number; correct: number; conf: number[] }> = {};
    for (const r of (data ?? [])) {
      const k = r.species + '::' + r.top_diagnosis;
      if (!map[k]) map[k] = { total: 0, correct: 0, conf: [] };
      map[k].total++;
      if (r.outcome_confirmed && r.confirmed_diagnosis === r.top_diagnosis) map[k].correct++;
      if (typeof r.confidence_score === 'number') map[k].conf.push(r.confidence_score);
    }
    return Object.entries(map).filter(([,v]) => v.total >= 3).map(([k, v]) => {
      const [species, diagnosis] = k.split('::');
      const avgConfidence = v.conf.length > 0 ? v.conf.reduce((a,b)=>a+b,0)/v.conf.length : 0;
      const ss = v.total >= 100 ? 'large' : v.total >= 30 ? 'adequate' : v.total >= 10 ? 'small' : 'insufficient';
      return { species, diagnosis, totalInferences: v.total, confirmedCorrect: v.correct,
        accuracyRate: v.correct/v.total, avgConfidence, sampleSize: ss } as {
        species: string; diagnosis: string; totalInferences: number; confirmedCorrect: number;
        accuracyRate: number; avgConfidence: number; sampleSize: 'insufficient' | 'small' | 'adequate' | 'large'; };
    }).sort((a,b) => b.totalInferences-a.totalInferences);
  }

  private agg(rows: Array<{ top_diagnosis?: string | null; species?: string; region?: string | null }>): Record<string,number> {
    const c: Record<string,number> = {};
    for (const r of rows) {
      if (!r.top_diagnosis) continue;
      const k = r.top_diagnosis + '::' + (r.species ?? 'unknown') + '::' + (r.region ?? '');
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }
}

let _epi: PopulationSignalEngine | null = null;
export function getPopulationSignalEngine(): PopulationSignalEngine {
  if (!_epi) _epi = new PopulationSignalEngine();
  return _epi;
}
