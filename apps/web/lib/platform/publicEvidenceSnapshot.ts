import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCireValidationReport } from '@/lib/cire/validation';
import { AI_INFERENCE_EVENTS, CLINICAL_CASES, CLINICAL_OUTCOME_EVENTS, PASSIVE_SIGNAL_EVENTS } from '@/lib/db/schemaContracts';
import { passiveSignalMarketplace } from '@/lib/platform/passiveSignalMarketplace';
import { resolvePublicCatalogTenant, type PublicCatalogSource } from '@/lib/platform/publicTenant';
import { getSupabaseServer } from '@/lib/supabaseServer';

export interface PublicEvidenceSnapshot {
    configured: boolean;
    source: PublicCatalogSource;
    tenant_id: string | null;
    generated_at: string;
    error: string | null;
    warnings: string[];
    dataset: {
        clinical_cases: number;
        real_case_imports: number;
        confirmed_labels: number;
        learning_ready_cases: number;
        quarantined_cases: number;
        calibration_ready_cases: number;
    };
    inference: {
        inference_events: number;
        outcome_linked_inferences: number;
        cire_sample_size: number;
        cire_status: string;
        cire_spearman_r: number | null;
    };
    workflow: {
        passive_signal_events: number;
        connector_templates: number;
        pims_templates: number;
        supported_connector_types: number;
    };
    ask_vetios: {
        query_events: number;
        case_graph_ready: number;
        grounded_drafts: number;
        regulatory_reviewable: number;
        human_review_required: number;
        security_review_required: number;
    };
    amr: {
        genomic_events: number;
        stewardship_events: number;
        culture_guided_events: number;
        outcome_tracked_events: number;
        resistance_suspected_events: number;
    };
    integrity: PublicEvidenceIntegrity;
}

export interface PublicEvidenceIntegrity {
    status: 'not_configured' | 'no_live_evidence' | 'collecting' | 'evidence_grade';
    live_counts_available: boolean;
    outcome_confirmed_corpus: boolean;
    cire_validation_ready: boolean;
    amr_loop_active: boolean;
    ask_vetios_governed: boolean;
    public_claim_posture: 'architecture_only' | 'measured_activity' | 'evidence_grade_claims';
}

export async function getPublicEvidenceSnapshot(): Promise<PublicEvidenceSnapshot> {
    const generatedAt = new Date().toISOString();

    try {
        const target = await resolvePublicCatalogTenant();
        if (!target.tenantId) {
            return emptyEvidenceSnapshot({
                configured: false,
                source: target.source,
                tenantId: null,
                generatedAt,
                error: null,
            });
        }

        const client = getSupabaseServer();
        const warnings: string[] = [];
        const [dataset, inference, workflow] = await Promise.all([
            loadDatasetEvidence(client, target.tenantId, warnings),
            loadInferenceEvidence(client, target.tenantId, warnings),
            loadWorkflowEvidence(client, target.tenantId, warnings),
        ]);
        const [askVetios, amr] = await Promise.all([
            loadAskVetiosEvidence(client, warnings),
            loadAmrEvidence(client, target.tenantId, warnings),
        ]);
        const evidenceBase = {
            dataset,
            inference,
            workflow,
            ask_vetios: askVetios,
            amr,
        };

        return {
            configured: true,
            source: target.source,
            tenant_id: target.tenantId,
            generated_at: generatedAt,
            error: null,
            warnings,
            dataset,
            inference,
            workflow,
            ask_vetios: askVetios,
            amr,
            integrity: buildPublicEvidenceIntegrity({
                configured: true,
                ...evidenceBase,
            }),
        };
    } catch (error) {
        return emptyEvidenceSnapshot({
            configured: false,
            source: 'none',
            tenantId: null,
            generatedAt,
            error: error instanceof Error ? error.message : 'Failed to load public evidence snapshot.',
        });
    }
}

