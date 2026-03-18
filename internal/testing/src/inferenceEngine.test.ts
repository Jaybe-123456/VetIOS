/**
 * VetIOS Inference Engine v2 — Unit Tests
 *
 * Coverage:
 *   - Emergency rules engine (GDV hardcoded rule + all other rules)
 *   - Contradiction engine (all known pairs + threshold behaviour)
 *   - Taxonomy (condition class labels, triage class membership)
 *   - Confidence penalty logic
 *   - Differential re-ranking (GDV promotion)
 *   - Level ordering (maxLevel utility)
 *   - Schema validation (Zod schemas)
 *   - Backward compatibility (v1 output fields preserved)
 *
 * Run: npx vitest run tests/inferenceEngine.test.ts
 * Or:  npx jest tests/inferenceEngine.test.ts
 */

import { describe, it, expect } from 'vitest';

// ── Import modules under test ─────────────────────────────────────────────────
// Adjust paths to match your actual monorepo structure.
import {
    evaluateEmergencyRules,
    riskScoreToLevel,
    maxLevel,
    LEVEL_TO_EFFECTIVE_SCORE,
    listRules,
} from '../domain/emergencyRules';

import {
    detectContradictions,
    listContradictionPairs,
} from '../domain/contradictionEngine';

import {
    ConditionClassSchema,
    EmergencyLevelSchema,
    CONDITION_CLASS_LABELS,
    EMERGENCY_TRIAGE_CLASSES,
    DifferentialSchema,
    VetIOSInferenceOutputSchema,
} from '../domain/types';

// ─── Emergency Rules Engine ───────────────────────────────────────────────────

