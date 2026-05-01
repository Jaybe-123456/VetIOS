import {
    getDrugInteractionEngine,
    loadExtendedDrugDatabase,
    type DrugCheckResult,
} from '@/lib/drugInteraction/drugInteractionEngine';
import {
    compactSearchTerms,
    detectSpeciesFromTexts,
    isVetiosSpecies,
    type DetectedVetiosSpecies,
    type VetiosSpecies,
} from '@/lib/askVetios/context';

export type LabelStatus = 'FDA-approved' | 'extra-label' | 'compounded';

interface DoseProfile {
    doseLow: number;
    doseHigh: number;
    doseDisplay?: string;
    route: string;
    frequency: string;
    duration: string;
    onset: string;
    reference: string;
    labelStatus: LabelStatus;
    withdrawalDays: number | null;
    withdrawalNote?: string;
    concentrationMgMl?: number;
}

interface PkProfile {
    bioavailability: string;
    halfLifeHours: number;
    volumeOfDistribution: string;
    proteinBinding: string;
    metabolism: string;
    excretion: string;
    speciesNote: string;
}

interface PharmacoProfile {
    name: string;
    brand: string;
    aliases: RegExp[];
    drugClass: string;
    defaultIndication: string;
    mechanism: string;
    speciesDoses: Partial<Record<VetiosSpecies, DoseProfile>>;
    pk: Partial<Record<VetiosSpecies, PkProfile>> & { default: PkProfile };
    contraindications: string[];
    adverseEffects: string;
    monitoring: string;
    overdoseManagement: string;
    doseAdjustments: string;
    compoundingNote: string;
    clinicalNuance: Partial<Record<VetiosSpecies, string>>;
    alternatives: string[];
}

export interface PharmacOSDrug {
    name: string;
    brand: string;
    class: string;
    indication: string;
    mechanism: string;
    dose_mg_per_kg: number | string;
    dose_range_low: number;
    dose_range_high: number;
    total_dose_mg: number | string;
    dose_calculation: string;
    volume_calculation: string;
    route: string;
    frequency: string;
    duration: string;
    onset_of_action: string;
    reference: string;
    label_status: LabelStatus;
    withdrawal_days: number | null;
    withdrawal_note: string;
    contraindications: string;
    interactions: string;
    adverse_effects: string;
    monitoring: string;
    clinical_commentary: string;
    dose_adjustments: string;
    overdose_management: string;
    compounding_note: string;
    pk: {
        bioavailability: string;
        half_life_hours: number;
        volume_of_distribution: string;
        protein_binding: string;
        metabolism: string;
        excretion: string;
        species_note: string;
    };
}

export interface PharmacOSProtocol {
    species: VetiosSpecies;
    condition: string;
    patient_weight_kg: number;
    protocol_phase: 'complete';
    drugs: PharmacOSDrug[];
    treatment_protocol: {
        phase1_stabilization: string;
        phase2_active_treatment: string;
        phase3_recovery: string;
        fluid_therapy: string;
        nutritional_support: string;
        discharge_criteria: string;
    };
    interaction_warnings: string[];
    total_drugs: number;
    protocol_source: string;
}

export interface BuildPharmacOSInput {
    topic?: string;
    messageContent: string;
    queryText?: string;
    selectedSpecies?: string;
    patientWeightKg?: number;
}

interface DrugCandidateRule {
    name: string;
    drugClass: string;
    patterns: RegExp[];
}

const FOOD_ANIMALS = new Set<VetiosSpecies>(['bovine', 'porcine', 'ovine', 'avian']);

const DRUG_CANDIDATES: DrugCandidateRule[] = [
    { name: 'Amoxicillin', drugClass: 'Beta-lactam antibiotic', patterns: [/\bamoxicillin\b(?![-\s]?clavulanate)/i] },
    { name: 'Amoxicillin-Clavulanate', drugClass: 'Beta-lactam + beta-lactamase inhibitor', patterns: [/\bamoxicillin[-\s]?clavulanate\b/i, /\bclavamox\b/i, /\bsynulox\b/i] },
    { name: 'Ampicillin', drugClass: 'Beta-lactam antibiotic', patterns: [/\bampicillin\b/i] },
    { name: 'Cefazolin', drugClass: 'First-generation cephalosporin', patterns: [/\bcefazolin\b/i] },
    { name: 'Ceftiofur', drugClass: 'Third-generation cephalosporin', patterns: [/\bceftiofur\b/i, /\bnaxcel\b/i, /\bexcede\b/i, /\bexcenel\b/i] },
    { name: 'Cephapirin', drugClass: 'Cephalosporin intramammary antibiotic', patterns: [/\bcephapirin\b/i] },
    { name: 'Doxycycline', drugClass: 'Tetracycline antibiotic', patterns: [/\bdoxycycline\b/i, /\bvibramycin\b/i, /\bronaxan\b/i] },
    { name: 'Enrofloxacin', drugClass: 'Fluoroquinolone antibiotic', patterns: [/\benrofloxacin\b/i, /\bbaytril\b/i] },
    { name: 'Fenbendazole', drugClass: 'Benzimidazole anthelmintic', patterns: [/\bfenbendazole\b/i, /\bpanacur\b/i] },
    { name: 'Flunixin', drugClass: 'NSAID', patterns: [/\bflunixin\b/i, /\bbanamine\b/i] },
    { name: 'Furosemide', drugClass: 'Loop diuretic', patterns: [/\bfurosemide\b/i, /\blasix\b/i] },
    { name: 'Gabapentin', drugClass: 'Alpha-2-delta calcium channel ligand', patterns: [/\bgabapentin\b/i, /\bneurontin\b/i] },
    { name: 'Maropitant', drugClass: 'NK-1 receptor antagonist', patterns: [/\bmaropitant\b/i, /\bcerenia\b/i] },
    { name: 'Meloxicam', drugClass: 'NSAID', patterns: [/\bmeloxicam\b/i, /\bmetacam\b/i] },
    { name: 'Metronidazole', drugClass: 'Nitroimidazole antimicrobial/antiprotozoal', patterns: [/\bmetronidazole\b/i, /\bflagyl\b/i] },
    { name: 'Oxytetracycline', drugClass: 'Tetracycline antibiotic', patterns: [/\boxytetracycline\b/i, /\bla-?200\b/i] },
    { name: 'Penicillin G', drugClass: 'Beta-lactam antibiotic', patterns: [/\bpenicillin(?:\s+g)?\b/i] },
    { name: 'Pirlimycin', drugClass: 'Lincosamide intramammary antibiotic', patterns: [/\bpirlimycin\b/i] },
    { name: 'Prednisolone', drugClass: 'Glucocorticoid', patterns: [/\bprednisolone\b/i, /\bprednisone\b/i] },
    { name: 'Buprenorphine', drugClass: 'Partial mu-opioid agonist', patterns: [/\bbuprenorphine\b/i, /\bbuprenex\b/i, /\bsimbadol\b/i] },
];

const CONDITION_CANDIDATES: Array<{ patterns: RegExp[]; condition: string; drugs: string[] }> = [
    {
        patterns: [/\bfeline panleukopenia\b/i, /\bfpv\b/i],
        condition: 'Feline panleukopenia virus enteritis',
        drugs: ['Maropitant', 'Ampicillin', 'Metronidazole'],
    },
    {
        patterns: [/\bcanine parvo\b/i, /\bparvovirus\b/i, /\bparvoviral\b/i],
        condition: 'Parvoviral enteritis',
        drugs: ['Maropitant', 'Ampicillin', 'Cefazolin', 'Metronidazole'],
    },
    {
        patterns: [/\bglanders\b/i, /\bburkholderia mallei\b/i],
        condition: 'Glanders',
        drugs: ['Doxycycline', 'Enrofloxacin'],
    },
    {
        patterns: [/\bmastitis\b/i],
        condition: 'Mastitis',
        drugs: ['Ceftiofur', 'Cephapirin', 'Pirlimycin', 'Oxytetracycline'],
    },
    {
        patterns: [/\brespiratory\b/i, /\bpneumonia\b/i, /\bshipping fever\b/i, /\bbrd\b/i],
        condition: 'Respiratory disease complex',
        drugs: ['Ceftiofur', 'Oxytetracycline', 'Enrofloxacin'],
    },
    {
        patterns: [/\bdiarrh(?:ea|eic)\b/i, /\benteritis\b/i, /\bgastroenteritis\b/i],
        condition: 'Enteritis',
        drugs: ['Maropitant', 'Metronidazole', 'Ampicillin'],
    },
    {
        patterns: [/\bpain\b/i, /\blameness\b/i, /\barthritis\b/i, /\binflammation\b/i],
        condition: 'Pain or inflammatory disease',
        drugs: ['Meloxicam', 'Flunixin', 'Gabapentin', 'Buprenorphine'],
    },
];

const PK_DEFAULT: PkProfile = {
    bioavailability: 'Route-dependent; verify formulation-specific data.',
    halfLifeHours: 0,
    volumeOfDistribution: 'Formulation- and species-dependent.',
    proteinBinding: 'Not fully specified in the local VetIOS profile.',
    metabolism: 'Verify hepatic/renal contribution before prescribing.',
    excretion: 'Verify product-specific clearance.',
    speciesNote: 'Clinician verification required before translating decision support into an order.',
};

const SMALL_ANIMAL_ANTIBIOTIC_PK: PkProfile = {
    bioavailability: 'Good after oral administration for susceptible formulations; parenteral routes bypass absorption variability.',
    halfLifeHours: 1.5,
    volumeOfDistribution: '0.2-0.4 L/kg',
    proteinBinding: 'Low to moderate',
    metabolism: 'Limited hepatic metabolism; beta-lactams are primarily time-dependent antimicrobials.',
    excretion: 'Primarily renal tubular secretion and glomerular filtration.',
    speciesNote: 'Adjust interval in meaningful renal impairment; maintain time above MIC for severe infections.',
};