async function loadDatasetEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<PublicEvidenceSnapshot['dataset']> {
    const C = CLINICAL_CASES.COLUMNS;
    const [
        clinicalCases,
        realCaseImports,
        confirmedLabels,
        learningReadyCases,
        quarantinedCases,
        calibrationReadyCases,
    ] = await Promise.all([
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId), warnings, 'clinical cases'),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).eq(C.source_module, 'real_case_import'), warnings, 'real case imports'),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).not(C.confirmed_diagnosis, 'is', null), warnings, 'confirmed labels'),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).eq(C.telemetry_status, 'learning_ready'), warnings, 'learning-ready cases'),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).eq(C.invalid_case, true), warnings, 'quarantined cases'),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).not(C.confidence_error, 'is', null), warnings, 'calibration-ready cases'),
    ]);

    return {
        clinical_cases: clinicalCases,
        real_case_imports: realCaseImports,
        confirmed_labels: confirmedLabels,
        learning_ready_cases: learningReadyCases,
        quarantined_cases: quarantinedCases,
        calibration_ready_cases: calibrationReadyCases,
    };
}

async function loadInferenceEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<PublicEvidenceSnapshot['inference']> {
    const IC = AI_INFERENCE_EVENTS.COLUMNS;
    const OC = CLINICAL_OUTCOME_EVENTS.COLUMNS;
    const [inferenceEvents, outcomeLinkedInferences, cire] = await Promise.all([
        countRows(client, AI_INFERENCE_EVENTS.TABLE, (query) => query.eq(IC.tenant_id, tenantId), warnings, 'inference events'),
        countRows(client, CLINICAL_OUTCOME_EVENTS.TABLE, (query) => query.eq(OC.tenant_id, tenantId).not(OC.inference_event_id, 'is', null), warnings, 'outcome-linked inferences'),
        loadCireValidationReport(client, { tenantId, minSampleSize: 30 }).catch((error) => {
            warnings.push(`CIRE validation unavailable: ${readErrorMessage(error)}`);
            return null;
        }),
    ]);

    return {
        inference_events: inferenceEvents,
        outcome_linked_inferences: outcomeLinkedInferences,
        cire_sample_size: cire?.sample_size ?? 0,
        cire_status: cire?.status ?? 'unavailable',
        cire_spearman_r: cire?.spearman_r ?? null,
    };
}

async function loadWorkflowEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<PublicEvidenceSnapshot['workflow']> {
    const P = PASSIVE_SIGNAL_EVENTS.COLUMNS;
    const passiveSignalEvents = await countRows(
        client,
        PASSIVE_SIGNAL_EVENTS.TABLE,
        (query) => query.eq(P.tenant_id, tenantId),
        warnings,
        'passive signal events',
    );
    const connectorTypes = new Set(passiveSignalMarketplace.flatMap((template) => template.supported_connector_types));

    return {
        passive_signal_events: passiveSignalEvents,
        connector_templates: passiveSignalMarketplace.length,
        pims_templates: passiveSignalMarketplace.filter((template) => template.id.includes('clinic-ops') || template.label.toLowerCase().includes('clinic ops')).length,
        supported_connector_types: connectorTypes.size,
    };
}

async function loadAskVetiosEvidence(
    client: SupabaseClient,
    warnings: string[],
): Promise<PublicEvidenceSnapshot['ask_vetios']> {
    const table = 'ask_vetios_queries';
    const [
        queryEvents,
        caseGraphReady,
        groundedDrafts,
        regulatoryReviewable,
        humanReviewRequired,
        securityReviewRequired,
    ] = await Promise.all([
        countRows(client, table, (query) => query.is('tenant_id', null), warnings, 'public Ask VetIOS queries'),
        countRows(client, table, (query) => query.is('tenant_id', null).eq('case_graph_status', 'ready_for_case_graph'), warnings, 'Ask VetIOS case graph drafts'),
        countRows(client, table, (query) => query.is('tenant_id', null).eq('model_trust_status', 'grounded_draft'), warnings, 'Ask VetIOS grounded drafts'),
        countRows(client, table, (query) => query.is('tenant_id', null).eq('regulatory_claims_status', 'cds_reviewable'), warnings, 'Ask VetIOS regulatory reviewable drafts'),
        countRows(client, table, (query) => query.is('tenant_id', null).in('human_review_status', [
            'clinician_review_required',
            'specialist_review_recommended',
            'emergency_review_required',
        ]), warnings, 'Ask VetIOS human-review drafts'),
        countRows(client, table, (query) => query.is('tenant_id', null).eq('ai_security_status', 'security_review_required'), warnings, 'Ask VetIOS security-review drafts'),
    ]);

    return {
        query_events: queryEvents,
        case_graph_ready: caseGraphReady,
        grounded_drafts: groundedDrafts,
        regulatory_reviewable: regulatoryReviewable,
        human_review_required: humanReviewRequired,
        security_review_required: securityReviewRequired,
    };
}