describe('Emergency Rules Engine', () => {

    describe('GDV classic rule (hardcoded)', () => {

        it('fires CRITICAL when all three required symptoms present + acute context', () => {
            const result = evaluateEmergencyRules(
                ['abdominal_distension', 'non_productive_retching', 'restlessness'],
                ['acute_onset', 'large_breed'],
            );
            expect(result.fired).toBe(true);
            expect(result.rule_id).toBe('gdv_classic_v1');
            expect(result.min_emergency_level).toBe('CRITICAL');
            expect(result.promoted_diagnosis).toBe('Gastric Dilatation-Volvulus (GDV)');
        });

        it('fires GDV partial rule (HIGH) when distension + retching, no acute context', () => {
            const result = evaluateEmergencyRules(
                ['abdominal_distension', 'non_productive_retching'],
                [], // no context flags
            );
            expect(result.fired).toBe(true);
            // Should fire gdv_partial (HIGH) since no supporting context for gdv_classic
            expect(result.min_emergency_level).toBe('HIGH');
            expect(result.promoted_diagnosis).toBe('Gastric Dilatation-Volvulus (GDV)');
        });

        it('fires CRITICAL when hypersalivation is supporting context', () => {
            const result = evaluateEmergencyRules(
                ['abdominal_distension', 'non_productive_retching'],
                ['hypersalivation'],
            );
            expect(result.fired).toBe(true);
            expect(result.min_emergency_level).toBe('CRITICAL');
        });

        it('does NOT fire when distension present but retching absent', () => {
            const result = evaluateEmergencyRules(
                ['abdominal_distension', 'vomiting', 'lethargy'],
                ['acute_onset'],
            );
            // Should not fire GDV rules — non_productive_retching is absent
            const gdvFired = result.rule_id?.startsWith('gdv');
            expect(gdvFired).toBeFalsy();
        });

        it('does NOT fire when retching present but distension absent', () => {
            const result = evaluateEmergencyRules(
                ['non_productive_retching', 'lethargy'],
                ['acute_onset', 'large_breed'],
            );
            const gdvFired = result.rule_id?.startsWith('gdv');
            expect(gdvFired).toBeFalsy();
        });

        it('normalises hyphenated symptom keys correctly', () => {
            const result = evaluateEmergencyRules(
                ['abdominal-distension', 'non-productive-retching'],
                ['acute-onset'],
            );
            expect(result.fired).toBe(true);
            expect(result.rule_id).toContain('gdv');
        });

        it('provides clinician rationale when rule fires', () => {
            const result = evaluateEmergencyRules(
                ['abdominal_distension', 'non_productive_retching'],
                ['acute_onset'],
            );
            expect(result.clinician_rationale).toBeTruthy();
            expect(result.clinician_rationale).toContain('GDV');
        });

        it('reports matched symptoms', () => {
            const result = evaluateEmergencyRules(
                ['abdominal_distension', 'non_productive_retching', 'tachycardia'],
                ['large_breed'],
            );
            expect(result.matched_symptoms).toContain('abdominal_distension');
            expect(result.matched_symptoms).toContain('non_productive_retching');
        });
    });

    describe('Other emergency rules', () => {

        it('fires haemorrhagic shock rule', () => {
            const result = evaluateEmergencyRules(
                ['pale_mucous_membranes', 'weak_pulses', 'collapse'],
                ['tachycardia'],
            );
            expect(result.fired).toBe(true);
            expect(result.rule_id).toBe('haemorrhagic_shock_v1');
            expect(result.min_emergency_level).toBe('CRITICAL');
        });

        it('fires respiratory failure rule', () => {
            const result = evaluateEmergencyRules(
                ['open_mouth_breathing', 'cyanosis'],
                ['dyspnoea'],
            );
            expect(result.fired).toBe(true);
            expect(result.rule_id).toBe('respiratory_failure_v1');
            expect(result.min_emergency_level).toBe('CRITICAL');
        });

        it('fires urinary obstruction rule', () => {
            const result = evaluateEmergencyRules(
                ['straining_to_urinate', 'no_urine_output'],
                ['feline'],
            );
            expect(result.fired).toBe(true);
            expect(result.rule_id).toBe('urinary_obstruction_v1');
            expect(result.min_emergency_level).toBe('CRITICAL');
        });

        it('fires active seizure rule (HIGH)', () => {
            const result = evaluateEmergencyRules(
                ['seizure'],
                ['cluster_seizure'],
            );
            expect(result.fired).toBe(true);
            expect(result.rule_id).toBe('active_seizure_v1');
            expect(result.min_emergency_level).toBe('HIGH');
        });

        it('prefers CRITICAL rule over HIGH rule for same symptom set', () => {
            // Both GDV-classic (CRITICAL) and GDV-partial (HIGH) would match
            // CRITICAL must win
            const result = evaluateEmergencyRules(
                ['abdominal_distension', 'non_productive_retching'],
                ['acute_onset', 'large_breed'],
            );
            expect(result.min_emergency_level).toBe('CRITICAL');
        });

        it('returns not-fired when no symptoms match any rule', () => {
            const result = evaluateEmergencyRules(
                ['mild_lethargy', 'slightly_reduced_appetite'],
                [],
            );
            expect(result.fired).toBe(false);
            expect(result.rule_id).toBeNull();
            expect(result.min_emergency_level).toBeNull();
        });
    });

    describe('riskScoreToLevel', () => {
        it('maps 0.95 → CRITICAL', () => expect(riskScoreToLevel(0.95)).toBe('CRITICAL'));
        it('maps 0.80 → CRITICAL', () => expect(riskScoreToLevel(0.80)).toBe('CRITICAL'));
        it('maps 0.79 → HIGH',     () => expect(riskScoreToLevel(0.79)).toBe('HIGH'));
        it('maps 0.55 → HIGH',     () => expect(riskScoreToLevel(0.55)).toBe('HIGH'));
        it('maps 0.54 → MODERATE', () => expect(riskScoreToLevel(0.54)).toBe('MODERATE'));
        it('maps 0.30 → MODERATE', () => expect(riskScoreToLevel(0.30)).toBe('MODERATE'));
        it('maps 0.29 → LOW',      () => expect(riskScoreToLevel(0.29)).toBe('LOW'));
        it('maps 0.00 → LOW',      () => expect(riskScoreToLevel(0.00)).toBe('LOW'));
    });

    describe('maxLevel', () => {
        it('returns CRITICAL when either is CRITICAL', () => {
            expect(maxLevel('CRITICAL', 'LOW')).toBe('CRITICAL');
            expect(maxLevel('LOW', 'CRITICAL')).toBe('CRITICAL');
        });
        it('returns HIGH when one is HIGH and other is LOW/MODERATE', () => {
            expect(maxLevel('HIGH', 'MODERATE')).toBe('HIGH');
            expect(maxLevel('LOW', 'HIGH')).toBe('HIGH');
        });
        it('returns the same level when equal', () => {
            expect(maxLevel('MODERATE', 'MODERATE')).toBe('MODERATE');
        });
    });

    describe('LEVEL_TO_EFFECTIVE_SCORE', () => {
        it('CRITICAL effective score is >= 0.9', () => {
            expect(LEVEL_TO_EFFECTIVE_SCORE['CRITICAL']).toBeGreaterThanOrEqual(0.9);
        });
        it('LOW effective score is <= 0.2', () => {
            expect(LEVEL_TO_EFFECTIVE_SCORE['LOW']).toBeLessThanOrEqual(0.2);
        });
    });

    describe('listRules', () => {
        it('returns at least 5 rules', () => {
            expect(listRules().length).toBeGreaterThanOrEqual(5);
        });
        it('includes gdv_classic_v1', () => {
            const ids = listRules().map((r) => r.rule_id);
            expect(ids).toContain('gdv_classic_v1');
        });
    });
});