const FORMULARY: Record<string, PharmacoProfile> = {
    amoxicillin: {
        name: 'Amoxicillin',
        brand: 'Amoxi-Tabs, generic',
        aliases: [/\bamoxicillin\b/i],
        drugClass: 'Aminopenicillin beta-lactam antibiotic',
        defaultIndication: 'Susceptible bacterial infection when culture or syndrome supports aminopenicillin coverage.',
        mechanism: 'Binds bacterial penicillin-binding proteins and inhibits peptidoglycan cross-linking. The effect is bactericidal and time-dependent against susceptible organisms.',
        speciesDoses: {
            canine: dose(10, 20, 'PO', 'q12h', '7-14 days or culture-directed', "PLUMB'S 10th Ed", 'extra-label'),
            feline: dose(10, 20, 'PO', 'q12h', '7-14 days or culture-directed', "PLUMB'S 10th Ed", 'extra-label'),
        },
        pk: { default: SMALL_ANIMAL_ANTIBIOTIC_PK },
        contraindications: ['Beta-lactam hypersensitivity', 'Avoid oral use when vomiting prevents absorption'],
        adverseEffects: 'GI upset, hypersensitivity reactions, injection discomfort with parenteral formulations.',
        monitoring: 'Clinical response within 48-72h, temperature, WBC trend, culture/susceptibility if infection is serious or recurrent.',
        overdoseManagement: 'GI signs are most common; stop drug, provide supportive care, manage hypersensitivity immediately if present.',
        doseAdjustments: 'Renal impairment: extend interval in moderate-severe renal dysfunction. Hepatic impairment: usually no primary adjustment. Neonates/geriatrics: monitor hydration and renal function.',
        compoundingNote: 'Use commercial veterinary or human formulation where appropriate; compounded suspensions require beyond-use dating and stability review.',
        clinicalNuance: {},
        alternatives: ['Ampicillin', 'Amoxicillin-Clavulanate', 'Cephalexin'],
    },
    'amoxicillin-clavulanate': {
        name: 'Amoxicillin-Clavulanate',
        brand: 'Clavamox, Synulox',
        aliases: [/\bamoxicillin[-\s]?clavulanate\b/i, /\bclavamox\b/i, /\bsynulox\b/i],
        drugClass: 'Aminopenicillin plus beta-lactamase inhibitor',
        defaultIndication: 'Skin, soft tissue, oral, urinary, and mixed aerobic/anaerobic infections where beta-lactamase production is plausible.',
        mechanism: 'Amoxicillin inhibits bacterial cell-wall synthesis while clavulanate inhibits many beta-lactamases. The combination restores activity against susceptible beta-lactamase-producing bacteria.',
        speciesDoses: {
            canine: dose(12.5, 25, 'PO', 'q12h', '7-14 days or culture-directed', "PLUMB'S 10th Ed / BSAVA 11th Ed", 'extra-label'),
            feline: dose(12.5, 25, 'PO', 'q12h', '7-14 days or culture-directed', "PLUMB'S 10th Ed / BSAVA 11th Ed", 'extra-label'),
        },
        pk: { default: SMALL_ANIMAL_ANTIBIOTIC_PK },
        contraindications: ['Beta-lactam hypersensitivity', 'Use caution in severe renal impairment'],
        adverseEffects: 'Vomiting, diarrhea, anorexia, hypersensitivity reactions.',
        monitoring: 'Clinical response in 48-72h, hydration, GI tolerance, culture results when available.',
        overdoseManagement: 'Supportive care for GI signs; treat anaphylaxis as an emergency.',
        doseAdjustments: 'Renal impairment: extend interval in CKD stage 3-4. Hepatic impairment: monitor if prolonged course because clavulanate can rarely affect liver enzymes.',
        compoundingNote: 'Commercial veterinary tablets/suspensions preferred; compounded products need stability confirmation.',
        clinicalNuance: {},
        alternatives: ['Amoxicillin', 'Cefazolin', 'Clindamycin'],
    },
    ampicillin: {
        name: 'Ampicillin',
        brand: 'Polyflex, generic',
        aliases: [/\bampicillin\b/i],
        drugClass: 'Aminopenicillin beta-lactam antibiotic',
        defaultIndication: 'Parenteral coverage for susceptible Gram-positive, anaerobic, and selected Gram-negative infections; common supportive antimicrobial in severe viral enteritis with bacterial translocation risk.',
        mechanism: 'Inhibits bacterial cell-wall synthesis by binding penicillin-binding proteins. Bactericidal activity depends on maintaining plasma concentrations above the MIC.',
        speciesDoses: {
            canine: dose(10, 20, 'IV/IM/SC', 'q6-8h', '3-7 days then culture-directed transition', "PLUMB'S 10th Ed / Merck VMM", 'extra-label', undefined, 250),
            feline: dose(10, 20, 'IV/SC', 'q8h', '3-7 days then culture-directed transition', 'Merck VMM / ABCD FPV Guidelines', 'extra-label', undefined, 250),
            bovine: dose(5, 10, 'IM/SC', 'q12h', '3-5 days; product-label dependent', 'FDA-label where product/species/indication match', 'FDA-approved', 'Product-specific meat/milk withdrawal required via FARAD'),
        },
        pk: {
            default: SMALL_ANIMAL_ANTIBIOTIC_PK,
            feline: { ...SMALL_ANIMAL_ANTIBIOTIC_PK, speciesNote: 'Useful parenteral option in vomiting/dehydrated cats because oral absorption is bypassed.' },
        },
        contraindications: ['Beta-lactam hypersensitivity', 'Avoid oral extrapolation in ruminants with functional forestomach unless label-supported'],
        adverseEffects: 'GI dysbiosis, hypersensitivity, injection-site discomfort; high oral exposure may disrupt ruminant flora.',
        monitoring: 'Temperature, neutrophil count, hydration/perfusion, renal values if azotemic, culture/susceptibility when possible.',
        overdoseManagement: 'Stop drug for hypersensitivity or severe GI signs; supportive care and emergency anaphylaxis treatment if needed.',
        doseAdjustments: 'Renal impairment: extend interval in moderate-severe renal disease. Hepatic impairment: usually no primary adjustment. Neonates: extend interval because renal clearance is immature.',
        compoundingNote: 'Reconstituted injectable concentration varies by product; calculate volume from the actual vial concentration.',
        clinicalNuance: { bovine: 'Food-animal use requires label and FARAD withdrawal verification.' },
        alternatives: ['Cefazolin', 'Amoxicillin-Clavulanate', 'Ceftiofur'],
    },
    cefazolin: {
        name: 'Cefazolin',
        brand: 'Ancef, generic',
        aliases: [/\bcefazolin\b/i],
        drugClass: 'First-generation cephalosporin antibiotic',
        defaultIndication: 'Parenteral perioperative or severe soft-tissue Gram-positive coverage; sometimes used in hospitalized enteritis patients for bacterial translocation risk.',
        mechanism: 'Inhibits bacterial cell-wall synthesis through penicillin-binding protein binding. It is bactericidal and time-dependent.',
        speciesDoses: {
            canine: dose(22, 22, 'IV/IM', 'q8h', 'Perioperative single dose or 3-5 days for active infection', "PLUMB'S 10th Ed / BSAVA 11th Ed", 'extra-label', undefined, 100),
            feline: dose(22, 22, 'IV/IM', 'q8h', 'Perioperative single dose or 3-5 days for active infection', "PLUMB'S 10th Ed / BSAVA 11th Ed", 'extra-label', undefined, 100),
        },
        pk: { default: { ...SMALL_ANIMAL_ANTIBIOTIC_PK, halfLifeHours: 1.2, speciesNote: 'Short half-life supports repeated dosing for time-dependent efficacy.' } },
        contraindications: ['Cephalosporin or severe beta-lactam hypersensitivity'],
        adverseEffects: 'Vomiting, diarrhea, injection discomfort, hypersensitivity reactions.',
        monitoring: 'Temperature, WBC trend, renal function in compromised patients, culture if infection persists.',
        overdoseManagement: 'Supportive care; manage hypersensitivity immediately.',
        doseAdjustments: 'Renal impairment: extend interval in severe renal dysfunction. Hepatic impairment: usually no primary adjustment.',
        compoundingNote: 'Use reconstituted injectable according to product stability and sterility limits.',
        clinicalNuance: {},
        alternatives: ['Ampicillin', 'Amoxicillin-Clavulanate'],
    },
    ceftiofur: {
        name: 'Ceftiofur',
        brand: 'Naxcel, Excenel, Excede',
        aliases: [/\bceftiofur\b/i, /\bnaxcel\b/i, /\bexcede\b/i, /\bexcenel\b/i],
        drugClass: 'Third-generation cephalosporin antibiotic',
        defaultIndication: 'Label-supported food-animal respiratory disease, foot rot, metritis, and selected labeled bacterial infections depending on formulation.',
        mechanism: 'Inhibits bacterial cell-wall synthesis and is bactericidal against susceptible pathogens. Ceftiofur is metabolized to active desfuroylceftiofur metabolites.',
        speciesDoses: {
            bovine: dose(1.1, 2.2, 'IM/SC', 'q24h', '3-5 days; formulation and indication dependent', 'FDA-APPROVED label / Animal Drugs @ FDA', 'FDA-approved', 'Formulation-specific withdrawal; verify FARAD and label', 50),
            porcine: dose(3, 5, 'IM', 'q24h', '3 days; formulation dependent', 'FDA-APPROVED label / Animal Drugs @ FDA', 'FDA-approved', 'Product-specific withdrawal required', 50),
            equine: dose(2.2, 4.4, 'IM/IV', 'q12-24h', 'Condition-dependent', "PLUMB'S 10th Ed / Giguere-Prescott-Baggot", 'extra-label', undefined, 50),
        },
        pk: {
            default: { bioavailability: 'High after labeled parenteral use', halfLifeHours: 12, volumeOfDistribution: '0.2-0.4 L/kg', proteinBinding: 'Moderate to high active metabolite binding', metabolism: 'Rapid conversion to active desfuroylceftiofur metabolites', excretion: 'Renal and biliary', speciesNote: 'Food-animal formulation determines dose interval and withdrawal.' },
        },
        contraindications: ['Beta-lactam hypersensitivity', 'Do not use outside label in food animals without FARAD/regulatory review'],
        adverseEffects: 'Injection-site swelling, diarrhea, hypersensitivity; antimicrobial stewardship concern for third-generation cephalosporins.',
        monitoring: 'Clinical response in 24-48h, temperature, respiratory score, culture/susceptibility for outbreaks, withdrawal documentation.',
        overdoseManagement: 'Supportive care; monitor injection sites and GI status.',
        doseAdjustments: 'Renal impairment: use caution with severe renal compromise. Hepatic impairment: limited primary adjustment data. Neonates: product-specific review.',
        compoundingNote: 'Use approved commercial product in food animals; compounding is generally inappropriate when an approved label product exists.',
        clinicalNuance: { bovine: 'Ruminant use must respect product formulation, route, indication, and withdrawal.' },
        alternatives: ['Oxytetracycline', 'Florfenicol', 'Enrofloxacin where legally permitted'],
    },
    cephapirin: {
        name: 'Cephapirin',
        brand: 'Today, Tomorrow',
        aliases: [/\bcephapirin\b/i],
        drugClass: 'First-generation cephalosporin intramammary antibiotic',
        defaultIndication: 'Labeled intramammary therapy for susceptible bovine mastitis according to lactating or dry-cow product.',
        mechanism: 'Beta-lactam cell-wall inhibition within the mammary gland. Activity is time-dependent against susceptible mastitis pathogens.',
        speciesDoses: {
            bovine: unitDose('one intramammary syringe per affected quarter', 'IMM', 'per label', 'Per labeled mastitis product', 'FDA-APPROVED intramammary label', 'FDA-approved', 'Product-specific milk and meat withdrawal required'),
        },
        pk: {
            default: { bioavailability: 'Local intramammary exposure; systemic absorption limited but product-dependent', halfLifeHours: 0, volumeOfDistribution: 'Local mammary distribution', proteinBinding: 'Not clinically central for intramammary label use', metabolism: 'Local/systemic beta-lactam handling', excretion: 'Milk and renal routes', speciesNote: 'Use label tube count, not mg/kg extrapolation.' },
        },
        contraindications: ['Beta-lactam hypersensitivity', 'Wrong lactation stage product selection'],
        adverseEffects: 'Local irritation, residue violation risk if withdrawal is missed, rare hypersensitivity.',
        monitoring: 'Milk appearance, udder pain/swelling, culture results, withdrawal records.',
        overdoseManagement: 'Supportive care and residue management; consult FARAD if label deviation occurs.',
        doseAdjustments: 'Dose is label tube-based; renal/hepatic adjustment is not the primary control point.',
        compoundingNote: 'Do not compound over an approved intramammary product for food animals without regulatory justification.',
        clinicalNuance: { bovine: 'Forestomach pharmacology is irrelevant for intramammary dosing; residue compliance is central.' },
        alternatives: ['Pirlimycin', 'Ceftiofur', 'Culture-directed mastitis therapy'],
    },
    doxycycline: {
        name: 'Doxycycline',
        brand: 'Vibramycin, Ronaxan',
        aliases: [/\bdoxycycline\b/i, /\bvibramycin\b/i, /\bronaxan\b/i],
        drugClass: 'Tetracycline antibiotic',
        defaultIndication: 'Tick-borne, atypical, respiratory, and selected intracellular bacterial infections when tetracycline coverage is indicated.',
        mechanism: 'Binds the 30S ribosomal subunit and inhibits bacterial protein synthesis. The effect is primarily bacteriostatic and concentration/time dependent by pathogen.',
        speciesDoses: {
            canine: dose(5, 10, 'PO/IV', 'q12-24h', '7-28 days depending on disease', "PLUMB'S 10th Ed / Merck VMM", 'extra-label'),
            feline: dose(5, 10, 'PO', 'q24h', '7-28 days depending on disease', "PLUMB'S 10th Ed / ABCD respiratory guidelines", 'extra-label'),
            equine: dose(10, 10, 'PO', 'q12h', 'Condition-dependent; use cautiously', "Giguere-Prescott-Baggot / PLUMB'S 10th Ed", 'extra-label'),
        },
        pk: {
            default: { bioavailability: 'Moderate to high PO; reduced by divalent cations', halfLifeHours: 10, volumeOfDistribution: '1.0-1.7 L/kg', proteinBinding: 'High', metabolism: 'Limited hepatic metabolism with biliary recycling', excretion: 'Fecal/biliary and renal minor contribution', speciesNote: 'Avoid dry tablets in cats; follow with water or use liquid to reduce esophageal injury.' },
        },
        contraindications: ['Pregnancy or growing neonates when alternatives exist', 'Known tetracycline hypersensitivity', 'Severe hepatic disease'],
        adverseEffects: 'Vomiting, diarrhea, anorexia, esophagitis/stricture in cats, tooth discoloration in developing animals.',
        monitoring: 'Appetite, GI tolerance, hydration, liver enzymes for prolonged/high-risk courses, response by 48-72h.',
        overdoseManagement: 'Stop drug, give supportive care, manage severe esophagitis early; separate from calcium/iron/antacids.',
        doseAdjustments: 'Renal impairment: usually no reduction because hepatic/biliary elimination predominates. Hepatic impairment: use caution or extend interval. Pregnancy/lactation: avoid unless benefit outweighs fetal/neonatal risk.',
        compoundingNote: 'Liquid compounding can improve feline safety/compliance; verify concentration and beyond-use date.',
        clinicalNuance: { equine: 'Oral tetracyclines can disrupt hindgut flora; monitor for diarrhea/colitis.' },
        alternatives: ['Amoxicillin-Clavulanate', 'Marbofloxacin', 'Azithromycin'],
    },
    enrofloxacin: {
        name: 'Enrofloxacin',
        brand: 'Baytril',
        aliases: [/\benrofloxacin\b/i, /\bbaytril\b/i],
        drugClass: 'Fluoroquinolone antibiotic',
        defaultIndication: 'Culture-supported Gram-negative or deep tissue infections where a fluoroquinolone is justified by stewardship review.',
        mechanism: 'Inhibits bacterial DNA gyrase and topoisomerase IV. The effect is bactericidal and concentration-dependent.',
        speciesDoses: {
            canine: dose(5, 20, 'PO/IV', 'q24h', '5-14 days or culture-directed', 'FDA-label / PLUMB\'S 10th Ed', 'FDA-approved'),
            feline: dose(5, 5, 'PO', 'q24h', '5-14 days or culture-directed', "PLUMB'S 10th Ed / feline retinal safety literature", 'extra-label'),
            bovine: dose(7.5, 12.5, 'SC', 'single or per label', 'Product-label dependent', 'FDA-APPROVED label where legal', 'FDA-approved', 'Product-specific withdrawal required', 100),
        },
        pk: {
            default: { bioavailability: 'High PO in dogs/cats; parenteral product-dependent', halfLifeHours: 5, volumeOfDistribution: '2-4 L/kg', proteinBinding: 'Low to moderate', metabolism: 'Hepatic partial conversion to ciprofloxacin', excretion: 'Renal and biliary', speciesNote: 'Cats should not exceed 5 mg/kg/day because higher exposure is linked to retinal degeneration.' },
        },
        contraindications: ['Growing dogs when alternatives exist', 'Seizure disorders', 'Cats above 5 mg/kg/day', 'Use in food animals only exactly as legally permitted'],
        adverseEffects: 'GI upset, cartilage injury in juveniles, CNS stimulation/seizures, retinal degeneration in cats at high dose.',
        monitoring: 'Culture/susceptibility, neurologic status, renal function, vision changes in cats, clinical response within 48-72h.',
        overdoseManagement: 'Stop drug, decontaminate if recent oral ingestion, seizure control/supportive care; no specific antidote.',
        doseAdjustments: 'Renal impairment: reduce dose or extend interval. Hepatic impairment: use caution. Pregnancy: avoid unless essential.',
        compoundingNote: 'Avoid compounded fluoroquinolone when approved veterinary formulations are available; palatability varies.',
        clinicalNuance: { bovine: 'Extra-label fluoroquinolone use in food animals is prohibited in many jurisdictions; verify legal route/indication.' },
        alternatives: ['Marbofloxacin', 'Doxycycline', 'Amoxicillin-Clavulanate'],
    },
    fenbendazole: {
        name: 'Fenbendazole',
        brand: 'Panacur, Safe-Guard',
        aliases: [/\bfenbendazole\b/i, /\bpanacur\b/i, /\bsafe-?guard\b/i],
        drugClass: 'Benzimidazole anthelmintic',
        defaultIndication: 'Susceptible gastrointestinal nematodes and selected protozoal/parasitic protocols.',
        mechanism: 'Binds parasite beta-tubulin and disrupts microtubule formation, impairing glucose uptake and energy metabolism.',
        speciesDoses: {
            canine: dose(50, 50, 'PO', 'q24h', '3-5 days depending on parasite', "PLUMB'S 10th Ed / Merck VMM", 'extra-label'),
            feline: dose(50, 50, 'PO', 'q24h', '3-5 days depending on parasite', "PLUMB'S 10th Ed / Merck VMM", 'extra-label'),
            equine: dose(5, 10, 'PO', 'single to 5 days depending on parasite', 'Label/protocol dependent', 'FDA-label where product matches', 'FDA-approved', 'Food animal rules if applicable'),
            bovine: dose(5, 10, 'PO', 'single or per label', 'Label/protocol dependent', 'FDA-label where product matches', 'FDA-approved', 'Product-specific withdrawal required'),
        },
        pk: {
            default: { bioavailability: 'Low to moderate PO; enhanced by feed in ruminants', halfLifeHours: 10, volumeOfDistribution: 'Limited systemic distribution', proteinBinding: 'High', metabolism: 'Hepatic sulfoxide/sulfone metabolites', excretion: 'Fecal and urinary', speciesNote: 'Ruminant forestomach can prolong exposure but product label governs dose and withdrawal.' },
        },
        contraindications: ['Known benzimidazole hypersensitivity', 'Use caution in very debilitated neonates'],
        adverseEffects: 'Usually mild; vomiting or diarrhea uncommon; hypersensitivity from parasite die-off rarely.',
        monitoring: 'Fecal egg count reduction, body weight, parasite diagnosis, clinical response.',
        overdoseManagement: 'Supportive care; wide safety margin in most species.',
        doseAdjustments: 'Renal/hepatic adjustment rarely required for routine courses; pregnancy safety is product/species dependent.',
        compoundingNote: 'Commercial suspensions/granules preferred; compounded capsules must match target dose accurately.',
        clinicalNuance: {},
        alternatives: ['Praziquantel', 'Pyrantel', 'Ivermectin depending on parasite/species'],
    },
    flunixin: {
        name: 'Flunixin meglumine',
        brand: 'Banamine',
        aliases: [/\bflunixin\b/i, /\bbanamine\b/i],
        drugClass: 'Nonselective NSAID',
        defaultIndication: 'Visceral pain, fever, and inflammation in species/conditions where NSAID therapy is appropriate.',
        mechanism: 'Inhibits cyclooxygenase enzymes and reduces prostaglandin synthesis. This provides analgesic, anti-inflammatory, and antipyretic effects while also reducing protective renal/GI prostaglandins.',
        speciesDoses: {
            equine: dose(1.1, 1.1, 'IV/PO', 'q12-24h', 'Up to 5 days unless clinician-directed', 'FDA-label / PLUMB\'S 10th Ed', 'FDA-approved', undefined, 50),
            bovine: dose(1.1, 2.2, 'IV', 'q24h', 'Up to 3 days; product-label dependent', 'FDA-APPROVED label / FARAD', 'FDA-approved', 'Product-specific withdrawal required', 50),
        },
        pk: {
            default: { bioavailability: 'High PO in horses; IV bypasses absorption', halfLifeHours: 2, volumeOfDistribution: '0.2-0.3 L/kg', proteinBinding: 'High', metabolism: 'Hepatic', excretion: 'Renal and biliary', speciesNote: 'Avoid dehydration, shock, renal compromise, or concurrent corticosteroids/NSAIDs.' },
        },
        contraindications: ['Dehydration/shock', 'Renal disease', 'GI ulceration', 'Concurrent NSAID or corticosteroid therapy'],
        adverseEffects: 'GI ulceration, renal papillary necrosis/AKI, right dorsal colitis in horses, injection site reactions.',
        monitoring: 'Hydration, creatinine/BUN, fecal output/manure, appetite, signs of colic/ulceration, withdrawal records in food animals.',
        overdoseManagement: 'Stop NSAID, IV fluids, GI protectants, renal monitoring; no specific antidote.',
        doseAdjustments: 'Renal impairment: avoid. Hepatic impairment: use caution/avoid severe disease. Neonates/geriatrics: higher renal/GI risk.',
        compoundingNote: 'Use labeled formulations; route matters because IM injection can damage tissue.',
        clinicalNuance: { equine: 'Horses are sensitive to NSAID-associated colitis and renal injury during dehydration.' },
        alternatives: ['Meloxicam', 'Firocoxib', 'Opioid/local analgesia depending on species'],
    },
    furosemide: {
        name: 'Furosemide',
        brand: 'Lasix, Salix',
        aliases: [/\bfurosemide\b/i, /\blasix\b/i],
        drugClass: 'Loop diuretic',
        defaultIndication: 'Congestive heart failure, pulmonary edema, or fluid overload where diuresis is indicated.',
        mechanism: 'Inhibits the Na-K-2Cl cotransporter in the thick ascending limb of Henle. This produces potent natriuresis and diuresis.',
        speciesDoses: {
            canine: dose(2, 6, 'PO/IV/IM', 'q8-12h', 'Titrate to congestion and renal/electrolyte response', "PLUMB'S 10th Ed / ACVIM CHF consensus", 'extra-label', undefined, 50),
            feline: dose(1, 4, 'PO/IV/IM', 'q8-12h', 'Titrate to congestion and renal/electrolyte response', "PLUMB'S 10th Ed / ACVIM CHF consensus", 'extra-label', undefined, 50),
            equine: dose(0.5, 1, 'IV/IM', 'q12-24h', 'Condition-dependent', "PLUMB'S 10th Ed", 'extra-label', undefined, 50),
        },
        pk: {
            default: { bioavailability: 'Variable PO; IV onset fastest', halfLifeHours: 1.5, volumeOfDistribution: '0.2 L/kg', proteinBinding: 'High', metabolism: 'Limited; active renal tubular secretion required', excretion: 'Renal', speciesNote: 'Response depends on renal perfusion; dehydration worsens azotemia.' },
        },
        contraindications: ['Anuria', 'Severe dehydration/hypovolemia', 'Uncorrected electrolyte depletion'],
        adverseEffects: 'Dehydration, azotemia, hypokalemia, hyponatremia, ototoxicity at high IV doses.',
        monitoring: 'Respiratory rate/effort, body weight, urine output, BUN/creatinine, electrolytes within 24-72h after changes.',
        overdoseManagement: 'Stop/reduce dose, restore volume and electrolytes, monitor renal function and blood pressure.',
        doseAdjustments: 'Renal impairment: titrate to response and monitor closely. Hepatic impairment: avoid dehydration/electrolyte swings. Geriatric: lower reserve, monitor sooner.',
        compoundingNote: 'Commercial tablets/injectable preferred; compounded liquids require concentration verification.',
        clinicalNuance: {},
        alternatives: ['Torsemide', 'Spironolactone adjunct', 'Oxygen/cage rest for CHF'],
    },
    gabapentin: {
        name: 'Gabapentin',
        brand: 'Neurontin',
        aliases: [/\bgabapentin\b/i, /\bneurontin\b/i],
        drugClass: 'Alpha-2-delta calcium channel ligand / anticonvulsant',
        defaultIndication: 'Neuropathic pain, chronic pain adjunct, anxiolysis/sedation in selected veterinary patients.',
        mechanism: 'Binds the alpha-2-delta subunit of voltage-gated calcium channels and reduces excitatory neurotransmitter release. It is not a direct GABA agonist.',
        speciesDoses: {
            canine: dose(5, 20, 'PO', 'q8-12h', 'Condition-dependent; taper if long-term', "PLUMB'S 10th Ed / BSAVA 11th Ed", 'extra-label'),
            feline: dose(5, 10, 'PO', 'q12h', 'Condition-dependent; taper if long-term', "PLUMB'S 10th Ed / ISFM feline guidance", 'extra-label'),
        },
        pk: {
            default: { bioavailability: 'PO moderate; saturable absorption at higher doses', halfLifeHours: 3, volumeOfDistribution: '0.6 L/kg', proteinBinding: 'Minimal', metabolism: 'Minimal hepatic metabolism', excretion: 'Renal unchanged', speciesNote: 'Renal dose reduction is important; sedation/ataxia signal accumulation.' },
        },
        contraindications: ['Severe renal impairment without dose reduction', 'Use caution with other sedatives'],
        adverseEffects: 'Sedation, ataxia, weakness, GI upset.',
        monitoring: 'Sedation score, gait/ataxia, pain score, renal values in CKD, owner-reported function.',
        overdoseManagement: 'Supportive care, prevent injury from ataxia/sedation; extended monitoring in renal disease.',
        doseAdjustments: 'Renal impairment: reduce 25-75% by CKD stage or extend interval. Hepatic impairment: minimal adjustment. Geriatrics: start low because sedation is common.',
        compoundingNote: 'Avoid xylitol-containing human liquids in dogs; compounded capsules/liquids are common for cats.',
        clinicalNuance: { feline: 'Often useful in cats because NSAID options are constrained by renal and glucuronidation considerations.' },
        alternatives: ['Buprenorphine', 'Amantadine', 'NSAID only if appropriate'],
    },
    maropitant: {
        name: 'Maropitant',
        brand: 'Cerenia',
        aliases: [/\bmaropitant\b/i, /\bcerenia\b/i],
        drugClass: 'Neurokinin-1 receptor antagonist antiemetic',
        defaultIndication: 'Vomiting control and nausea support in canine/feline gastroenteritis, parvoviral enteritis, pancreatitis, and other indicated syndromes.',
        mechanism: 'Blocks substance P at NK-1 receptors in the emetic center and chemoreceptor trigger zone. This suppresses vomiting from peripheral and central stimuli.',
        speciesDoses: {
            canine: dose(1, 2, 'SC/PO/IV', 'q24h', 'Up to 5 days or clinician-directed', 'FDA-APPROVED Cerenia label / PLUMB\'S 10th Ed', 'FDA-approved', undefined, 10),
            feline: dose(1, 1, 'SC/PO', 'q24h', 'Up to 5 days or clinician-directed', 'FDA-APPROVED Cerenia cat label / PLUMB\'S 10th Ed', 'FDA-approved', undefined, 10),
        },
        pk: {
            default: { bioavailability: 'PO moderate; SC reliable', halfLifeHours: 8, volumeOfDistribution: '7-9 L/kg', proteinBinding: 'High', metabolism: 'Hepatic CYP-dependent metabolism', excretion: 'Biliary/fecal predominates', speciesNote: 'Use caution in hepatic disease; SC injection can sting, especially in cats.' },
            feline: { bioavailability: 'PO variable; SC reliable', halfLifeHours: 13, volumeOfDistribution: 'Large distribution volume', proteinBinding: 'High', metabolism: 'Hepatic; cats tolerate labeled dosing despite limited glucuronidation concerns for other drug classes', excretion: 'Biliary/fecal predominates', speciesNote: 'FDA-approved feline antiemetic dose is 1 mg/kg SC q24h; warm injection may reduce stinging.' },
        },
        contraindications: ['Suspected GI obstruction until evaluated', 'Use caution in hepatic dysfunction'],
        adverseEffects: 'Injection pain, hypersalivation, lethargy, diarrhea; rare neurologic signs.',
        monitoring: 'Vomiting frequency, hydration, appetite, abdominal pain, electrolytes in severe GI disease.',
        overdoseManagement: 'Supportive care; manage hypersalivation/lethargy and reassess for obstruction or toxin if vomiting persists.',
        doseAdjustments: 'Renal impairment: usually no adjustment. Hepatic impairment: use caution/reduce exposure for severe disease. Pregnancy/lactation: use only if benefit outweighs risk.',
        compoundingNote: 'Commercial injectable/tablet products preferred; compounded transdermal use is not equivalent.',
        clinicalNuance: { feline: 'Cats have limited glucuronidation, but maropitant is label-supported; hepatic disease remains the major adjustment concern.' },
        alternatives: ['Ondansetron', 'Metoclopramide if no obstruction', 'Supportive fluid/electrolyte correction'],
    },
    meloxicam: {
        name: 'Meloxicam',
        brand: 'Metacam',
        aliases: [/\bmeloxicam\b/i, /\bmetacam\b/i],
        drugClass: 'Preferential COX-2 NSAID',
        defaultIndication: 'Pain and inflammation where NSAID benefit outweighs renal/GI risk.',
        mechanism: 'Inhibits cyclooxygenase enzymes and decreases prostaglandin synthesis. This reduces inflammation and pain while potentially compromising renal perfusion and GI protection.',
        speciesDoses: {
            canine: dose(0.1, 0.2, 'PO/SC', 'q24h', 'Shortest effective duration', 'FDA-label / PLUMB\'S 10th Ed', 'FDA-approved'),
            feline: dose(0.05, 0.05, 'SC/PO', 'q24h', 'Single dose to very short course per jurisdiction', 'FDA-label where applicable / ISFM caution', 'FDA-approved'),
        },
        pk: {
            default: { bioavailability: 'High PO', halfLifeHours: 24, volumeOfDistribution: '0.2-0.3 L/kg', proteinBinding: 'Very high', metabolism: 'Hepatic oxidation/conjugation', excretion: 'Biliary and renal metabolites', speciesNote: 'Avoid dehydration, CKD, GI ulceration, and concurrent steroids/NSAIDs.' },
            feline: { bioavailability: 'High PO/SC', halfLifeHours: 15, volumeOfDistribution: 'Low', proteinBinding: 'Very high', metabolism: 'Hepatic; feline glucuronidation limitations increase NSAID caution', excretion: 'Biliary/renal metabolites', speciesNote: 'Cats are NSAID-sensitive; use only with hydration and renal screening.' },
        },
        contraindications: ['Renal disease/dehydration', 'GI ulceration', 'Concurrent corticosteroid or other NSAID', 'Bleeding disorder'],
        adverseEffects: 'Vomiting, diarrhea, anorexia, GI ulceration, azotemia/AKI, hepatopathy rarely.',
        monitoring: 'Baseline and follow-up renal values, hydration, appetite, vomiting/melena, ALT for longer courses.',
        overdoseManagement: 'Stop drug, activated charcoal if recent ingestion, IV fluids, gastroprotectants, renal monitoring.',
        doseAdjustments: 'Renal impairment: avoid. Hepatic impairment: avoid severe disease. Geriatric/feline: use lowest dose and shortest duration.',
        compoundingNote: 'Use commercial veterinary product; dosing errors are common with concentrated suspensions.',
        clinicalNuance: { feline: 'Limited glucuronidation and CKD prevalence make feline NSAID use a high-review decision.' },
        alternatives: ['Buprenorphine', 'Gabapentin', 'Robenacoxib short-course where appropriate'],
    },
    metronidazole: {
        name: 'Metronidazole',
        brand: 'Flagyl, generic',
        aliases: [/\bmetronidazole\b/i, /\bflagyl\b/i],
        drugClass: 'Nitroimidazole antimicrobial and antiprotozoal',
        defaultIndication: 'Anaerobic bacterial infection, Giardia protocols, clostridial overgrowth, and selected GI/hepatic encephalopathy indications.',
        mechanism: 'Reduced metronidazole metabolites disrupt DNA in anaerobic organisms and protozoa. Mammalian cells are less susceptible because they do not reduce the drug the same way.',
        speciesDoses: {
            canine: dose(10, 25, 'PO/IV', 'q12h', '5-7 days typical; condition-dependent', "PLUMB'S 10th Ed / Merck VMM", 'extra-label'),
            feline: dose(7.5, 15, 'PO', 'q12h', '5-7 days typical; condition-dependent', "PLUMB'S 10th Ed / BSAVA 11th Ed", 'extra-label'),
        },
        pk: {
            default: { bioavailability: 'High PO', halfLifeHours: 4, volumeOfDistribution: '0.6-0.9 L/kg', proteinBinding: 'Low', metabolism: 'Hepatic oxidation/glucuronidation pathways', excretion: 'Urine and bile', speciesNote: 'Neurotoxicity risk rises with high dose, prolonged therapy, or hepatic impairment.' },
            feline: { bioavailability: 'High PO but bitter taste limits compliance', halfLifeHours: 5, volumeOfDistribution: 'Moderate', proteinBinding: 'Low', metabolism: 'Hepatic; feline conjugation limits justify conservative courses', excretion: 'Urine and bile', speciesNote: 'Use conservative dosing and short duration; monitor closely for neurologic signs.' },
        },
        contraindications: ['Severe hepatic disease', 'Seizure disorder', 'Pregnancy first trimester unless essential'],
        adverseEffects: 'Anorexia, vomiting, hypersalivation, diarrhea, ataxia, nystagmus, tremors/seizures with toxicity.',
        monitoring: 'Neurologic status, appetite, liver values for prolonged courses, response within 48-72h.',
        overdoseManagement: 'Stop drug; diazepam may be used by clinicians for metronidazole neurotoxicity; supportive care.',
        doseAdjustments: 'Renal impairment: minor adjustment usually not primary. Hepatic impairment: reduce dose/extend interval or avoid. Geriatric: monitor CNS effects.',
        compoundingNote: 'Compounded flavored suspensions can help because tablets are bitter; verify concentration.',
        clinicalNuance: { feline: 'Cats may show compliance and neurotoxicity problems sooner; avoid prolonged empirical GI use.' },
        alternatives: ['Fenbendazole for Giardia', 'Clindamycin for some anaerobic/protozoal indications', 'Amoxicillin-Clavulanate'],
    },
    oxytetracycline: {
        name: 'Oxytetracycline',
        brand: 'LA-200, Liquamycin, generic',
        aliases: [/\boxytetracycline\b/i, /\bla-?200\b/i],
        drugClass: 'Tetracycline antibiotic',
        defaultIndication: 'Label-supported livestock respiratory, anaplasmosis, foot rot, and susceptible bacterial infections depending on product.',
        mechanism: 'Binds the 30S ribosomal subunit and inhibits bacterial protein synthesis. Activity is mainly bacteriostatic.',
        speciesDoses: {
            bovine: dose(10, 20, 'IM/SC/IV', 'single to q24h per product', 'Product-label dependent', 'FDA-APPROVED label / FARAD', 'FDA-approved', 'Product-specific withdrawal required', 200),
            ovine: dose(10, 20, 'IM/SC', 'single to q24h per product', 'Product-label dependent', 'FDA-label where applicable / FARAD', 'FDA-approved', 'Product-specific withdrawal required', 200),
            equine: dose(6.6, 11, 'IV', 'q12-24h', 'Condition-dependent; specialist review', "Giguere-Prescott-Baggot / PLUMB'S 10th Ed", 'extra-label', undefined, 100),
        },
        pk: {
            default: { bioavailability: 'Poor/variable oral in adult ruminants; parenteral route preferred when labeled', halfLifeHours: 8, volumeOfDistribution: '1-1.5 L/kg', proteinBinding: 'Moderate', metabolism: 'Limited hepatic metabolism', excretion: 'Renal and biliary', speciesNote: 'Ruminant forestomach reduces oral utility; parenteral label and withdrawal govern use.' },
        },
        contraindications: ['Pregnancy/young animals when tooth/bone effects matter', 'Severe renal impairment', 'Concurrent calcium/iron oral products'],
        adverseEffects: 'Injection site swelling, GI dysbiosis, nephrotoxicity at high exposure, tooth discoloration in developing animals.',
        monitoring: 'Temperature, respiratory score, hydration, renal values if high-risk, withdrawal records.',
        overdoseManagement: 'Stop drug, supportive care, renal monitoring, manage injection-site injury.',
        doseAdjustments: 'Renal impairment: avoid or reduce. Hepatic impairment: caution. Neonates: avoid unless label/benefit supports.',
        compoundingNote: 'Use labeled livestock products; concentration and route vary substantially.',
        clinicalNuance: { bovine: 'Forestomach effects and residue law make oral extrapolation inappropriate.' },
        alternatives: ['Ceftiofur', 'Florfenicol', 'Macrolide respiratory products where labeled'],
    },
    'penicillin-g': {
        name: 'Penicillin G',
        brand: 'Penicillin G potassium/procaine, generic',
        aliases: [/\bpenicillin(?:\s+g)?\b/i],
        drugClass: 'Natural penicillin beta-lactam antibiotic',
        defaultIndication: 'Susceptible Gram-positive and anaerobic infections; unit-based protocols such as leptospiremia coverage may be used condition-specifically.',
        mechanism: 'Inhibits bacterial cell-wall synthesis through penicillin-binding proteins. Bactericidal efficacy is time above MIC dependent.',
        speciesDoses: {
            canine: unitDose('20,000-40,000 IU/kg', 'IV/IM/SC', 'q6-12h', 'Condition-dependent', "PLUMB'S 10th Ed / Merck VMM", 'extra-label'),
            bovine: unitDose('per FDA label in IU/lb or mL/cwt', 'IM/SC', 'q24h or label-directed', 'Product-label dependent', 'FDA-APPROVED label / FARAD', 'FDA-approved', 'Product-specific withdrawal required'),
            equine: unitDose('20,000-44,000 IU/kg', 'IV/IM', 'q6-12h', 'Condition-dependent', "Giguere-Prescott-Baggot / PLUMB'S 10th Ed", 'extra-label'),
        },
        pk: { default: SMALL_ANIMAL_ANTIBIOTIC_PK },
        contraindications: ['Beta-lactam hypersensitivity', 'Do not use procaine-containing products IV'],
        adverseEffects: 'Hypersensitivity, diarrhea/colitis risk in horses, injection reaction, procaine toxicity if misused.',
        monitoring: 'Clinical response, culture/susceptibility, allergy signs, withdrawal documentation in food animals.',
        overdoseManagement: 'Supportive care; treat anaphylaxis immediately; manage seizures if procaine toxicity occurs.',
        doseAdjustments: 'Renal impairment: extend interval. Neonates: interval extension often needed.',
        compoundingNote: 'Use formulation-specific unit concentration; mL calculation requires IU/mL conversion, not mg/mL.',
        clinicalNuance: { equine: 'Antibiotic-associated colitis is a major equine risk; monitor manure and appetite.' },
        alternatives: ['Ampicillin', 'Amoxicillin', 'Cefazolin'],
    },
    pirlimycin: {
        name: 'Pirlimycin',
        brand: 'Pirsue',
        aliases: [/\bpirlimycin\b/i],
        drugClass: 'Lincosamide intramammary antibiotic',
        defaultIndication: 'Labeled lactating dairy cow mastitis therapy for susceptible Gram-positive pathogens.',
        mechanism: 'Binds the 50S ribosomal subunit and inhibits bacterial protein synthesis. Intramammary use targets local mammary pathogens.',
        speciesDoses: {
            bovine: unitDose('one intramammary syringe per affected quarter', 'IMM', 'q24h per label', 'Per labeled course', 'FDA-APPROVED intramammary label / FARAD', 'FDA-approved', 'Product-specific milk and meat withdrawal required'),
        },
        pk: {
            default: { bioavailability: 'Local intramammary exposure', halfLifeHours: 0, volumeOfDistribution: 'Local mammary distribution', proteinBinding: 'Not central for label use', metabolism: 'Limited systemic relevance at label use', excretion: 'Milk/residue route plus systemic clearance', speciesNote: 'Dose is tube-based; culture and residue rules drive clinical use.' },
        },
        contraindications: ['Use only in labeled class of cattle/product stage', 'Lincosamide hypersensitivity'],
        adverseEffects: 'Residue violation risk, local irritation, treatment failure if pathogen not susceptible.',
        monitoring: 'Milk culture, somatic cell count trend, udder signs, withdrawal records.',
        overdoseManagement: 'Residue consultation and supportive udder care.',
        doseAdjustments: 'Dose is label tube-based; do not convert to mg/kg.',
        compoundingNote: 'Use commercial labeled intramammary syringe.',
        clinicalNuance: { bovine: 'Mastitis treatment should be pathogen- and farm-protocol guided.' },
        alternatives: ['Cephapirin', 'Ceftiofur intramammary products where labeled', 'Supportive mastitis care'],
    },
    prednisolone: {
        name: 'Prednisolone',
        brand: 'PrednisTab, generic',
        aliases: [/\bprednisolone\b/i, /\bprednisone\b/i],
        drugClass: 'Glucocorticoid',
        defaultIndication: 'Anti-inflammatory or immunosuppressive therapy where infection, diabetes, and ulcer risk have been reviewed.',
        mechanism: 'Activates glucocorticoid receptors, alters transcription of inflammatory mediators, and suppresses leukocyte trafficking/cytokine production.',
        speciesDoses: {
            canine: dose(0.5, 2, 'PO', 'q12-24h', 'Taper according to response and disease', "PLUMB'S 10th Ed / ACVIM condition protocols", 'extra-label'),
            feline: dose(1, 2, 'PO', 'q12-24h', 'Taper according to response and disease', "PLUMB'S 10th Ed / BSAVA 11th Ed", 'extra-label'),
        },
        pk: {
            default: { bioavailability: 'Good PO', halfLifeHours: 3, volumeOfDistribution: '1-2 L/kg', proteinBinding: 'Moderate', metabolism: 'Hepatic conversion/conjugation', excretion: 'Urinary metabolites', speciesNote: 'Prednisolone is preferred over prednisone in cats because hepatic activation of prednisone may be less reliable.' },
        },
        contraindications: ['Systemic fungal infection', 'Uncontrolled bacterial infection without antimicrobials', 'GI ulceration', 'Concurrent NSAID therapy', 'Uncontrolled diabetes mellitus'],
        adverseEffects: 'PU/PD, polyphagia, panting, immunosuppression, GI ulceration, hyperglycemia, muscle wasting with chronic use.',
        monitoring: 'Clinical target response, glucose, infection signs, GI signs, body weight, taper tolerance.',
        overdoseManagement: 'Supportive care, GI protection if ulcer risk, taper after chronic exposure to avoid adrenal suppression.',
        doseAdjustments: 'Hepatic impairment: caution. Renal impairment: monitor fluid/BP effects. Pregnancy: avoid unless clearly indicated.',
        compoundingNote: 'Commercial tablets/liquid preferred; compounded small-dose capsules may help cats.',
        clinicalNuance: { feline: 'Cats often require prednisolone rather than prednisone; monitor diabetic risk.' },
        alternatives: ['Budesonide for some GI disease', 'Cyclosporine', 'Disease-specific nonsteroidal options'],
    },
    buprenorphine: {
        name: 'Buprenorphine',
        brand: 'Buprenex, Simbadol',
        aliases: [/\bbuprenorphine\b/i, /\bbuprenex\b/i, /\bsimbadol\b/i],
        drugClass: 'Partial mu-opioid agonist analgesic',
        defaultIndication: 'Moderate pain, especially when NSAIDs are unsafe or as multimodal analgesia.',
        mechanism: 'Partial agonism at mu-opioid receptors provides analgesia with a ceiling effect on some opioid effects. High receptor affinity can complicate reversal or full agonist layering.',
        speciesDoses: {
            canine: dose(0.02, 0.04, 'IV/IM/SC', 'q6-8h', 'Pain-dependent', "PLUMB'S 10th Ed / BSAVA 11th Ed", 'extra-label', undefined, 0.3),
            feline: dose(0.02, 0.03, 'OTM/IV/IM', 'q6-8h', 'Pain-dependent', "PLUMB'S 10th Ed / ISFM pain guidance", 'extra-label', undefined, 0.3),
        },
        pk: {
            default: { bioavailability: 'Poor swallowed oral; feline OTM exposure is clinically useful', halfLifeHours: 6, volumeOfDistribution: 'Large', proteinBinding: 'High', metabolism: 'Hepatic glucuronidation/N-dealkylation', excretion: 'Biliary/fecal and urinary metabolites', speciesNote: 'Useful when NSAIDs are contraindicated; monitor sedation and respiratory status.' },
        },
        contraindications: ['Severe respiratory depression', 'Use caution with head trauma or profound hepatic disease'],
        adverseEffects: 'Sedation, dysphoria, mydriasis, bradycardia, respiratory depression uncommon at clinical doses.',
        monitoring: 'Pain score, sedation score, respiratory rate/effort, appetite, temperature in cats.',
        overdoseManagement: 'Support ventilation and temperature; naloxone can reverse but may be incomplete/shorter acting.',
        doseAdjustments: 'Hepatic impairment: reduce/extend interval. Renal impairment: generally safer than NSAIDs. Geriatrics/neonates: titrate conservatively.',
        compoundingNote: 'Controlled-drug handling applies; OTM feline dosing needs suitable concentration and owner instruction.',
        clinicalNuance: { feline: 'Feline OTM administration is a practical species-specific advantage.' },
        alternatives: ['Gabapentin', 'Methadone in hospital', 'Local/regional analgesia'],
    },
};