async function loadAmrEvidence(
    client: SupabaseClient,
    tenantId: string,
    warnings: string[],
): Promise<PublicEvidenceSnapshot['amr']> {
    const [
        genomicEvents,
        stewardshipEvents,
        cultureGuidedEvents,
        outcomeTrackedEvents,
        resistanceSuspectedEvents,
    ] = await Promise.all([
        countRows(client, 'amr_genomic_events', (query) => query.eq('tenant_id', tenantId), warnings, 'AMR genomic events'),
        countRows(client, 'amr_stewardship_events', (query) => query.eq('tenant_id', tenantId), warnings, 'AMR stewardship events'),
        countRows(client, 'amr_stewardship_events', (query) => query.eq('tenant_id', tenantId).eq('culture_collected', true), warnings, 'AMR culture-guided events'),
        countRows(client, 'amr_stewardship_events', (query) => query.eq('tenant_id', tenantId).not('outcome_status', 'is', null), warnings, 'AMR outcome-tracked events'),
        countRows(client, 'amr_stewardship_events', (query) => query.eq('tenant_id', tenantId).eq('resistance_suspected', true), warnings, 'AMR resistance-suspected events'),
    ]);

    return {
        genomic_events: genomicEvents,
        stewardship_events: stewardshipEvents,
        culture_guided_events: cultureGuidedEvents,
        outcome_tracked_events: outcomeTrackedEvents,
        resistance_suspected_events: resistanceSuspectedEvents,
    };
}

async function countRows(
    client: SupabaseClient,
    table: string,
    applyFilters: (query: any) => any,
    warnings?: string[],
    label = table,
): Promise<number> {
    const query = applyFilters(client.from(table).select('id', { count: 'exact', head: true }));
    const { count, error } = await query;
    if (error) {
        warnings?.push(`${label} unavailable: ${readErrorMessage(error)}`);
        return 0;
    }
    return count ?? 0;
}

export function buildPublicEvidenceIntegrity(input: {
    configured: boolean;
    dataset: PublicEvidenceSnapshot['dataset'];
    inference: PublicEvidenceSnapshot['inference'];
    workflow: PublicEvidenceSnapshot['workflow'];
    ask_vetios: PublicEvidenceSnapshot['ask_vetios'];
    amr: PublicEvidenceSnapshot['amr'];
}): PublicEvidenceIntegrity {
    if (!input.configured) {
        return {
            status: 'not_configured',
            live_counts_available: false,
            outcome_confirmed_corpus: false,
            cire_validation_ready: false,
            amr_loop_active: false,
            ask_vetios_governed: false,
            public_claim_posture: 'architecture_only',
        };
    }

    const outcomeConfirmedCorpus = input.dataset.confirmed_labels > 0
        && input.inference.outcome_linked_inferences > 0;
    const cireValidationReady = input.inference.cire_status === 'validated'
        || input.inference.cire_sample_size >= 30;
    const amrLoopActive = input.amr.stewardship_events > 0
        || input.amr.genomic_events > 0;
    const askVetiosGoverned = input.ask_vetios.query_events > 0
        && (
            input.ask_vetios.case_graph_ready > 0
            || input.ask_vetios.grounded_drafts > 0
            || input.ask_vetios.regulatory_reviewable > 0
            || input.ask_vetios.human_review_required > 0
        );
    const liveCountsAvailable = input.dataset.clinical_cases > 0
        || input.inference.inference_events > 0
        || input.workflow.passive_signal_events > 0
        || input.ask_vetios.query_events > 0
        || input.amr.genomic_events > 0
        || input.amr.stewardship_events > 0;
    const status: PublicEvidenceIntegrity['status'] = outcomeConfirmedCorpus && cireValidationReady
        ? 'evidence_grade'
        : liveCountsAvailable ? 'collecting' : 'no_live_evidence';
    const publicClaimPosture: PublicEvidenceIntegrity['public_claim_posture'] = status === 'evidence_grade'
        ? 'evidence_grade_claims'
        : status === 'collecting' ? 'measured_activity' : 'architecture_only';

    return {
        status,
        live_counts_available: liveCountsAvailable,
        outcome_confirmed_corpus: outcomeConfirmedCorpus,
        cire_validation_ready: cireValidationReady,
        amr_loop_active: amrLoopActive,
        ask_vetios_governed: askVetiosGoverned,
        public_claim_posture: publicClaimPosture,
    };
}

function readErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
        return error.message;
    }
    return 'query failed';
}

function emptyEvidenceSnapshot(input: {
    configured: boolean;
    source: PublicCatalogSource;
    tenantId: string | null;
    generatedAt: string;
    error: string | null;
}): PublicEvidenceSnapshot {
    return {
        configured: input.configured,
        source: input.source,
        tenant_id: input.tenantId,
        generated_at: input.generatedAt,
        error: input.error,
        warnings: input.error ? [input.error] : [],
        dataset: {
            clinical_cases: 0,
            real_case_imports: 0,
            confirmed_labels: 0,
            learning_ready_cases: 0,
            quarantined_cases: 0,
            calibration_ready_cases: 0,
        },
        inference: {
            inference_events: 0,
            outcome_linked_inferences: 0,
            cire_sample_size: 0,
            cire_status: 'unconfigured',
            cire_spearman_r: null,
        },
        workflow: {
            passive_signal_events: 0,
            connector_templates: passiveSignalMarketplace.length,
            pims_templates: passiveSignalMarketplace.filter((template) => template.id.includes('clinic-ops') || template.label.toLowerCase().includes('clinic ops')).length,
            supported_connector_types: new Set(passiveSignalMarketplace.flatMap((template) => template.supported_connector_types)).size,
        },
        ask_vetios: {
            query_events: 0,
            case_graph_ready: 0,
            grounded_drafts: 0,
            regulatory_reviewable: 0,
            human_review_required: 0,
            security_review_required: 0,
        },
        amr: {
            genomic_events: 0,
            stewardship_events: 0,
            culture_guided_events: 0,
            outcome_tracked_events: 0,
            resistance_suspected_events: 0,
        },
        integrity: buildPublicEvidenceIntegrity({
            configured: input.configured,
            dataset: {
                clinical_cases: 0,
                real_case_imports: 0,
                confirmed_labels: 0,
                learning_ready_cases: 0,
                quarantined_cases: 0,
                calibration_ready_cases: 0,
            },
            inference: {
                inference_events: 0,
                outcome_linked_inferences: 0,
                cire_sample_size: 0,
                cire_status: 'unconfigured',
                cire_spearman_r: null,
            },
            workflow: {
                passive_signal_events: 0,
                connector_templates: passiveSignalMarketplace.length,
                pims_templates: passiveSignalMarketplace.filter((template) => template.id.includes('clinic-ops') || template.label.toLowerCase().includes('clinic ops')).length,
                supported_connector_types: new Set(passiveSignalMarketplace.flatMap((template) => template.supported_connector_types)).size,
            },
            ask_vetios: {
                query_events: 0,
                case_graph_ready: 0,
                grounded_drafts: 0,
                regulatory_reviewable: 0,
                human_review_required: 0,
                security_review_required: 0,
            },
            amr: {
                genomic_events: 0,
                stewardship_events: 0,
                culture_guided_events: 0,
                outcome_tracked_events: 0,
                resistance_suspected_events: 0,
            },
        }),
    };
}
