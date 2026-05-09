import { describe, expect, it } from 'vitest';
import { panelsToDiagnosticTests } from '../panel-diagnostics';
import type { SystemPanel } from '@vetios/inference-schema';

describe('panelsToDiagnosticTests', () => {
    it('maps multisystem panels into canonical engine diagnostic buckets', () => {
        const panels: SystemPanel[] = [
            {
                system: 'serology',
                panel: 'heartworm_antigen',
                tests: {
                    heartworm_antigen: 'positive',
                    microfilaremia: 'present',
                },
            },
            {
                system: 'serology',
                panel: 'tick_borne',
                tests: {
                    ehrlichia: 'positive',
                    anaplasma: 'not_done',
                },
            },
            {
                system: 'endocrine',
                panel: 'thyroid',
                tests: {
                    total_t4: 'low',
                    free_t4: 'low',
                },
            },
        ];

        expect(panelsToDiagnosticTests(panels)).toEqual({
            serology: {
                dirofilaria_immitis_antigen: 'positive',
                heartworm_antigen: 'positive',
                ehrlichia_antibody: 'positive',
                total_t4: 'low',
                t4_total: 'low',
                free_t4: 'low',
            },
            cbc: {
                microfilaremia: 'present',
            },
        });
    });

    it('normalizes panel values the inference engine expects in different vocabulary', () => {
        const panels: SystemPanel[] = [
            {
                system: 'endocrine',
                panel: 'adrenal',
                tests: {
                    acth_stimulation: 'blunted',
                    sodium_potassium_ratio: 24,
                },
            },
            {
                system: 'biochemistry',
                panel: 'renal',
                tests: {
                    creatinine: 'elevated',
                    albumin: 'low',
                },
            },
            {
                system: 'urinalysis',
                panel: 'urinalysis',
                tests: {
                    usg: 1.012,
                    proteinuria: 'present',
                    glucose_in_urine: 'not_done',
                },
            },
        ];

        expect(panelsToDiagnosticTests(panels)).toEqual({
            serology: {
                acth_stimulation: 'flat_response',
                sodium_potassium_ratio: 'low',
            },
            biochemistry: {
                sodium_potassium_ratio: 'low',
                bun_creatinine: 'azotemia',
                albumin: 'hypoalbuminemia',
            },
            urinalysis: {
                specific_gravity: 1.012,
                proteinuria: 'present',
            },
        });
    });

    it('maps broad lab domains into molecular, parasitology, cardiac, and cytology evidence', () => {
        const panels: SystemPanel[] = [
            {
                system: 'molecular',
                panel: 'pcr_panel',
                tests: {
                    parvovirus_pcr: 'positive',
                    ehrlichia_pcr: 'negative',
                    leptospira_pcr: 'equivocal',
                },
            },
            {
                system: 'parasitology',
                panel: 'fecal_parasitology',
                tests: {
                    fecal_flotation: 'roundworms, hookworms',
                    giardia_antigen: 'positive',
                    coccidia_seen: 'present',
                },
            },
            {
                system: 'imaging',
                panel: 'echocardiography',
                tests: {
                    worms_visualised: 'present',
                    pulmonary_hypertension: 'present',
                },
            },
            {
                system: 'cytology',
                panel: 'effusion_analysis',
                tests: {
                    abdominal_fluid_bacteria: 'present',
                    effusion_rivalta: 'positive',
                },
            },
        ];

        expect(panelsToDiagnosticTests(panels)).toEqual({
            pcr: {
                parvovirus_pcr: 'positive',
                ehrlichia_pcr: 'negative',
                leptospira_pcr: 'not_done',
            },
            parasitology: {
                fecal_flotation: ['roundworms', 'hookworms', 'Coccidia'],
            },
            serology: {
                giardia_antigen: 'positive',
            },
            echocardiography: {
                worms_visualised: 'present',
                pulmonary_hypertension: 'present',
            },
            cytology: {
                abdominal_fluid_bacteria: 'present',
                effusion_rivalta: 'positive',
            },
        });
    });
});
