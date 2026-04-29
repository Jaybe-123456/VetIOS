// ============================================================
// VetIOS GaaS — Patient-Level Triage Scoring Engine
// Deterministic triage assessment that autonomously decides:
// "This case needs immediate escalation → CRITICAL alert."
// ============================================================

import type { PatientContext } from "../types/agent";

// ─── Triage Levels ───────────────────────────────────────────

export type TriageLevel =
  | "CRITICAL"   // Immediate life threat — alert on-call vet NOW
  | "URGENT"     // Serious but not immediately life-threatening
  | "SEMI_URGENT" // Needs attention within hours
  | "NON_URGENT"  // Routine, can wait
  | "STABLE";     // Monitoring only

// ─── Triage Assessment Output ────────────────────────────────

export interface TriageFactor {
  category: "vitals" | "symptoms" | "labs" | "history" | "age";
  signal: string;
  severity: TriageLevel;
  score: number;           // 0-100 contribution
  detail: string;
}

export interface TriageAssessment {
  level: TriageLevel;
  score: number;            // 0-100 composite severity score
  factors: TriageFactor[];
  recommended_actions: string[];
  requires_immediate_notification: boolean;
  assessed_at: string;
}

// ─── Species Vital Sign Normal Ranges ────────────────────────

interface VitalRange {
  temp_c: { low: number; high: number; critical_low: number; critical_high: number };
  hr_bpm: { low: number; high: number; critical_low: number; critical_high: number };
  rr_brpm: { low: number; high: number; critical_low: number; critical_high: number };
}

const SPECIES_VITALS: Record<string, VitalRange> = {
  canine: {
    temp_c: { low: 38.0, high: 39.2, critical_low: 36.5, critical_high: 41.0 },
    hr_bpm: { low: 60, high: 140, critical_low: 40, critical_high: 200 },
    rr_brpm: { low: 10, high: 30, critical_low: 6, critical_high: 60 },
  },
  feline: {
    temp_c: { low: 38.1, high: 39.2, critical_low: 36.0, critical_high: 41.0 },
    hr_bpm: { low: 140, high: 220, critical_low: 100, critical_high: 280 },
    rr_brpm: { low: 20, high: 30, critical_low: 10, critical_high: 60 },
  },
  equine: {
    temp_c: { low: 37.5, high: 38.5, critical_low: 36.0, critical_high: 40.5 },
    hr_bpm: { low: 28, high: 44, critical_low: 20, critical_high: 80 },
    rr_brpm: { low: 8, high: 16, critical_low: 4, critical_high: 40 },
  },
  bovine: {
    temp_c: { low: 38.0, high: 39.5, critical_low: 36.5, critical_high: 41.5 },
    hr_bpm: { low: 40, high: 80, critical_low: 30, critical_high: 120 },
    rr_brpm: { low: 10, high: 30, critical_low: 6, critical_high: 50 },
  },
};

// Default for unknown species
const DEFAULT_VITALS: VitalRange = SPECIES_VITALS.canine;

// ─── Critical Symptom Keywords ───────────────────────────────

const CRITICAL_SYMPTOMS: ReadonlyArray<{ pattern: RegExp; score: number; label: string }> = [
  { pattern: /seizur|convuls|status.?epilepticus/i, score: 95, label: "Active seizure / status epilepticus" },
  { pattern: /cardiac.?arrest|cpr|asystol/i, score: 100, label: "Cardiac arrest" },
  { pattern: /collaps|unresponsive|coma|obtund/i, score: 90, label: "Collapse / unresponsive" },
  { pattern: /dyspn[eo]|respiratory.?distress|cannot.?breathe|cyanosis|cyanotic/i, score: 90, label: "Severe respiratory distress" },
  { pattern: /hemorrhag|massive.?bleed|exsanguinat/i, score: 90, label: "Active hemorrhage" },
  { pattern: /gdv|gastric.?dilat|bloat.*tors/i, score: 95, label: "GDV / gastric torsion" },
  { pattern: /toxin|poison|toxic.?ingest|antifreeze|xylitol|chocolate.?toxicosis/i, score: 85, label: "Toxin ingestion" },
  { pattern: /anaphylax|severe.?allerg/i, score: 90, label: "Anaphylaxis" },
  { pattern: /trauma|hit.?by.?car|hbc|fall.?from|crush/i, score: 80, label: "Major trauma" },
  { pattern: /dystocia|cannot.?deliver|obstructed.?labor/i, score: 85, label: "Dystocia" },
  { pattern: /urethral.?obstruct|cannot.?urinat|blocked.?cat/i, score: 85, label: "Urethral obstruction" },
  { pattern: /prolaps|organ.?prolaps/i, score: 80, label: "Organ prolapse" },
  { pattern: /snake.?bite|envenomation/i, score: 80, label: "Envenomation" },
  { pattern: /heat.?stroke|hypertherm/i, score: 85, label: "Heatstroke" },
  { pattern: /hypotherm/i, score: 75, label: "Hypothermia" },
];

