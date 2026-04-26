/**
 * VetIOS Active Learning Engine - Phase 4
 */
import { getSupabaseServer } from '@/lib/supabaseServer';

export type UncertaintyStrategy = 'least_confident' | 'contradiction' | 'low_outcome_coverage';
export interface ActiveLearningCase {
  inferenceEventId: string; species: string; breed: string | null;
  topDiagnosis: string | null; confidenceScore: number; uncertaintyScore: number;
  uncertaintyReason: string; strategy: UncertaintyStrategy;
  priority: 'critical' | 'high' | 'medium' | 'low'; createdAt: string;
}
export interface ActiveLearningQueue {
  cases: ActiveLearningCase[]; totalUncertain: number;
  coverageGaps: Array<{ species: string; diagnosis: string; confirmedCount: number; needed: number }>;
  generatedAt: string;
}

export class ActiveLearningEngine {
  private supabase = getSupabaseServer();

  async buildQueue(limit = 50): Promise<ActiveLearningQueue> {
    const { data } = await this.supabase.from('ai_inference_events')
      .select('id, species, breed, top_diagnosis, confidence_score, contradiction_score, outcome_confirmed, created_at')
      .eq('outcome_confirmed', false).order('created_at', { ascending: false }).limit(500);
    const cases: ActiveLearningCase[] = [];
    for (const row of (data ?? [])) {
      const conf = typeof row.confidence_score === 'number' ? row.confidence_score : 0.5;
      const contra = typeof row.contradiction_score === 'number' ? row.contradiction_score : 0;
      let us = 0; let strat: UncertaintyStrategy = 'least_confident'; let reason = '';
      if (contra >= 0.5) { us = contra; strat = 'contradiction'; reason = 'High contradiction score (' + (contra*100).toFixed(0) + '%)'; }
      else if (conf < 0.65) { us = 1-conf; strat = 'least_confident'; reason = 'Low confidence (' + (conf*100).toFixed(0) + '%)'; }
      else continue;
      const p = us >= 0.8 ? 'critical' : us >= 0.6 ? 'high' : us >= 0.4 ? 'medium' : 'low';
      cases.push({ inferenceEventId: row.id, species: row.species ?? 'unknown', breed: row.breed ?? null,
        topDiagnosis: row.top_diagnosis ?? null, confidenceScore: conf,
        uncertaintyScore: Math.round(us*1000)/1000, uncertaintyReason: reason, strategy: strat,
        priority: p, createdAt: row.created_at });
    }
    const { data: conf2 } = await this.supabase.from('ai_inference_events')
      .select('species, top_diagnosis').eq('outcome_confirmed', true).not('top_diagnosis', 'is', null);
    const cm: Record<string,number> = {};
    for (const r of (conf2 ?? [])) { const k = r.species+'::'+r.top_diagnosis; cm[k]=(cm[k]??0)+1; }
    const coverageGaps = Object.entries(cm).filter(([,c])=>c<10)
      .map(([k,c])=>{ const [species,diagnosis]=k.split('::'); return {species,diagnosis,confirmedCount:c,needed:10-c}; })
      .sort((a,b)=>b.needed-a.needed).slice(0,20);
    return { cases: cases.sort((a,b)=>b.uncertaintyScore-a.uncertaintyScore).slice(0,limit),
      totalUncertain: cases.length, coverageGaps, generatedAt: new Date().toISOString() };
  }

  async autoQueueUncertainCases(): Promise<{ queued: number; skipped: number }> {
    const q = await this.buildQueue(100);
    return { queued: q.cases.filter(c=>c.priority==='critical'||c.priority==='high').length, skipped: 0 };
  }

  async computeImprovementMetrics(): Promise<{
    totalLabeled: number; accuracyBySpecies: Record<string,number>;
    weakestDiagnoses: Array<{ diagnosis: string; accuracyRate: number; sampleSize: number }>;
  }> {
    const { data } = await this.supabase.from('ai_inference_events')
      .select('species, top_diagnosis, outcome_confirmed, confirmed_diagnosis').eq('outcome_confirmed', true);
    const rows = data ?? [];
    const sm: Record<string,{correct:number;total:number}> = {};
    const dm: Record<string,{correct:number;total:number}> = {};
    for (const r of rows) {
      const sp = r.species ?? 'unknown';
      if (!sm[sp]) sm[sp]={correct:0,total:0}; sm[sp].total++;
      if (r.confirmed_diagnosis===r.top_diagnosis) sm[sp].correct++;
      const d = r.top_diagnosis ?? 'unknown';
      if (!dm[d]) dm[d]={correct:0,total:0}; dm[d].total++;
      if (r.confirmed_diagnosis===r.top_diagnosis) dm[d].correct++;
    }
    const abs: Record<string,number> = {};
    for (const [sp,v] of Object.entries(sm)) abs[sp]=v.total>0?v.correct/v.total:0;
    const wd = Object.entries(dm).filter(([,v])=>v.total>=3)
      .map(([d,v])=>({diagnosis:d,accuracyRate:v.correct/v.total,sampleSize:v.total}))
      .sort((a,b)=>a.accuracyRate-b.accuracyRate).slice(0,10);
    return { totalLabeled: rows.length, accuracyBySpecies: abs, weakestDiagnoses: wd };
  }
}

let _al: ActiveLearningEngine | null = null;
export function getActiveLearningEngine(): ActiveLearningEngine {
  if (!_al) _al = new ActiveLearningEngine();
  return _al;
}
