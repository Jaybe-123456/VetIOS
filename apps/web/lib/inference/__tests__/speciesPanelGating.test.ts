import { describe, expect, it } from 'vitest';
import {
    SPECIES_PANEL_MAP,
    validateSpeciesPanelGating,
    type EncounterPayloadV2,
} from '@vetios/inference-schema';

describe('species-specific multisystem panel gating', () => {
    it('does not expose companion-animal panels as bovine diagnostic defaults', () => {
        const bovinePanels = panelIdsFor('bovine');

        expect(bovinePanels).toContain('ruminant_metabolic');
        expect(bovinePanels).toContain('ruminant_mastitis_milk');
        expect(bovinePanels).toContain('ruminant_herd_infectious');
        expect(bovinePanels).not.toContain('heartworm_antigen');
        expect(bovinePanels).not.toContain('adrenal');
        expect(bovinePanels).not.toContain('tick_borne');
        expect(bovinePanels).not.toContain('pancreatic');
    });

    it('keeps ruminant herd panels out of canine diagnostic defaults', () => {
        const caninePanels = panelIdsFor('canine');

        expect(caninePanels).toContain('heartworm_antigen');
        expect(caninePanels).toContain('tick_borne');
        expect(caninePanels).not.toContain('ruminant_metabolic');
        expect(caninePanels).not.toContain('ruminant_mastitis_milk');
        expect(caninePanels).not.toContain('ruminant_herd_infectious');
    });

    it('rejects cross-species panel injection at the v2 API schema boundary', () => {
        const invalid = validateSpeciesPanelGating({
            ...basePayload(),
            patient: { ...basePayload().patient, species: 'bovine' },
            active_system_panels: [
                {
                    system: 'serology',
                    panel: 'heartworm_antigen',
                    tests: { heartworm_antigen: 'positive' },
                },
            ],
        });

        const valid = validateSpeciesPanelGating({
            ...basePayload(),
            patient: { ...basePayload().patient, species: 'bovine' },
            active_system_panels: [
                {
                    system: 'biochemistry',
                    panel: 'ruminant_metabolic',
                    tests: { bhba: 'elevated', calcium: 'low' },
                },
            ],
        });

        expect(invalid).toEqual([
            'Panel "serology/heartworm_antigen" is not allowed for species "bovine"',
        ]);
        expect(valid).toEqual([]);
    });
});

function panelIdsFor(species: keyof typeof SPECIES_PANEL_MAP) {
    return SPECIES_PANEL_MAP[species].map((entry) => entry.panel);
}

function basePayload(): EncounterPayloadV2 {
    return {
        patient: {
            species: 'canine',
            breed: '',
            weight_kg: null,
            age_years: null,
            sex: 'unknown',
        },
        encounter: {
            presenting_complaints: ['lethargy'],
            vitals: {
                temp_c: null,
                heart_rate_bpm: null,
                respiratory_rate_bpm: null,
                mm_colour: null,
                crt_seconds: null,
            },
            history: {
                duration_days: null,
                free_text: '',
                medications: [],
            },
        },
        active_system_panels: [
            {
                system: 'haematology',
                panel: 'CBC',
                tests: { packed_cell_volume_percent: 35 },
            },
        ],
        imaging: {},
        metadata: {
            encounter_id: 'test-encounter',
            timestamp: '2026-07-03T00:00:00.000Z',
            clinician_id: null,
            clinic_id: null,
        },
    };
}
