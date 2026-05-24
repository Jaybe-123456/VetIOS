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
        const [dataset, inference, workflow] = await Promise.all([
            loadDatasetEvidence(client, target.tenantId),
            loadInferenceEvidence(client, target.tenantId),
            loadWorkflowEvidence(client, target.tenantId),
        ]);

        return {
            configured: true,
            source: target.source,
            tenant_id: target.tenantId,
            generated_at: generatedAt,
            error: null,
            dataset,
            inference,
            workflow,
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

async function loadDatasetEvidence(client: SupabaseClient, tenantId: string): Promise<PublicEvidenceSnapshot['dataset']> {
    const C = CLINICAL_CASES.COLUMNS;
    const [
        clinicalCases,
        realCaseImports,
        confirmedLabels,
        learningReadyCases,
        quarantinedCases,
        calibrationReadyCases,
    ] = await Promise.all([
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId)),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).eq(C.source_module, 'real_case_import')),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).not(C.confirmed_diagnosis, 'is', null)),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).eq(C.telemetry_status, 'learning_ready')),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).eq(C.invalid_case, true)),
        countRows(client, CLINICAL_CASES.TABLE, (query) => query.eq(C.tenant_id, tenantId).not(C.confidence_error, 'is', null)),
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

async function loadInferenceEvidence(client: SupabaseClient, tenantId: string): Promise<PublicEvidenceSnapshot['inference']> {
    const IC = AI_INFERENCE_EVENTS.COLUMNS;
    const OC = CLINICAL_OUTCOME_EVENTS.COLUMNS;
    const [inferenceEvents, outcomeLinkedInferences, cire] = await Promise.all([
        countRows(client, AI_INFERENCE_EVENTS.TABLE, (query) => query.eq(IC.tenant_id, tenantId)),
        countRows(client, CLINICAL_OUTCOME_EVENTS.TABLE, (query) => query.eq(OC.tenant_id, tenantId).not(OC.inference_event_id, 'is', null)),
        loadCireValidationReport(client, { tenantId, minSampleSize: 30 }).catch(() => null),
    ]);

    return {
        inference_events: inferenceEvents,
        outcome_linked_inferences: outcomeLinkedInferences,
        cire_sample_size: cire?.sample_size ?? 0,
        cire_status: cire?.status ?? 'unavailable',
        cire_spearman_r: cire?.spearman_r ?? null,
    };
}

async function loadWorkflowEvidence(client: SupabaseClient, tenantId: string): Promise<PublicEvidenceSnapshot['workflow']> {
    const P = PASSIVE_SIGNAL_EVENTS.COLUMNS;
    const passiveSignalEvents = await countRows(
        client,
        PASSIVE_SIGNAL_EVENTS.TABLE,
        (query) => query.eq(P.tenant_id, tenantId),
    );
    const connectorTypes = new Set(passiveSignalMarketplace.flatMap((template) => template.supported_connector_types));

    return {
        passive_signal_events: passiveSignalEvents,
        connector_templates: passiveSignalMarketplace.length,
        pims_templates: passiveSignalMarketplace.filter((template) => template.id.includes('clinic-ops') || template.label.toLowerCase().includes('clinic ops')).length,
        supported_connector_types: connectorTypes.size,
    };
}

async function countRows(
    client: SupabaseClient,
    table: string,
    applyFilters: (query: any) => any,
): Promise<number> {
    const query = applyFilters(client.from(table).select('id', { count: 'exact', head: true }));
    const { count, error } = await query;
    if (error) {
        return 0;
    }
    return count ?? 0;
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
    };
}