const URGENT_SYMPTOMS: ReadonlyArray<{ pattern: RegExp; score: number; label: string }> = [
  { pattern: /vomit.*blood|hematemesis/i, score: 65, label: "Hematemesis" },
  { pattern: /bloody.?diarr|hematochezia|melen/i, score: 60, label: "Bloody stool" },
  { pattern: /persist.*vomit|intractable.*vomit/i, score: 55, label: "Persistent vomiting" },
  { pattern: /lethargy|weak|lethargic/i, score: 40, label: "Lethargy / weakness" },
  { pattern: /dehydrat/i, score: 45, label: "Dehydration" },
  { pattern: /pain|distress|crying|whimper/i, score: 50, label: "Acute pain" },
  { pattern: /limping|lameness|non.?weight/i, score: 35, label: "Acute lameness" },
  { pattern: /eye.?injury|proptosis|corneal/i, score: 55, label: "Eye injury / proptosis" },
  { pattern: /foreign.?body|swallow/i, score: 50, label: "Foreign body ingestion" },
  { pattern: /fever|pyrexia/i, score: 45, label: "Fever" },
];

// ─── Lab Critical Thresholds ─────────────────────────────────

interface LabThreshold {
  key: string;
  critical_low?: number;
  critical_high?: number;
  label: string;
  score: number;
}

const CRITICAL_LABS: LabThreshold[] = [
  { key: "pcv", critical_low: 15, label: "Severe anemia (PCV < 15%)", score: 85 },
  { key: "pcv", critical_high: 65, label: "Severe polycythemia (PCV > 65%)", score: 70 },
  { key: "glucose", critical_low: 40, label: "Severe hypoglycemia (< 40 mg/dL)", score: 90 },
  { key: "glucose", critical_high: 500, label: "Severe hyperglycemia (> 500 mg/dL)", score: 75 },
  { key: "potassium", critical_high: 7.0, label: "Life-threatening hyperkalemia (K+ > 7.0)", score: 95 },
  { key: "potassium", critical_low: 2.5, label: "Severe hypokalemia (K+ < 2.5)", score: 80 },
  { key: "calcium", critical_high: 16, label: "Severe hypercalcemia (Ca > 16 mg/dL)", score: 75 },
  { key: "calcium", critical_low: 6, label: "Severe hypocalcemia (Ca < 6 mg/dL)", score: 80 },
  { key: "bun", critical_high: 120, label: "Critical azotemia (BUN > 120)", score: 75 },
  { key: "creatinine", critical_high: 8, label: "Critical creatinine (> 8 mg/dL)", score: 80 },
  { key: "wbc", critical_low: 1.0, label: "Severe leukopenia (WBC < 1.0)", score: 80 },
  { key: "wbc", critical_high: 50, label: "Marked leukocytosis (WBC > 50K)", score: 65 },
  { key: "platelets", critical_low: 30, label: "Severe thrombocytopenia (PLT < 30K)", score: 80 },
  { key: "lactate", critical_high: 6, label: "Elevated lactate > 6 mmol/L (poor perfusion)", score: 80 },
];

// ─── Triage Scoring Engine ───────────────────────────────────

export class TriageEngine {
  /**
   * Assess a patient and produce a deterministic triage score.
   * This is the core decision function for autonomous escalation.
   */
  assess(patient: PatientContext): TriageAssessment {
    const factors: TriageFactor[] = [];

    // 1. Score symptoms
    this.scoreSymptoms(patient.symptoms, factors);

    // 2. Score vitals
    this.scoreVitals(patient, factors);

    // 3. Score lab values
    this.scoreLabs(patient.metadata, factors);

    // 4. Score age risk
    this.scoreAge(patient, factors);

    // Compute composite score (max-weighted — the worst factor dominates)
    const compositeScore = this.computeComposite(factors);
    const level = this.scoreToLevel(compositeScore);

    const recommended_actions = this.buildRecommendations(level, factors);

    return {
      level,
      score: compositeScore,
      factors,
      recommended_actions,
      requires_immediate_notification: level === "CRITICAL" || level === "URGENT",
      assessed_at: new Date().toISOString(),
    };
  }

  // ─── Symptom Scoring ──────────────────────────────────

