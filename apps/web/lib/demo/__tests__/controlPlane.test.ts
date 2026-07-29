import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildDemoCalibrationPreview,
    DEMO_CONTROL_PLANE_CASE,
    stableSerializeDemoValue,
} from '@/lib/demo/controlPlane';

describe('public demo control-plane contract', () => {
    it('defines phi-hat as concentration rather than correctness', () => {
        expect(DEMO_CONTROL_PLANE_CASE.inference.cire).toMatchObject({
            phi_hat_semantics: 'differential_concentration_not_correctness',
            cps_semantics: 'runtime_perturbation_pressure',
            conformance_state: 'demo_fixture_not_certified',
        });
    });

    it('never makes a synthetic public outcome eligible for calibration', () => {
        expect(buildDemoCalibrationPreview(false)).toMatchObject({
            materialization_status: 'pending',
            evidence_eligible: false,
            persisted: false,
        });
        expect(buildDemoCalibrationPreview(true)).toMatchObject({
            observed_target: 1,
            calibration_residual: 0.27,
            materialization_status: 'blocked',
            evidence_eligible: false,
            persisted: false,
        });
    });

    it('keeps raw records and raw deltas out of the outbound packet', () => {
        const packet = DEMO_CONTROL_PLANE_CASE.sovereignty.outbound_packet;
        expect(packet).toMatchObject({
            raw_records_included: false,
            raw_delta_included: false,
            submission_state: 'not_submitted_demo_fixture',
        });
        expect(JSON.stringify(packet)).not.toContain('free_text_history');
        expect(JSON.stringify(packet)).not.toContain('patient_ref');
    });

    it('does not invent regional AMR counts or treatment recommendations', () => {
        expect(DEMO_CONTROL_PLANE_CASE.amr).toMatchObject({
            regional_surveillance_state: 'not_configured',
            external_source_state: 'not_asserted',
            aggregate_counts: null,
            prescribing_recommendation: null,
        });
    });

    it('serializes displayed evidence deterministically for browser hashing', () => {
        expect(stableSerializeDemoValue({ z: 1, a: { y: 2, b: 3 } })).toBe(
            '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}',
        );
    });

    it('keeps lifecycle controls accessible and truth labels visible', () => {
        const component = readFileSync(
            resolve(process.cwd(), 'components/clinical/DemoCase.tsx'),
            'utf8',
        );
        expect(component).toContain('role="tablist"');
        expect(component).toContain('aria-selected={selected}');
        expect(component).toContain('aria-pressed={view ===');
        expect(component).toContain('role="progressbar"');
        expect(component).toContain("label: 'DEMO FIXTURE'");
        expect(component).toContain("label: 'NOT CONFIGURED'");
    });

    it('rejects the old diagnosis-widget positioning and unsafe claims', () => {
        const component = readFileSync(
            resolve(process.cwd(), 'components/clinical/DemoCase.tsx'),
            'utf8',
        );
        expect(component).not.toContain('Try a VetIOS demo case');
        expect(component).not.toContain('Run demo diagnosis');
        expect(component).not.toContain('un-hackable');
        expect(component).not.toContain('Zero Data Export');
        expect(component).not.toContain('zero-knowledge masked deltas');
    });
});
