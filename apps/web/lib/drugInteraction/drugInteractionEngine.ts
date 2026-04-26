/**
 * VetIOS Drug Interaction Engine
 *
 * Structured pharmacokinetic database for veterinary drug safety.
 * Answers: "Can I give meloxicam and enrofloxacin together to a CKD cat?"
 * with evidence-based pharmacokinetic data, not just flag lists.
 *
 * Wires the query_drug_db tool in GaaS from stub → live engine.
 */

// ─── Types ───────────────────────────────────────────────────

export type InteractionSeverity = 'contraindicated' | 'major' | 'moderate' | 'minor' | 'none';
export type InteractionMechanism =
  | 'pharmacodynamic_synergy'
  | 'pharmacodynamic_antagonism'
  | 'cyp_inhibition'
  | 'protein_binding_displacement'
  | 'renal_toxicity_additive'
  | 'hepatic_toxicity_additive'
  | 'qt_prolongation'
  | 'bleeding_risk_additive'
  | 'nephrotoxicity';

export interface DrugProfile {
  id: string;
  genericName: string;
  brandNames: string[];
  drugClass: string;
  speciesApproved: string[];
  renalExcretion: boolean;       // requires dose reduction in CKD
  hepaticMetabolism: boolean;    // requires dose reduction in liver disease
  proteinBound: boolean;         // displacement interactions possible
  qtProlonging: boolean;
  nsaid: boolean;
  corticosteroid: boolean;
  nephrotoxic: boolean;
  hepatotoxic: boolean;
  contraindicated: ContraIndicationRule[];
  standardDoses: Record<string, DoseRange>; // species → dose
}

export interface ContraIndicationRule {
  condition: string;
  severity: InteractionSeverity;
  species?: string[];
  evidence: string;
  mechanism: string;
}

export interface DoseRange {
  min_mg_per_kg: number;
  max_mg_per_kg: number;
  frequency: string;
  route: string;
  notes?: string;
}

export interface DrugInteractionResult {
  drug1: string;
  drug2: string;
  severity: InteractionSeverity;
  mechanism: InteractionMechanism;
  clinicalEffect: string;
  managementRecommendation: string;
  evidence: 'published_study' | 'case_report' | 'pharmacokinetic' | 'theoretical';
  speciesRelevant: boolean;
  references: string[];
}

export interface DrugCheckRequest {
  drugs: string[];           // drug generic names or IDs
  species: string;
  conditions?: string[];     // active patient conditions
  age_years?: number | null;
  weight_kg?: number | null;
}

export interface DrugCheckResult {
  safeToAdminister: boolean;
  overallRisk: InteractionSeverity;
  interactions: DrugInteractionResult[];
  contraindications: Array<{
    drug: string;
    condition: string;
    severity: InteractionSeverity;
    evidence: string;
  }>;
  doseRecommendations: Record<string, DoseRange | null>;
  clinicalSummary: string;
  requiresVetReview: boolean;
}

// ─── Drug Database ────────────────────────────────────────────

