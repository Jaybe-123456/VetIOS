import { describe, expect, it } from 'vitest';
import {
    buildRealCaseInputSignature,
    importRealClinicalCases,
    validateRealCaseImportRow,
    type RealCaseImportRow,
} from '../realCaseImport';

describe('real clinical case import', () => {
    it('validates a de-identified, consented, outcome-labeled case', () => {
        const row = sampleCase();
        const result = validateRealCaseImportRow(row, { tenantConsentGranted: false });

        expect(result.ok).toBe(true);
        expect(result.ok && result.caseKey).toMatch(/^source:/);
        expect(result.ok && result.inputSignature.metadata).toMatchObject({
            source: 'real_case_import',
            usage_class: 'internal_deidentified',
            deidentified: true,
            confirmed_diagnosis: 'immune-mediated hemolytic anemia',
        });
    });

    it('rejects direct identifiers before import', () => {
        const row = sampleCase({
            patient: {
                ...sampleCase().patient,
                name: 'Molly',
                owner_contact: { phone: '555-555-1212' },
            },
            history: 'Owner called from 555-555-1212 after collapse.',
        });
        const result = validateRealCaseImportRow(row, { tenantConsentGranted: true });

        expect(result.ok).toBe(false);
        expect(!result.ok && result.rejection.error_codes).toEqual(expect.arrayContaining([
            'patient_name_present',
            'owner_contact_present',
            'possible_phone',
        ]));
    });

    it('rejects learning-ready imports without tenant or case-level consent', () => {
        const row = sampleCase({ learning_consent: { deidentified_training: false } });
        const result = validateRealCaseImportRow(row, { tenantConsentGranted: false });

        expect(result.ok).toBe(false);
        expect(!result.ok && result.rejection.error_codes).toContain('learning_consent_missing');
    });

    it('supports dry-run validation without writing clinical rows', async () => {
        const report = await importRealClinicalCases({} as any, {
            tenantId: '22222222-2222-4222-8222-222222222222',
            cases: [sampleCase()],
            dryRun: true,
            tenantConsentGranted: false,
        });

        expect(report.summary).toMatchObject({
            total: 1,
            accepted: 1,
            rejected: 0,
            learning_ready: 1,
        });
        expect(report.imported[0]).toMatchObject({
            status: 'validated',
            clinical_case_id: null,
            outcome_event_id: null,
        });
    });

    it('does not include direct patient identity fields in the input signature', () => {
        const signature = buildRealCaseInputSignature(sampleCase(), '2026-05-24T12:00:00.000Z');

        expect(signature).not.toHaveProperty('patient_name');
        expect(signature).not.toHaveProperty('owner_name');
        expect(signature.metadata).not.toHaveProperty('microchip_id');
    });
});

function sampleCase(patch: Partial<RealCaseImportRow> = {}): RealCaseImportRow {
    return {
        source_case_reference: 'pilot-2026-0001',
        usage_class: 'internal_deidentified',
        deidentified: true,
        patient: {
            species: 'canine',
            breed: 'Labrador Retriever',
            age_years: 7,
            weight_kg: 32.5,
            sex: 'female_spayed',
            deidentified_patient_ref: 'hash:7b6c',
        },
        presenting_complaint: 'acute lethargy and pale mucous membranes',
        symptoms: ['tachycardia', 'dark urine', 'jaundice'],
        history: 'De-identified prior hip dysplasia history.',
        confirmed_diagnosis: 'immune-mediated hemolytic anemia',
        diagnosis_method: 'lab_confirmed',
        diagnosis_confidence: 0.98,
        primary_condition_class: 'hematologic',
        learning_consent: { deidentified_training: true },
        ...patch,
    };
}