export async function buildPharmacOSProtocol(input: BuildPharmacOSInput): Promise<PharmacOSProtocol> {
    const combinedText = compactSearchTerms([input.queryText, input.topic, input.messageContent]);
    const detectedSpecies = detectSpeciesFromTexts([input.selectedSpecies, input.queryText, input.topic, input.messageContent], 'unknown');
    const species = isVetiosSpecies(detectedSpecies) ? detectedSpecies : 'canine';
    const currentText = compactSearchTerms([input.queryText, input.topic]);
    const condition = inferCondition(input.topic, currentText || combinedText, species, combinedText);
    const patientWeightKg = normalizeWeight(input.patientWeightKg) ?? extractWeightKg(combinedText) ?? 10;
    const drugNames = extractDrugNames(combinedText);
    const inferredDrugNames = drugNames.length > 0 ? drugNames : inferConditionDrugNames(condition, combinedText);
    const selectedDrugNames = Array.from(new Set(inferredDrugNames)).slice(0, 6);
    const interactionWarnings = await resolveInteractionWarnings(selectedDrugNames, species, combinedText);

    const drugs = selectedDrugNames
        .map((name) => buildDrugOutput(name, species, condition, patientWeightKg, interactionWarnings))
        .filter((drug): drug is PharmacOSDrug => drug != null);
    const protocol = buildTreatmentProtocol(condition, species, drugs);

    return {
        species,
        condition,
        patient_weight_kg: round(patientWeightKg, 2),
        protocol_phase: 'complete',
        drugs,
        treatment_protocol: protocol.sections,
        interaction_warnings: interactionWarnings,
        total_drugs: drugs.length,
        protocol_source: protocol.source,
    };
}