const DRUG_DATABASE: Record<string, DrugProfile> = {
  meloxicam: {
    id: 'meloxicam',
    genericName: 'Meloxicam',
    brandNames: ['Metacam', 'Meloxidyl'],
    drugClass: 'NSAID',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: true,
    hepaticMetabolism: true,
    proteinBound: true,
    qtProlonging: false,
    nsaid: true,
    corticosteroid: false,
    nephrotoxic: true,
    hepatotoxic: false,
    contraindicated: [
      { condition: 'renal_impairment', severity: 'contraindicated', species: ['feline'], evidence: 'CKD cats have reduced renal blood flow; NSAIDs further impair GFR via prostaglandin inhibition', mechanism: 'Inhibits prostaglandin-mediated renal afferent arteriole dilation' },
      { condition: 'gi_ulceration', severity: 'major', evidence: 'COX-1 inhibition reduces mucosal prostaglandin synthesis', mechanism: 'COX-1 inhibition' },
      { condition: 'bleeding_disorder', severity: 'major', evidence: 'COX-1 inhibition impairs platelet thromboxane A2 synthesis', mechanism: 'Antiplatelet effect via COX-1' },
      { condition: 'dehydration', severity: 'major', evidence: 'NSAIDs in dehydrated patients dramatically increase acute kidney injury risk', mechanism: 'Renal hypoperfusion + prostaglandin blockade' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 0.05, max_mg_per_kg: 0.05, frequency: 'q24h', route: 'PO', notes: 'Max 5 days; avoid in CKD' },
      canine: { min_mg_per_kg: 0.1, max_mg_per_kg: 0.2, frequency: 'q24h', route: 'PO/SC' },
    },
  },

  enrofloxacin: {
    id: 'enrofloxacin',
    genericName: 'Enrofloxacin',
    brandNames: ['Baytril'],
    drugClass: 'Fluoroquinolone antibiotic',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: true,
    hepaticMetabolism: true,
    proteinBound: false,
    qtProlonging: true,
    nsaid: false,
    corticosteroid: false,
    nephrotoxic: false,
    hepatotoxic: false,
    contraindicated: [
      { condition: 'juvenile', severity: 'major', species: ['canine'], evidence: 'Fluoroquinolones cause cartilage damage in growing dogs', mechanism: 'Chelation of divalent cations in cartilage matrix' },
      { condition: 'seizure_disorder', severity: 'major', evidence: 'Fluoroquinolones lower seizure threshold via GABA-A receptor antagonism', mechanism: 'GABA-A antagonism' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 5, max_mg_per_kg: 5, frequency: 'q24h', route: 'PO', notes: 'Max 5 mg/kg/day; higher doses cause retinal degeneration' },
      canine: { min_mg_per_kg: 5, max_mg_per_kg: 20, frequency: 'q24h', route: 'PO/IV' },
    },
  },

  prednisolone: {
    id: 'prednisolone',
    genericName: 'Prednisolone',
    brandNames: ['Deltasolone'],
    drugClass: 'Corticosteroid',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: false,
    hepaticMetabolism: true,
    proteinBound: true,
    qtProlonging: false,
    nsaid: false,
    corticosteroid: true,
    nephrotoxic: false,
    hepatotoxic: true,
    contraindicated: [
      { condition: 'diabetes', severity: 'major', evidence: 'Glucocorticoids cause insulin resistance and hyperglycaemia', mechanism: 'Gluconeogenesis upregulation, insulin resistance' },
      { condition: 'gi_ulceration', severity: 'major', evidence: 'Reduces mucosal prostaglandin synthesis and mucus production', mechanism: 'Phospholipase A2 inhibition' },
      { condition: 'systemic_infection', severity: 'major', evidence: 'Immunosuppression may worsen bacterial/fungal infections', mechanism: 'T-cell and macrophage suppression' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 1, max_mg_per_kg: 2, frequency: 'q12h-q24h', route: 'PO', notes: 'Immunosuppressive: 2-4 mg/kg/day' },
      canine: { min_mg_per_kg: 0.5, max_mg_per_kg: 2, frequency: 'q12h-q24h', route: 'PO' },
    },
  },

  furosemide: {
    id: 'furosemide',
    genericName: 'Furosemide',
    brandNames: ['Lasix'],
    drugClass: 'Loop diuretic',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: true,
    hepaticMetabolism: false,
    proteinBound: true,
    qtProlonging: false,
    nsaid: false,
    corticosteroid: false,
    nephrotoxic: false,
    hepatotoxic: false,
    contraindicated: [
      { condition: 'hypoadrenocorticism', severity: 'major', evidence: "Diuresis worsens Addisonian electrolyte crisis", mechanism: 'Sodium/potassium wasting exacerbates hyperkalaemia' },
      { condition: 'dehydration', severity: 'contraindicated', evidence: 'Will worsen prerenal azotaemia', mechanism: 'Volume depletion' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 1, max_mg_per_kg: 4, frequency: 'q8-12h', route: 'PO/IV/IM' },
      canine: { min_mg_per_kg: 2, max_mg_per_kg: 6, frequency: 'q8-12h', route: 'PO/IV/IM' },
    },
  },

  benazepril: {
    id: 'benazepril',
    genericName: 'Benazepril',
    brandNames: ['Fortekor'],
    drugClass: 'ACE Inhibitor',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: true,
    hepaticMetabolism: true,
    proteinBound: true,
    qtProlonging: false,
    nsaid: false,
    corticosteroid: false,
    nephrotoxic: false,
    hepatotoxic: false,
    contraindicated: [
      { condition: 'hyperkalaemia', severity: 'major', evidence: 'ACE inhibitors reduce aldosterone and increase potassium retention', mechanism: 'Aldosterone suppression' },
      { condition: 'bilateral_renal_artery_stenosis', severity: 'contraindicated', evidence: 'Can cause acute kidney injury', mechanism: 'Efferent arteriole dilation drops GFR' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 0.5, max_mg_per_kg: 1, frequency: 'q24h', route: 'PO' },
      canine: { min_mg_per_kg: 0.25, max_mg_per_kg: 0.5, frequency: 'q24h', route: 'PO' },
    },
  },
};

