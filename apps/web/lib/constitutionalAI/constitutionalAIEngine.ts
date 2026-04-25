/**
 * VetIOS Constitutional AI Safety Layer
 *
 * Enforces veterinary safety constraints on all inference outputs.
 * Refuses dangerous drug doses, surfaces uncertainty, refuses recommendations
 * below confidence threshold, and prevents hallucination of non-existent drugs.
 *
 * This is the Anthropic Constitutional AI pattern applied to veterinary medicine.
 * Every inference output passes through this layer before reaching the vet.
 */

// ─── Types ───────────────────────────────────────────────────

export type SafetyDecision = 'pass' | 'flag' | 'block' | 'escalate';

export interface ConstitutionalEvaluation {
  decision: SafetyDecision;
  violations: SafetyViolation[];
  confidenceGate: ConfidenceGateResult;
  doseSafetyChecks: DoseSafetyResult[];
  uncertaintySurface: UncertaintySurface;
  safeOutput: InferenceOutputSafe | null;
  blockedReason?: string;
  requiresHITL: boolean;
}

export interface SafetyViolation {
  rule: string;
  severity: 'critical' | 'major' | 'minor';
  description: string;
  affectedContent: string;
}

export interface ConfidenceGateResult {
  confidenceScore: number;
  threshold: number;
  passed: boolean;
  uncertaintyStatement: string;
}

export interface DoseSafetyResult {
  drug: string;
  species: string;
  recommendedDose: string | null;
  maxSafeDose: string;
  isDangerousDose: boolean;
  reason?: string;
}

export interface UncertaintySurface {
  shouldSurfaceUncertainty: boolean;
  uncertaintyStatement: string;
  alternativeDifferentials: string[];
  recommendedActions: string[];
}

export interface InferenceOutputSafe {
  primary_diagnosis: string | null;
  confidence_score: number;
  differentials: Array<{ diagnosis: string; probability: number }>;
  treatment_recommendations: string[];
  safety_caveats: string[];
  uncertainty_statement: string;
  requires_vet_confirmation: boolean;
  escalation_reason?: string;
}

// ─── Constitutional Rules ─────────────────────────────────────

interface ConstitutionalRule {
  id: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  check: (output: Record<string, unknown>, context: SafetyContext) => SafetyViolation | null;
}

export interface SafetyContext {
  species: string;
  breed?: string | null;
  age_years?: number | null;
  weight_kg?: number | null;
  confidence_score: number;
  raw_output: Record<string, unknown>;
}

// ─── Known Veterinary Drugs (hallucination prevention) ────────

const KNOWN_VET_DRUGS = new Set([
  'meloxicam', 'metacam', 'prednisolone', 'dexamethasone', 'enrofloxacin',
  'baytril', 'amoxicillin', 'amoxicillin-clavulanate', 'clavamox', 'synulox',
  'metronidazole', 'flagyl', 'furosemide', 'lasix', 'benazepril', 'fortekor',
  'amlodipine', 'norvasc', 'atenolol', 'atenolol', 'maropitant', 'cerenia',
  'ondansetron', 'metoclopramide', 'omeprazole', 'sucralfate', 'famotidine',
  'methimazole', 'felimazole', 'radioactive iodine', 'insulin glargine',
  'lantus', 'insulin lente', 'vetsulin', 'caninsulin', 'ciclosporin',
  'atopica', 'oclacitinib', 'apoquel', 'cytopoint', 'lokivetmab',
  'gabapentin', 'pregabalin', 'tramadol', 'buprenorphine', 'buprenex',
  'morphine', 'fentanyl', 'ketamine', 'midazolam', 'diazepam',
  'phenobarbital', 'potassium bromide', 'levetiracetam', 'keppra',
  'doxycycline', 'tetracycline', 'marbofloxacin', 'pradofloxacin',
  'itraconazole', 'fluconazole', 'ketoconazole', 'terbinafine',
  'praziquantel', 'fenbendazole', 'milbemycin', 'ivermectin',
  'selamectin', 'revolution', 'moxidectin', 'imidacloprid',
  'hyaluronidase', 'vitamin k1', 'phytomenadione', 'atropine',
  'epinephrine', 'adrenaline', 'dopamine', 'dobutamine',
  'dexmedetomidine', 'medetomidine', 'acepromazine', 'butorphanol',
]);

// ─── Dose Safety Limits (mg/kg) ──────────────────────────────

