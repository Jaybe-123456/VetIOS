import { describe, expect, it } from 'vitest';
import { buildWorkflowConnectorEvidence, buildWorkflowIntegrationReadiness } from '../workflowConnectorEvidence';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const CASE_ID = '22222222-2222-4222-8222-222222222222';

describe('workflow connector evidence', () => {
    it('turns IDEXX-style lab payloads into de-identified diagnostic evidence', () => {
        const packet = buildWorkflowConnectorEvidence({
            connectorType: 'lab_result',
            vendorName: 'IDEXX',
            vendorAccountRef: 'clinic-account-7',
            patientId: PATIENT_ID,
            caseId: CASE_ID,
            observedAt: '2026-06-22T13:00:00.000Z',
            payload: {
                event_id: 'idexx-lab-123',
                source_format: 'hl7_v2_oru',
                test_name: 'Urine culture antimicrobial susceptibility',
                result_value: 'E. coli detected',
                units: 'CFU/mL',
                abnormal_flag: 'H',
                primary_condition_class: 'urinary',
                resulted_at: '2026-06-22T13:00:00.000Z',
            },
        });

        expect(packet.evidence_status).toBe('diagnostic_signal_ready');
        expect(packet.moat_posture).toBe('provenance_foundation');
        expect(packet.connector).toMatchObject({
            connector_type: 'lab_result',
            ingestion_profile: 'lab_result_import',
            source_standard: 'hl7_v2_oru',
            vendor_name: 'IDEXX',
        });
        expect(packet.safe_facts).toMatchObject({
            analyte: 'Urine culture antimicrobial susceptibility',
            abnormal: true,
            abnormal_flag: 'H',
            primary_condition_class: 'urinary',
        });
        expect(packet.data_minimization.raw_payload_stored).toBe(false);
        expect(packet.data_minimization.direct_phi_detected).toBe(false);
        expect(packet.provenance.source_payload_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(packet.provenance.source_record_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(packet.provenance.patient_ref_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(packet.readiness_score).toBeGreaterThanOrEqual(0.7);
    });

    it('hashes PACS identifiers and report text instead of storing raw imaging material', () => {
        const packet = buildWorkflowConnectorEvidence({
            connectorType: 'imaging_report',
            vendorName: 'VetPACS',
            patientId: PATIENT_ID,
            observedAt: '2026-06-22T14:00:00.000Z',
            payload: {
                report_id: 'pacs-report-77',
                source_format: 'dicomweb',
                modality: 'radiograph',
                study_instance_uid: '1.2.840.113619.2.55.3.604688435.781.171905',
                image_count: 4,
                abnormal: true,
                impression: 'Patchy bronchointerstitial pattern; recommend clinician review.',
                primary_condition_class: 'respiratory',
            },
        });

        expect(packet.connector.source_standard).toBe('dicomweb');
        expect(packet.safe_facts.study_instance_uid_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(packet.safe_facts).not.toHaveProperty('study_instance_uid');
        expect(packet.safe_facts).not.toHaveProperty('impression');
        expect(packet.provenance.text_field_hashes.impression).toMatch(/^[a-f0-9]{64}$/);
        expect(packet.data_minimization.free_text_fields_hashed).toContain('impression');
        expect(packet.warnings).toContain('free_text_fields_hashed_not_stored');
    });

    it('blocks connector evidence when direct owner or patient identifiers appear in payloads', () => {
        const packet = buildWorkflowConnectorEvidence({
            vendorName: 'ezyVet',
            vendorEventType: 'appointment.completed',
            patientId: PATIENT_ID,
            payload: {
                appointment_id: 'apt-1',
                appointment_status: 'completed',
                owner_name: 'Jane Example',
                owner_email: 'jane@example.com',
                patient_name: 'Milo',
                reason: 'Follow-up recheck resolved',
                resolved: true,
                primary_condition_class: 'dermatologic',
            },
        });

        expect(packet.evidence_status).toBe('blocked');
        expect(packet.moat_posture).toBe('blocked_phi_risk');
        expect(packet.blockers).toContain('direct_phi_detected_in_connector_payload');
        expect(packet.data_minimization.detected_phi_paths).toEqual([
            'owner_email',
            'owner_name',
            'patient_name',
        ]);
        expect(packet.safe_facts).not.toHaveProperty('owner_name');
        expect(packet.safe_facts).not.toHaveProperty('patient_name');
    });

    it('promotes completed follow-up signals into outcome-linkage evidence', () => {
        const packet = buildWorkflowConnectorEvidence({
            vendorName: 'ezyVet',
            vendorEventType: 'appointment.completed',
            patientId: PATIENT_ID,
            observedAt: '2026-06-22T17:00:00.000Z',
            payload: {
                appointment_id: 'apt-2',
                appointment_status: 'completed',
                completed: true,
                resolved: true,
                primary_condition_class: 'urinary',
            },
        });

        expect(packet.connector.connector_type).toBe('recheck');
        expect(packet.evidence_status).toBe('outcome_signal_ready');
        expect(packet.moat_posture).toBe('outcome_linkage_ready');
        expect(packet.signal).toMatchObject({
            signalType: 'follow_up',
            signalSubtype: 'completed_recheck',
            outcomeState: 'resolved',
        });
        expect(packet.coverage.outcome_signal).toBe(true);
    });

    it('rolls live workflow packets into operating integration readiness', () => {
        const lab = buildWorkflowConnectorEvidence({
            connectorType: 'lab_result',
            vendorName: 'IDEXX',
            vendorAccountRef: 'clinic-account-7',
            patientId: PATIENT_ID,
            observedAt: '2026-06-22T13:00:00.000Z',
            payload: {
                event_id: 'idexx-lab-123',
                source_format: 'hl7_v2_oru',
                test_name: 'Urine culture antimicrobial susceptibility',
                result_value: 'E. coli detected',
                abnormal_flag: 'H',
                primary_condition_class: 'urinary',
                resulted_at: '2026-06-22T13:00:00.000Z',
            },
        });
        const pacs = buildWorkflowConnectorEvidence({
            connectorType: 'imaging_report',
            vendorName: 'VetPACS',
            patientId: PATIENT_ID,
            observedAt: '2026-06-22T14:00:00.000Z',
            payload: {
                report_id: 'pacs-report-77',
                source_format: 'dicomweb',
                modality: 'radiograph',
                study_instance_uid: '1.2.840.113619.2.55.3.604688435.781.171905',
                abnormal: true,
                primary_condition_class: 'respiratory',
            },
        });
        const followUp = buildWorkflowConnectorEvidence({
            vendorName: 'ezyVet',
            vendorEventType: 'appointment.completed',
            patientId: PATIENT_ID,
            observedAt: '2026-06-23T16:00:00.000Z',
            payload: {
                appointment_id: 'apt-2',
                appointment_status: 'completed',
                completed: true,
                resolved: true,
                primary_condition_class: 'urinary',
            },
        });

        const readiness = buildWorkflowIntegrationReadiness({
            packets: [lab, pacs, followUp],
            now: '2026-06-23T17:00:00.000Z',
        });

        expect(readiness.moat_status).toBe('operating');
        expect(readiness.blockers).toEqual([]);
        expect(readiness.required_capabilities_ready).toBe(readiness.required_capabilities);
        expect(readiness.readiness_score).toBeGreaterThanOrEqual(0.9);
        expect(readiness.source_standard_counts.hl7_v2_oru).toBe(1);
        expect(readiness.source_standard_counts.dicomweb).toBe(1);
        expect(readiness.capability_coverage.find((entry) => entry.capability === 'pims_workflow_sync')?.status).toBe('ready');
        expect(readiness.capability_coverage.find((entry) => entry.capability === 'follow_up_automation')?.latest_observed_at).toBe('2026-06-23T16:00:00.000Z');
    });

    it('keeps workflow integrations at foundation when PACS evidence is missing', () => {
        const lab = buildWorkflowConnectorEvidence({
            connectorType: 'lab_result',
            vendorName: 'IDEXX',
            patientId: PATIENT_ID,
            observedAt: '2026-06-22T13:00:00.000Z',
            payload: {
                source_format: 'hl7_v2_oru',
                test_name: 'Creatinine',
                abnormal_flag: 'H',
                primary_condition_class: 'renal',
            },
        });
        const followUp = buildWorkflowConnectorEvidence({
            vendorName: 'ezyVet',
            vendorEventType: 'appointment.completed',
            patientId: PATIENT_ID,
            observedAt: '2026-06-23T16:00:00.000Z',
            payload: {
                appointment_status: 'completed',
                completed: true,
                resolved: true,
                primary_condition_class: 'renal',
            },
        });

        const readiness = buildWorkflowIntegrationReadiness({ packets: [lab, followUp] });

        expect(readiness.moat_status).toBe('foundation');
        expect(readiness.blockers).toContain('required_capability_missing:pacs_report_import');
        expect(readiness.capability_coverage.find((entry) => entry.capability === 'pacs_report_import')?.status).toBe('missing');
    });

    it('blocks workflow integration readiness when only PHI-bearing payloads are present', () => {
        const blocked = buildWorkflowConnectorEvidence({
            vendorName: 'ezyVet',
            vendorEventType: 'appointment.completed',
            patientId: PATIENT_ID,
            payload: {
                appointment_status: 'completed',
                owner_email: 'jane@example.com',
                patient_name: 'Milo',
                resolved: true,
                primary_condition_class: 'dermatologic',
            },
        });

        const readiness = buildWorkflowIntegrationReadiness({ packets: [blocked] });

        expect(readiness.moat_status).toBe('blocked');
        expect(readiness.blockers).toContain('blocked_connector_payloads_present');
        expect(readiness.capability_coverage.find((entry) => entry.capability === 'pims_workflow_sync')?.status).toBe('blocked');
    });
});