// ─── Drug-Drug Interaction Matrix ─────────────────────────────

const DRUG_INTERACTIONS: DrugInteractionResult[] = [
  {
    drug1: 'meloxicam',
    drug2: 'prednisolone',
    severity: 'contraindicated',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Dramatically increased risk of GI ulceration and perforation. Combined COX-1 inhibition (NSAID) + reduced mucosal protection (corticosteroid) synergistically damages GI mucosa.',
    managementRecommendation: 'Do NOT co-administer. Use one or the other. If both needed, implement gastroprotection with omeprazole AND sucralfate and monitor closely.',
    evidence: 'published_study',
    speciesRelevant: true,
    references: ['Lascelles et al. Vet Anaesth Analg 2005', 'KuKanich et al. JAVMA 2012'],
  },
  {
    drug1: 'meloxicam',
    drug2: 'furosemide',
    severity: 'moderate',
    mechanism: 'renal_toxicity_additive',
    clinicalEffect: 'NSAIDs reduce renal prostaglandin-mediated compensation for diuretic-induced volume depletion, increasing risk of AKI.',
    managementRecommendation: 'Avoid in patients with existing renal compromise. Monitor renal values if co-administered. Ensure adequate hydration.',
    evidence: 'pharmacokinetic',
    speciesRelevant: true,
    references: ['Silverstein & Hopper: Small Animal Critical Care Medicine'],
  },
  {
    drug1: 'meloxicam',
    drug2: 'benazepril',
    severity: 'moderate',
    mechanism: 'renal_toxicity_additive',
    clinicalEffect: 'Triple whammy risk: ACE inhibitor dilates efferent arteriole, NSAID removes compensatory afferent arteriole dilation. Elevated AKI risk in dehydrated or CKD patients.',
    managementRecommendation: 'Use with extreme caution in CKD patients. Baseline renal function required. Re-check BUN/Cr within 5-7 days of starting combination.',
    evidence: 'published_study',
    speciesRelevant: true,
    references: ['Hebert et al. Am J Kidney Dis 1996'],
  },
  {
    drug1: 'enrofloxacin',
    drug2: 'furosemide',
    severity: 'minor',
    mechanism: 'qt_prolongation',
    clinicalEffect: 'Both can cause QTc prolongation. Theoretical additive risk of arrhythmia, especially with hypokalaemia from furosemide.',
    managementRecommendation: 'Monitor electrolytes. Correct hypokalaemia before starting fluoroquinolone.',
    evidence: 'theoretical',
    speciesRelevant: true,
    references: [],
  },
  {
    drug1: 'prednisolone',
    drug2: 'furosemide',
    severity: 'moderate',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Corticosteroids promote sodium retention and potassium excretion; furosemide additionally wastes potassium. Risk of hypokalaemia and metabolic alkalosis.',
    managementRecommendation: 'Monitor potassium closely. Consider potassium supplementation. Be alert for muscle weakness (hypokalaemia) in feline patients.',
    evidence: 'published_study',
    speciesRelevant: true,
    references: ['Plumb\'s Veterinary Drug Handbook, 9th Edition'],
  },
  {
    drug1: 'meloxicam',
    drug2: 'enrofloxacin',
    severity: 'moderate',
    mechanism: 'renal_toxicity_additive',
    clinicalEffect: 'Both drugs undergo significant renal excretion. In CKD patients, co-administration increases nephrotoxic burden. Enrofloxacin accumulates in renal failure, increasing retinal degeneration risk in cats. Meloxicam is contraindicated in feline CKD independently. Combined use in CKD cats carries serious risk of acute-on-chronic kidney injury and irreversible retinal degeneration.',
    managementRecommendation: 'AVOID in CKD cats. If both required: (1) Do NOT use meloxicam in CKD cats — consider buprenorphine for analgesia instead. (2) If enrofloxacin essential, dose at 5 mg/kg q24h max and monitor renal values q48-72h. (3) Consider marbofloxacin as safer fluoroquinolone alternative. (4) Recheck BUN/Cr/USG before and 5 days after starting.',
    evidence: 'published_study',
    speciesRelevant: true,
    references: [
      'Wiebe & Hamilton. JAVMA 2002 — enrofloxacin retinal degeneration in cats',
      'Lees et al. Vet J 2004 — NSAID renal safety in cats',
      'Plumb\'s Veterinary Drug Handbook, 9th Edition',
      'ISFM Feline CKD Guidelines 2023',
    ],
  },
  {
    drug1: 'enrofloxacin',
    drug2: 'meloxicam',
    severity: 'moderate',
    mechanism: 'renal_toxicity_additive',
    clinicalEffect: 'See meloxicam + enrofloxacin. Combined renal burden in CKD cats with additional risk of fluoroquinolone-induced retinal degeneration at elevated plasma concentrations.',
    managementRecommendation: 'AVOID in CKD cats. Use buprenorphine instead of meloxicam. If fluoroquinolone needed, monitor renal function closely.',
    evidence: 'published_study',
    speciesRelevant: true,
    references: ['Wiebe & Hamilton. JAVMA 2002', 'ISFM Feline CKD Guidelines 2023'],
  },
];

