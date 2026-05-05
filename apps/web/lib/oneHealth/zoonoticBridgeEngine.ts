/**
 * VetIOS Tier 2 — Zoonotic Bridge Engine
 *
 * The One Health layer. Takes a confirmed veterinary diagnosis and asks:
 * "Does this pathogen pose a human exposure risk in this region?"
 *
 * Architecture:
 * 1. ZOONOTIC_PATHOGEN_REGISTRY — evidence-based registry of zoonotic pathogens
 *    mapped to risk level, transmission pathway, and WHO notification thresholds.
 * 2. Reads VKG caused_by edges to identify the pathogen for a diagnosis.
 * 3. Computes human exposure risk score from: pathogen risk + regional prevalence
 *    + species (some species are higher-risk amplifier hosts).
 * 4. Writes one_health_signals to Supabase for surveillance aggregation.
 *
 * Connects to:
 *   apps/web/lib/vkg/veterinaryKnowledgeGraph.ts — getVKG(), pathogen nodes
 *   one_health_signals table                      — persisted signals
 *   apps/web/lib/rlhf/rlhfEngine.ts               — called as step 10
 *
 * Scientific basis:
 *   WHO One Health Joint Plan of Action 2022-2026
 *   FAO/OIE/WHO Tripartite Zoonoses Guide 2019
 *   Lancet One Health 2025 — AI-enhanced zoonotic surveillance
 */

import { getVKG } from '@/lib/vkg/veterinaryKnowledgeGraph';
import { getSupabaseServer } from '@/lib/supabaseServer';

// ─── Types ───────────────────────────────────────────────────

export type ZoonoticRiskLevel = 'high' | 'moderate' | 'low' | 'none';
export type ZoonoticPathway =
  | 'direct_contact'   // handling infected animal
  | 'vector'           // tick, mosquito, flea
  | 'foodborne'        // contaminated milk, meat, eggs
  | 'airborne'         // aerosolised secretions
  | 'waterborne'       // contaminated water
  | 'indirect';        // fomites, environment

export interface ZoonoticPathogenProfile {
  pathogenKey: string;           // matches VKG pathogen node id suffix
  label: string;
  riskLevel: ZoonoticRiskLevel;
  pathway: ZoonoticPathway;
  hostSpecies: string[];         // animal species that can carry it
  humanCasesReported: boolean;
  whoNotificationThreshold: number;  // animal cases in a week before WHO notification warranted
  description: string;
}

export interface ZoonoticSignalInput {
  tenantId: string;
  inferenceEventId: string | null;
  species: string;
  breed: string | null;
  region: string | null;
  confirmedDiagnosis: string;
}

export interface ZoonoticAssessment {
  isZoonotic: boolean;
  riskLevel: ZoonoticRiskLevel;
  humanExposureRisk: number;     // 0-1
  pathway: ZoonoticPathway | null;
  pathogen: string | null;
  reasoning: string;
}

// ─── Zoonotic Pathogen Registry ───────────────────────────────
// Evidence-based registry. Pathogens are keyed to match VKG node id suffixes.
// e.g. VKG node 'pathogen:leptospira_spp' → key 'leptospira_spp'

