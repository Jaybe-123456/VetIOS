import { createClient } from '@supabase/supabase-js';
import {
    drugFormularyRecordSchema,
    type DrugFormularyRecord,
    type DrugInteractionRecord,
} from '@vetios/pharmacos';

const BASE_ORGAN_ADJUSTMENTS = {
    renal: {
        mild: { dose_pct: 100, interval_multiplier: 1, monitoring_frequency: 'Baseline creatinine/BUN or SDMA; recheck if course exceeds 72h.' },
        moderate: { dose_pct: 75, interval_multiplier: 1.5, monitoring_frequency: 'Recheck renal markers within 24-48h.' },
        severe: { dose_pct: 50, interval_multiplier: 2, monitoring_frequency: 'Avoid unless benefit is compelling; daily renal/hydration monitoring.' },
    },
    hepatic: {
        mild: { dose_pct: 100, interval_multiplier: 1, monitoring_frequency: 'Baseline ALT/AST/ALP/bilirubin if repeated.' },
        moderate: { dose_pct: 75, interval_multiplier: 1.5, monitoring_frequency: 'Recheck liver markers within 48-72h.' },
        severe: { dose_pct: 50, interval_multiplier: 2, monitoring_frequency: 'Avoid or use specialist-guided dosing.' },
    },
};

const SEED_RECORDS: DrugFormularyRecord[] = [
    {
        drug_name: 'Flunixin meglumine',
        brand_names: ['Banamine'],
        drug_class: 'Non-selective NSAID',
        drug_class_code: 'NSAID_NONSELECTIVE',
        who_inn: 'flunixin',
        primary_indication: 'visceral pain, fever, inflammation, colic',
        indication_codes: ['pain', 'analgesia', 'inflammation', 'colic'],
        species_dosing: [
            {
                species: 'equine',
                dose_min_mg_kg: 1.1,
                dose_max_mg_kg: 1.1,
                route: 'IV/PO',
                frequency: 'q12-24h',
                duration: 'short course; clinician verified',
                evidence_level: 'established',
                source: "Plumb's Veterinary Drug Handbook / product label hierarchy",
                is_fda_approved: true,
                onset_minutes_min: 30,
                onset_minutes_max: 120,
                half_life_hours: 1.6,
            },
            {
                species: 'bovine',
                dose_min_mg_kg: 1.1,
                dose_max_mg_kg: 2.2,
                route: 'IV',
                frequency: 'q24h',
                duration: 'product-label dependent',
                evidence_level: 'established',
                source: 'FDA label / FARAD verification',
                is_fda_approved: true,
            },
        ],
        withdrawal_periods: [
            {
                species: 'equine',
                jurisdiction: 'USA',
                route: 'IV/PO',
                withdrawal_days: null,
                authority: 'FARAD / product-label verification required',
                regulatory_ref: 'Verify food-horse legality and residue guidance by exact formulation and jurisdiction.',
                competition_rules: 'Verify current FEI/USEF prohibited substance status and detection guidance.',
            },
            {
                species: 'bovine',
                jurisdiction: 'USA',
                route: 'IV',
                withdrawal_days: null,
                authority: 'FARAD / FDA label',
                regulatory_ref: 'Use exact product label and FARAD before assigning meat or milk withdrawal.',
            },
        ],
        organ_adjustments: BASE_ORGAN_ADJUSTMENTS,
        contraindications: [
            { condition: 'dehydration, shock, renal hypoperfusion, active GI ulceration, concurrent NSAID or corticosteroid', severity: 'relative' },
        ],
        pk_profiles: { equine: { bioavailability: 'High PO/IV exposure; formulation dependent', metabolism: 'Hepatic', excretion: 'Renal and biliary', half_life_hours: 1.6 } },
        monitoring: ['hydration/perfusion', 'creatinine/BUN', 'manure output', 'colic pain score', 'withdrawal documentation'],
        adverse_effects: [
            { effect: 'GI ulceration/right dorsal colitis', frequency: 'uncommon', species_scope: ['equine'], severity: 'major' },
            { effect: 'renal papillary injury under hypovolemia', frequency: 'uncommon', species_scope: ['equine', 'bovine'], severity: 'major' },
        ],
        compounding: { available: false, notes: 'Use approved commercial formulations where available.' },
        fda_cvm_approved_species: ['equine', 'bovine'],
        ema_cvmp_approved_species: [],
        apvma_approved_species: [],
        controlled_substance: false,
        primary_reference: "Plumb's Veterinary Drug Handbook; FDA Animal Drugs label hierarchy",
        secondary_references: ['FARAD', 'FEI/USEF rulebook'],
        formulary_version: 1,
        update_source: 'manual_review',
        active: true,
    },
    {
        drug_name: 'Buprenorphine',
        brand_names: ['Buprenex', 'Simbadol'],
        drug_class: 'Partial mu-opioid agonist analgesic',
        drug_class_code: 'OPIOID_PARTIAL_MU',
        who_inn: 'buprenorphine',
        primary_indication: 'moderate pain and multimodal analgesia',
        indication_codes: ['pain', 'analgesia', 'colic'],
        species_dosing: [
            {
                species: 'canine',
                dose_min_mg_kg: 0.02,
                dose_max_mg_kg: 0.04,
                route: 'IV/IM/SC',
                frequency: 'q6-8h',
                duration: 'pain-dependent',
                evidence_level: 'probable',
                source: "Plumb's Veterinary Drug Handbook / BSAVA formulary",
                is_extra_label: true,
                onset_minutes_min: 15,
                onset_minutes_max: 60,
                half_life_hours: 6,
            },
            {
                species: 'equine',
                dose_min_mg_kg: 0.02,
                dose_max_mg_kg: 0.04,
                route: 'IV/IM/SC',
                frequency: 'q6-8h',
                duration: 'pain-dependent; specialist verification',
                evidence_level: 'theoretical',
                source: 'Extra-label allometric bootstrap; primary equine reference required',
                is_extra_label: true,
                extrapolated_from_species: 'canine',
                allometric_method: 'BW^0.75',
                source_weight_kg: 20,
                onset_minutes_min: 15,
                onset_minutes_max: 60,
                half_life_hours: 6,
            },
        ],
        withdrawal_periods: [
            {
                species: 'equine',
                jurisdiction: 'USA',
                route: 'IV/IM/SC',
                withdrawal_days: null,
                authority: 'FARAD / FEI-USEF verification required',
                regulatory_ref: 'Extra-label use in regulated horses requires jurisdiction-specific consultation.',
                competition_rules: 'Verify current FEI/USEF opioid-class rule status before use.',
            },
        ],
        organ_adjustments: BASE_ORGAN_ADJUSTMENTS,
        contraindications: [
            { condition: 'severe respiratory depression or uncontrolled neurologic depression', severity: 'relative' },
        ],
        pk_profiles: { canine: { bioavailability: 'Poor swallowed oral; injectable exposure route-dependent', metabolism: 'Hepatic', excretion: 'Biliary/fecal and urinary metabolites', half_life_hours: 6 } },
        monitoring: ['pain score', 'sedation score', 'respiratory rate/effort', 'gut motility in horses'],
        adverse_effects: [
            { effect: 'sedation/dysphoria', frequency: 'common', severity: 'moderate' },
            { effect: 'respiratory depression', frequency: 'rare', severity: 'major' },
        ],
        compounding: { available: true, notes: 'Controlled substance handling applies; verify concentration and legal route.' },
        controlled_substance: true,
        dea_schedule: 'Schedule III (USA)',
        primary_reference: "Plumb's Veterinary Drug Handbook; controlled substance regulations",
        secondary_references: ['Primary equine PK verification required for extra-label equine use'],
        formulary_version: 1,
        update_source: 'manual_review',
        active: true,
    },
];

