import { describe, expect, it } from 'vitest';
import {
    aggregateAMRStewardship,
    buildAMRLabFeedIngestionBatchPacket,
    buildAMROneHealthExportPacket,
    buildAMRLabFeedSurveillanceEventDraft,
    buildAMRLabFeedSurveillancePacket,
    normalizeAMRDrugClassTaxonomy,
    normalizeAMRLabel,
    normalizeAMRPathogenTaxonomy,
    normalizeAMRStringList,
} from '@/lib/amr/stewardship';

describe('AMR stewardship moat', () => {
    it('normalizes clinical AMR labels for surveillance joins', () => {
        expect(normalizeAMRLabel('Escherichia coli / UTI')).toBe('escherichia_coli_uti');
        expect(normalizeAMRPathogenTaxonomy('E. coli')).toEqual({
            pathogen_label: 'escherichia_coli',
            pathogen_key: 'escherichia_coli',
        });
        expect(normalizeAMRDrugClassTaxonomy('Beta-Lactams')).toBe('beta_lactam');
        expect(normalizeAMRStringList(['Beta Lactam', 'beta-lactam', 'Fluoroquinolone'])).toEqual([
            'beta_lactam',
            'fluoroquinolone',
        ]);
    });

    it('aggregates de-identified stewardship events without exposing case rows', () => {
        const aggregate = aggregateAMRStewardship([
            {
                species: 'canine',
                pathogen_label: 'escherichia_coli',
                infection_site: 'urinary_tract',
                drug_name: 'amoxicillin clavulanate',
                drug_class: 'beta_lactam',
                decision_stage: 'culture_guided',
                stewardship_status: 'culture_guided',
                outcome_status: 'improved',
                culture_collected: true,
                resistance_suspected: true,
                de_escalation_recommended: true,
                review_required: true,
                resistance_classes: ['beta_lactam'],
                observed_at: '2026-06-19T10:00:00.000Z',
            },
            {
                species: 'canine',
                pathogen_label: 'escherichia_coli',
                infection_site: 'skin',
                drug_name: 'doxycycline',
                drug_class: 'tetracycline',
                decision_stage: 'empiric',
                stewardship_status: 'pending_culture',
                outcome_status: 'unchanged',
                culture_collected: false,
                resistance_suspected: false,
                de_escalation_recommended: false,
                review_required: true,
                resistance_classes: ['tetracycline'],
                observed_at: '2026-06-19T11:00:00.000Z',
            },
        ]);

        expect(aggregate.total_events).toBe(2);
        expect(aggregate.culture_guided_events).toBe(1);
        expect(aggregate.culture_guided_rate).toBe(0.5);
        expect(aggregate.resistance_suspected_rate).toBe(0.5);
        expect(aggregate.review_required_rate).toBe(1);
        expect(aggregate.top_pathogens[0]).toEqual({ pathogen_label: 'escherichia_coli', count: 2 });
        expect(aggregate.latest_observed_at).toBe('2026-06-19T11:00:00.000Z');
    });

    it('builds AST-backed AMR lab feed surveillance packets for One Health export', () => {
        const packet = buildAMRLabFeedSurveillancePacket({
            request_id: '11111111-1111-4111-8111-111111111111',
            species: 'Canine',
            pathogen_label: 'Escherichia coli',
            infection_site: 'Urinary tract',
            sample_source: 'Urine',
            culture_collected: true,
            culture_result: 'positive',
            ast_method: 'broth_microdilution',
            ast_panel: {
                amoxicillin_clavulanate: { interpretation: 'R' },
                enrofloxacin: { interpretation: 'S' },
            },
            mic_results: {
                amoxicillin_clavulanate: '>=32',
                enrofloxacin: '0.5',
            },
            resistance_genes: ['blaCTX-M-15'],
            resistance_classes: ['beta lactam'],
            drug_name: 'Amoxicillin clavulanate',
            drug_class: 'Beta lactam',
            decision_stage: 'culture_guided',
            stewardship_status: 'culture_guided',
            outcome_status: 'improved',
            resistance_suspected: true,
            de_escalation_recommended: true,
            observed_at: '2026-06-19T10:00:00.000Z',
        });

        expect(packet.lab_feed_status).toBe('one_health_export_ready');
        expect(packet.normalization).toMatchObject({
            species: 'canine',
            pathogen_key: 'escherichia_coli',
            infection_site: 'urinary_tract',
            drug_class: 'beta_lactam',
            trend_bucket_key: 'canine:escherichia_coli:urinary_tract:beta_lactam',
        });
        expect(packet.ast.ast_ready).toBe(true);
        expect(packet.ast.susceptibility_result_count).toBe(2);
        expect(packet.ast.interpretation_counts).toMatchObject({
            susceptible: 1,
            resistant: 1,
        });
        expect(packet.surveillance.one_health_export_ready).toBe(true);
        expect(packet.resistance_signal_score).toBeGreaterThanOrEqual(0.45);
        expect(packet.provenance.source_record_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(packet.privacy.raw_lab_report_stored).toBe(false);
        expect(packet.next_actions).toContain('queue_one_health_amr_export');
    });

    it('builds append-only lab feed event drafts without raw lab reports', () => {
        const packet = buildAMRLabFeedSurveillancePacket({
            request_id: '11111111-1111-4111-8111-111111111111',
            species: 'Feline',
            pathogen_label: 'Staphylococcus pseudintermedius',
            infection_site: 'Skin',
            sample_source: 'swab',
            culture_collected: true,
            ast_panel: {
                cephalexin: { interpretation: 'R' },
            },
            mic_results: {
                cephalexin: '16',
            },
            resistance_classes: ['beta lactam'],
            drug_name: 'Cephalexin',
            drug_class: 'Cephalosporin',
            resistance_suspected: true,
            observed_at: '2026-06-19T12:00:00.000Z',
        });

        const draft = buildAMRLabFeedSurveillanceEventDraft({
            tenantId: '22222222-2222-4222-8222-222222222222',
            requestId: '11111111-1111-4111-8111-111111111111',
            amrStewardshipEventId: '33333333-3333-4333-8333-333333333333',
            caseId: '44444444-4444-4444-8444-444444444444',
            packet,
            evidence: {
                endpoint: '/api/amr/stewardship',
            },
            observedAt: '2026-06-19T12:00:00.000Z',
        });

        expect(draft.lab_feed_status).toBe('one_health_export_ready');
        expect(draft.trend_bucket_key).toBe('feline:staphylococcus_pseudintermedius:skin:cephalosporin');
        expect(draft.source_record_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(draft.packet_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(draft.ast_panel_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(draft.evidence).toMatchObject({
            endpoint: '/api/amr/stewardship',
            raw_lab_report_stored: false,
            raw_owner_or_patient_identifiers_stored: false,
        });
        expect(JSON.stringify(draft.surveillance_packet)).not.toContain('owner');
    });

    it('rolls AMR lab-feed rows into a de-identified One Health export packet', () => {
        const caninePacket = buildAMRLabFeedSurveillancePacket({
            request_id: '11111111-1111-4111-8111-111111111111',
            species: 'Canine',
            pathogen_label: 'Escherichia coli',
            infection_site: 'Urinary tract',
            sample_source: 'Urine',
            culture_collected: true,
            ast_panel: {
                amoxicillin_clavulanate: { interpretation: 'R' },
                enrofloxacin: { interpretation: 'S' },
            },
            mic_results: {
                amoxicillin_clavulanate: '>=32',
                enrofloxacin: '0.5',
            },
            resistance_classes: ['beta lactam'],
            drug_name: 'Amoxicillin clavulanate',
            drug_class: 'Beta lactam',
            resistance_suspected: true,
            observed_at: '2026-06-19T10:00:00.000Z',
        });
        const felinePacket = buildAMRLabFeedSurveillancePacket({
            request_id: '22222222-2222-4222-8222-222222222222',
            species: 'Feline',
            pathogen_label: 'Staphylococcus pseudintermedius',
            infection_site: 'Skin',
            sample_source: 'Swab',
            culture_collected: true,
            ast_panel: {
                cephalexin: { interpretation: 'I' },
            },
            resistance_classes: ['beta lactam'],
            drug_name: 'Cephalexin',
            drug_class: 'Cephalosporin',
            observed_at: '2026-06-19T12:00:00.000Z',
        });
        const canineDraft = buildAMRLabFeedSurveillanceEventDraft({
            tenantId: '33333333-3333-4333-8333-333333333333',
            requestId: '11111111-1111-4111-8111-111111111111',
            packet: caninePacket,
            observedAt: '2026-06-19T10:00:00.000Z',
        });
        const felineDraft = buildAMRLabFeedSurveillanceEventDraft({
            tenantId: '33333333-3333-4333-8333-333333333333',
            requestId: '22222222-2222-4222-8222-222222222222',
            packet: felinePacket,
            observedAt: '2026-06-19T12:00:00.000Z',
        });

        const exportPacket = buildAMROneHealthExportPacket({
            rows: [canineDraft, felineDraft],
            generatedAt: '2026-06-20T00:00:00.000Z',
        });

        expect(exportPacket.export_status).toBe('export_ready');
        expect(exportPacket.summary.total_rows).toBe(2);
        expect(exportPacket.summary.export_ready_rows).toBe(2);
        expect(exportPacket.summary.unique_trend_buckets).toBe(2);
        expect(exportPacket.trends[0].source_digest_bundle_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(exportPacket.provenance.export_packet_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(exportPacket.privacy_contract.join(' ')).toContain('Raw lab reports');
        expect(JSON.stringify(exportPacket)).not.toContain('owner');
    });

    it('materializes de-identified AMR lab-feed ingestion batches for partner feeds', () => {
        const batch = buildAMRLabFeedIngestionBatchPacket({
            tenant_id: '33333333-3333-4333-8333-333333333333',
            lab_partner_ref: 'reference-lab-account-9',
            feed_source: 'IDEXX VetConnect PLUS',
            generated_at: '2026-06-20T00:00:00.000Z',
            rows: [
                {
                    request_id: '11111111-1111-4111-8111-111111111111',
                    species: 'Canine',
                    pathogen_label: 'E. coli',
                    infection_site: 'Urinary tract',
                    sample_source: 'Urine',
                    culture_collected: true,
                    culture_result: 'positive',
                    ast_panel: {
                        amoxicillin_clavulanate: { interpretation: 'R' },
                        enrofloxacin: { interpretation: 'S' },
                    },
                    mic_results: {
                        amoxicillin_clavulanate: '>=32',
                    },
                    resistance_classes: ['Beta-Lactams'],
                    drug_name: 'Amoxicillin clavulanate',
                    drug_class: 'Beta-Lactams',
                    resistance_suspected: true,
                    observed_at: '2026-06-19T10:00:00.000Z',
                },
                {
                    request_id: '22222222-2222-4222-8222-222222222222',
                    species: 'Canine',
                    pathogen_label: 'Staph pseudintermedius',
                    infection_site: 'Skin',
                    sample_source: 'Swab',
                    culture_collected: true,
                    ast_panel: {
                        cephalexin: { interpretation: 'I' },
                    },
                    drug_name: 'Cephalexin',
                    drug_class: 'Cephalosporins',
                    observed_at: '2026-06-19T12:00:00.000Z',
                },
            ],
        });

        expect(batch.ingestion_status).toBe('ready');
        expect(batch.summary.submitted_rows).toBe(2);
        expect(batch.summary.one_health_export_ready_rows).toBe(2);
        expect(batch.summary.taxonomy_completion_score).toBe(1);
        expect(batch.summary.duplicate_source_digest_count).toBe(0);
        expect(batch.event_drafts[0].pathogen_key).toBe('escherichia_coli');
        expect(batch.event_drafts[0].drug_class).toBe('beta_lactam');
        expect(batch.one_health_export_packet.export_status).toBe('export_ready');
        expect(batch.provenance.ingestion_packet_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(batch.next_actions).toContain('persist_amr_lab_feed_surveillance_events');
        expect(JSON.stringify(batch)).not.toContain('reference-lab-account-9');
        expect(JSON.stringify(batch)).not.toContain('owner');
    });

    it('flags duplicate and identifier-bearing AMR lab-feed rows before export', () => {
        const row = {
            request_id: '11111111-1111-4111-8111-111111111111',
            species: 'Canine',
            pathogen_label: 'E. coli',
            infection_site: 'Urinary tract',
            sample_source: 'Urine',
            culture_collected: true,
            ast_panel: {
                amoxicillin_clavulanate: { interpretation: 'R' },
            },
            drug_name: 'Amoxicillin clavulanate',
            drug_class: 'Beta lactam',
            evidence: {
                owner_email: 'client@example.com',
            },
            observed_at: '2026-06-19T10:00:00.000Z',
        };
        const batch = buildAMRLabFeedIngestionBatchPacket({
            tenant_id: '33333333-3333-4333-8333-333333333333',
            rows: [row, { ...row, request_id: '22222222-2222-4222-8222-222222222222' }],
            generated_at: '2026-06-20T00:00:00.000Z',
        });

        expect(batch.ingestion_status).toBe('blocked');
        expect(batch.blockers).toContain('direct_identifier_risk_in_source_rows');
        expect(batch.warnings).toContain('duplicate_source_record_digests_detected');
        expect(batch.summary.duplicate_source_digest_count).toBe(1);
        expect(batch.next_actions).toContain('remove_identifier_bearing_lab_feed_fields');
    });
});