export const ZOONOTIC_PATHOGEN_REGISTRY: Record<string, ZoonoticPathogenProfile> = {
  // ── High risk ──────────────────────────────────────────────
  leptospira_spp: {
    pathogenKey: 'leptospira_spp',
    label: 'Leptospira spp.',
    riskLevel: 'high',
    pathway: 'waterborne',
    hostSpecies: ['canine', 'bovine', 'rodent', 'equine'],
    humanCasesReported: true,
    whoNotificationThreshold: 3,
    description: 'Leptospirosis — major zoonosis via urine-contaminated water. High risk in tropics.',
  },
  rabies_virus: {
    pathogenKey: 'rabies_virus',
    label: 'Rabies Virus',
    riskLevel: 'high',
    pathway: 'direct_contact',
    hostSpecies: ['canine', 'feline', 'equine', 'bovine'],
    humanCasesReported: true,
    whoNotificationThreshold: 1,
    description: 'Rabies — 100% fatal zoonosis. Single animal case warrants immediate action.',
  },
  brucella_spp: {
    pathogenKey: 'brucella_spp',
    label: 'Brucella spp.',
    riskLevel: 'high',
    pathway: 'direct_contact',
    hostSpecies: ['bovine', 'canine', 'equine', 'caprine'],
    humanCasesReported: true,
    whoNotificationThreshold: 2,
    description: 'Brucellosis — undulant fever in humans. High risk for vets and abattoir workers.',
  },
  newcastle_disease_virus: {
    pathogenKey: 'newcastle_disease_virus',
    label: 'Newcastle Disease Virus (NDV)',
    riskLevel: 'moderate',
    pathway: 'direct_contact',
    hostSpecies: ['avian'],
    humanCasesReported: true,
    whoNotificationThreshold: 5,
    description: 'NDV — causes conjunctivitis in poultry workers. Not fatal in humans.',
  },
  staphylococcus_aureus: {
    pathogenKey: 'staphylococcus_aureus',
    label: 'Staphylococcus aureus',
    riskLevel: 'moderate',
    pathway: 'direct_contact',
    hostSpecies: ['bovine', 'canine', 'feline'],
    humanCasesReported: true,
    whoNotificationThreshold: 10,
    description: 'S. aureus — MRSA strains transmissible between animals and humans.',
  },
  // ── Moderate risk ──────────────────────────────────────────
  bordetella_bronchiseptica: {
    pathogenKey: 'bordetella_bronchiseptica',
    label: 'Bordetella bronchiseptica',
    riskLevel: 'low',
    pathway: 'airborne',
    hostSpecies: ['canine', 'feline'],
    humanCasesReported: true,
    whoNotificationThreshold: 20,
    description: 'Kennel cough pathogen. Rare human cases in immunocompromised individuals.',
  },
  streptococcus_uberis: {
    pathogenKey: 'streptococcus_uberis',
    label: 'Streptococcus uberis',
    riskLevel: 'low',
    pathway: 'foodborne',
    hostSpecies: ['bovine'],
    humanCasesReported: false,
    whoNotificationThreshold: 50,
    description: 'Bovine mastitis pathogen. Limited human zoonotic risk via raw milk.',
  },
  feline_coronavirus: {
    pathogenKey: 'feline_coronavirus',
    label: 'Feline Coronavirus (FCoV)',
    riskLevel: 'low',
    pathway: 'direct_contact',
    hostSpecies: ['feline'],
    humanCasesReported: false,
    whoNotificationThreshold: 100,
    description: 'FIP-associated coronavirus. Not currently zoonotic but monitored.',
  },
  // ── High-priority surveillance (emerging) ──────────────────
  e_coli_bovine: {
    pathogenKey: 'e_coli_bovine',
    label: 'E. coli (Bovine)',
    riskLevel: 'moderate',
    pathway: 'foodborne',
    hostSpecies: ['bovine'],
    humanCasesReported: true,
    whoNotificationThreshold: 5,
    description: 'STEC O157:H7 strains — haemolytic uraemic syndrome risk in humans.',
  },
  chlamydophila_felis: {
    pathogenKey: 'chlamydophila_felis',
    label: 'Chlamydophila felis',
    riskLevel: 'low',
    pathway: 'direct_contact',
    hostSpecies: ['feline'],
    humanCasesReported: true,
    whoNotificationThreshold: 30,
    description: 'Feline chlamydiosis — rare conjunctivitis in immunocompromised humans.',
  },
};

// ─── Amplifier species risk multiplier ───────────────────────
// Some species are more efficient zoonotic amplifiers.
const SPECIES_AMPLIFIER_FACTOR: Record<string, number> = {
  bovine: 1.4,    // large reservoir, food chain exposure
  canine: 1.3,    // close human contact
  avian: 1.5,     // influenza risk, high exposure in poultry workers
  equine: 1.1,
  feline: 0.9,
  caprine: 1.2,
  porcine: 1.4,
};

// ─── ISO week helper ──────────────────────────────────────────
function getIsoWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ─── Zoonotic Bridge Engine ───────────────────────────────────

export class ZoonoticBridgeEngine {
  private supabase = getSupabaseServer();

  /**
   * Assess zoonotic risk for a confirmed diagnosis.
   * Called by RLHFEngine step 10 on every confirmed outcome.
   */
  async assess(input: ZoonoticSignalInput): Promise<ZoonoticAssessment> {
    // Step 1: Find pathogen from VKG caused_by edges
    const vkg = getVKG();
    const diagnosisKey = `disease:${input.confirmedDiagnosis.toLowerCase().replace(/\s+/g, '_')}`;
    const pathogens = vkg.neighbours(diagnosisKey, 'caused_by');

    let matchedProfile: ZoonoticPathogenProfile | null = null;
    let matchedPathogen: string | null = null;

    for (const pathogenNode of pathogens) {
      const pathogenSuffix = pathogenNode.id.replace('pathogen:', '');
      const profile = ZOONOTIC_PATHOGEN_REGISTRY[pathogenSuffix];
      if (profile) {
        // Take highest risk profile if multiple pathogens
        if (!matchedProfile || riskRank(profile.riskLevel) > riskRank(matchedProfile.riskLevel)) {
          matchedProfile = profile;
          matchedPathogen = pathogenNode.label;
        }
      }
    }

    if (!matchedProfile) {
      return {
        isZoonotic: false,
        riskLevel: 'none',
        humanExposureRisk: 0,
        pathway: null,
        pathogen: null,
        reasoning: `No zoonotic pathogen identified in VKG for ${input.confirmedDiagnosis}.`,
      };
    }

    // Step 2: Compute exposure risk score
    const baseRisk = { high: 0.85, moderate: 0.50, low: 0.20, none: 0 }[matchedProfile.riskLevel];
    const amplifier = SPECIES_AMPLIFIER_FACTOR[input.species] ?? 1.0;
    const humanExposureRisk = Math.min(baseRisk * amplifier, 1.0);

    const assessment: ZoonoticAssessment = {
      isZoonotic: true,
      riskLevel: matchedProfile.riskLevel,
      humanExposureRisk,
      pathway: matchedProfile.pathway,
      pathogen: matchedPathogen,
      reasoning: `${matchedPathogen} identified via VKG caused_by edge. ` +
        `${matchedProfile.description} ` +
        `Species amplifier (${input.species}): ×${amplifier}. ` +
        `Human exposure risk: ${(humanExposureRisk * 100).toFixed(0)}%.`,
    };

    // Step 3: Write signal (non-blocking)
    void this.writeSignal(input, assessment);

    return assessment;
  }