const DOSE_SAFETY_LIMITS: Record<string, Record<string, { max: number; unit: string; warning: string }>> = {
  meloxicam: {
    feline: { max: 0.1, unit: 'mg/kg', warning: 'Feline meloxicam max 0.05-0.1 mg/kg; chronic use in CKD cats is contraindicated' },
    canine: { max: 0.2, unit: 'mg/kg', warning: 'Canine meloxicam max 0.2 mg/kg initial, 0.1 mg/kg maintenance' },
  },
  enrofloxacin: {
    feline: { max: 5, unit: 'mg/kg', warning: 'Feline max 5 mg/kg/day; higher doses cause irreversible retinal degeneration' },
    canine: { max: 20, unit: 'mg/kg', warning: 'Canine max 20 mg/kg/day' },
  },
  prednisolone: {
    feline: { max: 4, unit: 'mg/kg', warning: 'Anti-inflammatory: 1-2 mg/kg; immunosuppressive: up to 4 mg/kg' },
    canine: { max: 2, unit: 'mg/kg', warning: 'Anti-inflammatory: 0.5-1 mg/kg; immunosuppressive: up to 2 mg/kg' },
  },
};

// ─── Constitutional Rules Registry ────────────────────────────

const CONSTITUTIONAL_RULES: ConstitutionalRule[] = [
  {
    id: 'no_hallucinated_drugs',
    description: 'Prevent recommendation of non-existent or unrecognised veterinary drugs',
    severity: 'critical',
    check(output, _ctx) {
      const text = JSON.stringify(output).toLowerCase();
      const drugMentions = text.match(/\b([a-z]+(?:cillin|mycin|floxacin|azole|prole|mab|nib|tide|zole)\w*)\b/g) ?? [];
      for (const mention of drugMentions) {
        if (!Array.from(KNOWN_VET_DRUGS).some((d) => mention.includes(d) || d.includes(mention))) {
          if (mention.length > 6) { // Skip short fragments
            return {
              rule: 'no_hallucinated_drugs',
              severity: 'critical',
              description: `Potentially hallucinated drug detected: "${mention}"`,
              affectedContent: mention,
            };
          }
        }
      }
      return null;
    },
  },

  {
    id: 'no_human_only_drugs',
    description: 'Block recommendation of human-only medications dangerous to animals',
    severity: 'critical',
    check(output, ctx) {
      const HUMAN_ONLY_DANGEROUS = [
        'acetaminophen', 'paracetamol', 'tylenol', 'ibuprofen', 'naproxen',
        'aleve', 'aspirin', // dangerous in cats
        'xylitol', 'permethrin', // toxic to cats
      ];
      const text = JSON.stringify(output).toLowerCase();
      for (const drug of HUMAN_ONLY_DANGEROUS) {
        if (text.includes(drug)) {
          const isFeline = ctx.species === 'feline';
          const isAspirin = drug === 'aspirin';
          if (!isAspirin || isFeline) { // Aspirin only blocked for felines
            return {
              rule: 'no_human_only_drugs',
              severity: 'critical',
              description: `Human-only drug potentially toxic to ${ctx.species} detected: ${drug}`,
              affectedContent: drug,
            };
          }
        }
      }
      return null;
    },
  },

  {
    id: 'feline_permethrin_block',
    description: 'Absolutely block permethrin recommendation in feline patients',
    severity: 'critical',
    check(output, ctx) {
      if (ctx.species !== 'feline') return null;
      const text = JSON.stringify(output).toLowerCase();
      if (text.includes('permethrin')) {
        return {
          rule: 'feline_permethrin_block',
          severity: 'critical',
          description: 'CRITICAL: Permethrin is acutely toxic and lethal to cats. Output blocked.',
          affectedContent: 'permethrin',
        };
      }
      return null;
    },
  },

  {
    id: 'no_untested_species_treatment',
    description: 'Flag treatments recommended for species without approved use',
    severity: 'major',
    check(output, ctx) {
      const text = JSON.stringify(output).toLowerCase();
      // Ivermectin is dangerous in MDR1-affected breeds (collies, shelties, etc.)
      if (ctx.species === 'canine' && text.includes('ivermectin')) {
        const ivermectinBreeds = ['collie', 'shetland', 'sheltie', 'aussie', 'australian shepherd', 'border collie'];
        const breed = (ctx.breed ?? '').toLowerCase();
        if (ivermectinBreeds.some((b) => breed.includes(b))) {
          return {
            rule: 'no_untested_species_treatment',
            severity: 'major',
            description: 'Ivermectin in MDR1-susceptible breed: may cause fatal neurotoxicity. MDR1 testing recommended.',
            affectedContent: 'ivermectin',
          };
        }
      }
      return null;
    },
  },

  {
    id: 'no_diagnosis_without_uncertainty',
    description: 'All diagnoses must be accompanied by appropriate uncertainty statements',
    severity: 'minor',
    check(output, ctx) {
      if (ctx.confidence_score < 0.5) {
        const hasUncertainty = JSON.stringify(output).toLowerCase().match(
          /uncertain|differenti|rule out|consider|possible|probable|suspect|recommend further/
        );
        if (!hasUncertainty) {
          return {
            rule: 'no_diagnosis_without_uncertainty',
            severity: 'minor',
            description: 'Low-confidence output lacks appropriate uncertainty statement',
            affectedContent: 'diagnosis statement',
          };
        }
      }
      return null;
    },
  },
];

