import { describe, expect, it } from 'vitest';
import { detectSpeciesFromTexts } from '../context';
import { buildAskVetiosCaseGraphSnapshot } from '../caseGraph';
import { buildAskVetiosModelTrustSnapshot } from '../modelTrust';
import { buildAskVetiosVeterinaryRetrievalSnapshot } from '../veterinaryRetrieval';
import { buildAskVetiosWorkflowIntegrationSnapshot } from '../workflowIntegration';
import {
    ASK_VETIOS_CASE_DRAFT_STORAGE_KEY,
    ASK_VETIOS_CLINICAL_CASE_DRAFT_STORAGE_KEY,
    buildAskVetiosIntake,
} from '../intake';

describe('Ask VetIOS context detection', () => {
    it('prioritizes the current user query over assistant content', () => {
        expect(detectSpeciesFromTexts([
            'bovine mastitis drug doses',
            'Visual descriptors are generated for feline glanders.',
        ])).toBe('bovine');
    });

    it('detects the supported species terms', () => {
        expect(detectSpeciesFromTexts(['dog with cough'])).toBe('canine');
        expect(detectSpeciesFromTexts(['cat with nasal discharge'])).toBe('feline');
        expect(detectSpeciesFromTexts(['equine glanders clinical images'])).toBe('equine');
        expect(detectSpeciesFromTexts(['avian aspergillosis'])).toBe('avian');
        expect(detectSpeciesFromTexts(['porcine respiratory disease'])).toBe('porcine');
        expect(detectSpeciesFromTexts(['ovine foot rot'])).toBe('ovine');
    });

    it('builds a clinical case draft and inference handoff', () => {
        const intake = buildAskVetiosIntake({
            message: 'Dog, 7 year old neutered male, vomiting and lethargy for 2 days. CBC, chemistry, and abdominal radiographs done. IV fluids started and patient improved. Distended abdomen with unproductive retching.',
        });

        expect(intake.is_clinical_intake).toBe(true);
        expect(intake.case_draft.species).toBe('canine');
        expect(intake.case_draft.age_years).toBe(7);
        expect(intake.case_draft.sex).toBe('neutered male');
        expect(intake.case_draft.clinical_signs).toContain('vomiting');
        expect(intake.case_draft.labs_or_tests).toContain('CBC');
        expect(intake.case_draft.imaging).toContain('radiographs');
        expect(intake.case_draft.treatments).toContain('IV fluids');
        expect(intake.case_draft.outcome_signals).toContain('improved');
        expect(intake.case_draft.red_flags).toContain('possible GDV/bloat pattern');
        expect(intake.case_handoff.storage_key).toBe(ASK_VETIOS_CASE_DRAFT_STORAGE_KEY);
        expect(intake.case_handoff.clinical_case_storage_key).toBe(ASK_VETIOS_CLINICAL_CASE_DRAFT_STORAGE_KEY);
        expect(intake.case_handoff.clinical_case_href).toBe('/cases/new?source=ask-vetios');
        expect(intake.case_handoff.clinical_case_draft.patient?.species).toBe('Canine');
        expect(intake.case_handoff.clinical_case_draft.signs?.duration).toBe('2');
        expect(intake.case_handoff.payload.input.input_signature.species).toBe('canine');
    });

    it('builds a de-identified case graph snapshot for later clinician confirmation', () => {
        const intake = buildAskVetiosIntake({
            message: 'Canine, 7 year old neutered male, vomiting for 2 days. CBC, chemistry, radiographs, and IV fluids. Improved overnight.',
        });
        const snapshot = buildAskVetiosCaseGraphSnapshot({
            intake,
            responseMetadata: {
                urgency_level: 'moderate',
                diagnosis_ranked: [{ name: 'Pancreatitis', confidence: 0.72 }],
                recommended_tests: ['cPLI', 'abdominal ultrasound'],
            },
        });

        expect(snapshot.schema_version).toBe('ask-vetios-case-graph-v1');
        expect(snapshot.status).toBe('ready_for_case_graph');
        expect(snapshot.draft_key).toMatch(/^ask_case_[a-f0-9]{20}$/);
        expect(snapshot.patient.species).toBe('canine');
        expect(snapshot.encounter.raw_note_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(snapshot.encounter.raw_note_hash).not.toContain('vomiting');
        expect(snapshot.encounter.imaging).toContain('radiographs');
        expect(snapshot.encounter.treatments).toContain('IV fluids');
        expect(snapshot.outcome.outcome_status).toBe('mentioned');
        expect(snapshot.outcome.clinician_confirmation_status).toBe('not_captured');
        expect(snapshot.decision_support.top_differentials[0]).toEqual({ name: 'Pancreatitis', confidence: 0.72 });
        expect(snapshot.promotion.required_next_actions).toContain('clinician_confirmation');
    });

    it('marks clinical Ask VetIOS drafts without retrieval citations as needing evidence', () => {
        const intake = buildAskVetiosIntake({
            message: 'Dog vomiting and lethargic for 2 days.',
        });
        const caseGraphSnapshot = buildAskVetiosCaseGraphSnapshot({
            intake,
            responseMetadata: {
                diagnosis_ranked: [{ name: 'Gastroenteritis', confidence: 0.64 }],
            },
        });
        const trust = buildAskVetiosModelTrustSnapshot({
            mode: 'clinical',
            metadata: {
                diagnosis_ranked: [{ name: 'Gastroenteritis', confidence: 0.64 }],
            },
            intake,
            caseGraphSnapshot,
        });

        expect(trust.status).toBe('needs_evidence');
        expect(trust.clinician_review_required).toBe(true);
        expect(trust.grounding.citation_quality).toBe('none');
        expect(trust.calibration_status).toBe('needs_outcome');
        expect(trust.warnings).toContain('Clinical answer lacks retrieval citations; keep as draft until evidence is attached.');
    });

    it('marks grounded clinical Ask VetIOS drafts as ready for draft review telemetry', () => {
        const intake = buildAskVetiosIntake({
            message: 'Canine, 7 year old neutered male, vomiting and lethargy for 2 days. CBC and chemistry completed. Improved with IV fluids.',
        });
        const caseGraphSnapshot = buildAskVetiosCaseGraphSnapshot({
            intake,
            responseMetadata: {
                diagnosis_ranked: [{ name: 'Pancreatitis', confidence: 0.72 }],
                rag_grounded: true,
                rag_citations: [{ index: 1, title: 'Pancreatitis review', source_name: 'VetIOS library', url: null, year: '2026' }],
            },
        });
        const trust = buildAskVetiosModelTrustSnapshot({
            mode: 'clinical',
            metadata: {
                diagnosis_ranked: [{ name: 'Pancreatitis', confidence: 0.72 }],
                rag_grounded: true,
                rag_citations: [{ index: 1, title: 'Pancreatitis review', source_name: 'VetIOS library', url: null, year: '2026' }],
            },
            intake,
            caseGraphSnapshot,
        });

        expect(trust.status).toBe('grounded_draft');
        expect(trust.clinician_review_required).toBe(false);
        expect(trust.grounding.citation_quality).toBe('grounded');
        expect(trust.case_graph.draft_key).toBe(caseGraphSnapshot.draft_key);
        expect(trust.output_quality.confidence_band).toBe('moderate');
    });

    it('records ungrounded clinical Ask VetIOS answers as veterinary retrieval gaps', () => {
        const intake = buildAskVetiosIntake({
            message: 'Dog vomiting and lethargic for 2 days after possible rodenticide exposure.',
        });
        const snapshot = buildAskVetiosVeterinaryRetrievalSnapshot({
            mode: 'clinical',
            metadata: {
                rag_grounded: false,
                rag_citations: [],
                rag_retrieval_stats: { strategy: 'hybrid', catalog_fallback_hits: 0 },
            },
            intake,
        });

        expect(snapshot.status).toBe('ungrounded');
        expect(snapshot.policy.generic_web_memory_allowed).toBe(false);
        expect(snapshot.query_context.toxicology_signal_present).toBe(true);
        expect(snapshot.source_gaps).toContain('accepted_veterinary_citations');
        expect(snapshot.warnings).toContain('Ask VetIOS has no accepted veterinary retrieval citations for this clinical answer.');
    });

    it('marks high-authority species-specific citations as veterinary grounded', () => {
        const intake = buildAskVetiosIntake({
            message: 'Canine, 7 year old neutered male, vomiting for 2 days. CBC, chemistry, cPLI, radiographs, and IV fluids.',
        });
        const citation = {
            index: 1,
            chunk_id: 'chunk-1',
            document_id: 'document-1',
            source_id: 'source-1',
            title: 'Canine pancreatitis diagnostic workflow',
            source_name: 'ACVIM specialist guideline',
            source_type: 'guideline',
            authority_tier: 'specialist_guideline',
            url: 'https://vetios.test/acvim/canine-pancreatitis',
            year: '2026',
            quote: 'Canine pancreatitis workup integrates compatible signs, CBC, chemistry, pancreatic lipase testing, abdominal imaging, and IV fluid treatment.',
            similarity: 0.82,
            provenance: { source_url: 'https://vetios.test/acvim/canine-pancreatitis' },
        };
        const snapshot = buildAskVetiosVeterinaryRetrievalSnapshot({
            mode: 'clinical',
            metadata: {
                rag_grounded: true,
                rag_citations: [citation],
                rag_retrieval_stats: { strategy: 'hybrid', catalog_fallback_hits: 0 },
            },
            intake,
        });
        const trust = buildAskVetiosModelTrustSnapshot({
            mode: 'clinical',
            metadata: {
                diagnosis_ranked: [{ name: 'Pancreatitis', confidence: 0.72 }],
                rag_grounded: true,
                rag_citations: [citation],
                veterinary_retrieval_status: snapshot.status,
            },
            intake,
        });

        expect(snapshot.status).toBe('veterinary_grounded');
        expect(snapshot.grounding.high_authority_citation_count).toBe(1);
        expect(snapshot.coverage.lab_reference).toBe(true);
        expect(snapshot.coverage.species_specific).toBe(true);
        expect(trust.grounding.citation_quality).toBe('grounded');
    });

    it('builds a workflow integration snapshot for case and inference handoff readiness', () => {
        const intake = buildAskVetiosIntake({
            message: 'Canine, 7 year old neutered male, vomiting for 2 days. CBC, chemistry, radiographs, and IV fluids. Improved overnight.',
        });
        const caseGraphSnapshot = buildAskVetiosCaseGraphSnapshot({
            intake,
            responseMetadata: {
                diagnosis_ranked: [{ name: 'Pancreatitis', confidence: 0.72 }],
                recommended_tests: ['cPLI', 'abdominal ultrasound'],
                veterinary_retrieval_status: 'veterinary_grounded',
                model_trust_status: 'grounded_draft',
            },
        });
        const workflow = buildAskVetiosWorkflowIntegrationSnapshot({
            mode: 'clinical',
            metadata: {
                diagnosis_ranked: [{ name: 'Pancreatitis', confidence: 0.72 }],
                recommended_tests: ['cPLI', 'abdominal ultrasound'],
                veterinary_retrieval_status: 'veterinary_grounded',
                model_trust_status: 'grounded_draft',
            },
            intake,
            caseGraphSnapshot,
        });

        expect(workflow.status).toBe('outcome_workflow_ready');
        expect(workflow.handoffs.clinical_case_form_ready).toBe(true);
        expect(workflow.handoffs.inference_ready).toBe(true);
        expect(workflow.handoffs.case_graph_ready).toBe(true);
        expect(workflow.connected_data.lab_data).toBe(true);
        expect(workflow.downstream_workflows.diagnostic_review).toBe('ready');
        expect(workflow.downstream_workflows.outcome_capture).toBe('ready');
        expect(workflow.next_actions).toContain('open_case_form');
        expect(workflow.next_actions).toContain('open_inference');
    });
});