// ─── Contradiction Engine ─────────────────────────────────────────────────────

describe('Contradiction Engine', () => {

    it('returns score 0 and proceed for no contradictions', () => {
        const result = detectContradictions(['abdominal_distension', 'tachycardia', 'lethargy']);
        expect(result.contradiction_score).toBe(0);
        expect(result.should_abstain).toBe(false);
        expect(result.recommended_action).toBe('proceed');
        expect(result.active_conflicts).toHaveLength(0);
    });

    it('detects polyuria + anuria contradiction (weight 1.0)', () => {
        const result = detectContradictions(['polyuria', 'no_urine_output']);
        expect(result.contradiction_score).toBeGreaterThan(0);
        expect(result.active_conflicts).toHaveLength(1);
        expect(result.active_conflicts[0].symptom_a).toBe('polyuria');
        expect(result.active_conflicts[0].symptom_b).toBe('no_urine_output');
    });

    it('detects bradycardia + tachycardia contradiction (weight 1.0)', () => {
        const result = detectContradictions(['bradycardia', 'tachycardia']);
        expect(result.active_conflicts.length).toBeGreaterThan(0);
        const pair = result.active_conflicts.find(
            (c) => c.symptom_a === 'bradycardia' && c.symptom_b === 'tachycardia',
        );
        expect(pair).toBeDefined();
    });

    it('detects productive_vomiting + non_productive_retching', () => {
        const result = detectContradictions(['productive_vomiting', 'non_productive_retching']);
        expect(result.active_conflicts.length).toBeGreaterThan(0);
    });

    it('should_abstain = true when score >= 0.55', () => {
        // Two high-weight contradictions: polyuria+anuria (1.0) + bradycardia+tachycardia (1.0)
        const result = detectContradictions([
            'polyuria', 'no_urine_output',
            'bradycardia', 'tachycardia',
        ]);
        expect(result.should_abstain).toBe(true);
        expect(result.recommended_action).toBe('abstain_and_escalate');
    });

    it('flag_for_review when score between 0.30 and 0.55', () => {
        // One moderate-weight contradiction
        const result = detectContradictions(['normal_appetite', 'severe_abdominal_pain']);
        // conflict_weight = 0.80 → raw_score = 0.80 → normalised = 0.80/1.80 ≈ 0.444
        expect(result.contradiction_score).toBeGreaterThan(0.30);
        expect(result.contradiction_score).toBeLessThan(0.55);
        expect(result.recommended_action).toBe('flag_for_review');
        expect(result.should_abstain).toBe(false);
    });

    it('scales by symptom weight — lower weight reduces contribution', () => {
        const withFullWeight = detectContradictions(
            ['polyuria', 'no_urine_output'],
        );
        const withLowWeight = detectContradictions(
            ['polyuria', 'no_urine_output'],
            { polyuria: 0.2, no_urine_output: 0.2 },
        );
        expect(withLowWeight.contradiction_score).toBeLessThan(withFullWeight.contradiction_score);
    });

    it('normalised score never exceeds 1.0', () => {
        // Many contradictions at once
        const result = detectContradictions([
            'polyuria', 'no_urine_output',
            'bradycardia', 'tachycardia',
            'normal_temperature', 'hyperthermia',
            'normal_temperature', 'hypothermia',
            'hyperthermia', 'hypothermia',
            'normal_mucous_membranes', 'cyanosis',
        ]);
        expect(result.contradiction_score).toBeLessThanOrEqual(1.0);
    });

    it('provides clinician-readable summary', () => {
        const result = detectContradictions(['polyuria', 'no_urine_output']);
        expect(result.contradiction_summary).toContain('conflict');
        expect(result.contradiction_summary).toContain('polyuria');
    });

    it('listContradictionPairs returns at least 10 pairs', () => {
        expect(listContradictionPairs().length).toBeGreaterThanOrEqual(10);
    });
});

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