export function extractDrugNames(text: string): string[] {
    const detected = DRUG_CANDIDATES
        .filter((drug) => drug.patterns.some((pattern) => pattern.test(text)))
        .map((drug) => drug.name);
    return Array.from(new Set(detected));
}

export function inferCondition(inputTopic: string | undefined, text: string, species: VetiosSpecies, fallbackText = ''): string {
    const direct = inputTopic?.trim();
    const conditionRule = CONDITION_CANDIDATES.find((entry) => entry.patterns.some((pattern) => pattern.test(text)));
    if (conditionRule) {
        if (conditionRule.condition === 'Parvoviral enteritis' && species === 'feline') return 'Feline panleukopenia virus enteritis';
        if (conditionRule.condition === 'Parvoviral enteritis' && species === 'canine') return 'Canine parvoviral enteritis';
        return conditionRule.condition;
    }
    const fallbackConditionRule = fallbackText
        ? CONDITION_CANDIDATES.find((entry) => entry.patterns.some((pattern) => pattern.test(fallbackText)))
        : undefined;
    if (fallbackConditionRule) {
        if (fallbackConditionRule.condition === 'Parvoviral enteritis' && species === 'feline') return 'Feline panleukopenia virus enteritis';
        if (fallbackConditionRule.condition === 'Parvoviral enteritis' && species === 'canine') return 'Canine parvoviral enteritis';
        return fallbackConditionRule.condition;
    }
    if (direct && !/^veterinary knowledge$/i.test(direct)) return direct;
    const sentence = text.split(/[.!?]/)[0]?.trim();
    return sentence ? sentence.slice(0, 80) : 'Current VetIOS treatment context';
}