// ─── Confidence Thresholds ────────────────────────────────────

const CONFIDENCE_THRESHOLDS = {
  PASS: 0.65,        // Full recommendation with standard caveats
  FLAG: 0.40,        // Recommendation with prominent uncertainty
  ESCALATE: 0.25,    // Escalate to HITL
};

// ─── Constitutional AI Engine ─────────────────────────────────

export class ConstitutionalAIEngine {
  /**
   * Primary evaluation function.
   * Every inference output must pass through this before reaching the vet.
   */
  evaluate(
    rawOutput: Record<string, unknown>,
    context: SafetyContext
  ): ConstitutionalEvaluation {
    // ── Constitutional rule checks ──
    const violations: SafetyViolation[] = [];
    for (const rule of CONSTITUTIONAL_RULES) {
      const violation = rule.check(rawOutput, context);
      if (violation) violations.push(violation);
    }

    const criticalViolations = violations.filter((v) => v.severity === 'critical');
    const majorViolations = violations.filter((v) => v.severity === 'major');

    // ── Confidence gate ──
    const confidenceGate = this.evaluateConfidenceGate(context.confidence_score, context.species);

    // ── Dose safety ──
    const doseSafetyChecks = this.checkDoseSafety(rawOutput, context.species);

    // ── Uncertainty surface ──
    const uncertaintySurface = this.buildUncertaintySurface(rawOutput, context);

    // ── Decision tree ──
    let decision: SafetyDecision;
    let blockedReason: string | undefined;

    if (criticalViolations.length > 0) {
      decision = 'block';
      blockedReason = `Critical safety violation: ${criticalViolations.map((v) => v.description).join('; ')}`;
    } else if (!confidenceGate.passed && context.confidence_score < CONFIDENCE_THRESHOLDS.ESCALATE) {
      decision = 'escalate';
    } else if (majorViolations.length > 0 || !confidenceGate.passed || doseSafetyChecks.some((d) => d.isDangerousDose)) {
      decision = 'flag';
    } else {
      decision = 'pass';
    }

    const requiresHITL = decision === 'escalate' || decision === 'block' || doseSafetyChecks.some((d) => d.isDangerousDose);

    // ── Build safe output ──
    const safeOutput = decision !== 'block' ? this.buildSafeOutput(rawOutput, context, confidenceGate, uncertaintySurface, violations, decision) : null;

    return {
      decision,
      violations,
      confidenceGate,
      doseSafetyChecks,
      uncertaintySurface,
      safeOutput,
      blockedReason,
      requiresHITL,
    };
  }

  // ─── Private Methods ─────────────────────────────────────

  private evaluateConfidenceGate(score: number, _species: string): ConfidenceGateResult {
    const threshold = CONFIDENCE_THRESHOLDS.PASS;
    const passed = score >= threshold;

    let uncertaintyStatement = '';
    if (score >= 0.85) {
      uncertaintyStatement = 'High-confidence assessment based on clinical presentation.';
    } else if (score >= 0.65) {
      uncertaintyStatement = 'Moderate confidence. Recommend confirmatory diagnostics before initiating treatment.';
    } else if (score >= 0.40) {
      uncertaintyStatement = 'Low confidence. Multiple differentials remain plausible. Further workup strongly recommended before treatment.';
    } else {
      uncertaintyStatement = 'Insufficient confidence to support a primary diagnosis. Full diagnostic workup required. Do not initiate specific treatment without vet confirmation.';
    }

    return { confidenceScore: score, threshold, passed, uncertaintyStatement };
  }