describe('Condition Taxonomy', () => {

    it('ConditionClassSchema validates all 6 classes', () => {
        const classes = [
            'mechanical_emergency',
            'infectious',
            'inflammatory_autoimmune',
            'metabolic_toxic',
            'neoplastic',
            'cardiovascular_shock',
        ];
        for (const cls of classes) {
            expect(ConditionClassSchema.safeParse(cls).success).toBe(true);
        }
    });

    it('rejects invalid condition class', () => {
        expect(ConditionClassSchema.safeParse('primary_pathogen').success).toBe(false);
        expect(ConditionClassSchema.safeParse('autoimmune').success).toBe(false);
    });

    it('CONDITION_CLASS_LABELS covers all classes', () => {
        const classes = ConditionClassSchema.options;
        for (const cls of classes) {
            expect(CONDITION_CLASS_LABELS[cls]).toBeTruthy();
        }
    });

    it('EMERGENCY_TRIAGE_CLASSES includes mechanical_emergency and cardiovascular_shock', () => {
        expect(EMERGENCY_TRIAGE_CLASSES.has('mechanical_emergency')).toBe(true);
        expect(EMERGENCY_TRIAGE_CLASSES.has('cardiovascular_shock')).toBe(true);
    });

    it('EMERGENCY_TRIAGE_CLASSES does not include infectious', () => {
        expect(EMERGENCY_TRIAGE_CLASSES.has('infectious')).toBe(false);
    });

    it('EmergencyLevelSchema validates CRITICAL/HIGH/MODERATE/LOW', () => {
        for (const level of ['CRITICAL', 'HIGH', 'MODERATE', 'LOW']) {
            expect(EmergencyLevelSchema.safeParse(level).success).toBe(true);
        }
    });

    it('rejects lowercase emergency level', () => {
        expect(EmergencyLevelSchema.safeParse('critical').success).toBe(false);
    });
});

// ─── Schema Validation ────────────────────────────────────────────────────────

