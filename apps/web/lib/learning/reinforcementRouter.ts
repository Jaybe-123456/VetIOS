/**
 * Reinforcement Router
 * 
 * Safely processes a clinical outcome and maps it into three distinct learning lanes.
 * Prevents taxonomy misalignment from being reinforced (e.g., updating Pathogen weights when actual is Mechanical).
 * Aborts reinforcement if label_type is insufficient.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { LEARNING_REINFORCEMENTS } from '@/lib/db/schemaContracts';
import { getMasterDiseaseOntology, normalizeOntologyDiseaseName } from '@/lib/ai/diseaseOntology';

export const VALID_TAXONOMY_MAP: Record<string, string> = buildVerifiedTaxonomyMap();

export interface ReinforcementResult {
    diagnostic_updates_applied: number;
    severity_updates_applied: number;
    calibration_updates_applied: number;
    aborted_due_to_taxonomy: boolean;
    aborted_due_to_label_rule: boolean;
}

export interface ReinforcementInput {
    tenant_id: string;
    inference_event_id: string;
    label_type?: string; 
    predicted_diagnosis?: string;
    predicted_class?: string;
    actual_diagnosis?: string;
    actual_class?: string;
    predicted_severity?: number;
    actual_severity?: number;
    calibration_error?: number;
    extracted_features: Record<string, number>;
}

export async function routeReinforcement(
    client: SupabaseClient,
    input: ReinforcementInput
): Promise<ReinforcementResult> {
    const res: ReinforcementResult = {
        diagnostic_updates_applied: 0,
        severity_updates_applied: 0,
        calibration_updates_applied: 0,
        aborted_due_to_taxonomy: false,
        aborted_due_to_label_rule: false
    };

    // 1. Safety Rule: Only "expert" or "confirmed" labels strongly reinforce.
    // "synthetic" labels can only update calibration, not diagnosis/severity weights.
    const isSynthetic = !input.label_type || input.label_type === 'synthetic';

    // 2. Taxonomy Alignment Validation
    if (input.actual_diagnosis) {
        const strictClass = resolveStrictConditionClass(input.actual_diagnosis);
        if (strictClass && input.actual_class && input.actual_class !== strictClass) {
            // "Cannot reinforce a GDV as an Infectious pathogen"
            res.aborted_due_to_taxonomy = true;
            return res; // Complete abort, data integrity risk
        }
    }

    const inserts = [];

    // Lane 1: Diagnosis Learning (Only if expert/confirmed)
    if (!isSynthetic && input.actual_diagnosis) {
        // If misdiagnosed, promote the actual diagnosis features
        const diagnosisDelta = input.predicted_diagnosis !== input.actual_diagnosis ? +0.15 : +0.05;
        inserts.push({
            tenant_id: input.tenant_id,
            inference_event_id: input.inference_event_id,
            diagnosis_label: input.actual_diagnosis,
            condition_class: input.actual_class || 'UNKNOWN',
            severity_label: null,
            features: input.extracted_features,
            reinforcement_type: 'Diagnosis',
            impact_delta: diagnosisDelta
        });
        res.diagnostic_updates_applied++;
    }

    // Lane 2: Severity Learning (Only if expert/confirmed)
    if (!isSynthetic && input.actual_severity != null) {
        const severityDelta = input.actual_severity - (input.predicted_severity ?? 0);
        
        if (Math.abs(severityDelta) > 0.1) {
            inserts.push({
                tenant_id: input.tenant_id,
                inference_event_id: input.inference_event_id,
                diagnosis_label: null,
                condition_class: null,
                severity_label: input.actual_severity > 0.7 ? 'CRITICAL' : 'REVISED',
                // For severity learning, we primarily pass physiological triggers if available, but for now pass all
                features: input.extracted_features,
                reinforcement_type: 'Severity',
                impact_delta: severityDelta > 0 ? +0.2 : -0.2 // Push weights up if we underestimated 
            });
            res.severity_updates_applied++;
        }
    }

    // Lane 3: Calibration Learning (Always runs)
    if (input.calibration_error && input.calibration_error > 0.2) {
        // We were too confident and wrong, or too unconfident and right
        inserts.push({
            tenant_id: input.tenant_id,
            inference_event_id: input.inference_event_id,
            diagnosis_label: null,
            condition_class: null,
            severity_label: null,
            features: {}, // Calibration learning affects the global confidence smoothing logic
            reinforcement_type: 'Calibration',
            impact_delta: -input.calibration_error // Penalty exactly proportional to error
        });
        res.calibration_updates_applied++;
    }

    // Persist
    if (inserts.length > 0) {
        const C = LEARNING_REINFORCEMENTS.COLUMNS;
        
        const mappedInserts = inserts.map(i => ({
            [C.tenant_id]: i.tenant_id,
            [C.inference_event_id]: i.inference_event_id,
            [C.diagnosis_label]: i.diagnosis_label,
            [C.condition_class]: i.condition_class,
            [C.severity_label]: i.severity_label,
            [C.features]: i.features,
            [C.reinforcement_type]: i.reinforcement_type,
            [C.impact_delta]: i.impact_delta
        }));

        const { error } = await client.from(LEARNING_REINFORCEMENTS.TABLE).insert(mappedInserts);
        if (error) {
            console.error('[routeReinforcement] DB insertion failed:', error);
            throw new Error(`Failed to log reinforcements: ${error.message}`);
        }
    } else if (isSynthetic) {
        res.aborted_due_to_label_rule = true;
    }

    return res;
}

function buildVerifiedTaxonomyMap(): Record<string, string> {
    const map: Record<string, string> = {};

    for (const disease of getMasterDiseaseOntology()) {
        map[normalizeKey(disease.name)] = disease.condition_class;
        for (const alias of disease.aliases) {
            map[normalizeKey(alias)] = disease.condition_class;
        }
        map[normalizeKey(disease.id)] = disease.condition_class;
    }

    return map;
}

function resolveStrictConditionClass(value: string) {
    const ontologyName = normalizeOntologyDiseaseName(value);
    if (ontologyName) {
        return VALID_TAXONOMY_MAP[normalizeKey(ontologyName)] ?? null;
    }
    return VALID_TAXONOMY_MAP[normalizeKey(value)] ?? null;
}

function normalizeKey(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/['\u2019]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}