// ─── Drug Interaction Engine ──────────────────────────────────

export class DrugInteractionEngine {
  private db = DRUG_DATABASE;
  private interactions = DRUG_INTERACTIONS;

  /**
   * Primary public API: check a drug combination for a patient.
   */
  check(request: DrugCheckRequest): DrugCheckResult {
    const { drugs, species, conditions = [], age_years } = request;

    const resolvedDrugs = drugs
      .map((d) => this.resolveDrug(d))
      .filter((d): d is DrugProfile => d !== null);

    if (resolvedDrugs.length === 0) {
      return {
        safeToAdminister: false,
        overallRisk: 'none',
        interactions: [],
        contraindications: [],
        doseRecommendations: {},
        clinicalSummary: `No recognised drugs found for: ${drugs.join(', ')}`,
        requiresVetReview: true,
      };
    }

    // ── Check drug-drug interactions ──
    const interactions: DrugInteractionResult[] = [];
    for (let i = 0; i < resolvedDrugs.length; i++) {
      for (let j = i + 1; j < resolvedDrugs.length; j++) {
        const interaction = this.findInteraction(resolvedDrugs[i].id, resolvedDrugs[j].id);
        if (interaction) interactions.push(interaction);
      }
    }

    // ── Check contraindications ──
    const contraindications: DrugCheckResult['contraindications'] = [];
    for (const drug of resolvedDrugs) {
      // Age-based contraindication
      if (age_years !== null && age_years !== undefined && age_years < 1) {
        conditions.push('juvenile');
      }
      for (const cond of drug.contraindicated) {
        if (conditions.some((c) => cond.condition === c || c.includes(cond.condition))) {
          if (!cond.species || cond.species.includes(species)) {
            contraindications.push({
              drug: drug.genericName,
              condition: cond.condition,
              severity: cond.severity,
              evidence: cond.evidence,
            });
          }
        }
      }
    }

    // ── Dose recommendations ──
    const doseRecommendations: Record<string, DoseRange | null> = {};
    for (const drug of resolvedDrugs) {
      const dose = drug.standardDoses[species] ?? null;
      // Adjust for CKD if renal excretion
      if (dose && drug.renalExcretion && conditions.includes('renal_impairment')) {
        doseRecommendations[drug.genericName] = {
          ...dose,
          notes: (dose.notes ?? '') + ' ⚠ REDUCE DOSE or AVOID: renal impairment detected. Consult specialist.',
        };
      } else {
        doseRecommendations[drug.genericName] = dose;
      }
    }

    // ── Overall risk ──
    const allSeverities = [
      ...interactions.map((i) => i.severity),
      ...contraindications.map((c) => c.severity),
    ];
    const overallRisk = this.highestSeverity(allSeverities);
    const safeToAdminister = overallRisk !== 'contraindicated' && overallRisk !== 'major';
    const requiresVetReview = overallRisk !== 'none' && overallRisk !== 'minor';

    const clinicalSummary = this.buildClinicalSummary(
      resolvedDrugs,
      interactions,
      contraindications,
      overallRisk,
      species
    );

    return {
      safeToAdminister,
      overallRisk,
      interactions,
      contraindications,
      doseRecommendations,
      clinicalSummary,
      requiresVetReview,
    };
  }