function inferConditionDrugNames(condition: string, text: string): string[] {
    const normalized = `${condition} ${text}`;
    const rule = CONDITION_CANDIDATES.find((entry) => entry.patterns.some((pattern) => pattern.test(normalized)));
    return rule?.drugs ?? [];
}

function buildDrugOutput(
    drugName: string,
    species: VetiosSpecies,
    condition: string,
    patientWeightKg: number,
    interactionWarnings: string[],
): PharmacOSDrug | null {
    const profile = resolveProfile(drugName);
    if (!profile) return null;
    const resolvedDose = resolveSpeciesDose(profile, species);
    const pk = profile.pk[species] ?? profile.pk.default ?? PK_DEFAULT;
    const totalDose = calculateTotalDose(resolvedDose, patientWeightKg);
    const doseDisplay = resolvedDose.doseDisplay ?? formatDose(resolvedDose);
    const totalDoseText = typeof totalDose === 'number' ? `${totalDose} mg` : `${totalDose} mg`;
    const volumeCalculation = calculateVolumeText(totalDose, resolvedDose);
    const interactionText = interactionWarnings
        .filter((warning) => warning.toLowerCase().includes(profile.name.toLowerCase().split(' ')[0]))
        .join(' | ') || 'No cross-drug interaction warning returned for the current list.';
    const speciesNuance = profile.clinicalNuance[species] ?? pk.speciesNote;

    return {
        name: profile.name,
        brand: profile.brand,
        class: profile.drugClass,
        indication: buildIndication(profile, condition, species),
        mechanism: profile.mechanism,
        dose_mg_per_kg: resolvedDose.doseDisplay ?? (resolvedDose.doseLow === resolvedDose.doseHigh ? resolvedDose.doseLow : `${resolvedDose.doseLow}-${resolvedDose.doseHigh}`),
        dose_range_low: resolvedDose.doseLow,
        dose_range_high: resolvedDose.doseHigh,
        total_dose_mg: totalDose,
        dose_calculation: `Total dose = ${doseDisplay} x ${round(patientWeightKg, 2)} kg = ${totalDoseText}`,
        volume_calculation: volumeCalculation,
        route: resolvedDose.route,
        frequency: resolvedDose.frequency,
        duration: resolvedDose.duration,
        onset_of_action: resolvedDose.onset,
        reference: resolvedDose.reference,
        label_status: resolvedDose.labelStatus,
        withdrawal_days: FOOD_ANIMALS.has(species) ? resolvedDose.withdrawalDays : null,
        withdrawal_note: FOOD_ANIMALS.has(species)
            ? (resolvedDose.withdrawalNote ?? 'Food-animal withdrawal must be verified against FARAD and the exact product label.')
            : 'n/a for companion-animal context',
        contraindications: profile.contraindications.join('; '),
        interactions: interactionText,
        adverse_effects: profile.adverseEffects,
        monitoring: profile.monitoring,
        clinical_commentary: buildClinicalCommentary(profile, condition, species, resolvedDose, speciesNuance),
        dose_adjustments: profile.doseAdjustments,
        overdose_management: profile.overdoseManagement,
        compounding_note: profile.compoundingNote,
        pk: {
            bioavailability: pk.bioavailability,
            half_life_hours: pk.halfLifeHours,
            volume_of_distribution: pk.volumeOfDistribution,
            protein_binding: pk.proteinBinding,
            metabolism: pk.metabolism,
            excretion: pk.excretion,
            species_note: speciesNuance,
        },
    };
}