  /**
   * Check if a region+pathogen combination has crossed WHO notification threshold.
   * Called by OutbreakSurveillanceService during weekly sweeps.
   */
  async checkWhoThreshold(
    pathogenKey: string,
    region: string | null,
    isoWeek: string
  ): Promise<{ thresholdCrossed: boolean; caseCount: number; threshold: number }> {
    const profile = ZOONOTIC_PATHOGEN_REGISTRY[pathogenKey];
    if (!profile) return { thresholdCrossed: false, caseCount: 0, threshold: 999 };

    const query = this.supabase
      .from('one_health_signals')
      .select('id', { count: 'exact', head: true })
      .eq('pathogen', profile.label)
      .eq('iso_week', isoWeek)
      .eq('is_zoonotic', true);

    if (region) query.eq('region', region);

    const { count } = await query;
    const caseCount = count ?? 0;

    return {
      thresholdCrossed: caseCount >= profile.whoNotificationThreshold,
      caseCount,
      threshold: profile.whoNotificationThreshold,
    };
  }

  /**
   * Get current zoonotic signals for a region and week.
   * Used by OutbreakSurveillanceService for cross-species aggregation.
   */
  async getRegionalSignals(
    region: string | null,
    isoWeek: string,
    riskLevels: ZoonoticRiskLevel[] = ['high', 'moderate']
  ): Promise<Array<{ pathogen: string; species: string; count: number; riskLevel: string }>> {
    const query = this.supabase
      .from('one_health_signals')
      .select('pathogen, species, zoonotic_risk_level')
      .eq('iso_week', isoWeek)
      .eq('is_zoonotic', true)
      .in('zoonotic_risk_level', riskLevels);

    if (region) query.eq('region', region);

    const { data } = await query;
    if (!data) return [];

    // Aggregate counts by pathogen + species
    const agg = new Map<string, { pathogen: string; species: string; count: number; riskLevel: string }>();
    for (const row of data as Array<Record<string, unknown>>) {
      const key = `${row.pathogen}::${row.species}`;
      const existing = agg.get(key);
      if (existing) {
        existing.count++;
      } else {
        agg.set(key, {
          pathogen: String(row.pathogen ?? ''),
          species: String(row.species ?? ''),
          count: 1,
          riskLevel: String(row.zoonotic_risk_level ?? 'low'),
        });
      }
    }

    return Array.from(agg.values()).sort((a, b) => b.count - a.count);
  }

  private async writeSignal(
    input: ZoonoticSignalInput,
    assessment: ZoonoticAssessment
  ): Promise<void> {
    try {
      await this.supabase.from('one_health_signals').insert({
        tenant_id: input.tenantId,
        inference_event_id: input.inferenceEventId,
        species: input.species,
        breed: input.breed,
        region: input.region,
        confirmed_diagnosis: input.confirmedDiagnosis,
        pathogen: assessment.pathogen,
        is_zoonotic: assessment.isZoonotic,
        zoonotic_risk_level: assessment.riskLevel,
        human_exposure_risk: assessment.humanExposureRisk,
        zoonotic_pathway: assessment.pathway,
        iso_week: getIsoWeek(),
        signal_weight: assessment.humanExposureRisk,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[ZoonoticBridgeEngine] writeSignal failed:', err);
    }
  }
}

function riskRank(level: ZoonoticRiskLevel): number {
  return { high: 3, moderate: 2, low: 1, none: 0 }[level];
}

// ─── Singleton ────────────────────────────────────────────────
let _engine: ZoonoticBridgeEngine | null = null;
export function getZoonoticBridgeEngine(): ZoonoticBridgeEngine {
  if (!_engine) _engine = new ZoonoticBridgeEngine();
  return _engine;
}
