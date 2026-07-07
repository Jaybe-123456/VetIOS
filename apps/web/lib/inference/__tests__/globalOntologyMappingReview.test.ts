import { describe, expect, it } from 'vitest';
import {
    buildExternalValidationEventRow,
    buildMappingReviewEventRow,
    recordExternalValidationEvent,
    recordMappingReviewEvent,
} from '../globalOntologyMappingReview';

describe('global ontology mapping review events', () => {
    it('builds reviewer verification rows without promoting to external verification', () => {
        const row = buildMappingReviewEventRow({
            tenantId: '00000000-0000-4000-8000-000000000001',
            requestId: 'mapping-review-test',
            conditionKey: 'rabies',
            sourceKey: 'mondo_disease_ontology',
            externalCodeSystem: 'MONDO',
            externalCode: 'MONDO:0005091',
            reviewAction: 'approve',
            reviewerRole: 'clinical_ontology_reviewer',
        });

        expect(row).toMatchObject({
            condition_key: 'rabies',
            review_status: 'reviewer_verified',
            promoted_mapping_status: 'reviewer_verified',
        });
        expect(row.blockers).toContain('external_validation_required_before_externally_verified');
    });

    it('builds externally verified validation rows with artifact hashes', () => {
        const row = buildExternalValidationEventRow({
            requestId: 'external-validation-test',
            conditionKey: 'rabies',
            sourceKey: 'mondo_disease_ontology',
            externalCodeSystem: 'MONDO',
            externalCode: 'MONDO:0005091',
            validationProvider: 'external-ontology-board',
            validationMethod: 'third_party_conformance',
            validationStatus: 'externally_verified',
            validationConfidence: 0.98,
        });

        expect(row).toMatchObject({
            validation_status: 'externally_verified',
            promoted_mapping_status: 'externally_verified',
            blockers: [],
        });
        expect(row.validation_artifact_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('records review and validation events through append-only tables', async () => {
        const insertedTables: string[] = [];
        const client = {
            from(table: string) {
                insertedTables.push(table);
                return {
                    insert() {
                        return {
                            select() {
                                return {
                                    async single() {
                                        return { data: { id: `${table}-id` }, error: null };
                                    },
                                };
                            },
                        };
                    },
                };
            },
        };

        const review = await recordMappingReviewEvent(client, {
            requestId: 'review-record-test',
            conditionKey: 'rabies',
            sourceKey: 'mondo_disease_ontology',
            reviewAction: 'request_external_validation',
        });
        const validation = await recordExternalValidationEvent(client, {
            requestId: 'validation-record-test',
            conditionKey: 'rabies',
            sourceKey: 'mondo_disease_ontology',
            validationProvider: 'external',
            validationMethod: 'external_review',
            validationStatus: 'pending',
        });

        expect(review.error).toBeNull();
        expect(validation.error).toBeNull();
        expect(insertedTables).toEqual([
            'global_condition_source_mapping_review_events',
            'global_ontology_external_validation_events',
        ]);
    });
});