async function resolveInteractionWarnings(drugNames: string[], species: VetiosSpecies, contextText: string): Promise<string[]> {
    if (drugNames.length < 2) return [];
    const engine = getDrugInteractionEngine();
    await loadExtendedDrugDatabase(engine);
    const ids = drugNames.map(normalizeDrugId);
    const conditions = inferPatientConditions(contextText);
    let result: DrugCheckResult | null = null;
    try {
        result = engine.check({ drugs: ids, species, conditions });
    } catch {
        result = null;
    }
    const engineWarnings = result?.interactions.map((interaction) =>
        `${readableDrugId(interaction.drug1)} + ${readableDrugId(interaction.drug2)} (${interaction.severity}): ${interaction.clinicalEffect} Management: ${interaction.managementRecommendation}`,
    ) ?? [];
    return Array.from(new Set([...engineWarnings, ...buildClassInteractionWarnings(drugNames)]));
}

function buildClassInteractionWarnings(drugNames: string[]) {
    const warnings: string[] = [];
    const profiles = drugNames.map(resolveProfile).filter((profile): profile is PharmacoProfile => profile != null);
    for (let i = 0; i < profiles.length; i += 1) {
        for (let j = i + 1; j < profiles.length; j += 1) {
            const left = profiles[i];
            const right = profiles[j];
            const pair = `${left.name} + ${right.name}`;
            const leftClass = left.drugClass.toLowerCase();
            const rightClass = right.drugClass.toLowerCase();
            if (leftClass.includes('nsaid') && rightClass.includes('glucocorticoid')
                || rightClass.includes('nsaid') && leftClass.includes('glucocorticoid')) {
                warnings.push(`${pair} (contraindicated): additive GI ulceration/perforation and renal injury risk. Management: avoid coadministration and use a washout plus gastroprotection plan if switching.`);
            }
            if (leftClass.includes('tetracycline') && rightClass.includes('beta-lactam')
                || rightClass.includes('tetracycline') && leftClass.includes('beta-lactam')) {
                warnings.push(`${pair} (moderate): bacteriostatic tetracycline may antagonize time-dependent beta-lactam killing in some infections. Management: avoid routine pairing unless a disease-specific protocol justifies it.`);
            }
            if (leftClass.includes('nsaid') && right.name === 'Furosemide'
                || rightClass.includes('nsaid') && left.name === 'Furosemide') {
                warnings.push(`${pair} (major in dehydrated/renal patients): diuresis plus prostaglandin blockade increases AKI risk. Management: correct hydration and monitor renal values/electrolytes.`);
            }
        }
    }
    return warnings;
}

