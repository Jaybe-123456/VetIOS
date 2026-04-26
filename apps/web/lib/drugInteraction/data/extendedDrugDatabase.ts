/**
 * VetIOS Comprehensive Veterinary Drug Database
 *
 * Sources:
 * - Plumb's Veterinary Drug Handbook, 10th Edition (2023)
 * - Papich: Saunders Handbook of Veterinary Drugs, 5th Edition
 * - BSAVA Small Animal Formulary, 11th Edition (2023)
 * - Merck Veterinary Manual (current edition)
 * - WSAVA Pain Management Guidelines 2023
 * - ACVIM Consensus Guidelines
 * - ISFM Feline-specific guidelines
 * - FDA/EMA veterinary drug approvals
 * - Peer-reviewed pharmacokinetic studies (PubMed)
 */

import type { DrugProfile, DrugInteractionResult } from '../drugInteractionEngine';

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENDED DRUG DATABASE
// ═══════════════════════════════════════════════════════════════════════════════

export const EXTENDED_DRUG_DATABASE: Record<string, DrugProfile> = {

  // ═══════════════════════════════════════════════════════
  // NSAIDs & ANALGESICS
  // ═══════════════════════════════════════════════════════

  carprofen: {
    id: 'carprofen',
    genericName: 'Carprofen',
    brandNames: ['Rimadyl', 'Carprieve', 'Carprodyl'],
    drugClass: 'NSAID',
    speciesApproved: ['canine'],
    renalExcretion: true, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: true, corticosteroid: false, nephrotoxic: true, hepatotoxic: true,
    contraindicated: [
      { condition: 'renal_impairment', severity: 'contraindicated', evidence: 'NSAIDs reduce renal prostaglandin synthesis — contraindicated in renal insufficiency', mechanism: 'COX inhibition reduces GFR in compromised kidneys' },
      { condition: 'hepatic_disease', severity: 'contraindicated', evidence: 'Carprofen hepatotoxicity documented in Labrador Retrievers', mechanism: 'Idiosyncratic hepatic necrosis — breed-specific risk' },
      { condition: 'gi_ulceration', severity: 'contraindicated', evidence: 'COX-1 inhibition reduces gastroprotective prostaglandins', mechanism: 'Mucosal prostaglandin depletion' },
      { condition: 'coagulopathy', severity: 'major', evidence: 'Platelet COX-1 inhibition impairs thromboxane A2', mechanism: 'Antiplatelet effect' },
      { condition: 'dehydration', severity: 'contraindicated', evidence: 'NSAIDs in hypovolaemia cause AKI', mechanism: 'Renal hypoperfusion + prostaglandin blockade' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 2.2, max_mg_per_kg: 4.4, frequency: 'q12h-q24h', route: 'PO/SC', notes: 'Hepatic monitoring recommended — ALT at baseline, 2 weeks, monthly' },
    },
  },

  robenacoxib: {
    id: 'robenacoxib',
    genericName: 'Robenacoxib',
    brandNames: ['Onsior'],
    drugClass: 'COX-2 selective NSAID',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: true, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'renal_impairment', severity: 'major', evidence: 'COX-2 selectivity reduces but does not eliminate renal risk', mechanism: 'Residual COX-1/2 renal effects' },
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Hepatic metabolism required for clearance', mechanism: 'Drug accumulation in hepatic failure' },
      { condition: 'gi_ulceration', severity: 'major', evidence: 'Lower GI risk than non-selective NSAIDs but not zero', mechanism: 'Partial COX-1 sparing' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 1, max_mg_per_kg: 2.4, frequency: 'q24h', route: 'PO', notes: 'Max 6 days post-operatively in cats' },
      canine: { min_mg_per_kg: 1, max_mg_per_kg: 2, frequency: 'q24h', route: 'PO/SC', notes: 'Up to 3 days injectable, longer oral' },
    },
  },

  buprenorphine: {
    id: 'buprenorphine',
    genericName: 'Buprenorphine',
    brandNames: ['Vetergesic', 'Buprenex', 'Simbadol'],
    drugClass: 'Partial mu-opioid agonist',
    speciesApproved: ['feline', 'canine', 'equine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'respiratory_depression', severity: 'major', evidence: 'Opioids cause dose-dependent respiratory depression', mechanism: 'mu-receptor mediated respiratory centre inhibition' },
      { condition: 'head_trauma', severity: 'major', evidence: 'Opioids increase ICP via CO2 retention', mechanism: 'Hypercapnia-mediated cerebral vasodilation' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 0.02, max_mg_per_kg: 0.03, frequency: 'q6-8h', route: 'OTM/IV/IM', notes: 'OTM (oral transmucosal) highly effective in cats — bioavailability ~100%' },
      canine: { min_mg_per_kg: 0.02, max_mg_per_kg: 0.04, frequency: 'q6-8h', route: 'IV/IM/SC', notes: 'Poor oral bioavailability in dogs — parenteral only' },
    },
  },

  methadone: {
    id: 'methadone',
    genericName: 'Methadone',
    brandNames: ['Physeptone', 'Comfortan'],
    drugClass: 'Full mu-opioid agonist / NMDA antagonist',
    speciesApproved: ['feline', 'canine', 'equine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: true, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'cardiac_arrhythmia', severity: 'major', evidence: 'QTc prolongation documented — risk of torsades de pointes', mechanism: 'hERG potassium channel blockade' },
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Extensive hepatic metabolism — accumulation risk', mechanism: 'CYP3A4/2D6 dependent clearance' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 0.1, max_mg_per_kg: 0.5, frequency: 'q4-6h', route: 'IV/IM/SC', notes: 'Excellent perioperative analgesic — NMDA antagonism provides multimodal analgesia' },
      feline: { min_mg_per_kg: 0.1, max_mg_per_kg: 0.3, frequency: 'q4-6h', route: 'IV/IM', notes: 'Use with care — dysphoria possible in cats' },
    },
  },

  tramadol: {
    id: 'tramadol',
    genericName: 'Tramadol',
    brandNames: ['Ultram', 'Tramal'],
    drugClass: 'Weak opioid / serotonin-norepinephrine reuptake inhibitor',
    speciesApproved: ['canine'],
    renalExcretion: true, hepaticMetabolism: true, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'seizure_disorder', severity: 'major', evidence: 'Tramadol lowers seizure threshold', mechanism: 'Serotonergic and noradrenergic CNS effects' },
      { condition: 'serotonin_syndrome_risk', severity: 'contraindicated', evidence: 'Serotonin syndrome with MAOIs, SSRIs, TCAs', mechanism: 'Serotonin reuptake inhibition' },
      { condition: 'renal_impairment', severity: 'major', species: ['canine'], evidence: 'Active metabolite O-desmethyltramadol accumulates in renal failure', mechanism: 'Reduced renal clearance of active metabolite' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 2, max_mg_per_kg: 5, frequency: 'q8h', route: 'PO', notes: 'Efficacy debated — poor conversion to active metabolite in cats; avoid in feline' },
    },
  },

  gabapentin: {
    id: 'gabapentin',
    genericName: 'Gabapentin',
    brandNames: ['Neurontin'],
    drugClass: 'Alpha-2-delta calcium channel ligand / anticonvulsant',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: true, hepaticMetabolism: false, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'renal_impairment', severity: 'major', evidence: '100% renal excretion — dose reduction mandatory in CKD', mechanism: 'Accumulation causes sedation and ataxia' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 5, max_mg_per_kg: 10, frequency: 'q12h', route: 'PO', notes: 'Excellent anxiolytic for feline CKD patients. Reduce dose 50% if CrCl <30 mL/min' },
      canine: { min_mg_per_kg: 5, max_mg_per_kg: 20, frequency: 'q8-12h', route: 'PO', notes: 'Neuropathic pain, seizure adjunct' },
    },
  },

  // ═══════════════════════════════════════════════════════
  // ANTIBIOTICS
  // ═══════════════════════════════════════════════════════

  amoxicillin_clavulanate: {
    id: 'amoxicillin_clavulanate',
    genericName: 'Amoxicillin-Clavulanate',
    brandNames: ['Clavamox', 'Synulox', 'Augmentin'],
    drugClass: 'Beta-lactam + beta-lactamase inhibitor',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: true, hepaticMetabolism: false, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'penicillin_allergy', severity: 'contraindicated', evidence: 'Cross-reactivity with penicillin allergy', mechanism: 'Beta-lactam ring shared epitope' },
      { condition: 'severe_renal_impairment', severity: 'major', evidence: 'Renal excretion — dose interval extension needed', mechanism: 'Accumulation of amoxicillin and clavulanate' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 12.5, max_mg_per_kg: 25, frequency: 'q12h', route: 'PO', notes: 'Broad-spectrum first-line. Give with food to reduce GI upset' },
      canine: { min_mg_per_kg: 12.5, max_mg_per_kg: 25, frequency: 'q12h', route: 'PO/SC/IV', notes: 'Standard first-line antibiotic' },
    },
  },

  doxycycline: {
    id: 'doxycycline',
    genericName: 'Doxycycline',
    brandNames: ['Vibramycin', 'Ronaxan'],
    drugClass: 'Tetracycline antibiotic',
    speciesApproved: ['feline', 'canine', 'equine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Hepatic metabolism and biliary excretion — accumulation risk', mechanism: 'Reduced clearance in hepatic failure' },
      { condition: 'oesophageal_stricture_risk', severity: 'major', species: ['feline'], evidence: 'Oesophageal stricture documented in cats given dry doxycycline tablets', mechanism: 'Direct mucosal irritation — always follow with water' },
      { condition: 'pregnancy', severity: 'contraindicated', evidence: 'Tetracyclines cause dental staining and bone malformation in neonates', mechanism: 'Chelation of calcium in developing tissues' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 5, max_mg_per_kg: 10, frequency: 'q24h', route: 'PO', notes: 'ALWAYS follow tablet with 5-6mL water to prevent oesophageal stricture. Suspension preferred in cats' },
      canine: { min_mg_per_kg: 5, max_mg_per_kg: 10, frequency: 'q12-24h', route: 'PO/IV', notes: 'Drug of choice: Ehrlichia, Anaplasma, Rickettsia, Leptospira, Brucella, Mycoplasma' },
    },
  },

  metronidazole: {
    id: 'metronidazole',
    genericName: 'Metronidazole',
    brandNames: ['Flagyl'],
    drugClass: 'Nitroimidazole antibiotic/antiprotozoal',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: true,
    contraindicated: [
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Extensive hepatic metabolism — neurotoxic metabolite accumulation', mechanism: 'Reduced first-pass metabolism leads to CNS toxicity' },
      { condition: 'seizure_disorder', severity: 'major', evidence: 'Neurotoxicity at standard doses in epileptics', mechanism: 'GABA receptor antagonism at toxic concentrations' },
      { condition: 'pregnancy', severity: 'contraindicated', evidence: 'Teratogenic in rodents — avoid first trimester', mechanism: 'DNA strand disruption in rapidly dividing cells' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 7.5, max_mg_per_kg: 15, frequency: 'q12h', route: 'PO', notes: 'Very bitter taste — compliance issues. Max 5-7 days to avoid neurotoxicity' },
      canine: { min_mg_per_kg: 10, max_mg_per_kg: 25, frequency: 'q12h', route: 'PO/IV', notes: 'GI anaerobes, Giardia, clostridial overgrowth, hepatic encephalopathy' },
    },
  },

  marbofloxacin: {
    id: 'marbofloxacin',
    genericName: 'Marbofloxacin',
    brandNames: ['Marbocyl', 'Zeniquin'],
    drugClass: 'Fluoroquinolone antibiotic',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: true, hepaticMetabolism: false, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'juvenile', severity: 'major', species: ['canine'], evidence: 'Cartilage damage in growing animals', mechanism: 'Chelation of Mg2+ in cartilage matrix proteoglycans' },
      { condition: 'seizure_disorder', severity: 'major', evidence: 'Fluoroquinolones lower seizure threshold', mechanism: 'GABA-A receptor antagonism' },
      { condition: 'renal_impairment', severity: 'major', evidence: 'Renal excretion — dose reduction required', mechanism: 'Drug accumulation increases CNS and retinal toxicity risk' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 2, max_mg_per_kg: 2, frequency: 'q24h', route: 'PO', notes: 'Safer than enrofloxacin in cats — lower retinal toxicity risk at standard doses' },
      canine: { min_mg_per_kg: 2, max_mg_per_kg: 5, frequency: 'q24h', route: 'PO', notes: 'Respiratory, urinary, skin infections. Excellent tissue penetration' },
    },
  },

  clindamycin: {
    id: 'clindamycin',
    genericName: 'Clindamycin',
    brandNames: ['Antirobe', 'Dalacin'],
    drugClass: 'Lincosamide antibiotic',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'colitis', severity: 'contraindicated', evidence: 'Clindamycin-associated colitis — Clostridium difficile overgrowth', mechanism: 'Disruption of normal colonic flora' },
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Hepatic metabolism — reduced clearance', mechanism: 'Drug accumulation' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 11, max_mg_per_kg: 33, frequency: 'q24h', route: 'PO', notes: 'Drug of choice for Toxoplasma gondii. Excellent bone penetration' },
      canine: { min_mg_per_kg: 11, max_mg_per_kg: 33, frequency: 'q12h', route: 'PO/IM', notes: 'Anaerobes, Staph, dental/bone infections, Toxoplasma' },
    },
  },

  chloramphenicol: {
    id: 'chloramphenicol',
    genericName: 'Chloramphenicol',
    brandNames: ['Chloromycetin'],
    drugClass: 'Phenicol antibiotic',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: true,
    contraindicated: [
      { condition: 'bone_marrow_suppression', severity: 'contraindicated', evidence: 'Aplastic anaemia — dose-independent idiosyncratic and dose-dependent reversible anaemia', mechanism: 'Mitochondrial ribosome inhibition in haematopoietic cells' },
      { condition: 'neonatal', severity: 'contraindicated', evidence: 'Grey baby syndrome — fatal cardiovascular collapse', mechanism: 'Inability to glucuronidate chloramphenicol in neonates' },
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Hepatic glucuronidation required — cats particularly susceptible', mechanism: 'Cats deficient in glucuronyl transferase' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 12.5, max_mg_per_kg: 20, frequency: 'q12h', route: 'PO', notes: 'Reserve for resistant infections. ZOONOTIC RISK — use gloves (human aplastic anaemia risk from skin contact)' },
      canine: { min_mg_per_kg: 40, max_mg_per_kg: 50, frequency: 'q8h', route: 'PO/IV', notes: 'CNS penetration excellent — meningitis, brain abscess. Reserve for resistant cases' },
    },
  },

  // ═══════════════════════════════════════════════════════
  // ANTIPARASITICS
  // ═══════════════════════════════════════════════════════

  ivermectin: {
    id: 'ivermectin',
    genericName: 'Ivermectin',
    brandNames: ['Ivomec', 'Heartgard', 'Stromectol'],
    drugClass: 'Macrocyclic lactone antiparasitic',
    speciesApproved: ['canine', 'equine', 'bovine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'mdr1_mutation', severity: 'contraindicated', species: ['canine'], evidence: 'ABCB1/MDR1 mutation causes blood-brain barrier ivermectin accumulation — fatal CNS toxicity', mechanism: 'P-glycoprotein deficiency allows ivermectin CNS penetration' },
      { condition: 'feline_species', severity: 'contraindicated', species: ['feline'], evidence: 'Cats lack adequate P-glycoprotein protection — highly toxic at canine doses', mechanism: 'CNS accumulation causing tremors, blindness, coma' },
      { condition: 'heartworm_microfilaremia', severity: 'major', evidence: 'Rapid microfilariae kill can cause anaphylactic reaction', mechanism: 'Rapid antigen release from dying microfilariae' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 0.006, max_mg_per_kg: 0.012, frequency: 'q30d', route: 'PO', notes: 'Heartworm prevention dose only. HIGH DOSE for demodex (0.3-0.6 mg/kg) ONLY after negative MDR1 test. ALWAYS test Collies/Shelties/Aussies before use' },
    },
  },

  fenbendazole: {
    id: 'fenbendazole',
    genericName: 'Fenbendazole',
    brandNames: ['Panacur', 'Safe-Guard'],
    drugClass: 'Benzimidazole anthelmintic',
    speciesApproved: ['feline', 'canine', 'equine', 'bovine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'pregnancy_first_trimester', severity: 'major', evidence: 'Teratogenic potential at high doses in some species', mechanism: 'Tubulin polymerisation inhibition in rapidly dividing cells' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 50, max_mg_per_kg: 50, frequency: 'q24h x 3-5 days', route: 'PO', notes: 'Toxocara, Ancylostoma, Trichuris, Giardia. Safe in pregnancy after first trimester' },
      canine: { min_mg_per_kg: 50, max_mg_per_kg: 50, frequency: 'q24h x 3-5 days', route: 'PO', notes: 'Broad-spectrum. Lungworm (Angiostrongylus): 25 mg/kg q24h x 21 days' },
    },
  },

  praziquantel: {
    id: 'praziquantel',
    genericName: 'Praziquantel',
    brandNames: ['Droncit', 'Drontal'],
    drugClass: 'Isoquinoline antiparasitic (cestocide)',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'age_under_4_weeks', severity: 'contraindicated', evidence: 'Immature hepatic metabolism in neonates', mechanism: 'Drug accumulation' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 5, max_mg_per_kg: 10, frequency: 'single dose', route: 'PO/SC', notes: 'Tapeworms (Dipylidium, Taenia, Echinococcus). Repeat in 3 weeks for heavy burdens' },
      canine: { min_mg_per_kg: 5, max_mg_per_kg: 10, frequency: 'single dose', route: 'PO/SC', notes: 'All cestode species including Echinococcus granulosus (zoonotic)' },
    },
  },

  // ═══════════════════════════════════════════════════════
  // CARDIOVASCULAR
  // ═══════════════════════════════════════════════════════

  atenolol: {
    id: 'atenolol',
    genericName: 'Atenolol',
    brandNames: ['Tenormin'],
    drugClass: 'Cardioselective beta-1 blocker',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: true, hepaticMetabolism: false, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'cardiogenic_shock', severity: 'contraindicated', evidence: 'Negative inotropy worsens cardiogenic shock', mechanism: 'Beta-1 blockade reduces cardiac output' },
      { condition: 'bradycardia', severity: 'contraindicated', evidence: 'Exacerbates existing bradycardia', mechanism: 'SA node suppression' },
      { condition: 'asthma', severity: 'contraindicated', species: ['feline'], evidence: 'Beta-2 blockade causes bronchoconstriction in asthmatic cats', mechanism: 'Beta-2 receptor blockade in bronchial smooth muscle' },
      { condition: 'renal_impairment', severity: 'major', evidence: '100% renal excretion — dose reduction required', mechanism: 'Drug accumulation' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 2, max_mg_per_kg: 2, frequency: 'q12h', route: 'PO', notes: 'HCM, hyperthyroidism. Fixed dose: 6.25 mg/cat q12h' },
      canine: { min_mg_per_kg: 0.25, max_mg_per_kg: 1, frequency: 'q12-24h', route: 'PO', notes: 'SVT, atrial fibrillation rate control' },
    },
  },

  digoxin: {
    id: 'digoxin',
    genericName: 'Digoxin',
    brandNames: ['Lanoxin', 'Cardoxin'],
    drugClass: 'Cardiac glycoside',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: true, hepaticMetabolism: false, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'renal_impairment', severity: 'contraindicated', evidence: 'Narrow therapeutic index — renal failure causes rapid toxicity', mechanism: 'Renal excretion — accumulation causes arrhythmia, vomiting, bradycardia' },
      { condition: 'hypokalaemia', severity: 'contraindicated', evidence: 'Hypokalaemia potentiates digoxin toxicity', mechanism: 'K+ competes with digoxin at Na/K-ATPase — low K+ increases binding' },
      { condition: 'hypertrophic_cardiomyopathy', severity: 'contraindicated', evidence: 'Positive inotropy worsens LVOT obstruction in HCM', mechanism: 'Increased contractility narrows dynamic LVOT obstruction' },
      { condition: 'ventricular_arrhythmia', severity: 'contraindicated', evidence: 'Proarrhythmic — worsens ventricular ectopy', mechanism: 'Increased automaticity of Purkinje fibres' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 0.0022, max_mg_per_kg: 0.0044, frequency: 'q12h', route: 'PO', notes: 'NARROW THERAPEUTIC INDEX. Monitor serum levels 0.8-2.0 ng/mL. Lean body weight dosing. Avoid in cats if possible' },
    },
  },

  pimobendan: {
    id: 'pimobendan',
    genericName: 'Pimobendan',
    brandNames: ['Vetmedin'],
    drugClass: 'Phosphodiesterase III inhibitor / calcium sensitiser',
    speciesApproved: ['canine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'hypertrophic_cardiomyopathy', severity: 'contraindicated', evidence: 'Positive inotropy contraindicated in feline HCM with LVOT obstruction', mechanism: 'Worsens dynamic LVOT obstruction' },
      { condition: 'aortic_stenosis', severity: 'contraindicated', evidence: 'Fixed obstruction — increased inotropy does not overcome stenosis', mechanism: 'Increased O2 demand without improved output' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 0.2, max_mg_per_kg: 0.3, frequency: 'q12h', route: 'PO', notes: 'GIVE ON EMPTY STOMACH — 1 hour before feeding. MMVD and DCM. EPIC trial: start pre-clinical MMVD (LA:Ao >1.6 + cardiac enlargement)' },
    },
  },

  // ═══════════════════════════════════════════════════════
  // ENDOCRINE
  // ═══════════════════════════════════════════════════════

  methimazole: {
    id: 'methimazole',
    genericName: 'Methimazole',
    brandNames: ['Felimazole', 'Tapazole', 'Thyrozol'],
    drugClass: 'Thionamide antithyroid agent',
    speciesApproved: ['feline'],
    renalExcretion: true, hepaticMetabolism: true, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: true,
    contraindicated: [
      { condition: 'agranulocytosis', severity: 'contraindicated', evidence: 'Life-threatening agranulocytosis — CBC monitoring mandatory', mechanism: 'Myelosuppression — idiosyncratic' },
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Hepatotoxicity documented — monitor liver enzymes', mechanism: 'Hepatic metabolism with potential for hepatic necrosis' },
      { condition: 'masked_renal_disease', severity: 'major', species: ['feline'], evidence: 'Hyperthyroidism masks CKD — GFR normalises (drops) when treated. Pre-existing CKD may be unmasked', mechanism: 'Hyperthyroid state increases GFR via elevated CO and renal hyperfiltration' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 1.25, max_mg_per_kg: 2.5, frequency: 'q12h', route: 'PO/transdermal', notes: 'Start 2.5 mg q12h, recheck T4 + renal panel in 2-4 weeks. ALWAYS check renal function before and after. Transdermal less effective' },
    },
  },

  trilostane: {
    id: 'trilostane',
    genericName: 'Trilostane',
    brandNames: ['Vetoryl'],
    drugClass: '3-beta-hydroxysteroid dehydrogenase inhibitor',
    speciesApproved: ['canine', 'feline'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'hypoadrenocorticism', severity: 'contraindicated', evidence: 'Can precipitate adrenal crisis by blocking cortisol synthesis', mechanism: '3-beta-HSD inhibition — complete adrenal blockade' },
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Hepatic metabolism — reduced clearance and accumulation', mechanism: 'Impaired CYP-mediated clearance' },
      { condition: 'pregnancy', severity: 'contraindicated', evidence: 'Blocks progesterone synthesis — abortion risk', mechanism: '3-beta-HSD inhibition affects reproductive steroid synthesis' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 2, max_mg_per_kg: 10, frequency: 'q24h', route: 'PO', notes: 'PDH and adrenal-dependent HAC. Start 1-2 mg/kg q24h with food. ACTH stim at 10 days, 4 weeks, 3 months. Target post-ACTH cortisol 40-150 nmol/L' },
    },
  },

  insulin_glargine: {
    id: 'insulin_glargine',
    genericName: 'Insulin Glargine',
    brandNames: ['Lantus', 'Basaglar'],
    drugClass: 'Long-acting insulin analogue',
    speciesApproved: ['feline'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'hypoglycaemia', severity: 'contraindicated', evidence: 'Do not administer if glucose <5 mmol/L (90 mg/dL)', mechanism: 'Potentiates hypoglycaemia' },
      { condition: 'hypokalaemia', severity: 'major', evidence: 'Insulin drives K+ intracellularly — worsens hypokalaemia', mechanism: 'Na/K-ATPase activation by insulin' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 0, max_mg_per_kg: 0, frequency: 'q12h', route: 'SC', notes: 'FELINE DIABETES FIRST-LINE. Start 1-2 IU/cat q12h regardless of weight. Target nadir glucose 4-8 mmol/L. Remission possible with tight control in newly diagnosed cats' },
    },
  },

  // ═══════════════════════════════════════════════════════
  // CORTICOSTEROIDS
  // ═══════════════════════════════════════════════════════

  dexamethasone: {
    id: 'dexamethasone',
    genericName: 'Dexamethasone',
    brandNames: ['Dexafort', 'Azium'],
    drugClass: 'Potent synthetic corticosteroid',
    speciesApproved: ['feline', 'canine', 'equine', 'bovine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: true, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'systemic_infection', severity: 'contraindicated', evidence: 'Immunosuppression worsens bacterial, fungal, viral infections', mechanism: 'T-cell suppression, neutrophil function impairment' },
      { condition: 'diabetes_mellitus', severity: 'major', evidence: 'Glucocorticoids cause insulin resistance and hyperglycaemia', mechanism: 'Hepatic gluconeogenesis upregulation, peripheral insulin resistance' },
      { condition: 'gi_ulceration', severity: 'major', evidence: 'Reduces mucosal prostaglandin synthesis and mucus production', mechanism: 'Phospholipase A2 inhibition reduces arachidonic acid availability' },
      { condition: 'hyperadrenocorticism', severity: 'contraindicated', evidence: 'Exacerbates existing cortisol excess', mechanism: 'Additive glucocorticoid effect' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 0.05, max_mg_per_kg: 0.15, frequency: 'varies', route: 'IV/IM/PO', notes: 'Anti-inflammatory: 0.1-0.2 mg/kg. Shock/spinal: 1-2 mg/kg IV once. 5-7x more potent than prednisolone. No mineralocorticoid effect' },
      canine: { min_mg_per_kg: 0.05, max_mg_per_kg: 0.15, frequency: 'varies', route: 'IV/IM/PO', notes: 'LDDS/HDDS test: 0.01-0.1 mg/kg IV. Anti-inflammatory: 0.1-0.2 mg/kg' },
    },
  },

  // ═══════════════════════════════════════════════════════
  // GI DRUGS
  // ═══════════════════════════════════════════════════════

  omeprazole: {
    id: 'omeprazole',
    genericName: 'Omeprazole',
    brandNames: ['Prilosec', 'Losec', 'Gastrogard'],
    drugClass: 'Proton pump inhibitor',
    speciesApproved: ['feline', 'canine', 'equine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'hypomagnesaemia', severity: 'major', evidence: 'Long-term PPI use causes hypomagnesaemia', mechanism: 'Impaired intestinal Mg2+ absorption via TRPM6/7 channels' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 0.7, max_mg_per_kg: 1, frequency: 'q24h', route: 'PO', notes: 'Give 30-60 min before feeding for maximum effect. Enteric-coated — do NOT crush' },
      canine: { min_mg_per_kg: 0.5, max_mg_per_kg: 1, frequency: 'q24h', route: 'PO/IV', notes: 'Mast cell tumour acid hypersecretion, gastric ulcers, NSAID protection' },
    },
  },

  maropitant: {
    id: 'maropitant',
    genericName: 'Maropitant',
    brandNames: ['Cerenia'],
    drugClass: 'NK-1 receptor antagonist (antiemetic)',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'gi_obstruction', severity: 'contraindicated', evidence: 'Antiemetics mask signs of obstruction — diagnosis delayed', mechanism: 'Vomiting is a protective reflex in obstruction' },
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Extensive hepatic metabolism — prolonged drug effect', mechanism: 'Reduced CYP3A12 clearance in hepatic failure' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 1, max_mg_per_kg: 1, frequency: 'q24h', route: 'SC/PO', notes: 'SC injection painful — use smallest volume, warm to body temperature' },
      canine: { min_mg_per_kg: 1, max_mg_per_kg: 2, frequency: 'q24h', route: 'SC/PO/IV', notes: 'Gold standard antiemetic. 2 mg/kg PO for motion sickness — give 2h before travel' },
    },
  },

  // ═══════════════════════════════════════════════════════
  // DIURETICS & CARDIAC RENAL
  // ═══════════════════════════════════════════════════════

  torsemide: {
    id: 'torsemide',
    genericName: 'Torsemide',
    brandNames: ['Demadex', 'Torasemide'],
    drugClass: 'Loop diuretic',
    speciesApproved: ['canine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'hypovolaemia', severity: 'contraindicated', evidence: 'Worsens volume depletion and prerenal azotaemia', mechanism: 'Loop diuresis' },
      { condition: 'anuric_renal_failure', severity: 'contraindicated', evidence: 'No tubular fluid to act on — ineffective and harmful', mechanism: 'Requires tubular secretion for activity' },
      { condition: 'hepatic_coma', severity: 'major', evidence: 'Electrolyte imbalances worsen hepatic encephalopathy', mechanism: 'Hypokalaemia increases ammonia toxicity' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 0.1, max_mg_per_kg: 0.3, frequency: 'q24h', route: 'PO', notes: '1 mg torsemide ≈ 4 mg furosemide. QUEST trial: superior to furosemide for CHF survival. Once-daily dosing advantage' },
    },
  },

  spironolactone: {
    id: 'spironolactone',
    genericName: 'Spironolactone',
    brandNames: ['Aldactone', 'Prilactone'],
    drugClass: 'Aldosterone antagonist (potassium-sparing diuretic)',
    speciesApproved: ['canine', 'feline'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'hyperkalaemia', severity: 'contraindicated', evidence: 'Potassium-sparing — worsens existing hyperkalaemia', mechanism: 'Aldosterone blockade retains K+' },
      { condition: 'renal_impairment', severity: 'major', evidence: 'Risk of hyperkalaemia increases with reduced GFR', mechanism: 'Reduced renal K+ excretion' },
      { condition: 'feline_skin_disease', severity: 'major', species: ['feline'], evidence: 'Facial/ulcerative dermatitis documented in cats on spironolactone', mechanism: 'Unknown idiosyncratic reaction' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 1, max_mg_per_kg: 2, frequency: 'q12h', route: 'PO', notes: 'CHF adjunct — anti-aldosterone cardioprotection. Monitor electrolytes monthly' },
    },
  },

  // ═══════════════════════════════════════════════════════
  // ONCOLOGY
  // ═══════════════════════════════════════════════════════

  vincristine: {
    id: 'vincristine',
    genericName: 'Vincristine',
    brandNames: ['Oncovin'],
    drugClass: 'Vinca alkaloid (microtubule inhibitor)',
    speciesApproved: ['canine', 'feline'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: true,
    contraindicated: [
      { condition: 'intrathecal_route', severity: 'contraindicated', evidence: 'FATAL if given intrathecally — rapid fatal encephalomyelopathy', mechanism: 'Direct CNS neurotoxicity' },
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Extensive hepatic metabolism — increased neurotoxicity risk', mechanism: 'Reduced biliary excretion — drug accumulation' },
      { condition: 'peripheral_neuropathy', severity: 'major', evidence: 'Vincristine causes peripheral neurotoxicity — worsens existing neuropathy', mechanism: 'Microtubule disruption in peripheral neurons' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 0, max_mg_per_kg: 0, frequency: 'q7d', route: 'IV slow infusion', notes: 'FIXED DOSE: 0.5-0.75 mg/m² IV. NEVER give IV push. NEVER intrathecal. CHOP protocol lymphoma, TVT, IMT' },
    },
  },

  chlorambucil: {
    id: 'chlorambucil',
    genericName: 'Chlorambucil',
    brandNames: ['Leukeran'],
    drugClass: 'Alkylating agent',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'bone_marrow_suppression', severity: 'contraindicated', evidence: 'Myelosuppression — neutropenia, thrombocytopenia', mechanism: 'DNA alkylation of haematopoietic progenitors' },
      { condition: 'seizure_disorder', severity: 'major', species: ['feline'], evidence: 'Seizures documented in cats at higher doses', mechanism: 'Neurotoxicity mechanism not fully elucidated' },
      { condition: 'pregnancy', severity: 'contraindicated', evidence: 'Teratogenic and embryotoxic', mechanism: 'DNA alkylation of embryonic cells' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 0, max_mg_per_kg: 0, frequency: 'q48h or pulse', route: 'PO', notes: 'FIXED DOSE: 2 mg/cat q48h OR pulse 20 mg/m² q2 weeks. Feline IBD/low-grade lymphoma with prednisolone. Handle with gloves — CHEMOTHERAPY' },
      canine: { min_mg_per_kg: 0.1, max_mg_per_kg: 0.2, frequency: 'q24h', route: 'PO', notes: 'CLL, low-grade lymphoma. CBC every 2-3 weeks' },
    },
  },

  // ═══════════════════════════════════════════════════════
  // ANAESTHESIA / SEDATION
  // ═══════════════════════════════════════════════════════

  ketamine: {
    id: 'ketamine',
    genericName: 'Ketamine',
    brandNames: ['Ketaset', 'Vetalar'],
    drugClass: 'Dissociative anaesthetic / NMDA antagonist',
    speciesApproved: ['feline', 'canine', 'equine'],
    renalExcretion: true, hepaticMetabolism: true, proteinBound: false,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'hypertrophic_cardiomyopathy', severity: 'contraindicated', species: ['feline'], evidence: 'Sympathomimetic effects increase HR and BP — worsens HCM', mechanism: 'Catecholamine release increases myocardial O2 demand' },
      { condition: 'increased_icp', severity: 'contraindicated', evidence: 'Increases intracranial pressure via cerebral vasodilation', mechanism: 'Increased cerebral blood flow' },
      { condition: 'hypertension', severity: 'major', evidence: 'Ketamine stimulates SNS — increases HR, BP, CO', mechanism: 'Catecholamine reuptake inhibition' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 5, max_mg_per_kg: 10, frequency: 'single/CRI', route: 'IV/IM', notes: 'IM sedation: 10-20 mg/kg. ALWAYS combine with benzodiazepine or alpha-2 agonist. CRI analgesia: 0.1-0.6 mg/kg/h' },
      canine: { min_mg_per_kg: 5, max_mg_per_kg: 10, frequency: 'single/CRI', route: 'IV/IM', notes: 'Induction: 5-10 mg/kg IV after premedication. CRI analgesia: 0.1-0.6 mg/kg/h. Avoid alone — causes dysphoria' },
    },
  },

  medetomidine: {
    id: 'medetomidine',
    genericName: 'Medetomidine',
    brandNames: ['Domitor', 'Medetor'],
    drugClass: 'Alpha-2 adrenoceptor agonist (sedative)',
    speciesApproved: ['feline', 'canine'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'cardiovascular_disease', severity: 'contraindicated', evidence: 'Alpha-2 agonists cause marked initial hypertension then bradycardia — dangerous in cardiac disease', mechanism: 'Peripheral vasoconstriction then reflex bradycardia — reduced CO' },
      { condition: 'hepatic_disease', severity: 'major', evidence: 'Hepatic metabolism — prolonged sedation', mechanism: 'Impaired CYP-mediated clearance' },
      { condition: 'respiratory_disease', severity: 'major', evidence: 'Respiratory depression in compromised patients', mechanism: 'CNS depression via alpha-2 receptors in respiratory centres' },
      { condition: 'pregnancy', severity: 'major', evidence: 'Uterine contractions documented — uteroplacental vasoconstriction', mechanism: 'Alpha-2 mediated uterine smooth muscle effects' },
    ],
    standardDoses: {
      feline: { min_mg_per_kg: 0.01, max_mg_per_kg: 0.08, frequency: 'single', route: 'IM/IV', notes: 'Reversible with atipamezole (5x the medetomidine dose IM). Combine with butorphanol or ketamine for balanced anaesthesia' },
      canine: { min_mg_per_kg: 0.01, max_mg_per_kg: 0.04, frequency: 'single', route: 'IM/IV', notes: 'Reversible with atipamezole. Monitor SpO2 and BP. Avoid in brachycephalic breeds' },
    },
  },

  propofol: {
    id: 'propofol',
    genericName: 'Propofol',
    brandNames: ['Rapinovet', 'PropoFlo'],
    drugClass: 'Short-acting IV anaesthetic (GABA-A agonist)',
    speciesApproved: ['canine', 'feline'],
    renalExcretion: false, hepaticMetabolism: true, proteinBound: true,
    qtProlonging: false, nsaid: false, corticosteroid: false, nephrotoxic: false, hepatotoxic: false,
    contraindicated: [
      { condition: 'feline_repeated_dosing', severity: 'major', species: ['feline'], evidence: 'Heinz body anaemia with repeated propofol dosing in cats — oxidative damage', mechanism: 'Cats have limited capacity to conjugate phenol metabolites' },
      { condition: 'hypovolaemia', severity: 'major', evidence: 'Profound hypotension with bolus dosing in hypovolaemic patients', mechanism: 'Vasodilation and cardiac depression' },
      { condition: 'egg_soya_allergy', severity: 'contraindicated', evidence: 'Formulated in soybean oil and egg lecithin', mechanism: 'Allergenic components in emulsion' },
    ],
    standardDoses: {
      canine: { min_mg_per_kg: 4, max_mg_per_kg: 6, frequency: 'single induction', route: 'IV slow', notes: 'Titrate to effect — give 25% of dose, wait 30s, then remainder. CRI: 0.1-0.4 mg/kg/min. Have intubation ready' },
      feline: { min_mg_per_kg: 4, max_mg_per_kg: 8, frequency: 'single induction', route: 'IV slow', notes: 'Avoid repeated dosing — Heinz body anaemia risk. Alfaxalone preferred for repeated feline inductions' },
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENDED DRUG-DRUG INTERACTION MATRIX
// Evidence-based from peer-reviewed literature + major formularies
// ═══════════════════════════════════════════════════════════════════════════════

export const EXTENDED_DRUG_INTERACTIONS: DrugInteractionResult[] = [

  // ── NSAID combinations ──────────────────────────────────────────────────────
  {
    drug1: 'carprofen', drug2: 'prednisolone', severity: 'contraindicated',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'GI ulceration and perforation — combined COX-1 inhibition and reduced mucosal prostaglandin synthesis',
    managementRecommendation: 'Never co-administer. Washout period 5-7 days minimum between NSAID and corticosteroid.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['Lascelles et al. Vet Anaesth Analg 2005', 'KuKanich et al. JAVMA 2012'],
  },
  {
    drug1: 'carprofen', drug2: 'meloxicam', severity: 'contraindicated',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'NSAID-on-NSAID — additive GI, renal, and hepatic toxicity with no additional analgesic benefit',
    managementRecommendation: 'Never combine two NSAIDs. 5-7 day washout between different NSAIDs.',
    evidence: 'published_study', speciesRelevant: true,
    references: ["Plumb's Veterinary Drug Handbook 10th Ed"],
  },
  {
    drug1: 'robenacoxib', drug2: 'prednisolone', severity: 'contraindicated',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'GI ulceration risk — lower than non-selective NSAID but still clinically significant',
    managementRecommendation: 'Avoid combination. If both required, maximise gastroprotection with omeprazole.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['BSAVA Small Animal Formulary 11th Ed'],
  },
  {
    drug1: 'carprofen', drug2: 'furosemide', severity: 'moderate',
    mechanism: 'renal_toxicity_additive',
    clinicalEffect: 'NSAIDs reduce renal prostaglandin-mediated compensation for diuretic-induced volume depletion — AKI risk',
    managementRecommendation: 'Avoid in patients with renal compromise. Monitor renal values. Ensure adequate hydration.',
    evidence: 'pharmacokinetic', speciesRelevant: true,
    references: ['Silverstein & Hopper: Small Animal Critical Care Medicine'],
  },

  // ── Fluoroquinolone interactions ────────────────────────────────────────────
  {
    drug1: 'enrofloxacin', drug2: 'theophylline', severity: 'major',
    mechanism: 'cyp_inhibition',
    clinicalEffect: 'Enrofloxacin inhibits CYP1A2-mediated theophylline metabolism — theophylline toxicity (vomiting, tachycardia, seizures)',
    managementRecommendation: 'Reduce theophylline dose 30-50% or use alternative antibiotic. Monitor for toxicity signs.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['Intorre et al. JVPT 1995', 'Papich: Saunders Handbook 5th Ed'],
  },
  {
    drug1: 'marbofloxacin', drug2: 'antacids', severity: 'moderate',
    mechanism: 'protein_binding_displacement',
    clinicalEffect: 'Divalent cations (Ca2+, Mg2+, Al3+) chelate fluoroquinolones — GI absorption reduced 50-70%',
    managementRecommendation: 'Administer fluoroquinolone 2h before or 4h after antacids/sucralfate.',
    evidence: 'pharmacokinetic', speciesRelevant: true,
    references: ['Lefebvre et al. Vet Microbiol 1998'],
  },

  // ── Cardiac drug interactions ───────────────────────────────────────────────
  {
    drug1: 'digoxin', drug2: 'furosemide', severity: 'major',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Furosemide-induced hypokalaemia potentiates digoxin toxicity — arrhythmia risk',
    managementRecommendation: 'Monitor electrolytes closely. Supplement potassium. Monitor digoxin levels (target 0.8-2.0 ng/mL).',
    evidence: 'published_study', speciesRelevant: true,
    references: ['Kittleson: Small Animal Cardiovascular Medicine'],
  },
  {
    drug1: 'digoxin', drug2: 'spironolactone', severity: 'moderate',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Spironolactone reduces renal digoxin excretion — digoxin level increases 20-30%',
    managementRecommendation: 'Reduce digoxin dose when adding spironolactone. Recheck digoxin levels after 1 week.',
    evidence: 'pharmacokinetic', speciesRelevant: true,
    references: ["Plumb's Veterinary Drug Handbook 10th Ed"],
  },
  {
    drug1: 'atenolol', drug2: 'medetomidine', severity: 'major',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Severe bradycardia and AV block — both drugs reduce HR and AV conduction independently',
    managementRecommendation: 'Avoid combination. If unavoidable, have atipamezole, atropine, and resuscitation equipment ready.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['Pypendop & Verstegen. JVIM 1998'],
  },
  {
    drug1: 'pimobendan', drug2: 'atenolol', severity: 'moderate',
    mechanism: 'pharmacodynamic_antagonism',
    clinicalEffect: 'Beta-blockade reduces pimobendan positive inotropic and chronotropic effects — reduced clinical benefit',
    managementRecommendation: 'Monitor for reduced efficacy of pimobendan. Combination sometimes used in HCM protocols.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['ACVIM CHF Consensus Guidelines 2019'],
  },
  {
    drug1: 'amlodipine', drug2: 'benazepril', severity: 'minor',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Deliberate combination for feline hypertension with proteinuria — additive BP lowering and renoprotection',
    managementRecommendation: 'Standard combination for feline CKD hypertension. Monitor BP and renal values monthly.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['IRIS CKD Hypertension Guidelines 2023', 'Huhtinen et al. JVIM 2015'],
  },
  {
    drug1: 'benazepril', drug2: 'spironolactone', severity: 'moderate',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Both reduce aldosterone effects — hyperkalaemia risk, especially in renal insufficiency',
    managementRecommendation: 'Monitor K+ at 1 week and monthly. Target K+ 4.0-5.5 mmol/L. Reduce spironolactone if K+ >5.5.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['ACVIM CHF Consensus 2019', 'Bernay et al. JVIM 2010'],
  },

  // ── Opioid interactions ─────────────────────────────────────────────────────
  {
    drug1: 'methadone', drug2: 'medetomidine', severity: 'moderate',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Profound CNS and respiratory depression — marked sedation and analgesia (clinically used perioperatively)',
    managementRecommendation: 'Monitor SpO2, RR, HR continuously. Have reversal agents (naloxone, atipamezole) available.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['Bortolami & Love. J Feline Med Surg 2015'],
  },

  // ── Antibiotic interactions ─────────────────────────────────────────────────
  {
    drug1: 'metronidazole', drug2: 'phenobarbital', severity: 'major',
    mechanism: 'cyp_inhibition',
    clinicalEffect: 'Phenobarbital induces CYP enzymes — accelerates metronidazole metabolism reducing efficacy; metronidazole may also raise phenobarbital levels',
    managementRecommendation: 'Consider alternative antibiotic in epileptic patients on phenobarbital.',
    evidence: 'pharmacokinetic', speciesRelevant: true,
    references: ['Papich: Saunders Handbook 5th Ed'],
  },
  {
    drug1: 'clindamycin', drug2: 'metronidazole', severity: 'minor',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Both active against anaerobes — overlapping spectrum with no additional benefit and possible additive GI side effects',
    managementRecommendation: 'Use one agent for anaerobic infections — not both.',
    evidence: 'pharmacokinetic', speciesRelevant: true,
    references: ['BSAVA Small Animal Formulary 11th Ed'],
  },
  {
    drug1: 'doxycycline', drug2: 'amoxicillin_clavulanate', severity: 'moderate',
    mechanism: 'pharmacodynamic_antagonism',
    clinicalEffect: 'Bacteriostatic (doxycycline) + bactericidal (amoxicillin) antagonism — tetracyclines may reduce killing activity of beta-lactams',
    managementRecommendation: 'Avoid routine combination. In specific infections (tick-borne co-infections) benefit may outweigh theoretical antagonism.',
    evidence: 'pharmacokinetic', speciesRelevant: true,
    references: ['Papich: Saunders Handbook 5th Ed'],
  },

  // ── Endocrine interactions ──────────────────────────────────────────────────
  {
    drug1: 'methimazole', drug2: 'prednisolone', severity: 'moderate',
    mechanism: 'pharmacodynamic_antagonism',
    clinicalEffect: 'Prednisolone causes leukocytosis masking methimazole-induced agranulocytosis — CBC monitoring more difficult to interpret',
    managementRecommendation: 'Neutrophil count <2500/uL warrants methimazole withdrawal regardless of total WBC.',
    evidence: 'theoretical', speciesRelevant: true,
    references: ["Plumb's Veterinary Drug Handbook 10th Ed"],
  },
  {
    drug1: 'trilostane', drug2: 'benazepril', severity: 'moderate',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Both drugs reduce blood pressure — hypotension risk during dose adjustment phase',
    managementRecommendation: 'Monitor BP during dose adjustment. Hypotension warrants trilostane dose reduction.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['Atkinson et al. JVIM 2018'],
  },

  // ── Anaesthetic interactions ────────────────────────────────────────────────
  {
    drug1: 'ketamine', drug2: 'medetomidine', severity: 'minor',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Deliberate combination for TIVA/chemical restraint — medetomidine blunts ketamine sympathomimetic effects',
    managementRecommendation: 'Standard combination. Monitor HR, BP, SpO2. Reverse medetomidine with atipamezole post-procedure.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['Bortolami & Love. J Feline Med Surg 2015', 'Lin et al. JAVMA 1993'],
  },
  {
    drug1: 'propofol', drug2: 'medetomidine', severity: 'moderate',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Additive CNS and respiratory depression — propofol dose requirement reduced 30-50% after medetomidine premedication',
    managementRecommendation: 'Reduce propofol induction dose 30-50%. Titrate slowly. Have ventilation support ready.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['Lerche & Muir. JAVMA 2006'],
  },
  {
    drug1: 'methadone', drug2: 'propofol', severity: 'moderate',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Opioid premedication reduces propofol induction dose requirement (neuroleptanalgesic synergy)',
    managementRecommendation: 'Reduce propofol dose 25-50% after opioid premedication. Titrate to effect.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['Bortolami & Love. J Feline Med Surg 2015'],
  },

  // ── Renal / CKD-specific interactions ──────────────────────────────────────
  {
    drug1: 'gabapentin', drug2: 'meloxicam', severity: 'minor',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Complementary multimodal analgesia. Gabapentin preferred over meloxicam in CKD cats — no pharmacokinetic interaction',
    managementRecommendation: 'Gabapentin is recommended analgesic in feline CKD. Reduce gabapentin dose 50% if CrCl <30 mL/min.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['ISFM Feline CKD Guidelines 2023', 'Quimby et al. JVIM 2015'],
  },

  // ── Oncology interactions ───────────────────────────────────────────────────
  {
    drug1: 'chlorambucil', drug2: 'prednisolone', severity: 'minor',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Standard protocol for feline low-grade lymphoma and IBD — deliberate combination. Combined immunosuppression as intended.',
    managementRecommendation: 'Standard of care. Monitor for infections, GI signs, glucose (diabetogenic effect of prednisolone).',
    evidence: 'published_study', speciesRelevant: true,
    references: ['Fondacaro et al. JVIM 1999', 'Gregory et al. JVIM 2010'],
  },
  {
    drug1: 'omeprazole', drug2: 'prednisolone', severity: 'minor',
    mechanism: 'pharmacodynamic_synergy',
    clinicalEffect: 'Gastroprotective combination — omeprazole mitigates corticosteroid-induced GI mucosal injury',
    managementRecommendation: 'Beneficial co-administration for patients on long-term corticosteroids.',
    evidence: 'published_study', speciesRelevant: true,
    references: ['WSAVA GI guidelines 2023'],
  },
];
