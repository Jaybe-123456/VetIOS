import { describe, expect, it } from 'vitest';
import { hashImportPayload, isMissingImportJobStorage, missingImportJobStorageMessage } from '../importJobs';

describe('clinical case import job helpers', () => {
    it('hashes import payloads deterministically regardless of object key order', () => {
        const left = hashImportPayload({
            dry_run: true,
            cases: [
                {
                    source_case_reference: 'case-1',
                    patient: { species: 'canine', age_years: 3 },
                },
            ],
        });
        const right = hashImportPayload({
            cases: [
                {
                    patient: { age_years: 3, species: 'canine' },
                    source_case_reference: 'case-1',
                },
            ],
            dry_run: true,
        });

        expect(left).toBe(right);
        expect(left).toMatch(/^[a-f0-9]{64}$/);
    });

    it('detects missing import job storage with the migration-specific remediation', () => {
        expect(isMissingImportJobStorage({
            code: 'PGRST116',
            message: "Could not find the table 'public.clinical_case_import_jobs' in the schema cache",
        })).toBe(true);

        expect(missingImportJobStorageMessage()).toContain(
            'supabase/migrations/20260611011000_dataset_consent_and_import_ledgers.sql',
        );
    });
});