function buildTreatmentProtocol(condition: string, species: VetiosSpecies, drugs: PharmacOSDrug[]) {
    const lower = condition.toLowerCase();
    if (lower.includes('glanders')) {
        return {
            source: 'Merck/MSD Veterinary Manual, WOAH guidance, and public-health reporting protocols',
            sections: {
                phase1_stabilization: '0-6h: isolate immediately, use PPE, notify regulatory/public-health authority, stabilize airway/circulation if clinically unstable, and collect confirmatory diagnostics before nonessential handling.',
                phase2_active_treatment: `6-72h: treatment is not routine in many jurisdictions because glanders is zoonotic/reportable; any antimicrobial plan (${drugs.map((drug) => drug.name).join(', ') || 'culture-directed therapy'}) requires authority and specialist approval.`,
                phase3_recovery: '72h+: continue quarantine, serial testing, environmental decontamination, and occupational exposure monitoring; release only under regulatory direction.',
                fluid_therapy: 'Balanced isotonic crystalloids only as clinically indicated; titrate to perfusion, hydration, urine output, and species-specific cardiovascular tolerance.',
                nutritional_support: 'Maintain enteral intake when safe; avoid aerosol-generating procedures and minimize staff exposure during feeding/care.',
                discharge_criteria: 'No routine home discharge until regulatory clearance, negative/managed testing pathway, stable vitals, and documented biosecurity plan.',
            },
        };
    }
    if (lower.includes('parvo') || lower.includes('panleukopenia')) {
        const source = species === 'feline'
            ? 'ABCD feline panleukopenia guidelines, Merck/MSD Veterinary Manual, and WSAVA supportive-care principles'
            : 'WSAVA treatment guidance, AAHA/consensus parvoviral supportive-care protocols, and Merck/MSD Veterinary Manual';
        return {
            source,
            sections: {
                phase1_stabilization: '0-6h: isolation/barrier nursing, perfusion assessment, balanced isotonic crystalloid resuscitation as indicated, glucose/electrolyte correction, antiemetic therapy, and baseline CBC/chemistry.',
                phase2_active_treatment: `6-72h: schedule antiemetic/supportive drugs (${drugs.map((drug) => `${drug.name} ${drug.dose_mg_per_kg} mg/kg ${drug.route} ${drug.frequency}`).join('; ') || 'drug list pending'}), parenteral antibiotics if neutropenic or barrier injury is suspected, and reassess hydration/electrolytes at least daily.`,
                phase3_recovery: '72h+: transition to oral medications when vomiting is controlled, continue isolation until clinically safe, monitor leukocyte rebound, appetite, stool quality, and hydration.',
                fluid_therapy: 'Balanced isotonic crystalloid plan based on shock correction, dehydration deficit, maintenance, and ongoing losses; add potassium/glucose only after lab-guided review.',
                nutritional_support: 'Begin early enteral nutrition once vomiting is controlled; use small frequent highly digestible meals or feeding tube support if intake remains inadequate.',
                discharge_criteria: 'Afebrile or improving trend, hydrated without IV support, eating voluntarily, vomiting controlled, stable glucose/electrolytes, owner isolation instructions documented.',
            },
        };
    }
    if (lower.includes('mastitis')) {
        return {
            source: 'Merck/MSD Veterinary Manual mastitis guidance, FDA animal drug labels, and FARAD residue guidance',
            sections: {
                phase1_stabilization: '0-6h: assess systemic illness, udder pain, dehydration, toxemia, and milk culture; severe cases need fluids, NSAID review, and veterinary-directed systemic therapy.',
                phase2_active_treatment: `6-72h: use culture- and label-directed therapy (${drugs.map((drug) => `${drug.name} ${drug.route} ${drug.frequency}`).join('; ') || 'drug list pending'}); record every treated quarter and product lot.`,
                phase3_recovery: '72h+: reassess milk appearance, cow attitude, udder inflammation, culture results, and residue compliance before milk returns to tank.',
                fluid_therapy: 'Oral or IV fluids according to dehydration/toxemia severity; calcium/energy support if concurrent periparturient disease is present.',
                nutritional_support: 'Maintain feed intake, correct negative energy balance, and manage pain so the animal continues eating and ruminating.',
                discharge_criteria: 'Systemically stable, improving quarter, withdrawal dates documented, and farm treatment records complete.',
            },
        };
    }
    return {
        source: 'VetIOS PharmacOS local formulary synthesis using Plumb\'s/Merck/BSAVA hierarchy and treatment-intelligence pathway rules',
        sections: {
            phase1_stabilization: '0-6h: triage airway, breathing, circulation, pain, hydration, and red flags; obtain minimum database before high-risk drugs.',
            phase2_active_treatment: `6-72h: administer selected drugs on a clinician-verified schedule: ${drugs.map((drug) => `${drug.name} ${drug.dose_mg_per_kg} mg/kg ${drug.route} ${drug.frequency}`).join('; ') || 'no drugs resolved'}.`,
            phase3_recovery: '72h+: narrow therapy to diagnostics/culture, transition to oral route when stable, taper drugs that require tapering, and schedule recheck monitoring.',
            fluid_therapy: 'Use balanced isotonic crystalloids when indicated; tailor rate to deficit, maintenance, ongoing losses, renal/cardiac status, and serial perfusion checks.',
            nutritional_support: 'Use enteral nutrition as soon as safe; set caloric targets from resting energy requirement and disease tolerance.',
            discharge_criteria: 'Stable vitals, controlled pain/nausea, owner can administer medications, monitoring plan documented, and no unresolved red flags.',
        },
    };
}