  getDrug(id: string): DrugProfile | null {
    return this.resolveDrug(id);
  }

  // ─── Private Helpers ────────────────────────────────────

  private resolveDrug(nameOrId: string): DrugProfile | null {
    const key = nameOrId.toLowerCase().replace(/\s+/g, '_');
    if (this.db[key]) return this.db[key];
    // Brand name lookup
    for (const drug of Object.values(this.db)) {
      if (drug.brandNames.some((b) => b.toLowerCase() === nameOrId.toLowerCase())) {
        return drug;
      }
    }
    return null;
  }

  private findInteraction(drug1Id: string, drug2Id: string): DrugInteractionResult | null {
    return (
      this.interactions.find(
        (i) =>
          (i.drug1 === drug1Id && i.drug2 === drug2Id) ||
          (i.drug1 === drug2Id && i.drug2 === drug1Id)
      ) ?? null
    );
  }

  private highestSeverity(severities: InteractionSeverity[]): InteractionSeverity {
    const order: InteractionSeverity[] = ['contraindicated', 'major', 'moderate', 'minor', 'none'];
    for (const s of order) {
      if (severities.includes(s)) return s;
    }
    return 'none';
  }

  private buildClinicalSummary(
    drugs: DrugProfile[],
    interactions: DrugInteractionResult[],
    contraindications: DrugCheckResult['contraindications'],
    risk: InteractionSeverity,
    species: string
  ): string {
    const parts: string[] = [];
    parts.push(`Drug combination: ${drugs.map((d) => d.genericName).join(' + ')} in ${species}.`);

    if (contraindications.length > 0) {
      const critical = contraindications.filter((c) => c.severity === 'contraindicated');
      const major = contraindications.filter((c) => c.severity === 'major');
      if (critical.length > 0) {
        parts.push(`⛔ CONTRAINDICATED: ${critical.map((c) => `${c.drug} in ${c.condition}`).join('; ')}.`);
      }
      if (major.length > 0) {
        parts.push(`⚠ Major warnings: ${major.map((c) => `${c.drug} in ${c.condition}`).join('; ')}.`);
      }
    }

    if (interactions.length > 0) {
      const serious = interactions.filter((i) => i.severity === 'contraindicated' || i.severity === 'major');
      if (serious.length > 0) {
        parts.push(`Drug interactions: ${serious.map((i) => `${i.drug1}+${i.drug2} (${i.severity}): ${i.clinicalEffect}`).join(' | ')}.`);
      }
    }

    if (risk === 'none' || risk === 'minor') {
      parts.push('This combination is generally considered safe for administration in this species context.');
    } else if (risk === 'contraindicated') {
      parts.push('Do NOT administer this combination without specialist review.');
    }

    return parts.join(' ');
  }
}


// ─── Singleton ───────────────────────────────────────────────

let _engine: DrugInteractionEngine | null = null;

export function getDrugInteractionEngine(): DrugInteractionEngine {
  if (!_engine) _engine = new DrugInteractionEngine();
  return _engine;
}

// ─── Extended Database Loader ─────────────────────────────────

/**
 * Merges the extended Plumb's-grade database into the engine singleton.
 * Call once at app startup via the drug-interaction API route initialisation.
 */
export async function loadExtendedDrugDatabase(engine: DrugInteractionEngine): Promise<void> {
  try {
    const mod = await import('./data/extendedDrugDatabase');
    engine.mergeExtended(mod.EXTENDED_DRUG_DATABASE, mod.EXTENDED_DRUG_INTERACTIONS);
  } catch (err) {
    console.error('[DrugInteractionEngine] Failed to load extended database:', err);
  }
}
