import { describe, expect, it } from 'vitest';
import { validateCireConformanceReport } from '@vetios/cire-engine';
import { CIRE_CONFORMANCE_API_PATH, CIRE_STANDARD_API_PATH } from '../standard';
import { CIRE_CONFORMANCE_REPORT, getCirePublicConformanceArtifact } from '../conformance';

describe('CIRE public conformance artifact', () => {
    it('publishes a machine-readable validation fixture', () => {
        const artifact = getCirePublicConformanceArtifact('https://www.vetios.tech');

        expect(artifact.artifact_key).toBe('vetios-cire-conformance-v1');
        expect(artifact.standard_url).toBe(`https://www.vetios.tech${CIRE_STANDARD_API_PATH}`);
        expect(artifact.conformance_url).toBe(`https://www.vetios.tech${CIRE_CONFORMANCE_API_PATH}`);
        expect(artifact.report.standard_version).toBe(artifact.standard_version);
        expect(artifact.validation.passed).toBe(true);
        expect(artifact.validation.summary).toEqual({ total: 10, passed: 10, failed: 0 });
    });

    it('stays compatible with the reference validator', () => {
        const validation = validateCireConformanceReport(CIRE_CONFORMANCE_REPORT);

        expect(validation.passed).toBe(true);
        expect(validation.checks.map((check) => check.group)).toEqual([
            'differential',
            'differential',
            'differential',
            'input',
            'input',
            'cps',
            'cps',
            'cps',
            'cps',
            'output_vector',
        ]);
    });
});