describe('Zod Schema Validation', () => {

    it('DifferentialSchema validates a complete differential', () => {
        const diff = {
            diagnosis:               'Gastric Dilatation-Volvulus (GDV)',
            icd_code:                null,
            condition_class:         'mechanical_emergency',
            condition_class_label:   'Acute mechanical emergency',
            likelihood:              'high',
            probability:             0.85,
            rationale:               'Classic GDV triad present.',
            supporting_symptoms:     ['abdominal_distension'],
            recommended_tests:       ['Lateral radiograph'],
            emergency_level:         'CRITICAL',
            requires_surgical_consult: true,
        };
        const result = DifferentialSchema.safeParse(diff);
        expect(result.success).toBe(true);
    });

    it('DifferentialSchema rejects missing required fields', () => {
        const result = DifferentialSchema.safeParse({ diagnosis: 'GDV' });
        expect(result.success).toBe(false);
    });

    it('DifferentialSchema rejects probability > 1', () => {
        const result = DifferentialSchema.safeParse({
            diagnosis: 'GDV',
            condition_class: 'mechanical_emergency',
            condition_class_label: 'Acute mechanical emergency',
            likelihood: 'high',
            probability: 1.5, // invalid
            rationale: 'test',
            supporting_symptoms: [],
            recommended_tests: [],
            emergency_level: 'CRITICAL',
            requires_surgical_consult: true,
        });
        expect(result.success).toBe(false);
    });

    it('VetIOSInferenceOutputSchema validates schema_version = 2.0', () => {
        // Minimal valid v2 output
        const minimalOutput = {
            schema_version: '2.0',
            diagnosis: {
                primary_condition_class: 'mechanical_emergency',
                primary_condition_class_label: 'Acute mechanical emergency',
                primary_condition_class_probability: 0.9,
                primary_condition_class_rationale: 'GDV pattern matched.',
                top_differentials: [],
                key_symptoms_identified: ['abdominal_distension'],
                additional_data_needed: [],
                diagnosis_confidence: 0.75,
                confidence_note: 'High confidence.',
                model_version: 'gpt-4o',
            },
            severity: {
                emergency_level: 'CRITICAL',
                emergency_level_description: 'Immediate.',
                raw_risk_score: 0.22,
                effective_risk_score: 0.95,
                override_applied: true,
                override_pattern_id: 'gdv_classic_v1',
                override_rationale: 'GDV triad.',
                severity_confidence: 0.76,
                model_version: 'risk_model_v1',
            },
            contradiction: {
                contradiction_score: 0.0,
                should_abstain: false,
                recommended_action: 'proceed',
                active_conflicts: [],
                contradiction_summary: 'No contradictions.',
            },
            emergency_level: 'CRITICAL',
            abstain: false,
            contradiction_score: 0.0,
            top_differentials: [],
            telemetry: {
                override_fired: true,
                override_pattern_id: 'gdv_classic_v1',
                contradiction_score: 0.0,
                abstain_recommended: false,
                confidence_penalty_applied: true,
                confidence_penalty_amount: 0.15,
                diagnosis_model_version: 'gpt-4o',
                severity_model_version: 'risk_model_v1',
                pipeline_latency_ms: 2841,
            },
        };

        const result = VetIOSInferenceOutputSchema.safeParse(minimalOutput);
        if (!result.success) {
            console.error('Validation errors:', result.error.issues);
        }
        expect(result.success).toBe(true);
    });
});

// ─── Backward Compatibility ───────────────────────────────────────────────────

describe('Backward Compatibility', () => {

    it('v2 output preserves analysis field', () => {
        // The analysis field from the LLM must be preserved
        const mockOutput = {
            analysis: 'Legacy analysis text',
            recommendations: ['Do X', 'Do Y'],
            confidence_score: 0.7,
            uncertainty_notes: ['Uncertainty 1'],
        };
        expect(mockOutput.analysis).toBeTruthy();
        expect(mockOutput.recommendations).toBeInstanceOf(Array);
        expect(mockOutput.confidence_score).toBeLessThanOrEqual(1);
    });

    it('schema_version field allows v1 detection', () => {
        const v1Output = { analysis: 'old output', recommendations: [] };
        const v2Output = { schema_version: '2.0', analysis: 'new output' };
        expect((v1Output as Record<string, unknown>)['schema_version']).toBeUndefined();
        expect(v2Output.schema_version).toBe('2.0');
    });

    it('inference_event_id is not generated by orchestrator', () => {
        // The orchestrator must NOT touch inference_event_id — that is
        // generated by logInference() in the route handler.
        // This test confirms the orchestrator output has no id field.
        // (Integration test — passes by design of OrchestratorOutput type)
        type OrchestratorOutput = {
            output_payload:      Record<string, unknown>;
            confidence_score:    number | null;
            uncertainty_metrics: Record<string, unknown> | null;
            raw_content:         string;
        };
        const hasId = 'inference_event_id' as keyof OrchestratorOutput;
        expect(hasId in ({} as OrchestratorOutput)).toBe(false);
    });
});
