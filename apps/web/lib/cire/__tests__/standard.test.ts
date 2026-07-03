import { describe, expect, it } from 'vitest';
import {
    CIRE_CONFORMANCE_API_PATH,
    CIRE_CERTIFICATION_API_PATH,
    CIRE_STANDARD_API_PATH,
    CIRE_STANDARD_KEY,
    CIRE_STANDARD_PATH,
    getCireOpenStandard,
} from '../standard';

describe('CIRE open standard', () => {
    it('publishes a versioned public reliability contract', () => {
        const standard = getCireOpenStandard('https://www.vetios.tech');

        expect(standard.standard_key).toBe(CIRE_STANDARD_KEY);
        expect(standard.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(standard.canonical_url).toBe(`https://www.vetios.tech${CIRE_STANDARD_PATH}`);
        expect(standard.machine_readable_url).toBe(`https://www.vetios.tech${CIRE_STANDARD_API_PATH}`);
        expect(standard.conformance_report_url).toBe(`https://www.vetios.tech${CIRE_CONFORMANCE_API_PATH}`);
        expect(standard.certification_registry_url).toBe(`https://www.vetios.tech${CIRE_CERTIFICATION_API_PATH}`);
        expect(standard.implementation.package_name).toBe('@vetios/cire-engine');
    });

    it('defines the runtime signals needed for external citation', () => {
        const standard = getCireOpenStandard();
        const formulaKeys = standard.formulas.map((formula) => formula.key);

        expect(formulaKeys).toEqual(['phi_hat', 'input_m_hat', 'delta_rolling', 'sigma_delta', 'cps']);
        expect(standard.safety_states.map((state) => state.reliability_badge)).toEqual([
            'HIGH',
            'REVIEW',
            'CAUTION',
            'SUPPRESSED',
        ]);
        expect(standard.required_runtime_fields).toEqual(expect.arrayContaining([
            'phi_hat',
            'cps',
            'safety_state',
            'reliability_badge',
            'input_signature',
        ]));
        expect(standard.public_api_surfaces).toContain(CIRE_CONFORMANCE_API_PATH);
        expect(standard.public_api_surfaces).toContain(CIRE_CERTIFICATION_API_PATH);
    });
});