function resolveSpeciesDose(profile: PharmacoProfile, species: VetiosSpecies): DoseProfile {
    const exact = profile.speciesDoses[species];
    if (exact) return exact;
    const fallback = profile.speciesDoses.canine
        ?? profile.speciesDoses.feline
        ?? Object.values(profile.speciesDoses).find(Boolean);
    if (!fallback) {
        return {
            doseLow: 0,
            doseHigh: 0,
            doseDisplay: 'No validated mg/kg dose in local VetIOS formulary for this species; clinician must verify a primary formulary before use',
            route: 'Clinician verified route required',
            frequency: 'Clinician verified interval required',
            duration: 'Condition-dependent',
            onset: 'Not assigned',
            reference: 'EXTRA-LABEL - verify before use',
            labelStatus: 'extra-label',
            withdrawalDays: FOOD_ANIMALS.has(species) ? null : null,
        };
    }
    return {
        ...fallback,
        doseDisplay: `${formatDose(fallback)} (extrapolated from another species; do not use without primary-reference verification)`,
        reference: `${fallback.reference}; EXTRA-LABEL - species-specific verification required`,
        labelStatus: 'extra-label',
        withdrawalDays: FOOD_ANIMALS.has(species) ? null : fallback.withdrawalDays,
        withdrawalNote: FOOD_ANIMALS.has(species)
            ? 'Extra-label food-animal use requires FARAD/regulatory review; do not assign withdrawal from another species.'
            : fallback.withdrawalNote,
    };
}

function dose(
    doseLow: number,
    doseHigh: number,
    route: string,
    frequency: string,
    duration: string,
    reference: string,
    labelStatus: LabelStatus,
    withdrawalNote?: string,
    concentrationMgMl?: number,
): DoseProfile {
    return {
        doseLow,
        doseHigh,
        route,
        frequency,
        duration,
        onset: 'Minutes to hours depending on route and clinical endpoint',
        reference,
        labelStatus,
        withdrawalDays: null,
        withdrawalNote,
        concentrationMgMl,
    };
}

function unitDose(
    doseDisplay: string,
    route: string,
    frequency: string,
    duration: string,
    reference: string,
    labelStatus: LabelStatus,
    withdrawalNote?: string,
): DoseProfile {
    return {
        doseLow: 0,
        doseHigh: 0,
        doseDisplay,
        route,
        frequency,
        duration,
        onset: 'Condition and route dependent',
        reference,
        labelStatus,
        withdrawalDays: null,
        withdrawalNote,
    };
}

function resolveProfile(drugName: string): PharmacoProfile | null {
    const normalized = normalizeDrugId(drugName);
    if (FORMULARY[normalized]) return FORMULARY[normalized];
    const byName = Object.values(FORMULARY).find((profile) =>
        profile.name.toLowerCase() === drugName.toLowerCase()
        || profile.aliases.some((pattern) => pattern.test(drugName)),
    );
    return byName ?? null;
}

function normalizeDrugId(value: string) {
    const lower = value.toLowerCase().trim();
    if (lower === 'amoxicillin clavulanate' || lower === 'amoxicillin-clavulanate') return 'amoxicillin-clavulanate';
    if (lower === 'penicillin g' || lower === 'penicillin') return 'penicillin-g';
    return lower.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_clavulanate$/, '-clavulanate');
}

function readableDrugId(value: string) {
    return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildIndication(profile: PharmacoProfile, condition: string, species: VetiosSpecies) {
    return `${profile.defaultIndication} Current context: ${condition} in ${species}.`;
}

function buildClinicalCommentary(
    profile: PharmacoProfile,
    condition: string,
    species: VetiosSpecies,
    doseProfile: DoseProfile,
    speciesNuance: string,
) {
    const alternative = profile.alternatives[0] ?? 'culture- or guideline-directed alternative therapy';
    return `${profile.name} is included because its class and indication fit ${condition} when patient assessment supports that pathway in ${species}. It should be integrated with stabilization, diagnostics, and monitoring rather than treated as an isolated prescription. Expected response is usually assessed within the first dosing interval to 72 hours depending on endpoint; failure to improve should trigger reassessment of diagnosis, hydration/perfusion, culture data, and drug exposure. Species nuance: ${speciesNuance} If unavailable or inappropriate, consider ${alternative} after clinician review. Dose source: ${doseProfile.reference}.`;
}

function calculateTotalDose(doseProfile: DoseProfile, weightKg: number): number | string {
    if (doseProfile.doseLow <= 0 && doseProfile.doseHigh <= 0) return doseProfile.doseDisplay ?? 'Dose is unit-based; mg total not applicable';
    const low = round(doseProfile.doseLow * weightKg, 2);
    const high = round(doseProfile.doseHigh * weightKg, 2);
    return low === high ? low : `${low}-${high}`;
}

function calculateVolumeText(totalDose: number | string, doseProfile: DoseProfile) {
    if (!doseProfile.concentrationMgMl) {
        return 'Volume = total mg divided by product concentration; enter exact concentration from vial/tablet/suspension before dispensing.';
    }
    if (typeof totalDose === 'number') {
        return `Volume = ${totalDose} mg / ${doseProfile.concentrationMgMl} mg/mL = ${round(totalDose / doseProfile.concentrationMgMl, 2)} mL`;
    }
    const match = totalDose.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
    if (!match) return 'Volume requires mg-based total dose and product concentration.';
    const low = Number(match[1]);
    const high = Number(match[2]);
    return `Volume = ${low}-${high} mg / ${doseProfile.concentrationMgMl} mg/mL = ${round(low / doseProfile.concentrationMgMl, 2)}-${round(high / doseProfile.concentrationMgMl, 2)} mL`;
}

function formatDose(doseProfile: DoseProfile) {
    if (doseProfile.doseDisplay) return doseProfile.doseDisplay;
    return doseProfile.doseLow === doseProfile.doseHigh
        ? `${doseProfile.doseLow} mg/kg`
        : `${doseProfile.doseLow}-${doseProfile.doseHigh} mg/kg`;
}

function extractWeightKg(text: string) {
    const explicit = text.match(/\b(?:weight|wt|patient weight|patient_weight_kg)\D{0,24}(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i);
    if (explicit?.[1]) return normalizeWeight(Number(explicit[1]));
    const generic = text.match(/\b(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i);
    return generic?.[1] ? normalizeWeight(Number(generic[1])) : null;
}

function normalizeWeight(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return Math.min(value, 2500);
}

function inferPatientConditions(text: string) {
    const lower = text.toLowerCase();
    const conditions: string[] = [];
    if (/\bckd\b|\bkidney\b|\brenal\b|azot/i.test(lower)) conditions.push('renal_impairment');
    if (/\bhepatic\b|\bliver\b|icter/i.test(lower)) conditions.push('hepatic_disease');
    if (/\bdehydrat|\bhypovolem|shock\b/i.test(lower)) conditions.push('dehydration');
    if (/\bseizure|epilep/i.test(lower)) conditions.push('seizure_disorder');
    if (/\bpregnan|lactat/i.test(lower)) conditions.push('pregnancy');
    if (/\bulcer|melena|hematemesis/i.test(lower)) conditions.push('gi_ulceration');
    if (/\bobstruction|foreign body/i.test(lower)) conditions.push('gi_obstruction');
    return Array.from(new Set(conditions));
}

function round(value: number, digits = 1) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

export function buildEmptyPharmacOSProtocol(input: {
    species?: DetectedVetiosSpecies;
    condition?: string;
    patientWeightKg?: number;
}): PharmacOSProtocol {
    const species = isVetiosSpecies(input.species) ? input.species : 'canine';
    const condition = input.condition?.trim() || 'Current VetIOS treatment context';
    return {
        species,
        condition,
        patient_weight_kg: normalizeWeight(input.patientWeightKg) ?? 10,
        protocol_phase: 'complete',
        drugs: [],
        treatment_protocol: buildTreatmentProtocol(condition, species, []).sections,
        interaction_warnings: [],
        total_drugs: 0,
        protocol_source: buildTreatmentProtocol(condition, species, []).source,
    };
}
