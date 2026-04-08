import { describe, expect, it } from 'vitest';
import { applyDiagnosticSafetyLayer, type DifferentialEntry } from '../diagnosticSafety';
import { evaluateEmergencyRules } from '../emergencyRules';

function runSafetyCase(inputSignature: Record<string, unknown>, seededDifferentials: DifferentialEntry[]) {
    return applyDiagnosticSafetyLayer({
        inputSignature,
        diagnosis: {
            analysis: 'Seeded differential set for system-gating regression coverage.',
            primary_condition_class: 'Idiopathic / Unknown',
            condition_class_probabilities: {},
            top_differentials: seededDifferentials,
            confidence_score: 0.42,
        },
        contradiction: null,
        emergencyEval: evaluateEmergencyRules(inputSignature),
        modelVersion: 'system-gating-test',
    });
}

function topNames(result: ReturnType<typeof runSafetyCase>, limit = 3) {
    const entries = (result.diagnosis.top_differentials as DifferentialEntry[]) ?? [];
    return entries.slice(0, limit).map((entry) => entry.name);
}

describe('system gating engine', () => {
    it('keeps postpartum hypocalcemia presentations inside the metabolic/electrolyte lane', () => {
        const result = runSafetyCase(
            {
                species: 'canine',
                presenting_signs: ['tremors', 'seizures'],
                symptoms: ['postpartum', 'tremors', 'seizures'],
                acute_onset: true,
                diagnostic_tests: {
                    biochemistry: {
                        calcium: 'hypocalcemia',
                    },
                },
            },
            [
                { name: 'Tracheal Collapse', probability: 0.34 },
                { name: 'Babesiosis', probability: 0.29 },
                { name: 'Mitral Valve Disease', probability: 0.24 },
            ],
        );

        expect((result.telemetry.system_gating as { dominant_systems?: string[] }).dominant_systems).toContain('metabolic_electrolyte');
        expect((result.telemetry.system_gating as { postpartum_hypocalcemia_override?: boolean }).postpartum_hypocalcemia_override).toBe(true);
        expect(topNames(result)).toEqual(
            expect.arrayContaining([
                'Puerperal Hypocalcemia (Eclampsia)',
            ]),
        );
        expect(topNames(result).every((name) => [
            'Puerperal Hypocalcemia (Eclampsia)',
            'Hypoglycemic Crisis',
            'Acute Electrolyte Derangement',
            'Hypoadrenocorticism',
        ].includes(name))).toBe(true);
    });

    it('keeps a classic GDV pattern inside abdominal mechanical disease space', () => {
        const result = runSafetyCase(
            {
                species: 'canine',
                presenting_signs: ['retching_unproductive', 'abdominal_distension', 'collapse'],
                symptoms: ['retching_unproductive', 'abdominal_distension', 'collapse', 'hypersalivation'],
                acute_onset: true,
            },
            [
                { name: 'Diabetes Mellitus', probability: 0.31 },
                { name: 'Tracheal Collapse', probability: 0.27 },
                { name: 'Babesiosis', probability: 0.22 },
            ],
        );

        expect((result.telemetry.system_gating as { dominant_systems?: string[] }).dominant_systems).toContain('abdominal_mechanical');
        expect(topNames(result).every((name) => [
            'Gastric Dilatation-Volvulus (GDV)',
            'Simple Gastric Dilatation',
            'Mesenteric Volvulus',
            'Intestinal Obstruction',
        ].includes(name))).toBe(true);
    });

    it('blocks metabolic leakage from a respiratory presentation', () => {
        const result = runSafetyCase(
            {
                species: 'canine',
                presenting_signs: ['honking_cough', 'cough', 'dyspnea', 'tachypnea'],
                symptoms: ['honking_cough', 'cough', 'dyspnea', 'tachypnea'],
                acute_onset: true,
            },
            [
                { name: 'Diabetes Mellitus', probability: 0.28 },
                { name: 'Hypoadrenocorticism', probability: 0.22 },
                { name: 'Puerperal Hypocalcemia (Eclampsia)', probability: 0.18 },
            ],
        );

        expect((result.telemetry.system_gating as { dominant_systems?: string[] }).dominant_systems).toContain('respiratory');
        expect(topNames(result).every((name) => [
            'Tracheal Collapse',
            'Canine Infectious Tracheobronchitis',
            'Bronchitis',
            'Pneumonia',
        ].includes(name))).toBe(true);
        expect(topNames(result).some((name) => name.includes('Diabetes') || name.includes('Hypocalcemia') || name.includes('Hypoadrenocorticism'))).toBe(false);
    });
});