  private scoreSymptoms(symptoms: string[], factors: TriageFactor[]): void {
    const symptomsText = symptoms.join(" ").toLowerCase();

    for (const critical of CRITICAL_SYMPTOMS) {
      if (critical.pattern.test(symptomsText)) {
        factors.push({
          category: "symptoms",
          signal: critical.label,
          severity: "CRITICAL",
          score: critical.score,
          detail: `Matched critical symptom pattern: ${critical.label}`,
        });
      }
    }

    for (const urgent of URGENT_SYMPTOMS) {
      if (urgent.pattern.test(symptomsText)) {
        factors.push({
          category: "symptoms",
          signal: urgent.label,
          severity: "URGENT",
          score: urgent.score,
          detail: `Matched urgent symptom pattern: ${urgent.label}`,
        });
      }
    }

    // Multiple symptoms compound severity
    if (symptoms.length >= 4) {
      factors.push({
        category: "symptoms",
        signal: "Multiple concurrent symptoms",
        severity: "SEMI_URGENT",
        score: Math.min(60, symptoms.length * 10),
        detail: `${symptoms.length} concurrent symptoms increase clinical concern.`,
      });
    }
  }

  // ─── Vital Sign Scoring ───────────────────────────────

  private scoreVitals(patient: PatientContext, factors: TriageFactor[]): void {
    const meta = patient.metadata as Record<string, unknown> | undefined;
    if (!meta) return;

    const vitals = (meta.vitals ?? meta) as Record<string, unknown>;
    const speciesNorms = SPECIES_VITALS[patient.species] ?? DEFAULT_VITALS;

    // Temperature
    const temp = this.extractNumeric(vitals, ["temp_c", "temperature", "temp"]);
    if (temp !== null) {
      if (temp <= speciesNorms.temp_c.critical_low || temp >= speciesNorms.temp_c.critical_high) {
        factors.push({
          category: "vitals",
          signal: `Temperature ${temp}°C (critical range)`,
          severity: "CRITICAL",
          score: 85,
          detail: `Species normal: ${speciesNorms.temp_c.low}-${speciesNorms.temp_c.high}°C. Patient: ${temp}°C.`,
        });
      } else if (temp < speciesNorms.temp_c.low || temp > speciesNorms.temp_c.high) {
        factors.push({
          category: "vitals",
          signal: `Temperature ${temp}°C (abnormal)`,
          severity: "URGENT",
          score: 50,
          detail: `Species normal: ${speciesNorms.temp_c.low}-${speciesNorms.temp_c.high}°C. Patient: ${temp}°C.`,
        });
      }
    }

    // Heart rate
    const hr = this.extractNumeric(vitals, ["hr", "heart_rate", "hr_bpm", "pulse"]);
    if (hr !== null) {
      if (hr <= speciesNorms.hr_bpm.critical_low || hr >= speciesNorms.hr_bpm.critical_high) {
        factors.push({
          category: "vitals",
          signal: `Heart rate ${hr} bpm (critical)`,
          severity: "CRITICAL",
          score: 88,
          detail: `Species normal: ${speciesNorms.hr_bpm.low}-${speciesNorms.hr_bpm.high} bpm. Patient: ${hr} bpm.`,
        });
      } else if (hr < speciesNorms.hr_bpm.low || hr > speciesNorms.hr_bpm.high) {
        factors.push({
          category: "vitals",
          signal: `Heart rate ${hr} bpm (abnormal)`,
          severity: "URGENT",
          score: 55,
          detail: `Species normal: ${speciesNorms.hr_bpm.low}-${speciesNorms.hr_bpm.high} bpm.`,
        });
      }
    }

    // Respiratory rate
    const rr = this.extractNumeric(vitals, ["rr", "resp_rate", "rr_brpm", "respiratory_rate"]);
    if (rr !== null) {
      if (rr <= speciesNorms.rr_brpm.critical_low || rr >= speciesNorms.rr_brpm.critical_high) {
        factors.push({
          category: "vitals",
          signal: `Respiratory rate ${rr} brpm (critical)`,
          severity: "CRITICAL",
          score: 87,
          detail: `Species normal: ${speciesNorms.rr_brpm.low}-${speciesNorms.rr_brpm.high} brpm. Patient: ${rr} brpm.`,
        });
      } else if (rr < speciesNorms.rr_brpm.low || rr > speciesNorms.rr_brpm.high) {
        factors.push({
          category: "vitals",
          signal: `Respiratory rate ${rr} brpm (abnormal)`,
          severity: "URGENT",
          score: 50,
          detail: `Species normal: ${speciesNorms.rr_brpm.low}-${speciesNorms.rr_brpm.high} brpm.`,
        });
      }
    }
  }

  // ─── Lab Value Scoring ────────────────────────────────