const INTERACTIONS: DrugInteractionRecord[] = [
    {
        drug_a_name: 'Flunixin meglumine',
        drug_b_name: 'Buprenorphine',
        interaction_type: 'additive',
        severity: 'moderate',
        mechanism: 'Equine NSAID visceral analgesia plus opioid CNS effects can mask worsening colic while increasing sedation, gut-motility, and respiratory monitoring burden.',
        species_scope: ['equine'],
        route_specific: { route_a: 'IV/PO', route_b: 'IV/IM/SC', timing_relevance: 'overlapping analgesic windows' },
        management: 'Use serial colic exams, hydration/perfusion checks, respiratory monitoring, and reassessment before repeat dosing.',
        monitoring_required: ['sedation score', 'respiratory rate/effort', 'gut motility', 'manure output', 'pain score'],
        evidence_level: 'probable',
        reference: 'VetIOS safety rule pending primary-reference review',
    },
];

async function main() {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    for (const record of SEED_RECORDS) {
        const parsed = drugFormularyRecordSchema.parse(record);
        const { data: existing } = await supabase
            .from('drug_formulary')
            .select('id, formulary_version')
            .ilike('drug_name', parsed.drug_name)
            .maybeSingle();
        if (existing?.id) {
            await supabase.from('drug_formulary').update(parsed).eq('id', existing.id).throwOnError();
        } else {
            await supabase.from('drug_formulary').insert(parsed).throwOnError();
        }
    }

    for (const interaction of INTERACTIONS) {
        const { data: existing } = await supabase
            .from('drug_interactions')
            .select('id')
            .eq('drug_a_name', interaction.drug_a_name)
            .eq('drug_b_name', interaction.drug_b_name)
            .maybeSingle();
        if (!existing?.id) {
            await supabase.from('drug_interactions').insert(interaction).throwOnError();
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
