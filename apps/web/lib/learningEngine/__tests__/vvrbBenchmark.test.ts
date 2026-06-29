import { describe, expect, it } from 'vitest';
import {
    auditVvrbCases,
    buildVvrbBenchmarkBundle,
    buildVvrbSyntheticFirewallReport,
    mapVvrbCaseToLearningCase,
    type VvrbCaseRecord,
} from '../vvrbBenchmark';

describe('VVRB benchmark firewall and adapter', () => {
    it('maps VVRB rows into benchmark-only synthetic learning cases', () => {
        const clinicalCase = mapVvrbCaseToLearningCase(vvrbCase(), {
            tenantId: 'tenant-1',
            modelVersion: 'vvrb-v1',
            now: '2026-06-28T00:00:00.000Z',
        });

        expect(clinicalCase.source_module).toBe('vvrb_synthetic_benchmark');
        expect(clinicalCase.label_type).toBe('synthetic');
        expect(clinicalCase.patient_metadata.synthetic).toBe(true);
        expect(clinicalCase.uncertainty_notes).toContain('synthetic_benchmark_case_not_outcome_confirmed');
        expect(clinicalCase.latest_outcome_event_id).toBeNull();
    });

    it('builds a benchmark bundle while marking all rows as blocked from learning ledgers', () => {
        const bundle = buildVvrbBenchmarkBundle([
            vvrbCase({ benchmark_id: 'VVRB-1', confirmed_diagnosis: 'Canine parvoviral enteritis' }),
            vvrbCase({ benchmark_id: 'VVRB-2', severity: 'critical', confirmed_diagnosis: 'Canine parvoviral enteritis' }),
        ], {
            tenantId: 'tenant-1',
            now: '2026-06-28T00:00:00.000Z',
        });

        expect(bundle.summary.total_cases).toBe(2);
        expect(bundle.summary.label_composition.synthetic).toBe(2);
        expect(bundle.summary.excluded_counts.synthetic_rows_blocked_from_learning_ledgers).toBe(2);
        expect(bundle.filters.includeSynthetic).toBe(true);
        expect(bundle.label_policy_version).toContain('vvrb-benchmark-only');
    });

    it('detects leakage, repeated templates, shallow lab diversity, and high confidence/CIRE correlation', () => {
        const records = Array.from({ length: 12 }, (_, index) => vvrbCase({
            benchmark_id: `VVRB-${index + 1}`,
            case_domain: 'canine infectious',
            confirmed_diagnosis: 'Canine parvoviral enteritis',
            confidence_score: 0.7 + index * 0.01,
            cire_phi_hat: 0.72 + index * 0.01,
        }));

        const audit = auditVvrbCases(records);

        expect(audit.total_cases).toBe(12);
        expect(audit.synthetic_cases).toBe(12);
        expect(audit.diagnosis_leakage_rate).toBe(1);
        expect(audit.unique_lab_pattern_count).toBe(1);
        expect(audit.issues.map((issue) => issue.key)).toContain('diagnosis_target_leakage');
        expect(audit.issues.map((issue) => issue.key)).toContain('lab_template_repetition');
        expect(audit.issues.map((issue) => issue.key)).toContain('confidence_cire_correlation_too_high');
        expect(audit.blocked_uses).toContain('federated_outcome_learning_eligibility');
    });

    it('creates a zero-eligibility firewall report for federation and moat counts', () => {
        const audit = auditVvrbCases([vvrbCase()]);
        const firewall = buildVvrbSyntheticFirewallReport(audit);

        expect(firewall.synthetic).toBe(true);
        expect(firewall.learning_ledger_rows_allowed).toBe(0);
        expect(firewall.federation_rows_allowed).toBe(0);
        expect(firewall.moat_completion_rows_allowed).toBe(0);
        expect(firewall.synthetic_rows_excluded).toBe(1);
        expect(firewall.federated_outcome_eligibility.eligibility_status).toBe('blocked');
        expect(firewall.federated_outcome_eligibility.counts.synthetic_rows_excluded).toBe(1);
    });
});

function vvrbCase(overrides: Partial<VvrbCaseRecord> = {}): VvrbCaseRecord {
    return {
        benchmark_id: 'VVRB-V1-000001',
        synthetic: true,
        benchmark_version: 'VetIOS Veterinary Reasoning Benchmark v1',
        case_domain: 'canine infectious',
        species: 'canine',
        breed: 'Rottweiler',
        age: '9 years',
        sex: 'female spayed',
        weight_kg: 14.3,
        care_environment: 'field service',
        regulatory_region: 'UK',
        severity: 'moderate',
        presenting_complaint: 'acute vomiting and bloody diarrhea',
        history: 'incomplete vaccination; shelter origin',
        clinical_signs: ['dehydration', 'vomiting', 'fever'],
        labs: { CBC: 'leukopenia', fecal_antigen: 'positive CPV antigen' },
        imaging: { abdominal_ultrasound: 'fluid-filled small intestinal loops' },
        differential_diagnoses: [
            'Canine parvoviral enteritis',
            'Intestinal parasitism',
            'Hemorrhagic gastroenteritis',
        ],
        reasoning_chain_public: 'Canine parvoviral enteritis is prioritized because the signal pattern combines dehydration, vomiting, fever with history of incomplete vaccination.',
        red_flags: ['dehydration risk'],
        recommended_tests: ['fecal CPV antigen test', 'CBC'],
        treatment_plan: ['isolation', 'IV crystalloid fluids'],
        antimicrobial_decision: {
            drug: 'ampicillin plus enrofloxacin only if septic risk is high',
            reason: 'use when severe neutropenia or sepsis risk is present',
            stewardship_risk: 'medium',
        },
        clinician_feedback: 'approved',
        confirmed_diagnosis: 'Canine parvoviral enteritis',
        outcome: 'recovered',
        follow_up_days: 21,
        evidence_sources: [
            'MSD/Merck Veterinary Manual disease guidance',
            'WOAH antimicrobial stewardship and transboundary disease principles',
            'Standard veterinary clinical reasoning patterns',
        ],
        confidence_score: 0.9,
        cire_phi_hat: 0.91,
        evaluation_targets: {
            top1_differential: 'Canine parvoviral enteritis',
            top3_contains_confirmed: true,
            documentation_speed_task: 'generate SOAP note from structured case',
            amr_stewardship_task: 'classify antimicrobial need and stewardship risk',
            red_flag_detection_task: 'identify emergency/referral signals',
        },
        ...overrides,
    };
}
