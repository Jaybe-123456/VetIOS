import { describe, expect, it } from 'vitest';
import { buildPharmacOSReasoningResponse, type DrugFormularyRecord } from '@vetios/pharmacos';

describe('structured PharmacOS formulary source', () => {
    it('uses supplied database records without merging fallback interactions when database interactions exist', async () => {
        const response = await buildPharmacOSReasoningResponse({
            query: 'gabapentin for canine pain with buprenorphine onboard',
            species: 'canine',
            weight_kg: 12,
            indication: 'pain',
            concurrent_medications: ['Buprenorphine'],
        }, {
            fetchFormularyRecords: async () => [gabapentinRecord()],
            fetchInteractions: async () => [{
                drug_a_name: 'Gabapentin',
                drug_b_name: 'Unrelated test drug',
                interaction_type: 'additive',
                severity: 'minor',
                mechanism: 'Test-only unrelated database interaction.',
                species_scope: ['canine'],
                route_specific: null,
                management: 'No action for the test fixture.',
                monitoring_required: [],
                evidence_level: 'theoretical',
                reference: 'VetIOS test fixture',
            }],
        });

        expect(response.cards).toHaveLength(1);
        expect(response.cards[0].drug_name).toBe('Gabapentin');
        expect(response.cards[0].interactions.some((entry) => entry.drug_b === 'Buprenorphine')).toBe(false);
    });
});

function gabapentinRecord(): DrugFormularyRecord {
    return {
        drug_name: 'Gabapentin',
        brand_names: ['Neurontin'],
        drug_class: 'Alpha-2-delta calcium channel ligand',
        drug_class_code: 'NEUROPATHIC_ALPHA2DELTA',
        who_inn: 'gabapentin',
        primary_indication: 'pain analgesia neuropathic pain',
        indication_codes: ['pain', 'analgesia'],
        species_dosing: [{
            species: 'canine',
            dose_min_mg_kg: 10,
            dose_max_mg_kg: 20,
            route: 'PO',
            frequency: 'q8-12h',
            duration: 'Condition-dependent',
            evidence_level: 'probable',
            source: 'VetIOS test fixture',
            is_extra_label: true,
            half_life_hours: 3,
        }],
        withdrawal_periods: [],
        organ_adjustments: {},
        contraindications: [],
        pk_profiles: { canine: { bioavailability: 'Variable', metabolism: 'Minimal', excretion: 'Renal', half_life_hours: 3 } },
        monitoring: ['Sedation score'],
        adverse_effects: [{ effect: 'sedation', frequency: 'common', severity: 'moderate' }],
        compounding: { available: true, notes: 'Avoid xylitol-containing liquids in dogs.' },
        fda_cvm_approved_species: [],
        ema_cvmp_approved_species: [],
        apvma_approved_species: [],
        controlled_substance: false,
        primary_reference: 'VetIOS test fixture',
        secondary_references: [],
        formulary_version: 1,
        active: true,
    };
}