  private scoreLabs(metadata: Record<string, unknown> | undefined, factors: TriageFactor[]): void {
    if (!metadata) return;
    const labs = (metadata.labs ?? metadata) as Record<string, unknown>;

    for (const threshold of CRITICAL_LABS) {
      const value = this.extractNumeric(labs, [threshold.key]);
      if (value === null) continue;

      if (threshold.critical_low !== undefined && value < threshold.critical_low) {
        factors.push({
          category: "labs",
          signal: threshold.label,
          severity: threshold.score >= 80 ? "CRITICAL" : "URGENT",
          score: threshold.score,
          detail: `${threshold.key} = ${value} (critical threshold: < ${threshold.critical_low})`,
        });
      }
      if (threshold.critical_high !== undefined && value > threshold.critical_high) {
        factors.push({
          category: "labs",
          signal: threshold.label,
          severity: threshold.score >= 80 ? "CRITICAL" : "URGENT",
          score: threshold.score,
          detail: `${threshold.key} = ${value} (critical threshold: > ${threshold.critical_high})`,
        });
      }
    }
  }

  // ─── Age Risk Scoring ─────────────────────────────────

  private scoreAge(patient: PatientContext, factors: TriageFactor[]): void {
    if (patient.age_years === undefined || patient.age_years === null) return;

    // Neonates / very young animals are higher risk
    if (patient.age_years < 0.5) {
      factors.push({
        category: "age",
        signal: "Neonatal / pediatric patient",
        severity: "SEMI_URGENT",
        score: 30,
        detail: `Age ${patient.age_years} years — neonatal patients decompensate rapidly.`,
      });
    }

    // Geriatric patients — species-dependent thresholds
    const geriatricAge = patient.species === "feline" ? 12 : patient.species === "canine" ? 10 : 15;
    if (patient.age_years > geriatricAge) {
      factors.push({
        category: "age",
        signal: "Geriatric patient",
        severity: "NON_URGENT",
        score: 15,
        detail: `Age ${patient.age_years} years — geriatric patients may have reduced reserves.`,
      });
    }
  }

  // ─── Composite Score Calculation ───────────────────────

  private computeComposite(factors: TriageFactor[]): number {
    if (factors.length === 0) return 0;

    // Weighted approach: max factor dominates, but additional factors add 10% each
    const sorted = [...factors].sort((a, b) => b.score - a.score);
    let composite = sorted[0].score;

    for (let i = 1; i < sorted.length; i++) {
      // Each additional factor adds a diminishing contribution
      composite += sorted[i].score * (0.1 / i);
    }

    return Math.min(100, Math.round(composite));
  }

  private scoreToLevel(score: number): TriageLevel {
    if (score >= 80) return "CRITICAL";
    if (score >= 60) return "URGENT";
    if (score >= 40) return "SEMI_URGENT";
    if (score >= 20) return "NON_URGENT";
    return "STABLE";
  }

  // ─── Recommendation Builder ───────────────────────────

  private buildRecommendations(level: TriageLevel, factors: TriageFactor[]): string[] {
    const recommendations: string[] = [];

    switch (level) {
      case "CRITICAL":
        recommendations.push("⛔ IMMEDIATE ESCALATION: Alert on-call veterinarian NOW");
        recommendations.push("Prepare emergency treatment area");
        recommendations.push("Establish IV access and begin fluid resuscitation if indicated");
        if (factors.some(f => f.signal.includes("seizure"))) {
          recommendations.push("Prepare diazepam / midazolam for seizure control");
        }
        if (factors.some(f => f.signal.includes("hemorrhage"))) {
          recommendations.push("Type and crossmatch for potential transfusion");
        }
        if (factors.some(f => f.signal.includes("GDV"))) {
          recommendations.push("NPO, gastric decompression, prepare for surgery");
        }
        break;

      case "URGENT":
        recommendations.push("⚠ Priority case: Notify attending veterinarian");
        recommendations.push("Perform full physical examination within 30 minutes");
        recommendations.push("Obtain baseline diagnostics (CBC, chemistry, urinalysis)");
        break;

      case "SEMI_URGENT":
        recommendations.push("Schedule examination within 2-4 hours");
        recommendations.push("Monitor vitals every 30 minutes until examined");
        break;

      case "NON_URGENT":
        recommendations.push("Schedule routine examination");
        recommendations.push("Provide comfort measures as needed");
        break;

      case "STABLE":
        recommendations.push("Continue monitoring");
        recommendations.push("Schedule follow-up as clinically indicated");
        break;
    }

    return recommendations;
  }

  // ─── Utility ──────────────────────────────────────────

  private extractNumeric(obj: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === "number" && !isNaN(val)) return val;
      if (typeof val === "string") {
        const parsed = parseFloat(val);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return null;
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _triageEngine: TriageEngine | null = null;

export function getTriageEngine(): TriageEngine {
  if (!_triageEngine) _triageEngine = new TriageEngine();
  return _triageEngine;
}
