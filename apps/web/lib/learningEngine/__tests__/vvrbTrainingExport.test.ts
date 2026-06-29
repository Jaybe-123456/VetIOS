import { describe, expect, it } from 'vitest';
import {
    buildVvrbExperimentalTrainingExport,
    encodeJsonlRows,
    type VvrbCaseRecord,
} from '../vvrbTrainingExport';

describe('VVRB experimental training export', () => {
    it('blocks export when audit has critical synthetic issues unless explicitly allowed', () => {
        const exportBundle = buildVvrbExperimentalTrainingExport([vvrbCase(), vvrbCase({ benchmark_id: 'VVRB-2' })]);

        expect(exportBundle.manifest.export_status).toBe('blocked_by_audit');
        expect(exportBundle.sft_rows).toHaveLength(0);
        expect(exportBundle.manifest.production_training_allowed).toBe(false);
        expect(exportBundle.manifest.governed_training_allowed).toBe(false);
        expect(exportBundle.manifest.blockers).toContain('synthetic_vvrb_rows_not_allowed_for_governed_training');
    });

    it('exports synthetic SFT and eval rows for experimental Unsloth training when explicitly allowed', () => {
        const exportBundle = buildVvrbExperimentalTrainingExport([
            vvrbCase(),
            vvrbCase({ benchmark_id: 'VVRB-2', confirmed_diagnosis: 'Large colon impaction', differential_diagnoses: ['Large colon impaction', 'Equine colic'] }),
        ], {
            allowCriticalSyntheticAuditIssues: true,
            attemptedOrPreviousModelId: 'VetIOS/vetios-qwen2.5-0.5b-clinical-restart-v1-gguf',
        });

        expect(exportBundle.manifest.export_status).toBe('ready_for_experimental_training');
        expect(exportBundle.sft_rows).toHaveLength(2);
        expect(exportBundle.eval_rows).toHaveLength(2);
        expect(exportBundle.sft_rows[0].synthetic).toBe(true);
        expect(exportBundle.sft_rows[0].benchmark_only).toBe(true);
        expect(exportBundle.sft_rows[0].messages[0].role).toBe('system');
        expect(exportBundle.sft_rows[0].messages[2].content).toContain('Safety note');
        expect(exportBundle.manifest.unsloth_recipe.base_model_id).toBe('Qwen/Qwen2.5-0.5B-Instruct');
        expect(exportBundle.manifest.unsloth_recipe.attempted_or_previous_model_id).toBe('VetIOS/vetios-qwen2.5-0.5b-clinical-restart-v1-gguf');
    });

    it('emits DPO rows only when explicit chosen and rejected responses exist', () => {
        const exportBundle = buildVvrbExperimentalTrainingExport([
            vvrbCase({
                preferred_response: 'Chosen clinician-reviewed response.',
                rejected_response: 'Rejected unsafe response.',
            }),
            vvrbCase({ benchmark_id: 'VVRB-2' }),
        ], {
            allowCriticalSyntheticAuditIssues: true,
        });

        expect(exportBundle.dpo_rows).toHaveLength(1);
        expect(exportBundle.dpo_rows[0].chosen).toBe('Chosen clinician-reviewed response.');
        expect(exportBundle.dpo_rows[0].rejected).toBe('Rejected unsafe response.');
        expect(exportBundle.dpo_rows[0].metadata.preference_source).toBe('explicit_vvrb_preference');
    });

    it('encodes JSONL for local training artifacts without requiring the source JSONL in git', () => {
        const exportBundle = buildVvrbExperimentalTrainingExport([vvrbCase()], {
            allowCriticalSyntheticAuditIssues: true,
        });
        const jsonl = encodeJsonlRows(exportBundle.sft_rows);

        expect(jsonl).toContain('"synthetic":true');
        expect(jsonl.endsWith('\n')).toBe(true);
    });
});

function vvrbCase(overrides: Partial<VvrbCaseRecord> = {}): VvrbCaseRecord {
    return {
        benchmark_id: 'VVRB-1',
        synthetic: true,
        benchmark_version: 'VetIOS Veterinary Reasoning Benchmark v1',
        case_domain: 'canine emergency',
        species: 'canine',
        breed: 'Great Dane',
        age: '6 years',
        sex: 'male neutered',
        regulatory_region: 'US',
        care_environment: 'emergency clinic',
        severity: 'critical',
        presenting_complaint: 'non-productive retching and abdominal distension',
        history: 'large breed dog with acute restlessness after meal',
        clinical_signs: ['retching', 'abdominal distension', 'tachycardia'],
        labs: { lactate: 'elevated' },
        imaging: { radiographs: 'gas distended stomach possible' },
        differential_diagnoses: ['Gastric dilatation-volvulus', 'Food bloat', 'Splenic torsion'],
        reasoning_chain_public: 'Gastric dilatation-volvulus is prioritized because the signal pattern combines retching, distension, and shock risk.',
        red_flags: ['shock risk', 'surgical emergency'],
        recommended_tests: ['abdominal radiographs', 'lactate', 'ECG'],
        treatment_plan: ['stabilize', 'gastric decompression', 'emergency surgery'],
        antimicrobial_decision: {
            drug: 'perioperative cefazolin if surgery proceeds',
            reason: 'perioperative prophylaxis only',
            stewardship_risk: 'medium',
        },
        clinician_feedback: 'approved',
        confirmed_diagnosis: 'Gastric dilatation-volvulus',
        outcome: 'recovered',
        follow_up_days: 14,
        evidence_sources: ['MSD/Merck Veterinary Manual disease guidance'],
        confidence_score: 0.94,
        cire_phi_hat: 0.92,
        evaluation_targets: {
            top1_differential: 'Gastric dilatation-volvulus',
            top3_contains_confirmed: true,
            documentation_speed_task: 'generate SOAP note',
            amr_stewardship_task: 'classify antimicrobial need',
            red_flag_detection_task: 'identify emergency signals',
        },
        ...overrides,
    };
}