  private checkDoseSafety(output: Record<string, unknown>, species: string): DoseSafetyResult[] {
    const results: DoseSafetyResult[] = [];
    const text = JSON.stringify(output).toLowerCase();

    for (const [drug, speciesLimits] of Object.entries(DOSE_SAFETY_LIMITS)) {
      if (!text.includes(drug)) continue;
      const limit = speciesLimits[species];
      if (!limit) continue;

      // Extract dose numbers from output text
      const dosePattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*mg/kg.*?${drug}|${drug}.*?(\\d+(?:\\.\\d+)?)\\s*mg/kg`, 'i');
      const match = JSON.stringify(output).match(dosePattern);
      const extractedDose = match ? parseFloat(match[1] ?? match[2]) : null;

      const isDangerousDose = extractedDose !== null && extractedDose > limit.max;

      results.push({
        drug,
        species,
        recommendedDose: extractedDose !== null ? `${extractedDose} mg/kg` : null,
        maxSafeDose: `${limit.max} mg/kg (${limit.unit})`,
        isDangerousDose,
        reason: isDangerousDose ? limit.warning : undefined,
      });
    }

    return results;
  }

  private buildUncertaintySurface(
    _output: Record<string, unknown>,
    context: SafetyContext
  ): UncertaintySurface {
    const shouldSurface = context.confidence_score < CONFIDENCE_THRESHOLDS.PASS;

    const actions: string[] = [];
    const differentials: string[] = [];

    if (context.confidence_score < 0.65) {
      actions.push('Complete blood count and serum biochemistry panel');
      actions.push('Urinalysis with sediment examination');
    }
    if (context.confidence_score < 0.40) {
      actions.push('Radiography (thorax and/or abdomen)');
      actions.push('Specialist referral recommended');
    }

    const uncertaintyStatement = shouldSurface
      ? `VetIOS confidence is ${(context.confidence_score * 100).toFixed(0)}% — below the ${(CONFIDENCE_THRESHOLDS.PASS * 100).toFixed(0)}% threshold for unsupported recommendations. Diagnostic workup required.`
      : '';

    return {
      shouldSurfaceUncertainty: shouldSurface,
      uncertaintyStatement,
      alternativeDifferentials: differentials,
      recommendedActions: actions,
    };
  }

  private buildSafeOutput(
    rawOutput: Record<string, unknown>,
    context: SafetyContext,
    confidenceGate: ConfidenceGateResult,
    uncertaintySurface: UncertaintySurface,
    violations: SafetyViolation[],
    decision: SafetyDecision
  ): InferenceOutputSafe {
    const caveats: string[] = [];

    if (decision === 'flag' || decision === 'escalate') {
      caveats.push(confidenceGate.uncertaintyStatement);
    }

    for (const v of violations.filter((v) => v.severity !== 'critical')) {
      caveats.push(`⚠ ${v.description}`);
    }

    if (uncertaintySurface.shouldSurfaceUncertainty && uncertaintySurface.uncertaintyStatement) {
      caveats.push(uncertaintySurface.uncertaintyStatement);
    }

    const primaryDiagnosis = (rawOutput.top_diagnosis ?? rawOutput.primary_condition_class ?? null) as string | null;
    const differentials = (rawOutput.top_differentials as Array<{ name?: string; diagnosis?: string; confidence?: number; probability?: number }> ?? []).map((d) => ({
      diagnosis: d.name ?? d.diagnosis ?? 'unknown',
      probability: d.confidence ?? d.probability ?? 0,
    }));

    return {
      primary_diagnosis: primaryDiagnosis,
      confidence_score: context.confidence_score,
      differentials,
      treatment_recommendations: [],
      safety_caveats: caveats,
      uncertainty_statement: confidenceGate.uncertaintyStatement,
      requires_vet_confirmation: decision !== 'pass',
      escalation_reason: decision === 'escalate' ? confidenceGate.uncertaintyStatement : undefined,
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────

let _engine: ConstitutionalAIEngine | null = null;

export function getConstitutionalAI(): ConstitutionalAIEngine {
  if (!_engine) _engine = new ConstitutionalAIEngine();
  return _engine;
}
